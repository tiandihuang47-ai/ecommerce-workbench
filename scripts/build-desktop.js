#!/usr/bin/env node

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const projectDir = path.resolve(__dirname, "..");
const electronBuilder = path.join(projectDir, "node_modules", ".bin", "electron-builder");
const nextEnvPath = path.join(projectDir, "next-env.d.ts");
const originalNextEnv = fs.existsSync(nextEnvPath)
  ? { exists: true, content: fs.readFileSync(nextEnvPath, "utf8") }
  : { exists: false, content: "" };
let nextEnvRestored = false;

function run(command, args, failureMessage) {
  const result = spawnSync(command, args, {
    cwd: projectDir,
    env: {
      ...process.env,
      DIRECTOR_DESKTOP_BUILD: "1",
    },
    stdio: "inherit",
  });

  if (result.status !== 0) {
    const error = new Error(failureMessage);
    error.exitCode = result.status || 1;
    throw error;
  }
}

function restoreNextEnv() {
  if (nextEnvRestored) return;
  nextEnvRestored = true;

  if (originalNextEnv.exists) {
    if (!fs.existsSync(nextEnvPath) || fs.readFileSync(nextEnvPath, "utf8") !== originalNextEnv.content) {
      fs.writeFileSync(nextEnvPath, originalNextEnv.content, "utf8");
    }
    return;
  }

  if (fs.existsSync(nextEnvPath)) {
    fs.unlinkSync(nextEnvPath);
  }
}

process.once("exit", restoreNextEnv);
process.once("SIGINT", () => {
  restoreNextEnv();
  process.exit(130);
});
process.once("SIGTERM", () => {
  restoreNextEnv();
  process.exit(143);
});

try {
  console.log("清理上一次构建产物（旧 webpack 缓存会导致构建卡死）...");
  fs.rmSync(path.join(projectDir, ".next-desktop"), { recursive: true, force: true });

  console.log("开始构建 Next.js 生产版本...");
  run("npm", ["run", "build"], "Next.js 生产构建失败，桌面 App 未打包。");

  console.log("\n清理旧的桌面 App 打包目录...");
  fs.rmSync(path.join(projectDir, "dist", `mac-${process.arch}`, "编导中台.app"), { recursive: true, force: true });

  console.log("开始打包 Mac 桌面 App...");
  run(electronBuilder, ["--mac", "dir"], "Electron 桌面 App 打包失败。");

  console.log(`\n桌面生产版构建完成：dist/mac-${process.arch}/编导中台.app`);
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : "Electron 桌面 App 打包失败。"}`);
  process.exitCode = error && typeof error.exitCode === "number" ? error.exitCode : 1;
} finally {
  restoreNextEnv();
}
