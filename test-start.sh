#!/bin/bash
cd /opt/data/douyin-monitor
echo "Starting monitor test..."
timeout 8 node -e "
process.on('uncaughtException', e => { console.error('ERR:'+e.message); process.exit(1); });
process.on('unhandledRejection', e => { console.error('REJ:'+e); process.exit(1); });
require('./monitor.js');
console.error('LOADED');
setTimeout(()=>console.error('ALIVE'), 3000);
" 2>&1
echo "Exit: $?"
