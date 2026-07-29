/**
 * comboDedupGifts 连击去重逻辑测试
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { comboDedupGifts } = require('../lib/gift-utils');

describe('comboDedupGifts', () => {
  test('空数组返回空数组', () => {
    assert.deepStrictEqual(comboDedupGifts([]), []);
  });

  test('单条礼物直接返回', () => {
    const gifts = [{ id: 1, user_display_id: 'u1', gift_name: '玫瑰', combo_count: 1 }];
    const result = comboDedupGifts(gifts);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 1);
  });

  test('不同用户/礼物/收礼人不去重', () => {
    const gifts = [
      { id: 1, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a', combo_count: 1 },
      { id: 2, user_display_id: 'u2', gift_name: '玫瑰', to_user_sec_uid: 'a', combo_count: 1 },
      { id: 3, user_display_id: 'u1', gift_name: '嘉年华', to_user_sec_uid: 'a', combo_count: 1 },
      { id: 4, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'b', combo_count: 1 },
    ];
    const result = comboDedupGifts(gifts);
    assert.strictEqual(result.length, 4);
  });

  test('同组连击递增只保留最高帧', () => {
    const gifts = [
      { id: 1, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a', combo_count: 1 },
      { id: 2, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a', combo_count: 2 },
      { id: 3, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a', combo_count: 3 },
      { id: 4, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a', combo_count: 5, repeat_end: 1 },
    ];
    const result = comboDedupGifts(gifts);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].combo_count, 5);
    assert.strictEqual(result[0].repeat_end, 1);
  });

  test('连击终结帧同值时保留 repeat_end=1 的帧', () => {
    const gifts = [
      { id: 1, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a', combo_count: 3 },
      { id: 2, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a', combo_count: 3, repeat_end: 1 },
    ];
    const result = comboDedupGifts(gifts);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 2);
    assert.strictEqual(result[0].repeat_end, 1);
  });

  test('两组独立连击各保留最高帧', () => {
    const gifts = [
      { id: 1, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a', combo_count: 1 },
      { id: 2, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a', combo_count: 2, repeat_end: 1 },
      // 新序列开始
      { id: 3, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a', combo_count: 1 },
      { id: 4, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a', combo_count: 3, repeat_end: 1 },
    ];
    const result = comboDedupGifts(gifts);
    assert.strictEqual(result.length, 2);
    // 第一组最高 combo_count=2
    assert.strictEqual(result[0].combo_count, 2);
    // 第二组最高 combo_count=3
    assert.strictEqual(result[1].combo_count, 3);
  });

  test('帧序错乱时按 combo_count 排序取最高', () => {
    const gifts = [
      { id: 1, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a', combo_count: 3 },
      { id: 2, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a', combo_count: 2 },
      { id: 3, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a', combo_count: 5 },
      { id: 4, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a', combo_count: 4 },
    ];
    const result = comboDedupGifts(gifts);
    // 所有帧都被认为是同一序列（cc < pc && cc > 1 时加入），最终取最高
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].combo_count, 5);
  });

  test('fallback 到 nickname 当 user_display_id 缺失', () => {
    const gifts = [
      { id: 1, nickname: '用户A', gift_name: '玫瑰', to_nickname: '主播B', combo_count: 1 },
      { id: 2, nickname: '用户A', gift_name: '玫瑰', to_nickname: '主播B', combo_count: 2, repeat_end: 1 },
    ];
    const result = comboDedupGifts(gifts);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].combo_count, 2);
  });

  test('combo_count 缺失时默认为 1', () => {
    const gifts = [
      { id: 1, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a' },
      { id: 2, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a' },
    ];
    const result = comboDedupGifts(gifts);
    // 两条 combo_count 都默认为 1，第二帧 cc === pc 且无 repeat_end，开新序列
    assert.strictEqual(result.length, 2);
  });
});
