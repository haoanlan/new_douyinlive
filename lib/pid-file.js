/**
 * monitor.pid 的读写与"是否真的还有 worker 在跑"判定
 *
 * 为什么单独抽一个模块：
 *   - 这个文件以前是**裸数字**（`12345`），现在带心跳（JSON：pid/startedAt/heartbeatAt），
 *     于是凡是读它的地方都必须能解析两种格式，否则 `parseInt('{"pid":...}')` = NaN。
 *     实测踩到：lib/routes/status.js 仍按裸数字读 → 状态页的"监控 PID / 残留判定"会失效。
 *   - 只依赖 fs，不引 db/ws，status.js、lifecycle.js、monitor.js 都能安全复用。
 *
 * 心跳的作用（实测教训）：嵌入模式的 worker 写的是**宿主 dashboard 的 PID**，
 * 只靠"PID 是否存活"判断会误判（PID 被复用 / 上次宿主异常退出），
 * 结果是新进程认为"已有 worker"→ 拒绝启动 → 采集静默停止。
 * 活着的 worker 每 5 秒刷新 heartbeatAt；超过 staleMs 没刷新就当作残留。
 */

const fs = require('fs');

/** 进程是否存活（EPERM 表示存在但无权限，也算存活） */
function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/**
 * 解析 PID 文件，返回 { pid, heartbeatAt, startedAt, embedded, legacy } 或 null。
 * 兼容旧的裸数字格式（legacy: true，无心跳）。
 */
function readPidInfo(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf-8').trim();
    if (!raw) return null;
    if (raw.startsWith('{')) {
      const j = JSON.parse(raw);
      const pid = parseInt(j.pid, 10);
      if (!pid) return null;
      return {
        pid,
        heartbeatAt: Number(j.heartbeatAt) || 0,
        startedAt: Number(j.startedAt) || 0,
        embedded: Boolean(j.embedded),
        legacy: false,
      };
    }
    const pid = parseInt(raw, 10);
    return pid ? { pid, heartbeatAt: 0, startedAt: 0, embedded: false, legacy: true } : null;
  } catch (e) {
    return null;
  }
}

/** 写入带心跳的 PID 文件 */
function writePidFile(file, pid, extra = {}) {
  const prev = readPidInfo(file);
  fs.writeFileSync(
    file,
    JSON.stringify({
      pid,
      embedded: true,
      startedAt: prev && prev.pid === pid ? prev.startedAt || Date.now() : Date.now(),
      heartbeatAt: Date.now(),
      ...extra,
    }),
    'utf-8'
  );
}

/** 只更新心跳（顺带校验 pid 没被别人接管） */
function touchPidFile(file, pid) {
  const cur = readPidInfo(file);
  if (cur && cur.pid !== pid) return;
  writePidFile(file, pid);
}

/**
 * 文件是否代表"真的还有 worker 在写库"：
 *   进程活着 **且** 心跳新鲜（< staleMs）才算。
 * 旧的裸数字格式没有心跳信息，保守起见"活着即占用"（宁可拒绝启动也不要双写）。
 */
function isActive(file, staleMs = 45000) {
  const info = readPidInfo(file);
  if (!info) return false;
  if (!isAlive(info.pid)) return false;
  if (info.legacy || !info.heartbeatAt) return true;
  return Date.now() - info.heartbeatAt < staleMs;
}

module.exports = { isAlive, readPidInfo, writePidFile, touchPidFile, isActive };
