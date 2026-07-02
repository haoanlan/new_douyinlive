#!/bin/bash
# 直播监控状态检查脚本
# 用法: bash status.sh

DIR="/opt/data/douyin-monitor"
LOG="$DIR/logs/daemon.log"

echo "=== 直播监控状态 ==="
echo ""

# 检查进程
NODE_PID=$(pgrep -f "node monitor.js" | head -1)
GO_PID=$(pgrep -f "douyinLive-linux" | head -1)

if [ -n "$NODE_PID" ]; then
    echo "🏠 守护进程: ✅ 运行中 (PID $NODE_PID)"
else
    echo "🏠 守护进程: ❌ 未运行"
fi

if [ -n "$GO_PID" ]; then
    echo "📡 Go代理: ✅ 运行中 (PID $GO_PID)"
else
    echo "📡 Go代理: ❌ 未运行"
fi

echo ""

# 检查房间状态
echo "=== 监控房间 ==="
if [ -f "$LOG" ]; then
    # 获取最近的心跳日志
    grep "\[heartbeat\]" "$LOG" | tail -4 | while read line; do
        # 提取房间名和状态
        room=$(echo "$line" | grep -oP '\[\K[^\]]+(?=\] \[heartbeat\])')
        status=$(echo "$line" | grep -oP '录制=\K\w+')
        connect=$(echo "$line" | grep -oP '连接=\K\w+')
        danmaku=$(echo "$line" | grep -oP '弹幕=\K\d+')
        gifts=$(echo "$line" | grep -oP '礼物=\K\d+')
        
        if [ "$connect" = "true" ]; then
            if [ "$status" = "true" ]; then
                echo "  🔴 $room - 录制中 (弹幕:$danmaku 礼物:$gifts)"
            else
                echo "  ⏳ $room - 等待开播"
            fi
        else
            echo "  ❌ $room - 未连接"
        fi
    done
else
    echo "  无日志文件"
fi

echo ""

# 检查最近活动
echo "=== 最近活动 ==="
if [ -f "$LOG" ]; then
    tail -3 "$LOG" | while read line; do
        time=$(echo "$line" | grep -oP '^\[\K[^\]]+')
        msg=$(echo "$line" | grep -oP '\] \K.*')
        echo "  $time - $msg"
    done
fi

echo ""
echo "=== 数据库统计 ==="
cd "$DIR" && node -e "
const Database = require('better-sqlite3');
const db = new Database('db/douyin.db');
const sessions = db.prepare('SELECT COUNT(*) as cnt FROM sessions').get();
const gifts = db.prepare('SELECT COUNT(*) as cnt FROM gifts').get();
const danmaku = db.prepare('SELECT COUNT(*) as cnt FROM danmaku').get();
console.log('  会话: ' + sessions.cnt + ' | 弹幕: ' + danmaku.cnt + ' | 礼物: ' + gifts.cnt);
db.close();
" 2>/dev/null || echo "  数据库查询失败"
