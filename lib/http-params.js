/**
 * 查询参数解析工具
 *
 * 起因（审计实测）：多处直接 `parseInt(query.limit)` 然后绑进 SQL ——
 *   1) `?limit=-1`：SQLite 里 LIMIT 为负 = **不限行数**，绕过了接口自己设的上限
 *      （实测 `/danmaku?limit=-1` 会一次拉回整场 464,568 行，而作者加 2000 上限
 *       正是因为"5 万条要 19 秒 / 22MB"）；
 *   2) `?limit=abc` → NaN，better-sqlite3 绑 NaN 直接抛 `datatype mismatch`，
 *      接口返回 500 并把内部错误原文回显给客户端。
 * 统一走这里：非法值不静默当成默认值，而是返回 invalid 让调用方回 400。
 */

/**
 * @param {*} raw 查询参数原值
 * @param {{def?:number, min?:number, max?:number}} opts 默认值/下限/上限
 * @returns {{value:number, invalid:boolean}} invalid=true 表示传了值但解析不出来（应回 400）
 */
function intParam(raw, { def = 0, min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (raw === undefined || raw === null || raw === '') return { value: def, invalid: false };
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return { value: def, invalid: true };
  return { value: Math.min(Math.max(n, min), max), invalid: false };
}

module.exports = { intParam };
