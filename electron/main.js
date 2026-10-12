const { app, BrowserWindow, dialog, session, shell } = require("electron");
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

class StartupCheckError extends Error {
  constructor(code, message, repairHint) {
    super(message);
    this.name = "StartupCheckError";
    this.code = code;
    this.repairHint = repairHint;
  }
}

function isProjectRoot(directory) {
  return Boolean(directory)
    && fs.existsSync(path.join(directory, "package.json"))
    && fs.existsSync(path.join(directory, "electron", "main.js"))
    && fs.existsSync(path.join(directory, "src", "app"))
    && fs.existsSync(path.join(directory, "next.config.ts"));
}

function findProjectRoot(startDirectory) {
  if (!startDirectory) return "";

  let current = path.resolve(startDirectory);
  for (let depth = 0; depth < 10; depth += 1) {
    if (isProjectRoot(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return "";
}

function resolveProjectDir() {
  let savedProjectDir = "";
  try {
    const savedPathFile = path.join(app.getPath("userData"), "project-path.txt");
    if (fs.existsSync(savedPathFile)) {
      savedProjectDir = fs.readFileSync(savedPathFile, "utf8").trim();
    }
  } catch {
    // 首次启动时没有保存路径是正常情况。
  }

  const candidates = [
    process.env.DIRECTOR_PROJECT_DIR,
    savedProjectDir,
    process.cwd(),
    path.resolve(__dirname, ".."),
    path.dirname(process.execPath),
  ];

  for (const candidate of candidates) {
    const projectRoot = findProjectRoot(candidate);
    if (projectRoot) return projectRoot;
  }

  return "";
}

let PROJECT_DIR = resolveProjectDir();
let PORT = 3010;
let APP_URL = "";
let HEALTH_URL = "";
let LOG_DIR = "";
let LOG_FILE = "";
const STALE_RECHECK_MS = 10000;
const PROCESS_STOP_TIMEOUT_MS = 5000;
const IS_PRODUCTION_MODE = app.isPackaged || process.env.DIRECTOR_DESKTOP_MODE === "production";
const DESKTOP_BUILD_DIR = ".next-desktop";

let mainWindow = null;
let nextProcess = null;
let startedNextByElectron = false;
let bootCompleted = false;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

function refreshRuntimePaths() {
  APP_URL = `http://localhost:${PORT}`;
  HEALTH_URL = `http://127.0.0.1:${PORT}`;
  LOG_DIR = PROJECT_DIR
    ? path.join(PROJECT_DIR, "logs")
    : path.join(app.getPath("userData"), "logs");
  LOG_FILE = path.join(LOG_DIR, "desktop-app.log");
}

function setProjectDir(directory) {
  PROJECT_DIR = path.resolve(directory);
  refreshRuntimePaths();
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(path.join(app.getPath("userData"), "project-path.txt"), PROJECT_DIR, "utf8");
}

function setRuntimePort(port) {
  PORT = port;
  refreshRuntimePaths();
}

refreshRuntimePaths();

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(startPort = 3011, endPort = 3020) {
  for (let port = startPort; port <= endPort; port += 1) {
    if (await isPortFree(port)) {
      return port;
    }
  }
  return 0;
}

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function log(message) {
  ensureLogDir();
  const line = `[${new Date().toLocaleString("zh-CN", { hour12: false })}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line, "utf8");
  console.log(line.trim());
}

function fail(title, message, error) {
  const detail = error ? `\n\n原始错误：${error.message || String(error)}` : "";
  log(`${title}：${message}${error ? ` | ${error.message || String(error)}` : ""}`);
  dialog.showErrorBox(title, `${message}${detail}\n\n日志文件：${LOG_FILE}`);
}

async function showStartupRepair(error) {
  const issue = error instanceof StartupCheckError
    ? error
    : new StartupCheckError(
      "UNKNOWN",
      error?.message || "启动时发生未知错误。",
      "请打开日志所在文件夹，把 desktop-app.log 发给技术人员继续排查。",
    );
  const detail = `${issue.message}\n\n修复建议：${issue.repairHint}\n\n项目目录：${PROJECT_DIR || "未找到"}\n日志：${LOG_FILE}`;

  log(`启动自检未通过 [${issue.code}]：${issue.message}`);

  if (issue.code === "PROJECT_NOT_FOUND") {
    const response = await dialog.showMessageBox({
      type: "warning",
      title: "找不到项目目录",
      message: "编导中台启动自检未通过",
      detail,
      buttons: ["选择项目目录", "退出"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response.response !== 0) return false;

    const selection = await dialog.showOpenDialog({
      title: "选择编导中台项目目录",
      properties: ["openDirectory"],
      buttonLabel: "选择此目录",
    });
    if (selection.canceled || selection.filePaths.length === 0) return false;
    if (!isProjectRoot(selection.filePaths[0])) {
      dialog.showErrorBox(
        "目录不正确",
        "所选目录不是完整的编导中台项目。请选择同时包含 package.json、src 和 electron 的文件夹。",
      );
      return true;
    }
    setProjectDir(selection.filePaths[0]);
    log(`已保存用户选择的项目目录：${PROJECT_DIR}`);
    return true;
  }

  if (issue.code === "NODE_MISSING") {
    const response = await dialog.showMessageBox({
      type: "warning",
      title: "Node.js 环境不完整",
      message: "编导中台启动自检未通过",
      detail,
      buttons: ["下载 Node.js", "退出"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response.response === 0) {
      await shell.openExternal("https://nodejs.org/zh-cn/download");
    }
    return false;
  }

  if (issue.code === "DEPENDENCIES_MISSING") {
    const response = await dialog.showMessageBox({
      type: "warning",
      title: "项目依赖不完整",
      message: "需要安装项目依赖",
      detail: `${detail}\n\n安装期间需要联网，通常需要几分钟。`,
      buttons: ["一键安装依赖", "退出"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response.response !== 0) return false;
    runRepairCommand("npm", ["install"]);
    return true;
  }

  if (issue.code === "PRODUCTION_BUILD_MISSING") {
    const response = await dialog.showMessageBox({
      type: "warning",
      title: "桌面运行文件缺失",
      message: "需要生成桌面端生产构建",
      detail: `${detail}\n\n构建期间 App 可能暂时无响应，完成后会自动继续启动。`,
      buttons: ["一键生成生产构建", "退出"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response.response !== 0) return false;
    runRepairCommand("npm", ["run", "build"], { DIRECTOR_DESKTOP_BUILD: "1" });
    return true;
  }

  if (issue.code === "PORT_CONFLICT") {
    const availablePort = await findAvailablePort();
    if (availablePort) {
      const response = await dialog.showMessageBox({
        type: "warning",
        title: "启动端口被占用",
        message: `${PORT} 端口无法安全使用`,
        detail,
        buttons: [`自动换用 ${availablePort} 端口`, "退出"],
        defaultId: 0,
        cancelId: 1,
      });
      if (response.response !== 0) return false;
      setRuntimePort(availablePort);
      log(`已自动换用空闲端口：${PORT}`);
      return true;
    }
  }

  const response = await dialog.showMessageBox({
    type: "error",
    title: "编导中台启动失败",
    message: "自动修复未完成",
    detail,
    buttons: ["打开日志所在文件夹", "退出"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response.response === 0) {
    ensureLogDir();
    if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, "", "utf8");
    shell.showItemInFolder(LOG_FILE);
  }
  return false;
}

function commandExists(command) {
  const result = spawnSync("zsh", ["-lc", `command -v ${command}`], {
    encoding: "utf8",
    env: buildShellEnv(),
  });
  return result.status === 0;
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, {
    cwd: PROJECT_DIR,
    encoding: "utf8",
    env: buildShellEnv(),
  });

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${command} 执行失败`).trim());
  }

  return (result.stdout || "").trim();
}

function buildShellEnv() {
  const extraPath = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ].join(":");

  const environment = {
    ...process.env,
    PATH: `${extraPath}:${process.env.PATH || ""}`,
    FORCE_COLOR: "1",
    DOUYIN_COOKIE_JAR: path.join(app.getPath("userData"), "douyin-cookies.txt"),
    DIRECTOR_RUNTIME_DIR: path.join(app.getPath("userData"), "director-platform-data"),
    // 桌面端无需登录：Next 服务（middleware/API）检测到该变量后跳过鉴权
    DIRECTOR_WEB_AUTH_DISABLED: "1"
  };

  if (IS_PRODUCTION_MODE) {
    environment.DIRECTOR_DESKTOP_BUILD = "1";
  }

  return environment;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function checkUrl(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const request = http.request(url, { method: "GET", timeout: timeoutMs }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });

    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });

    request.on("error", () => resolve(false));
    request.end();
  });
}

function getProcessCwd(pid) {
  const result = spawnSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
    encoding: "utf8",
    env: buildShellEnv(),
  });

  if (result.status !== 0) {
    return "";
  }

  const cwdLine = (result.stdout || "")
    .split("\n")
    .find((line) => line.startsWith("n"));

  return cwdLine ? cwdLine.slice(1) : "";
}

function getPortProcesses() {
  const result = spawnSync("lsof", ["-n", "-P", `-iTCP:${PORT}`, "-sTCP:LISTEN", "-Fpc"], {
    encoding: "utf8",
    env: buildShellEnv(),
  });

  if (result.status !== 0) {
    return [];
  }

  const processes = [];
  let current = null;

  for (const line of (result.stdout || "").split("\n")) {
    if (line.startsWith("p")) {
      const pid = Number(line.slice(1));
      if (Number.isInteger(pid) && pid > 0) {
        current = { pid, command: "", cwd: "" };
        processes.push(current);
      }
      continue;
    }

    if (line.startsWith("c") && current) {
      current.command = line.slice(1);
    }
  }

  return processes.map((processInfo) => ({
    ...processInfo,
    cwd: getProcessCwd(processInfo.pid),
  }));
}

function formatPortProcesses(processes) {
  return processes
    .map((processInfo) => `PID ${processInfo.pid} (${processInfo.command || "未知进程"}) cwd=${processInfo.cwd || "未知"}`)
    .join("; ");
}

function isProjectProcess(processInfo) {
  return processInfo.cwd === PROJECT_DIR;
}

/** 读取进程环境变量文本（macOS: ps eww）。拿不到时返回空串。 */
function getProcessEnvironment(pid) {
  const result = spawnSync("ps", ["eww", String(pid)], {
    encoding: "utf8",
    env: buildShellEnv(),
  });
  return result.status === 0 ? result.stdout || "" : "";
}

/**
 * 只有「Electron 拉起的桌面服务」才带 DIRECTOR_RUNTIME_DIR（见 buildShellEnv）。
 * cwd 只能证明进程在项目目录里——网页部署脚本、其它会话误占 3010 的 next 实例
 * cwd 同样是项目目录，但它们读的是项目内数据根，会让桌面窗口拿到另一套数据。
 */
function isDesktopProjectProcess(processInfo) {
  if (!isProjectProcess(processInfo)) return false;
  return getProcessEnvironment(processInfo.pid).includes("DIRECTOR_RUNTIME_DIR=");
}

async function waitForUrl(timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await checkUrl(HEALTH_URL, 3000)) {
      return true;
    }
    await wait(1000);
  }

  return false;
}

async function waitForPortRelease(timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (getPortProcesses().length === 0) {
      return true;
    }
    await wait(250);
  }

  return getPortProcesses().length === 0;
}

function signalProcess(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") {
      return true;
    }
    log(`无法向 PID ${pid} 发送 ${signal}：${error.message || String(error)}`);
    return false;
  }
}

async function stopStaleProjectProcesses(processes) {
  log(`确认 3010 端口由本项目的无响应进程占用，准备自动恢复：${formatPortProcesses(processes)}`);

  for (const processInfo of processes) {
    signalProcess(processInfo.pid, "SIGTERM");
  }

  if (await waitForPortRelease(PROCESS_STOP_TIMEOUT_MS)) {
    log("旧进程已正常退出，3010 端口已释放");
    return;
  }

  const remainingProcesses = getPortProcesses().filter(isProjectProcess);
  for (const processInfo of remainingProcesses) {
    signalProcess(processInfo.pid, "SIGKILL");
  }

  if (!(await waitForPortRelease(PROCESS_STOP_TIMEOUT_MS))) {
    throw new Error("旧的编导中台进程无法结束，请重新启动 Mac 后再试。");
  }

  log("旧进程无响应，已强制结束并释放 3010 端口");
}

async function waitForNextReady(timeoutMs = 90000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await checkUrl(HEALTH_URL, 5000)) {
      return true;
    }
    await wait(1000);
  }

  return false;
}

function validateProject() {
  log("开始桌面端环境检查");
  if (!PROJECT_DIR || !isProjectRoot(PROJECT_DIR)) {
    throw new StartupCheckError(
      "PROJECT_NOT_FOUND",
      "没有找到完整的编导中台项目目录。",
      "点击“选择项目目录”，选择包含 package.json、src 和 electron 的文件夹。",
    );
  }
  log(`项目路径：${PROJECT_DIR}`);

  if (!commandExists("node")) {
    throw new StartupCheckError(
      "NODE_MISSING",
      "没有检测到 Node.js。",
      "点击“下载 Node.js”，安装 Node.js 20 或 22 LTS 后重新打开 App。",
    );
  }

  if (!commandExists("npm")) {
    throw new StartupCheckError(
      "NODE_MISSING",
      "检测到 Node.js，但没有找到 npm。",
      "点击“下载 Node.js”并重新安装 LTS 版本，安装完成后重新打开 App。",
    );
  }

  const nodeVersion = commandOutput("node", ["-v"]);
  const nodeMajor = Number(nodeVersion.replace(/^v/, "").split(".")[0]);
  if (!Number.isInteger(nodeMajor) || nodeMajor < 20) {
    throw new StartupCheckError(
      "NODE_MISSING",
      `当前 Node.js 版本过低：${nodeVersion}。`,
      "点击“下载 Node.js”，升级到 Node.js 20 或 22 LTS 后重新打开 App。",
    );
  }

  log(`Node 版本：${nodeVersion}`);
  log(`npm 版本：${commandOutput("npm", ["-v"])}`);
}

function ensureDependencies() {
  const nodeModulesPath = path.join(PROJECT_DIR, "node_modules");
  const nextBinPath = path.join(nodeModulesPath, ".bin", "next");

  if (fs.existsSync(nodeModulesPath) && fs.existsSync(nextBinPath)) {
    log("项目依赖检查通过");
    return;
  }

  throw new StartupCheckError(
    "DEPENDENCIES_MISSING",
    "项目依赖缺失或不完整，桌面端暂时无法启动。",
    "点击“一键安装依赖”，App 会在当前项目目录执行 npm install。",
  );
}

function runRepairCommand(command, args, extraEnv = {}) {
  log(`执行修复命令：${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: PROJECT_DIR,
    encoding: "utf8",
    env: { ...buildShellEnv(), ...extraEnv },
  });

  log(result.stdout || "");
  log(result.stderr || "");
  if (result.status !== 0) {
    throw new StartupCheckError(
      "REPAIR_FAILED",
      `自动修复失败（退出码 ${result.status ?? "未知"}）。`,
      "请打开日志所在文件夹，把 desktop-app.log 发给技术人员继续排查。",
    );
  }
}

function validateProductionBuild() {
  if (!IS_PRODUCTION_MODE) {
    return;
  }

  const buildIdPath = path.join(PROJECT_DIR, DESKTOP_BUILD_DIR, "BUILD_ID");
  const serverPath = path.join(PROJECT_DIR, DESKTOP_BUILD_DIR, "server");
  if (!fs.existsSync(buildIdPath) || !fs.existsSync(serverPath)) {
    throw new StartupCheckError(
      "PRODUCTION_BUILD_MISSING",
      "没有找到完整的桌面端生产构建。",
      "点击“一键生成生产构建”，App 会自动执行生产构建后重试启动。",
    );
  }

  log("生产构建完整性检查通过；源码更新时间不阻塞桌面启动");
}

function startNextServer() {
  const commandName = IS_PRODUCTION_MODE ? "start" : "dev";
  log(`开始启动 Next.js ${IS_PRODUCTION_MODE ? "生产" : "开发"}服务：npm run ${commandName} -- --port ${PORT}`);
  startedNextByElectron = true;

  // 桌面服务只绑定本机回环地址：局域网同事一律走网页版 3020 端口（带登录），
  // 避免绕过鉴权直接访问桌面服务。
  nextProcess = spawn(
    "npm",
    ["run", commandName, "--", "--port", String(PORT), "--hostname", "127.0.0.1"],
    {
      cwd: PROJECT_DIR,
      env: buildShellEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    }
  );

  nextProcess.stdout.on("data", (data) => {
    log(`[next] ${data.toString().trimEnd()}`);
  });

  nextProcess.stderr.on("data", (data) => {
    log(`[next:error] ${data.toString().trimEnd()}`);
  });

  nextProcess.on("exit", (code, signal) => {
    log(`Next.js 进程退出：code=${code ?? "null"} signal=${signal ?? "null"}`);
    nextProcess = null;
  });
}

async function ensureNextServer() {
  if (await checkUrl(HEALTH_URL, 5000)) {
    const healthyProcesses = getPortProcesses();
    if (healthyProcesses.length > 0 && healthyProcesses.every(isDesktopProjectProcess)) {
      log(`检测到本项目的桌面服务已经可访问，直接打开桌面窗口`);
      return;
    }

    /* 占用者是本项目目录里的进程、但没有桌面环境（如部署脚本/其它会话误把 3010 当网页端口）：
     * 它们读的是项目内数据根，桌面窗口连上后会拿到另一套数据（产品图"不可用"等错乱）。
     * 视为冗余实例，直接回收端口，由桌面自己启动正确环境的服务。 */
    if (healthyProcesses.length > 0 && healthyProcesses.every(isProjectProcess)) {
      log(`检测到 ${PORT} 被本项目的非桌面服务占用（cwd 相同但缺少桌面环境变量），自动回收端口`);
      await stopStaleProjectProcesses(healthyProcesses);
    } else {
      throw new StartupCheckError(
        "PORT_CONFLICT",
        `${PORT} 端口已有其他服务，不能确认它属于当前项目。`,
        "点击“自动换用空闲端口”，不会结束或影响占用端口的其他程序。",
      );
    }
  }

  const portProcesses = getPortProcesses();
  if (portProcesses.length > 0) {
    log(`${PORT} 端口正在监听，但页面暂时没有响应：${formatPortProcesses(portProcesses)}`);

    if (!portProcesses.every(isProjectProcess)) {
      throw new StartupCheckError(
        "PORT_CONFLICT",
        `${PORT} 端口被其他程序占用。\n${formatPortProcesses(portProcesses)}`,
        "点击“自动换用空闲端口”，不会结束或影响占用端口的其他程序。",
      );
    }

    if (await waitForUrl(STALE_RECHECK_MS)) {
      log("等待后页面已恢复响应，继续打开桌面窗口");
      return;
    }

    await stopStaleProjectProcesses(portProcesses);
  }

  log(`${PORT} 端口空闲，准备由 Electron 自动启动本地服务`);
  startNextServer();

  const ready = await waitForNextReady();
  if (!ready) {
    throw new Error("Next.js 启动超时，请查看 logs/desktop-app.log。");
  }

  log("Next.js 已启动并可访问");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: "编导中台",
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#0f172a",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.removeMenu();

  if (process.env.ELECTRON_DEVTOOLS === "1") {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    log("Electron 桌面窗口已显示");
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    fail("页面加载失败", `桌面窗口加载 ${APP_URL} 失败：${errorDescription}（${errorCode}）`);
  });

  mainWindow.loadURL(APP_URL);
  log(`Electron 正在加载：${APP_URL}`);
}

async function refreshDouyinCookieJar() {
  const cookieJarPath = path.join(app.getPath("userData"), "douyin-cookies.txt");
  const now = Date.now();
  try {
    if (fs.existsSync(cookieJarPath)) {
      const age = now - fs.statSync(cookieJarPath).mtimeMs;
      if (age < 12 * 60 * 60 * 1000) {
        return cookieJarPath;
      }
    }
  } catch { /* stale file will be refreshed */ }

  let window = null;
  try {
    window = new BrowserWindow({
      show: false,
      width: 480,
      height: 320,
      webPreferences: {
        partition: "persist:douyin",
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    await window.loadURL("https://www.douyin.com/?recommend=1", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36" });
    await new Promise((resolve) => setTimeout(resolve, 2500));

    const douyinSession = session.fromPartition("persist:douyin");
    const cookies = await douyinSession.cookies.get({});
    const lines = ["# Netscape HTTP Cookie File"];
    for (const cookie of cookies) {
      if (!cookie.domain || !cookie.path) continue;
      const domain = cookie.domain.startsWith(".") ? cookie.domain : `.${cookie.domain}`;
      const secure = cookie.secure ? "TRUE" : "FALSE";
      const expires = cookie.expirationDate ? Math.floor(cookie.expirationDate) : 2147483647;
      lines.push([domain, "TRUE", cookie.path, secure, String(expires), cookie.name, cookie.value].join("\t"));
    }
    fs.writeFileSync(cookieJarPath, `${lines.join("\n")}\n`, { mode: 0o600 });
    log(`[DOUYIN_IMPORT] PUBLIC_COOKIE_SUCCESS count=${cookies.length}`);
    return cookieJarPath;
  } catch (error) {
    log(`[DOUYIN_IMPORT] PUBLIC_COOKIE_FAILED ${error?.message || String(error)}`);
    return "";
  } finally {
    if (window) window.destroy();
  }
}


async function boot() {
  ensureLogDir();
  log("========== 编导中台桌面端启动 ==========");
  log(`运行模式：${IS_PRODUCTION_MODE ? "生产模式" : "开发模式"}`);

  void refreshDouyinCookieJar();

  while (true) {
    try {
      validateProject();
      ensureDependencies();
      validateProductionBuild();
      await ensureNextServer();
      bootCompleted = true;
      createWindow();
      return;
    } catch (error) {
      try {
        const shouldRetry = await showStartupRepair(error);
        if (shouldRetry) {
          log("修复操作已完成，重新执行启动自检");
          continue;
        }
      } catch (repairError) {
        log(`自动修复执行失败：${repairError.message || String(repairError)}`);
        await showStartupRepair(repairError);
      }
      app.quit();
      return;
    }
  }
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.whenReady().then(boot);
}

app.on("second-instance", () => {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
});

app.on("activate", () => {
  if (bootCompleted && BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (nextProcess && startedNextByElectron) {
    log("正在停止 Electron 自动启动的 Next.js 服务");
    try {
      process.kill(-nextProcess.pid, "SIGTERM");
    } catch (error) {
      log(`停止 Next.js 进程组失败，改为停止主进程：${error.message || String(error)}`);
      nextProcess.kill("SIGTERM");
    }
  }
});
