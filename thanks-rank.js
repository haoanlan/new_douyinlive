/**
 * 园区充电榜 v13 — 花瓣在 card 内部 + 恢复 3:4
 */
const { chromium } = require('playwright');
const db = require('./db-sqlite.js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { comboDedupGifts } = require('./lib/gift-utils.js');

// 用法: node thanks-rank.js <session_id> [session_id2 ...] [--to "昵称"] [--avatar URL]
const target = (() => {
  const idx = process.argv.indexOf('--to');
  return idx >= 0 ? process.argv[idx + 1] : process.env.THANK_TO || '';
})();
let TARGET_AVATAR = (() => {
  const idx = process.argv.indexOf('--avatar');
  return idx >= 0 ? process.argv[idx + 1] : '';
})();
const sessionIds = process.argv.slice(2).filter(v => /^\d+$/.test(v)).map(Number);
if (!sessionIds.length || !target) { console.error('用法: node thanks-rank.js <session_id> [session_id2 ...] --to "收礼人昵称" [--avatar URL]'); process.exit(1); }
// 模板切换：--theme=<模板名>
//   不传        → 默认模板（DEFAULT_THEME，当前为 depth-glass 高斯模糊版）
//   --theme=classic → 老版暗紫渐变（原默认，行为与历史版本一致）
//   可选模板见下方 MAG_THEME_NAMES；传未知名字会提示并回退默认
const DEFAULT_THEME = 'depth-glass';
const THEME_ARG = (() => {
  const eq = process.argv.find(a => a.startsWith('--theme='));
  if (eq) return eq.slice('--theme='.length);
  const i = process.argv.indexOf('--theme');
  return i >= 0 ? (process.argv[i + 1] || '') : '';
})();

// 背景色场控制：--bg=auto|warm|cool|rose|sage|grey|none
//   微调：--bg-strength=1.5（色场强度，0=无→纯底色） --bg-sat=1.3（饱和度倍数） --bg-blur=1.2（模糊倍数）
const BG_ARG = (() => {
  const eq = process.argv.find(a => a.startsWith('--bg='));
  if (eq) return eq.slice('--bg='.length);
  const i = process.argv.indexOf('--bg');
  return i >= 0 ? (process.argv[i + 1] || 'auto') : 'auto';
})();
const numArg = (name, dflt) => {
  const eq = process.argv.find(a => a.startsWith('--' + name + '='));
  const i = process.argv.indexOf('--' + name);
  const raw = eq ? eq.split('=')[1] : (i >= 0 ? process.argv[i + 1] : undefined);
  const v = Number(raw);
  return Number.isFinite(v) ? v : dflt;
};
const BG_PRESETS = {
  auto: { veil: '242,240,236', sat: 1.30, blur: 1.00, on: true },
  warm: { veil: '245,236,221', sat: 1.20, blur: 1.00, on: true },
  cool: { veil: '231,238,248', sat: 1.05, blur: 1.05, on: true },
  rose: { veil: '247,236,242', sat: 1.20, blur: 1.00, on: true },
  sage: { veil: '235,240,232', sat: 1.05, blur: 1.00, on: true },
  grey: { veil: '240,240,238', sat: 0.22, blur: 1.10, on: true },
  none: { veil: '242,240,236', sat: 1.00, blur: 1.00, on: false },
};
const BG = (() => {
  const p = BG_PRESETS[BG_ARG] || BG_PRESETS.auto;
  if (!BG_PRESETS[BG_ARG] && BG_ARG !== 'auto') console.log(`  ⚠️  未知 --bg=${BG_ARG}，可用：${Object.keys(BG_PRESETS).join(' | ')}（按 auto 处理）`);
  return { name: BG_ARG, on: p.on, veil: p.veil, sat: +(p.sat * numArg('bg-sat', 1)).toFixed(3),
           blur: +(p.blur * numArg('bg-blur', 1)).toFixed(3), strength: numArg('bg-strength', 1) };
})();
const outputDir = path.join(__dirname, 'reports');
let HEADER_DATE = 'Session ' + sessionIds.join('-');  // 动态计算

const DARK_TOKENS = {
  textPrimary:'rgba(255,255,255,0.9)', textSecondary:'rgba(255,255,255,0.85)', textTertiary:'rgba(255,255,255,0.5)', textMuted:'rgba(255,255,255,0.35)',
  divider:'rgba(255,255,255,0.04)', dividerSection:'rgba(255,255,255,0.03)', dividerHeader:'rgba(255,255,255,0.06)',
  cardBg:'rgba(255,255,255,0.07)', cardBorder:'rgba(255,255,255,0.10)', boxShadow:'0 25px 60px rgba(0,0,0,0.5)',
  badgeFill:'rgba(255,255,255,0.06)', badgeStroke:'rgba(255,255,255,0.15)', badgeTextMuted:'rgba(255,255,255,0.5)',
  top3Colors:['#FFE44D','#C8C8FF','#E8A060'],
  top3Borders:['rgba(255,215,0,0.3)','rgba(200,200,255,0.25)','rgba(232,160,96,0.25)'],
  top3Bgs:['linear-gradient(135deg,rgba(255,215,0,0.15),rgba(255,200,0,0.05))','linear-gradient(135deg,rgba(200,200,255,0.12),rgba(200,200,255,0.03))','linear-gradient(135deg,rgba(232,160,96,0.12),rgba(232,160,96,0.03))'],
  headerTitle:'#fff', headerDate:'rgba(255,255,255,0.35)', sectionTitle:'rgba(255,255,255,0.5)', subsectionLabel:'rgba(255,255,255,0.4)',
  footerText:'rgba(255,255,255,0.3)', top3Name:'#fff', rowText:'rgba(255,255,255,0.85)',
  avatarFallbackBg:'rgba(255,255,255,0.08)', avatarFallbackColor:'rgba(255,255,255,0.4)',
};
const LIGHT_TOKENS = {
  textPrimary:'#2D1525', textSecondary:'rgba(45,21,37,0.8)', textTertiary:'rgba(45,21,37,0.5)', textMuted:'rgba(45,21,37,0.35)',
  divider:'rgba(45,21,37,0.08)', dividerSection:'rgba(45,21,37,0.05)', dividerHeader:'rgba(45,21,37,0.08)',
  cardBg:'rgba(255,255,255,0.35)', cardBorder:'rgba(45,21,37,0.08)', boxShadow:'0 25px 60px rgba(0,0,0,0.1)',
  badgeFill:'rgba(45,21,37,0.06)', badgeStroke:'rgba(45,21,37,0.15)', badgeTextMuted:'rgba(45,21,37,0.35)',
  top3Colors:['#8B6914','#5B4B6B','#7B4123'],
  top3Borders:['rgba(139,105,20,0.25)','rgba(91,75,107,0.2)','rgba(123,65,35,0.2)'],
  top3Bgs:['linear-gradient(135deg,rgba(255,215,0,0.1),rgba(255,200,0,0.03))','linear-gradient(135deg,rgba(200,200,255,0.08),rgba(200,200,255,0.02))','linear-gradient(135deg,rgba(232,160,96,0.08),rgba(232,160,96,0.02))'],
  headerTitle:'#2D1525', headerDate:'rgba(45,21,37,0.4)', sectionTitle:'rgba(45,21,37,0.5)', subsectionLabel:'rgba(45,21,37,0.4)',
  footerText:'rgba(45,21,37,0.3)', top3Name:'#2D1525', rowText:'rgba(45,21,37,0.8)',
  avatarFallbackBg:'rgba(45,21,37,0.08)', avatarFallbackColor:'rgba(45,21,37,0.4)',
};

// ==== 花瓣 SVG 装饰（用 data URI，放 card 内避免 clip 问题）====
const PETALS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 800">
  <g fill="#FF85A2">
    <circle cx="40" cy="60" r="6" opacity="0.5"/><circle cx="500" cy="40" r="5" opacity="0.4"/>
    <circle cx="20" cy="300" r="7" opacity="0.4"/><circle cx="520" cy="250" r="5" opacity="0.35"/>
    <circle cx="60" cy="550" r="6" opacity="0.45"/><circle cx="490" cy="600" r="5" opacity="0.4"/>
    <circle cx="30" cy="750" r="7" opacity="0.4"/><circle cx="510" cy="780" r="5" opacity="0.35"/>
    <circle cx="270" cy="20" r="4" opacity="0.4"/><circle cx="300" cy="400" r="5" opacity="0.35"/>
    <circle cx="150" cy="200" r="4" opacity="0.35"/><circle cx="420" cy="350" r="4" opacity="0.3"/>
    <circle cx="480" cy="500" r="4" opacity="0.35"/><circle cx="80" cy="420" r="4" opacity="0.3"/>
  </g>
  <g fill="#F8A5C2" opacity="0.5">
    <ellipse cx="80" cy="120" rx="9" ry="4" transform="rotate(-25 80 120)"/>
    <ellipse cx="460" cy="100" rx="8" ry="4" transform="rotate(30 460 100)"/>
    <ellipse cx="30" cy="400" rx="8" ry="4" transform="rotate(-40 30 400)"/>
    <ellipse cx="510" cy="450" rx="9" ry="4" transform="rotate(20 510 450)"/>
    <ellipse cx="180" cy="680" rx="7" ry="3" transform="rotate(-15 180 680)"/>
    <ellipse cx="350" cy="700" rx="8" ry="4" transform="rotate(35 350 700)"/>
    <ellipse cx="300" cy="150" rx="8" ry="4" transform="rotate(-10 300 150)"/>
    <ellipse cx="250" cy="550" rx="7" ry="3" transform="rotate(25 250 550)"/>
  </g>
  <g fill="#FFB8D0" opacity="0.45">
    <ellipse cx="130" cy="350" rx="7" ry="3" transform="rotate(45 130 350)"/>
    <ellipse cx="380" cy="220" rx="7" ry="3" transform="rotate(-30 380 220)"/>
    <ellipse cx="70" cy="280" rx="6" ry="3" transform="rotate(55 70 280)"/>
    <ellipse cx="470" cy="680" rx="7" ry="3" transform="rotate(-20 470 680)"/>
    <ellipse cx="220" cy="500" rx="8" ry="4" transform="rotate(15 220 500)"/>
    <ellipse cx="160" cy="620" rx="6" ry="3" transform="rotate(-35 160 620)"/>
  </g>
</svg>`;

const petalsB64 = Buffer.from(PETALS_SVG.replace(/\n\s*/g,' ')).toString('base64');

// Petals overlay INSIDE the card (absolute positioned, z-index 0, opacity low)
const FLOWER_PETALS = `<img src="data:image/svg+xml;base64,${petalsB64}" style="position:absolute;top:0;left:0;width:100%;height:100%;opacity:0.18;pointer-events:none;z-index:0;object-fit:cover" />`;

const DECORATIONS = { blue:'', pink:FLOWER_PETALS, red:'', gold:'', green:'' };

const THEMES = {
  blue:  { name:'暗蓝', bg:'linear-gradient(135deg,#1a0a2e 0%,#16213e 50%,#0f3460 100%)', pattern1:'rgba(108,99,255,0.08)', pattern2:'rgba(255,107,157,0.06)', headerTint:'rgba(255,107,157,0.06)', badgeText:'#1a0a2e', avatarRing:'linear-gradient(135deg,#FF6B9D66,#FFD93D66)', decor:DECORATIONS.blue, ...DARK_TOKENS },
  pink:  { name:'粉色', bg:'linear-gradient(135deg,#FDDDE5 0%,#F6BEC8 35%,#EBAAB8 100%)', pattern1:'rgba(255,255,255,0.25)', pattern2:'rgba(246,190,200,0.15)', headerTint:'rgba(255,255,255,0.15)', badgeText:'#B88090', avatarRing:'linear-gradient(135deg,rgba(255,255,255,0.5),rgba(255,255,255,0.3))', decor:DECORATIONS.pink, ...LIGHT_TOKENS },
  red:   { name:'红色', bg:'linear-gradient(135deg,#2e1a1a 0%,#3e1a1a 25%,#2a0f0f 100%)', pattern1:'rgba(255,80,80,0.10)', pattern2:'rgba(255,150,100,0.06)', headerTint:'rgba(255,80,80,0.08)', badgeText:'#2e1a1a', avatarRing:'linear-gradient(135deg,#FF6B9D66,#FFD93D66)', decor:DECORATIONS.red, ...DARK_TOKENS },
  gold:  { name:'金色', bg:'linear-gradient(135deg,#2e2a1a 0%,#3e2e1a 25%,#2a1a0f 100%)', pattern1:'rgba(255,215,0,0.10)', pattern2:'rgba(255,180,50,0.06)', headerTint:'rgba(255,215,0,0.08)', badgeText:'#2e2a1a', avatarRing:'linear-gradient(135deg,#FFD93D66,#FFD70066)', decor:DECORATIONS.gold, ...DARK_TOKENS },
  green: { name:'绿色', bg:'linear-gradient(135deg,#1a2e1a 0%,#1a3e1a 25%,#0f2a0f 100%)', pattern1:'rgba(80,255,120,0.08)', pattern2:'rgba(100,200,150,0.06)', headerTint:'rgba(80,255,120,0.06)', badgeText:'#1a2e1a', avatarRing:'linear-gradient(135deg,#6BFF9D66,#6BFF9D66)', decor:DECORATIONS.green, ...DARK_TOKENS },
};
const activeTheme = THEMES.blue;

async function getData(){
  // 与仪表盘详情页同一套连击去重（lib/gift-utils）；多场次时各场分别去重后再合并
  const database = db.getDb();
  const ph = sessionIds.map(() => '?').join(',');
  const raw = database.prepare(`SELECT * FROM gifts WHERE session_id IN (${ph}) AND to_nickname LIKE ? ORDER BY create_time ASC`).all(...sessionIds, '%' + target + '%');
  const bySession = {};
  for (const g of raw) { (bySession[g.session_id] = bySession[g.session_id] || []).push(g); }
  const deduped = [];
  for (const sid of Object.keys(bySession)) deduped.push(...comboDedupGifts(bySession[sid]));
  const userMap = {};
  for (const g of deduped) {
    const k = g.user_display_id || g.nickname;
    if (!userMap[k]) userMap[k] = { nickname: g.nickname, displayId: g.user_display_id || '', avatar: g.avatar || '', diamonds: 0, gifts: 0 };
    userMap[k].diamonds += g.total_diamonds;
    userMap[k].gifts = (userMap[k].gifts || 0) + 1;
    if (g.nickname) userMap[k].nickname = g.nickname;
    if (g.avatar) userMap[k].avatar = g.avatar;
  }
  return Object.values(userMap).sort((a, b) => b.diamonds - a.diamonds).slice(0, 100);
}
function fmtD(n){return (Number(n)||0).toLocaleString('en-US');}
function cleanDisplayName(name){if(!name)return name;const r=[];let i=0;while(i<name.length){const c=name.codePointAt(i);const l=c>0xFFFF?2:1;if(c>=0x1D400&&c<=0x1D7FF){const b=c-0x1D400;const idx=b%52;if(idx<26)r.push(String.fromCharCode(65+idx));else r.push(String.fromCharCode(97+idx-26));}else if(false){}else{r.push(String.fromCodePoint(c));}i+=l;}const s=r.join('');return s||name;}
function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function rankBadge(i){const t=activeTheme;if(i===0)return`<svg viewBox="0 0 24 24" width="18" height="18" style="vertical-align:middle"><circle cx="12" cy="12" r="11" fill="#FFD700"/><text x="12" y="17" text-anchor="middle" font-size="14" font-weight="bold" fill="${t.badgeText}">1</text></svg>`;if(i===1)return`<svg viewBox="0 0 24 24" width="18" height="18" style="vertical-align:middle"><circle cx="12" cy="12" r="11" fill="#C0C0C0"/><text x="12" y="17" text-anchor="middle" font-size="14" font-weight="bold" fill="${t.badgeText}">2</text></svg>`;if(i===2)return`<svg viewBox="0 0 24 24" width="18" height="18" style="vertical-align:middle"><circle cx="12" cy="12" r="11" fill="#CD7F32"/><text x="12" y="17" text-anchor="middle" font-size="14" font-weight="bold" fill="#fff">3</text></svg>`;const n=i+1;return`<svg viewBox="0 0 24 24" width="18" height="18" style="vertical-align:middle"><circle cx="12" cy="12" r="10" fill="${t.badgeFill}" stroke="${t.badgeStroke}" stroke-width="1"/><text x="12" y="16" text-anchor="middle" font-size="12" font-weight="bold" fill="${t.badgeTextMuted}">${n}</text></svg>`;}
function avatarImg(url,size,extra){const t=activeTheme;const ph=`<span style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:50%;background:${t.avatarFallbackBg};color:${t.avatarFallbackColor};font-size:${Math.round(size*0.45)}px;flex-shrink:0;vertical-align:middle;margin-right:8px;${extra||''}">?</span>`;if(!url)return ph;let u=url.startsWith('//')?'https:'+url:url;const id='av'+Math.random().toString(36).slice(2,8);return`<span id="${id}" style="display:inline-block;vertical-align:middle;margin-right:8px;flex-shrink:0;${extra||''}"><img src="${u}" width="${size}" height="${size}" style="display:block;border-radius:50%;object-fit:cover" /></span>`;}

function genTop10HTML(users,pageLabel){const t=activeTheme;const top3=users.slice(0,3);const rest=users.slice(3);const top3Cards=top3.map((u,idx)=>`<div style="display:flex;align-items:center;gap:14px;background:${t.top3Bgs[idx]};border:1px solid ${t.top3Borders[idx]};border-radius:16px;padding:14px 18px;margin-bottom:8px"><div style="width:48px;height:48px;border-radius:50%;background:${t.badgeFill};display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden">${!u.avatar?`<span style="display:inline-block;width:44px;height:44px;border-radius:50%;background:${t.avatarFallbackBg}">`:''}${!u.avatar?'</span>':`<img src="${u.avatar.startsWith('//')?'https:'+u.avatar:u.avatar}" width="44" height="44" style="display:block;border-radius:50%;object-fit:cover;width:44px;height:44px" />`}</div><div style="flex:1;min-width:0"><div style="font-size:17px;font-weight:800;color:${t.top3Name};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(cleanDisplayName(u.nickname||'未知'))}</div></div><div style="text-align:right;flex-shrink:0;display:flex;align-items:${colAlign}">${rankBadge(idx)}</div></div>`).join('\n');const restRows=rest.map(u=>`<tr><td class="rank">${rankBadge(u._rank-1)}</td><td class="name"><span class="name-wrap">${avatarImg(u.avatar,22)}<span class="name-text to-text" title="${esc(cleanDisplayName(u.nickname||'未知'))}">${esc(cleanDisplayName(u.nickname||'未知'))}</span></span></td></tr>`).join('\n');
return`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><style>@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;600;700;800;900&display=swap');*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Noto Sans SC',-apple-system,BlinkMacSystemFont,sans-serif;background:${t.bg};min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px;position:relative}.bg-pattern{position:fixed;top:0;left:0;width:100%;height:100%;background-image:radial-gradient(circle at 20% 30%,${t.pattern1} 0%,transparent 50%),radial-gradient(circle at 80% 70%,${t.pattern2} 0%,transparent 50%);pointer-events:none}.card{width:540px;max-width:100%;background:${t.cardBg};backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid ${t.cardBorder};border-radius:24px;padding:0;box-shadow:${t.boxShadow};overflow:hidden;position:relative;z-index:2}${t.decor?`.card::after{content:'';position:absolute;top:0;left:0;width:100%;height:100%;background-image:url(data:image/svg+xml;base64,${petalsB64});background-size:cover;opacity:0.18;pointer-events:none;z-index:0}`:''}table{width:100%;border-collapse:collapse;table-layout:fixed}tr{border-bottom:1px solid ${t.divider};height:38px}tr:last-child{border-bottom:none}td{padding:0 6px;font-size:15px;color:${t.rowText};vertical-align:middle!important;line-height:1.55}td.rank{width:34px;text-align:center;font-size:15px;font-weight:600;vertical-align:middle!important;line-height:1}td.name{white-space:nowrap;overflow:hidden;font-weight:700;display:flex;align-items:center;height:38px}.name-wrap{display:contents}.name-text{vertical-align:middle;overflow:hidden;text-overflow:ellipsis;display:inline-block}.to-text{max-width:400px}.footer{text-align:center;padding:10px 24px 14px;font-size:10px;color:${t.footerText};letter-spacing:0.5px}</style></head><body><div class="bg-pattern"></div><div class="card" style="padding:0!important"><div style="display:flex;align-items:center;gap:14px;padding:16px 20px;background:linear-gradient(180deg,${t.headerTint} 0%,transparent 100%);border-bottom:1px solid ${t.dividerHeader}"><div style="width:44px;height:44px;border-radius:50%;background:${t.avatarRing};display:flex;align-items:center;justify-content:center;flex-shrink:0"><img src="${TARGET_AVATAR}" style="width:40px;height:40px;border-radius:50%;object-fit:cover"/></div><div style="flex:1;min-width:0"><div style="font-size:18px;font-weight:700;color:${t.headerTitle};line-height:1.3">${esc(target)}</div><div style="font-size:12px;color:${t.headerDate};margin-top:4px">${HEADER_DATE}</div></div><div style="text-align:right;flex-shrink:0"><div style="font-size:15px;font-weight:800;color:${t.textSecondary};letter-spacing:0.5px">🔋 园区充电榜</div></div></div><div style="font-size:13px;font-weight:700;color:${t.sectionTitle};padding:14px 24px 6px;letter-spacing:0.5px;border-bottom:1px solid ${t.dividerSection}">🔋 园区充电榜 · ${pageLabel}</div><div style="padding:14px 24px 32px">${top3Cards}${rest.length>0?`<div style="font-size:12px;font-weight:700;color:${t.subsectionLabel};margin:12px 0 6px;letter-spacing:0.5px">🏅 第4-10名</div><table>${restRows}</table>`:''}</div><div class="footer">由 404 · 抖音直播监控 生成</div></div></body></html>`;}

function makeRowHTML(entries){return entries.map(([rankIdx,s])=>{const isTop3=rankIdx<3;const top3cls=isTop3?` class="row-top3 row-${['1st','2nd','3rd'][rankIdx]}"`:'';return`<tr${top3cls}><td class="rank">${rankBadge(rankIdx)}</td><td class="name"><span class="name-wrap">${avatarImg(s.avatar,22)}<span class="name-text to-text" title="${esc(cleanDisplayName(s.name))}">${esc(cleanDisplayName(s.name))}</span></span></td></tr>`;}).join('');}

function genHTML(users,pageLabel){const t=activeTheme;const perCol=Math.ceil(users.length/2);const left=users.slice(0,perCol).map(u=>[u._rank-1,{name:u.nickname,avatar:u.avatar}]);const right=users.slice(perCol).map(u=>[u._rank-1,{name:u.nickname,avatar:u.avatar}]);
return`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><style>@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;600;700;800;900&display=swap');*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Noto Sans SC',-apple-system,BlinkMacSystemFont,sans-serif;background:${t.bg};min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px;position:relative}.bg-pattern{position:fixed;top:0;left:0;width:100%;height:100%;background-image:radial-gradient(circle at 20% 30%,${t.pattern1} 0%,transparent 50%),radial-gradient(circle at 80% 70%,${t.pattern2} 0%,transparent 50%);pointer-events:none}.card{width:540px;max-width:100%;background:${t.cardBg};backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid ${t.cardBorder};border-radius:24px;padding:0;box-shadow:${t.boxShadow};overflow:visible;position:relative;z-index:2}${t.decor?`.card::after{content:'';position:absolute;top:0;left:0;width:100%;height:100%;background-image:url(data:image/svg+xml;base64,${petalsB64});background-size:cover;opacity:0.18;pointer-events:none;z-index:0}`:''}table{width:100%;border-collapse:collapse;table-layout:fixed}tr{border-bottom:1px solid ${t.divider};height:38px}tr:last-child{border-bottom:none}td{padding:0 6px;font-size:15px;color:${t.rowText};vertical-align:middle!important;line-height:1.55}td.rank{width:34px;text-align:center;font-size:15px;font-weight:600;vertical-align:middle!important;line-height:1}.row-1st td.name{color:${t.top3Colors[0]}}.row-2nd td.name{color:${t.top3Colors[1]}}.row-3rd td.name{color:${t.top3Colors[2]}}.row-top3 td{padding:6px 4px;color:${t.top3Name}}td.name{white-space:nowrap;overflow:hidden;font-weight:700;vertical-align:middle!important}.name-wrap{display:inline-flex;align-items:center;gap:4px;height:100%}.name-text{vertical-align:middle;overflow:hidden;text-overflow:ellipsis;display:inline-block}.to-text{max-width:180px}.ranking-grid{display:grid;gap:10px;padding:0}.ranking-col td{padding:0 4px;font-size:15px;vertical-align:middle!important;height:38px}.ranking-col td.rank{width:30px;font-size:15px;vertical-align:middle!important;text-align:center;line-height:1}.ranking-col td.name{white-space:nowrap;overflow:hidden;font-size:15px;display:flex;align-items:center}.ranking-col td.name .name-wrap{display:contents}.ranking-col .name-text{overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}.ranking-col .row-top3 td{padding:0 4px}.footer{text-align:center;padding:10px 24px 14px;font-size:10px;color:${t.footerText};letter-spacing:0.5px}</style></head><body><div class="bg-pattern"></div><div class="card" style="padding:0!important"><div style="display:flex;align-items:center;gap:14px;padding:16px 20px;background:linear-gradient(180deg,${t.headerTint} 0%,transparent 100%);border-bottom:1px solid ${t.dividerHeader}"><div style="width:44px;height:44px;border-radius:50%;background:${t.avatarRing};display:flex;align-items:center;justify-content:center;flex-shrink:0"><img src="${TARGET_AVATAR}" style="width:40px;height:40px;border-radius:50%;object-fit:cover"/></div><div style="flex:1;min-width:0"><div style="font-size:18px;font-weight:700;color:${t.headerTitle};line-height:1.3">${esc(target)}</div><div style="font-size:12px;color:${t.headerDate};margin-top:4px">${HEADER_DATE}</div></div><div style="text-align:right;flex-shrink:0"><div style="font-size:15px;font-weight:800;color:${t.textSecondary};letter-spacing:0.5px">🔋 园区充电榜</div></div></div><div style="font-size:13px;font-weight:700;color:${t.sectionTitle};padding:14px 24px 6px;letter-spacing:0.5px;border-bottom:1px solid ${t.dividerSection}">🔋 园区充电榜 · ${pageLabel}</div><div style="padding:6px 24px 14px"><div class="ranking-grid" style="grid-template-columns:1fr 1fr;gap:10px"><div class="ranking-col"><table style="width:100%;table-layout:fixed"><tbody>${makeRowHTML(left)}</tbody></table></div><div class="ranking-col"><table style="width:100%;table-layout:fixed"><tbody>${makeRowHTML(right)}</tbody></table></div></div></div><div class="footer">由 404 · 抖音直播监控 生成</div></div></body></html>`;}

// ==================== 杂志编辑风模板（magazine-v1/v2/v3）====================
// 设计语言：浅色纸面 + 中文衬线 + 细线做结构；无卡片/无阴影/无渐变/无 emoji/无装饰英文
// 强调色绛红 #8A2B2B，每套模板只用在一处（v1=第1名、v2=收礼总额、v3=刊头短线）
const MAG = {
  paper: '#FAFAF8', ink: '#1A1A1E',
  inkSoft: 'rgba(26,26,30,0.62)', inkFaint: 'rgba(26,26,30,0.30)',
  rule: 'rgba(26,26,30,0.20)', ruleLight: 'rgba(26,26,30,0.09)',
  accent: '#8A2B2B',
  serif: "'Noto Serif SC','Songti SC',serif",
};
const MAG_THEME_NAMES = ['magazine-v1', 'magazine-v2', 'noir', 'typegrid', 'cute', 'news', 'energy', 'cute-journal', 'cute-candy', 'cute-story', 'cute-chibi', 'ghost', 'faces', 'ruler', 'monolith', 'chroma-bar', 'chroma-tile', 'chroma-refined', 'chroma-photo', 'depth-glass', 'depth-stack'];
const IS_CLASSIC = THEME_ARG === 'classic';
if (THEME_ARG && !IS_CLASSIC && !MAG_THEME_NAMES.includes(THEME_ARG)) {
  console.warn(`⚠️  未知模板 "${THEME_ARG}" → 回退默认 ${DEFAULT_THEME}（可选：${MAG_THEME_NAMES.join(' / ')} / classic）`);
}
if (IS_CLASSIC) console.log('📐 模板 classic（老版暗紫渐变）');
const MAG_VARIANT = IS_CLASSIC ? null : (MAG_THEME_NAMES.includes(THEME_ARG) ? THEME_ARG : DEFAULT_THEME);
// 是否显示钻石数：提名榜（thanks-rank.js）不显示，钻石榜显示
const MAG_AMOUNT = false;
const MAG2_ROW_RULE = '1px dotted rgba(26,26,30,0.16)';
const MAG2_PAPER_CSS = `
.page{position:relative}
.page::before{content:'';position:absolute;inset:0;z-index:3;pointer-events:none;opacity:.45;
  background-image:url("data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20width%3D%27180%27%20height%3D%27180%27%3E%3Cfilter%20id%3D%27g%27%3E%3CfeTurbulence%20type%3D%27fractalNoise%27%20baseFrequency%3D%270.85%27%20numOctaves%3D%272%27%20stitchTiles%3D%27stitch%27%2F%3E%3CfeColorMatrix%20type%3D%27saturate%27%20values%3D%270%27%2F%3E%3C%2Ffilter%3E%3Crect%20width%3D%27180%27%20height%3D%27180%27%20filter%3D%27url%28%23g%29%27%20opacity%3D%270.5%27%2F%3E%3C%2Fsvg%3E"),repeating-linear-gradient(0deg,rgba(26,26,30,.020) 0 1px,rgba(26,26,30,0) 1px 4px);}
.page::after{content:'';position:absolute;inset:0;z-index:4;pointer-events:none;
  background:radial-gradient(ellipse 82% 66% at 50% 42%,rgba(26,26,30,0) 54%,rgba(26,26,30,.055) 100%);}
`;

/**
 * Chromium 可执行文件定位 —— 复用 lib/browser-path.js（与 report-image.js 同一套）。
 *
 * 原来这里自己写死 Linux 路径 /opt/hermes/.playwright，Windows 上返回 undefined，
 * 而本机没执行过 `npx playwright install`，于是直接报
 * "Please run the following command to download new browsers"。
 * 项目里 lib/browser-path.js 已经解决了同样的问题（它就是为了 report-image.js
 * 在 Windows 上 500 才写的）：环境变量 → 系统 Chrome/Edge → 服务器约定路径 → null。
 * 这里改为调用它，避免两套实现各自漂移。
 */
function chromiumExe() {
  // 额外的私有用环境变量（本项目脚本约定）
  if (process.env.DY_CHROMIUM && fs.existsSync(process.env.DY_CHROMIUM)) return process.env.DY_CHROMIUM;
  try {
    return require('./lib/browser-path.js').resolveChromium() || undefined;
  } catch (e) {
    console.warn('[thanks-rank] 载入 lib/browser-path.js 失败，交给 playwright 自行解析：', e.message);
    return undefined;
  }
}

const MAG_BASE_CSS = `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${MAG.paper};color:${MAG.ink};font-family:${MAG.serif};-webkit-font-smoothing:antialiased}
.page{width:540px;height:720px;display:flex;flex-direction:column;padding:44px 40px 32px}
.masthead{font-size:22px;font-weight:500;letter-spacing:5px;line-height:1}
.meta{font-size:10.5px;letter-spacing:1px;color:${MAG.inkFaint}}
.nm{font-size:15px;line-height:1.25}
.amt{font-size:14px;font-variant-numeric:tabular-nums}
.av{border-radius:50%;object-fit:cover;vertical-align:middle;flex-shrink:0}
.rule{height:1px;background:${MAG.rule}}
.rowrule{border-bottom:1px solid ${MAG.ruleLight}}
.num{font-variant-numeric:tabular-nums;font-weight:300;line-height:1}`;

function magFontLink() {
  return `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@300;400;500;600;700&display=swap">`;
}
function magAvatar(url, size) {
  if (!url) return `<span class="av" style="width:${size}px;height:${size}px;display:block;background:${MAG.ruleLight}"></span>`;
  const u = url.startsWith('//') ? 'https:' + url : url;
  return `<img class="av" src="${u}" style="width:${size}px;height:${size}px;display:block" />`;
}
function magName(u) { return esc(cleanDisplayName(u.nickname || '未知')); }
function magDoc(title, css, body) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${magFontLink()}<title>${esc(title)}</title><style>${MAG_BASE_CSS}${css}</style></head><body>${body}</body></html>`;
}
function magTotalText(meta) {
  return meta.capped ? 'TOP 100 合计' : '收礼合计';
}
function magTotal(users) {
  return users.reduce((a, u) => a + (Number(u.diamonds) || 0), 0);
}

/** v1 刊物榜 · TOP 页：刊头 + 收礼人 + 单栏到底的名次表，超大细体序号 */
function magTopV1(users, meta) {
  const A = MAG_AMOUNT;
  const rows = users.map((u, i) => {
    const lead = i === 0;
    return `<div class="rowrule" style="display:flex;align-items:center;height:${A ? 48 : 56}px">
      <div class="num" style="width:58px;font-size:${lead ? (A ? 30 : 34) : (A ? 23 : 27)}px;color:${lead ? MAG.accent : MAG.inkFaint}">${String(i + 1).padStart(2, '0')}</div>
      <div style="flex:1;min-width:0;display:flex;align-items:center;gap:12px">${magAvatar(u.avatar, A ? 26 : 34)}<span class="nm" style="font-size:${A ? 15 : 17}px;font-weight:${lead ? 600 : 400};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${magName(u)}</span></div>
      ${A ? `<div class="amt" style="font-weight:${lead ? 600 : 400};color:${lead ? MAG.accent : MAG.ink}">${fmtD(u.diamonds)}</div>` : ''}
    </div>`;
  }).join('');
  return magDoc('园区充电榜', '', `<div class="page">
    <div style="display:flex;justify-content:space-between;align-items:baseline">
      <div class="masthead">园区充电榜</div>
      <div class="meta">${esc(meta.dateStr)} · ${esc(meta.sessionStr)}</div>
    </div>
    <div class="rule" style="margin:13px 0 0"></div>
    <div style="display:flex;align-items:center;gap:12px;margin:18px 0 8px">
      ${magAvatar(meta.avatar, 42)}
      <div style="flex:1;min-width:0">
        <div style="font-size:19px;font-weight:500;line-height:1.2">${esc(meta.target)}</div>
        <div class="meta" style="margin-top:3px">共 ${meta.gifters} 位送礼人</div>
      </div>
      ${A ? `<div style="text-align:right"><div class="amt" style="font-size:19px;font-weight:600">${fmtD(meta.total)}</div><div class="meta" style="margin-top:3px">${magTotalText(meta)}</div></div>` : ''}
    </div>
    <div class="rule"></div>
    <div style="flex:1;display:flex;flex-direction:column;justify-content:space-evenly">${rows}</div>
  </div>`);
}

/** v2 封面特写 · TOP 页：冠军独占上半幅，2-10 名双栏在下 */
function magTopV2(users, meta) {
  const A = MAG_AMOUNT;
  const top = users.slice(0, 10);
  const half = Math.ceil(top.length / 2);
  const rowH = A ? 44 : 48;
  const row = (u, rank) => `
    <div style="display:flex;align-items:center;height:${rowH}px;gap:9px;border-bottom:${MAG2_ROW_RULE}">
      <span class="num" style="width:20px;font-size:${rank === 1 ? 13 : 12}px;color:${rank === 1 ? MAG.ink : MAG.inkFaint}">${rank}</span>
      ${magAvatar(u.avatar, rank === 1 ? (A ? 28 : 30) : (A ? 20 : 24))}
      <span style="flex:1;min-width:0;font-size:${rank === 1 ? (A ? 15 : 16) : (A ? 13.5 : 14.5)}px;font-weight:${rank === 1 ? 600 : 400};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${magName(u)}</span>
      ${A ? `<span class="amt" style="font-size:12.5px;flex-shrink:0;margin-left:8px;font-weight:${rank === 1 ? 600 : 400}">${fmtD(u.diamonds)}</span>` : ''}
    </div>`;
  // 两栏行数不等时（TOP 不足 10 人），把短的一栏垂直居中，避免底边参差
  const col = (arr, startRank) => {
    const gap = (half - arr.length) * rowH / 2;
    return `<div style="flex:1;min-width:0;padding-top:${gap > 0 ? gap : 0}px">${arr.map((u, i) => row(u, startRank + i)).join('')}</div>`;
  };
  return magDoc('园区充电榜', MAG2_PAPER_CSS, `<div class="page" style="padding:42px 40px 30px;justify-content:space-between">
    <div>
      <div style="text-align:center"><span class="masthead" style="letter-spacing:7px;font-size:17px">园区充电榜</span></div>
      <div style="height:1px;background:rgba(26,26,30,0.24);margin-top:14px"></div>
      <div style="height:1px;background:rgba(26,26,30,0.075);margin-top:4px"></div>
    </div>
    <div style="text-align:center">
      <div style="display:flex;justify-content:center">${magAvatar(meta.avatar, 84)}</div>
      <div style="font-size:18px;font-weight:500;margin-top:15px">${esc(meta.target)}</div>
      ${A
        ? `<div class="meta" style="margin-top:11px">${magTotalText(meta)}</div>
      <div style="font-size:38px;font-weight:300;letter-spacing:2px;color:${MAG.accent};margin-top:5px;font-variant-numeric:tabular-nums;line-height:1">${fmtD(meta.total)}</div>
      <div class="meta" style="margin-top:10px">共 ${meta.gifters} 位送礼人 · ${esc(meta.sessionStr)}</div>`
        : `<div style="font-size:48px;font-weight:300;color:${MAG.accent};margin-top:12px;font-variant-numeric:tabular-nums;line-height:1">${meta.gifters}</div>
      <div class="meta" style="margin-top:8px">位送礼人</div>
      <div class="meta" style="margin-top:10px">${esc(meta.dateStr)} · ${esc(meta.sessionStr)}</div>`}
    </div>
    <div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:2px">
        <div style="flex:1;height:1px;background:${MAG.rule}"></div>
        <span class="meta" style="letter-spacing:2px">前十名</span>
        <div style="flex:1;height:1px;background:${MAG.rule}"></div>
      </div>
      <div style="display:flex;gap:22px;align-items:flex-start">${col(top.slice(0, half), 1)}${col(top.slice(half), half + 1)}</div>
    </div>
  </div>`);
}

/** v3 目录双栏 · TOP 页：杂志目录式，1-5 左栏 / 6-10 右栏 */
function magListHTML(variant, users, meta, pageLabel) {
  const A = MAG_AMOUNT;
  const V2 = variant === 'magazine-v2';
  const half = Math.ceil(users.length / 2);
  // 行高按每栏行数算，保证整块装进 720 视口（100 人场次每栏 15 行，固定 45px 会溢出被裁）
  const rows = Math.max(1, half);
  const avail = A ? 556 : 566;
  const rowH = Math.max(26, Math.min(A ? 40 : 45, Math.floor(avail / rows)));
  const av = A ? 20 : 24;
  const pad = Math.max(3, Math.floor((rowH - av - 1) / 2));
  const col = (arr, offset) => `<div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:space-between">${arr.map((u, i) => `
    <div style="display:flex;align-items:center;gap:8px;height:${rowH}px;padding:${pad}px 0;border-bottom:${V2 ? MAG2_ROW_RULE : '1px solid ' + MAG.ruleLight}">
      <span class="num" style="width:22px;font-size:12px;color:${MAG.inkFaint}">${offset + i + 1}</span>
      ${magAvatar(u.avatar, av)}
      <span style="flex:1;min-width:0;font-size:${A ? 13.5 : 14.5}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${magName(u)}</span>
      ${A ? `<span class="amt" style="font-size:12.5px;flex-shrink:0;margin-left:8px">${fmtD(u.diamonds)}</span>` : ''}
    </div>`).join('')}</div>`;
  return magDoc('园区充电榜 · ' + pageLabel, variant === 'magazine-v2' ? MAG2_PAPER_CSS : '', `<div class="page" style="padding:40px 40px 30px">
    <div style="display:flex;justify-content:space-between;align-items:baseline">
      <div class="masthead" style="font-size:16px;letter-spacing:4px">园区充电榜</div>
      <div class="meta">${esc(pageLabel)}</div>
    </div>
    ${V2 ? `<div style="height:1px;background:rgba(26,26,30,0.24);margin:11px 0 4px"></div><div style="height:1px;background:rgba(26,26,30,0.075);margin-bottom:6px"></div>` : `<div class="rule" style="margin:11px 0 4px"></div>`}
    <div style="flex:1;display:flex;gap:26px;align-items:stretch">${col(users.slice(0, half), users.length ? users[0]._rank - 1 : 0)}${col(users.slice(half), users.length ? users[half]._rank - 1 : 0)}</div>
    <div class="rule"></div>
    <div class="meta" style="margin-top:10px">${esc(meta.target)} · ${esc(meta.sessionStr)} · 共 ${meta.gifters} 位送礼人</div>
  </div>`);
}

function magTopHTML(variant, users, meta) {
  if (variant === 'noir') return nrTopHTML(users, meta);
  if (variant === 'typegrid') return tgTopHTML(users, meta);
  if (variant === 'cute') return cuTopHTML(users, meta);
  if (variant === 'cute-journal') return cjTopHTML(users, meta);
  if (variant === 'cute-story') return csTopHTML(users, meta);
  if (variant === 'ghost') return ghTopHTML(users, meta);
  if (variant === 'chroma-bar') return cbTopHTML(users, meta);
  if (variant === 'chroma-refined') return crTopHTML(users, meta);
  if (variant === 'chroma-photo') return cpTopHTML(users, meta);
  if (variant === 'depth-glass') return dgTopHTML(users, meta);
  if (variant === 'depth-stack') return dsTopHTML(users, meta);
  if (variant === 'chroma-tile') return ctTopHTML(users, meta);
  if (variant === 'faces') return faTopHTML(users, meta);
  if (variant === 'ruler') return ruTopHTML(users, meta);
  if (variant === 'monolith') return moTopHTML(users, meta);
  if (variant === 'cute-chibi') return chTopHTML(users, meta);
  if (variant === 'cute-candy') return ccTopHTML(users, meta);
  if (variant === 'news') return nwTopHTML(users, meta);
  if (variant === 'energy') return enTopHTML(users, meta);
  if (variant === 'magazine-v2') return magTopV2(users, meta);
  return magTopV1(users, meta);
}

/** 杂志风渲染：540×720 CSS px @2x = 1080×1440，等字体与头像加载完成再截图 */
async function renderMag(html, outPath) {
  const br = await chromium.launch({ headless: true, executablePath: chromiumExe() });
  const page = await br.newPage({ viewport: { width: 540, height: 720 }, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(() => Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 8000))]));
  await page.evaluate(() => new Promise(r => {
    const imgs = document.querySelectorAll('img');
    let loaded = 0;
    const check = () => { loaded++; if (loaded >= imgs.length) r(); };
    imgs.forEach(img => { if (img.complete) check(); else { img.onload = check; img.onerror = check; } });
    if (!imgs.length) r();
    setTimeout(r, 8000);
  }));
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: outPath, type: 'jpeg', quality: 94 });
  await br.close();
  console.log(`  ✅ ${path.basename(outPath)}`);
}

async function renderMagazine(variant, users, meta) {
  const suffix = variant.replace('magazine-', '');
  const n = users.length;
  const topN = Math.min(10, n);
  const restCount = n - topN;
  meta.gifters = n >= 100 ? '100+' : String(n);
  meta.count = n;
  meta.capped = n >= 100;
  meta.total = magTotal(users);
  meta.topAvatars = users.slice(0, 3).map(u => u.avatar).filter(Boolean);      // 四页共用同一组色晕来源（榜主 + 总榜前三）
  const base = path.join(outputDir, `thanks_rank_${sessionIds.join('-')}_${suffix}`);
  console.log(`📐 模板 ${variant}${THEME_ARG ? '' : '（默认）'} · ${n} 人${MAG_AMOUNT ? ' · 收礼合计 ' + fmtD(meta.total) : ''}`);
  console.log(`🎨 背景 ${BG.name} · 强度 ${BG.strength} · 饱和 ×${BG.sat} · 模糊 ×${BG.blur}${BG.on ? '' : '（无色场）'}`);
  await renderMag(magTopHTML(variant, users.slice(0, topN), meta), `${base}_p1.jpg`);
  if (restCount > 0) {
    const perPage = 30;                                  // 固定每页 30 人 = 两栏各 15 行
    const listPages = Math.max(1, Math.ceil(restCount / perPage));
    meta.rowsPerCol = Math.ceil(Math.min(restCount, perPage) / 2);        // 整批统一档位（每栏最大行数）
    for (let i = 0; i < listPages; i++) {
      const start = topN + perPage * i, end = Math.min(topN + perPage * (i + 1), n);
      if (start >= end) continue;
      const label = `第 ${start + 1}-${end} 名`;
      console.log(`🖼️  名次页 ${i + 2}/${listPages + 1} (${label})`);
      const listHtml = rankListHTML(variant, users.slice(start, end), meta, label);
      await renderMag(listHtml, `${base}_p${i + 2}.jpg`);
    }
  }
}

// ==================== 古风·国风插画版（guofeng）====================
// 浅米纸 + 工笔国风插画（梅枝/丝带/玉牌/流苏，唯一彩色来源）+ 宋体排版 + 朱砂小印
// 文字只用墨色，青绿只做小面积点题（序号/标签），避免花
const GF_SEAL_TEXT = '林语巷';

let _gfAssets = null;
const RANK_NEW_THEMES = ['record', 'cinema', 'panel'];
/** 日期串里重复的月份去掉（9月20-9月21日 → 9月20-21日） */
function rankDate(s) { return String(s || '').replace(/(\d+)月(\d+)-(\d+)月(\d+)日/, '$1月$2-$4日'); }

/* ---------- ① record：音乐唱片风（米白纸 / 极细大字 / 一处朱红 / 超大留白） ---------- */
const CN = {
  bg: '#0B0A0D', light: '#F5F2EC', l2: 'rgba(245,242,236,0.66)', l3: 'rgba(245,242,236,0.42)',
  line: 'rgba(245,242,236,0.12)', accent: 'rgba(224,164,75,0.9)',
  serif: "'Noto Serif SC','Songti SC',serif", sans: "'Noto Sans SC',system-ui,sans-serif",
};
let _cnKey = null;
function rankListHTML(variant, users, meta, pageLabel) {
  if (variant === 'noir') return nrListHTML(users, meta, pageLabel);
  if (variant === 'typegrid') return tgListHTML(users, meta, pageLabel);
  if (variant === 'cute') return cuListHTML(users, meta, pageLabel);
  if (variant === 'cute-journal') return cjListHTML(users, meta, pageLabel);
  if (variant === 'cute-story') return csListHTML(users, meta, pageLabel);
  if (variant === 'ghost') return ghListHTML(users, meta, pageLabel);
  if (variant === 'chroma-bar') return cbListHTML(users, meta, pageLabel);
  if (variant === 'chroma-refined') return crListHTML(users, meta, pageLabel);
  if (variant === 'chroma-photo') return cpListHTML(users, meta, pageLabel);
  if (variant === 'depth-glass') return dgListHTML(users, meta, pageLabel);
  if (variant === 'depth-stack') return dsListHTML(users, meta, pageLabel);
  if (variant === 'chroma-tile') return ctListHTML(users, meta, pageLabel);
  if (variant === 'faces') return faListHTML(users, meta, pageLabel);
  if (variant === 'ruler') return ruListHTML(users, meta, pageLabel);
  if (variant === 'monolith') return moListHTML(users, meta, pageLabel);
  if (variant === 'cute-chibi') return chListHTML(users, meta, pageLabel);
  if (variant === 'cute-candy') return ccListHTML(users, meta, pageLabel);
  if (variant === 'news') return nwListHTML(users, meta, pageLabel);
  if (variant === 'energy') return enListHTML(users, meta, pageLabel);
  return magListHTML(variant, users, meta, pageLabel);
}

// ==================== 撞色/复古/拼贴 三套模板：blocks / press / collage ====================
// 纯 CSS：色块、字体、纹理（网点/条纹/硬阴影/贴纸），不依赖任何图片素材

/* ---------- ① blocks：撞色大色块（高饱和三色 + 粗黑大字 + 几何切割） ---------- */
const BL = {
  ink: '#101014', paper: '#F4F1EA', blue: '#1B3FD8', yellow: '#FFD400', red: '#FF4B2B',
  sans: "'Noto Sans SC',system-ui,sans-serif",
};
const BL_CHIP = [BL.blue, BL.yellow, BL.red];
function rankMetaLine(meta) { return `${esc(meta.target)} · 共 ${meta.gifters} 位送礼人`; }

/* ---------- ④ ticket：票据/凭证风（打孔票根 + 虚线撕口 + 流水号 + 盖章） ---------- */
const NR = {
  bg: '#0B0B0D', ink: '#F2EDE3', gold: '#C9A227', dim: 'rgba(242,237,227,0.55)', gline: 'rgba(201,162,39,0.42)',
  serif: "'Noto Serif SC','Songti SC',serif", sans: "'Noto Sans SC',system-ui,sans-serif",
};
function nrCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${NR.bg};color:${NR.ink};font-family:${NR.sans};-webkit-font-smoothing:antialiased}
.page{width:540px;height:720px;padding:48px 48px 40px;display:flex;flex-direction:column}
.kicker{font-family:${NR.serif};font-size:11px;letter-spacing:6px;color:${NR.dim}}
.title{font-family:${NR.serif};font-weight:900;font-size:48px;letter-spacing:6px;line-height:1.08;margin-top:16px}
.grule{height:1px;background:${NR.gline};margin-top:22px}
.meta{font-size:10.5px;letter-spacing:3px;color:${NR.dim};margin-top:14px}
.rows{flex:1;min-height:0;display:flex;flex-direction:column;margin-top:10px}
.row{flex:1;min-height:0;display:flex;align-items:center;gap:16px;border-bottom:1px solid rgba(201,162,39,0.14)}
.row:last-child{border-bottom:none}
.idx{font-family:${NR.serif};font-weight:900;font-size:19px;color:${NR.gold};width:32px;flex-shrink:0;font-variant-numeric:tabular-nums}
.av{width:30px;height:30px;border-radius:50%;object-fit:cover;flex-shrink:0;border:1px solid rgba(201,162,39,0.45);filter:grayscale(0.25)}
.nm{font-family:${NR.serif};font-weight:700;font-size:16px;letter-spacing:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.foot{margin-top:18px;display:flex;justify-content:space-between;font-size:9.5px;letter-spacing:3px;color:${NR.dim}}
.lhead{display:flex;align-items:flex-end;justify-content:space-between}
.lhead .t{font-family:${NR.serif};font-weight:900;font-size:26px;letter-spacing:5px}
.lhead .p{font-size:10px;letter-spacing:3px;color:${NR.gold}}
.lgrid{display:flex;gap:32px;flex:1;min-height:0;margin-top:12px}
.lcol{flex:1;min-width:0;display:flex;flex-direction:column}
.lrow{flex:1;min-height:0;display:flex;align-items:center;gap:10px;border-bottom:1px solid rgba(201,162,39,0.12)}
.lrow:last-child{border-bottom:none}
.li{font-family:${NR.serif};font-weight:700;font-size:12px;color:${NR.gold};width:22px;flex-shrink:0}
.ln{font-family:${NR.serif};font-size:13px;letter-spacing:0.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}`;
}
function nrDoc(t, b) { return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${nrFont()}<title>${esc(t)}</title><style>${nrCSS()}</style></head><body>${b}</body></html>`; }
function nrFont() { return `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;700;900&family=Noto+Sans+SC:wght@400&display=swap">`; }
function nrAv(url, size) {
  if (!url) return `<span class="av" style="width:${size}px;height:${size}px;display:block;background:rgba(255,255,255,0.08)"></span>`;
  const u = url.startsWith('//') ? 'https:' + url : url;
  return `<img class="av" src="${u}" style="width:${size}px;height:${size}px" />`;
}
function nrTopHTML(users, meta) {
  const top = users.slice(0, 10);
  return nrDoc('园区充电榜', `<div class="page">
    <div class="kicker">感谢每一份心意</div>
    <div class="title">园区充电榜</div>
    <div class="grule"></div>
    <div class="meta">${rankMetaLine(meta)} · ${esc(rankDate(meta.dateStr))}</div>
    <div class="rows">${top.map((u, i) => `<div class="row"><span class="idx">${String(i + 1).padStart(2, '0')}</span>${nrAv(u.avatar, 30)}<span class="nm">${magName(u)}</span></div>`).join('')}</div>
    <div class="foot"><span>前十名</span><span>${esc(rankDate(meta.dateStr))}</span></div>
  </div>`);
}
function nrListHTML(users, meta, pageLabel) {
  const half = Math.ceil(users.length / 2);
  const col = (arr, off) => `<div class="lcol">${arr.map((u, i) => `<div class="lrow"><span class="li">${off + i + 1}</span>${nrAv(u.avatar, 22)}<span class="ln">${magName(u)}</span></div>`).join('')}</div>`;
  return nrDoc('园区充电榜 · ' + pageLabel, `<div class="page">
    <div class="lhead"><span class="t">园区充电榜</span><span class="p">${esc(pageLabel)}</span></div>
    <div class="grule" style="margin-top:14px"></div>
    <div class="lgrid">${col(users.slice(0, half), users.length ? users[0]._rank - 1 : 0)}${col(users.slice(half), users.length ? users[half]._rank - 1 : 0)}</div>
    <div class="foot"><span>${rankMetaLine(meta)}</span><span>${esc(rankDate(meta.dateStr))}</span></div>
  </div>`);
}

/* ---------- ⑦ doodle：手写涂鸦风（马克笔 + 圈画重点 + 便签贴纸） ---------- */
const TB = {
  bg: '#F1EFE9', ink: '#0E0E10', hot: '#FF3B1F', soft: 'rgba(14,14,16,0.6)',
  sans: "'Noto Sans SC',system-ui,sans-serif",
};
function tbFont() { return `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700;900&display=swap">`; }
function tbAv(url, size, sq) {
  const st = `width:${size}px;height:${size}px;`;
  if (!url) return `<span class="av" style="${st}display:block;background:rgba(14,14,16,0.12)"></span>`;
  const u = url.startsWith('//') ? 'https:' + url : url;
  return `<img class="av" src="${u}" style="${st}" />`;
}
function tgCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${TB.bg};color:${TB.ink};font-family:${TB.sans};-webkit-font-smoothing:antialiased}
.page{position:relative;width:540px;height:720px;overflow:hidden}
.hotline{position:absolute;left:0;top:0;width:540px;height:10px;background:${TB.hot}}
.ghost{position:absolute;right:-20px;top:-12px;font-weight:900;font-size:104px;letter-spacing:-6px;color:rgba(14,14,16,0.05)}
.hd{position:absolute;left:34px;right:34px;top:40px}
.hd .t{font-weight:900;font-size:38px;line-height:1;letter-spacing:-1.5px}
.hd .m{font-weight:700;font-size:10.5px;letter-spacing:2.2px;color:${TB.soft};margin-top:13px}
/* 名次刻度尺 */
.ruler{position:absolute;left:34px;right:34px;top:140px;height:2px;background:rgba(14,14,16,0.15)}
.rfill{position:absolute;top:-2px;height:6px;background:${TB.hot}}
.rt{position:absolute;top:-4px;width:1px;height:10px;background:rgba(14,14,16,0.3)}
.rl{position:absolute;top:11px;font-weight:900;font-size:9px;color:rgba(14,14,16,0.4);letter-spacing:1px}
.rmark{position:absolute;top:10px;font-weight:900;font-size:9.5px;color:${TB.hot};letter-spacing:1px;transform:translateX(-50%);white-space:nowrap}
/* 表格 */
.tbl{position:absolute;left:34px;right:34px;top:178px;bottom:58px;display:flex;flex-direction:column}

.tbody{flex:1;display:flex;flex-direction:column;min-height:0;border-top:1.5px solid rgba(14,14,16,0.85)}
.tbody.list{justify-content:flex-start}
.tbody.list .tr{flex:0 0 auto}
.tr{flex:1;min-height:0;display:grid;align-items:center;padding:0 6px;border-bottom:1px solid rgba(14,14,16,0.075)}
.tr:last-child{border-bottom:none}
.tr.top3{background:rgba(255,59,31,0.055)}
.rk{font-weight:900;font-variant-numeric:tabular-nums;letter-spacing:-0.5px;text-align:right;line-height:1}
.tr.top3 .rk{color:${TB.hot}}
.av{width:26px;height:26px;border-radius:50%;object-fit:cover;flex-shrink:0;box-shadow:0 0 0 1px rgba(14,14,16,0.12)}
.nm{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tr.top3 .nm{font-weight:900}
.foot{position:absolute;left:34px;right:34px;bottom:20px;display:flex;justify-content:space-between;align-items:baseline;
  border-top:1px solid rgba(14,14,16,0.14);padding-top:9px}
.foot span{font-weight:700;font-size:9.5px;letter-spacing:2px;color:${TB.soft}}
.two{position:absolute;left:34px;right:34px;top:178px;bottom:58px;display:flex;gap:28px}
.two .col{flex:1;min-width:0;display:flex;flex-direction:column}
.vrule{position:absolute;left:50%;top:178px;bottom:58px;width:1px;background:rgba(14,14,16,0.07)}`;
}
function tgDoc(t, b) { return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${tbFont()}<title>${esc(t)}</title><style>${tgCSS()}</style></head><body>${b}</body></html>`; }
function tgRuler(start, end, total, capped) {
  const pct = r => Math.max(0, Math.min(100, (r - 1) / Math.max(1, total - 1) * 100));
  const w = Math.max(1.2, pct(end) - pct(start));
  return `<div class="ruler"><span class="rt" style="left:0"></span><span class="rt" style="right:0"></span>
    <span class="rfill" style="left:${pct(start).toFixed(2)}%;width:${w.toFixed(2)}%"></span>
    <span class="rl" style="left:0">1</span><span class="rl" style="right:0">${capped ? total + "+" : total}</span>
    <span class="rmark" style="left:${(pct(start) + w / 2).toFixed(2)}%">第 ${start}-${end} 名</span></div>`;
}
function tgDensity(rows) {
  if (rows <= 13) return { av: 26, nm: 15.5, rk: 17, gap: 12 };
  if (rows <= 15) return { av: 19, nm: 12, rk: 13.5, gap: 8 };
  if (rows <= 18) return { av: 17, nm: 11, rk: 12.5, gap: 7 };
  if (rows <= 22) return { av: 15, nm: 10, rk: 11.5, gap: 6 };
  return { av: 13, nm: 9.5, rk: 10.5, gap: 5 };
}
function tgTr(u, rank, big, d, digits, rh) {
  const top = rank <= 3;
  const z = d || tgDensity(big ? 10 : 13);
  const nd = digits || 2;
  const numW = Math.round(nd * z.rk * 0.62);          // 名次列：按最宽数字估宽
  const numGap = Math.round(z.av * 0.85);             // 数字 → 头像 的固定气口
  return `<div class="tr${top ? ' top3' : ''}" style="grid-template-columns:${numW}px 1fr;column-gap:${numGap}px${rh ? `;height:${rh}px` : ''}">
    <span class="rk" style="font-size:${z.rk}px">${String(rank).padStart(2, '0')}</span>
    <span style="display:flex;align-items:center;gap:${z.gap}px;min-width:0">
      ${tbAv(u.avatar, z.av, false)}<span class="nm" style="font-size:${z.nm}px">${magName(u)}</span></span></div>`;
}
function tgHead(title, sub, ghost) {
  return `<div class="hotline"></div>${ghost ? '<div class="ghost">榜</div>' : ''}
    <div class="hd"><div class="t">${esc(title)}</div><div class="m">${sub}</div></div>`;
}
function tgTopHTML(users, meta) {
  const top = users.slice(0, 10);
  const total = meta.count || Number(String(meta.gifters).replace(/[^0-9]/g, '')) || top.length;
  return tgDoc('园区充电榜', `<div class="page">
    ${tgHead('园区充电榜', `${rankMetaLine(meta)} · ${esc(rankDate(meta.dateStr))}`, true)}
    ${tgRuler(1, top.length, total, meta.capped)}
    <div class="tbl">
      <div class="tbody">${top.map((u, i) => tgTr(u, i + 1, true, null, 2)).join('')}</div>
    </div>
    <div class="foot"><span>前十名</span><span>共 ${meta.gifters} 位送礼人</span></div>
  </div>`);
}
function tgListHTML(users, meta, pageLabel) {
  const cap = meta.rowsPerCol || 15;                                    // 每栏容量
  const half = users.length > cap ? cap : Math.ceil(users.length / 2);   // 左栏排满再起右栏
  const start = users.length ? users[0]._rank : 1;
  const end = users.length ? users[users.length - 1]._rank : start;
  const total = meta.count || Number(String(meta.gifters).replace(/[^0-9]/g, '')) || end;
  const z = tgDensity(meta.rowsPerCol || half);
  const nd = String(meta.count || end).length;
  const rh = (meta.rowsPerCol || 15) >= 12 ? Math.floor(484 / 15) : 0;   // 大名单：固定 15 行节奏；小名单：撑满
  const col = (arr, off) => `<div class="col">
    <div class="tbody${rh ? ' list' : ''}">${arr.map((u, i) => tgTr(u, off + i + 1, false, z, nd, rh)).join('')}</div></div>`;
  return tgDoc('园区充电榜 · ' + pageLabel, `<div class="page">
    ${tgHead('园区充电榜', `${esc(pageLabel)} · ${rankMetaLine(meta)}`)}
    ${tgRuler(start, end, total, meta.capped)}
    <div class="two">${col(users.slice(0, half), start - 1)}${col(users.slice(half), start + half - 1)}</div>
    <div class="vrule"></div>
    <div class="foot"><span>${esc(rankDate(meta.dateStr))}</span><span>共 ${meta.gifters} 位送礼人</span></div>
  </div>`);
}
function tgxCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${TB.bg};color:${TB.ink};font-family:${TB.sans};-webkit-font-smoothing:antialiased}
.page{position:relative;width:540px;height:720px;overflow:hidden}
.mega{position:absolute;left:32px;top:34px;width:480px;font-weight:900;font-size:66px;line-height:0.98;letter-spacing:-3px}
.sub{position:absolute;left:34px;top:200px;font-weight:900;font-size:11.5px;letter-spacing:3.5px}
.ghost{position:absolute;right:-24px;top:-18px;font-weight:900;font-size:118px;letter-spacing:-8px;color:rgba(14,14,16,0.06)}
.hotline{position:absolute;left:0;top:0;width:540px;height:12px;background:${TB.hot}}
.foot{position:absolute;left:0;bottom:0;width:540px;height:54px;background:${TB.ink};border-top:5px solid ${TB.hot};
  display:flex;align-items:center;justify-content:space-between;padding:0 34px}
.foot span{color:${TB.bg};font-weight:700;font-size:10.5px;letter-spacing:3px}
/* A 阶梯条 */
.bars{position:absolute;left:34px;right:34px;top:246px;bottom:76px;display:flex;flex-direction:column;justify-content:space-between}
.brow{display:flex;align-items:center;gap:12px}
.bnum{font-weight:900;font-size:13px;width:26px;flex-shrink:0;color:rgba(14,14,16,0.4);font-variant-numeric:tabular-nums}
.bbar{height:34px;display:flex;align-items:center;gap:9px;padding:0 12px;min-width:0;max-width:100%}
.bnm{font-weight:900;font-size:15px;letter-spacing:-0.2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
/* B 字号堆叠 */
.stack{position:absolute;left:34px;right:34px;top:246px;bottom:76px;display:flex;flex-direction:column;justify-content:space-between}
.srow{display:flex;align-items:baseline;gap:12px;min-width:0}
.snum{font-weight:900;font-size:13px;width:24px;flex-shrink:0;color:rgba(14,14,16,0.38)}
.snm{font-weight:900;letter-spacing:-1px;line-height:1.05;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
/* C 竖排 */
.vcols{position:absolute;left:34px;right:34px;top:250px;height:352px;display:flex;flex-direction:row-reverse;gap:11px}
.vcol{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:8px}
.vnum{font-weight:900;font-size:15px;color:rgba(14,14,16,0.42);font-variant-numeric:tabular-nums}
.vav{width:26px;height:26px;border-radius:50%;overflow:hidden;flex-shrink:0}
.vnm{writing-mode:vertical-rl;font-weight:900;font-size:17px;letter-spacing:1.5px;max-height:262px;overflow:hidden;text-overflow:ellipsis}
.av{width:20px;height:20px;border-radius:50%;object-fit:cover;flex-shrink:0;background:rgba(14,14,16,0.1)}
/* 名次刻度尺：标出本页在 1..N 里的位置 */
.ruler{position:absolute;left:34px;right:34px;top:126px;height:3px;background:rgba(14,14,16,0.14)}
.rfill{position:absolute;top:0;height:3px;background:${TB.hot}}
.rtick{position:absolute;top:-3px;width:1px;height:9px;background:rgba(14,14,16,0.35)}
.rlab{position:absolute;top:8px;font-weight:900;font-size:9.5px;color:rgba(14,14,16,0.45)}
/* rankbar 名次页：双栏条梯 */
.cbgrid{position:absolute;left:34px;right:34px;top:150px;bottom:70px;display:flex;gap:28px}
.cbcol{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:space-between}
.cbrow{display:flex;align-items:center;gap:8px}
.cbnum{font-weight:900;font-size:11px;width:22px;flex-shrink:0;color:rgba(14,14,16,0.4);font-variant-numeric:tabular-nums}
.cbbar{height:26px;display:flex;align-items:center;gap:7px;padding:0 9px;min-width:0;max-width:100%}
.cbnm{font-weight:900;font-size:12.5px;letter-spacing:-0.1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
/* 名次页共用 */
.lhead{position:absolute;left:34px;top:30px}
.lhead .t{font-weight:900;font-size:42px;line-height:1;letter-spacing:-1.5px}
.lhead .p{font-weight:900;font-size:12px;letter-spacing:3px;margin-top:9px;color:rgba(14,14,16,0.6)}
.lgrid{position:absolute;left:32px;right:32px;top:142px;bottom:66px;display:flex;gap:30px}
.col{flex:1;min-width:0;display:flex;flex-direction:column}
.lrow{flex:1;min-height:0;display:flex;align-items:center;gap:9px;border-bottom:1px solid rgba(14,14,16,0.13)}
.lrow:last-child{border-bottom:none}
.li{font-weight:900;font-size:14px;width:28px;flex-shrink:0;font-variant-numeric:tabular-nums;letter-spacing:-0.5px}
.ln{font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}`;
}
function tgxDoc(t, b) { return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${tbFont()}<title>${esc(t)}</title><style>${tgxCSS()}</style></head><body>${b}</body></html>`; }

/* ---------- ⑩ 三种非表格的排名呈现（共用 typegrid 版头） ---------- */
function tgxHead(extra) {
  return `<div class="hotline"></div><div class="ghost">榜</div>
    <div class="mega">园区<br>充电榜</div>
    <div class="sub">${extra}</div>`;
}
/* A. 阶梯条：条宽随名次递减，第 1 名橙色，条内写名字 */
function sigW(name, fs) { return String(name).length * fs * 1.03 + 6; }
/** 签名墙：每个名字一个槽位，大小随名次递减，微倾斜，x 抖动避免呆板，自动夹在画布内 */
/* ==================== 三套新风格：cute 可爱风 / news 报纸头版 / energy 能量标签 ==================== */
const CU = { bg: '#FFF4F7', card: '#FFFFFF', ink: '#4A3B3F', soft: 'rgba(74,59,63,0.55)',
  pink: '#FF6FA5', mint: '#66D3B8', butter: '#FFD36E', peach: '#FFB38A' };
const NW = { paper: '#F0EDE4', ink: '#17161A', soft: 'rgba(23,22,26,0.60)', faint: 'rgba(23,22,26,0.34)',
  rule: 'rgba(23,22,26,0.35)', line: 'rgba(23,22,26,0.15)', red: '#B3121B',
  serif: "'Noto Serif SC','Songti SC',serif" };
const EN = { bg: '#F4F1E6', ink: '#14180F', green: '#0E3B2E', neon: '#C9F24D', orange: '#FF6A00',
  soft: 'rgba(20,24,15,0.55)', line: 'rgba(20,24,15,0.13)' };

function assetB64(rel) {
  try { return 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, rel)).toString('base64'); }
  catch (e) { return ''; }
}
function cuFont() { return '<link href="https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&family=Noto+Sans+SC:wght@400;500;700;900&display=swap" rel="stylesheet">'; }
function nwFont() { return '<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600;900&family=Noto+Sans+SC:wght@400;700&display=swap" rel="stylesheet">'; }
function enFont() { return '<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700;900&family=Roboto+Mono:wght@500;700&display=swap" rel="stylesheet">'; }

/* ---------- ① cute 可爱风：奶油粉底 + 平涂小电车 + 圆角卡名单 ---------- */
function cuCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${CU.bg};color:${CU.ink};font-family:'Noto Sans SC',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.page{position:relative;width:540px;height:720px;overflow:hidden;padding:32px 32px 24px;display:flex;flex-direction:column}
.blob{position:absolute;border-radius:50%;z-index:0}
.mascot{position:absolute;z-index:1}
.hd{position:relative;z-index:2}
.ttl{font-family:'ZCOOL KuaiLe',sans-serif;font-size:37px;color:${CU.pink};letter-spacing:3px;line-height:1}
.mt{font-size:10.5px;color:${CU.soft};letter-spacing:0.8px}
.card{background:${CU.card};border-radius:18px;box-shadow:0 6px 16px rgba(255,155,182,0.16)}
.cell{display:flex;align-items:center;gap:10px;background:${CU.card};border-radius:15px;padding:12px 13px;
  box-shadow:0 3px 9px rgba(255,155,182,0.15)}
.rk{width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;
  font-family:'ZCOOL KuaiLe',sans-serif;font-size:11px;color:#fff;background:${CU.pink};flex-shrink:0;line-height:1}
.rk1{background:${CU.butter};color:#8A6412}.rk2{background:${CU.mint};color:#0A5342}.rk3{background:${CU.peach};color:#7A3A12}
.av{border-radius:50%;object-fit:cover;flex-shrink:0;display:block}
.nm{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.big{font-family:'ZCOOL KuaiLe',sans-serif;font-size:26px;color:${CU.pink};line-height:1}
.foot{display:flex;justify-content:space-between;align-items:center;position:relative;z-index:2}
.big{font-family:'ZCOOL KuaiLe',sans-serif}`;
}
function cuRow(u, rank, av, fs, pad) {
  const c = rank === 1 ? ' rk1' : rank === 2 ? ' rk2' : rank === 3 ? ' rk3' : '';
  return `<div class="cell"${pad ? ` style="padding:${pad}"` : ''}><span class="rk${c}">${rank}</span>${tbAv(u.avatar, av, false)}<span class="nm" style="font-size:${fs}px">${magName(u)}</span></div>`;
}
function cuStickers() {
  const star = assetB64('assets/kitty-star.png'), heart = assetB64('assets/kitty-heart.png');
  return heart ? `<img class="mascot" src="${heart}" style="left:74px;top:463px;width:20px;opacity:.95">` : '';
}
function cuTopHTML(users, meta) {
  const top = users.slice(0, 10);
  const ev = assetB64('assets/cute-ev.png');
  const half = Math.ceil(top.length / 2);
  const col = (arr, off) => `<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:16px">${arr.map((u, i) => cuRow(u, off + i, 31, 14.5)).join('')}</div>`;
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${cuFont()}<style>${cuCSS()}</style></head><body>
  <div class="page">
    <div class="blob" style="width:330px;height:330px;background:#FFE4EE;left:-110px;top:-120px"></div>
    <div class="blob" style="width:210px;height:210px;background:#E2F7F0;right:-70px;bottom:120px;opacity:.42"></div>
    ${ev ? `<img class="mascot" src="${ev}" style="right:16px;top:20px;width:156px">` : ''}
    <div class="hd"><div class="ttl">园区充电榜</div>
      <div class="mt" style="margin-top:9px">${rankMetaLine(meta)} · ${rankDate(meta.dateStr)}</div></div>
    <div class="card" style="margin-top:12px;padding:15px 18px;display:flex;align-items:center;gap:14px;position:relative;z-index:2">
      ${tbAv(meta.avatar, 60, true)}
      <div><div style="font-size:18px;font-weight:900">${esc(meta.target)}</div>
        <div class="mt" style="margin-top:7px">收到 <span class="big" style="font-size:23px">${meta.gifters}</span> 位送礼人的心意</div></div>
    </div>
    <div style="margin:15px 0 9px 3px;font-size:12px;font-weight:900;color:${CU.pink};letter-spacing:2px;position:relative;z-index:2">前十名</div>
    <div style="flex:1;display:flex;align-items:flex-start;gap:14px;position:relative;z-index:2;margin-top:14px">${col(top.slice(0, half), 1)}${col(top.slice(half), half + 1)}</div>
    <div style="display:flex;gap:9px;position:relative;z-index:2;margin-bottom:12px">
      ${[['场次', meta.sessionStr], ['日期', rankDate(meta.dateStr)], ['榜单主', meta.target], ['上榜', meta.gifters + ' 人']]
        .map(([k, v]) => `<div style="flex:1;background:#FFFFFF;border-radius:14px;padding:9px 8px;text-align:center;box-shadow:0 3px 8px rgba(255,155,182,0.14)"><div class="mt" style="font-size:9.5px">${k}</div><div style="font-family:'ZCOOL KuaiLe',sans-serif;font-size:13px;color:${CU.pink};margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v)}</div></div>`).join('')}
    </div>
    <div class="foot"><span class="mt">${esc(meta.sessionStr)} · 共 ${meta.gifters} 位送礼人</span>
      <span class="mt">${rankDate(meta.dateStr)}</span></div>
    ${cuStickers()}
  </div></body></html>`;
}
function cuListHTML(users, meta, pageLabel) {
  const half = Math.ceil(users.length / 2);
  const n = users.length, rows = Math.max(1, half);
  const avail = 508;                                  // 名次页去掉页头页脚后的可用高度（留出页脚 15px + 底边距）
  const gap = rows > 13 ? 4 : 7;
  const cardH = Math.floor((avail - gap * (rows - 1)) / rows);
  const av = Math.max(15, Math.min(26, cardH - 16)), fs = av >= 22 ? 13 : av >= 18 ? 12 : 11;
  const pad = `${Math.max(3, Math.floor((cardH - Math.max(av, fs * 1.45)) / 2))}px 11px`;
  const col = (arr, off) => `<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:${gap}px">${arr.map((u, i) => cuRow(u, off + i, av, fs, pad)).join('')}</div>`;
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${cuFont()}<style>${cuCSS()}</style></head><body>
  <div class="page">
    <div class="blob" style="width:300px;height:300px;background:#FFE4EE;right:-120px;top:-140px"></div>
    <div class="blob" style="width:230px;height:230px;background:#E2F7F0;left:-100px;bottom:-60px"></div>
    <div class="hd" style="display:flex;justify-content:space-between;align-items:baseline">
      <div class="ttl" style="font-size:22px">园区充电榜</div><div class="mt" style="font-weight:700">${esc(pageLabel)}</div></div>
    <div class="mt" style="margin-top:10px;position:relative;z-index:2">${esc(meta.target)} · ${rankDate(meta.dateStr)} · 共 ${meta.gifters} 位送礼人</div>
    <div style="display:flex;gap:11px;margin-top:12px;position:relative;z-index:2">${col(users.slice(0, half), users[0] ? users[0]._rank : 1)}${col(users.slice(half), users[half] ? users[half]._rank : 1)}</div>
    <div style="flex:1"></div>
    <div class="foot"><span class="mt">${esc(meta.sessionStr)}</span><span class="mt">${rankDate(meta.dateStr)}</span></div>
  </div></body></html>`;
}

/* ---------- ② news 报纸头版：报头双线 + 号外红块 + 头条 + 三栏小字 ---------- */
function nwCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${NW.paper};color:${NW.ink};font-family:${NW.serif};-webkit-font-smoothing:antialiased}
.page{position:relative;width:540px;height:720px;padding:28px 32px 24px;display:flex;flex-direction:column}
.kick{font-size:9.5px;letter-spacing:3px;color:${NW.soft};font-family:'Noto Sans SC',sans-serif}
.np{font-size:47px;font-weight:900;letter-spacing:12px;line-height:1;text-align:center;text-indent:12px}
.dr{height:6px;border-top:2px solid ${NW.ink};border-bottom:1px solid ${NW.rule}}
.hl{font-size:22px;font-weight:900;line-height:1.4;letter-spacing:0.5px}
.sub{font-size:11px;color:${NW.soft};font-family:'Noto Sans SC',sans-serif;letter-spacing:0.5px}
.cols{display:flex;gap:16px;flex:1;min-height:0}
.lrow{flex:1 1 auto;max-height:64px;min-height:0;display:flex;align-items:center;gap:7px;border-bottom:1px solid ${NW.line}}
.lrow:last-child{border-bottom:none}
.lnum{font-size:12px;font-weight:900;font-variant-numeric:tabular-nums;width:18px;flex-shrink:0;text-align:right;color:${NW.red}}
.lnm{font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.av{border-radius:50%;object-fit:cover;flex-shrink:0;display:block}
.seal{display:inline-block;background:${NW.red};color:${NW.paper};font-size:12px;font-weight:900;letter-spacing:4px;padding:5px 9px 5px 13px}`;
}
function nwListCol(arr, off) {
  return `<div style="flex:1;min-width:0;display:flex;flex-direction:column;min-height:0">${arr.map((u, i) => `<div class="lrow"><span class="lnum">${off + i}</span><span class="lnm">${magName(u)}</span></div>`).join('')}</div>`;
}
function nwColTop(arr, off, av, fs, big, gridRows) {
  const A = av || 22, F = fs || 14.5;
  const rs = big ? 'gap:12px;max-height:none' : 'gap:9px;max-height:none';
  const cs = gridRows
    ? `flex:1;min-width:0;min-height:0;display:grid;grid-template-rows:repeat(${gridRows},1fr)`   // 等高网格：行位严格对齐
    : 'flex:1;min-width:0;display:flex;flex-direction:column;min-height:0';
  return `<div style="${cs}">${arr.map((u, i) => `<div class="lrow" style="${rs}">
    <span class="lnum">${u._rank}</span>${tbAv(u.avatar, A, false)}<span class="lnm" style="font-size:${F}px">${magName(u)}</span></div>`).join('')}</div>`;
}
function nwTopHTML(users, meta) {
  const top = users.slice(0, 10);
  const parts = String(meta.sessionStr || '').match(/\d+/g) || [];
  const sn = parts[0] || '';
  const halfTop = Math.ceil(top.length / 2);
  const cols = [top.slice(0, halfTop), top.slice(halfTop)];
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${nwFont()}<style>${nwCSS()}</style></head><body>
  <div class="page">
    <div style="display:flex;justify-content:space-between;align-items:baseline;padding-bottom:6px;border-bottom:1px solid ${NW.line}">
      <span class="kick">园区充电榜 · 号外</span>
      <span class="kick">第 ${sn ? String(sn).padStart(3, '0') : '—'} 期 · ${rankDate(meta.dateStr)}</span>
    </div>
    <div style="position:relative;margin-top:12px">
      <span class="seal" style="position:absolute;left:0;top:4px">号外</span>
      <div class="np">园区充电榜</div>
    </div>
    <div class="dr" style="margin-top:13px"></div>
    <div style="margin-top:12px">
      <div class="hl">${esc(meta.target)}收到 <span style="color:${NW.red}">${meta.gifters}</span> 位送礼人的心意</div>
      <div class="sub" style="margin-top:7px">${esc(meta.sessionStr)} ｜ ${rankMetaLine(meta)}</div>
    </div>
    <div style="display:flex;align-items:center;gap:10px;margin:6px 0 2px">
      <span class="kick" style="letter-spacing:2px">前十名</span>
      <div style="flex:1;height:1px;background:${NW.rule}"></div>
    </div>
    <div class="cols" style="margin-top:4px">${cols.map((c, k) => nwColTop(c, (k ? halfTop : 0) + 1, 30, 17, true)).join('')}</div>
    <div style="display:flex;border-top:1px solid ${NW.rule};padding-top:10px">
      ${[['场次', meta.sessionStr], ['日期', rankDate(meta.dateStr)], ['榜单主', meta.target], ['上榜人数', meta.gifters + ' 人']]
        .map(([k, v], i) => `<div style="flex:1;padding-left:${i ? 12 : 0}px;border-left:${i ? '1px solid ' + NW.line : 'none'}"><div class="kick">${k}</div><div style="font-size:15px;font-weight:900;margin-top:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v)}</div></div>`).join('')}
    </div>
    <div style="border-top:2px solid ${NW.ink};margin-top:12px;padding-top:7px;display:flex;justify-content:space-between;align-items:baseline">
      <span class="kick">${rankPageCode(meta)}</span><span class="kick">由 404 · 抖音直播监控 生成</span>
    </div>
  </div></body></html>`;
}
function nwListHTML(users, meta, pageLabel) {
  const per = 15;                                               // 左栏排满 15 行再起右栏
  const cols = [users.slice(0, per), users.slice(per)];
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${nwFont()}<style>${nwCSS()}</style></head><body>
  <div class="page">
    <div style="display:flex;justify-content:space-between;align-items:baseline">
      <span class="np" style="font-size:19px;letter-spacing:6px;text-indent:6px">园区充电榜</span>
      <span class="kick" style="letter-spacing:2px">${esc(pageLabel)}</span>
    </div>
    <div class="dr" style="margin-top:9px;height:4px;border-top:1px solid ${NW.ink}"></div>
    <div class="sub" style="margin:9px 0 4px">${esc(meta.target)} ｜ ${esc(meta.sessionStr)} ｜ ${rankDate(meta.dateStr)} ｜ 共 ${meta.gifters} 位送礼人</div>
    <div class="cols" style="flex:1;margin-top:8px">${cols.map((c, k) => nwColTop(c, per * k + 1, 20, 13, false, 15)).join('')}</div>
    <div style="border-top:1px solid ${NW.rule};padding-top:7px;display:flex;justify-content:space-between;align-items:baseline">
      <span class="kick">${rankPageCodeOf(pageLabel, meta)}</span><span class="kick">由 404 · 抖音直播监控 生成</span>
    </div>
  </div></body></html>`;
}

/* ---------- ③ energy 能量标签：米白底 + 刻度环徽标 + 能量条按名次递减 ---------- */
function enCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${EN.bg};color:${EN.ink};font-family:'Noto Sans SC',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.page{position:relative;width:540px;height:720px;padding:30px 32px 24px;display:flex;flex-direction:column}
.ttl{font-size:24px;font-weight:900;letter-spacing:3px;color:${EN.green};line-height:1}
.kick{font-size:9.5px;letter-spacing:3px;color:${EN.soft}}
.mono{font-family:'Roboto Mono',monospace;font-variant-numeric:tabular-nums}
.bar{display:flex;align-items:center;gap:9px;height:31px;border-radius:4px;padding:0 10px;
  background:${EN.green};color:#F4F1E6;position:relative;overflow:hidden}
.bar.hot{background:${EN.neon};color:${EN.green}}
.bar .n{flex:1;min-width:0;font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar .v{font-size:11px;opacity:.85;flex-shrink:0}
.av{border-radius:50%;object-fit:cover;flex-shrink:0;display:block}
.lbl{display:flex;justify-content:space-between;border-bottom:1px solid ${EN.line};padding:5px 0;font-size:10.5px}
.dial{position:relative;width:126px;height:126px;border-radius:50%;border:1.5px solid ${EN.green};
  display:flex;flex-direction:column;align-items:center;justify-content:center;background:#FBFAF4}`;
}
function enRow(u, rank, fs, av, maxW) {
  const hot = rank <= 3;
  const w = Math.max(46, 100 - (rank - 1) * (maxW / 12));
  return `<div class="bar${hot ? ' hot' : ''}" style="width:${w.toFixed(1)}%">
    <span class="mono" style="font-size:12.5px;font-weight:700">${String(rank).padStart(2, '0')}</span>
    ${tbAv(u.avatar, av, false)}<span class="n" style="font-size:${fs}px">${magName(u)}</span></div>`;
}
function enTopHTML(users, meta) {
  const top = users.slice(0, 10);
  const parts = String(meta.sessionStr || '').match(/\d+/g) || [];
  const sn = parts[0] || '';
  const bolt = `<svg viewBox="0 0 24 24" width="34" height="34"><path d="M13 2 4 14h6l-1 8 9-12h-6z" fill="${EN.orange}"/></svg>`;
  const ticks = Array.from({ length: 28 }, (_, i) => {
    const a = (i / 28) * Math.PI * 2 - Math.PI / 2, long = i % 7 === 0;
    const r1 = 55, r2 = long ? 46 : 50, cx = 63, cy = 63;
    return `<line x1="${(cx + Math.cos(a) * r1).toFixed(1)}" y1="${(cy + Math.sin(a) * r1).toFixed(1)}" x2="${(cx + Math.cos(a) * r2).toFixed(1)}" y2="${(cy + Math.sin(a) * r2).toFixed(1)}" stroke="${EN.green}" stroke-width="${long ? 2 : 1}" opacity="${long ? 0.9 : 0.45}"/>`;
  }).join('');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${enFont()}<style>${enCSS()}</style></head><body>
  <div class="page">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div><div class="ttl">园区充电榜</div>
        <div class="kick" style="margin-top:9px">第 ${sn ? String(sn).padStart(3, '0') : '—'} 期 · ${rankDate(meta.dateStr)}</div></div>
      <div style="text-align:right"><span class="kick">能量标签</span>
        <div class="mono" style="font-size:26px;font-weight:700;color:${EN.orange};margin-top:6px">${meta.gifters}</div>
        <div class="kick" style="margin-top:3px">位送礼人</div></div>
    </div>
    <div style="display:flex;align-items:center;gap:18px;margin:16px 0 14px">
      <div class="dial"><svg style="position:absolute;inset:0" viewBox="0 0 126 126">${ticks}</svg>${bolt}
        <div class="kick" style="margin-top:6px;letter-spacing:2px">充电榜</div></div>
      <div style="flex:1">
        <div class="lbl"><span>收礼人</span><b>${esc(meta.target)}</b></div>
        <div class="lbl"><span>场次</span><b>${esc(meta.sessionStr)}</b></div>
        <div class="lbl"><span>日期</span><b>${rankDate(meta.dateStr)}</b></div>
        <div class="lbl" style="border-bottom:none"><span>共</span><b>${meta.gifters} 位送礼人</b></div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px">${top.map((u, i) => enRow(u, i + 1, 13, 20, 54)).join('')}</div>
    <div style="flex:1"></div>
    <div style="border-top:1px solid ${EN.line};padding-top:8px;display:flex;justify-content:space-between">
      <span class="kick">${esc(meta.target)} · ${esc(meta.sessionStr)}</span><span class="kick">${rankDate(meta.dateStr)}</span></div>
  </div></body></html>`;
}
function enListHTML(users, meta, pageLabel) {
  const half = Math.ceil(users.length / 2);
  const col = (arr, off) => `<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:5px">${arr.map((u, i) => enRow(u, off + i, 11, 17, 30)).join('')}</div>`;
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${enFont()}<style>${enCSS()}</style></head><body>
  <div class="page">
    <div style="display:flex;justify-content:space-between;align-items:baseline">
      <div class="ttl" style="font-size:18px">园区充电榜</div><span class="kick">${esc(pageLabel)}</span></div>
    <div class="kick" style="margin-top:9px">第 ${(String(meta.sessionStr || '').match(/\d+/g) || ['—'])[0]} 期 · ${rankDate(meta.dateStr)} · 共 ${meta.gifters} 位送礼人</div>
    <div style="display:flex;gap:10px;margin-top:12px;flex:1">${col(users.slice(0, half), users[0] ? users[0]._rank : 1)}${col(users.slice(half), users[half] ? users[half]._rank : 1)}</div>
    <div style="border-top:1px solid ${EN.line};padding-top:8px;display:flex;justify-content:space-between">
      <span class="kick">${esc(meta.target)}</span><span class="kick">${esc(pageLabel)}</span></div>
  </div></body></html>`;
}

/* ==================== 可爱风两案：cute-journal 手账拼贴 / cute-candy 糖果软糖 ==================== */
const CJ = { paper: '#FFFDF6', ink: '#3A3532', soft: 'rgba(58,53,50,0.55)', dot: 'rgba(120,110,100,0.20)',
  tapes: ['#FFD9E0', '#CDEBD8', '#FFF0BC', '#CFE3FF', '#FBD9F0'], marker: '#FFE58A', accent: '#E4698A' };
const CC = { bg: '#FFF6F9', ink: '#4A3B44', soft: 'rgba(74,59,68,0.55)',
  caps: ['#FFB3C8', '#A8E6CF', '#FFE0A3', '#B8D8FF'], accent: '#FF7BA9' };
function cuteFontLink() {
  return '<link href="https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&family=Noto+Sans+SC:wght@400;700;900&display=swap" rel="stylesheet">'
       + '<link href="https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/style.css" rel="stylesheet">';
}
/* ---------- A. 手账拼贴 ---------- */
function cjCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${CJ.paper};color:${CJ.ink};font-family:'LXGW WenKai','Noto Sans SC',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.page{position:relative;width:540px;height:720px;overflow:hidden;padding:34px 34px 26px;display:flex;flex-direction:column}
.grid{position:absolute;inset:0;background-image:radial-gradient(${CJ.dot} 1.1px, transparent 1.1px);background-size:16px 16px;opacity:.85}
.hand{font-family:'LXGW WenKai',serif;font-weight:700}
.ttl{font-family:'ZCOOL KuaiLe',sans-serif;font-size:36px;letter-spacing:2px;color:${CJ.ink};position:relative;z-index:2;display:inline-block;padding:4px 10px}
.ttl i{position:absolute;left:2px;bottom:6px;height:15px;width:100%;background:${CJ.marker};z-index:-1;transform:rotate(-1.2deg);border-radius:3px}
.mt{font-size:10.5px;color:${CJ.soft};letter-spacing:0.5px}
.tape{display:flex;align-items:center;gap:8px;padding:0 12px;border-radius:3px;position:relative;height:100%;min-height:0}
.tape::after{content:'';position:absolute;inset:0;border-radius:3px;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.55)}
.nm{font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rk{font-family:'ZCOOL KuaiLe',sans-serif;font-size:12px;color:${CJ.accent};flex-shrink:0;width:18px;text-align:center}
.av{border-radius:50%;object-fit:cover;flex-shrink:0;display:block;box-shadow:0 0 0 1.5px rgba(255,255,255,0.9)}
.note{background:#FFFCF0;border-radius:8px;box-shadow:0 4px 10px rgba(120,104,88,0.13);position:relative}
.sticker{position:absolute}
.foot{display:flex;justify-content:space-between;align-items:center;position:relative;z-index:2;margin-top:11px}`;
}
function cjTape(u, rank, av, nmFs, pad) {
  const col = CJ.tapes[(rank - 1) % CJ.tapes.length];
  const rot = ((rank % 3) - 1) * 0.9;
  return `<div class="tape" style="background:${col};transform:rotate(${rot.toFixed(1)}deg);padding:${pad}">
    <span class="rk">${rank}</span>${tbAv(u.avatar, av, false)}<span class="nm" style="font-size:${nmFs}px">${magName(u)}</span></div>`;
}
function cjTopHTML(users, meta) {
  const top = users.slice(0, 10);
  const rows = top.map((u, i) => {
    const r = i + 1, w = r % 3 === 0 ? 90 : r % 2 === 0 ? 96 : 100, off = r % 2 === 0 ? 12 : 0;
    return `<div style="flex:1;min-height:0;display:flex;width:${w}%;margin-left:${off}px">${cjTape(u, r, 26, 14.5, '0 12px')}</div>`;
  }).join('');
  const stamp = `<svg viewBox="0 0 72 72" width="72" height="72"><circle cx="36" cy="36" r="34" fill="${CJ.accent}" opacity="0.14"/><circle cx="36" cy="36" r="28" fill="none" stroke="${CJ.accent}" stroke-width="1.4" stroke-dasharray="3 3"/><text x="36" y="34" text-anchor="middle" font-size="15" font-weight="700" fill="${CJ.accent}" font-family="LXGW WenKai,serif">感谢</text><text x="36" y="52" text-anchor="middle" font-size="13" font-weight="700" fill="${CJ.accent}" font-family="LXGW WenKai,serif">每一份心意</text></svg>`;
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${cuteFontLink()}<style>${cjCSS()}</style></head><body>
  <div class="page"><div class="grid"></div>
    <div style="position:relative;z-index:2"><span class="ttl"><i></i>园区充电榜</span>
      <div class="mt" style="margin-top:10px">${rankMetaLine(meta)} · ${rankDate(meta.dateStr)}</div></div>
    <div class="note" style="margin-top:16px;padding:14px 16px;display:flex;align-items:center;gap:14px;z-index:2">
      ${tbAv(meta.avatar, 56, true)}
      <div><div class="hand" style="font-size:18px">${esc(meta.target)}</div>
        <div class="mt" style="margin-top:8px">收到 <span style="font-family:'ZCOOL KuaiLe',sans-serif;font-size:20px;color:${CJ.accent}">${meta.gifters}</span> 位送礼人的心意</div></div>
      <span class="sticker" style="right:10px;top:-30px">${stamp}</span>
    </div>
    <div class="mt" style="margin:18px 0 10px 2px;font-size:11.5px;letter-spacing:2px;color:${CJ.ink};font-weight:700;position:relative;z-index:2">前十名</div>
    <div style="flex:1;display:flex;flex-direction:column;gap:9px;position:relative;z-index:2;min-height:0">${rows}</div>
    <div class="foot"><span class="mt">${esc(meta.sessionStr)} · 共 ${meta.gifters} 位送礼人</span><span class="mt">${rankDate(meta.dateStr)}</span></div>
  </div></body></html>`;
}
function cjListHTML(users, meta, pageLabel) {
  const half = Math.ceil(users.length / 2), rows = Math.max(1, half);
  const av = rows > 14 ? 17 : 20, nmFs = rows > 14 ? 11.5 : 12.5;
  const col = (arr, off) => `<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:5px;min-height:0">${arr.map((u, i) => `<div style="flex:1;min-height:0;display:flex">${cjTape(u, off + i, av, nmFs, '0 10px')}</div>`).join('')}</div>`;
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${cuteFontLink()}<style>${cjCSS()}</style></head><body>
  <div class="page"><div class="grid"></div>
    <div style="position:relative;z-index:2;display:flex;justify-content:space-between;align-items:baseline">
      <span class="ttl" style="font-size:22px"><i style="height:11px;bottom:3px"></i>园区充电榜</span>
      <span class="mt" style="font-weight:700">${esc(pageLabel)}</span></div>
    <div class="mt" style="margin-top:10px;position:relative;z-index:2">${esc(meta.target)} · ${rankDate(meta.dateStr)} · 共 ${meta.gifters} 位送礼人</div>
    <div style="flex:1;display:flex;gap:13px;margin-top:12px;position:relative;z-index:2;min-height:0">${col(users.slice(0, half), users[0] ? users[0]._rank : 1)}${col(users.slice(half), users[half] ? users[half]._rank : 1)}</div>
    <div class="foot"><span class="mt">${esc(meta.sessionStr)}</span><span class="mt">${rankDate(meta.dateStr)}</span></div>
  </div></body></html>`;
}
/* ---------- B. 糖果软糖 ---------- */
function ccCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${CC.bg};color:${CC.ink};font-family:'Noto Sans SC',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.page{position:relative;width:540px;height:720px;overflow:hidden;padding:34px 34px 26px;display:flex;flex-direction:column}
.dot{position:absolute;border-radius:50%;z-index:0}
.ttlcap{display:inline-flex;align-items:center;padding:12px 26px;border-radius:999px;background:${CC.accent};
  box-shadow:0 0 0 3.5px #fff, 0 6px 14px rgba(255,123,169,0.28);position:relative;z-index:2}
.ttlcap span{font-family:'ZCOOL KuaiLe',sans-serif;font-size:29px;color:#fff;letter-spacing:3px;line-height:1}
.caprow{height:100%;min-height:0;padding:0 14px 0 10px}
.cap{display:flex;align-items:center;gap:9px;border-radius:999px;padding:8px 14px 8px 10px;
  box-shadow:0 0 0 3px #fff, 0 4px 10px rgba(180,140,160,0.18);position:relative;z-index:2}
.rk{width:22px;height:22px;border-radius:50%;background:#fff;display:inline-flex;align-items:center;justify-content:center;
  font-family:'ZCOOL KuaiLe',sans-serif;font-size:12px;color:${CC.accent};flex-shrink:0;line-height:1}
.nm{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.av{border-radius:50%;object-fit:cover;flex-shrink:0;display:block;box-shadow:0 0 0 2px #fff}
.mt{font-size:10.5px;color:${CC.soft};letter-spacing:0.5px}
.foot{display:flex;justify-content:space-between;align-items:center;position:relative;z-index:2;margin-top:11px}`;
}
function ccCap(u, rank, av, nmFs, pad) {
  const col = rank <= 3 ? CC.caps[rank - 1] : CC.caps[(rank - 1) % CC.caps.length];
  return `<div class="cap caprow" style="background:${col};padding:${pad}"><span class="rk">${rank}</span>${tbAv(u.avatar, av, false)}<span class="nm" style="font-size:${nmFs}px">${magName(u)}</span></div>`;
}
function ccTopHTML(users, meta) {
  const top = users.slice(0, 10);
  const rows = top.map((u, i) => `<div style="flex:1;min-height:0;display:flex">${ccCap(u, i + 1, 26, 14.5, '0 16px 0 10px')}</div>`).join('');
  const dots = [[24, 22, 22, '#FFE0A3'], [500, 44, 16, '#A8E6CF'], [22, 150, 14, '#B8D8FF'], [508, 636, 18, '#FFB3C8'], [30, 700, 16, '#FFE0A3']]
    .map(([x, y, s, c]) => `<span class="dot" style="left:${x}px;top:${y}px;width:${s}px;height:${s}px;background:${c};opacity:.85"></span>`).join('');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${cuteFontLink()}<style>${ccCSS()}</style></head><body>
  <div class="page">${dots}
    <div style="position:relative;z-index:2"><span class="ttlcap"><span>园区充电榜</span></span>
      <div class="mt" style="margin-top:14px">${rankMetaLine(meta)} · ${rankDate(meta.dateStr)}</div></div>
    <div class="cap" style="margin-top:18px;background:#FFFFFF;padding:16px 18px;border-radius:24px;box-shadow:0 0 0 3px ${CC.caps[0]}, 0 6px 16px rgba(180,140,160,0.18)">
      ${tbAv(meta.avatar, 58, true)}
      <div><div style="font-size:18px;font-weight:900">${esc(meta.target)}</div>
        <div class="mt" style="margin-top:8px">收到 <span style="font-family:'ZCOOL KuaiLe',sans-serif;font-size:22px;color:${CC.accent}">${meta.gifters}</span> 位送礼人的心意</div></div>
    </div>
    <div class="mt" style="margin:18px 0 10px 2px;font-size:11.5px;font-weight:900;color:${CC.accent};letter-spacing:2px;position:relative;z-index:2">前十名</div>
    <div style="flex:1;display:flex;flex-direction:column;gap:9px;position:relative;z-index:2;min-height:0">${rows}</div>
    <div class="foot"><span class="mt">${esc(meta.sessionStr)} · 共 ${meta.gifters} 位送礼人</span><span class="mt">${rankDate(meta.dateStr)}</span></div>
  </div></body></html>`;
}
function ccListHTML(users, meta, pageLabel) {
  const half = Math.ceil(users.length / 2), rows = Math.max(1, half);
  const av = rows > 14 ? 17 : 20, nmFs = rows > 14 ? 11.5 : 12.5;
  const col = (arr, off) => `<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:5px;min-height:0">${arr.map((u, i) => `<div style="flex:1;min-height:0;display:flex">${ccCap(u, off + i, av, nmFs, '0 12px 0 8px')}</div>`).join('')}</div>`;
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${cuteFontLink()}<style>${ccCSS()}</style></head><body>
  <div class="page">
    <div style="position:relative;z-index:2;display:flex;justify-content:space-between;align-items:${colAlign}">
      <span class="ttlcap" style="padding:8px 18px"><span style="font-size:19px">园区充电榜</span></span>
      <span class="mt" style="font-weight:700">${esc(pageLabel)}</span></div>
    <div class="mt" style="margin-top:12px;position:relative;z-index:2">${esc(meta.target)} · ${rankDate(meta.dateStr)} · 共 ${meta.gifters} 位送礼人</div>
    <div style="flex:1;display:flex;gap:13px;margin-top:12px;position:relative;z-index:2">${col(users.slice(0, half), users[0] ? users[0]._rank : 1)}${col(users.slice(half), users[half] ? users[half]._rank : 1)}</div>
    <div class="foot"><span class="mt">${esc(meta.sessionStr)}</span><span class="mt">${rankDate(meta.dateStr)}</span></div>
  </div></body></html>`;
}

/* ==================== 可爱风 C/D：cute-story 绘本童话 / cute-chibi Q版萱萱 ==================== */
const CS = { sky: '#D6E8FF', cream: '#FFF9F0', ink: '#33456B', soft: 'rgba(51,69,107,0.62)',
  pink: '#E98BA8', gold: '#F5B93F', line: 'rgba(51,69,107,0.15)' };
const CH = { bg: '#FFF3F7', card: '#FFFFFF', ink: '#4A3B44', soft: 'rgba(74,59,68,0.56)',
  pink: '#FF8FB1', blue: '#CFE4FF', soft2: '#FFE3EC' };
const CS_STAR = (fill, size) => `<svg class="star" viewBox="0 0 24 24" style="width:${size}px;height:${size}px"><path d="M12 2.2l2.9 6.2 6.8.8-5 4.6 1.3 6.7L12 17.3 6 20.5l1.3-6.7-5-4.6 6.8-.8z" fill="${fill}"/></svg>`;
const CH_HEART = (size, fill) => `<svg viewBox="0 0 24 24" style="width:${size}px;height:${size}px;flex-shrink:0"><path d="M12 21s-8.4-5.2-10.4-10C.3 7.6 2.6 4.2 6 4.2c2 0 3.5 1 4.6 2.6C11.7 5.2 13.2 4.2 15.2 4.2c3.4 0 5.7 3.4 4.4 6.8-2 4.8-7.6 10-7.6 10z" fill="${fill}"/></svg>`;
/* ---------- C. 绘本童话 ---------- */
function csCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${CS.cream};color:${CS.ink};font-family:'LXGW WenKai','Noto Sans SC',serif;-webkit-font-smoothing:antialiased}
.page{position:relative;width:540px;height:720px;overflow:hidden;display:flex;flex-direction:column}
.sky{position:absolute;left:0;top:0;width:100%;height:322px;background:${CS.sky};
  border-radius:0 0 48% 48% / 0 0 52px 52px;z-index:0}
.art{position:absolute;z-index:1}
.inner{position:relative;z-index:2;flex:1;display:flex;flex-direction:column;padding:28px 34px 24px;min-height:0}
.ttl{font-family:'ZCOOL KuaiLe',sans-serif;font-size:33px;letter-spacing:2px;color:#2C4066;line-height:1.1}
.mt{font-size:10.5px;color:${CS.soft}}
.card{background:#FFFFFF;border-radius:20px;box-shadow:0 8px 18px rgba(51,69,107,0.10);border:1.5px solid rgba(255,255,255,0.9)}
.nrow{display:flex;align-items:center;gap:9px;flex:1;min-height:0;border-bottom:1px dashed ${CS.line}}
.nm{font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rk{font-family:'ZCOOL KuaiLe',sans-serif;font-size:12px;color:${CS.pink};width:19px;flex-shrink:0;text-align:center}
.av{border-radius:50%;object-fit:cover;flex-shrink:0;display:block;box-shadow:0 0 0 1.5px #FFFFFF}
.star{flex-shrink:0;display:block}
.foot{display:flex;justify-content:space-between;align-items:center;margin-top:11px}`;
}
function csTopHTML(users, meta) {
  const cloud = assetB64('assets/story-cloud.png'), moon = assetB64('assets/story-moon.png');
  const rows = users.slice(0, 10).map((u, i) => {
    const r = i + 1;
    return `<div class="nrow">${CS_STAR(r <= 3 ? CS.gold : 'none', r <= 3 ? 14 : 11)}
      <span class="rk">${r}</span>${tbAv(u.avatar, 24, false)}<span class="nm" style="font-weight:${r <= 3 ? 700 : 400}">${magName(u)}</span></div>`;
  }).join('');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${cuteFontLink()}<style>${csCSS()}</style></head><body>
  <div class="page"><div class="sky"></div>
    <img class="art" src="${cloud}" style="left:-34px;top:14px;width:172px">
    <img class="art" src="${cloud}" style="right:150px;top:22px;width:92px;opacity:.95">
    <img class="art" src="${moon}" style="right:26px;top:22px;width:96px">
    <span class="art" style="left:212px;top:34px">${CS_STAR('#FFE79A', 15)}</span>
    <span class="art" style="left:64px;top:186px">${CS_STAR('#FFE79A', 12)}</span>
    <span class="art" style="right:44px;top:150px">${CS_STAR('#FFE79A', 10)}</span>
    <div class="inner">
      <div class="ttl">园区充电榜</div>
      <div class="mt" style="margin-top:11px">${rankMetaLine(meta)} · ${rankDate(meta.dateStr)}</div>
      <div class="card" style="margin-top:18px;padding:15px 18px;display:flex;align-items:center;gap:14px">
        ${tbAv(meta.avatar, 56, true)}
        <div><div style="font-size:18px;font-weight:700">${esc(meta.target)}</div>
          <div class="mt" style="margin-top:8px">收到 <span style="font-family:'ZCOOL KuaiLe',sans-serif;font-size:21px;color:${CS.pink}">${meta.gifters}</span> 位送礼人的心意</div></div>
      </div>
      <div class="mt" style="margin:16px 0 6px 2px;font-weight:700;color:${CS.ink};letter-spacing:2px;font-size:11.5px">前十名</div>
      <div style="flex:1;display:flex;flex-direction:column;min-height:0">${rows}</div>
      <div class="foot"><span class="mt">${esc(meta.sessionStr)} · 共 ${meta.gifters} 位送礼人</span><span class="mt">${rankDate(meta.dateStr)}</span></div>
    </div>
  </div></body></html>`;
}
function csListHTML(users, meta, pageLabel) {
  const half = Math.ceil(users.length / 2), rows = Math.max(1, half);
  const av = rows > 14 ? 17 : 20, nmFs = rows > 14 ? 11.5 : 12.5;
  const col = (arr, off) => `<div style="flex:1;min-width:0;display:flex;flex-direction:column;min-height:0">${arr.map((u, i) => {
    const r = off + i;
    return `<div class="nrow" style="gap:7px">${CS_STAR(r <= 3 ? CS.gold : 'none', r <= 3 ? 12 : 9)}
      <span class="rk" style="font-size:11px;width:16px">${r}</span>${tbAv(u.avatar, av, false)}<span class="nm" style="font-size:${nmFs}px">${magName(u)}</span></div>`;
  }).join('')}</div>`;
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${cuteFontLink()}<style>${csCSS()}</style></head><body>
  <div class="page"><div class="sky" style="height:118px;border-radius:0 0 46% 46% / 0 0 26px 26px"></div>
    <span class="art" style="left:30px;top:24px">${CS_STAR('#FFE79A', 11)}</span><span class="art" style="right:52px;top:20px">${CS_STAR('#FFE79A', 13)}</span>
    <div class="inner">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span class="ttl" style="font-size:22px">园区充电榜</span><span class="mt" style="font-weight:700">${esc(pageLabel)}</span></div>
      <div class="mt" style="margin-top:9px">${esc(meta.target)} · ${rankDate(meta.dateStr)} · 共 ${meta.gifters} 位送礼人</div>
      <div style="flex:1;display:flex;gap:14px;margin-top:12px;min-height:0">${col(users.slice(0, half), users[0] ? users[0]._rank : 1)}${col(users.slice(half), users[half] ? users[half]._rank : 1)}</div>
      <div class="foot"><span class="mt">${esc(meta.sessionStr)}</span><span class="mt">${rankDate(meta.dateStr)}</span></div>
    </div>
  </div></body></html>`;
}
/* ---------- D. Q版萱萱 ---------- */
function chCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${CH.bg};color:${CH.ink};font-family:'Noto Sans SC',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.page{position:relative;width:540px;height:720px;overflow:hidden;display:flex;flex-direction:column}
.blob{position:absolute;border-radius:50%;z-index:0}
.art{position:absolute;z-index:1}
.inner{position:relative;z-index:2;flex:1;display:flex;flex-direction:column;padding:32px 34px 24px;min-height:0}
.ttl{font-family:'ZCOOL KuaiLe',sans-serif;font-size:32px;letter-spacing:2px;line-height:1.15;color:${CH.ink}}
.mt{font-size:10.5px;color:${CH.soft}}
.card{display:flex;align-items:center;gap:9px;flex:1;min-height:0;background:${CH.card};border-radius:15px;
  padding:0 13px;box-shadow:0 4px 10px rgba(255,143,177,0.16)}
.rk{width:22px;height:22px;border-radius:50%;background:${CH.soft2};color:${CH.pink};display:inline-flex;align-items:center;
  justify-content:center;font-family:'ZCOOL KuaiLe',sans-serif;font-size:12px;flex-shrink:0;line-height:1}
.rk.top{background:${CH.pink};color:#fff}
.nm{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.av{border-radius:50%;object-fit:cover;flex-shrink:0;display:block;box-shadow:0 0 0 2px #FFFFFF}
.foot{display:flex;justify-content:space-between;align-items:center;margin-top:11px}`;
}
function chTopHTML(users, meta) {
  const girl = assetB64('assets/story-chibi.png');
  const rows = users.slice(0, 10).map((u, i) => {
    const r = i + 1;
    return `<div class="card">${r <= 3 ? CH_HEART(13, CH.pink) : ''}<span class="rk${r <= 3 ? ' top' : ''}">${r}</span>${tbAv(u.avatar, 24, false)}<span class="nm" style="font-size:14px">${magName(u)}</span></div>`;
  }).join('');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${cuteFontLink()}<style>${chCSS()}</style></head><body>
  <div class="page">
    <span class="blob" style="width:250px;height:250px;background:${CH.blue};opacity:.5;left:-90px;top:150px"></span>
    <span class="blob" style="width:190px;height:190px;background:${CH.soft2};right:-70px;top:-60px"></span>
    <img class="art" src="${girl}" style="right:-4px;top:18px;width:172px">
    <div class="inner">
      <div class="ttl">园区充电榜</div>
      <div class="mt" style="margin-top:10px">${rankMetaLine(meta)} · ${rankDate(meta.dateStr)}</div>
      <div style="height:94px"></div>
      <div style="background:${CH.card};border-radius:20px;padding:12px 17px;display:flex;align-items:center;gap:14px;box-shadow:0 8px 18px rgba(255,143,177,0.20);margin-top:5px">
        ${tbAv(meta.avatar, 54, true)}
        <div><div style="font-size:18px;font-weight:900">${esc(meta.target)}</div>
          <div class="mt" style="margin-top:8px">收到 <span style="font-family:'ZCOOL KuaiLe',sans-serif;font-size:21px;color:${CH.pink}">${meta.gifters}</span> 位送礼人的心意</div></div>
      </div>
      <div class="mt" style="margin:12px 0 5px 2px;font-size:11.5px;font-weight:900;color:${CH.pink};letter-spacing:2px">前十名</div>
      <div style="flex:1;display:flex;flex-direction:column;gap:7px;min-height:0">${rows}</div>
      <div class="foot"><span class="mt">${esc(meta.sessionStr)} · 共 ${meta.gifters} 位送礼人</span><span class="mt">${rankDate(meta.dateStr)}</span></div>
    </div>
  </div></body></html>`;
}
function chListHTML(users, meta, pageLabel) {
  const half = Math.ceil(users.length / 2), rows = Math.max(1, half);
  const av = rows > 14 ? 17 : 20, nmFs = rows > 14 ? 11.5 : 12.5;
  const col = (arr, off) => `<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:5px;min-height:0">${arr.map((u, i) => {
    const r = off + i;
    return `<div class="card" style="border-radius:12px;padding:0 11px">${r <= 3 ? CH_HEART(11, CH.pink) : ''}<span class="rk${r <= 3 ? ' top' : ''}" style="width:19px;height:19px;font-size:11px">${r}</span>${tbAv(u.avatar, av, false)}<span class="nm" style="font-size:${nmFs}px">${magName(u)}</span></div>`;
  }).join('')}</div>`;
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${cuteFontLink()}<style>${chCSS()}</style></head><body>
  <div class="page">
    <span class="blob" style="width:200px;height:200px;background:${CH.blue};opacity:.45;right:-80px;top:-70px"></span>
    <div class="inner">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span class="ttl" style="font-size:22px">园区充电榜</span><span class="mt" style="font-weight:700">${esc(pageLabel)}</span></div>
      <div class="mt" style="margin-top:9px">${esc(meta.target)} · ${rankDate(meta.dateStr)} · 共 ${meta.gifters} 位送礼人</div>
      <div style="flex:1;display:flex;gap:13px;margin-top:12px;min-height:0">${col(users.slice(0, half), users[0] ? users[0]._rank : 1)}${col(users.slice(half), users[half] ? users[half]._rank : 1)}</div>
      <div class="foot"><span class="mt">${esc(meta.sessionStr)}</span><span class="mt">${rankDate(meta.dateStr)}</span></div>
    </div>
  </div></body></html>`;
}

/* ==================== 四种"名次为主角"的结构：ghost 幽灵数字 / faces 人脸墙 / ruler 全页刻度尺 / monolith 巨型名字 ==================== */
function numFontLink() {
  return '<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;600;700;900&family=Roboto+Mono:wght@400;500;700&display=swap" rel="stylesheet">';
}
const GH = { bg: '#F6F5F2', ink: '#16181D', ghost: 'rgba(22,24,29,0.085)', soft: 'rgba(22,24,29,0.55)',
  line: 'rgba(22,24,29,0.09)', red: '#E2402F' };
const FA = { bg: '#FFFDF8', ink: '#1A1A1C', soft: 'rgba(26,26,28,0.55)', line: 'rgba(26,26,28,0.10)',
  accent: '#1F6FEB' };
const RU = { bg: '#FBFBF9', ink: '#111214', soft: 'rgba(17,18,20,0.55)', tick: 'rgba(17,18,20,0.28)',
  axis: '#111214', amber: '#E8A33D' };
const MO = { bg: '#111214', ink: '#F3F0EA', soft: 'rgba(243,240,234,0.55)', line: 'rgba(243,240,234,0.14)',
  orange: '#FF6A2B' };
/* ---------- 1. ghost 幽灵数字 ---------- */
function ghCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${GH.bg};color:${GH.ink};font-family:'Noto Sans SC',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.page{position:relative;width:540px;height:720px;overflow:hidden;padding:32px 40px 24px;display:flex;flex-direction:column}
.ttl{font-size:38px;font-weight:900;letter-spacing:1px;line-height:1.1}
.ttl i{color:${GH.red};font-style:normal}
.mt{font-size:10.5px;color:${GH.soft};letter-spacing:1px}
.row{position:relative;flex:1;min-height:0;display:flex;align-items:center;border-bottom:1px solid ${GH.line}}
.gn{position:absolute;left:-4px;font-family:'Roboto Mono',monospace;font-weight:700;color:${GH.ghost};
  font-size:62px;line-height:1;letter-spacing:-2px;z-index:0}
.rw{position:relative;z-index:1;display:flex;align-items:center;gap:11px;margin-left:74px}
.nm{font-size:15.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.av{border-radius:50%;object-fit:cover;flex-shrink:0;display:block;box-shadow:0 0 0 1.5px ${GH.bg}}
.top .nm{font-weight:900;font-size:16.5px}
.foot{display:flex;justify-content:space-between;align-items:center;margin-top:11px}`;
}
function ghTopHTML(users, meta) {
  const rows = users.slice(0, 10).map((u, i) => {
    const r = i + 1;
    return `<div class="row${r <= 3 ? ' top' : ''}"><span class="gn">${r < 10 ? '0' + r : r}</span>
      <span class="rw">${tbAv(u.avatar, 30, false)}<span class="nm">${magName(u)}</span></span></div>`;
  }).join('');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${numFontLink()}<style>${ghCSS()}</style></head><body>
  <div class="page">
    <div class="ttl">园区<i>充电</i>榜</div>
    <div class="mt" style="margin-top:11px">${rankMetaLine(meta)} · ${rankDate(meta.dateStr)}</div>
    <div class="mt" style="margin-top:16px">${esc(meta.target)} · 前 十 名</div>
    <div style="flex:1;display:flex;flex-direction:column;min-height:0">${rows}</div>
    <div class="foot"><span class="mt">${esc(meta.sessionStr)} · 共 ${meta.gifters} 位送礼人</span><span class="mt">${rankDate(meta.dateStr)}</span></div>
  </div></body></html>`;
}
function ghListHTML(users, meta, pageLabel) {
  const half = Math.ceil(users.length / 2);
  const col = (arr, off) => `<div style="flex:1;min-width:0;display:flex;flex-direction:column;min-height:0">${arr.map((u, i) => {
    const r = off + i;
    return `<div class="row"><span class="gn" style="font-size:40px;left:-2px">${r < 10 ? '0' + r : r}</span>
      <span class="rw" style="margin-left:52px;gap:9px">${tbAv(u.avatar, 21, false)}<span class="nm" style="font-size:12.5px">${magName(u)}</span></span></div>`;
  }).join('')}</div>`;
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${numFontLink()}<style>${ghCSS()}</style></head><body>
  <div class="page">
    <div class="ttl" style="font-size:24px">园区<i>充电</i>榜</div>
    <div class="mt" style="margin-top:9px">${esc(meta.target)} · ${rankDate(meta.dateStr)} · ${esc(pageLabel)}</div>
    <div style="flex:1;display:flex;gap:26px;margin-top:12px;min-height:0">${col(users.slice(0, half), users[0] ? users[0]._rank : 1)}${col(users.slice(half), users[half] ? users[half]._rank : 1)}</div>
    <div class="foot"><span class="mt">${esc(meta.sessionStr)} · 共 ${meta.gifters} 位送礼人</span><span class="mt">${rankDate(meta.dateStr)}</span></div>
  </div></body></html>`;
}
/* ---------- 2. faces 人脸墙 ---------- */
function faCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${FA.bg};color:${FA.ink};font-family:'Noto Sans SC',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.page{position:relative;width:540px;height:720px;overflow:hidden;padding:32px 32px 24px;display:flex;flex-direction:column}
.ttl{font-size:36px;font-weight:900;letter-spacing:1px}
.mt{font-size:10.5px;color:${FA.soft};letter-spacing:1px}
.wall{flex:1;min-height:0;display:grid;align-content:space-between}
.cell{display:flex;flex-direction:column;align-items:center;gap:7px;min-width:0}
.pic{position:relative}
.av{border-radius:50%;object-fit:cover;display:block}
.badge{position:absolute;left:-2px;bottom:-2px;width:22px;height:22px;border-radius:50%;background:${FA.ink};color:#fff;
  font-family:'Roboto Mono',monospace;font-size:10.5px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid ${FA.bg}}
.cell.top3 .badge{background:${FA.accent}}
.nm{font-size:11.5px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;opacity:.92}
.cell.top3 .nm{font-weight:700}
.foot{display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:10px;border-top:1px solid ${FA.line}}`;
}
function faGridHTML(users, meta, cols, av, nmFs, rowGap) {
  const cell = (u, i) => {
    const r = u._rank, t = r <= 3 ? ' top3' : '';
    return `<div class="cell${t}"><span class="pic">${tbAv(u.avatar, av, false)}<span class="badge">${r}</span></span>
      <span class="nm" style="font-size:${nmFs}px">${magName(u)}</span></div>`;
  };
  return { html: users.map(cell).join(''), cols };
}
function faTopHTML(users, meta) {
  const top = users.slice(0, 10);
  const cells = top.map(u => {
    const r = u._rank, t = r <= 3 ? ' top3' : '';
    return `<div class="cell${t}"><span class="pic">${tbAv(u.avatar, 88, false)}<span class="badge">${r}</span></span>
      <span class="nm" style="font-size:12.5px">${magName(u)}</span></div>`;
  }).join('');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${numFontLink()}<style>${faCSS()}</style></head><body>
  <div class="page">
    <div class="ttl">园区充电榜</div>
    <div class="mt" style="margin-top:10px">${rankMetaLine(meta)} · ${rankDate(meta.dateStr)}</div>
    <div style="margin-top:20px;display:flex;align-items:baseline;gap:10px">
      <span style="font-size:19px;font-weight:900">${esc(meta.target)}</span>
      <span class="mt">收到 ${meta.gifters} 位送礼人的心意</span></div>
    <div class="wall" style="grid-template-columns:repeat(5,1fr);row-gap:30px;align-content:center;margin-top:6px">${cells}</div>
    <div class="foot"><span class="mt">${esc(meta.sessionStr)}</span><span class="mt">${rankDate(meta.dateStr)}</span></div>
  </div></body></html>`;
}
function faListHTML(users, meta, pageLabel) {
  const rows = Math.ceil(users.length / 5);
  const cells = users.map(u => {
    const r = u._rank, t = r <= 3 ? ' top3' : '';
    return `<div class="cell${t}"><span class="pic">${tbAv(u.avatar, 54, false)}<span class="badge">${r}</span></span>
      <span class="nm">${magName(u)}</span></div>`;
  }).join('');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${numFontLink()}<style>${faCSS()}</style></head><body>
  <div class="page">
    <div class="ttl" style="font-size:23px">园区充电榜</div>
    <div class="mt" style="margin-top:9px">${esc(meta.target)} · ${rankDate(meta.dateStr)} · ${esc(pageLabel)}</div>
    <div class="wall" style="grid-template-columns:repeat(5,1fr);row-gap:${rows > 5 ? 12 : 16}px;margin-top:14px">${cells}</div>
    <div class="foot"><span class="mt">${esc(meta.sessionStr)} · 共 ${meta.gifters} 位送礼人</span><span class="mt">${rankDate(meta.dateStr)}</span></div>
  </div></body></html>`;
}
/* ---------- 3. ruler 全页刻度尺 ---------- */
function ruCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${RU.bg};color:${RU.ink};font-family:'Noto Sans SC',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.page{position:relative;width:540px;height:720px;overflow:hidden;padding:30px 40px 24px;display:flex;flex-direction:column}
.ttl{font-size:35px;font-weight:900;letter-spacing:0.5px}
.mt{font-size:10.5px;color:${RU.soft};letter-spacing:1px}
.ruler{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;margin-top:14px}
.axis{position:absolute;left:66px;top:0;bottom:0;width:2px;background:${RU.axis}}
.rrow{position:relative;flex:1;min-height:0;display:flex;align-items:center}
.tick{position:absolute;left:60px;top:50%;transform:translateY(-50%);width:14px;height:2px;background:${RU.tick}}
.rnum{width:52px;text-align:right;font-family:'Roboto Mono',monospace;font-size:11.5px;font-weight:500;color:${RU.soft};
  flex-shrink:0;font-variant-numeric:tabular-nums}
.who{display:flex;align-items:center;gap:10px;margin-left:26px;min-width:0}
.nm{font-size:14.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.av{border-radius:50%;object-fit:cover;flex-shrink:0;display:block;box-shadow:0 0 0 2px ${RU.bg}}
.marks{position:absolute;left:52px;top:0;bottom:0;width:22px}
.mk{position:absolute;left:0;width:22px;height:1px;background:${RU.tick}}
.foot{display:flex;justify-content:space-between;align-items:center;margin-top:11px}`;
}
function ruRows(users, av, nmFs) {
  return users.map(u => {
    const r = u._rank;
    return `<div class="rrow"><span class="tick"></span><span class="rnum">${r}</span>
      <span class="who">${tbAv(u.avatar, av, false)}<span class="nm" style="font-size:${nmFs}px${r <= 3 ? ';font-weight:700' : ''}">${magName(u)}</span></span></div>`;
  }).join('');
}
function ruTopHTML(users, meta) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${numFontLink()}<style>${ruCSS()}</style></head><body>
  <div class="page">
    <div class="ttl">园区充电榜</div>
    <div class="mt" style="margin-top:10px">${rankMetaLine(meta)} · ${rankDate(meta.dateStr)}</div>
    <div style="margin-top:18px;display:flex;align-items:baseline;gap:10px">
      <span style="font-size:19px;font-weight:900">${esc(meta.target)}</span><span class="mt">前十名 · 共 ${meta.gifters} 位送礼人</span></div>
    <div class="ruler"><span class="axis"></span>${ruRows(users.slice(0, 10), 30, 15.5)}</div>
    <div class="foot"><span class="mt">${esc(meta.sessionStr)}</span><span class="mt">${rankDate(meta.dateStr)}</span></div>
  </div></body></html>`;
}
function ruListHTML(users, meta, pageLabel) {
  const half = Math.ceil(users.length / 2);
  const col = arr => `<div style="flex:1;min-width:0;display:flex;flex-direction:column;min-height:0">${ruRows(arr, 20, 12.5)}</div>`;
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${numFontLink()}<style>${ruCSS()}</style></head><body>
  <div class="page">
    <div class="ttl" style="font-size:23px">园区充电榜</div>
    <div class="mt" style="margin-top:9px">${esc(meta.target)} · ${rankDate(meta.dateStr)} · ${esc(pageLabel)}</div>
    <div style="flex:1;display:flex;gap:34px;margin-top:14px;min-height:0;position:relative">${col(users.slice(0, half))}${col(users.slice(half))}</div>
    <div class="foot"><span class="mt">${esc(meta.sessionStr)} · 共 ${meta.gifters} 位送礼人</span><span class="mt">${rankDate(meta.dateStr)}</span></div>
  </div></body></html>`;
}
/* ---------- 4. monolith 巨型名字 ---------- */
function moCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${MO.bg};color:${MO.ink};font-family:'Noto Sans SC',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.page{position:relative;width:540px;height:720px;overflow:hidden;padding:34px 34px 24px;display:flex;flex-direction:column}
.ttl{font-size:34px;font-weight:900;letter-spacing:1px;line-height:1.12}
.ttl i{font-style:normal;color:${MO.orange}}
.mt{font-size:10.5px;color:${MO.soft};letter-spacing:1px}
.row{flex:1;min-height:0;display:flex;align-items:center;gap:12px;border-bottom:1px solid ${MO.line}}
.nm{font-size:30px;font-weight:900;letter-spacing:-0.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.05}
.rn{font-family:'Roboto Mono',monospace;font-size:12px;font-weight:500;color:${MO.soft};width:26px;flex-shrink:0;text-align:right;font-variant-numeric:tabular-nums}
.av{border-radius:50%;object-fit:cover;flex-shrink:0;display:block}
.row.top .nm{color:${MO.orange}}
.foot{display:flex;justify-content:space-between;align-items:center;margin-top:11px}`;
}
function moTopHTML(users, meta) {
  const rows = users.slice(0, 10).map((u, i) => `<div class="row${i < 3 ? ' top' : ''}">
    <span class="rn">${u._rank}</span>${tbAv(u.avatar, 34, false)}<span class="nm">${magName(u)}</span></div>`).join('');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${numFontLink()}<style>${moCSS()}</style></head><body>
  <div class="page">
    <div class="ttl">园区<i>充电</i>榜</div>
    <div class="mt" style="margin-top:11px">${rankMetaLine(meta)} · ${rankDate(meta.dateStr)} · 前十名</div>
    <div style="flex:1;display:flex;flex-direction:column;min-height:0;margin-top:14px">${rows}</div>
    <div class="foot"><span class="mt">${esc(meta.target)} · 共 ${meta.gifters} 位送礼人</span><span class="mt">${esc(meta.sessionStr)}</span></div>
  </div></body></html>`;
}
function moListHTML(users, meta, pageLabel) {
  const half = Math.ceil(users.length / 2);
  const fs = half > 20 ? 13 : half > 15 ? 15 : 17;
  const col = (arr, off) => `<div style="flex:1;min-width:0;display:flex;flex-direction:column;min-height:0">${arr.map((u, i) => `<div class="row">
    <span class="rn" style="width:22px;font-size:11px">${u._rank}</span>${tbAv(u.avatar, fs + 6, false)}<span class="nm" style="font-size:${fs}px">${magName(u)}</span></div>`).join('')}</div>`;
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${numFontLink()}<style>${moCSS()}</style></head><body>
  <div class="page">
    <div class="ttl" style="font-size:23px">园区<i>充电</i>榜</div>
    <div class="mt" style="margin-top:9px">${esc(meta.target)} · ${rankDate(meta.dateStr)} · ${esc(pageLabel)}</div>
    <div style="flex:1;display:flex;gap:22px;margin-top:14px;min-height:0">${col(users.slice(0, half), users[0] ? users[0]._rank : 1)}${col(users.slice(half), users[half] ? users[half]._rank : 1)}</div>
    <div class="foot"><span class="mt">${esc(meta.sessionStr)} · 共 ${meta.gifters} 位送礼人</span><span class="mt">${rankDate(meta.dateStr)}</span></div>
  </div></body></html>`;
}

/* ==================== 低饱和 · 色块区别人：chroma-bar 色块条 / chroma-tile 色块砖 ==================== */
const CHROMA = ['#B8C4BB', '#C9BFAE', '#AEBCC9', '#CBB9BE', '#BFC3A8', '#C6B7C9', '#D2C0AC', '#A9BAB7', '#C4C0B4', '#BDC6D0'];
const CB = { bg: '#F5F3EF', ink: '#262A27', soft: 'rgba(38,42,39,0.52)', line: 'rgba(38,42,39,0.10)', mark: '#3F5A4A' };
function chromaOf(u, idx) {
  const s = String((u && u.nickname) || idx);
  let h = 7;
  for (const ch of s) h = (h * 131 + ch.codePointAt(0)) % 1000003;
  return CHROMA[h % CHROMA.length];
}
function chromaFontLink() {
  return '<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700;900&family=Roboto+Mono:wght@400;500;700&display=swap" rel="stylesheet">';
}
/* ---------- 1. chroma-bar 色块条 ---------- */
function cbCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${CB.bg};color:${CB.ink};font-family:'Noto Sans SC',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.page{position:relative;width:540px;height:720px;overflow:hidden;padding:32px 34px 24px;display:flex;flex-direction:column}
.ttl{font-size:34px;font-weight:900;letter-spacing:0.5px;line-height:1.12}
.ttl i{font-style:normal;color:${CB.mark}}
.mt{font-size:10.5px;color:${CB.soft};letter-spacing:1px}
.bar{flex:1;min-height:0;display:flex;align-items:center;gap:11px;padding:0 14px;border-radius:6px}
.rn{font-family:'Roboto Mono',monospace;font-size:12px;font-weight:500;font-variant-numeric:tabular-nums;opacity:.62;
  width:20px;flex-shrink:0;text-align:right}
.nm{font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.av{border-radius:50%;object-fit:cover;flex-shrink:0;display:block;box-shadow:0 0 0 2px rgba(255,255,255,0.85)}
.foot{display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:10px;border-top:1px solid ${CB.line}}`;
}
function cbBar(u, av, nmFs, pad) {
  const c = chromaOf(u);
  return `<div class="bar" style="background:${c};padding:0 ${pad}px"><span class="rn">${u._rank}</span>${tbAv(u.avatar, av, false)}<span class="nm" style="font-size:${nmFs}px">${magName(u)}</span></div>`;
}
function cbTopHTML(users, meta) {
  const rows = users.slice(0, 10).map(u => cbBar(u, 30, 15.5, 14)).join('');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${chromaFontLink()}<style>${cbCSS()}</style></head><body>
  <div class="page">
    <div class="ttl">园区<i>充电</i>榜</div>
    <div class="mt" style="margin-top:11px">${rankMetaLine(meta)} · ${rankDate(meta.dateStr)}</div>
    <div class="mt" style="margin-top:16px;color:${CB.mark};font-weight:700;letter-spacing:2px">前 十 名</div>
    <div style="flex:1;display:flex;flex-direction:column;gap:7px;min-height:0;margin-top:10px">${rows}</div>
    <div class="foot"><span class="mt">${esc(meta.sessionStr)}</span><span class="mt">${rankDate(meta.dateStr)}</span></div>
  </div></body></html>`;
}
function cbListHTML(users, meta, pageLabel) {
  const half = Math.ceil(users.length / 2);
  const av = half > 14 ? 19 : 22, nmFs = half > 14 ? 11.5 : 12.5, pd = half > 14 ? 10 : 11;
  const col = arr => `<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;min-height:0">${arr.map(u => cbBar(u, av, nmFs, pd)).join('')}</div>`;
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${chromaFontLink()}<style>${cbCSS()}</style></head><body>
  <div class="page">
    <div class="ttl" style="font-size:23px">园区<i>充电</i>榜</div>
    <div class="mt" style="margin-top:9px">${esc(meta.target)} · ${rankDate(meta.dateStr)} · ${esc(pageLabel)}</div>
    <div style="flex:1;display:flex;gap:16px;margin-top:12px;min-height:0">${col(users.slice(0, half))}${col(users.slice(half))}</div>
    <div class="foot"><span class="mt">${esc(meta.sessionStr)} · 共 ${meta.gifters} 位送礼人</span><span class="mt">${rankDate(meta.dateStr)}</span></div>
  </div></body></html>`;
}
/* ---------- 2. chroma-tile 色块砖 ---------- */
function ctCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${CB.bg};color:${CB.ink};font-family:'Noto Sans SC',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.page{position:relative;width:540px;height:720px;overflow:hidden;padding:32px 30px 24px;display:flex;flex-direction:column}
.ttl{font-size:34px;font-weight:900;letter-spacing:0.5px;line-height:1.12}
.ttl i{font-style:normal;color:${CB.mark}}
.mt{font-size:10.5px;color:${CB.soft};letter-spacing:1px}
.mosaic{flex:1;min-height:0;display:grid}
.tile{position:relative;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-width:0}
.rn{position:absolute;left:7px;top:5px;font-family:'Roboto Mono',monospace;font-size:10.5px;font-weight:500;opacity:.55;line-height:1}
.nm{font-size:12px;font-weight:600;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 4px}
.av{border-radius:50%;object-fit:cover;display:block;box-shadow:0 0 0 2px rgba(255,255,255,0.85)}
.foot{display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:10px;border-top:1px solid ${CB.line}}`;
}
function ctTile(u, av, nmFs) {
  return `<div class="tile" style="background:${chromaOf(u)}"><span class="rn" style="${u._rank <= 3 ? 'opacity:1;font-weight:700;color:#262A27' : ''}">${u._rank}</span>
    ${tbAv(u.avatar, av, false)}<span class="nm" style="font-size:${nmFs}px">${magName(u)}</span></div>`;
}
function ctTopHTML(users, meta) {
  const tiles = users.slice(0, 10).map(u => ctTile(u, 58, 13)).join('');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${chromaFontLink()}<style>${ctCSS()}</style></head><body>
  <div class="page">
    <div class="ttl">园区<i>充电</i>榜</div>
    <div class="mt" style="margin-top:11px">${rankMetaLine(meta)} · ${rankDate(meta.dateStr)}</div>
    <div class="mt" style="margin-top:16px;color:${CB.mark};font-weight:700;letter-spacing:2px">前 十 名</div>
    <div class="mosaic" style="grid-template-columns:repeat(2,1fr);grid-template-rows:repeat(5,1fr);gap:9px;margin-top:10px">${tiles}</div>
    <div class="foot"><span class="mt">${esc(meta.sessionStr)}</span><span class="mt">${rankDate(meta.dateStr)}</span></div>
  </div></body></html>`;
}
function ctListHTML(users, meta, pageLabel) {
  const tiles = users.map(u => ctTile(u, 34, 10.5)).join('');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${chromaFontLink()}<style>${ctCSS()}</style></head><body>
  <div class="page">
    <div class="ttl" style="font-size:23px">园区<i>充电</i>榜</div>
    <div class="mt" style="margin-top:9px">${esc(meta.target)} · ${rankDate(meta.dateStr)} · ${esc(pageLabel)}</div>
    <div class="mosaic" style="grid-template-columns:repeat(5,1fr);grid-template-rows:repeat(6,1fr);gap:7px;margin-top:12px">${tiles}</div>
    <div class="foot"><span class="mt">${esc(meta.sessionStr)} · 共 ${meta.gifters} 位送礼人</span><span class="mt">${rankDate(meta.dateStr)}</span></div>
  </div></body></html>`;
}

/* ==================== 低饱和色块·精修两案：chroma-refined 精修 / chroma-photo 柔焦头像 ==================== */
const CX = { bg: '#F4F2EE', paper: '#F6F4F0', ink: '#23262A', soft: 'rgba(35,38,42,0.50)', faint: 'rgba(35,38,42,0.16)',
  hair: 'rgba(35,38,42,0.055)', mark: '#4A5D52' };
function grainCSS(op) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/></filter><rect width='180' height='180' filter='url(%23n)' opacity='${op}'/></svg>`;
  return `background-image:url("data:image/svg+xml,${encodeURIComponent(svg).replace(/%2523/g, '%23')}");background-size:180px 180px;`;
}
function cxFontLink() {
  return '<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;700;900&family=Roboto+Mono:wght@300;400;500&display=swap" rel="stylesheet">';
}
function cxHead(meta, smallLabel) {
  return `<div style="display:flex;justify-content:space-between;align-items:baseline;padding-bottom:9px;border-bottom:1px solid ${CX.hair}">
      <span class="lbl">${smallLabel}</span><span class="lbl">${rankDate(meta.dateStr)}</span></div>
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:14px">
      <span class="ttl">园区充电榜</span><span class="lbl" style="padding-bottom:5px">${esc(meta.sessionStr)}</span></div>
    <div class="mt" style="margin-top:9px">${esc(meta.target)} · 共 ${meta.gifters} 位送礼人</div>`;
}
/* ---------- 1. chroma-refined 精修 ---------- */
function crCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${CX.bg};color:${CX.ink};font-family:'Noto Sans SC',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.page{position:relative;width:540px;height:720px;overflow:hidden;padding:34px 38px 26px;display:flex;flex-direction:column}
.grain{position:absolute;inset:0;opacity:.42;pointer-events:none;${grainCSS(0.16)}}
.grid{position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(to bottom, ${CX.hair} 1px, transparent 1px);background-size:100% 13px}
.ttl{font-size:30px;font-weight:900;letter-spacing:1.5px;line-height:1.06}
.lbl{font-size:9.5px;letter-spacing:2.6px;color:${CX.soft};font-weight:500}
.mt{font-size:10.5px;letter-spacing:0.8px;color:${CX.soft}}
.bar{position:relative;flex:1;min-height:0;display:flex;align-items:center;padding:0 16px;border-radius:4px;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,0.34), 0 1px 2px rgba(35,38,42,0.055)}
.rn{font-family:'Roboto Mono',monospace;font-size:10px;font-weight:400;letter-spacing:0.5px;opacity:.55;width:24px;text-align:right;flex-shrink:0;font-variant-numeric:tabular-nums}
.divider{width:1px;height:15px;background:rgba(35,38,42,0.16);margin:0 13px 0 11px;flex-shrink:0}
.nm{font-size:15px;font-weight:500;letter-spacing:0.3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.av{border-radius:50%;object-fit:cover;flex-shrink:0;display:block;box-shadow:0 0 0 1.5px rgba(255,255,255,0.75)}
.foot{display:flex;justify-content:space-between;align-items:baseline;margin-top:13px;padding-top:10px;border-top:1px solid ${CX.hair}}
.pg{font-family:'Roboto Mono',monospace;font-size:9.5px;letter-spacing:1px;color:${CX.soft}}`;
}
function crBar(u, av, nmFs) {
  return `<div class="bar" style="background:${chromaOf(u)}"><span class="rn">${String(u._rank).padStart(2, '0')}</span>
    <span class="divider"></span>${tbAv(u.avatar, av, false)}<span class="nm" style="font-size:${nmFs}px;margin-left:11px">${magName(u)}</span></div>`;
}
function crTopHTML(users, meta) {
  const rows = users.slice(0, 10).map(u => crBar(u, 30, 15)).join('');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${cxFontLink()}<style>${crCSS()}</style></head><body>
  <div class="page"><span class="grain"></span><span class="grid"></span>
    ${cxHead(meta, '前十名')}
    <div style="flex:1;display:flex;flex-direction:column;gap:6px;min-height:0;margin-top:16px">${rows}</div>
    <div class="foot"><span class="lbl"></span><span class="pg">${rankPageCode(meta)}</span></div>
  </div></body></html>`;
}
function crListHTML(users, meta, pageLabel) {
  const half = Math.ceil(users.length / 2);
  const av = half > 14 ? 20 : 22, nmFs = half > 14 ? 11.5 : 12.5;
  const col = arr => `<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;min-height:0">${arr.map(u => crBar(u, av, nmFs)).join('')}</div>`;
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${cxFontLink()}<style>${crCSS()}</style></head><body>
  <div class="page"><span class="grain"></span><span class="grid"></span>
    <div style="display:flex;justify-content:space-between;align-items:baseline;padding-bottom:9px;border-bottom:1px solid ${CX.hair}">
      <span class="lbl">园区充电榜</span><span class="lbl">${esc(pageLabel)}</span></div>
    <div class="mt" style="margin-top:10px">${esc(meta.target)} · 共 ${meta.gifters} 位送礼人</div>
    <div style="flex:1;display:flex;gap:18px;margin-top:14px;min-height:0">${col(users.slice(0, half))}${col(users.slice(half))}</div>
    <div class="foot"><span class="lbl">${rankDate(meta.dateStr)}</span><span class="pg">${rankPageCodeOf(pageLabel, meta)}</span></div>
  </div></body></html>`;
}
/* ---------- 2. chroma-photo 柔焦头像 ---------- */
function cpCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${CX.bg};color:${CX.ink};font-family:'Noto Sans SC',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.page{position:relative;width:540px;height:720px;overflow:hidden;padding:34px 32px 26px;display:flex;flex-direction:column}
.grain{position:absolute;inset:0;opacity:.45;pointer-events:none;${grainCSS(0.14)}}
.ttl{font-size:30px;font-weight:900;letter-spacing:1.5px;line-height:1.06}
.lbl{font-size:9.5px;letter-spacing:2.6px;color:${CX.soft};font-weight:500}
.mt{font-size:10.5px;letter-spacing:0.8px;color:${CX.soft}}
.mosaic{flex:1;min-height:0;display:grid}
.tile{position:relative;border-radius:4px;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end;min-width:0;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,0.30), 0 1px 3px rgba(35,38,42,0.07)}
.blur{position:absolute;inset:-14px;width:auto;height:auto;object-fit:cover;filter:blur(15px) saturate(0.7);opacity:.92}
.veil{position:absolute;inset:0}
.tin{position:relative;z-index:2;padding:8px 9px;display:flex;align-items:center;gap:7px;min-width:0}
.rn{font-family:'Roboto Mono',monospace;font-size:9.5px;letter-spacing:0.5px;opacity:.62;flex-shrink:0;font-variant-numeric:tabular-nums}
.nm{font-size:12px;font-weight:600;letter-spacing:0.2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.av{border-radius:50%;object-fit:cover;flex-shrink:0;display:block;box-shadow:0 0 0 1.5px rgba(255,255,255,0.7)}
.foot{display:flex;justify-content:space-between;align-items:baseline;margin-top:13px;padding-top:10px;border-top:1px solid ${CX.hair}}
.pg{font-family:'Roboto Mono',monospace;font-size:9.5px;letter-spacing:1px;color:${CX.soft}}`;
}
function cpTile(u, av, nmFs, minH) {
  const c = chromaOf(u), url = u.avatar || '';
  return `<div class="tile" style="background:${c};min-height:${minH}px">
    ${url ? `<img class="blur" src="${esc(url)}">` : ''}
    <span class="veil" style="background:${c};opacity:.68"></span>
    <span class="tin"><span class="rn">${String(u._rank).padStart(2, '0')}</span>${tbAv(url, av, false)}<span class="nm" style="font-size:${nmFs}px">${magName(u)}</span></span></div>`;
}
function cpTopHTML(users, meta) {
  const tiles = users.slice(0, 10).map(u => cpTile(u, 30, 13.5)).join('');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${cxFontLink()}<style>${cpCSS()}</style></head><body>
  <div class="page"><span class="grain"></span>
    ${cxHead(meta, '前十名')}
    <div class="mosaic" style="grid-template-columns:repeat(2,1fr);grid-template-rows:repeat(5,1fr);gap:8px;margin-top:16px">${tiles}</div>
    <div class="foot"><span class="lbl"></span><span class="pg">${rankPageCode(meta)}</span></div>
  </div></body></html>`;
}
function cpListHTML(users, meta, pageLabel) {
  const tiles = users.map(u => cpTile(u, 22, 10.5)).join('');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${cxFontLink()}<style>${cpCSS()}</style></head><body>
  <div class="page"><span class="grain"></span>
    <div style="display:flex;justify-content:space-between;align-items:baseline;padding-bottom:9px;border-bottom:1px solid ${CX.hair}">
      <span class="lbl">园区充电榜</span><span class="lbl">${esc(pageLabel)}</span></div>
    <div class="mt" style="margin-top:10px">${esc(meta.target)} · 共 ${meta.gifters} 位送礼人</div>
    <div class="mosaic" style="grid-template-columns:repeat(5,1fr);grid-template-rows:repeat(6,1fr);gap:6px;margin-top:14px">${tiles}</div>
    <div class="foot"><span class="lbl">${rankDate(meta.dateStr)}</span><span class="pg">${rankPageCodeOf(pageLabel, meta)}</span></div>
  </div></body></html>`;
}

/* ==================== 空间感 · 高斯模糊两案：depth-glass 磨砂玻璃 / depth-stack 层叠景深 ==================== */
const DP = { bg: '#F2F0EC', ink: '#22262A', soft: 'rgba(34,38,42,0.52)', hair: 'rgba(34,38,42,0.10)',
  white: 'rgba(255,255,255,0.58)', mark: '#3E5B4E' };
function rankPageTotal(meta) { const n = Math.min(100, (meta.count || 0)); return 1 + Math.max(0, Math.ceil((n - 10) / 30)); }
function rankPageCode(meta) { const t = rankPageTotal(meta); return '01 / ' + String(t).padStart(2, '0'); }
function rankPageIndexOf(pageLabel) { const m = String(pageLabel || '').match(/(\d+)/); const start = m ? Number(m[1]) : 11; return 1 + Math.max(0, Math.ceil((start - 10) / 30)); }
function rankPageCodeOf(pageLabel, meta) { return String(rankPageIndexOf(pageLabel)).padStart(2, '0') + ' / ' + String(rankPageTotal(meta)).padStart(2, '0'); }

function dpFontLink() {
  return '<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;700;900&family=Roboto+Mono:wght@300;400;500&display=swap" rel="stylesheet">';
}
function dpBgLayers(meta, blurPx, veilOp) {
  const url = meta.avatar || '';
  return `${url ? `<span class="bgimg" style="background-image:url('${esc(url)}');filter:blur(${blurPx}px) saturate(0.45) brightness(1.04)"></span>` : ''}
    <span class="veil" style="background:rgba(242,240,236,${veilOp})"></span>`;
}
function dpBgBlobs(users, meta, blurPx, veilOp) {
  const ve = Math.min(0.95, Math.max(0, 1 - (1 - veilOp) * BG.strength));       // strength 越大 = 色场越明显
  const veil = `<span class="veil" style="background:rgba(${BG.veil},${ve.toFixed(3)})"></span>`;
  const baseLayer = `<span class="blob-base" style="background:rgb(${BG.veil})"></span>`;
  if (!BG.on) return baseLayer + veil;
  const base = (meta.topAvatars && meta.topAvatars.length) ? meta.topAvatars : users.slice(0, 3).map(u => u.avatar);
  const picks = [meta.avatar, ...base].filter(Boolean).slice(0, 3);
  const pos = [[-130, -110, 440], [290, -80, 400], [-70, 410, 430]];
  const blobs = picks.map((u, i) => `<span class="blob" style="background-image:url('${esc(u)}');left:${pos[i][0]}px;top:${pos[i][1]}px;width:${pos[i][2]}px;height:${pos[i][2]}px;filter:blur(${Math.round(blurPx * BG.blur)}px) saturate(${BG.sat})"></span>`).join('');
  return baseLayer + blobs + veil;
}
function dpHead(meta, smallLabel) {
  return `<div style="display:flex;justify-content:space-between;align-items:baseline;padding-bottom:10px;border-bottom:1px solid ${DP.hair}">
      <span class="lbl">${smallLabel}</span><span class="lbl">${rankDate(meta.dateStr)}</span></div>
    <div style="display:flex;align-items:flex-end;justify-content:space-between;margin-top:15px">
      <span class="ttl">园区充电榜</span><span class="lbl" style="padding-bottom:6px">${esc(meta.sessionStr)}</span></div>
    <div class="mt" style="margin-top:10px">${esc(meta.target)} · 共 ${meta.gifters} 位送礼人</div>`;
}
function dpRow(u, av, nmFs, h) {
  const accent = u._rank <= 3;
  return `<div class="row${accent ? ' top' : ''}"${h ? ` style="flex:0 0 ${h}px"` : ''}><span class="rn">${String(u._rank).padStart(2, '0')}</span>${tbAv(u.avatar, av, false)}
    <span class="nm" style="font-size:${nmFs}px${accent ? ';font-weight:700' : ''}">${magName(u)}</span>
    <span class="dot" style="background:${chromaOf(u)};opacity:${accent ? 1 : 0.5}"></span></div>`;
}
/* ---------- 1. depth-glass 磨砂玻璃 ---------- */
function dgCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${DP.bg};color:${DP.ink};font-family:'Noto Sans SC',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.page{position:relative;width:540px;height:720px;overflow:hidden;padding:34px 34px 26px;display:flex;flex-direction:column}
.bgimg{position:absolute;inset:-80px;background-size:cover;background-position:center;z-index:0}
.veil{position:absolute;inset:0;z-index:1}
.blob-base{position:absolute;inset:0;background:#F2F0EC;z-index:0}
.blob{position:absolute;border-radius:50%;background-size:cover;background-position:center;z-index:0;opacity:.92}
.watermark{position:absolute;right:-58px;top:168px;font-family:'Roboto Mono',monospace;font-weight:700;font-size:300px;line-height:1;
  color:rgba(34,38,42,0.30);filter:blur(14px);z-index:1;letter-spacing:-8px}
.inner{position:relative;z-index:2;flex:1;display:flex;flex-direction:column;min-height:0}
.ttl{font-size:31px;font-weight:900;letter-spacing:1.5px;line-height:1.06}
.lbl{font-size:9.5px;letter-spacing:2.6px;color:${DP.soft};font-weight:500}
.mt{font-size:10.5px;letter-spacing:0.8px;color:${DP.soft}}
.glass{position:relative;flex:1;min-height:0;margin-top:18px;border-radius:24px;padding:12px 14px;display:flex;flex-direction:column;
  background:linear-gradient(158deg, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0.11) 34%, rgba(255,255,255,0.05) 72%, rgba(255,255,255,0.12) 100%);
  border:1px solid rgba(255,255,255,0.55);
  box-shadow:0 22px 48px rgba(34,38,42,0.13), inset 0 1px 0 rgba(255,255,255,0.75),
             inset 0 -1px 0 rgba(255,255,255,0.28);
  -webkit-backdrop-filter:blur(34px) saturate(1.2);backdrop-filter:blur(34px) saturate(1.2)}
.rows{flex:1;min-height:0;display:flex;flex-direction:column;gap:9px}
.row{flex:1;min-height:0;display:flex;align-items:center;gap:9px;border-radius:12px;padding:0 10px;
  background:rgba(255,255,255,0.42);box-shadow:0 1px 3px rgba(34,38,42,0.04)}
.row.top{background:rgba(255,255,255,0.74);box-shadow:0 2px 7px rgba(34,38,42,0.075)}
.dot{width:5px;height:5px;border-radius:50%;flex-shrink:0;margin-left:auto}
.rn{font-family:'Roboto Mono',monospace;font-size:10.5px;font-weight:400;letter-spacing:0.5px;opacity:.55;width:20px;text-align:left;flex-shrink:0;font-variant-numeric:tabular-nums}
.nm{font-size:14.5px;font-weight:500;letter-spacing:0.3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.av{border-radius:50%;object-fit:cover;flex-shrink:0;display:block;box-shadow:0 2px 6px rgba(34,38,42,0.16), 0 0 0 1.5px rgba(255,255,255,0.85)}
.foot{display:flex;justify-content:space-between;align-items:baseline;margin-top:14px}
.pg{font-family:'Roboto Mono',monospace;font-size:9.5px;letter-spacing:1px;color:${DP.soft}}`;
}
function dgTopHTML(users, meta) {
  const rows = users.slice(0, 10).map(u => dpRow(u, 30, 14.5)).join('');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${dpFontLink()}<style>${dgCSS()}</style></head><body>
  <div class="page">${dpBgBlobs(users, meta, 62, 0.42)}<span class="watermark">${meta.count || meta.gifters}</span>
    <div class="inner">
      ${dpHead(meta, '前十名')}
      <div class="glass"><div class="rows">${rows}</div></div>
      <div class="foot"><span class="lbl"></span><span class="pg">${rankPageCode(meta)}</span></div>
    </div>
  </div></body></html>`;
}
function dgListHTML(users, meta, pageLabel) {
  const CAP = 15, n = users.length, dense = n > CAP;
  const half = dense ? CAP : Math.ceil(n / 2);
  const rowH = dense ? Math.floor((522 - 5 * (CAP - 1)) / CAP) : 0;
  const av = dense ? 20 : 22, nmFs = dense ? 11.5 : 12.5;
  const col = arr => `<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:5px;min-height:0">${arr.map(u => dpRow(u, av, nmFs, rowH)).join('')}</div>`;
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${dpFontLink()}<style>${dgCSS()}</style></head><body>
  <div class="page">${dpBgBlobs(users, meta, 58, 0.40)}
    <div class="inner">
      <div style="display:flex;justify-content:space-between;align-items:baseline;padding-bottom:10px;border-bottom:1px solid ${DP.hair}">
        <span class="lbl">园区充电榜</span><span class="lbl">${esc(pageLabel)}</span></div>
      <div class="mt" style="margin-top:11px">${esc(meta.target)} · 共 ${meta.gifters} 位送礼人</div>
      <div class="glass" style="padding:12px 14px;justify-content:center">
        <div class="rows" style="flex:0 0 auto;flex-direction:row;gap:14px;align-items:flex-start">${col(users.slice(0, half))}${col(users.slice(half))}</div>
      </div>
      <div class="foot"><span class="lbl">${rankDate(meta.dateStr)}</span><span class="pg">${rankPageCodeOf(pageLabel, meta)}</span></div>
    </div>
  </div></body></html>`;
}
/* ---------- 2. depth-stack 层叠景深 ---------- */
function dsCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${DP.bg};color:${DP.ink};font-family:'Noto Sans SC',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.page{position:relative;width:540px;height:720px;overflow:hidden;padding:34px 38px 26px;display:flex;flex-direction:column}
.bgimg{position:absolute;inset:-90px;background-size:cover;background-position:center;z-index:0}
.veil{position:absolute;inset:0;z-index:1}
.blob-base{position:absolute;inset:0;background:#F2F0EC;z-index:0}
.blob{position:absolute;border-radius:50%;background-size:cover;background-position:center;z-index:0;opacity:.92}
.inner{position:relative;z-index:2;flex:1;display:flex;flex-direction:column;min-height:0}
.ttl{font-size:31px;font-weight:900;letter-spacing:1.5px;line-height:1.06}
.lbl{font-size:9.5px;letter-spacing:2.6px;color:${DP.soft};font-weight:500}
.mt{font-size:10.5px;letter-spacing:0.8px;color:${DP.soft}}
.stack{position:relative;flex:1;min-height:0;margin-top:20px}
.card{position:absolute;left:0;right:0;top:0;bottom:0;border-radius:20px;padding:12px 16px 8px;display:flex;flex-direction:column}
.c3{background:rgba(255,255,255,0.34);transform:translate(20px,-14px) scale(0.965);filter:blur(6px);opacity:.55}
.c2{background:rgba(255,255,255,0.5);transform:translate(10px,-7px) scale(0.983);filter:blur(2.4px);opacity:.75}
.c1{background:rgba(255,255,255,0.74);border:1px solid rgba(255,255,255,0.85);
  box-shadow:0 26px 52px rgba(34,38,42,0.16), 0 2px 6px rgba(34,38,42,0.06);
  -webkit-backdrop-filter:blur(18px) saturate(1.1);backdrop-filter:blur(18px) saturate(1.1)}
.rows{flex:1;min-height:0;display:flex;flex-direction:column;gap:6px}
.row{flex:1;min-height:0;display:flex;align-items:center;gap:9px;border-radius:12px;padding:0 10px;
  background:rgba(244,243,241,0.66);box-shadow:0 1px 3px rgba(34,38,42,0.045)}
.row.top{background:rgba(255,255,255,0.95);box-shadow:0 2px 7px rgba(34,38,42,0.08)}
.rn{font-family:'Roboto Mono',monospace;font-size:10.5px;font-weight:400;letter-spacing:0.5px;opacity:.5;width:20px;text-align:left;flex-shrink:0;font-variant-numeric:tabular-nums}
.nm{font-size:14.5px;font-weight:500;letter-spacing:0.3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chip{width:5px;height:5px;border-radius:50%;flex-shrink:0}
.av{border-radius:50%;object-fit:cover;flex-shrink:0;display:block;box-shadow:0 2px 6px rgba(34,38,42,0.18), 0 0 0 1.5px #FFFFFF}
.foot{display:flex;justify-content:space-between;align-items:baseline;margin-top:16px}
.pg{font-family:'Roboto Mono',monospace;font-size:9.5px;letter-spacing:1px;color:${DP.soft}}`;
}
function dsRowsHTML(users, av, nmFs, h) {
  return users.map(u => `<div class="row${u._rank <= 3 ? ' top' : ''}"${h ? ` style="flex:0 0 ${h}px"` : ''}><span class="rn">${String(u._rank).padStart(2, '0')}</span>${tbAv(u.avatar, av, false)}
    <span class="nm" style="font-size:${nmFs}px${u._rank <= 3 ? ';font-weight:700' : ''}">${magName(u)}</span>
    <span class="chip" style="background:${chromaOf(u)};margin-left:auto;opacity:${u._rank <= 3 ? 1 : 0.5}"></span></div>`).join('');
}
function dsTopHTML(users, meta) {
  const rows = dsRowsHTML(users.slice(0, 10), 30, 14.5);
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${dpFontLink()}<style>${dsCSS()}</style></head><body>
  <div class="page">${dpBgBlobs(users, meta, 70, 0.48)}
    <div class="inner">
      ${dpHead(meta, '前十名')}
      <div class="stack">
        <div class="card c3"></div><div class="card c2"></div><div class="card c1"><div class="rows">${rows}</div></div>
      </div>
      <div class="foot"><span class="lbl"></span><span class="pg">${rankPageCode(meta)}</span></div>
    </div>
  </div></body></html>`;
}
function dsListHTML(users, meta, pageLabel) {
  const CAP = 15, n = users.length, dense = n > CAP;
  const half = dense ? CAP : Math.ceil(n / 2);
  const rowH = dense ? Math.floor((516 - 5 * (CAP - 1)) / CAP) : 0;
  const av = dense ? 20 : 22, nmFs = dense ? 11.5 : 12.5;
  const rightN = n - half; const colAlign = rightN < half ? "flex-start" : "center"; const col = arr => `<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:5px;min-height:0">${dsRowsHTML(arr, av, nmFs, rowH)}</div>`;
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${dpFontLink()}<style>${dsCSS()}</style></head><body>
  <div class="page">${dpBgBlobs(users, meta, 66, 0.46)}
    <div class="inner">
      <div style="display:flex;justify-content:space-between;align-items:baseline;padding-bottom:10px;border-bottom:1px solid ${DP.hair}">
        <span class="lbl">园区充电榜</span><span class="lbl">${esc(pageLabel)}</span></div>
      <div class="mt" style="margin-top:11px">${esc(meta.target)} · 共 ${meta.gifters} 位送礼人</div>
      <div class="stack">
        <div class="card c3"></div><div class="card c2"></div>
        <div class="card c1" style="padding:12px 14px"><div class="rows" style="flex-direction:row;gap:14px;align-items:${colAlign}">${col(users.slice(0, half))}${col(users.slice(half))}</div></div>
      </div>
      <div class="foot"><span class="lbl">${rankDate(meta.dateStr)}</span><span class="pg">${rankPageCodeOf(pageLabel, meta)}</span></div>
    </div>
  </div></body></html>`;
}

async function render(html,outPath){const br=await chromium.launch({headless:true,executablePath:chromiumExe()});const page=await br.newPage({viewport:{width:600,height:2000},deviceScaleFactor:2});await page.setContent(html,{waitUntil:'domcontentloaded',timeout:30000});
await page.evaluate(() => { const tail = ",'Noto Sans Egyptian Hieroglyphs','Unifont Upper'";
  const re = /(sans-serif|serif|monospace|system-ui|cursive|fantasy|emoji)$/;
  document.querySelectorAll('*').forEach(el => { const cs = getComputedStyle(el).fontFamily;
    if (cs && !cs.includes('Hieroglyphs')) el.style.fontFamily = re.test(cs) ? cs.replace(re, m => tail + ',' + m) : cs + tail; }); });await page.evaluate(()=>new Promise(r=>{const imgs=document.querySelectorAll('img');let loaded=0;const check=()=>{loaded++;if(loaded>=imgs.length)r()};imgs.forEach(img=>{if(img.complete)check();else{img.onload=check;img.onerror=check}});if(!imgs.length)r();setTimeout(r,8000)}));await new Promise(r=>setTimeout(r,1000));const bodyHeight=await page.evaluate(()=>document.body.scrollHeight);const y=Math.max(0,Math.floor((bodyHeight-800)/2));await page.screenshot({path:outPath,clip:{x:0,y,width:600,height:800},type:'jpeg',quality:92});await br.close();console.log(`  ✅ ${path.basename(outPath)}`);}
async function resolveAvatar(targetNickname) {
  // 已有 --avatar 则不查
  if (TARGET_AVATAR) return TARGET_AVATAR;
  try {
    const database = db.getDb();
    // 先从 streamers 表找（主播头像）
    const streamerRow = database.prepare(
      "SELECT avatar FROM streamers WHERE name LIKE ? ORDER BY id DESC LIMIT 1"
    ).get('%' + targetNickname.substring(0, 4) + '%');
    if (streamerRow && streamerRow.avatar) {
      console.log('[avatar] 从 DB 主播表获取到头像');
      return streamerRow.avatar;
    }
    // 再从 members 表找（普通用户头像）
    const memRows = database.prepare(
      "SELECT user_sec_uid, avatar FROM members WHERE nickname LIKE ? AND user_sec_uid IS NOT NULL AND user_sec_uid != '' ORDER BY id DESC LIMIT 1"
    ).all(targetNickname.substring(0, 4) + '%');
    if (memRows.length && memRows[0].avatar) {
      console.log('[avatar] 从 DB 成员表获取到头像');
      return memRows[0].avatar;
    }
    const secUid = memRows.length ? memRows[0].user_sec_uid : null;
    if (!secUid) { console.warn('[avatar] 未在 DB 中找到 secUid，使用占位头像'); return ''; }
    const du = require('./douyin-user.js');
    const info = await du.fetchUserBySecUid(secUid);
    if (info && info.avatar) { console.log('[avatar] 已从 douyin-user 获取头像:', info.nickname); return info.avatar; }
  } catch(e) { console.warn('[avatar] 获取失败:', e.message); }
  return '';
}

async function main(){
  // 自动获取头像
  TARGET_AVATAR = await resolveAvatar(target);
  // 计算日期范围
  const database = db.getDb();
  const ph = sessionIds.map(()=>'?').join(',');
  const d = database.prepare(`SELECT MIN(create_time) as start_time, MAX(create_time) as end_time FROM gifts WHERE session_id IN (${ph})`).get(...sessionIds);
  const startDate = new Date(d.start_time).toLocaleDateString('zh-CN', {timeZone:'Asia/Shanghai', month:'numeric', day:'numeric'}).replace('/', '月') + '日';
  const endDate = new Date(d.end_time).toLocaleDateString('zh-CN', {timeZone:'Asia/Shanghai', month:'numeric', day:'numeric'}).replace('/', '月') + '日';
  const dateStr = startDate === endDate ? startDate : startDate.replace('日','') + '-' + endDate;
  const sessionStr = sessionIds.length === 1 ? `Session ${sessionIds[0]}` : `Session ${sessionIds[0]}-${sessionIds[sessionIds.length-1]}`;
  HEADER_DATE = `${dateStr} · ${sessionStr}`;

  console.log('📊 Loading data...');const users=await getData();console.log(`  ${users.length} users`);const total=users.slice(0,100);total.forEach((u,i)=>u._rank=i+1);
  if (MAG_VARIANT) {
    await renderMagazine(MAG_VARIANT, total, { target, avatar: TARGET_AVATAR, dateStr, sessionStr: `第 ${sessionIds.join('-')} 场` });
    console.log(`\n✅ Done (${MAG_VARIANT})!`);
    return;
  }
const n=total.length;const topN=Math.min(10,n);const restCount=n-topN;const perPage=Math.ceil(restCount/3);console.log('🖼️  Image 1/4 (TOP '+topN+')...');await render(genTop10HTML(total.slice(0,topN),'TOP '+topN),path.join(outputDir,'thanks_rank_p1.jpg'));const pages=[{start:topN,end:Math.min(topN+perPage,n),label:`第${topN+1}-${Math.min(topN+perPage,n)}名`},{start:Math.min(topN+perPage,n),end:Math.min(topN+perPage*2,n),label:`第${Math.min(topN+perPage,n)+1}-${Math.min(topN+perPage*2,n)}名`},{start:Math.min(topN+perPage*2,n),end:n,label:`第${Math.min(topN+perPage*2,n)+1}-${n}名`}];for(let i=0;i<3;i++){const p=pages[i];if(p.start>=p.end)continue;console.log(`🖼️  Image ${i+2}/4 (${p.label})...`);await render(genHTML(total.slice(p.start,p.end),p.label),path.join(outputDir,`thanks_rank_p${i+2}.jpg`));}console.log('\n✅ Done!');}
main().catch(e=>{console.error(e);process.exit(1);});
