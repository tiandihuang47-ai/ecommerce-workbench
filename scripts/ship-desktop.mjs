#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appName = "编导中台.app";
const appBundleId = "com.director.platform";
const fixedApp = path.join(projectDir, appName);
const builtApp = path.join(projectDir, "dist", `mac-${process.arch}`, appName);
const stagingApp = path.join(projectDir, `${appName}.updating`);
const backupApp = path.join(projectDir, `${appName}.previous`);

function removeAppIfPresent(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

function validateAppBundle(target) {
  const appAsar = path.join(target, "Contents", "Resources", "app.asar");
  const frameworkLink = path.join(
    target,
    "Contents",
    "Frameworks",
    "Electron Framework.framework",
    "Electron Framework",
  );

  if (!fs.existsSync(appAsar) || !fs.lstatSync(frameworkLink).isSymbolicLink()) {
    throw new Error(`桌面 App 包不完整：${target}`);
  }

  const frameworkTarget = fs.readlinkSync(frameworkLink);
  if (path.isAbsolute(frameworkTarget)) {
    throw new Error(`桌面 App 包内部链接被改写为绝对路径：${frameworkTarget}`);
  }
}

function installFixedApp() {
  if (!fs.existsSync(builtApp)) {
    throw new Error(`没有找到刚打包的桌面 App：${builtApp}`);
  }
  validateAppBundle(builtApp);

  removeAppIfPresent(stagingApp);
  removeAppIfPresent(backupApp);
  try {
    // fs.cpSync 对 .app 内 asar 文件可能报 Operation not permitted；ditto 对 .app 包最可靠。
    const copied = spawnSync("ditto", [builtApp, stagingApp], { stdio: "inherit" });
    if (copied.status !== 0) throw new Error(`ditto 复制失败（退出码 ${copied.status}）。`);
    validateAppBundle(stagingApp);
  } catch (error) {
    removeAppIfPresent(stagingApp);
    throw error;
  }

  try {
    if (fs.existsSync(fixedApp)) fs.renameSync(fixedApp, backupApp);
    fs.renameSync(stagingApp, fixedApp);
    removeAppIfPresent(backupApp);
  } catch (error) {
    removeAppIfPresent(stagingApp);
    if (!fs.existsSync(fixedApp) && fs.existsSync(backupApp)) fs.renameSync(backupApp, fixedApp);
    throw error;
  }
}

function run(command, args, label, extraEnv = {}) {
  console.log(`\n${label}…`);
  const result = spawnSync(command, args, {
    cwd: projectDir,
    stdio: "inherit",
    env: {
      ...process.env,
      ...extraEnv,
      PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${process.env.PATH || ""}`
    }
  });
  if (result.status !== 0) {
    console.error(`\n✗ ${label}失败（退出码 ${result.status}）。`);
    process.exit(result.status || 1);
  }
}

console.log("1/4 退出正在运行的编导中台…");
spawnSync("osascript", ["-e", `tell application id "${appBundleId}" to quit`], { stdio: "ignore" });

run("npm", ["run", "desktop:build"], "2/4 重建桌面生产界面和启动器");

console.log("\n3/4 原子更新根目录固定双击入口…");
installFixedApp();

console.log("4/4 重新打开编导中台…");
spawnSync("open", [fixedApp], { stdio: "ignore" });

const healthUrl = "http://127.0.0.1:3010/";
let healthy = false;
for (let attempt = 0; attempt < 30; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
    if (response.status === 200) {
      healthy = true;
      break;
    }
  } catch {
    // 服务还没起来，继续等待。
  }
}

if (healthy) {
  console.log("\n✓ 发布完成：双击根目录“编导中台.app”即为最新稳定版，3010 服务正常。");
} else {
  console.error("\n⚠ 发布完成，但 3010 服务暂时未响应，请稍等片刻或重新双击“编导中台.app”。");
  process.exitCode = 1;
}
