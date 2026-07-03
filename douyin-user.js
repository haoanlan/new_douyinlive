/**
 * 获取用户信息（头像等）
 * 用于 report-image.js 加载主播头像
 */
const api = require('./lib/douyin-api.js');

async function fetchUserBySecUid(secUid) {
  try {
    const info = await api.getUserInfo(secUid);
    if (info) {
      // IP属地：优先 ip_location，否则用 country/province/city 拼接
      let ipLocation = info.ip_location || '';
      if (!ipLocation) {
        const parts = [info.country, info.province, info.city].filter(Boolean);
        if (parts.length) ipLocation = 'IP属地：' + parts.join(' ');
      }
      return {
        sec_uid: secUid,
        nickname: info.nickname || '',
        avatar: info.avatar_168x168?.url_list?.[0] || info.avatar_larger?.url_list?.[0] || '',
        signature: info.signature || '',
        uid: info.uid || '',
        unique_id: info.unique_id || info.short_id || '',
        follower_count: info.follower_count || 0,
        following_count: info.following_count || 0,
        total_favorited: info.total_favorited || 0,
        aweme_count: info.aweme_count || 0,
        commerce_user_level: info.commerce_user_level || 0,
        ip_location: ipLocation,
        is_private: info.is_private || false,
      };
    }
  } catch (e) {
    // 静默失败
  }
  return null;
}

module.exports = { fetchUserBySecUid };
