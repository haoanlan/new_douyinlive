/**
 * 时间格式化工具（东八区）
 *
 * 由 monitor.js 拆分而来（逐字搬运，未改动逻辑）。
 */

// ====== 时区 ======
function cstISO() {
  const now = new Date();
  const cst = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return cst.toISOString().replace('Z', '+08:00');
}

function cstFileTimestamp() {
  const now = new Date();
  const cst = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return cst.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

module.exports = {
  cstISO,
  cstFileTimestamp,
};
