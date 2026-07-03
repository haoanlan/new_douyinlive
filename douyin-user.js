/**
 * 获取用户信息（头像等）
 * 用于 report-image.js 加载主播头像
 */
const api = require('./lib/douyin-api.js');

async function fetchUserBySecUid(secUid) {
  try {
    const info = await api.getUserInfo(secUid);
    if (info) {
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
        ip_location: info.ip_location || '',
        is_private: info.is_private || false,
      };
    }
  } catch (e) {
    // 静默失败
  }
  return null;
}

module.exports = { fetchUserBySecUid };
