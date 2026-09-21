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
    if (!userMap[k]) userMap[k] = { nickname: g.nickname, displayId: g.user_display_id || '', avatar: g.avatar || '', diamonds: 0, gifts: 0 };
    userMap[k].diamonds += g.total_diamonds;
    userMap[k].gifts = (userMap[k].gifts || 0) + 1;
    if (g.nickname) userMap[k].nickname = g.nickname;
    if (g.avatar) userMap[k].avatar = g.avatar;
  }
  return Object.values(userMap).sort((a, b) => b.diamonds - a.diamonds).slice(0, 100);
}
function fmtD(n){return (Number(n)||0).toLocaleString('en-US');}
function cleanDisplayName(name){if(!name)return name;const r=[];let i=0;while(i<name.length){const c=name.codePointAt(i);const l=c>0xFFFF?2:1;if(c>=0x1D400&&c<=0x1D7FF){const b=c-0x1D400;const idx=b%52;if(idx<26)r.push(String.fromCharCode(65+idx));else r.push(String.fromCharCode(97+idx-26));}else if((c>=0x13000&&c<=0x1342F)||(c>=0x1F000&&c<=0x1FFFF)){}else{r.push(String.fromCodePoint(c));}i+=l;}const s=r.join('');return s||name;}
function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function rankBadge(i){const t=activeTheme;if(i===0)return`<svg viewBox="0 0 24 24" width="18" height="18" style="vertical-align:middle"><circle cx="12" cy="12" r="11" fill="#FFD700"/><text x="12" y="17" text-anchor="middle" font-size="14" font-weight="bold" fill="${t.badgeText}">1</text></svg>`;if(i===1)return`<svg viewBox="0 0 24 24" width="18" height="18" style="vertical-align:middle"><circle cx="12" cy="12" r="11" fill="#C0C0C0"/><text x="12" y="17" text-anchor="middle" font-size="14" font-weight="bold" fill="${t.badgeText}">2</text></svg>`;if(i===2)return`<svg viewBox="0 0 24 24" width="18" height="18" style="vertical-align:middle"><circle cx="12" cy="12" r="11" fill="#CD7F32"/><text x="12" y="17" text-anchor="middle" font-size="14" font-weight="bold" fill="#fff">3</text></svg>`;const n=i+1;return`<svg viewBox="0 0 24 24" width="18" height="18" style="vertical-align:middle"><circle cx="12" cy="12" r="10" fill="${t.badgeFill}" stroke="${t.badgeStroke}" stroke-width="1"/><text x="12" y="16" text-anchor="middle" font-size="12" font-weight="bold" fill="${t.badgeTextMuted}">${n}</text></svg>`;}
function avatarImg(url,size,extra){const t=activeTheme;const ph=`<span style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:50%;background:${t.avatarFallbackBg};color:${t.avatarFallbackColor};font-size:${Math.round(size*0.45)}px;flex-shrink:0;vertical-align:middle;margin-right:8px;${extra||''}">?</span>`;if(!url)return ph;let u=url.startsWith('//')?'https:'+url:url;const id='av'+Math.random().toString(36).slice(2,8);return`<span id="${id}" style="display:inline-block;vertical-align:middle;margin-right:8px;flex-shrink:0;${extra||''}"><img src="${u}" width="${size}" height="${size}" style="display:block;border-radius:50%;object-fit:cover" /></span>`;}

function genTop10HTML(users,pageLabel){const t=activeTheme;const top3=users.slice(0,3);const rest=users.slice(3);const top3Cards=top3.map((u,idx)=>`<div style="display:flex;align-items:center;gap:14px;background:${t.top3Bgs[idx]};border:1px solid ${t.top3Borders[idx]};border-radius:16px;padding:14px 18px;margin-bottom:8px"><div style="width:48px;height:48px;border-radius:50%;background:${t.badgeFill};display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden">${!u.avatar?`<span style="display:inline-block;width:44px;height:44px;border-radius:50%;background:${t.avatarFallbackBg}">`:''}${!u.avatar?'</span>':`<img src="${u.avatar.startsWith('//')?'https:'+u.avatar:u.avatar}" width="44" height="44" style="display:block;border-radius:50%;object-fit:cover;width:44px;height:44px" />`}</div><div style="flex:1;min-width:0"><div style="font-size:17px;font-weight:800;color:${t.top3Name};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(cleanDisplayName(u.nickname||'未知'))}</div></div><div style="text-align:right;flex-shrink:0;display:flex;align-items:center">${rankBadge(idx)}</div></div>`).join('\n');const restRows=rest.map(u=>`<tr><td class="rank">${rankBadge(u._rank-1)}</td><td class="name"><span class="name-wrap">${avatarImg(u.avatar,22)}<span class="name-text to-text" title="${esc(cleanDisplayName(u.nickname||'未知'))}">${esc(cleanDisplayName(u.nickname||'未知'))}</span></span></td></tr>`).join('\n');
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
const MAG_THEME_NAMES = ['magazine-v1', 'magazine-v2', 'magazine-v3', 'guofeng', 'record', 'cinema', 'panel', 'blocks', 'press', 'collage', 'ticket', 'sports', 'noir', 'doodle', 'typeblast', 'typegrid', 'rankbar', 'rankstack', 'rankvcol', 'radial', 'track', 'signwall'];
const MAG_VARIANT = MAG_THEME_NAMES.includes(THEME_ARG) ? THEME_ARG : null;
// 是否显示钻石数：提名榜（thanks-rank.js）不显示，钻石榜显示
const MAG_AMOUNT = false;

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
  if (variant === 'record') return rcTopHTML(users, meta);
  if (variant === 'cinema') return cnTopHTML(users, meta);
  if (variant === 'panel') return pnTopHTML(users, meta);
  if (variant === 'blocks') return blDocTop(users, meta);
  if (variant === 'press') return prTopHTML(users, meta);
  if (variant === 'collage') return clTopHTML(users, meta);
  if (variant === 'ticket') return tkTopHTML(users, meta);
  if (variant === 'sports') return spTopHTML(users, meta);
  if (variant === 'noir') return nrTopHTML(users, meta);
  if (variant === 'doodle') return ddTopHTML(users, meta);
  if (variant === 'typeblast') return tbTopHTML(users, meta);
  if (variant === 'typegrid') return tgTopHTML(users, meta);
  if (variant === 'rankbar') return tgBarTop(users, meta);
  if (variant === 'rankstack') return tgStackTop(users, meta);
  if (variant === 'rankvcol') return tgVcolTop(users, meta);
  if (variant === 'radial') return radialTopHTML(users, meta);
  if (variant === 'track') return trackTopHTML(users, meta);
  if (variant === 'signwall') return signwallTopHTML(users, meta);
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
  meta.count = n;
  meta.capped = n >= 100;
  meta.total = magTotal(users);
  const base = path.join(outputDir, `thanks_rank_${sessionIds.join('-')}_${suffix}`);
  console.log(`📐 模板 ${variant} · ${n} 人${MAG_AMOUNT ? ' · 收礼合计 ' + fmtD(meta.total) : ''}`);
  await renderMag(magTopHTML(variant, users.slice(0, topN), meta), `${base}_p1.jpg`);
  if (restCount > 0) {
    const listPages = Math.max(3, Math.ceil(restCount / 48));
    const perPage = Math.ceil(restCount / listPages);
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
const GF = {
  paper: '#FCFAF5', ink: '#1F1C17',
  ink2: 'rgba(31,28,23,0.62)', ink3: 'rgba(31,28,23,0.34)',
  jade: '#4F8A72', jadeLite: 'rgba(79,138,114,0.62)',
  rule: 'rgba(31,28,23,0.18)', ruleLite: 'rgba(31,28,23,0.09)',
  cinnabar: '#A8372A',
  serif: "'Noto Serif SC','Songti SC',serif",
};
const GF_SEAL_TEXT = '林语巷';

let _gfAssets = null;
function gfAssets() {
  if (_gfAssets) return _gfAssets;
  const read = (f, mime) => {
    try { return 'data:' + mime + ';base64,' + fs.readFileSync(path.join(__dirname, 'assets', f)).toString('base64'); }
    catch (e) { return ''; }
  };
  _gfAssets = { blossom: read('guofeng-blossom.jpg', 'image/jpeg') };
  return _gfAssets;
}
function gfFontLink() {
  return `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@300;400;500;600;700&display=swap">`;
}
function gfCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${GF.paper};color:${GF.ink};font-family:${GF.serif};-webkit-font-smoothing:antialiased}
.page{position:relative;width:540px;height:720px;display:flex;flex-direction:column;padding:0 0 34px}
.inset{padding-left:42px;padding-right:42px}
.art{position:relative;width:540px;height:252px;overflow:hidden;flex-shrink:0}
.art img{width:100%;height:100%;object-fit:cover;object-position:66% 36%;
  -webkit-mask-image:linear-gradient(180deg,#000 58%,rgba(0,0,0,0) 100%);
  mask-image:linear-gradient(180deg,#000 58%,rgba(0,0,0,0) 100%)}
.masthead{font-size:26px;font-weight:400;letter-spacing:9px;line-height:1;text-indent:9px}
.sub{font-size:13px;letter-spacing:1px;color:${GF.ink2}}
.sub2{font-size:10.5px;letter-spacing:1.5px;color:${GF.ink3}}
.label{font-size:11px;letter-spacing:4px;color:${GF.jade}}
.rule{height:1px;background:${GF.rule}}
.nm{font-size:15.5px;line-height:1.3}
.amt{font-variant-numeric:tabular-nums;font-weight:500}
.av{border-radius:50%;object-fit:cover;vertical-align:middle;flex-shrink:0}
.row{display:flex;align-items:center;gap:10px;border-bottom:1px solid ${GF.ruleLite}}
.row:last-child{border-bottom:none}`;
}
function gfDoc(title, body) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${gfFontLink()}<title>${esc(title)}</title><style>${gfCSS()}</style></head><body>${body}</body></html>`;
}
function gfArt() {
  const a = gfAssets();
  if (!a.blossom) return '';
  return `<div class="art"><img src="${a.blossom}" /></div>`;
}
function gfSeal(size) {
  const s = size || 30;
  return `<div style="position:absolute;right:38px;bottom:32px;width:${s}px;height:${s}px;border:1.5px solid ${GF.cinnabar};border-radius:2px;display:flex;align-items:center;justify-content:center">
    <span style="writing-mode:vertical-rl;color:${GF.cinnabar};font-size:${s * 0.32}px;letter-spacing:0.5px;line-height:1.1">${esc(GF_SEAL_TEXT)}</span>
  </div>`;
}
function gfRow(u, label, opts) {
  const A = MAG_AMOUNT;
  const lead = opts.lead, big = opts.big;
  return `<div class="row" style="flex:1;min-height:0;height:auto">
    <span class="amt" style="width:${big ? 24 : 26}px;font-size:${big ? 12.5 : 11.5}px;color:${lead ? GF.jade : GF.jadeLite};font-weight:500">${label}</span>
    ${magAvatar(u.avatar, big ? 30 : 24)}
    <span class="nm" style="flex:1;min-width:0;font-size:${lead ? (big ? 17 : 15) : (big ? 15.5 : 13.5)}px;font-weight:${lead ? 600 : 400};color:${GF.ink};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${magName(u)}</span>
    ${A ? `<span class="amt" style="font-size:${big ? 13.5 : 12.5}px;flex-shrink:0;color:${GF.ink2}">${fmtD(u.diamonds)}</span>` : ''}
  </div>`;
}
/** 封面：国风插画带 → 榜头 → 前十名两栏 → 朱砂小印 */
function gfTopHTML(users, meta) {
  const A = MAG_AMOUNT;
  const top = users.slice(0, 10);
  const half = Math.ceil(top.length / 2);
  const col = (arr, startRank) => arr.map((u, i) => gfRow(u, String(startRank + i).padStart(2, '0'), { lead: startRank + i === 1, big: true })).join('');
  return gfDoc('园区充电榜', `<div class="page">
    ${gfArt()}
    <div class="inset" style="text-align:center;margin-top:6px">
      <div class="masthead">园区充电榜</div>
      <div class="sub" style="margin-top:16px">${esc(meta.target)} · 共 ${meta.gifters} 位送礼人</div>
      <div class="sub2" style="margin-top:9px">${esc(meta.dateStr)} · ${esc(meta.sessionStr)}</div>
      ${A ? `<div class="sub2" style="margin-top:7px">${magTotalText(meta)} <span class="amt" style="font-size:11.5px;color:${GF.ink2}">${fmtD(meta.total)}</span></div>` : ''}
    </div>
    <div class="inset" style="margin-top:20px;display:flex;align-items:baseline;justify-content:space-between">
      <span class="label">前十名</span>
      <span class="sub2">${esc(meta.dateStr)}</span>
    </div>
    <div class="rule" style="margin:10px 42px 0"></div>
    <div class="inset" style="flex:1;display:flex;gap:26px;padding-top:6px;min-height:0">
      <div style="flex:1;min-width:0;display:flex;flex-direction:column">${col(top.slice(0, half), 1)}</div>
      <div style="flex:1;min-width:0;display:flex;flex-direction:column">${col(top.slice(half), half + 1)}</div>
    </div>
    ${gfSeal()}
  </div>`);
}
/** 名次页：小榜头 + 两栏紧凑名单（沿用同一套字色，插画只保留顶部一条淡影） */
function gfListHTML(users, meta, pageLabel) {
  const A = MAG_AMOUNT;
  const half = Math.ceil(users.length / 2);
  const col = (arr, offset) => arr.map((u, i) => gfRow(u, String(offset + i + 1), { lead: false, big: false })).join('');
  return gfDoc('园区充电榜 · ' + pageLabel, `<div class="page" style="padding-top:0">
    <div class="art" style="height:132px;opacity:0.9"><img src="${(gfAssets().blossom || '')}" style="object-position:70% 30%" /></div>
    <div class="inset" style="display:flex;justify-content:space-between;align-items:baseline;margin-top:2px">
      <div style="font-size:19px;letter-spacing:5px">园区充电榜</div>
      <div class="sub2" style="color:${GF.jade}">${esc(pageLabel)}</div>
    </div>
    <div class="rule" style="margin:14px 42px 0"></div>
    <div class="inset" style="flex:1;display:flex;gap:26px;padding-top:8px;min-height:0">
      <div style="flex:1;min-width:0;display:flex;flex-direction:column">${col(users.slice(0, half), users.length ? users[0]._rank - 1 : 0)}</div>
      <div style="flex:1;min-width:0;display:flex;flex-direction:column">${col(users.slice(half), users.length ? users[half]._rank - 1 : 0)}</div>
    </div>
    <div class="sub2 inset" style="margin-top:12px;text-align:center">${esc(meta.target)} · ${esc(meta.sessionStr)} · 共 ${meta.gifters} 位送礼人</div>
    ${gfSeal(26)}
  </div>`);
}

// ==================== 新增三套模板：record（唱片风）/ cinema（海报风）/ panel（数据榜） ====================
// 三套共用：1080×1440（540×720 CSS @2x）、网络字体、fs.readFileSync 内联素材
const RANK_NEW_THEMES = ['record', 'cinema', 'panel'];
/** 日期串里重复的月份去掉（9月20-9月21日 → 9月20-21日） */
function rankDate(s) { return String(s || '').replace(/(\d+)月(\d+)-(\d+)月(\d+)日/, '$1月$2-$4日'); }

/* ---------- ① record：音乐唱片风（米白纸 / 极细大字 / 一处朱红 / 超大留白） ---------- */
const RC = {
  paper: '#F7F6F2', ink: '#17171A', ink2: 'rgba(23,23,26,0.62)', ink3: 'rgba(23,23,26,0.32)',
  line: 'rgba(23,23,26,0.16)', lineLite: 'rgba(23,23,26,0.07)', accent: '#C2452D',
  serif: "'Noto Serif SC','Songti SC',serif", sans: "'Noto Sans SC',system-ui,sans-serif",
};
function rcCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${RC.paper};color:${RC.ink};font-family:${RC.sans};-webkit-font-smoothing:antialiased}
.page{width:540px;height:720px;padding:74px 52px 44px;display:flex;flex-direction:column}
.mast{font-family:${RC.serif};font-weight:300;font-size:47px;letter-spacing:15px;line-height:1.1;text-indent:15px}
.sub{font-size:10.5px;letter-spacing:3.5px;color:${RC.ink2};margin-top:20px}
.rule{height:1px;background:${RC.line};margin:26px 0 0}
.row{display:flex;align-items:center;gap:16px;padding:9.5px 0;border-bottom:1px solid ${RC.lineLite}}
.row:last-child{border-bottom:none}
.num{width:28px;font-size:10.5px;letter-spacing:1.5px;color:${RC.ink3};font-variant-numeric:tabular-nums;flex-shrink:0}
.num.top{color:${RC.accent}}
.av{border-radius:50%;object-fit:cover;flex-shrink:0;filter:saturate(0.85)}
.nm{font-size:15px;font-weight:500;letter-spacing:0.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.foot{margin-top:auto;padding-top:18px;display:flex;justify-content:space-between;font-size:9.5px;letter-spacing:2.5px;color:${RC.ink3}}
.hd{display:flex;align-items:flex-end;justify-content:space-between}
.hd .t{font-family:${RC.serif};font-weight:300;font-size:26px;letter-spacing:9px}
.hd .p{font-size:9.5px;letter-spacing:2.5px;color:${RC.ink3}}
.grid{display:flex;gap:34px;flex:1;min-height:0;margin-top:6px}
.col{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:space-between}`;
}
function rcDoc(title, body) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${rcFont()}<title>${esc(title)}</title><style>${rcCSS()}</style></head><body>${body}</body></html>`;
}
function rcFont() {
  return `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@200;300;400;700&family=Noto+Sans+SC:wght@300;400;500;700&display=swap">`;
}
function rcAv(url, size) {
  if (!url) return `<span class="av" style="width:${size}px;height:${size}px;display:block;background:${RC.lineLite}"></span>`;
  const u = url.startsWith('//') ? 'https:' + url : url;
  return `<img class="av" src="${u}" style="width:${size}px;height:${size}px;display:block" />`;
}
function rcTopHTML(users, meta) {
  const top = users.slice(0, 10);
  return rcDoc('园区充电榜', `<div class="page">
    <div class="mast">园区充电榜</div>
    <div class="sub">${esc(meta.target)} · 共 ${meta.gifters} 位同行者</div>
    <div class="rule"></div>
    <div style="flex:1;min-height:0;display:flex;flex-direction:column;justify-content:space-between;margin-top:18px;padding-bottom:26px">
      ${top.map((u, i) => `<div class="row"><span class="num${i === 0 ? ' top' : ''}">${String(i + 1).padStart(2, '0')}</span>${rcAv(u.avatar, 26)}<span class="nm">${magName(u)}</span></div>`).join('')}
    </div>
    <div class="foot"><span>${esc(rankDate(meta.dateStr))}</span><span>前十名</span></div>
  </div>`);
}
function rcListHTML(users, meta, pageLabel) {
  const half = Math.ceil(users.length / 2);
  const col = (arr, off) => `<div class="col">${arr.map((u, i) => `<div class="row" style="padding:7px 0"><span class="num">${String(off + i + 1).padStart(2, '0')}</span>${rcAv(u.avatar, 22)}<span class="nm" style="font-size:14px">${magName(u)}</span></div>`).join('')}</div>`;
  return rcDoc('园区充电榜 · ' + pageLabel, `<div class="page" style="padding:42px 52px 34px">
    <div class="hd"><span class="t">园区充电榜</span><span class="p">${esc(pageLabel)}</span></div>
    <div class="rule" style="margin:16px 0 0"></div>
    <div class="grid">${col(users.slice(0, half), users.length ? users[0]._rank - 1 : 0)}${col(users.slice(half), users.length ? users[half]._rank - 1 : 0)}</div>
    <div class="foot"><span>${esc(meta.target)}</span><span>${esc(rankDate(meta.dateStr))}</span></div>
  </div>`);
}

/* ---------- ② cinema：电影海报风（深色主视觉 / 顶标题区 / 底 credits 区 / 暖金一处） ---------- */
const CN = {
  bg: '#0B0A0D', light: '#F5F2EC', l2: 'rgba(245,242,236,0.66)', l3: 'rgba(245,242,236,0.42)',
  line: 'rgba(245,242,236,0.12)', accent: 'rgba(224,164,75,0.9)',
  serif: "'Noto Serif SC','Songti SC',serif", sans: "'Noto Sans SC',system-ui,sans-serif",
};
const CN_ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ'];
let _cnKey = null;
function cnKey() {
  if (_cnKey !== null) return _cnKey;
  try { _cnKey = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, 'assets', 'cinema-key.jpg')).toString('base64'); }
  catch (e) { _cnKey = ''; }
  return _cnKey;
}
function cnCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${CN.bg};color:${CN.light};font-family:${CN.sans};-webkit-font-smoothing:antialiased}
.page{position:relative;width:540px;height:720px;overflow:hidden}
.key{position:absolute;left:0;top:0;width:540px;height:720px;object-fit:cover}
.veil{position:absolute;left:0;top:0;width:540px;height:720px;
  background:linear-gradient(180deg,rgba(11,10,13,0.94) 0%,rgba(11,10,13,0.62) 26%,rgba(11,10,13,0.34) 46%,rgba(11,10,13,0.86) 74%,rgba(11,10,13,0.98) 100%)}
.body{position:relative;z-index:2;height:100%;display:flex;flex-direction:column;padding:38px 42px 26px}
.title{font-family:${CN.serif};font-weight:700;font-size:46px;letter-spacing:7px;line-height:1.04}
.sub{font-size:11px;letter-spacing:3px;color:${CN.l2};margin-top:14px}
.rule{height:1px;background:${CN.accent};margin-top:16px}
.cast{display:flex;gap:30px;flex-shrink:0;margin-top:26px}
.castcol{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center}
.crow{display:flex;align-items:center;gap:11px;padding:9px 0;border-bottom:1px solid ${CN.line}}
.crow:last-child{border-bottom:none}
.rn{width:26px;font-size:11px;color:${CN.accent};flex-shrink:0}
.av{border-radius:50%;object-fit:cover;flex-shrink:0}
.nm{font-size:13px;color:${CN.light};overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.foot{font-size:9px;letter-spacing:2.5px;color:${CN.l3};text-align:center;margin-top:auto;padding-top:16px}
.lpage{padding:28px 40px 22px}
.lmast{font-family:${CN.serif};font-weight:700;font-size:20px;letter-spacing:5px}
.lmeta{font-size:9.5px;letter-spacing:2.5px;color:${CN.l3}}
.lgrid{display:flex;gap:28px;flex:1;min-height:0;margin-top:16px}
.lcol{flex:1;min-width:0;display:flex;flex-direction:column}
.lrow{flex:1;min-height:0;display:flex;align-items:center;gap:9px;border-bottom:1px solid rgba(245,242,236,0.08)}
.lrow:last-child{border-bottom:none}`;
}
function cnDoc(title, body) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${cnFont()}<title>${esc(title)}</title><style>${cnCSS()}</style></head><body>${body}</body></html>`;
}
function cnFont() {
  return `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;700;900&family=Noto+Sans+SC:wght@300;400;500&display=swap">`;
}
function cnAv(url, size) {
  if (!url) return `<span class="av" style="width:${size}px;height:${size}px;display:block;background:rgba(245,242,236,0.12)"></span>`;
  const u = url.startsWith('//') ? 'https:' + url : url;
  return `<img class="av" src="${u}" style="width:${size}px;height:${size}px;display:block" />`;
}
function cnKeyImg() {
  const k = cnKey();
  return k ? `<img class="key" src="${k}" /><div class="veil"></div>` : `<div class="veil" style="background:${CN.bg}"></div>`;
}
function cnTopHTML(users, meta) {
  const top = users.slice(0, 10);
  const half = Math.ceil(top.length / 2);
  const col = (arr, off) => `<div class="castcol">${arr.map((u, i) => `<div class="crow"><span class="rn">${CN_ROMAN[off + i] || (off + i + 1)}</span>${cnAv(u.avatar, 26)}<span class="nm" style="font-size:13.5px">${magName(u)}</span></div>`).join('')}</div>`;
  return cnDoc('园区充电榜', `<div class="page">
    ${cnKeyImg()}
    <div class="body">
      <div class="title">园区充电榜</div>
      <div class="sub">${esc(meta.target)} · 共 ${meta.gifters} 位同行者</div>
      <div class="rule"></div>
      <div class="cast">${col(top.slice(0, half), 0)}${col(top.slice(half), half)}</div>
      <div class="foot">${esc(rankDate(meta.dateStr))} · 前十名</div>
    </div>
  </div>`);
}
function cnListHTML(users, meta, pageLabel) {
  const half = Math.ceil(users.length / 2);
  const col = (arr, off) => `<div class="lcol">${arr.map((u, i) => `<div class="lrow"><span class="rn" style="color:${CN.l3};width:22px">${off + i + 1}</span>${cnAv(u.avatar, 20)}<span class="nm" style="flex:1;min-width:0;font-size:12.5px">${magName(u)}</span></div>`).join('')}</div>`;
  return cnDoc('园区充电榜 · ' + pageLabel, `<div class="page">
    ${cnKeyImg()}
    <div class="body lpage">
      <div style="display:flex;align-items:flex-end;justify-content:space-between">
        <span class="lmast">园区充电榜</span><span class="lmeta">${esc(pageLabel)}</span>
      </div>
      <div class="rule" style="margin-top:12px"></div>
      <div class="lgrid">${col(users.slice(0, half), users.length ? users[0]._rank - 1 : 0)}${col(users.slice(half), users.length ? users[half]._rank - 1 : 0)}</div>
      <div class="foot">${esc(meta.target)} · ${esc(rankDate(meta.dateStr))}</div>
    </div>
  </div>`);
}

/* ---------- ③ panel：大屏数据榜（近黑 / 等宽数字 / 细网格 / 单色青绿点睛） ---------- */
const PN = {
  bg: '#0B0E13', card: 'rgba(255,255,255,0.028)', ink: '#E6EDF3', muted: 'rgba(230,237,243,0.5)',
  faint: 'rgba(230,237,243,0.28)', line: 'rgba(255,255,255,0.10)', lineLite: 'rgba(255,255,255,0.052)',
  accent: '#35E0A1',
  mono: "'Roboto Mono','Noto Sans SC',monospace", sans: "'Noto Sans SC',system-ui,sans-serif",
};
function pnCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${PN.bg};color:${PN.ink};font-family:${PN.sans};-webkit-font-smoothing:antialiased}
.page{width:540px;height:720px;padding:30px 34px 22px;display:flex;flex-direction:column;
  background-image:linear-gradient(${PN.lineLite} 1px,rgba(255,255,255,0) 1px),linear-gradient(90deg,${PN.lineLite} 1px,rgba(255,255,255,0) 1px);
  background-size:54px 54px,54px 54px;background-position:0 0,0 0}
.top{display:flex;align-items:baseline;justify-content:space-between;flex-shrink:0}
.brand{font-size:13.5px;letter-spacing:3.5px;font-weight:500}
.meta{font-family:${PN.mono};font-size:9.5px;letter-spacing:1px;color:${PN.muted}}
.accentrule{height:2px;background:${PN.accent};margin-top:13px;flex-shrink:0}
.stats{display:flex;margin-top:20px;border-top:1px solid ${PN.line};border-bottom:1px solid ${PN.line};flex-shrink:0}
.stat{flex:1;padding:13px 0 12px 14px;border-left:1px solid ${PN.line}}
.stat:first-child{border-left:none;padding-left:0}
.stat .v{font-family:${PN.mono};font-size:26px;line-height:1;letter-spacing:-0.5px}
.stat .k{font-size:9.5px;letter-spacing:2px;color:${PN.muted};margin-top:7px}
.head{display:grid;grid-template-columns:30px 1fr 78px;gap:10px;font-size:9.5px;letter-spacing:2px;color:${PN.muted};
  padding:9px 0 8px;border-bottom:1px solid ${PN.line};flex-shrink:0}
.tbody{flex:1;display:flex;flex-direction:column;min-height:0}
.row{flex:1;min-height:0;display:grid;grid-template-columns:30px 1fr 78px;gap:10px;align-items:center;border-bottom:1px solid ${PN.lineLite}}
.row:last-child{border-bottom:none}
.idx{font-family:${PN.mono};font-size:11px;color:${PN.faint}}
.person{display:flex;align-items:center;gap:9px;min-width:0}
.av{border-radius:3px;object-fit:cover;flex-shrink:0;filter:grayscale(0.15)}
.nmwrap{min-width:0;flex:1}
.nm{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar{display:block;position:relative;height:3px;margin-top:5px;background:rgba(255,255,255,0.06)}
.bar i{position:absolute;left:0;top:0;height:3px;background:${PN.accent};opacity:0.8}
.cnt{font-family:${PN.mono};font-size:11.5px;text-align:right;color:rgba(230,237,243,0.82)}
.foot{margin-top:12px;display:flex;justify-content:space-between;font-family:${PN.mono};font-size:9px;letter-spacing:1px;color:rgba(230,237,243,0.38);flex-shrink:0}
.hd2{display:flex;align-items:baseline;justify-content:space-between;flex-shrink:0}
.grid2{display:flex;gap:24px;flex:1;min-height:0;margin-top:12px}
.col2{flex:1;min-width:0;display:flex;flex-direction:column}
.crow{flex:1;min-height:0;display:grid;grid-template-columns:26px 1fr;gap:8px;align-items:center;border-bottom:1px solid ${PN.lineLite}}
.crow:last-child{border-bottom:none}
.cidx{font-family:${PN.mono};font-size:10.5px;color:${PN.faint}}
.cperson{display:flex;align-items:center;gap:8px;min-width:0}`;
}
function pnDoc(title, body) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${pnFont()}<title>${esc(title)}</title><style>${pnCSS()}</style></head><body>${body}</body></html>`;
}
function pnFont() {
  return `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@300;400;500&family=Noto+Sans+SC:wght@300;400;500;700&display=swap">`;
}
function pnAv(url, size) {
  if (!url) return `<span class="av" style="width:${size}px;height:${size}px;display:block;background:rgba(255,255,255,0.09)"></span>`;
  const u = url.startsWith('//') ? 'https:' + url : url;
  return `<img class="av" src="${u}" style="width:${size}px;height:${size}px;display:block" />`;
}
function pnTopHTML(users, meta) {
  const top = users.slice(0, 10);
  const max = Math.max(1, ...top.map(u => Number(u.gifts) || 0));
  return pnDoc('园区充电榜', `<div class="page">
    <div class="top"><span class="brand">园区充电榜</span><span class="meta">${esc(rankDate(meta.dateStr))}</span></div>
    <div class="accentrule"></div>
    <div class="stats">
      <div class="stat"><div class="v">${meta.gifters}</div><div class="k">位同行者</div></div>
      <div class="stat"><div class="v">${esc(sessionIds.join('-'))}</div><div class="k">场次编号</div></div>
      <div class="stat"><div class="v">${top.length}</div><div class="k">榜上名次</div></div>
    </div>
    <div class="head" style="margin-top:16px"><span>序</span><span>昵称</span><span style="text-align:right">礼物件数</span></div>
    <div class="tbody">
      ${top.map((u, i) => `<div class="row">
        <span class="idx">${String(i + 1).padStart(2, '0')}</span>
        <span class="person">${pnAv(u.avatar, 22)}<span class="nmwrap"><span class="nm">${magName(u)}</span>
          <span class="bar"><i style="width:${Math.max(4, Math.round((Number(u.gifts) || 0) / max * 100))}%"></i></span></span></span>
        <span class="cnt">${Number(u.gifts) || 0}</span>
      </div>`).join('')}
    </div>
    <div class="foot"><span>${esc(meta.target)} · 已按连击去重</span><span>前十名</span></div>
  </div>`);
}
function pnListHTML(users, meta, pageLabel) {
  const half = Math.ceil(users.length / 2);
  const col = (arr, off) => `<div class="col2">${arr.map((u, i) => `<div class="crow"><span class="cidx">${off + i + 1}</span><span class="cperson">${pnAv(u.avatar, 20)}<span class="nm" style="flex:1;min-width:0;font-size:12.5px">${magName(u)}</span><span class="cnt" style="font-size:10.5px">${Number(u.gifts) || 0}</span></span></div>`).join('')}</div>`;
  return pnDoc('园区充电榜 · ' + pageLabel, `<div class="page">
    <div class="hd2"><span class="brand">园区充电榜</span><span class="meta">${esc(pageLabel)} · ${esc(rankDate(meta.dateStr))}</span></div>
    <div class="accentrule"></div>
    <div class="grid2">${col(users.slice(0, half), users.length ? users[0]._rank - 1 : 0)}${col(users.slice(half), users.length ? users[half]._rank - 1 : 0)}</div>
    <div class="foot"><span>${esc(meta.target)} · 共 ${meta.gifters} 位同行者</span><span>已按连击去重</span></div>
  </div>`);
}

/** 名次页统一分发（三套新模板 + 老主题走原路径） */
function rankListHTML(variant, users, meta, pageLabel) {
  if (variant === 'ticket') return tkListHTML(users, meta, pageLabel);
  if (variant === 'sports') return spListHTML(users, meta, pageLabel);
  if (variant === 'noir') return nrListHTML(users, meta, pageLabel);
  if (variant === 'doodle') return ddListHTML(users, meta, pageLabel);
  if (variant === 'typeblast') return tbListHTML(users, meta, pageLabel);
  if (variant === 'typegrid') return tgListHTML(users, meta, pageLabel);
  if (variant === 'rankbar') return tgBarList(users, meta, pageLabel);
  if (variant === 'rankstack') return tgStackList(users, meta, pageLabel);
  if (variant === 'rankvcol') return tgVcolList(users, meta, pageLabel);
  if (variant === 'radial') return radialListHTML(users, meta, pageLabel);
  if (variant === 'track') return trackListHTML(users, meta, pageLabel);
  if (variant === 'signwall') return signwallListHTML(users, meta, pageLabel);
  if (variant === 'blocks') return blListHTML(users, meta, pageLabel);
  if (variant === 'press') return prListHTML(users, meta, pageLabel);
  if (variant === 'collage') return clListHTML(users, meta, pageLabel);
  if (variant === 'record') return rcListHTML(users, meta, pageLabel);
  if (variant === 'cinema') return cnListHTML(users, meta, pageLabel);
  if (variant === 'panel') return pnListHTML(users, meta, pageLabel);
  if (variant === 'guofeng') return gfListHTML(users, meta, pageLabel);
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
function blCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${BL.paper};color:${BL.ink};font-family:${BL.sans};-webkit-font-smoothing:antialiased}
.page{position:relative;width:540px;height:720px;overflow:hidden}
.blue{position:absolute;left:0;top:0;width:540px;height:208px;background:${BL.blue}}
.disc{position:absolute;right:-72px;top:-64px;width:196px;height:196px;border-radius:50%;background:${BL.yellow}}
.skew{position:absolute;left:-46px;top:176px;width:214px;height:56px;background:${BL.red};transform:skewX(-13deg);
  display:flex;align-items:center;justify-content:flex-end;padding-right:16px}
.htitle{position:absolute;left:34px;top:44px;width:400px;font-weight:900;font-size:44px;line-height:1.02;letter-spacing:1px;color:#fff}
.hsub{position:absolute;left:36px;top:150px;font-weight:700;font-size:11.5px;letter-spacing:3px;color:${BL.yellow}}
.body{position:absolute;left:34px;right:34px;top:266px;bottom:66px;display:flex;flex-direction:column}
.row{flex:1;min-height:0;display:flex;align-items:center;gap:14px;border-bottom:2px solid ${BL.ink}}
.row:last-child{border-bottom:none}
.sq{width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:15px;color:${BL.ink};flex-shrink:0}
.av{width:32px;height:32px;object-fit:cover;flex-shrink:0;background:${BL.paper};border:2px solid ${BL.ink}}
.nm{font-weight:900;font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cnt{font-weight:900;font-size:13px;font-variant-numeric:tabular-nums;flex-shrink:0}
.bar{position:absolute;left:0;bottom:0;width:540px;height:52px;background:${BL.ink};display:flex;align-items:center;justify-content:space-between;padding:0 34px}
.bar span{color:${BL.paper};font-weight:700;font-size:10.5px;letter-spacing:2.5px}
.lpage{position:absolute;left:34px;right:34px;top:150px;bottom:60px}
.lhd{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:10px}
.lhd .t{font-weight:900;font-size:30px;letter-spacing:1px}
.lhd .p{font-weight:900;font-size:13px;background:${BL.yellow};padding:3px 10px}
.grid{display:flex;gap:22px;flex:1;min-height:0}
.col{flex:1;min-width:0;display:flex;flex-direction:column}
.crow{flex:1;min-height:0;display:flex;align-items:center;gap:9px;border-bottom:2px solid rgba(16,16,20,0.8)}
.crow:last-child{border-bottom:none}
.cs{width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:11px;flex-shrink:0}
.cn{font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}`;
}
function blDoc(t, b) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${blFont()}<title>${esc(t)}</title><style>${blCSS()}</style></head><body>${b}</body></html>`;
}
function blFont() { return `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700;900&display=swap">`; }
function blAv(url, size, sq) {
  const st = `width:${size}px;height:${size}px;${sq ? '' : 'border-radius:50%;'}`;
  if (!url) return `<span class="av" style="${st};display:block"></span>`;
  const u = url.startsWith('//') ? 'https:' + url : url;
  return `<img class="av" src="${u}" style="${st}" />`;
}
function blDocTop(users, meta) {
  const top = users.slice(0, 10);
  return blDoc('园区充电榜', `<div class="page">
    <div class="blue"></div><div class="disc"></div>
    <div class="htitle">园区充电榜</div>
    <div class="hsub">${esc(meta.target)} · 共 ${meta.gifters} 位送礼人</div>
    <div class="skew"><span style="color:#fff;font-weight:900;font-size:16px;letter-spacing:2px">前十名</span></div>
    <div class="body">
      ${top.map((u, i) => `<div class="row">
        <span class="sq" style="background:${BL_CHIP[i % 3]}">${String(i + 1).padStart(2, '0')}</span>
        ${blAv(u.avatar, 32, true)}
        <span class="nm" style="flex:1;min-width:0">${magName(u)}</span>
        
      </div>`).join('')}
    </div>
    <div class="bar"><span>${esc(rankDate(meta.dateStr))}</span><span>前十名</span></div>
  </div>`);
}
function blListHTML(users, meta, pageLabel) {
  const half = Math.ceil(users.length / 2);
  const col = (arr, off) => `<div class="col">${arr.map((u, i) => `<div class="crow"><span class="cs" style="background:${BL_CHIP[(off + i) % 3]}">${off + i + 1}</span>${blAv(u.avatar, 22, true)}<span class="cn">${magName(u)}</span></div>`).join('')}</div>`;
  return blDoc('园区充电榜 · ' + pageLabel, `<div class="page">
    <div class="blue" style="height:132px"></div><div class="disc" style="width:140px;height:140px;right:-52px;top:-46px"></div>
    <div style="position:absolute;left:34px;top:40px;font-weight:900;font-size:34px;color:#fff">园区充电榜</div>
    <div class="lpage"><div class="lhd"><span class="t" style="visibility:hidden">占位</span><span class="p">${esc(pageLabel)}</span></div>
      <div class="grid">${col(users.slice(0, half), users.length ? users[0]._rank - 1 : 0)}${col(users.slice(half), users.length ? users[half]._rank - 1 : 0)}</div>
    </div>
    <div class="bar"><span>${esc(meta.target)} · ${esc(rankDate(meta.dateStr))}</span><span>前十名</span></div>
  </div>`);
}

/* ---------- ② press：复古套色印刷（米黄纸 + 三色错位叠印 + 半调网点） ---------- */
const PR = {
  paper: '#EFE3CC', ink: '#2A2118', red: '#D8382B', blue: '#1F4E9C', yellow: '#E8B23A',
  serif: "'Noto Serif SC','Songti SC',serif", sans: "'Noto Sans SC',system-ui,sans-serif",
};
function prCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${PR.paper};color:${PR.ink};font-family:${PR.sans};-webkit-font-smoothing:antialiased}
.page{position:relative;width:540px;height:720px;overflow:hidden;
  background-image:radial-gradient(rgba(42,33,24,0.16) 1.5px,rgba(0,0,0,0) 1.7px);background-size:6px 6px}
.frame{position:absolute;left:20px;top:20px;right:20px;bottom:20px;border:4px solid ${PR.ink}}
.inner{position:absolute;left:28px;top:28px;right:28px;bottom:28px;border:1px solid rgba(42,33,24,0.5);
  display:flex;flex-direction:column;padding:26px 26px 22px}
.stripe{position:absolute;left:0;top:0;width:540px;height:8px;
  background:repeating-linear-gradient(90deg,${PR.red} 0 32px,${PR.blue} 32px 64px,${PR.yellow} 64px 96px)}
.title{font-family:${PR.serif};font-weight:900;font-size:46px;letter-spacing:3px;line-height:1.06;color:${PR.ink};
  text-shadow:3px 2px 0 ${PR.yellow},-3px -2px 0 ${PR.blue}}
.sub{font-family:${PR.serif};font-size:12px;font-weight:700;letter-spacing:2px;color:${PR.blue};margin-top:14px}
.dash{height:0;border-top:2px dashed rgba(42,33,24,0.55);margin:16px 0 6px}
.row{flex:1;min-height:0;display:flex;align-items:center;gap:12px;border-bottom:1px solid rgba(42,33,24,0.35)}
.row:last-child{border-bottom:none}
.idx{font-family:${PR.serif};font-weight:900;font-size:17px;color:${PR.red};width:26px;flex-shrink:0}
.av{width:28px;height:28px;border-radius:50%;object-fit:cover;flex-shrink:0;border:2px solid ${PR.ink};background:${PR.paper}}
.nm{font-weight:700;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.cnt{font-family:${PR.serif};font-weight:900;font-size:14px;color:${PR.blue};font-variant-numeric:tabular-nums}
.foot{margin-top:12px;display:flex;justify-content:space-between;font-size:10px;letter-spacing:2px;color:rgba(42,33,24,0.72)}
.tag{position:absolute;right:42px;top:62px;width:72px;height:72px;border-radius:50%;border:3px solid ${PR.red};
  display:flex;align-items:center;justify-content:center;transform:rotate(-9deg);background:rgba(239,227,204,0.9)}
.tag span{font-family:${PR.serif};font-weight:900;font-size:15px;color:${PR.red};line-height:1.1;text-align:center}
.lhd{display:flex;align-items:flex-end;justify-content:space-between}
.lhd .t{font-family:${PR.serif};font-weight:900;font-size:26px;letter-spacing:2px;color:${PR.ink};
  text-shadow:2px 1px 0 ${PR.yellow}}
.lhd .p{font-family:${PR.serif};font-weight:900;font-size:12px;color:${PR.red}}
.grid{display:flex;gap:26px;flex:1;min-height:0;margin-top:8px}
.col{flex:1;min-width:0;display:flex;flex-direction:column}
.crow{flex:1;min-height:0;display:flex;align-items:center;gap:9px;border-bottom:1px solid rgba(42,33,24,0.28)}
.crow:last-child{border-bottom:none}
.ci{font-family:${PR.serif};font-weight:900;font-size:13px;color:${PR.blue};width:22px;flex-shrink:0}
.cn{font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.cc{font-family:${PR.serif};font-weight:900;font-size:12.5px;color:${PR.red};font-variant-numeric:tabular-nums}`;
}
function prDoc(t, b) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${prFont()}<title>${esc(t)}</title><style>${prCSS()}</style></head><body>${b}</body></html>`;
}
function prFont() { return `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;700;900&family=Noto+Sans+SC:wght@400;700&display=swap">`; }
function prAv(url, size) {
  if (!url) return `<span class="av" style="width:${size}px;height:${size}px;display:block"></span>`;
  const u = url.startsWith('//') ? 'https:' + url : url;
  return `<img class="av" src="${u}" style="width:${size}px;height:${size}px" />`;
}
function prTopHTML(users, meta) {
  const top = users.slice(0, 10);
  return prDoc('园区充电榜', `<div class="page">
    <div class="stripe"></div>
    <div class="frame"></div>
    <div class="inner">
      <div class="title">园区充电榜</div>
      <div class="sub">${esc(meta.target)} · 共 ${meta.gifters} 位送礼人 · ${esc(rankDate(meta.dateStr))}</div>
      <div class="dash"></div>
      <div style="flex:1;min-height:0;display:flex;flex-direction:column">
        ${top.map((u, i) => `<div class="row"><span class="idx">${i + 1}</span>${prAv(u.avatar, 28)}<span class="nm">${magName(u)}</span></div>`).join('')}
      </div>
      <div class="foot"><span>前十名</span><span>前十名</span></div>
    </div>
    <div class="tag"><span>前<br>十名</span></div>
  </div>`);
}
function prListHTML(users, meta, pageLabel) {
  const half = Math.ceil(users.length / 2);
  const col = (arr, off) => `<div class="col">${arr.map((u, i) => `<div class="crow"><span class="ci">${off + i + 1}</span>${prAv(u.avatar, 22)}<span class="cn">${magName(u)}</span></div>`).join('')}</div>`;
  return prDoc('园区充电榜 · ' + pageLabel, `<div class="page">
    <div class="stripe"></div>
    <div class="frame"></div>
    <div class="inner">
      <div class="lhd"><span class="t">园区充电榜</span><span class="p">${esc(pageLabel)}</span></div>
      <div class="dash"></div>
      <div class="grid">${col(users.slice(0, half), users.length ? users[0]._rank - 1 : 0)}${col(users.slice(half), users.length ? users[half]._rank - 1 : 0)}</div>
      <div class="foot"><span>${esc(meta.target)} · 共 ${meta.gifters} 位送礼人</span><span>${esc(rankDate(meta.dateStr))}</span></div>
    </div>
  </div>`);
}

/* ---------- ③ collage：拼贴杂志（多色底格 + 硬阴影卡片 + 贴纸/胶带/荧光笔） ---------- */
const CL = {
  ink: '#141418', hi: '#FFE94D', pink: '#FFD3E4', cream: '#FFF3C4', mint: '#C7F0DF', sky: '#CFE4FF',
  sans: "'Noto Sans SC',system-ui,sans-serif", fat: "'ZCOOL QingKe HuangYou','Noto Sans SC',sans-serif",
};
function clCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{color:${CL.ink};font-family:${CL.sans};-webkit-font-smoothing:antialiased;
  background-image:linear-gradient(90deg,${CL.pink} 0 50%,${CL.cream} 50% 100%),linear-gradient(90deg,${CL.mint} 0 50%,${CL.sky} 50% 100%);
  background-size:270px 180px,270px 180px;background-position:0 0,135px 90px;background-repeat:repeat}
.page{position:relative;width:540px;height:720px;overflow:hidden}
.hl{position:absolute;left:26px;top:26px;background:${CL.hi};padding:2px 12px 6px;box-shadow:7px 7px 0 ${CL.ink};transform:rotate(-1.2deg)}
.hl .t{font-family:${CL.fat};font-size:44px;line-height:1.06;letter-spacing:2px}
.tape{position:absolute;left:250px;top:18px;width:120px;height:30px;background:rgba(255,255,255,0.55);border:1px solid rgba(20,20,24,0.25);transform:rotate(7deg)}
.chips{position:absolute;left:28px;top:118px;display:flex;gap:8px}
.chip{border:2px solid ${CL.ink};padding:3px 9px;font-weight:700;font-size:10.5px;letter-spacing:1px;background:#fff;box-shadow:3px 3px 0 ${CL.ink}}
.taground{position:absolute;right:22px;top:92px;width:108px;height:108px;border-radius:50%;background:${CL.hi};border:2px solid ${CL.ink};
  display:flex;align-items:center;justify-content:center;transform:rotate(9deg);box-shadow:5px 5px 0 ${CL.ink}
.taground span{font-family:${CL.fat};font-size:16px;line-height:1.06;text-align:center}
.cards{position:absolute;left:26px;right:26px;top:196px;bottom:70px;display:grid;grid-template-columns:1fr 1fr;grid-gap:10px}
.pcard{position:relative;background:#fff;border:2px solid ${CL.ink};box-shadow:4px 4px 0 ${CL.ink};display:flex;align-items:center;gap:9px;padding:0 10px;min-height:0}
.pcard:nth-child(odd){transform:rotate(-0.9deg)}
.pcard:nth-child(even){transform:rotate(0.9deg)}
.rk{font-family:${CL.fat};font-size:22px;line-height:1;flex-shrink:0}
.av{width:30px;height:30px;border-radius:50%;object-fit:cover;flex-shrink:0;border:2px solid ${CL.ink};background:#fff}
.nm{font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.cn2{font-weight:700;font-size:11px;flex-shrink:0}
.foot{position:absolute;left:26px;right:26px;bottom:22px;display:flex;justify-content:space-between;align-items:center}
.foot .s{background:#fff;border:2px solid ${CL.ink};box-shadow:3px 3px 0 ${CL.ink};padding:3px 10px;font-weight:700;font-size:10.5px;letter-spacing:1px}
.lhd{position:absolute;left:26px;top:30px;display:flex;align-items:flex-end;gap:12px}
.lhd .t{font-family:${CL.fat};font-size:30px;background:${CL.hi};padding:0 10px 4px;box-shadow:5px 5px 0 ${CL.ink};transform:rotate(-1deg)}
.lhd .p{font-weight:700;font-size:11.5px;background:#fff;border:2px solid ${CL.ink};box-shadow:3px 3px 0 ${CL.ink};padding:3px 9px}
.lgrid{position:absolute;left:26px;right:26px;top:120px;bottom:66px;display:flex;gap:22px}
.lcol{flex:1;min-width:0;display:flex;flex-direction:column}
.lrow{flex:1;min-height:0;display:flex;align-items:center;gap:8px;border-bottom:1.5px dashed rgba(20,20,24,0.5)}
.lrow:last-child{border-bottom:none}
.lrk{font-family:${CL.fat};font-size:16px;width:22px;flex-shrink:0}
.lnm{font-weight:700;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}`;
}
function clDoc(t, b) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${clFont()}<title>${esc(t)}</title><style>${clCSS()}</style></head><body>${b}</body></html>`;
}
function clFont() { return `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=ZCOOL+QingKe+HuangYou&family=Noto+Sans+SC:wght@400;700;900&display=swap">`; }
function clAv(url, size) {
  if (!url) return `<span class="av" style="width:${size}px;height:${size}px;display:block"></span>`;
  const u = url.startsWith('//') ? 'https:' + url : url;
  return `<img class="av" src="${u}" style="width:${size}px;height:${size}px" />`;
}
function clTopHTML(users, meta) {
  const top = users.slice(0, 10);
  return clDoc('园区充电榜', `<div class="page">
    <div class="hl"><div class="t">园区充电榜</div></div>
    <div class="tape"></div>
    <div class="chips">
      <span class="chip">共 ${meta.gifters} 位送礼人</span>
      <span class="chip">${esc(rankDate(meta.dateStr))}</span>
      <span class="chip">${esc(meta.target)}</span>
    </div>
    <div class="taground"><span>前<br>十<br>名</span></div>
    <div class="cards">
      ${top.map((u, i) => `<div class="pcard"><span class="rk">${String(i + 1).padStart(2, '0')}</span>${clAv(u.avatar, 30)}<span class="nm">${magName(u)}</span></div>`).join('')}
    </div>
    <div class="foot"><span class="s">前十名</span><span class="s">前十名</span></div>
  </div>`);
}
function clListHTML(users, meta, pageLabel) {
  const half = Math.ceil(users.length / 2);
  const col = (arr, off) => `<div class="lcol">${arr.map((u, i) => `<div class="lrow"><span class="lrk">${off + i + 1}</span>${clAv(u.avatar, 22)}<span class="lnm">${magName(u)}</span></div>`).join('')}</div>`;
  return clDoc('园区充电榜 · ' + pageLabel, `<div class="page">
    <div class="lhd"><span class="t">园区充电榜</span><span class="p">${esc(pageLabel)}</span></div>
    <div class="tape" style="left:300px;top:24px;width:104px;height:26px"></div>
    <div class="lgrid">${col(users.slice(0, half), users.length ? users[0]._rank - 1 : 0)}${col(users.slice(half), users.length ? users[half]._rank - 1 : 0)}</div>
    <div class="foot"><span class="s">共 ${meta.gifters} 位送礼人</span><span class="s">前十名</span></div>
  </div>`);
}

// ==================== 追加五套：ticket / sports / noir / doodle / typeblast ====================
// 统一口径：榜单主 · 共 N 位送礼人 · 日期；名单列 = 名次 + 头像 + 昵称（不带任何金额/件数）
function rankMetaLine(meta) { return `${esc(meta.target)} · 共 ${meta.gifters} 位送礼人`; }

/* ---------- ④ ticket：票据/凭证风（打孔票根 + 虚线撕口 + 流水号 + 盖章） ---------- */
const TK = {
  desk: '#E7E0D0', paper: '#F8F4EA', ink: '#1B2A2E', green: '#1F5D4C', red: '#BF3B2B', dim: 'rgba(27,42,46,0.55)',
  mono: "'Roboto Mono',monospace", sans: "'Noto Sans SC',system-ui,sans-serif", serif: "'Noto Serif SC',serif",
};
function tkCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${TK.desk};color:${TK.ink};font-family:${TK.sans};-webkit-font-smoothing:antialiased}
.page{position:relative;width:540px;height:720px}
.tk{position:absolute;left:32px;right:32px;top:26px;bottom:26px;background:${TK.paper};border:2px solid ${TK.ink};
  display:flex;flex-direction:column;overflow:hidden}
.head{background:${TK.green};color:${TK.paper};padding:16px 22px 14px}
.head .t{font-family:${TK.serif};font-weight:900;font-size:30px;letter-spacing:6px}
.head .s{font-family:${TK.mono};font-size:10px;letter-spacing:2px;margin-top:8px;opacity:0.9}
.mid{flex:1;min-height:0;display:flex;flex-direction:column;padding:16px 22px 8px}
.row{flex:1;min-height:0;display:flex;align-items:center;gap:12px;border-bottom:1px dashed rgba(27,42,46,0.35)}
.row:last-child{border-bottom:none}
.idx{font-family:${TK.mono};font-weight:500;font-size:13px;color:${TK.green};width:26px;flex-shrink:0}
.av{width:28px;height:28px;object-fit:cover;flex-shrink:0;border-radius:2px;border:1px solid rgba(27,42,46,0.6)}
.nm{font-weight:700;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.tear{position:relative;height:26px;flex-shrink:0}
.tear .dash{position:absolute;left:16px;right:16px;top:12px;border-top:2px dashed rgba(27,42,46,0.55)}
.punch{position:absolute;top:1px;width:24px;height:24px;border-radius:50%;background:#E7E0D0}
.stub{padding:10px 22px 20px;display:flex;align-items:flex-end;justify-content:space-between;flex-shrink:0}
.stub .no{font-family:${TK.mono};font-size:11px;letter-spacing:1.5px;color:${TK.dim}}
.stub .who{font-size:10.5px;letter-spacing:1.5px;color:${TK.dim};margin-top:7px}
.stamp{width:96px;height:96px;border:3px solid ${TK.red};border-radius:50%;color:${TK.red};transform:rotate(-8deg);
  display:flex;align-items:center;justify-content:center;font-family:${TK.serif};font-weight:900;font-size:17px;line-height:1.15;
  text-align:center;box-shadow:inset 0 0 0 1px ${TK.red}}
.lihead{display:flex;align-items:flex-end;justify-content:space-between;padding:16px 22px 10px}
.lihead .t{font-family:${TK.serif};font-weight:900;font-size:22px;letter-spacing:4px}
.lihead .p{font-family:${TK.mono};font-size:10.5px;color:${TK.red}}
.grid{display:flex;gap:24px;flex:1;min-height:0;padding:0 22px}
.col{flex:1;min-width:0;display:flex;flex-direction:column}
.crow{flex:1;min-height:0;display:flex;align-items:center;gap:8px;border-bottom:1px dashed rgba(27,42,46,0.3)}
.crow:last-child{border-bottom:none}
.ci{font-family:${TK.mono};font-size:11px;color:${TK.green};width:22px;flex-shrink:0}
.cn{font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}`;
}
function tkDoc(t, b) { return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${tkFont()}<title>${esc(t)}</title><style>${tkCSS()}</style></head><body>${b}</body></html>`; }
function tkFont() { return `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500&family=Noto+Serif+SC:wght@700;900&family=Noto+Sans+SC:wght@400;700&display=swap">`; }
function tkAv(url, size) {
  if (!url) return `<span class="av" style="width:${size}px;height:${size}px;display:block"></span>`;
  const u = url.startsWith('//') ? 'https:' + url : url;
  return `<img class="av" src="${u}" style="width:${size}px;height:${size}px" />`;
}
function tkPunches() {
  return `<span class="punch" style="left:-13px"></span><span class="punch" style="right:-13px"></span>`;
}
function tkTopHTML(users, meta) {
  const top = users.slice(0, 10);
  return tkDoc('园区充电榜', `<div class="page"><div class="tk">
    <div class="head"><div class="t">园区充电榜</div>
      <div class="s">NO.${esc(String(sessionIds.join('-')))} · ${esc(rankDate(meta.dateStr))}</div></div>
    <div class="mid">
      ${top.map((u, i) => `<div class="row"><span class="idx">${String(i + 1).padStart(2, '0')}</span>${tkAv(u.avatar, 28)}<span class="nm">${magName(u)}</span></div>`).join('')}
    </div>
    <div class="tear"><span class="dash"></span>${tkPunches()}</div>
    <div class="stub">
      <div><div class="no">TICKET NO. ${esc(String(sessionIds.join('')))}-${String(users.length).padStart(2, '0')}</div>
        <div class="who">${rankMetaLine(meta)} · 前十名</div></div>
      <div class="stamp">前十名<br>凭证</div>
    </div>
  </div></div>`);
}
function tkListHTML(users, meta, pageLabel) {
  const half = Math.ceil(users.length / 2);
  const col = (arr, off) => `<div class="col">${arr.map((u, i) => `<div class="crow"><span class="ci">${off + i + 1}</span>${tkAv(u.avatar, 20)}<span class="cn">${magName(u)}</span></div>`).join('')}</div>`;
  return tkDoc('园区充电榜 · ' + pageLabel, `<div class="page"><div class="tk">
    <div class="head" style="padding:12px 22px 11px"><div class="t" style="font-size:22px;letter-spacing:4px">园区充电榜</div>
      <div class="s">${esc(pageLabel)} · NO.${esc(String(sessionIds.join('-')))}</div></div>
    <div class="grid">${col(users.slice(0, half), users.length ? users[0]._rank - 1 : 0)}${col(users.slice(half), users.length ? users[half]._rank - 1 : 0)}</div>
    <div class="tear"><span class="dash"></span>${tkPunches()}</div>
    <div class="stub" style="padding:8px 22px 14px"><div class="no">${rankMetaLine(meta)}</div>
      <div class="who" style="margin:0">${esc(rankDate(meta.dateStr))}</div></div>
  </div></div>`);
}

/* ---------- ⑤ sports：体育赛事转播风（深蓝 + 荧光绿，比分板排版） ---------- */
const SP = {
  bg: '#061528', bg2: '#0C2A4A', line: '#1D4E7E', neon: '#C6FF3D', text: '#EAF2FF', dim: 'rgba(234,242,255,0.62)',
  sans: "'Noto Sans SC',system-ui,sans-serif", mono: "'Roboto Mono',monospace",
};
function spCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${SP.bg};color:${SP.text};font-family:${SP.sans};-webkit-font-smoothing:antialiased}
.page{position:relative;width:540px;height:720px;overflow:hidden}
.slash{position:absolute;background:${SP.neon}}
.slash.a{left:-40px;top:112px;width:300px;height:9px;transform:skewX(-24deg)}
.slash.b{left:-40px;top:126px;width:190px;height:9px;transform:skewX(-24deg);opacity:0.5}
.glow{position:absolute;right:-90px;top:-90px;width:300px;height:300px;border-radius:50%;background:radial-gradient(circle,${SP.bg2} 0%,rgba(12,42,74,0) 70%)}
.body{position:absolute;left:36px;right:36px;top:36px;bottom:56px;display:flex;flex-direction:column}
.brand{font-weight:900;font-size:40px;letter-spacing:2px;line-height:1.06}
.kick{font-family:${SP.mono};font-size:11px;letter-spacing:3px;color:${SP.neon};margin-top:12px}
.meta{font-size:11px;letter-spacing:2px;color:${SP.dim};margin-top:8px}
.hrule{height:2px;background:${SP.line};margin:16px 0 0}
.rows{flex:1;min-height:0;display:flex;flex-direction:column;margin-top:4px}
.row{flex:1;min-height:0;display:flex;align-items:center;gap:14px;border-bottom:1px solid ${SP.line}}
.row:last-child{border-bottom:none}
.idx{font-family:${SP.mono};font-weight:500;font-size:17px;color:${SP.neon};width:34px;flex-shrink:0;font-variant-numeric:tabular-nums}
.av{width:34px;height:34px;object-fit:cover;flex-shrink:0;border:2px solid ${SP.line}}
.nm{font-weight:900;font-size:18px;letter-spacing:0.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ticker{position:absolute;left:0;bottom:0;width:540px;height:40px;background:${SP.bg2};display:flex;align-items:center;padding:0 36px;justify-content:space-between}
.ticker span{font-family:${SP.mono};font-size:10.5px;letter-spacing:2px;color:${SP.neon}}
.lhead{display:flex;align-items:flex-end;justify-content:space-between}
.lhead .t{font-weight:900;font-size:28px;letter-spacing:1px}
.lhead .p{font-family:${SP.mono};font-size:12px;color:${SP.neon};letter-spacing:2px}
.lgrid{display:flex;gap:26px;flex:1;min-height:0;margin-top:10px}
.lcol{flex:1;min-width:0;display:flex;flex-direction:column}
.lrow{flex:1;min-height:0;display:flex;align-items:center;gap:10px;border-bottom:1px solid ${SP.line}}
.lrow:last-child{border-bottom:none}
.li{font-family:${SP.mono};font-size:11.5px;color:${SP.neon};width:24px;flex-shrink:0}
.ln{font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}`;
}
function spDoc(t, b) { return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${spFont()}<title>${esc(t)}</title><style>${spCSS()}</style></head><body>${b}</body></html>`; }
function spFont() { return `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500&family=Noto+Sans+SC:wght@400;700;900&display=swap">`; }
function spAv(url, size) {
  if (!url) return `<span class="av" style="width:${size}px;height:${size}px;display:block"></span>`;
  const u = url.startsWith('//') ? 'https:' + url : url;
  return `<img class="av" src="${u}" style="width:${size}px;height:${size}px" />`;
}
function spTopHTML(users, meta) {
  const top = users.slice(0, 10);
  return spDoc('园区充电榜', `<div class="page">
    <div class="glow"></div><div class="slash a"></div><div class="slash b"></div>
    <div class="body">
      <div class="brand">园区充电榜</div>
      <div class="kick">第 ${esc(String(sessionIds.join('-')))} 场</div>
      <div class="meta">${rankMetaLine(meta)} · ${esc(rankDate(meta.dateStr))} · 前十名</div>
      <div class="hrule"></div>
      <div class="rows">${top.map((u, i) => `<div class="row"><span class="idx">${String(i + 1).padStart(2, '0')}</span>${spAv(u.avatar, 34)}<span class="nm">${magName(u)}</span></div>`).join('')}</div>
    </div>
    <div class="ticker"><span>园区充电榜</span><span>${esc(rankDate(meta.dateStr))}</span><span>前十名</span></div>
  </div>`);
}
function spListHTML(users, meta, pageLabel) {
  const half = Math.ceil(users.length / 2);
  const col = (arr, off) => `<div class="lcol">${arr.map((u, i) => `<div class="lrow"><span class="li">${off + i + 1}</span>${spAv(u.avatar, 22)}<span class="ln">${magName(u)}</span></div>`).join('')}</div>`;
  return spDoc('园区充电榜 · ' + pageLabel, `<div class="page">
    <div class="glow"></div><div class="slash a" style="top:74px"></div>
    <div class="body"><div class="lhead"><span class="t">园区充电榜</span><span class="p">${esc(pageLabel)}</span></div>
      <div class="hrule" style="margin-top:12px"></div>
      <div class="lgrid">${col(users.slice(0, half), users.length ? users[0]._rank - 1 : 0)}${col(users.slice(half), users.length ? users[half]._rank - 1 : 0)}</div>
    </div>
    <div class="ticker"><span>${rankMetaLine(meta)}</span><span>${esc(rankDate(meta.dateStr))}</span></div>
  </div>`);
}

/* ---------- ⑥ noir：黑金夜场风（近黑 + 单一暖金线 + 极粗衬线） ---------- */
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
const DD = {
  paper: '#FFFCF2', ink: '#1E1E28', blue: '#2B6CFF', red: '#FF4B4B', green: '#12B76A', yellow: '#FFE24D',
  hand: "'Ma Shan Zheng','Noto Sans SC',cursive", fat: "'ZCOOL KuaiLe','Noto Sans SC',sans-serif", sans: "'Noto Sans SC',system-ui,sans-serif",
};
function ddCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${DD.paper};color:${DD.ink};font-family:${DD.sans};-webkit-font-smoothing:antialiased;
  background-image:radial-gradient(rgba(30,30,40,0.07) 1.4px,rgba(0,0,0,0) 1.6px);background-size:14px 14px}
.page{position:relative;width:540px;height:720px;padding:34px 40px 30px;display:flex;flex-direction:column}
.title{font-family:${DD.hand};font-size:52px;line-height:1.1;letter-spacing:2px}
.inkline{height:9px;border-radius:6px;background:${DD.blue};width:250px;opacity:0.85;transform:rotate(-0.6deg)}
.sticky{position:absolute;right:34px;top:44px;width:150px;padding:12px 12px 14px;background:${DD.yellow};transform:rotate(3.4deg);
  box-shadow:3px 4px 0 rgba(30,30,40,0.18);font-family:${DD.hand};font-size:15px;line-height:1.35}
.meta{margin-top:16px;font-family:${DD.hand};font-size:16px;color:rgba(30,30,40,0.75);letter-spacing:1px}
.rows{flex:1;min-height:0;display:flex;flex-direction:column;margin-top:12px}
.row{flex:1;min-height:0;display:flex;align-items:center;gap:12px}
.idxwrap{position:relative;width:40px;height:40px;flex-shrink:0;display:flex;align-items:center;justify-content:center}
.idx{font-family:${DD.hand};font-size:23px;line-height:1}
.circle{position:absolute;left:-2px;top:-1px;width:44px;height:42px;border:3px solid ${DD.red};border-radius:50% 46% 52% 48%;
  transform:rotate(-6deg)}
.av{width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0;border:2px solid ${DD.ink}}
.nm{font-weight:700;font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.nmcol{flex:1;min-width:0;display:flex;flex-direction:column}
.wave{height:7px;width:74px;margin-top:3px;background-image:radial-gradient(circle at 50% 100%,${DD.blue} 3.2px,rgba(0,0,0,0) 3.4px);background-size:11px 7px;background-repeat:repeat-x;opacity:0.6}
.foot{display:flex;justify-content:space-between;align-items:center;margin-top:14px}
.tag{font-family:${DD.hand};font-size:16px;padding:2px 10px;border:2px solid ${DD.ink};transform:rotate(-1.2deg);background:#fff}
.lhead{display:flex;align-items:flex-end;gap:12px}
.lhead .t{font-family:${DD.hand};font-size:34px}
.lgrid{display:flex;gap:26px;flex:1;min-height:0;margin-top:10px}
.lcol{flex:1;min-width:0;display:flex;flex-direction:column}
.lrow{flex:1;min-height:0;display:flex;align-items:center;gap:9px}
.li{font-family:${DD.hand};font-size:17px;color:${DD.red};width:26px;flex-shrink:0}
.ln{font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}`;
}
function ddDoc(t, b) { return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${ddFont()}<title>${esc(t)}</title><style>${ddCSS()}</style></head><body>${b}</body></html>`; }
function ddFont() { return `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&family=ZCOOL+KuaiLe&family=Noto+Sans+SC:wght@400;700;900&display=swap">`; }
function ddAv(url, size) {
  if (!url) return `<span class="av" style="width:${size}px;height:${size}px;display:block;background:#eee"></span>`;
  const u = url.startsWith('//') ? 'https:' + url : url;
  return `<img class="av" src="${u}" style="width:${size}px;height:${size}px" />`;
}
function ddTopHTML(users, meta) {
  const top = users.slice(0, 10);
  return ddDoc('园区充电榜', `<div class="page">
    <div class="title">园区充电榜</div>
    <div class="inkline" style="margin-top:6px"></div>
    <div class="sticky">共 ${meta.gifters} 位送礼人<br>谢谢每一份心意</div>
    <div class="meta">${esc(meta.target)} · ${esc(rankDate(meta.dateStr))} · 前十名</div>
    <div class="rows">${top.map((u, i) => `<div class="row">
      <span class="idxwrap">${i < 3 ? '<span class="circle"></span>' : ''}<span class="idx">${i + 1}</span></span>
      ${ddAv(u.avatar, 32)}<span class="nmcol"><span class="nm">${magName(u)}</span><span class="wave"></span></span></div>`).join('')}</div>
    <div class="foot"><span class="tag">前十名</span><span class="tag" style="background:${DD.yellow};transform:rotate(1.4deg)">${esc(rankDate(meta.dateStr))}</span></div>
  </div>`);
}
function ddListHTML(users, meta, pageLabel) {
  const half = Math.ceil(users.length / 2);
  const col = (arr, off) => `<div class="lcol">${arr.map((u, i) => `<div class="lrow"><span class="li">${off + i + 1}</span>${ddAv(u.avatar, 22)}<span class="ln">${magName(u)}</span></div>`).join('')}</div>`;
  return ddDoc('园区充电榜 · ' + pageLabel, `<div class="page">
    <div class="title" style="font-size:40px">园区充电榜</div>
    <div class="inkline" style="width:180px;margin-top:4px"></div>
    <div class="sticky" style="top:38px;width:132px;font-size:14px">${esc(pageLabel)}<br>${rankMetaLine(meta)}</div>
    <div class="lgrid">${col(users.slice(0, half), users.length ? users[0]._rank - 1 : 0)}${col(users.slice(half), users.length ? users[half]._rank - 1 : 0)}</div>
    <div class="foot"><span class="tag">${esc(rankDate(meta.dateStr))}</span><span class="tag" style="background:${DD.yellow};transform:rotate(1.2deg)">共 ${meta.gifters} 位送礼人</span></div>
  </div>`);
}

/* ---------- ⑧ typeblast：大字母构成派（超大字压满 + 字与色块互相切割） ---------- */
const TB = {
  bg: '#F1EFE9', ink: '#0E0E10', hot: '#FF3B1F', soft: 'rgba(14,14,16,0.6)',
  sans: "'Noto Sans SC',system-ui,sans-serif",
};
function tbCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${TB.bg};color:${TB.ink};font-family:${TB.sans};-webkit-font-smoothing:antialiased}
.page{position:relative;width:540px;height:720px;overflow:hidden}
.mega{position:absolute;left:-6px;top:22px;width:560px;font-weight:900;font-size:104px;line-height:0.94;letter-spacing:-4px}
.block{position:absolute;mix-blend-mode:multiply}
.block.a{left:-40px;top:132px;width:420px;height:120px;background:${TB.hot};transform:skewX(-16deg)}
.block.b{right:-70px;top:300px;width:240px;height:60px;background:rgba(14,14,16,0.88);transform:skewX(-16deg)}
.wm{position:absolute;font-weight:900;font-size:132px;letter-spacing:-8px;color:rgba(14,14,16,0.07)}
.list{position:absolute;left:0;right:0;top:352px;bottom:58px;display:flex;flex-direction:column}
.row{flex:1;min-height:0;display:flex;align-items:center;gap:14px;padding:0 34px}
.row.alt{background:rgba(14,14,16,0.065)}
.idx{font-weight:900;font-size:19px;width:38px;flex-shrink:0;color:${TB.hot};font-variant-numeric:tabular-nums}
.av{width:26px;height:26px;border-radius:50%;object-fit:cover;flex-shrink:0}
.nm{font-weight:900;font-size:18px;letter-spacing:-0.2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.foot{position:absolute;left:0;bottom:0;width:540px;height:58px;background:${TB.ink};border-top:5px solid ${TB.hot};display:flex;align-items:center;justify-content:space-between;padding:0 34px}
.foot span{color:${TB.bg};font-weight:700;font-size:10.5px;letter-spacing:3px}
.hotline{position:absolute;left:0;top:0;width:540px;height:12px;background:${TB.hot}}
.lhead{position:absolute;left:34px;top:34px;width:472px}
.lhead .t{font-weight:900;font-size:52px;line-height:1;letter-spacing:-2px}
.lhead .p{font-weight:900;font-size:13px;letter-spacing:3px;margin-top:10px;color:${TB.soft}}
.lgrid{position:absolute;left:34px;right:34px;top:170px;bottom:74px;display:flex;gap:28px}
.lcol{flex:1;min-width:0;display:flex;flex-direction:column}
.lrow{flex:1;min-height:0;display:flex;align-items:center;gap:9px;border-bottom:1px solid rgba(14,14,16,0.14)}
.lrow:nth-child(even){background:rgba(14,14,16,0.045)}
.lrow:last-child{border-bottom:none}
.li{font-weight:900;font-size:13px;width:26px;flex-shrink:0;color:${TB.hot};font-variant-numeric:tabular-nums}
.ln{font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}`;
}
function tbDoc(t, b) { return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${tbFont()}<title>${esc(t)}</title><style>${tbCSS()}</style></head><body>${b}</body></html>`; }
function tbFont() { return `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700;900&display=swap">`; }
function tbAv(url, size, sq) {
  const st = `width:${size}px;height:${size}px;`;
  if (!url) return `<span class="av" style="${st}display:block;background:rgba(14,14,16,0.12)"></span>`;
  const u = url.startsWith('//') ? 'https:' + url : url;
  return `<img class="av" src="${u}" style="${st}" />`;
}
function tbTopHTML(users, meta) {
  const top = users.slice(0, 10);
  return tbDoc('园区充电榜', `<div class="page">
    <div class="hotline"></div>
    <div class="wm" style="right:-30px;top:-6px">榜</div>
    <div class="mega">园区<br>充电榜</div>
    <div class="block a"></div><div class="block b"></div>
    <div style="position:absolute;left:34px;top:322px;font-weight:900;font-size:12px;letter-spacing:4px;color:#0E0E10;z-index:3">前十名</div>
    <div class="list">${top.map((u, i) => `<div class="row${i % 2 ? '' : ' alt'}"><span class="idx">${String(i + 1).padStart(2, '0')}</span>${tbAv(u.avatar, 26, true)}<span class="nm" style="flex:1;min-width:0">${magName(u)}</span></div>`).join('')}</div>
    <div class="foot"><span>${rankMetaLine(meta)}</span><span>${esc(rankDate(meta.dateStr))}</span></div>
  </div>`);
}
function tbListHTML(users, meta, pageLabel) {
  const half = Math.ceil(users.length / 2);
  const col = (arr, off) => `<div class="lcol">${arr.map((u, i) => `<div class="lrow"><span class="li">${off + i + 1}</span>${tbAv(u.avatar, 22, true)}<span class="ln">${magName(u)}</span></div>`).join('')}</div>`;
  return tbDoc('园区充电榜 · ' + pageLabel, `<div class="page">
    <div class="hotline"></div>
    <div class="wm" style="right:-20px;top:-20px;font-size:104px">名录</div>
    <div class="lhead"><div class="t">园区充电榜</div><div class="p">${esc(pageLabel)} · ${esc(rankDate(meta.dateStr))}</div></div>
    <div class="lgrid">${col(users.slice(0, half), users.length ? users[0]._rank - 1 : 0)}${col(users.slice(half), users.length ? users[half]._rank - 1 : 0)}</div>
    <div class="foot"><span>${rankMetaLine(meta)}</span><span>前十名</span></div>
  </div>`);
}

/* ---------- ⑨ typegrid：大字号双栏名录（构成派轻量版，圆头像 + 细线 + 超大字序） ---------- */
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
.tr{flex:1;min-height:0;display:grid;align-items:center;padding:0 6px;border-bottom:1px solid rgba(14,14,16,0.075)}
.tr:last-child{border-bottom:none}
.tr.top3{background:rgba(255,59,31,0.055)}
.rk{font-weight:900;font-variant-numeric:tabular-nums;letter-spacing:-0.5px;text-align:left;line-height:1}
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
  if (rows <= 17) return { av: 22, nm: 14, rk: 15, gap: 10 };
  if (rows <= 21) return { av: 19, nm: 12.5, rk: 13.5, gap: 9 };
  return { av: 16, nm: 11, rk: 12, gap: 8 };
}
function tgTr(u, rank, big, d) {
  const top = rank <= 3;
  const z = d || tgDensity(big ? 10 : 13);
  return `<div class="tr${top ? ' top3' : ''}" style="grid-template-columns:${big ? '54px 1fr' : '42px 1fr'}">
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
      <div class="tbody">${top.map((u, i) => tgTr(u, i + 1, true)).join('')}</div>
    </div>
    <div class="foot"><span>前十名</span><span>共 ${meta.gifters} 位送礼人</span></div>
  </div>`);
}
function tgListHTML(users, meta, pageLabel) {
  const half = Math.ceil(users.length / 2);
  const start = users.length ? users[0]._rank : 1;
  const end = users.length ? users[users.length - 1]._rank : start;
  const total = meta.count || Number(String(meta.gifters).replace(/[^0-9]/g, '')) || end;
  const z = tgDensity(half);
  const col = (arr, off) => `<div class="col">
    <div class="tbody">${arr.map((u, i) => tgTr(u, off + i + 1, false, z)).join('')}</div></div>`;
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
function tgBarRow(u, i) {
  const w = 100 - i * 6.6;
  const bg = i === 0 ? TB.hot : (i < 3 ? 'rgba(14,14,16,0.9)' : 'rgba(14,14,16,0.13)');
  const fg = i < 3 ? TB.bg : TB.ink;
  return `<div class="brow"><span class="bnum" style="${i < 3 ? 'color:' + TB.hot : ''}">${String(i + 1).padStart(2, '0')}</span>
    <span class="bbar" style="width:${w}%;background:${bg};color:${fg}">${tbAv(u.avatar, 20, false)}<span class="bnm">${magName(u)}</span></span></div>`;
}
function tgBarTop(users, meta) {
  const top = users.slice(0, 10);
  return tgxDoc('园区充电榜', `<div class="page">${tgxHead(`${rankMetaLine(meta)} · ${esc(rankDate(meta.dateStr))} · 前十名`)}
    <div class="bars">${top.map((u, i) => tgBarRow(u, i)).join('')}</div>
    <div class="foot"><span>园区充电榜</span><span>前十名</span></div></div>`);
}
/* B. 字号递减堆叠：纯排版阶梯，名次越小字越大，无表格无线 */
function tgStackTop(users, meta) {
  const top = users.slice(0, 10);
  const sizes = [44, 36, 30, 25, 21, 18, 16.5, 15.5, 14.5, 13.5];
  return tgxDoc('园区充电榜', `<div class="page">${tgxHead(`${rankMetaLine(meta)} · 前十名`)}
    <div class="stack">${top.map((u, i) => `<div class="srow"><span class="snum" style="${i < 3 ? 'color:' + TB.hot : ''}">${i + 1}</span>
      <span class="snm" style="font-size:${sizes[i]}px">${magName(u)}</span></div>`).join('')}</div>
    <div class="foot"><span>${esc(rankDate(meta.dateStr))}</span><span>共 ${meta.gifters} 位送礼人</span></div></div>`);
}
/* C. 竖排名录：右起竖排，头名在最右，序号在列顶 */
function tgVcolTop(users, meta) {
  const top = users.slice(0, 10).reverse();
  return tgxDoc('园区充电榜', `<div class="page">${tgxHead(`${rankMetaLine(meta)} · 前十名`)}
    <div class="vcols">${top.map((u, idx) => {
      const rank = top.length - idx;
      return `<div class="vcol"><span class="vnum" style="${rank <= 3 ? 'color:' + TB.hot : ''}">${rank}</span>
        <span class="vav">${tbAv(u.avatar, 22, false)}</span><span class="vnm">${magName(u)}</span></div>`;
    }).join('')}</div>
    <div class="foot"><span>${esc(rankDate(meta.dateStr))}</span><span>前十名</span></div></div>`);
}
/* 三套的名次页：沿用同名次逻辑的分栏（阶梯/堆叠按名次分段、竖排两屏） */
function tgBarList(users, meta, pageLabel) {
  const half = Math.ceil(users.length / 2);
  const start = users.length ? users[0]._rank : 1;
  const end = users.length ? users[users.length - 1]._rank : start;
  const total = meta.count || Number(String(meta.gifters).replace(/[^0-9]/g, '')) || end;
  // 页深：越靠后的页 → 行更矮、字更小、条更细（版面空间 = 名次）
  const depth = start <= 10 ? 0 : (start <= 36 ? 1 : (start <= 62 ? 2 : 3));
  const RH = [26, 23, 19, 16][depth], FS = [12.5, 11.5, 10.2, 9.2][depth], AV = [18, 16, 13, 11][depth];
  const cw = (i, n) => 100 - i * (52 / Math.max(1, n - 1));
  const col = (arr, off) => {
    const n = arr.length || 1;
    return `<div class="cbcol">${arr.map((u, i) => {
      const dark = off + i < 3;
      return `<div class="cbrow"><span class="cbnum" style="font-size:${FS - 0.5}px;${dark ? 'color:' + TB.hot : ''}">${off + i + 1}</span>
        <span class="cbbar" style="height:${RH}px;width:${cw(i, n)}%;background:${dark ? 'rgba(14,14,16,0.9)' : 'rgba(14,14,16,0.11)'};color:${dark ? TB.bg : TB.ink}">
          ${tbAv(u.avatar, AV, false)}<span class="cbnm" style="font-size:${FS}px">${magName(u)}</span></span></div>`;
    }).join('')}</div>`;
  };
  const pct = (r) => Math.max(0, Math.min(100, (r - 1) / Math.max(1, total - 1) * 100));
  const ruler = `<div class="ruler"><span class="rtick" style="left:0"></span><span class="rtick" style="right:0"></span>
    <span class="rfill" style="left:${pct(start)}%;width:${Math.max(2, pct(end) - pct(start))}%"></span>
    <span class="rlab" style="left:0">1</span><span class="rlab" style="right:0">${total}</span></div>`;
  return tgxDoc('园区充电榜 · ' + pageLabel, `<div class="page"><div class="hotline"></div><div class="ghost" style="font-size:92px">名录</div>
    <div class="lhead"><div class="t">园区充电榜</div><div class="p">${esc(pageLabel)} · 共 ${total} 位</div></div>
    ${ruler}
    <div class="cbgrid" style="top:160px">${col(users.slice(0, half), users.length ? users[0]._rank - 1 : 0)}${col(users.slice(half), users.length ? users[half]._rank - 1 : 0)}</div>
    <div class="foot"><span>${rankMetaLine(meta)}</span><span>园区充电榜 · ${esc(pageLabel)}</span></div></div>`);
}
function tgStackList(users, meta, pageLabel) { return tgBarList(users, meta, pageLabel); }
function tgVcolList(users, meta, pageLabel) { return tgBarList(users, meta, pageLabel); }
// ==================== 三种排名形式：radial 环形 / track 赛道 / signwall 签名墙 ====================
const RX = { bg: '#F1EFE9', ink: '#0E0E10', hot: '#FF3B1F', soft: 'rgba(14,14,16,0.55)', faint: 'rgba(14,14,16,0.16)',
  sans: "'Noto Sans SC',system-ui,sans-serif" };
function rxDoc(t, b) { return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${tbFont()}<title>${esc(t)}</title><style>${rxCSS()}</style></head><body>${b}</body></html>`; }
function rxCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:540px;height:720px;overflow:hidden}
body{background:${RX.bg};color:${RX.ink};font-family:${RX.sans};-webkit-font-smoothing:antialiased}
.page{position:relative;width:540px;height:720px;overflow:hidden}
.hotline{position:absolute;left:0;top:0;width:540px;height:12px;background:${RX.hot}}
.mega{position:absolute;left:32px;top:34px;font-weight:900;font-size:52px;line-height:1;letter-spacing:-2px}
.sub{position:absolute;left:34px;top:104px;font-weight:900;font-size:11px;letter-spacing:3px;color:${RX.soft}}
.node{position:absolute;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:4px;width:118px}
.node .av{border-radius:50%;object-fit:cover;background:rgba(14,14,16,0.08)}
.node .nm{font-weight:900;font-size:11.5px;letter-spacing:-0.2px;text-align:center;line-height:1.15;
  max-width:118px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.node .rk{font-weight:900;font-size:10px;color:${RX.soft};font-variant-numeric:tabular-nums}
.node.top .nm{font-size:13px}
.ringguide{position:absolute;border:1px solid ${RX.faint};border-radius:50%;transform:translate(-50%,-50%)}
.center{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center}
.center .nm{font-weight:900;font-size:19px;letter-spacing:-0.5px}
.center .rk{font-weight:900;font-size:11px;color:${RX.soft};margin-top:6px;letter-spacing:2px}
.foot{position:absolute;left:0;bottom:0;width:540px;height:54px;background:${RX.ink};border-top:5px solid ${RX.hot};
  display:flex;align-items:center;justify-content:space-between;padding:0 34px}
.foot span{color:${RX.bg};font-weight:700;font-size:10.5px;letter-spacing:3px}
/* 赛道 */
.trackline{position:absolute;left:34px;right:34px;height:2px;background:rgba(14,14,16,0.5)}
.mark{position:absolute;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:5px}
.mark .tick{width:2px;background:rgba(14,14,16,0.45)}
.mark .vnm{writing-mode:vertical-rl;font-weight:900;font-size:13px;letter-spacing:1px;max-height:248px;overflow:hidden;text-overflow:ellipsis}
.mark .av{border-radius:50%;object-fit:cover}
.mark .rk{font-weight:900;font-size:11px;color:${RX.soft};font-variant-numeric:tabular-nums}
.axlab{position:absolute;font-weight:900;font-size:11px;color:${RX.soft};letter-spacing:1px}
/* 签名墙 */
.wall{position:absolute;left:0;right:0;top:0;bottom:0}
.sig{position:absolute;font-weight:900;letter-spacing:-0.5px;white-space:nowrap;max-width:520px;overflow:hidden;text-overflow:ellipsis}
.sig i{font-style:normal;font-size:0.52em;color:${RX.soft};margin-left:0.35em;font-variant-numeric:tabular-nums}`;
}
function rxAv(url, size) {
  if (!url) return `<span class="av" style="width:${size}px;height:${size}px;display:block"></span>`;
  const u = url.startsWith('//') ? 'https:' + url : url;
  return `<img class="av" src="${u}" style="width:${size}px;height:${size}px" />`;
}
function rxHead(title, sub) {
  return `<div class="hotline"></div><div class="mega">${esc(title)}</div><div class="sub">${esc(sub)}</div>`;
}
/* ---------- radial：头名在圆心 + 同心环 ---------- */
function radialNodes(users, cx, cy, radii, av, startRank) {
  const n = users.length, per = radii.length ? Math.ceil(n / radii.length) : n;
  return users.map((u, i) => {
    const ring = Math.floor(i / per), cnt = Math.min(per, n - ring * per);
    const k = i - ring * per, r = radii[Math.min(ring, radii.length - 1)];
    const ang = (-90 + k * 360 / cnt + (ring % 2 ? 360 / cnt / 2 : 0)) * Math.PI / 180;
    const x = cx + r * Math.cos(ang), y = cy + r * Math.sin(ang);
    const top = (startRank + i) <= 3;
    return `<div class="node${top ? ' top' : ''}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px">
      ${rxAv(u.avatar, av)}<span class="nm" style="${top ? 'color:' + RX.hot : ''}">${magName(u)}</span>
      <span class="rk">${startRank + i}</span></div>`;
  }).join('');
}
function rxRingGuides(cx, cy, radii) {
  return radii.map(r => `<div class="ringguide" style="left:${cx}px;top:${cy}px;width:${r * 2}px;height:${r * 2}px"></div>`).join('');
}
function radialTopHTML(users, meta) {
  const top = users.slice(0, 10);
  const head = top[0], ring = top.slice(1);
  const cx = 270, cy = 396, radii = [196];
  const ringHtml = ring.map((u, i) => {
    const ang = (-90 + i * 360 / ring.length) * Math.PI / 180;
    const x = cx + radii[0] * Math.cos(ang), y = cy + radii[0] * Math.sin(ang);
    return `<div class="node${i < 2 ? ' top' : ''}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px">
      ${rxAv(u.avatar, 30)}<span class="nm" style="${i < 2 ? 'color:' + RX.hot : ''}">${magName(u)}</span><span class="rk">${i + 2}</span></div>`;
  }).join('');
  return rxDoc('园区充电榜', `<div class="page">${rxHead('园区充电榜', `${rankMetaLine(meta)} · 前十名`)}
    ${rxRingGuides(cx, cy, radii)}
    <div class="center">${rxAv(head.avatar, 84)}<div class="nm" style="margin-top:10px">${magName(head)}</div><div class="rk">榜首 · 1</div></div>
    ${ringHtml}
    <div class="foot"><span>${esc(rankDate(meta.dateStr))}</span><span>前十名</span></div></div>`);
}
function radialListHTML(users, meta, pageLabel) {
  const cx = 270, cy = 400, radii = [150, 238];
  return rxDoc('园区充电榜 · ' + pageLabel, `<div class="page">
    <div class="mega" style="font-size:40px">园区充电榜</div>
    <div class="sub">${esc(pageLabel)} · 共 ${meta.gifters} 位送礼人</div>
    ${rxRingGuides(cx, cy, radii)}
    <div class="center"><span style="font-weight:900;font-size:26px;letter-spacing:-1px">${esc(pageLabel.replace(/[^0-9\-]/g, ''))}</span>
      <div class="rk">名次圈</div></div>
    ${radialNodes(users, cx, cy, radii, 26, users.length ? users[0]._rank : 1)}
    <div class="foot"><span>${rankMetaLine(meta)}</span><span>园区充电榜</span></div></div>`);
}
/* ---------- track：横向赛道，人挂在轴上（竖排名字） ---------- */
function trackPage(users, meta, title, sub, rankOf) {
  const N = 22;
  const seg = users.slice(0, N);
  const lineY = 356;
  const x0 = 34, w = 472;
  const marks = seg.map((u, i) => {
    const x = x0 + (seg.length === 1 ? w / 2 : i * w / (seg.length - 1));
    const rk = rankOf(u, i);
    const h = 26 + (i % 3) * 26;
    return `<div class="mark" style="left:${x.toFixed(1)}px;top:${lineY}px">
      <span class="rk" style="${rk <= 3 ? 'color:' + RX.hot : ''}">${rk}</span>
      <span class="tick" style="height:${h}px"></span>
      ${rxAv(u.avatar, 22)}
      <span class="vnm" style="${rk <= 3 ? 'color:' + RX.hot : ''}">${magName(u)}</span></div>`;
  }).join('');
  return rxDoc('园区充电榜 · ' + title, `<div class="page">${rxHead(title, sub)}
    <div class="trackline" style="top:${lineY}px"></div>
    ${marks}
    <div class="foot"><span>${rankMetaLine(meta)}</span><span>园区充电榜 · ${esc(title)}</span></div></div>`);
}
function trackTopHTML(users, meta) { return trackPage(users, meta, '园区充电榜', '起跑段 · 第 1-22 名', (u, i) => i + 1); }
function trackListHTML(users, meta, pageLabel) { return trackPage(users, meta, '园区充电榜', pageLabel, (u) => u._rank || 1); }
/* ---------- signwall：签名墙（大小/倾斜随名次） ---------- */
function sigW(name, fs) { return String(name).length * fs * 1.03 + 6; }
/** 签名墙：每个名字一个槽位，大小随名次递减，微倾斜，x 抖动避免呆板，自动夹在画布内 */
function signwallSlots(list, startRank, areaTop, areaH, cols, sizeFrom, sizeTo, jitter) {
  const n = list.length, rows = Math.ceil(n / cols), rowH = areaH / Math.max(1, rows);
  return list.map((u, i) => {
    const rank = startRank + i;
    const r = Math.floor(i / cols), c = i % cols;
    const scale = 1 - Math.min(1, i / Math.max(1, n - 1));
    let fs = sizeTo + (sizeFrom - sizeTo) * scale;
    const name = magName(u);
    const maxW = (472 / cols) - 10;
    if (sigW(name, fs) > maxW) fs = maxW / (String(name).length * 1.03 + 0.001);
    const w = sigW(name, fs);
    const colW = 472 / cols;
    let x = 34 + c * colW + (jitter[(i + r) % jitter.length] % Math.max(10, colW - w - 8));
    if (x + w > 512) x = Math.max(32, 512 - w);
    const y = areaTop + r * rowH + (rowH - fs * 1.3) * 0.45 + ((i % 3) - 1) * 4;
    const rot = ((i % 5) - 2) * 1.6;
    const col = rank <= 3 ? RX.hot : RX.ink;
    return `<div class="sig" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;font-size:${fs.toFixed(1)}px;color:${col};transform:rotate(${rot}deg)">${name}<i>${rank}</i></div>`;
  }).join('');
}
function signwallTopHTML(users, meta) {
  const top = users.slice(0, 10);
  const wall = signwallSlots(top, 1, 156, 486, 1, 34, 20, [0, 26, 12, 38, 6]);
  return rxDoc('园区充电榜', `<div class="page">${rxHead('园区充电榜', `${rankMetaLine(meta)} · 前十名`)}
    <div class="wall" style="top:120px;bottom:54px">${wall}</div>
    <div class="foot"><span>${esc(rankDate(meta.dateStr))}</span><span>前十名</span></div></div>`);
}
function signwallListHTML(users, meta, pageLabel) {
  const wall = signwallSlots(users.slice(0, 26), users.length ? users[0]._rank : 1, 150, 500, 2, 20, 13, [0, 18, 8, 26, 4]);
  return rxDoc('园区充电榜 · ' + pageLabel, `<div class="page">
    <div class="mega" style="font-size:38px">园区充电榜</div>
    <div class="sub">${esc(pageLabel)} · 共 ${meta.gifters} 位送礼人</div>
    <div class="wall" style="top:140px;bottom:54px">${wall}</div>
    <div class="foot"><span>${rankMetaLine(meta)}</span><span>园区充电榜</span></div></div>`);
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
const n=total.length;const topN=Math.min(10,n);const restCount=n-topN;const perPage=Math.ceil(restCount/3);console.log('🖼️  Image 1/4 (TOP '+topN+')...');await render(genTop10HTML(total.slice(0,topN),'TOP '+topN),path.join(outputDir,'thanks_rank_p1.jpg'));const pages=[{start:topN,end:Math.min(topN+perPage,n),label:`第${topN+1}-${Math.min(topN+perPage,n)}名`},{start:Math.min(topN+perPage,n),end:Math.min(topN+perPage*2,n),label:`第${Math.min(topN+perPage,n)+1}-${Math.min(topN+perPage*2,n)}名`},{start:Math.min(topN+perPage*2,n),end:n,label:`第${Math.min(topN+perPage*2,n)+1}-${n}名`}];for(let i=0;i<3;i++){const p=pages[i];if(p.start>=p.end)continue;console.log(`🖼️  Image ${i+2}/4 (${p.label})...`);await render(genHTML(total.slice(p.start,p.end),p.label),path.join(outputDir,`thanks_rank_p${i+2}.jpg`));}console.log('\n✅ Done!');}
main().catch(e=>{console.error(e);process.exit(1);});
