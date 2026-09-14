/**
 * 下载 douyinLive Go 代理的官方预编译产物并解压到项目根目录。
 *
 * 用法: node scripts/fetch-proxy-binary.js [win|linux|both]
 * 说明: 直连 GitHub 不可用时走 ghproxy.cc 镜像；解压后按项目约定重命名：
 *   linux -> douyinLive-linux-amd64
 *   win   -> douyinLive-win-amd64.exe
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { execFileSync } = require('child_process');

const TAG = process.env.PROXY_TAG || 'v2.2.1';
const COMMIT = process.env.PROXY_COMMIT || '60823bae3f14';
const ROOT = path.join(__dirname, '..');
const MIRROR = process.env.GH_MIRROR || 'https://ghproxy.cc/';
const API = `https://api.github.com/repos/jwwsjlm/douyinLive/releases/tags/${TAG}`;

const TARGETS = {
  linux: { asset: `douyinLive-${TAG}-${COMMIT}-linux-amd64.tar.gz`, out: 'douyinLive-linux-amd64', kind: 'tar' },
  win: { asset: `douyinLive-${TAG}-${COMMIT}-windows-amd64.zip`, out: 'douyinLive-win-amd64.exe', kind: 'zip' }
};

function download(url, dest, { insecure = false } = {}) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const req = https.get(url, { timeout: 180000, rejectUnauthorized: !insecure }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        return download(res.headers.location, dest, { insecure }).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const total = Number(res.headers['content-length'] || 0);
      let got = 0;
      res.on('data', (c) => {
        got += c.length;
        if (total) process.stdout.write(`\r  下载中 ${(got / 1048576).toFixed(1)}/${(total / 1048576).toFixed(1)} MB`);
      });
      res.pipe(file);
      file.on('finish', () => {
        // 显式关闭并等待句柄释放，否则紧接着的解压会报"文件被占用"
        file.close(() => {
          process.stdout.write('\n');
          setTimeout(() => resolve(dest), 300);
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('下载超时')); });
  });
}

/** 带镜像回退的下载：先直连，失败换 ghproxy（镜像证书可能过期，故放宽校验） */
async function downloadWithFallback(assetName, dest) {
  const direct = `https://github.com/jwwsjlm/douyinLive/releases/download/${TAG}/${assetName}`;
  const mirrored = `${MIRROR}${direct}`;
  const attempts = [
    ['直连', direct, false],
    ['镜像', mirrored, true]
  ];
  for (const [label, url, insecure] of attempts) {
    try {
      console.log(`[binary] ${label} 下载 ${assetName}`);
      await download(url, dest, { insecure });
      const size = fs.statSync(dest).size;
      if (size < 1024 * 100) throw new Error(`文件过小 (${size} bytes)，可能不是有效包`);
      return { url, size, label };
    } catch (e) {
      console.log(`[binary] ${label} 失败: ${e.message}`);
    }
  }
  throw new Error(`两种方式都下载失败: ${assetName}`);
}

function extract(archive, kind, outDir, outName) {
  fs.mkdirSync(outDir, { recursive: true });
  if (kind === 'tar') {
    // Windows 10+ 自带 bsdtar
    execFileSync('tar', ['-xzf', archive, '-C', outDir], { stdio: 'inherit' });
  } else {
    execFileSync(
      'powershell',
      ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${outDir}' -Force`],
      { stdio: 'inherit' }
    );
  }
  // 归档内可执行文件名为 douyinLive / douyinLive.exe（可能带一层目录）
  const found = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/^douyinLive(\.exe)?$/i.test(e.name)) found.push(p);
    }
  };
  walk(outDir);
  if (!found.length) throw new Error(`压缩包里没找到 douyinLive 可执行文件 (${outDir})`);
  const target = path.join(ROOT, outName);
  fs.copyFileSync(found[0], target);
  try { fs.chmodSync(target, 0o755); } catch { /* Windows 无意义 */ }
  return target;
}

async function main() {
  const which = (process.argv[2] || 'both').toLowerCase();
  const want = which === 'both' ? ['linux', 'win'] : [which];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dyl-proxy-'));

  for (const key of want) {
    const t = TARGETS[key];
    if (!t) { console.log(`未知目标: ${key}`); continue; }
    const archive = path.join(tmp, t.asset);
    const { label, size } = await downloadWithFallback(t.asset, archive);
    console.log(`[binary] 下载完成 ${(size / 1048576).toFixed(1)} MB (${label})`);
    const out = extract(archive, t.kind, path.join(tmp, key), t.out);
    console.log(`[binary] 已放置: ${path.relative(ROOT, out)}  (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
  }
  console.log('\n完成。');
}

main().catch((e) => { console.error('失败:', e.message); process.exitCode = 1; });
