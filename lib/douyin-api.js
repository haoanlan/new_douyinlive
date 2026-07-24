/**
 * 抖音 API 查询模块（Node.js 版）
 * 从 Python DouYin_Spider 改写，支持：作品、用户、评论、粉丝、关注、直播间
 */

const fs = require('fs');
const path = require('path');

const DOUYIN_URL = 'https://www.douyin.com';
const SYMB = 'Dkdpgh4ZKsQB80/Mfvw36XI1R25+WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe=';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ====== 工具函数 ======

function randomABogus() {
  let s = 'AG';
  for (let i = 0; i < 25; i++) s += SYMB[Math.floor(Math.random() * 64)];
  return s;
}

/** 从 config.yaml 读取 cookie（支持单引号和双引号） */
function getCookie() {
  try {
    const yaml = fs.readFileSync(path.join(__dirname, '..', 'config.yaml'), 'utf-8');
    const m = yaml.match(/douyin:\s*(?:'([^']+)'|"([^"]+)")/);
    return m ? (m[1] || m[2]) : '';
  } catch (e) { return ''; }
}

/** 从 cookie 字符串解析为对象 */
function parseCookie(str) {
  const obj = {};
  if (!str) return obj;
  for (const part of str.split(';')) {
    const [k, ...v] = part.split('=');
    if (k) obj[k.trim()] = v.join('=').trim();
  }
  return obj;
}

/** 构建公共查询参数 */
function baseParams() {
  return {
    device_platform: 'webapp',
    aid: '6383',
    channel: 'channel_pc_web',
    update_version_code: '170400',
    pc_client_type: '1',
    version_code: '170400',
    version_name: '17.4.0',
    cookie_enabled: 'true',
    screen_width: '1920',
    screen_height: '1080',
    browser_language: 'zh-CN',
    browser_platform: 'Win32',
    browser_name: 'Edge',
    browser_version: '125.0.0.0',
    browser_online: 'true',
    engine_name: 'Blink',
    engine_version: '125.0.0.0',
    os_name: 'Windows',
    os_version: '10',
    cpu_core_num: '16',
    device_memory: '8',
    platform: 'PC',
    downlink: '10',
    effective_type: '4g',
    round_trip_time: '100',
  };
}

/** 构建请求 headers */
function buildHeaders(referer) {
  return {
    'User-Agent': UA,
    'Referer': referer || 'https://www.douyin.com/',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  };
}

/** 通用 GET 请求 */
async function apiGet(apiPath, extraParams, referer) {
  const cookie = getCookie();
  if (!cookie) throw new Error('config.yaml 中未配置抖音 cookie');

  const cookieObj = parseCookie(cookie);
  const params = {
    ...baseParams(),
    ...extraParams,
    verifyFp: cookieObj.s_v_web_id || '',
    fp: cookieObj.s_v_web_id || '',
    msToken: cookieObj.msToken || '',
    a_bogus: randomABogus(),
  };

  const qs = Object.entries(params)
    .filter(([, v]) => v !== '' && v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const url = `${DOUYIN_URL}${apiPath}?${qs}`;
  const headers = buildHeaders(referer);
  headers['Accept-Encoding'] = 'identity';  // 避免压缩，方便解析
  headers['Cookie'] = cookie;  // 必须带 cookie

  const resp = await fetch(url, { headers });
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`API 响应解析失败: ${text.substring(0, 200)}`);
  }
}

// ====== API 函数 ======

/**
 * 获取作品详情
 * @param {string} awemeId - 作品 ID（从 URL 提取）
 * @param {string} [url] - 作品 URL（可选，用于 referer）
 */
async function getWorkInfo(awemeId, url) {
  const referer = url || `https://www.douyin.com/video/${awemeId}`;
  const data = await apiGet('/aweme/v1/web/aweme/detail/', {
    aweme_id: awemeId,
  }, referer);
  return data.aweme_detail || null;
}

/**
 * 获取用户信息
 * @param {string} secUid - 用户 sec_uid
 */
async function getUserInfo(secUid) {
  const referer = `https://www.douyin.com/user/${secUid}`;
  const data = await apiGet('/aweme/v1/web/user/profile/other/', {
    sec_user_id: secUid,
    personal_center_strategy: '1',
    source: 'channel_pc_web',
    publish_video_strategy_type: '2',
  }, referer);
  return data.user || null;
}

/**
 * 获取用户作品列表（单页）
 * @param {string} secUid - 用户 sec_uid
 * @param {string} [maxCursor='0'] - 分页游标
 */
async function getUserWorks(secUid, maxCursor = '0') {
  const referer = `https://www.douyin.com/user/${secUid}`;
  const data = await apiGet('/aweme/v1/web/aweme/post/', {
    sec_user_id: secUid,
    max_cursor: maxCursor,
    locate_query: 'false',
    show_live_replay_strategy: '1',
    need_time_list: maxCursor === '0' ? '1' : '0',
    time_list_query: '0',
    whale_cut_token: '',
    cut_version: '1',
    count: '18',
    publish_video_strategy_type: '2',
  }, referer);
  return {
    list: data.aweme_list || [],
    hasMore: data.has_more === 1,
    maxCursor: String(data.max_cursor || ''),
  };
}

/**
 * 获取用户全部作品
 * @param {string} secUid - 用户 sec_uid
 * @param {number} [maxCount=100] - 最大数量
 */
async function getUserAllWorks(secUid, maxCount = 100) {
  const all = [];
  let cursor = '0';
  while (all.length < maxCount) {
    const res = await getUserWorks(secUid, cursor);
    all.push(...res.list);
    if (!res.hasMore || all.length >= maxCount) break;
    cursor = res.maxCursor;
    await new Promise(r => setTimeout(r, 300)); // 防限流
  }
  return all.slice(0, maxCount);
}

/**
 * 获取作品评论（单页）
 * @param {string} awemeId - 作品 ID
 * @param {string} [cursor='0'] - 分页游标
 */
async function getComments(awemeId, cursor = '0') {
  const referer = `https://www.douyin.com/video/${awemeId}`;
  const data = await apiGet('/aweme/v1/web/comment/list/', {
    aweme_id: awemeId,
    cursor,
    count: '20',
    item_type: '0',
    whale_cut_token: '',
    cut_version: '1',
    rcFT: '',
  }, referer);
  return {
    list: data.comments || [],
    hasMore: data.has_more === 1,
    cursor: String(data.cursor || ''),
    total: data.total || 0,
  };
}

/**
 * 获取作品全部评论（含子评论）
 * @param {string} awemeId - 作品 ID
 * @param {number} [maxCount=200] - 最大数量
 */
async function getAllComments(awemeId, maxCount = 200) {
  const all = [];
  let cursor = '0';
  while (all.length < maxCount) {
    const res = await getComments(awemeId, cursor);
    all.push(...res.list);
    if (!res.hasMore || all.length >= maxCount) break;
    cursor = res.cursor;
    await new Promise(r => setTimeout(r, 300));
  }
  return all.slice(0, maxCount);
}

/**
 * 获取粉丝列表（单页）
 * @param {string} userId - 用户 ID
 * @param {string} secUid - 用户 sec_uid
 * @param {string} [maxTime='0'] - 时间游标
 */
async function getFollowers(userId, secUid, maxTime = '0') {
  const referer = `https://www.douyin.com/user/${secUid}`;
  const data = await apiGet('/aweme/v1/web/user/follower/list/', {
    user_id: userId,
    sec_user_id: secUid,
    offset: '0',
    min_time: '0',
    max_time: maxTime,
    count: '20',
    source_type: maxTime === '0' ? '2' : '1',
    gps_access: '0',
    address_book_access: '0',
  }, referer);
  return {
    list: data.followers || [],
    hasMore: data.has_more === 1,
    minTime: String(data.min_time || ''),
  };
}

/**
 * 获取用户全部粉丝
 * @param {string} userId - 用户 ID
 * @param {string} secUid - 用户 sec_uid
 * @param {number} [maxCount=100] - 最大数量
 */
async function getAllFollowers(userId, secUid, maxCount = 100) {
  const all = [];
  let maxTime = '0';
  while (all.length < maxCount) {
    const res = await getFollowers(userId, secUid, maxTime);
    all.push(...res.list);
    if (!res.hasMore || all.length >= maxCount) break;
    maxTime = res.minTime;
    await new Promise(r => setTimeout(r, 300));
  }
  return all.slice(0, maxCount);
}

/**
 * 获取关注列表（单页）
 * @param {string} userId - 用户 ID
 * @param {string} secUid - 用户 sec_uid
 * @param {string} [maxTime='0'] - 时间游标
 */
async function getFollowing(userId, secUid, maxTime = '0') {
  const referer = `https://www.douyin.com/user/${secUid}`;
  const data = await apiGet('/aweme/v1/web/user/following/list/', {
    user_id: userId,
    sec_user_id: secUid,
    offset: '0',
    min_time: '0',
    max_time: maxTime,
    count: '20',
    source_type: maxTime === '0' ? '2' : '1',
    gps_access: '0',
    address_book_access: '0',
    is_top: '1',
  }, referer);
  return {
    list: data.followings || [],
    hasMore: data.has_more === 1,
    minTime: String(data.min_time || ''),
  };
}

/**
 * 获取用户全部关注
 * @param {string} userId - 用户 ID
 * @param {string} secUid - 用户 sec_uid
 * @param {number} [maxCount=100] - 最大数量
 */
async function getAllFollowing(userId, secUid, maxCount = 100) {
  const all = [];
  let maxTime = '0';
  while (all.length < maxCount) {
    const res = await getFollowing(userId, secUid, maxTime);
    all.push(...res.list);
    if (!res.hasMore || all.length >= maxCount) break;
    maxTime = res.minTime;
    await new Promise(r => setTimeout(r, 300));
  }
  return all.slice(0, maxCount);
}

/**
 * 获取直播间信息
 * @param {string} liveId - 直播间 ID（数字或 short_id）
 */
async function getLiveInfo(liveId) {
  const cookie = getCookie();
  const url = `https://live.douyin.com/${liveId}`;

  const resp = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Referer': 'https://live.douyin.com/?from_nav=1',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Cookie': cookie,
    },
    redirect: 'manual',
  });

  const html = await resp.text();

  // 抖音页面使用 \\\\\" 转义的 JSON，提取有效值
  // 跳过 $undefined、0、和明显的错误值
  function extractFirst(pattern, skipValues) {
    const skip = new Set(['$undefined', '0', ...(skipValues || [])]);
    const all = [...html.matchAll(new RegExp(pattern, 'g'))];
    for (const m of all) {
      const val = m[1];
      if (val && !skip.has(val) && !val.startsWith('404')) return val;
    }
    return null;
  }

  const roomId = extractFirst(/\\+"roomId\\+":\\+"(\d+)\\+"/);
  const anchorId = extractFirst(/\\+"anchor\\+":\{\\+"id_str\\+":\\+"(\d+)\\+"/);
  const secUid = extractFirst(/\\+"sec_uid\\+":\\+"([^"\\\\]+)\\+"/);
  const status = extractFirst(/\\+"status\\+":(\d+)/);
  const title = extractFirst(/\\+"title\\+":\\+"((?:[^"\\\\]|\\\\.){1,100})\\+"/);
  const avatar = extractFirst(/\\+"avatarThumb\\+":\{\\+"urlList\\+":\[\\+"(https?:[^"\\\\]+)\\+"/);

  // web_rid 就是我们传入的 liveId
  if (!roomId && !anchorId) return null;

  return {
    room_id: roomId || liveId,
    web_rid: liveId,
    user_id: '',
    anchor_id: anchorId || '',
    sec_uid: secUid || '',
    nickname: '',
    avatar: avatar || '',
    room_status: status || '0',
    room_title: title || '',
  };
}

// ====== CLI ======
if (require.main === module) {
  const [cmd, ...args] = process.argv.slice(2);

  const commands = {
    async work() {
      if (!args[0]) { console.error('用法: node douyin-api.js work <aweme_id>'); process.exit(1); }
      const info = await getWorkInfo(args[0]);
      console.log(JSON.stringify(info, null, 2));
    },
    async user() {
      if (!args[0]) { console.error('用法: node douyin-api.js user <sec_uid>'); process.exit(1); }
      const info = await getUserInfo(args[0]);
      console.log(JSON.stringify(info, null, 2));
    },
    async works() {
      if (!args[0]) { console.error('用法: node douyin-api.js works <sec_uid> [max]'); process.exit(1); }
      const max = parseInt(args[1]) || 20;
      const list = await getUserAllWorks(args[0], max);
      console.log(`共 ${list.length} 个作品`);
      list.forEach((w, i) => console.log(`${i + 1}. ${w.desc || '(无描述)'}`));
    },
    async comments() {
      if (!args[0]) { console.error('用法: node douyin-api.js comments <aweme_id> [max]'); process.exit(1); }
      const max = parseInt(args[1]) || 20;
      const list = await getAllComments(args[0], max);
      console.log(`共 ${list.length} 条评论`);
      list.forEach((c, i) => console.log(`${i + 1}. ${c.user?.nickname}: ${c.text}`));
    },
    async followers() {
      if (!args[0] || !args[1]) { console.error('用法: node douyin-api.js followers <user_id> <sec_uid> [max]'); process.exit(1); }
      const max = parseInt(args[2]) || 20;
      const list = await getAllFollowers(args[0], args[1], max);
      console.log(`共 ${list.length} 个粉丝`);
      list.forEach((f, i) => console.log(`${i + 1}. ${f.nickname}`));
    },
    async following() {
      if (!args[0] || !args[1]) { console.error('用法: node douyin-api.js following <user_id> <sec_uid> [max]'); process.exit(1); }
      const max = parseInt(args[2]) || 20;
      const list = await getAllFollowing(args[0], args[1], max);
      console.log(`共 ${list.length} 个关注`);
      list.forEach((f, i) => console.log(`${i + 1}. ${f.nickname}`));
    },
    async live() {
      if (!args[0]) { console.error('用法: node douyin-api.js live <live_id>'); process.exit(1); }
      const info = await getLiveInfo(args[0]);
      console.log(JSON.stringify(info, null, 2));
    },
  };

  if (!cmd || !commands[cmd]) {
    console.log('用法: node douyin-api.js <command> [args...]');
    console.log('命令:');
    console.log('  work <aweme_id>              查询作品信息');
    console.log('  user <sec_uid>               查询用户信息');
    console.log('  works <sec_uid> [max]        获取用户作品列表');
    console.log('  comments <aweme_id> [max]    获取作品评论');
    console.log('  followers <uid> <sec> [max]  获取粉丝列表');
    console.log('  following <uid> <sec> [max]  获取关注列表');
    console.log('  live <live_id>               获取直播间信息');
    process.exit(0);
  }

  commands[cmd]().catch(e => { console.error('错误:', e.message); process.exit(1); });
}

module.exports = {
  getWorkInfo,
  getUserInfo,
  getUserWorks,
  getUserAllWorks,
  getComments,
  getAllComments,
  getFollowers,
  getAllFollowers,
  getFollowing,
  getAllFollowing,
  getLiveInfo,
};