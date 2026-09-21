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
// 模板切换：--theme=magazine-v1|magazine-v2|magazine-v3（不传则沿用原有主题，行为不变）
const THEME_ARG = (() => {
  const eq = process.argv.find(a => a.startsWith('--theme='));
  if (eq) return eq.slice('--theme='.length);
  const i = process.argv.indexOf('--theme');
  return i >= 0 ? (process.argv[i + 1] || '') : '';
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
    if (!userMap[k]) userMap[k] = { nickname: g.nickname, displayId: g.user_display_id || '', avatar: g.avatar || '', diamonds: 0 };
    userMap[k].diamonds += g.total_diamonds;
    if (g.nickname) userMap[k].nickname = g.nickname;
    if (g.avatar) userMap[k].avatar = g.avatar;
  }
  return Object.values(userMap).sort((a, b) => b.diamonds - a.diamonds).slice(0, 100);
}
function cleanDisplayName(name){if(!name)return name;const r=[];let i=0;while(i<name.length){const c=name.codePointAt(i);const l=c>0xFFFF?2:1;if(c>=0x1D400&&c<=0x1D7FF){const b=c-0x1D400;const idx=b%52;if(idx<26)r.push(String.fromCharCode(65+idx));else r.push(String.fromCharCode(97+idx-26));}else if((c>=0x13000&&c<=0x1342F)||(c>=0x1F000&&c<=0x1FFFF)){}else{r.push(String.fromCodePoint(c));}i+=l;}const s=r.join('');return s||name;}
function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function fmtD(n){return (Number(n)||0).toLocaleString('en-US');}
function rankBadge(i){const t=activeTheme;if(i===0)return`<svg viewBox="0 0 24 24" width="18" height="18" style="vertical-align:middle"><circle cx="12" cy="12" r="11" fill="#FFD700"/><text x="12" y="17" text-anchor="middle" font-size="14" font-weight="bold" fill="${t.badgeText}">1</text></svg>`;if(i===1)return`<svg viewBox="0 0 24 24" width="18" height="18" style="vertical-align:middle"><circle cx="12" cy="12" r="11" fill="#C0C0C0"/><text x="12" y="17" text-anchor="middle" font-size="14" font-weight="bold" fill="${t.badgeText}">2</text></svg>`;if(i===2)return`<svg viewBox="0 0 24 24" width="18" height="18" style="vertical-align:middle"><circle cx="12" cy="12" r="11" fill="#CD7F32"/><text x="12" y="17" text-anchor="middle" font-size="14" font-weight="bold" fill="#fff">3</text></svg>`;const n=i+1;return`<svg viewBox="0 0 24 24" width="18" height="18" style="vertical-align:middle"><circle cx="12" cy="12" r="10" fill="${t.badgeFill}" stroke="${t.badgeStroke}" stroke-width="1"/><text x="12" y="16" text-anchor="middle" font-size="12" font-weight="bold" fill="${t.badgeTextMuted}">${n}</text></svg>`;}
function avatarImg(url,size,extra){const t=activeTheme;const ph=`<span style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:50%;background:${t.avatarFallbackBg};color:${t.avatarFallbackColor};font-size:${Math.round(size*0.45)}px;flex-shrink:0;vertical-align:middle;margin-right:8px;${extra||''}">?</span>`;if(!url)return ph;let u=url.startsWith('//')?'https:'+url:url;const id='av'+Math.random().toString(36).slice(2,8);return`<span id="${id}" style="display:inline-block;vertical-align:middle;margin-right:8px;flex-shrink:0;${extra||''}"><img src="${u}" width="${size}" height="${size}" style="display:block;border-radius:50%;object-fit:cover" /></span>`;}

function genTop10HTML(users,pageLabel){const t=activeTheme;const top3=users.slice(0,3);const rest=users.slice(3);const top3Cards=top3.map((u,idx)=>`<div style="display:flex;align-items:center;gap:14px;background:${t.top3Bgs[idx]};border:1px solid ${t.top3Borders[idx]};border-radius:16px;padding:14px 18px;margin-bottom:8px"><div style="width:48px;height:48px;border-radius:50%;background:${t.badgeFill};display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden">${!u.avatar?`<span style="display:inline-block;width:44px;height:44px;border-radius:50%;background:${t.avatarFallbackBg}">`:''}${!u.avatar?'</span>':`<img src="${u.avatar.startsWith('//')?'https:'+u.avatar:u.avatar}" width="44" height="44" style="display:block;border-radius:50%;object-fit:cover;width:44px;height:44px" />`}</div><div style="flex:1;min-width:0"><div style="font-size:17px;font-weight:800;color:${t.top3Name};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(cleanDisplayName(u.nickname||'未知'))}</div></div><div style="text-align:right;flex-shrink:0;display:flex;align-items:center;gap:10px">${rankBadge(idx)}<span style="font-size:15px;font-weight:800;color:${t.top3Colors[idx]};font-variant-numeric:tabular-nums;white-space:nowrap">${fmtD(u.diamonds)} <span style="font-size:12px">💎</span></span></div></div>`).join('\n');const restRows=rest.map(u=>`<tr><td class="rank">${rankBadge(u._rank-1)}</td><td class="name"><span class="name-wrap">${avatarImg(u.avatar,22)}<span class="name-text to-text" title="${esc(cleanDisplayName(u.nickname||'未知'))}">${esc(cleanDisplayName(u.nickname||'未知'))}</span></span></td><td class="dia">${fmtD(u.diamonds)} 💎</td></tr>`).join('\n');
return`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><style>@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;600;700;800;900&display=swap');*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Noto Sans SC',-apple-system,BlinkMacSystemFont,sans-serif;background:${t.bg};min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px;position:relative}.bg-pattern{position:fixed;top:0;left:0;width:100%;height:100%;background-image:radial-gradient(circle at 20% 30%,${t.pattern1} 0%,transparent 50%),radial-gradient(circle at 80% 70%,${t.pattern2} 0%,transparent 50%);pointer-events:none}.card{width:540px;max-width:100%;background:${t.cardBg};backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid ${t.cardBorder};border-radius:24px;padding:0;box-shadow:${t.boxShadow};overflow:hidden;position:relative;z-index:2}${t.decor?`.card::after{content:'';position:absolute;top:0;left:0;width:100%;height:100%;background-image:url(data:image/svg+xml;base64,${petalsB64});background-size:cover;opacity:0.18;pointer-events:none;z-index:0}`:''}table{width:100%;border-collapse:collapse;table-layout:fixed}tr{border-bottom:1px solid ${t.divider};height:38px}tr:last-child{border-bottom:none}td{padding:0 6px;font-size:15px;color:${t.rowText};vertical-align:middle!important;line-height:1.55}td.rank{width:34px;text-align:center;font-size:15px;font-weight:600;vertical-align:middle!important;line-height:1}td.name{white-space:nowrap;overflow:hidden;font-weight:700;display:flex;align-items:center;height:38px}.name-wrap{display:contents}.name-text{vertical-align:middle;overflow:hidden;text-overflow:ellipsis;display:inline-block}.to-text{max-width:300px}td.dia{width:78px;text-align:right;font-size:14px;font-weight:800;color:${t.textSecondary};font-variant-numeric:tabular-nums;white-space:nowrap}.footer{text-align:center;padding:10px 24px 14px;font-size:10px;color:${t.footerText};letter-spacing:0.5px}</style></head><body><div class="bg-pattern"></div><div class="card" style="padding:0!important"><div style="display:flex;align-items:center;gap:14px;padding:16px 20px;background:linear-gradient(180deg,${t.headerTint} 0%,transparent 100%);border-bottom:1px solid ${t.dividerHeader}"><div style="width:44px;height:44px;border-radius:50%;background:${t.avatarRing};display:flex;align-items:center;justify-content:center;flex-shrink:0"><img src="${TARGET_AVATAR}" style="width:40px;height:40px;border-radius:50%;object-fit:cover"/></div><div style="flex:1;min-width:0"><div style="font-size:18px;font-weight:700;color:${t.headerTitle};line-height:1.3">${esc(target)}</div><div style="font-size:12px;color:${t.headerDate};margin-top:4px">${HEADER_DATE}</div></div><div style="text-align:right;flex-shrink:0"><div style="font-size:15px;font-weight:800;color:${t.textSecondary};letter-spacing:0.5px">🔋 园区充电榜</div></div></div><div style="font-size:13px;font-weight:700;color:${t.sectionTitle};padding:14px 24px 6px;letter-spacing:0.5px;border-bottom:1px solid ${t.dividerSection}">🔋 园区充电榜 · ${pageLabel}</div><div style="padding:14px 24px 32px">${top3Cards}${rest.length>0?`<div style="font-size:12px;font-weight:700;color:${t.subsectionLabel};margin:12px 0 6px;letter-spacing:0.5px">🏅 第4-10名</div><table>${restRows}</table>`:''}</div><div class="footer">由 404 · 抖音直播监控 生成</div></div></body></html>`;}

function makeRowHTML(entries){return entries.map(([rankIdx,s])=>{const isTop3=rankIdx<3;const top3cls=isTop3?` class="row-top3 row-${['1st','2nd','3rd'][rankIdx]}"`:'';return`<tr${top3cls}><td class="rank">${rankBadge(rankIdx)}</td><td class="name"><span class="name-wrap">${avatarImg(s.avatar,22)}<span class="name-text to-text" title="${esc(cleanDisplayName(s.name))}">${esc(cleanDisplayName(s.name))}</span></span></td><td class="dia">${fmtD(s.diamonds)} 💎</td></tr>`;}).join('');}

function genHTML(users,pageLabel){const t=activeTheme;const perCol=Math.ceil(users.length/2);const left=users.slice(0,perCol).map(u=>[u._rank-1,{name:u.nickname,avatar:u.avatar,diamonds:u.diamonds}]);const right=users.slice(perCol).map(u=>[u._rank-1,{name:u.nickname,avatar:u.avatar,diamonds:u.diamonds}]);
return`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><style>@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;600;700;800;900&display=swap');*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Noto Sans SC',-apple-system,BlinkMacSystemFont,sans-serif;background:${t.bg};min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px;position:relative}.bg-pattern{position:fixed;top:0;left:0;width:100%;height:100%;background-image:radial-gradient(circle at 20% 30%,${t.pattern1} 0%,transparent 50%),radial-gradient(circle at 80% 70%,${t.pattern2} 0%,transparent 50%);pointer-events:none}.card{width:540px;max-width:100%;background:${t.cardBg};backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid ${t.cardBorder};border-radius:24px;padding:0;box-shadow:${t.boxShadow};overflow:visible;position:relative;z-index:2}${t.decor?`.card::after{content:'';position:absolute;top:0;left:0;width:100%;height:100%;background-image:url(data:image/svg+xml;base64,${petalsB64});background-size:cover;opacity:0.18;pointer-events:none;z-index:0}`:''}table{width:100%;border-collapse:collapse;table-layout:fixed}tr{border-bottom:1px solid ${t.divider};height:38px}tr:last-child{border-bottom:none}td{padding:0 6px;font-size:15px;color:${t.rowText};vertical-align:middle!important;line-height:1.55}td.rank{width:34px;text-align:center;font-size:15px;font-weight:600;vertical-align:middle!important;line-height:1}.row-1st td.name{color:${t.top3Colors[0]}}.row-2nd td.name{color:${t.top3Colors[1]}}.row-3rd td.name{color:${t.top3Colors[2]}}.row-top3 td{padding:6px 4px;color:${t.top3Name}}td.name{white-space:nowrap;overflow:hidden;font-weight:700;vertical-align:middle!important}.name-wrap{display:inline-flex;align-items:center;gap:4px;height:100%}.name-text{vertical-align:middle;overflow:hidden;text-overflow:ellipsis;display:inline-block}.to-text{max-width:106px}td.dia,.ranking-col td.dia{width:64px;text-align:right;font-size:12px;font-weight:800;color:${t.textSecondary};font-variant-numeric:tabular-nums;white-space:nowrap;padding-right:0}.ranking-grid{display:grid;gap:10px;padding:0}.ranking-col td{padding:0 4px;font-size:15px;vertical-align:middle!important;height:38px}.ranking-col td.rank{width:30px;font-size:15px;vertical-align:middle!important;text-align:center;line-height:1}.ranking-col td.name{white-space:nowrap;overflow:hidden;font-size:15px;display:flex;align-items:center}.ranking-col td.name .name-wrap{display:contents}.ranking-col .name-text{overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}.ranking-col .row-top3 td{padding:0 4px}.footer{text-align:center;padding:10px 24px 14px;font-size:10px;color:${t.footerText};letter-spacing:0.5px}</style></head><body><div class="bg-pattern"></div><div class="card" style="padding:0!important"><div style="display:flex;align-items:center;gap:14px;padding:16px 20px;background:linear-gradient(180deg,${t.headerTint} 0%,transparent 100%);border-bottom:1px solid ${t.dividerHeader}"><div style="width:44px;height:44px;border-radius:50%;background:${t.avatarRing};display:flex;align-items:center;justify-content:center;flex-shrink:0"><img src="${TARGET_AVATAR}" style="width:40px;height:40px;border-radius:50%;object-fit:cover"/></div><div style="flex:1;min-width:0"><div style="font-size:18px;font-weight:700;color:${t.headerTitle};line-height:1.3">${esc(target)}</div><div style="font-size:12px;color:${t.headerDate};margin-top:4px">${HEADER_DATE}</div></div><div style="text-align:right;flex-shrink:0"><div style="font-size:15px;font-weight:800;color:${t.textSecondary};letter-spacing:0.5px">🔋 园区充电榜</div></div></div><div style="font-size:13px;font-weight:700;color:${t.sectionTitle};padding:14px 24px 6px;letter-spacing:0.5px;border-bottom:1px solid ${t.dividerSection}">🔋 园区充电榜 · ${pageLabel}</div><div style="padding:6px 24px 14px"><div class="ranking-grid" style="grid-template-columns:1fr 1fr;gap:10px"><div class="ranking-col"><table style="width:100%;table-layout:fixed"><tbody>${makeRowHTML(left)}</tbody></table></div><div class="ranking-col"><table style="width:100%;table-layout:fixed"><tbody>${makeRowHTML(right)}</tbody></table></div></div></div><div class="footer">由 404 · 抖音直播监控 生成</div></div></body></html>`;}

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
const MAG_THEME_NAMES = ['magazine-v1', 'magazine-v2', 'magazine-v3', 'guofeng'];
const MAG_VARIANT = MAG_THEME_NAMES.includes(THEME_ARG) ? THEME_ARG : null;
// 是否显示钻石数：提名榜（thanks-rank.js）不显示，钻石榜显示
const MAG_AMOUNT = true;

/** 自动探测 playwright 已装的 chromium headless shell（写死版本号会随升级失效） */
function chromiumExe() {
  const base = '/opt/hermes/.playwright';
  try {
    const dirs = fs.readdirSync(base).filter(d => d.startsWith('chromium_headless_shell-'))
      .sort((a, b) => Number(a.split('-').pop()) - Number(b.split('-').pop()));
    for (let i = dirs.length - 1; i >= 0; i--) {
      const p = path.join(base, dirs[i], 'chrome-headless-shell-linux64', 'chrome-headless-shell');
      if (fs.existsSync(p)) return p;
    }
  } catch (e) { /* 回退到 playwright 默认解析 */ }
  return undefined;
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
    <div style="display:flex;align-items:center;height:${rowH}px;gap:9px;border-bottom:1px solid ${MAG.ruleLight}">
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
  return magDoc('园区充电榜', '', `<div class="page" style="padding:42px 40px 30px;justify-content:space-between">
    <div>
      <div style="text-align:center"><span class="masthead" style="letter-spacing:7px;font-size:17px">园区充电榜</span></div>
      <div class="rule" style="width:44px;margin:13px auto 0;background:${MAG.ink};height:2px"></div>
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
function magTopV3(users, meta) {
  const A = MAG_AMOUNT;
  const half = Math.ceil(users.length / 2);
  const col = (arr, offset) => `<div style="flex:1;min-width:0">${arr.map((u, i) => `
    <div class="rowrule" style="display:flex;align-items:center;gap:9px;padding:${A ? 15 : 25}px 0">
      <span class="num" style="width:30px;font-size:${A ? 25 : 28}px;color:rgba(26,26,30,0.42)">${String(offset + i + 1).padStart(2, '0')}</span>
      <span style="flex:1;min-width:0">
        <span style="display:block;font-size:${A ? 14.5 : 15.5}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${magName(u)}</span>
        ${A ? `<span class="meta" style="display:block;font-size:11px;margin-top:3px">${fmtD(u.diamonds)} 钻</span>` : ''}
      </span>
    </div>`).join('')}</div>`;
  return magDoc('园区充电榜', '', `<div class="page" style="justify-content:space-between">
    <div>
      <div class="masthead" style="font-size:19px;letter-spacing:4px">园区充电榜</div>
      <div style="width:34px;height:2px;background:${MAG.accent};margin:11px 0 0"></div>
      <div class="meta" style="margin-top:12px">${esc(meta.dateStr)} · ${esc(meta.sessionStr)}</div>
      <div style="font-size:15px;margin-top:7px">${esc(meta.target)}</div>
      <div class="rule" style="margin:14px 0 0"></div>
    </div>
    <div style="display:flex;gap:26px;align-items:flex-start">${col(users.slice(0, half), 0)}${col(users.slice(half), half)}</div>
    <div>
      <div class="rule"></div>
      <div class="meta" style="margin-top:11px">${A ? `共 ${meta.gifters} 位送礼人 · ${magTotalText(meta)} ${fmtD(meta.total)} 钻` : `共 ${meta.gifters} 位送礼人`}</div>
    </div>
  </div>`);
}

/** 名次页（三套模板共用排版规则，只换刊头信息） */
function magListHTML(variant, users, meta, pageLabel) {
  const A = MAG_AMOUNT;
  const half = Math.ceil(users.length / 2);
  const col = (arr, offset) => `<div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:space-between">${arr.map((u, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:${A ? 8 : 10}px 0;border-bottom:1px solid ${MAG.ruleLight}">
      <span class="num" style="width:22px;font-size:12px;color:${MAG.inkFaint}">${offset + i + 1}</span>
      ${magAvatar(u.avatar, A ? 20 : 24)}
      <span style="flex:1;min-width:0;font-size:${A ? 13.5 : 14.5}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${magName(u)}</span>
      ${A ? `<span class="amt" style="font-size:12.5px;flex-shrink:0;margin-left:8px">${fmtD(u.diamonds)}</span>` : ''}
    </div>`).join('')}</div>`;
  return magDoc('园区充电榜 · ' + pageLabel, '', `<div class="page" style="padding:40px 40px 30px">
    <div style="display:flex;justify-content:space-between;align-items:baseline">
      <div class="masthead" style="font-size:16px;letter-spacing:4px">园区充电榜</div>
      <div class="meta">${esc(pageLabel)}</div>
    </div>
    <div class="rule" style="margin:11px 0 4px"></div>
    <div style="flex:1;display:flex;gap:26px;align-items:stretch">${col(users.slice(0, half), users.length ? users[0]._rank - 1 : 0)}${col(users.slice(half), users.length ? users[half]._rank - 1 : 0)}</div>
    <div class="rule"></div>
    <div class="meta" style="margin-top:10px">${esc(meta.target)} · ${esc(meta.sessionStr)} · 共 ${meta.gifters} 位送礼人</div>
  </div>`);
}

function magTopHTML(variant, users, meta) {
  if (variant === 'guofeng') return gfTopHTML(users, meta);
  if (variant === 'magazine-v2') return magTopV2(users, meta);
  if (variant === 'magazine-v3') return magTopV3(users, meta);
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
  meta.capped = n >= 100;
  meta.total = magTotal(users);
  const base = path.join(outputDir, `thanks_rank_${sessionIds.join('-')}_dia_${suffix}`);
  console.log(`📐 模板 ${variant} · ${n} 人${MAG_AMOUNT ? ' · 收礼合计 ' + fmtD(meta.total) : ''}`);
  await renderMag(magTopHTML(variant, users.slice(0, topN), meta), `${base}_p1.jpg`);
  if (restCount > 0) {
    const perPage = Math.ceil(restCount / 3);
    for (let i = 0; i < 3; i++) {
      const start = topN + perPage * i, end = Math.min(topN + perPage * (i + 1), n);
      if (start >= end) continue;
      const label = `第 ${start + 1}-${end} 名`;
      console.log(`🖼️  名次页 ${i + 2}/4 (${label})`);
      const listHtml = variant === 'guofeng' ? gfListHTML(users.slice(start, end), meta, label) : magListHTML(variant, users.slice(start, end), meta, label);
      await renderMag(listHtml, `${base}_p${i + 2}.jpg`);
    }
  }
}

// ==================== 古风·现代中式极简（guofeng）====================
// 浅米纸 + 宋体排版 + 一条通栏白描插画带 + 一枚朱砂小印
// 除印章的朱砂外，画面里没有任何彩色/发光/阴影/渐变
const GF = {
  paper: '#FAF8F3', ink: '#1C1A17',
  ink2: 'rgba(28,26,23,0.60)', ink3: 'rgba(28,26,23,0.34)',
  rule: 'rgba(28,26,23,0.22)', ruleLite: 'rgba(28,26,23,0.10)',
  cinnabar: '#A8372A',
  serif: "'Noto Serif SC','Songti SC',serif",
};
const GF_SEAL_TEXT = '林语巷';
const GF_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

let _gfAssets = null;
function gfAssets() {
  if (_gfAssets) return _gfAssets;
  const read = (f, mime) => {
    try { return 'data:' + mime + ';base64,' + fs.readFileSync(path.join(__dirname, 'assets', f)).toString('base64'); }
    catch (e) { return ''; }
  };
  _gfAssets = { illustration: read('guofeng-illustration.png', 'image/png') };
  return _gfAssets;
}
function gfFontLink() {
  return `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@300;400;500;600;700&display=swap">`;
}
function gfCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${GF.paper};color:${GF.ink};font-family:${GF.serif};-webkit-font-smoothing:antialiased}
.page{position:relative;width:540px;height:720px;display:flex;flex-direction:column;padding:44px 0 38px}
.inset{padding-left:40px;padding-right:40px}
.masthead{font-size:26px;font-weight:400;letter-spacing:9px;line-height:1;text-indent:9px}
.sub{font-size:13.5px;letter-spacing:1px;color:${GF.ink2}}
.sub2{font-size:10.5px;letter-spacing:1.5px;color:${GF.ink3}}
.label{font-size:11px;letter-spacing:4px;color:${GF.ink3}}
.rule{height:1px;background:${GF.rule}}
.rule-lite{height:1px;background:${GF.ruleLite}}
.nm{font-size:15px;line-height:1.3}
.amt{font-variant-numeric:tabular-nums;font-weight:500}
.av{border-radius:50%;object-fit:cover;vertical-align:middle;flex-shrink:0}
.row{display:flex;align-items:center;gap:10px;border-bottom:1px solid ${GF.ruleLite}}
.row:last-child{border-bottom:none}`;
}
function gfDoc(title, body) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${gfFontLink()}<title>${esc(title)}</title><style>${gfCSS()}</style></head><body>${body}</body></html>`;
}
function gfIllustration() {
  const a = gfAssets();
  if (!a.illustration) return '';
  return `<img src="${a.illustration}" style="width:100%;display:block" />`;
}
function gfSeal() {
  return `<div style="position:absolute;right:34px;bottom:34px;width:30px;height:30px;border:1.5px solid ${GF.cinnabar};border-radius:2px;display:flex;align-items:center;justify-content:center">
    <span style="writing-mode:vertical-rl;color:${GF.cinnabar};font-size:9.5px;letter-spacing:0.5px;line-height:1.1">${esc(GF_SEAL_TEXT)}</span>
  </div>`;
}
function gfRow(u, label, opts) {
  const A = MAG_AMOUNT;
  const lead = opts.lead, big = opts.big;
  return `<div class="row" style="flex:1;min-height:0;height:auto">
    <span class="${opts.kaiNum ? '' : ''}" style="width:${big ? 22 : 26}px;font-size:${big ? 13 : 11.5}px;color:${lead ? GF.ink : GF.ink3};text-align:center">${label}</span>
    ${magAvatar(u.avatar, big ? 30 : 24)}
    <span class="nm" style="flex:1;min-width:0;font-size:${lead ? (big ? 17 : 15) : (big ? 15.5 : 13.5)}px;font-weight:${lead ? 600 : 400};color:${GF.ink};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${magName(u)}</span>
    ${A ? `<span class="amt" style="font-size:${big ? 13.5 : 12.5}px;flex-shrink:0;color:${GF.ink2}">${fmtD(u.diamonds)}</span>` : ''}
  </div>`;
}
/** 封面：榜头 → 通栏白描插画 → 前十名两栏 → 朱砂小印 */
function gfTopHTML(users, meta) {
  const A = MAG_AMOUNT;
  const top = users.slice(0, 10);
  const half = Math.ceil(top.length / 2);
  const col = (arr, startRank) => arr.map((u, i) => gfRow(u, String(startRank + i).padStart(2, '0'), { lead: startRank + i === 1, big: true, kaiNum: false })).join('');
  return gfDoc('园区充电榜', `<div class="page">
    <div class="inset" style="text-align:center">
      <div class="masthead">园区充电榜</div>
      <div class="sub" style="margin-top:18px">${esc(meta.target)} · 共 ${meta.gifters} 位送礼人</div>
      <div class="sub2" style="margin-top:9px">${esc(meta.dateStr)} · ${esc(meta.sessionStr)}</div>
      ${A ? `<div class="sub2" style="margin-top:7px">${magTotalText(meta)} <span class="amt" style="font-size:11.5px;color:${GF.ink2}">${fmtD(meta.total)}</span></div>` : ''}
    </div>
    <div class="rule" style="margin:26px 40px 0"></div>
    <div style="margin-top:0">${gfIllustration()}</div>
    <div class="rule" style="margin:0 40px"></div>
    <div class="inset" style="margin-top:18px;display:flex;align-items:baseline;justify-content:space-between">
      <span class="label">前十名</span>
      <span class="sub2">按送礼钻石排序</span>
    </div>
    <div class="inset" style="flex:1;display:flex;gap:26px;padding-top:8px;min-height:0">
      <div style="flex:1;min-width:0;display:flex;flex-direction:column">${col(top.slice(0, half), 1)}</div>
      <div style="flex:1;min-width:0;display:flex;flex-direction:column">${col(top.slice(half), half + 1)}</div>
    </div>
    ${gfSeal()}
  </div>`);
}
/** 名次页：榜头 + 两栏紧凑名单 */
function gfListHTML(users, meta, pageLabel) {
  const A = MAG_AMOUNT;
  const half = Math.ceil(users.length / 2);
  const col = (arr, offset) => arr.map((u, i) => gfRow(u, String(offset + i + 1), { lead: false, big: false, kaiNum: false })).join('');
  return gfDoc('园区充电榜 · ' + pageLabel, `<div class="page" style="padding:40px 0 34px">
    <div class="inset" style="display:flex;justify-content:space-between;align-items:baseline">
      <div style="font-size:18px;letter-spacing:5px">园区充电榜</div>
      <div class="sub2">${esc(pageLabel)}</div>
    </div>
    <div class="rule" style="margin:16px 40px 0"></div>
    <div class="inset" style="flex:1;display:flex;gap:26px;padding-top:10px;min-height:0">
      <div style="flex:1;min-width:0;display:flex;flex-direction:column">${col(users.slice(0, half), users.length ? users[0]._rank - 1 : 0)}</div>
      <div style="flex:1;min-width:0;display:flex;flex-direction:column">${col(users.slice(half), users.length ? users[half]._rank - 1 : 0)}</div>
    </div>
    <div class="sub2 inset" style="margin-top:14px;text-align:center">${esc(meta.target)} · ${esc(meta.sessionStr)} · 共 ${meta.gifters} 位送礼人</div>
    ${gfSeal()}
  </div>`);
}

async function render(html,outPath){const br=await chromium.launch({headless:true,executablePath:chromiumExe()});const page=await br.newPage({viewport:{width:600,height:2000},deviceScaleFactor:2});await page.setContent(html,{waitUntil:'domcontentloaded',timeout:30000});await page.evaluate(()=>new Promise(r=>{const imgs=document.querySelectorAll('img');let loaded=0;const check=()=>{loaded++;if(loaded>=imgs.length)r()};imgs.forEach(img=>{if(img.complete)check();else{img.onload=check;img.onerror=check}});if(!imgs.length)r();setTimeout(r,8000)}));await new Promise(r=>setTimeout(r,1000));const bodyHeight=await page.evaluate(()=>document.body.scrollHeight);const y=Math.max(0,Math.floor((bodyHeight-800)/2));await page.screenshot({path:outPath,clip:{x:0,y,width:600,height:800},type:'jpeg',quality:92});await br.close();console.log(`  ✅ ${path.basename(outPath)}`);}
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
const n=total.length;const topN=Math.min(10,n);const restCount=n-topN;const perPage=Math.ceil(restCount/3);console.log('🖼️  Image 1/4 (TOP '+topN+')...');await render(genTop10HTML(total.slice(0,topN),'TOP '+topN),path.join(outputDir,`thanks_rank_${sessionIds.join('-')}_dia_p1.jpg`));const pages=[{start:topN,end:Math.min(topN+perPage,n),label:`第${topN+1}-${Math.min(topN+perPage,n)}名`},{start:Math.min(topN+perPage,n),end:Math.min(topN+perPage*2,n),label:`第${Math.min(topN+perPage,n)+1}-${Math.min(topN+perPage*2,n)}名`},{start:Math.min(topN+perPage*2,n),end:n,label:`第${Math.min(topN+perPage*2,n)+1}-${n}名`}];for(let i=0;i<3;i++){const p=pages[i];if(p.start>=p.end)continue;console.log(`🖼️  Image ${i+2}/4 (${p.label})...`);await render(genHTML(total.slice(p.start,p.end),p.label),path.join(outputDir,`thanks_rank_${sessionIds.join('-')}_dia_p${i+2}.jpg`));}console.log('\n✅ Done!');}
main().catch(e=>{console.error(e);process.exit(1);});
