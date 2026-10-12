#!/usr/bin/env node

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const projectDir = path.resolve(__dirname, "..");
const electronBin = path.join(projectDir, "node_modules", ".bin", "electron");
const mainFile = path.join(projectDir, "electron", "main.js");
const desktopMode = process.argv.includes("--production") ? "production" : "development";

if (!fs.existsSync(projectDir)) {
  console.error(`启动失败：项目路径不存在：${projectDir}`);
  process.exit(1);
}

if (!fs.existsSync(electronBin)) {
  console.error("启动失败：没有找到 Electron。请先执行 npm install。");
  process.exit(1);
}

if (!fs.existsSync(mainFile)) {
  console.error("启动失败：没有找到 Electron 主进程文件 electron/main.js。");
  process.exit(1);
}

const child = spawn(electronBin, [mainFile], {
  cwd: projectDir,
  stdio: "inherit",
  env: {
    ...process.env,
    PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${process.env.PATH || ""}`,
    DIRECTOR_DESKTOP_MODE: desktopMode,
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code || 0);
});
