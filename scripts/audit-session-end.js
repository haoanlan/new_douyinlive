/**
 * 场次结束时间体检：找出「end_time 不可信」的场次。
 *
 * 背景：worker 正常路径是收到 ROOM_ENDED 才结束场次，并用自身 end-start 算时长
 * （lib/worker/connection.js:74-90、lib/worker/session.js:249-252）。但历史上有
 * 一部分场次是被重启/清理归档的，`end_time` 记的是**归档时刻**（常见特征：等于
 * 下一场的开始时刻、`duration_seconds = 0`），它们和真实下播时间可能差很多。
 *
 * 判据（任一条命中即标记）：
 *   - duration_seconds 为 0
 *   - end_time 与「同主播下一场的 start_time」相差 < 5 分钟（像是被下一场顶掉的）
 *   - end_time 比该场**最后一条弹幕/礼物**晚超过 30 分钟（结束时间明显虚高）
 *
 * 用法：
 *   node scripts/audit-session-end.js            # 只出清单（只读）
 *   node scripts/audit-session-end.js --json     # 附机器可读输出
 *   node scripts/audit-session-end.js --backfill            # 回填计划（dry-run，不写库）
 *   node scripts/audit-session-end.js --backfill --apply    # 真正写库
 *   node scripts/audit-session-end.js --backup              # 额外全量备份（500MB+，按需）
 *
 * 只回填 `duration_seconds = 0` 的场次：这类是"没有记时长"、end_time 等于下一场
 * 开始时刻的记录。**有正常时长的不要动** —— 实测 #236（时长 240 分、结束 02:08）
 * 是真实的 ROOM_ENDED 下播，它最后一条弹幕在 23:06，后 3 小时只是没人说话，
 * 按弹幕回填会把 4 小时改成 58 分钟。
 * `--apply` 默认只写一份**回滚凭据 JSON**（这几行的原值），不做全量复制。
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const backfill = args.includes('--backfill');
const apply = args.includes('--apply');
/** 额外做一次全量备份（库有 500MB+，默认不做，只写小体积回滚凭据） */
const wantsBackup = args.includes('--backup');
const dbArg = args.find((a) => a.endsWith('.db'));
const dbPath = dbArg || path.join(__dirname, '..', 'db', 'douyin.db');

/** 场次时间（本地时间字符串）→ epoch ms */
function parseLocal(s) {
  if (!s) return null;
  const d = new Date(String(s).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/** epoch ms → "YYYY-MM-DD HH:mm:ss"（本地时间，和 sessions 表口径一致） */
function toLocal(ms) {
  const d = new Date(ms);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function main() {
  if (!fs.existsSync(dbPath)) {
    console.log(`数据库不存在: ${dbPath}`);
    process.exitCode = 1;
    return;
  }
  const d = new Database(dbPath, { readonly: !(backfill && apply) });
  const sessions = d
    .prepare(
      `SELECT s.id, s.streamer_id, s.room_title, s.start_time, s.end_time, s.duration_seconds, s.archived,
              st.name AS streamer_name
         FROM sessions s LEFT JOIN streamers st ON st.id = s.streamer_id
        ORDER BY s.streamer_id, s.start_time`
    )
    .all();

  const lastDanmaku = d.prepare('SELECT MAX(create_time) AS t FROM danmaku WHERE session_id = ?');
  const lastGift = d.prepare('SELECT MAX(create_time) AS t FROM gifts WHERE session_id = ?');
  const countDanmaku = d.prepare('SELECT COUNT(*) AS c FROM danmaku WHERE session_id = ?');

  // 同主播的「下一场开始时间」
  const nextStart = new Map();
  for (let i = 0; i < sessions.length; i++) {
    const cur = sessions[i];
    const next = sessions.find((s, j) => j > i && s.streamer_id === cur.streamer_id);
    nextStart.set(cur.id, next ? next.start_time : null);
  }

  const rows = [];
  for (const s of sessions) {
    const start = parseLocal(s.start_time);
    const end = parseLocal(s.end_time);
    const dm = lastDanmaku.get(s.id)?.t ?? null; // 毫秒时间戳
    const gf = lastGift.get(s.id)?.t ?? null;
    const lastActivity = Math.max(dm || 0, gf || 0) || null;
    const next = nextStart.get(s.id);
    const nextMs = parseLocal(next);

    const flags = [];
    const noDur = !s.duration_seconds;
    const endMatchesNext = Boolean(next && end && nextMs && Math.abs(nextMs - end) < 5 * 60 * 1000);
    let gapMin = null;
    if (end && lastActivity) gapMin = Math.round((end - lastActivity) / 60000);

    /*
     * 判定口径（踩过一次坑，别再用"最后一条弹幕"当通用下播时刻）：
     *
     * 只有 `duration_seconds = 0` 的场次才回填。这类是**没有记时长的**
     * —— 它们是被"同主播下一场开始"顶掉（end_time 因此等于下一场开始时刻），
     * end_time 压根不是下播时刻。
     *
     * 有正常时长的**不要动**：实测 #236 end_time=02:08（时长 240 分），
     * 日志显示那是真实的 `ROOM_ENDED`（logs/daemon.log: 18:08:32Z = 本地 02:08）。
     * 它最后一条弹幕是 23:06 —— 后面 3 小时只是没人说话，若按弹幕回填会把
     * 4 小时改成 58 分钟，反而改错。
     */
    const bigGap = gapMin != null && gapMin > 30;
    const suspect = noDur && gapMin != null && gapMin > 5;
    if (noDur) flags.push('无时长');
    if (bigGap) flags.push(`结束比最后活动晚${gapMin}分`);
    if (endMatchesNext) flags.push(suspect ? '结束≈下一场开始(可疑)' : '正常重开(误差≤5分)');
    if (!lastActivity && !s.end_time) flags.push('未结束');
    if (!lastActivity) flags.push('整场无弹幕/礼物');

    rows.push({
      id: s.id,
      streamer: s.streamer_name || s.room_title || `#${s.streamer_id}`,
      start: s.start_time,
      end: s.end_time,
      durSec: s.duration_seconds || 0,
      danmaku: countDanmaku.get(s.id)?.c ?? 0,
      lastActivity: lastActivity ? toLocal(lastActivity) : null,
      gapMin,
      nextStart: next,
      suggestEnd: lastActivity ? toLocal(lastActivity) : null,
      suggestDurSec: lastActivity && start ? Math.round((lastActivity - start) / 1000) : null,
      suspect,
      endMatchesNext,
      canBackfill: Boolean(lastActivity && start),
      flags
    });
  }

  const needFix = rows.filter((r) => r.suspect && r.canBackfill);
  const noData = rows.filter((r) => r.suspect && !r.canBackfill);
  const ignored = rows.filter((r) => !r.suspect && r.flags.some((f) => f.startsWith('正常重开')));
  const review = rows.filter((r) => !r.suspect && r.durSec > 0 && r.gapMin != null && r.gapMin > 30);

  console.log(`数据库: ${dbPath}`);
  console.log(
    `场次总数: ${rows.length}；需要回填（无时长）: ${needFix.length}；` +
      `可疑但整场无数据: ${noData.length}；正常重开（误差≤5分）: ${ignored.length}；` +
      `有正常时长但结束偏晚（仅列出，不回填）: ${review.length}\n`
  );

  const table = (title, list) => {
    console.log(`${title}`);
    if (!list.length) {
      console.log('  （无）\n');
      return;
    }
    console.log(['id', '主播', '开始', '库里结束', '最后活动', '虚高(分)', '库里时长', '建议时长'].join(' | '));
    for (const r of list) {
      console.log(
        [
          r.id,
          String(r.streamer).slice(0, 10),
          r.start,
          r.end,
          r.lastActivity || '-',
          r.gapMin ?? '-',
          r.durSec ? `${Math.round(r.durSec / 60)}分` : '0',
          r.suspect && r.suggestDurSec ? `${Math.round(r.suggestDurSec / 60)}分` : '（不动）'
        ].join(' | ')
      );
    }
    console.log('');
  };
  table('A. 需要回填（无时长，结束时间=下一场开始时刻）：', needFix.sort((a, b) => (b.gapMin ?? -1) - (a.gapMin ?? -1)));
  table('B. 可疑但整场无弹幕/礼物，无法估算：', noData);
  table('C. 有正常时长、但结束时间比最后活动晚 >30 分（可能是安静的直播间，不回填）：', review);
  if (asJson) {
    console.log('--- JSON ---');
    console.log(JSON.stringify({ total: rows.length, needFix, noData, review, ignored }, null, 1));
  }

  if (backfill) {
    d.pragma('busy_timeout = 5000');
    console.log(`回填计划：${needFix.length} 场（用最后一条弹幕/礼物时间作为下播时刻）`);
    for (const r of needFix) {
      console.log(
        `  #${r.id} ${r.end} → ${r.suggestEnd}；时长 0 → ${Math.round(r.suggestDurSec / 60)} 分`
      );
    }
    if (!needFix.length) {
      console.log('（没有需要回填的场次，未做任何写入）');
    } else if (!apply) {
      console.log('\n（dry-run：没有写库。确认无误后加 --apply 真正执行）');
    } else {
      // 回滚凭据：只记这 4 行的原值（比复制 548MB 的全库合比例），需要时按 JSON 写回
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const revertPath = path.join(path.dirname(dbPath), `session-end-revert-${stamp}.json`);
      fs.writeFileSync(
        revertPath,
        JSON.stringify(
          needFix.map((r) => ({ id: r.id, end_time: r.end, duration_seconds: r.durSec })),
          null,
          1
        )
      );
      console.log(`\n回滚凭据已写入 → ${revertPath}`);

      const upd = d.prepare('UPDATE sessions SET end_time = ?, duration_seconds = ? WHERE id = ?');
      const tx = d.transaction(() => {
        for (const r of needFix) upd.run(r.suggestEnd, r.suggestDurSec, r.id);
      });
      tx();
      console.log(`✅ 已回填 ${needFix.length} 场`);
    }
  }

  /*
   * 全量备份（可选，--backup）。
   * 注意：`db.backup()` 是**异步** API —— 必须 await，否则 close() 会在备份完成前
   * 关掉连接，备份静默失败（只报一句 "The database connection is not open"）。
   * 这是真实踩过的坑，别再改回去。
   */
  if (wantsBackup) {
    const bak = `${dbPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await d.backup(bak);
    console.log(`\n已备份数据库 → ${bak}`);
  }
  d.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
