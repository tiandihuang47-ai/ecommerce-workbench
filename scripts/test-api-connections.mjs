// Isolated HTTP integration: all upstream responses come from a local fixture server.
// No real credentials, paid providers, project configuration, or user history are changed.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, cp, rm, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';

const root = await mkdtemp(path.join(tmpdir(), 'ecommerce-api-setup-'));
const port = 4324, upstreamPort = 4325;
const base = `http://127.0.0.1:${port}`;
const upstreamBase = `http://127.0.0.1:${upstreamPort}/v1`;
const key = 'fixture-only-private-credential-97531';
const requests = [];
let child, log = '', passed = 0;
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1sAAAAASUVORK5CYII=';
const upstream = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString();
  let body = {}; try { body = JSON.parse(raw || '{}'); } catch { /* multipart */ }
  requests.push({ url: req.url, authorization: req.headers.authorization || req.headers['x-api-key'], body, raw });
  const send = (value) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
  if (req.url === '/v1/models') return send({ data: ['fixture-text-a', 'fixture-text-b', 'fixture-vision', 'fixture-image', 'fixture-audio'].map((id) => ({ id })) });
  if (body.model === 'fixture-reject') { res.statusCode = 400; return send({ error: { message: `rejected credential ${key}` } }); }
  if (req.url === '/v1/images/generations' || req.url === '/v1/images/edits') return send({ data: [{ b64_json: png }] });
  if (req.url === '/v1/audio/transcriptions') return send({ text: '测试音频' });
  if (body.stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    if (req.url === '/v1/messages') {
      for (const p of [{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'fixture reply' } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } }, { type: 'message_stop' }]) res.write(`data: ${JSON.stringify(p)}\n\n`);
    } else {
      for (const p of [{ choices: [{ delta: { content: 'fixture reply' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]) res.write(`data: ${JSON.stringify(p)}\n\n`);
      res.write('data: [DONE]\n\n');
    }
    return res.end();
  }
  if (req.url === '/v1/messages') return send({ content: [{ type: 'text', text: '{"ok":true}' }] });
  const content = JSON.stringify(body).includes('image_url') ? '{"seen":true}' : JSON.stringify(body).includes('input_audio') ? '测试音频' : '{"ok":true}';
  return send({ choices: [{ message: { content }, finish_reason: 'stop' }] });
});
async function stop() {
  if (!child) return;
  const old = child; child = undefined;
  const exit = new Promise((resolve) => old.once('exit', resolve)); old.kill('SIGTERM'); await exit;
}
async function start(username = 'owner') {
  await stop(); log = '';
  const catalog = parse(await readFile('config/models.yaml', 'utf8'));
  const keys = Object.fromEntries(Object.values(catalog.providers).flatMap((p) => [p.api_key_env, p.api_key_fallback_env].filter(Boolean).map((k) => [k, ''])));
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
    env: { ...process.env, ...keys, NODE_ENV: 'production', DIRECTOR_RUNTIME_DIR: root, COMMERCE_IMAGE_DATA_DIR: path.join(root, 'commerce-image'), MODEL_CONFIG_DIR: path.join(root, 'config'), MODEL_ROUTER_PROFILE_DIR: path.join(root, 'model-router'), DIRECTOR_WEB_AUTH_DISABLED: '0', DIRECTOR_LOCAL_ACCESS_USERNAME: username, DIRECTOR_REQUIRE_LOGIN: username ? '0' : '1' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (b) => { log += b; }); child.stderr.on('data', (b) => { log += b; });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('Fixture app exited before startup');
    try { if ((await fetch(base + '/api/auth/me')).ok) return; } catch { /* startup */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Fixture app did not start');
}
async function get() { const r = await fetch(base + '/api/settings/connections'); assert.equal(r.status, 200); return r.json(); }
async function post(body, status = 200, headers = {}) {
  const r = await fetch(base + '/api/settings/connections', { method: 'POST', headers: { 'Content-Type': 'application/json', origin: base, ...headers }, body: JSON.stringify(body) });
  const raw = await r.text(); assert.equal(raw.includes(key), false, 'credential leaked in API response');
  assert.equal(r.status, status, `Unexpected status: ${raw}`); return JSON.parse(raw);
}
async function check(name, fn) { await fn(); passed++; console.log('PASS: ' + name); }
let state;
async function add(kind, modelId, connectionId, extra = {}) {
  state = await post({ action: 'connect', revision: state.revision, name: 'Fixture API', baseUrl: upstreamBase, apiKey: connectionId ? '' : key, connectionId, protocol: 'openai_compatible', modelId, kind, applyDefault: true, ...extra });
  return state.models.find((m) => m.modelId === modelId && m.kind === kind);
}
async function chat(stream = false) {
  const r = await fetch(base + '/api/ai-chat', { method: 'POST', headers: { 'Content-Type': 'application/json', origin: base }, body: JSON.stringify({ messages: [{ role: 'user', content: '你好' }], stream }) });
  assert.equal(r.status, 200); const raw = await r.text(); assert.ok(!raw.includes(key));
  const content = stream ? raw.split('\n').filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice(6))).map((frame) => frame.delta || '').join('') : JSON.parse(raw).content;
  assert.equal(content, 'fixture reply', raw);
}
try {
  await cp('config', path.join(root, 'config'), { recursive: true });
  await mkdir(path.join(root, 'auth'), { recursive: true });
  await writeFile(path.join(root, 'auth/users.json'), JSON.stringify([{ id: 'u_owner', username: 'owner', nickname: 'Fixture', role: 'admin', status: 'active', passwordHash: '', createdAt: '', updatedAt: '' }, { id: 'u_staff', username: 'staff', nickname: 'Staff', role: 'user', status: 'active', passwordHash: '', createdAt: '', updatedAt: '' }]));
  await mkdir(path.join(root, 'users/u_owner/storage'), { recursive: true });
  await writeFile(path.join(root, 'users/u_owner/storage/history.json'), 'existing fixture history');
  await new Promise((resolve) => upstream.listen(upstreamPort, '127.0.0.1', resolve));
  await start(); state = await get();
  const originalRoutes = state.routes.map((r) => [r.key, r.alias]);
  const sourceModels = await readFile(path.join(root, 'config/models.yaml'), 'utf8');
  const sourceRoutes = await readFile(path.join(root, 'config/model-routing.yaml'), 'utf8');
  await check('Model discovery uses only the explicit API connection; keys are not returned', async () => {
    const data = await post({ action: 'discover', name: 'Fixture', baseUrl: upstreamBase, apiKey: key }); assert.ok(data.models.includes('fixture-text-a'));
  });
  await check('One text setup enables every text route, including replica, with no silent fallback', async () => {
    const model = await add('text', 'fixture-text-a');
    const routes = await (await fetch(base + '/api/settings/model-routing')).json();
    assert.ok(state.routes.filter((r) => r.capability === 'text').every((r) => r.alias === model.alias && r.configured));
    assert.ok(routes.routes.filter((r) => r.capability === 'text').every((r) => r.fallback === 'none'));
    assert.ok(state.routes.filter((r) => r.capability !== 'text').every((r) => originalRoutes.find(([k]) => k === r.key)[1] === r.alias));
  });
  const connectionId = state.connections[0].id;
  await check('Anthropic Messages handles Base URLs ending in /v1 for verification and both chat modes', async () => {
    const m = await add('text', 'fixture-text-anthropic', undefined, { name: 'Fixture Anthropic', protocol: 'anthropic_compatible' });
    state = await post({ action: 'verify', revision: state.revision, alias: m.alias });
    assert.equal(requests.at(-1).url, '/v1/messages');
    await chat(); await chat(true);
    assert.equal(requests.at(-1).url, '/v1/messages');
    state = await post({ action: 'assign', revision: state.revision, defaults: { text: state.models.find((n) => n.modelId === 'fixture-text-a').alias } });
  });
  await check('OpenAI-compatible chat works in JSON and browser SSE modes without restarting', async () => { await chat(); await chat(true); });
  await check('Script and topic generation use the shared text API', async () => {
    for (const type of ['script', 'topic']) {
      const r = await fetch(base + '/api/generate', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ type, input: { product: '测试商品', requirement: '测试' } }) });
      assert.equal(r.status, 200); assert.ok((await r.json()).content);
      assert.equal(requests.at(-1).body.model, 'fixture-text-a');
    }
  });
  await check('Real HTTP verification marks only the selected capability, not all model capabilities', async () => {
    const m = state.models.find((m) => m.modelId === 'fixture-text-a');
    state = await post({ action: 'verify', revision: state.revision, alias: m.alias });
    assert.ok(state.models.find((n) => n.alias === m.alias).verifiedAt);
    assert.equal(state.defaults.vision, undefined);
  });
  await check('Same saved key supports a second model; per-feature overrides and clearing work', async () => {
    const second = await add('text', 'fixture-text-b', connectionId, { applyDefault: false });
    assert.equal(state.connections.filter((c) => c.name === 'Fixture API').length, 1);
    state = await post({ action: 'assign', revision: state.revision, routeKey: 'ai_chat', alias: second.alias });
    await chat(); assert.equal(requests.at(-1).body.model, 'fixture-text-b');
    state = await post({ action: 'assign', revision: state.revision, routeKey: 'ai_chat', alias: '' });
    await chat(); assert.equal(requests.at(-1).body.model, 'fixture-text-a');
  });
  await check('Conflicting saves and incompatible capability assignments are rejected atomically', async () => {
    const pointer = await readFile(path.join(root, 'model-router/active.json'), 'utf8');
    await post({ action: 'assign', revision: 'stale', defaults: { text: state.defaults.text } }, 409);
    await post({ action: 'assign', revision: state.revision, defaults: { vision: state.defaults.text } }, 400);
    assert.equal(await readFile(path.join(root, 'model-router/active.json'), 'utf8'), pointer);
  });
  await check('Vision reuses the existing connection and sends the selected model and image', async () => {
    const m = await add('vision', 'fixture-vision', connectionId);
    state = await post({ action: 'verify', revision: state.revision, alias: m.alias });
    assert.equal(requests.at(-1).body.model, 'fixture-vision'); assert.ok(JSON.stringify(requests.at(-1).body).includes('image_url'));
  });
  await check('Both audio interfaces use the saved key and selected speech model', async () => {
    for (const kind of ['audio_chat', 'audio_transcriptions']) {
      const m = await add(kind, 'fixture-audio', connectionId);
      state = await post({ action: 'verify', revision: state.revision, alias: m.alias, audioBase64: Buffer.from('fixture audio').toString('base64'), audioFormat: 'wav' });
      assert.equal(requests.at(-1).url, kind === 'audio_chat' ? '/v1/chat/completions' : '/v1/audio/transcriptions');
      assert.ok(requests.at(-1).raw.includes('fixture-audio'));
    }
  });
  await check('Generic image setup reaches Images API and enables the image provider', async () => {
    const m = await add('image_openai', 'fixture-image', connectionId);
    state = await post({ action: 'verify', revision: state.revision, alias: m.alias });
    assert.equal(requests.at(-1).url, '/v1/images/generations'); assert.equal(requests.at(-1).body.model, 'fixture-image');
    const providers = await (await fetch(base + '/api/commerce-image/providers')).json(); assert.ok(providers.providers.some((p) => p.provider === 'configured' && p.configured));
  });
  await check('Custom credentials are redacted even when provider errors echo them', async () => {
    const m = await add('text', 'fixture-reject', connectionId);
    await post({ action: 'verify', revision: state.revision, alias: m.alias }, 400);
    assert.ok(!log.includes(key), 'credential leaked into server log');
    state = await post({ action: 'assign', revision: state.revision, defaults: { text: state.models.find((m) => m.modelId === 'fixture-text-a').alias } });
  });
  await check('Malformed JSON never echoes an unsaved credential', async () => {
    const unsaved = 'fixture-unsaved-private-97532';
    const r = await fetch(base + '/api/settings/connections', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: `{"apiKey":"${unsaved}",` });
    assert.equal(r.status, 400); assert.ok(!(await r.text()).includes(unsaved));
  });
  await check('Private keys stay out of YAML, responses and checked-in config; files have mode 0600', async () => {
    const { revision } = JSON.parse(await readFile(path.join(root, 'model-router/active.json'), 'utf8'));
    const dir = path.join(root, 'model-router/revisions', revision);
    for (const name of ['models.yaml', 'model-routing.yaml']) assert.ok(!(await readFile(path.join(dir, name), 'utf8')).includes(key));
    assert.equal((await stat(path.join(dir, 'connections.json'))).mode & 0o777, 0o600);
    assert.equal((await readFile(path.join(root, 'config/models.yaml'), 'utf8')), sourceModels);
    assert.equal((await readFile(path.join(root, 'config/model-routing.yaml'), 'utf8')), sourceRoutes);
    assert.ok(!JSON.stringify(await get()).includes(key));
  });
  await check('Restart retains assignments and history; changing one capability preserves the others', async () => {
    const before = state.defaults; await start(); state = await get(); assert.deepEqual(state.defaults, before);
    await chat(); assert.equal(await readFile(path.join(root, 'users/u_owner/storage/history.json'), 'utf8'), 'existing fixture history');
  });
  await check('Restore returns the original model combination while retaining added API connections', async () => {
    state = await post({ action: 'assign', revision: state.revision, restore: true });
    assert.deepEqual(state.routes.map((r) => [r.key, r.alias]), originalRoutes); assert.ok(state.connections.length);
  });
  await check('Unauthenticated, staff and cross-origin clients cannot manage or use stored credentials', async () => {
    await post({ action: 'assign', revision: state.revision }, 403, { origin: 'https://untrusted.example' });
    await start('');
    assert.equal((await fetch(base + '/api/settings/connections')).status, 401);
    // Session tokens use the app's real HMAC format and a fixture-only secret.
    const secret = Buffer.alloc(32, 7); await writeFile(path.join(root, 'auth/secret'), secret.toString('hex'));
    const payload = Buffer.from(JSON.stringify({ uid: 'u_staff', exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
    const token = payload + '.' + createHmac('sha256', secret).update(payload).digest('base64url');
    assert.equal((await fetch(base + '/api/settings/connections', { headers: { cookie: `director_session=${token}` } })).status, 403);
  });
  // Leave an isolated app ready for UI testing on request.
  await start(); state = await get(); await add('text', 'fixture-text-a', connectionId);
  console.log(`${passed} API setup integration checks passed (fixture HTTP, no paid model calls).`);
  if (process.argv.includes('--ui')) {
    console.log(`UI fixture ready: ${base}/settings ; root: ${root}`);
    await new Promise((resolve) => { process.once('SIGTERM', resolve); process.once('SIGINT', resolve); });
  }
} finally { await stop(); await new Promise((resolve) => upstream.close(resolve)); await rm(root, { recursive: true, force: true }); }
