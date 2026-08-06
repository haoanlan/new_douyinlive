#!/bin/bash
cd /opt/data/douyin-monitor
# 先停旧进程
pkill -f "node monitor.js --daemon" 2>/dev/null
pkill -f "node web-dashboard.js" 2>/dev/null
sleep 2
# 用nohup启动
nohup node monitor.js --daemon > /dev/null 2>&1 &
echo "monitor started, pid=$!"
# 启动仪表板
nohup node web-dashboard.js > /dev/null 2>&1 &
echo "dashboard started, pid=$!"
