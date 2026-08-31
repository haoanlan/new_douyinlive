#!/bin/bash
cd /opt/data/douyin-monitor
rm -f monitor.pid
node -e "
const fs = require('fs');
const logFile = fs.createWriteStream('/tmp/monitor-test.log');
const origLog = console.log;
const origErr = console.error;
console.log = (...a) => { logFile.write('[LOG] '+a.join(' ')+'\n'); origLog(...a); };
console.error = (...a) => { logFile.write('[ERR] '+a.join(' ')+'\n'); origErr(...a); };
process.on('uncaughtException', e => { logFile.write('[UNCAUGHT] '+e.stack+'\n'); process.exit(1); });
process.on('unhandledRejection', e => { logFile.write('[UNHANDLED] '+e+'\n'); process.exit(1); });
require('./monitor.js');
" &
BGPID=$!
sleep 10
echo "=== LOG ==="
cat /tmp/monitor-test.log 2>/dev/null
echo "=== PID CHECK ==="
kill -0 $BGPID 2>/dev/null && echo "Process $BGPID alive" || echo "Process $BGPID dead"
kill $BGPID 2>/dev/null
