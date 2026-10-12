#!/bin/zsh

set -u

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
PORT="3010"
BROWSER_URL="http://localhost:${PORT}"
HEALTH_URL="http://127.0.0.1:${PORT}"
LOG_DIR="${PROJECT_DIR}/logs"
LOG_FILE="${LOG_DIR}/launcher.log"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

print_plain() {
  echo "$*"
}

pause_for_user() {
  echo ""
  echo "按任意键关闭这个窗口..."
  read -k 1 2>/dev/null || true
}

if [ ! -d "$PROJECT_DIR" ]; then
  print_plain "启动失败：没有找到项目目录。"
  print_plain "项目路径：$PROJECT_DIR"
  print_plain "请确认项目文件夹没有被移动或改名。"
  pause_for_user
  exit 1
fi

mkdir -p "$LOG_DIR"
touch "$LOG_FILE"
exec > >(tee -a "$LOG_FILE") 2>&1

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

fail() {
  log "启动失败：$*"
  echo ""
  echo "你可以把这个日志文件发给我继续排查："
  echo "$LOG_FILE"
  pause_for_user
  exit 1
}

is_url_alive() {
  curl -fsSI --max-time 5 "$HEALTH_URL" >/dev/null 2>&1
}

is_port_listening() {
  command -v lsof >/dev/null 2>&1 && lsof -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1
}

get_port_pids() {
  lsof -tiTCP:${PORT} -sTCP:LISTEN 2>/dev/null | sort -u
}

get_process_cwd() {
  local pid="$1"
  lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1
}

wait_for_existing_site() {
  for _ in {1..5}; do
    if is_url_alive; then
      return 0
    fi
    sleep 2
  done
  return 1
}

wait_for_port_release() {
  for _ in {1..20}; do
    if ! is_port_listening; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

recover_stale_project_port() {
  local pid
  local cwd
  local pids
  pids="$(get_port_pids)"

  if [ -z "$pids" ]; then
    return 0
  fi

  for pid in ${(f)pids}; do
    cwd="$(get_process_cwd "$pid")"
    if [ "$cwd" != "$PROJECT_DIR" ]; then
      fail "${PORT} 端口被其他程序占用，无法安全自动结束。占用进程 PID：${pid}，目录：${cwd:-未知}"
    fi
  done

  log "确认 ${PORT} 端口由本项目的无响应进程占用，开始自动恢复"
  for pid in ${(f)pids}; do
    log "正在结束旧进程 PID：${pid}"
    kill -TERM "$pid" >/dev/null 2>&1 || true
  done

  if wait_for_port_release; then
    log "旧进程已退出，${PORT} 端口已释放"
    return 0
  fi

  pids="$(get_port_pids)"
  for pid in ${(f)pids}; do
    cwd="$(get_process_cwd "$pid")"
    if [ "$cwd" != "$PROJECT_DIR" ]; then
      fail "自动恢复时检测到其他程序接管 ${PORT} 端口，已停止处理。"
    fi
    log "旧进程未响应，强制结束 PID：${pid}"
    kill -KILL "$pid" >/dev/null 2>&1 || true
  done

  wait_for_port_release || fail "旧的编导中台进程无法结束，请重新启动 Mac 后再试。"
  log "旧进程已强制结束，${PORT} 端口已释放"
}

open_site() {
  open "$BROWSER_URL" >/dev/null 2>&1
  log "已打开浏览器：$BROWSER_URL"
}

print_header() {
  echo ""
  echo "========================================"
  echo "       编导中台 / AI 内容中台启动器"
  echo "========================================"
  echo "项目目录：$PROJECT_DIR"
  echo "访问地址：$BROWSER_URL"
  echo "日志文件：$LOG_FILE"
  echo ""
}

run_environment_check() {
  log "开始环境检查"

  cd "$PROJECT_DIR" || fail "无法进入项目目录：$PROJECT_DIR"

  if [ ! -f "package.json" ]; then
    fail "没有找到 package.json。请确认你打开的是 director-platform 项目目录。"
  fi
  log "package.json 检查通过"

  if ! command -v node >/dev/null 2>&1; then
    fail "没有检测到 Node.js。请先安装 Node.js，再重新打开启动器。"
  fi
  log "Node 版本：$(node -v)"

  if ! command -v npm >/dev/null 2>&1; then
    fail "没有检测到 npm。请确认 Node.js 安装完整。"
  fi
  log "npm 版本：$(npm -v)"

  if [ ! -d "node_modules" ]; then
    log "没有检测到 node_modules，开始自动安装依赖：npm install"
    npm install || fail "npm install 执行失败。请查看上方英文错误，或把日志发给我。"
    log "依赖安装完成"
  else
    log "node_modules 已存在，跳过 npm install"
  fi
}

check_only() {
  print_header
  run_environment_check
  if is_port_listening; then
    log "${PORT} 端口状态：已被占用"
    if is_url_alive; then
      log "localhost:${PORT} 可以访问，网站已经在运行"
    else
      log "localhost:${PORT} 端口被占用，但网站暂时不可访问"
    fi
  else
    log "${PORT} 端口状态：空闲"
  fi
  log "自检完成"
}

main() {
  print_header
  run_environment_check

  if is_port_listening; then
    log "${PORT} 端口已被占用"
    if is_url_alive; then
      log "编导中台已经在运行，直接打开浏览器"
      open_site
      echo ""
      echo "编导中台已经在运行，已为你打开浏览器。"
      echo "如果页面打不开，请关闭旧的启动终端窗口后再重新双击启动器。"
      pause_for_user
      exit 0
    fi

    log "端口正在监听但页面暂时没有响应，等待 10 秒确认是否仍在启动"
    if wait_for_existing_site; then
      log "页面已经恢复响应，直接打开浏览器"
      open_site
      pause_for_user
      exit 0
    fi

    recover_stale_project_port
  fi

  log "${PORT} 端口空闲，准备启动网站"
  echo "正在启动网站，请稍等。启动成功后会自动打开浏览器。"
  echo "网站运行期间不要关闭这个终端窗口。"
  echo "如果要停止网站，关闭这个窗口即可。"
  echo ""

  (
    for _ in {1..90}; do
      if is_url_alive; then
        log "网站启动成功"
        open_site
        exit 0
      fi
      sleep 1
    done
    log "等待网站启动超时，请查看日志或终端输出"
  ) &
  WATCHER_PID=$!

  log "执行命令：npm run dev -- --port ${PORT}"
  npm run dev -- --port "$PORT"
  DEV_EXIT=$?

  kill "$WATCHER_PID" >/dev/null 2>&1 || true

  if [ "$DEV_EXIT" -ne 0 ]; then
    fail "npm run dev 退出，错误码：$DEV_EXIT"
  fi
}

case "${1:-}" in
  --check)
    check_only
    ;;
  *)
    main
    ;;
esac
