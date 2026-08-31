#!/bin/bash
cd /opt/data/douyin-monitor
rm -f monitor.pid
# Run WITHOUT --daemon so stdout/stderr are visible, capture to file
node monitor.js > /tmp/monitor-nodaemon.log 2>&1 &
PID=$!
echo "PID=$PID"
sleep 8
echo "=== PROCESS STATUS ==="
kill -0 $PID 2>/dev/null && echo "ALIVE" || echo "DEAD"
echo "=== OUTPUT ==="
cat /tmp/monitor-nodaemon.log
kill $PID 2>/dev/null
