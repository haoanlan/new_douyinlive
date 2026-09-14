/**
 * 仅下载并解压 Windows 版代理（复用 fetch-proxy-binary 的下载逻辑）。
 * 独立脚本的原因：Windows 上 zip 会被安全软件短暂占用，改成"复制副本再解压"绕过。
 * 用法: node scripts/fetch-proxy-win.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { execFileSync } = require('child_process');

const TAG = 'v2.2.1';
const COMMIT = '60823bae3f14';
const ASSET = `douyinLive-${TAG}-${COMMIT}-windows-amd64.zip`;
const ROOT = path.join(__dirname, '..');
const OUT_NAME = 'douyinLive-win-amd64.exe';

function download(url, dest, insecure) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const req = https.get(url, { timeout: 180000, rejectUnauthorized: !insecure }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        return download(res.headers.location, dest, insecure).then(resolve, reject);
      }
      if (res.statusCode !== 200) { file.close(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const total = Number(res.headers['content-length'] || 0);
      let got = 0;
      res.on('data', (c) => {
        got += c.length;
        if (total) process.stdout.write(`\r  下载中 ${(got / 1048576).toFixed(1)}/${(total / 1048576).toFixed(1)} MB`);
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => { process.stdout.write('\n'); setTimeout(() => resolve(dest), 500); }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('超时')));
  });
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dyl-win-'));
  const archive = path.join(tmp, ASSET);
  const direct = `https://github.com/jwwsjlm/douyinLive/releases/download/${TAG}/${ASSET}`;
  const candidates = [
    ['直连', direct, false],
    ['镜像', `https://ghproxy.cc/${direct}`, true]
  ];
  let ok = false;
  for (const [label, url, insecure] of candidates) {
    try {
      console.log(`[win] ${label} 下载`);
      await download(url, archive, insecure);
      if (fs.statSync(archive).size < 1024 * 100) throw new Error('文件过小');
      ok = true;
      break;
    } catch (e) {
      console.log(`[win] ${label} 失败: ${e.message}`);
    }
  }
  if (!ok) throw new Error('下载失败');

  // 复制副本再解压，避开原文件的占用
  const copy = path.join(tmp, 'copy.zip');
  fs.copyFileSync(archive, copy);
  console.log('[win] 解压副本');
  execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${copy}' -DestinationPath '${path.join(tmp, 'out')}' -Force`], { stdio: 'inherit' });

  const found = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/^douyinLive(\.exe)?$/i.test(e.name)) found.push(p);
    }
  };
  walk(path.join(tmp, 'out'));
  if (!found.length) throw new Error('压缩包内没找到可执行文件');
  const target = path.join(ROOT, OUT_NAME);
  fs.copyFileSync(found[0], target);
  console.log(`[win] 已放置: ${OUT_NAME} (${(fs.statSync(target).size / 1048576).toFixed(1)} MB)`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

main().catch((e) => { console.error('失败:', e.message); process.exitCode = 1; });
