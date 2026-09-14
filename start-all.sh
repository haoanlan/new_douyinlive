#!/usr/bin/env bash
# 一键启动抖音监控全栈（在**系统终端**里运行，不要在受限沙箱内运行）
#
#   bash start-all.sh          # 启动 Go 代理 + 监控脚本 + 仪表盘
#   bash start-all.sh stop     # 全部停止
#   bash start-all.sh status   # 查看状态
#
# 说明：
#  - Go 代理会被 monitor.js 自动拉起（ensureBinaryRunning），所以这里主要保证顺序
#  - 仪表盘独立进程，负责页面与 REST API
#  - 所有输出落到 logs/ 目录

set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR" || exit 1

LOG_DIR="$DIR/logs"
mkdir -p "$LOG_DIR"

PID_PROXY="$LOG_DIR/proxy.pid"
PID_DASH="$LOG_DIR/dashboard.pid"

# 代理二进制：优先项目里已有的，其次用环境变量指定
pick_proxy() {
  if [ -n "${DOUYIN_PROXY_BIN:-}" ] && [ -x "$DOUYIN_PROXY_BIN" ]; then
    echo "$DOUYIN_PROXY_BIN"; return
  fi
  for f in douyinLive-linux-amd64 douyinLive-linux-arm64 douyinLive-darwin-amd64 douyinLive; do
    [ -f "$f" ] && { echo "$DIR/$f"; return; }
  done
  echo ""
}

port_listening() {
  # $1 = 端口
  if command -v ss >/dev/null 2>&1; then
    ss -lnt 2>/dev/null | grep -q ":$1 "
  elif command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else
    (exec 3<>/dev/tcp/127.0.0.1/"$1") 2>/dev/null && return 0 || return 1
  fi
}

case "${1:-start}" in
  stop)
    echo "== 停止监控脚本 =="
    node monitor.js stop 2>&1 | sed 's/^/   /' || true

    echo "== 停止仪表盘 =="
    if [ -f "$PID_DASH" ] && kill -0 "$(cat "$PID_DASH")" 2>/dev/null; then
      kill "$(cat "$PID_DASH")" && echo "   已停止 PID $(cat "$PID_DASH")"
    else
      pkill -f "node web-dashboard.js" 2>/dev/null && echo "   已停止 web-dashboard" || echo "   未在运行"
    fi
    rm -f "$PID_DASH"

    echo "== 停止 Go 代理 =="
    if [ -f "$PID_PROXY" ] && kill -0 "$(cat "$PID_PROXY")" 2>/dev/null; then
      kill "$(cat "$PID_PROXY")" && echo "   已停止 PID $(cat "$PID_PROXY")"
    else
      pkill -f "douyinLive-.*" 2>/dev/null && echo "   已停止 Go 代理" || echo "   未在运行"
    fi
    rm -f "$PID_PROXY"
    echo "完成。"
    ;;

  status)
    echo "== Go 代理 =="
    if port_listening 1088; then
      echo "   1088 监听中"
      curl -s --max-time 3 http://127.0.0.1:1088/health 2>/dev/null | head -c 300; echo
    else
      echo "   1088 未监听"
    fi

    echo "== 监控脚本 =="
    node monitor.js status 2>&1 | sed 's/^/   /' | head -20

    echo "== 仪表盘 =="
    if port_listening 9871; then
      echo "   9871 监听中 → http://127.0.0.1:9871"
    else
      echo "   9871 未监听"
    fi
    ;;

  start|*)
    PROXY_BIN="$(pick_proxy)"
    if [ -z "$PROXY_BIN" ]; then
      echo "!! 没找到 Go 抓取代理二进制。"
      echo "   请把 douyinLive-linux-amd64 放到项目根目录，或设置 DOUYIN_PROXY_BIN 指向它。"
      echo "   下载：https://github.com/jwwsjlm/douyinLive/releases"
      exit 1
    fi

    if [ ! -f runtime-config.json ]; then
      echo "!! 缺少 runtime-config.json（监控房间列表），守护进程会立刻退出。"
      echo "   可在仪表盘「房间管理」里添加房间，或手动创建该文件。"
      exit 1
    fi

    echo "== 1/3 启动 Go 代理 =="
    if port_listening 1088; then
      echo "   1088 已在监听，跳过"
    else
      nohup "$PROXY_BIN" --config proxy-config.yaml --port 1088 --log-level info \
        >> "$LOG_DIR/proxy.log" 2>&1 &
      echo $! > "$PID_PROXY"
      sleep 3
      if port_listening 1088; then
        echo "   已启动 PID $(cat "$PID_PROXY")"
      else
        echo "   启动失败，请看 $LOG_DIR/proxy.log"; tail -n 10 "$LOG_DIR/proxy.log" 2>/dev/null | sed 's/^/   /'
      fi
    fi

    echo "== 2/3 启动监控脚本 =="
    nohup node monitor.js --daemon >> "$LOG_DIR/monitor-stdout.log" 2>&1 &
    sleep 4
    node monitor.js status 2>&1 | sed 's/^/   /' | head -12

    echo "== 3/3 启动仪表盘 =="
    if port_listening 9871; then
      echo "   9871 已在监听，跳过"
    else
      nohup node web-dashboard.js >> "$LOG_DIR/dashboard.log" 2>&1 &
      echo $! > "$PID_DASH"
      sleep 2
      port_listening 9871 && echo "   已启动 PID $(cat "$PID_DASH") → http://127.0.0.1:9871" \
        || { echo "   启动失败，请看 $LOG_DIR/dashboard.log"; tail -n 10 "$LOG_DIR/dashboard.log" | sed 's/^/   /'; }
    fi

    echo
    echo "完成。常用命令："
    echo "  bash start-all.sh status   查看状态"
    echo "  bash start-all.sh stop     全部停止"
    echo "  tail -f logs/daemon.log    跟随监控日志"
    ;;
esac
