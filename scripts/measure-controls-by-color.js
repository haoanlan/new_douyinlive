/**
 * 在截图中按"颜色签名"定位控件，并给出各自的精确高度与垂直中心。
 * 用于判断按钮/开关高度是否一致（比按背景聚类更可靠，因为卡片底色相近会连成一片）。
 *
 * 用法: node scripts/measure-controls-by-color.js <png>
 */
const fs = require('fs');
const zlib = require('zlib');

function decodePng(file) {
  const buf = fs.readFileSync(file);
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (data[12] !== 0) throw new Error('不支持隔行 PNG');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`bitDepth=${bitDepth} 不支持`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : null;
  if (!channels) throw new Error(`colorType=${colorType} 不支持`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const line = raw.slice(rp, rp + stride); rp += stride;
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.slice(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a; else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, channels, pixels: out };
}

const file = process.argv[2];
if (!file) { console.error('用法: node scripts/measure-controls-by-color.js <png>'); process.exit(1); }
const { width, height, channels, pixels } = decodePng(file);
const at = (x, y) => {
  const i = (y * width + x) * channels;
  return [pixels[i], pixels[i + 1], pixels[i + 2]];
};
const near = (c, t, tol = 22) =>
  Math.abs(c[0] - t[0]) <= tol && Math.abs(c[1] - t[1]) <= tol && Math.abs(c[2] - t[2]) <= tol;

console.log(`图片: ${width} × ${height}`);

/** 先统计整图出现的颜色（量化到 8 级），挑出候选控件色 */
const hist = {};
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const [r, g, b] = at(x, y);
    const key = `${r >> 3 << 3},${g >> 3 << 3},${b >> 3 << 3}`;
    hist[key] = (hist[key] || 0) + 1;
  }
}
const topColors = Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log('\n整图主色（量化）:');
topColors.forEach(([c, n]) => console.log(`  rgb(${c}) × ${n}`));

/** 对某个目标色：找出所有匹配像素的包围盒 + 按列分组的每个控件盒 */
function locate(target, label) {
  const pts = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (near(at(x, y), target)) pts.push([x, y]);
    }
  }
  if (!pts.length) { console.log(`\n${label}: 未找到 rgb(${target})`); return; }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  console.log(`\n${label} rgb(${target}): ${pts.length} 像素，整体 x=${Math.min(...xs)}..${Math.max(...xs)} y=${Math.min(...ys)}..${Math.max(...ys)}`);

  // 按列间隔分组成多个控件
  const cols = [...new Set(xs)].sort((a, b) => a - b);
  const groups = [];
  let cur = [cols[0]];
  for (let i = 1; i < cols.length; i++) {
    if (cols[i] - cols[i - 1] <= 3) cur.push(cols[i]);
    else { groups.push(cur); cur = [cols[i]]; }
  }
  groups.push(cur);
  groups.forEach((g, i) => {
    const gx0 = g[0], gx1 = g[g.length - 1];
    const gys = pts.filter((p) => p[0] >= gx0 && p[0] <= gx1).map((p) => p[1]);
    const gy0 = Math.min(...gys), gy1 = Math.max(...gys);
    console.log(`  控件${i + 1}: x=${gx0}..${gx1} (宽 ${gx1 - gx0 + 1})  y=${gy0}..${gy1} (高 ${gy1 - gy0 + 1})  中心Y=${((gy0 + gy1) / 2).toFixed(1)}`);
  });
}

// 常见控件色：主色 #5D87FF、浅蓝填充、成功绿、边框灰
locate([93, 135, 255], '主色（实心按钮/开关轨道）');
locate([227, 237, 254], '浅色描边按钮内填充');
locate([0, 190, 120], '成功绿圆点');
