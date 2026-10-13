#!/usr/bin/env node
// Isolated integration checks. Does not call AI providers or touch real user data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = await mkdtemp(path.join(tmpdir(), 'director-local-access-'));
const port = 4321;
const base = `http://127.0.0.1:${port}`;
let server;
let log = '';
let passed = 0;
const users = [
  { id: 'u_local_owner', username: 'local_owner', nickname: 'Local owner', role: 'admin', status: 'active', passwordHash: '', createdAt: '', updatedAt: '' },
  { id: 'u_other_user', username: 'other_user', nickname: 'Other user', role: 'user', status: 'active', passwordHash: '', createdAt: '', updatedAt: '' }
];
const usersFile = path.join(root, 'auth/users.json');
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}
async function stop() {
  if (!server) return;
  const current = server;
  server = undefined;
  const exited = new Promise((resolve) => current.once('exit', resolve));
  current.kill('SIGTERM');
  await exited;
}
async function start(username = '', desktop = false, requireLogin = false) {
  await stop();
  log = '';
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
    env: { ...process.env, NODE_ENV: 'production', DIRECTOR_RUNTIME_DIR: root, COMMERCE_IMAGE_DATA_DIR: path.join(root, 'commerce-image'), DIRECTOR_LOCAL_ACCESS_USERNAME: username, DIRECTOR_WEB_AUTH_DISABLED: desktop ? '1' : '0', DIRECTOR_REQUIRE_LOGIN: requireLogin ? '1' : '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 100; i += 1) {
    if (server.exitCode !== null) throw new Error(`Server failed: ${log}`);
    try {
      if ((await fetch(`${base}/api/auth/me`)).ok) return;
    } catch { /* waiting for process readiness */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Local test server did not become ready');
}
async function me(headers) {
  if (headers?.host) {
    // Node fetch ignores caller-supplied Host; raw HTTP is required for this boundary check.
    return new Promise((resolve, reject) => {
      const r = httpRequest(`${base}/api/auth/me`, { headers }, (response) => {
        let body = ''; response.on('data', (d) => { body += d; });
        response.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
      });
      r.on('error', reject); r.end();
    });
  }
  return (await fetch(`${base}/api/auth/me`, { headers })).json();
}
try {
  await mkdir(path.join(root, 'auth'), { recursive: true });
  await writeFile(usersFile, JSON.stringify(users), { mode: 0o600 });
  for (const [id, value] of [['u_local_owner', 'existing owner history'], ['u_other_user', 'other user history']]) {
    await mkdir(path.join(root, 'users', id, 'storage'), { recursive: true });
    await writeFile(path.join(root, 'users', id, 'storage/history.json'), value);
  }
  await start('local_owner');
  await check('No cookie enters existing owner account without exposing password hashes', async () => {
    const state = await me();
    assert.equal(state.localAccess, true); assert.equal(state.user.id, 'u_local_owner');
    assert.equal('passwordHash' in state.user, false);
  });
  await check('Home and scripts open directly; login/setup redirect to home', async () => {
    for (const url of ['/', '/script-generator']) assert.equal((await fetch(base + url, { redirect: 'manual' })).status, 200);
    for (const url of ['/login', '/setup']) {
      const r = await fetch(base + url, { redirect: 'manual' }); assert.equal(r.status, 307); assert.equal(new URL(r.headers.get('location')).pathname, '/');
    }
  });
  await check('Existing owner history stays available', async () => {
    const r = await fetch(`${base}/api/storage/history`); assert.equal(r.status, 200);
    assert.equal((await r.json()).value, 'existing owner history');
  });
  await check('New saves stay in the same owner directory, with other user data intact', async () => {
    const r = await fetch(`${base}/api/storage/local-mode-save`, { method: 'PUT', headers: { origin: base }, body: 'persisted local edit' });
    assert.equal(r.status, 200);
    const data = JSON.parse(await readFile(path.join(root, 'users/u_local_owner/storage/local-mode-save.json'), 'utf8'));
    assert.equal(data.value, 'persisted local edit');
    assert.equal(await readFile(path.join(root, 'users/u_other_user/storage/history.json'), 'utf8'), 'other user history');
  });
  await check('Ownership-stamped draft creation remains assigned to existing owner', async () => {
    const r = await fetch(`${base}/api/commerce-image/tasks`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ kind: 'detail_page', title: 'Local test draft' }) });
    assert.equal(r.status, 201); const data = await r.json();
    const stored = JSON.parse(await readFile(path.join(root, 'commerce-image/tasks', data.task.id, 'task.json'), 'utf8'));
    assert.equal(stored.userId, 'u_local_owner');
    assert.equal(data.task.userId, undefined);
  });
  await check('Cross-site admin writes and storage writes are rejected', async () => {
    const admin = await fetch(`${base}/api/admin/users`, { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: JSON.stringify({ username: 'intruder', password: 'test-only-pass' }) });
    assert.ok([401, 403].includes(admin.status));
    const storage = await fetch(`${base}/api/storage/local-mode-save`, { method: 'PUT', headers: { origin: 'https://evil.example' }, body: 'cross-site overwrite' });
    assert.equal(storage.status, 401);
  });
  await check('Non-loopback and lookalike Host headers receive no automatic account', async () => {
    for (const host of ['example.com', 'localhost.evil.example', '192.168.1.232:4321']) assert.equal((await me({ host })).user, null, host);
    assert.equal((await me({ host: `localhost:${port}` })).user.id, 'u_local_owner');
  });
  await start('local_owner');
  await check('Server restart and repeat browser visits preserve passwordless access and saved history', async () => {
    assert.equal((await me()).user.id, 'u_local_owner');
    assert.equal((await (await fetch(`${base}/api/storage/local-mode-save`)).json()).value, 'persisted local edit');
  });
  users[0].status = 'disabled'; await writeFile(usersFile, JSON.stringify(users), { mode: 0o600 });
  await check('Disabled selected account is not granted automatic access', async () => { assert.equal((await me()).user, null); });
  users[0].status = 'active'; await writeFile(usersFile, JSON.stringify(users), { mode: 0o600 });
  await start('missing_user');
  await check('Missing account fails closed', async () => { assert.equal((await me()).user, null); });
  await start('other_user');
  await check('Non-admin account is not silently promoted', async () => { assert.equal((await me()).user, null); });
  await start('', false, true);
  await check('Explicit login mode preserves regular web authentication', async () => {
    assert.equal((await me()).user, null);
    assert.equal((await fetch(base, { redirect: 'manual' })).status, 307);
    assert.equal((await fetch(`${base}/api/commerce-image/tasks`)).status, 401);
  });
  await start();
  await check('Default local mode reuses the existing owner without an environment setting', async () => {
    assert.equal((await me()).user.id, 'u_local_owner');
    assert.equal((await (await fetch(`${base}/api/storage/history`)).json()).value, 'existing owner history');
  });
  users[0].status = 'disabled'; await writeFile(usersFile, JSON.stringify(users), { mode: 0o600 });
  await check('Default mode never promotes an existing non-admin or disabled account', async () => {
    assert.equal((await me()).user, null);
  });
  await rm(usersFile);
  await start();
  await check('Fresh install opens directly without creating a username, password or account database', async () => {
    const states = await Promise.all(Array.from({ length: 8 }, () => me()));
    for (const state of states) {
      assert.equal(state.localAccess, true); assert.equal(state.initialized, true);
      assert.equal(state.user.id, 'u_local_workspace'); assert.equal('passwordHash' in state.user, false);
    }
    await assert.rejects(readFile(usersFile), { code: 'ENOENT' });
    for (const url of ['/', '/script-generator', '/settings']) assert.equal((await fetch(base + url, { redirect: 'manual' })).status, 200);
    for (const url of ['/login', '/setup']) {
      const r = await fetch(base + url, { redirect: 'manual' });
      assert.equal(r.status, 307); assert.equal(new URL(r.headers.get('location')).pathname, '/');
    }
  });
  await check('Fresh local workspace persists edits with a stable storage owner', async () => {
    const r = await fetch(`${base}/api/storage/new-install-history`, { method: 'PUT', headers: { origin: base }, body: 'fresh local content' });
    assert.equal(r.status, 200);
  });
  await start();
  await check('Fresh workspace keeps its data after restart without logging in', async () => {
    assert.equal((await me()).user.id, 'u_local_workspace');
    assert.equal((await (await fetch(`${base}/api/storage/new-install-history`)).json()).value, 'fresh local content');
    await assert.rejects(readFile(usersFile), { code: 'ENOENT' });
  });
  await check('Default local workspace rejects foreign Host and cross-site access', async () => {
    for (const host of ['example.com', 'localhost.evil.example', '192.168.1.232:4321']) assert.equal((await me({ host })).user, null);
    assert.equal((await me({ origin: 'https://evil.example' })).user, null);
    const r = await fetch(`${base}/api/storage/new-install-history`, { method: 'PUT', headers: { origin: 'https://evil.example' }, body: 'overwrite' });
    assert.equal(r.status, 401);
    assert.equal((await (await fetch(`${base}/api/storage/new-install-history`)).json()).value, 'fresh local content');
  });
  await start('', false, true);
  await check('Opt-in login mode requires initialization on a fresh install', async () => {
    const state = await me(); assert.equal(state.user, null); assert.equal(state.initialized, false);
    assert.equal((await fetch(base, { redirect: 'manual' })).status, 307);
  });
  await start('local_owner', true);
  await check('Desktop mode remains unchanged', async () => { const s = await me(); assert.equal(s.authEnabled, false); assert.equal(s.user, null); });
  console.log(`${passed} local access integration checks passed`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await stop();
  await rm(root, { recursive: true, force: true });
}
