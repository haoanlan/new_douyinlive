/**
 * 配置读写与热加载
 *
 * 由 monitor.js 拆分而来（逐字搬运，未改动逻辑）。
 */
const fs = require('fs');
const path = require('path');
const { CONFIG_FILE } = require('./context');

let _configCache = null;
let _configMtime = 0;

function _loadConfigRaw() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch (e) { /* ignore */ }
  return {
    rooms: [{ id: '72288034336', name: '', enabled: true }],
    room_id: '72288034336',  // 兼容旧配置
    check_interval_seconds: 30,
    reconnect_delay_seconds: 10,
    save_json: false,
    feishu: { open_id: '' },
  };
}

function loadConfig() {
  try {
    const stat = fs.statSync(CONFIG_FILE);
    const mt = stat.mtimeMs;
    if (_configCache && mt === _configMtime) return _configCache;
    _configCache = _loadConfigRaw();
    _configMtime = mt;
  } catch (e) {
    if (!_configCache) _configCache = _loadConfigRaw();
  }
  return _configCache;
}

try {
  fs.watch(CONFIG_FILE, { persistent: false }, () => {
    try {
      _configCache = _loadConfigRaw();
      _configMtime = fs.statSync(CONFIG_FILE).mtimeMs;
      console.log('[config] 配置文件已热加载');
    } catch (e) { /* ignore */ }
  });
} catch (e) { /* fs.watch 可能不支持某些环境 */ }

let _configWriteQueue = Promise.resolve();

function saveConfig(config) {
  _configWriteQueue = _configWriteQueue.then(() => {
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
      _configCache = config;  // 写入后同步缓存
      _configMtime = fs.statSync(CONFIG_FILE).mtimeMs;
    } catch (e) {
      console.error('[config] 写入配置失败:', e.message);
    }
  }).catch(() => {});
  return _configWriteQueue;
}

/** 获取要监控的房间列表 */
function getTargetRooms(config, cliRoomId) {
  // 命令行指定房间
  if (cliRoomId) {
    return [{ id: cliRoomId, name: '', enabled: true }];
  }
  // 新格式：rooms 数组
  if (config.rooms && Array.isArray(config.rooms)) {
    return config.rooms.filter(r => r.enabled !== false);
  }
  // 兼容旧格式：单 room_id
  if (config.room_id) {
    return [{ id: config.room_id, name: '', enabled: true }];
  }
  return [];
}

module.exports = {
  _loadConfigRaw,
  loadConfig,
  saveConfig,
  getTargetRooms,
};
