/**
 * config-reader 统一配置解析测试
 */
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 由于 config-reader.js 硬编码了 CONFIG_PATH 指向项目根目录的 config.yaml，
// 我们需要用临时文件测试。这里直接测试 extractNestedValue/extractTopValue
const { extractNestedValue, extractTopValue } = require('../lib/config-reader');

describe('extractNestedValue', () => {
  test('单引号值', () => {
    const yaml = "cookie:\n  douyin: 'ttwid=abc; sessionid=xyz'";
    assert.strictEqual(extractNestedValue(yaml, 'cookie', 'douyin'), 'ttwid=abc; sessionid=xyz');
  });

  test('双引号值', () => {
    const yaml = 'cookie:\n  douyin: "ttwid=abc; sessionid=xyz"';
    assert.strictEqual(extractNestedValue(yaml, 'cookie', 'douyin'), 'ttwid=abc; sessionid=xyz');
  });

  test('无引号值', () => {
    const yaml = 'dashboard:\n  port: 9871';
    assert.strictEqual(extractNestedValue(yaml, 'dashboard', 'port'), '9871');
  });

  test('空字符串值', () => {
    const yaml = 'cookie:\n  douyin: ""';
    assert.strictEqual(extractNestedValue(yaml, 'cookie', 'douyin'), '');
  });

  test('带注释的值', () => {
    const yaml = "dashboard:\n  token: 'my-secret' # 这是令牌";
    assert.strictEqual(extractNestedValue(yaml, 'dashboard', 'token'), 'my-secret');
  });

  test('键不存在返回空字符串', () => {
    const yaml = 'cookie:\n  douyin: "test"';
    assert.strictEqual(extractNestedValue(yaml, 'cookie', 'nonexistent'), '');
  });

  test('父键不存在返回空字符串', () => {
    const yaml = 'other:\n  key: "value"';
    assert.strictEqual(extractNestedValue(yaml, 'cookie', 'douyin'), '');
  });

  test('多行 YAML 中正确定位嵌套键', () => {
    const yaml = `port: "1088"
unknown: false
log:
  level: "info"
cookie:
  douyin: "my-cookie-value"
dashboard:
  token: "my-token"
  host: "0.0.0.0"`;
    assert.strictEqual(extractNestedValue(yaml, 'cookie', 'douyin'), 'my-cookie-value');
    assert.strictEqual(extractNestedValue(yaml, 'dashboard', 'token'), 'my-token');
    assert.strictEqual(extractNestedValue(yaml, 'dashboard', 'host'), '0.0.0.0');
  });
});

describe('extractTopValue', () => {
  test('单引号顶层值', () => {
    const yaml = "port: '1088'";
    assert.strictEqual(extractTopValue(yaml, 'port'), '1088');
  });

  test('双引号顶层值', () => {
    const yaml = 'port: "1088"';
    assert.strictEqual(extractTopValue(yaml, 'port'), '1088');
  });

  test('无引号顶层值', () => {
    const yaml = 'unknown: false';
    assert.strictEqual(extractTopValue(yaml, 'unknown'), 'false');
  });

  test('顶层键不存在', () => {
    const yaml = 'port: "1088"';
    assert.strictEqual(extractTopValue(yaml, 'nonexistent'), '');
  });
});
