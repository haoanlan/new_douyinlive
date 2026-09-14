/**
 * 从截图里量控件几何：扫描非背景像素连通块，输出每个控件的包围盒与相互间距。
 * 用法: node scripts/measure-screenshot.js <图片路径>
 */
const fs = require('fs');
const zlib = require('zlib');

/** 极简 PNG 解码（支持 8bit RGB/RGBA、非隔行） */
function decodePng(file) {
  const buf = fs.readFileSync(file);
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('不支持隔行 PNG');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`不支持 bitDepth=${bitDepth}`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : null;
  if (!channels) throw new Error(`不支持 colorType=${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const line = raw.slice(rp, rp + stride);
    rp += stride;
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.slice(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, channels, pixels: out };
}

function main() {
  const args = process.argv.slice(2);
  const file = args[0];
  const wantCrop = args.includes('--crop');
  const wantRows = args.includes('--rows');
  if (!file) { console.error('用法: node scripts/measure-screenshot.js <png> [--crop] [--rows]'); process.exit(1); }
  let img = decodePng(file);
  let { width, height, channels, pixels } = img;
  console.log(`图片: ${width} × ${height}`);

  // 背景色取四角
  const at = (x, y) => {
    const i = (y * width + x) * channels;
    return [pixels[i], pixels[i + 1], pixels[i + 2]];
  };
  const bg = at(2, 2);
  console.log(`背景色: rgb(${bg.join(',')})`);

  const isFg = (x, y) => {
    const [r, g, b] = at(x, y);
    return Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]) > 18;
  };

  /** 在给定区域内按列聚类 */
  const clusterCols = (region) => {
    const groups = [];
    let start = -1;
    let gap = 0;
    for (let x = region.x0; x <= region.x1; x++) {
      let has = false;
      for (let y = region.y0; y <= region.y1; y++) if (isFg(x, y)) { has = true; break; }
      if (has) {
        if (start < 0) start = x;
        gap = 0;
      } else if (start >= 0) {
        gap++;
        if (gap > 5) { groups.push({ x0: start, x1: x - gap }); start = -1; }
      }
    }
    if (start >= 0) groups.push({ x0: start, x1: region.x1 });
    // 补上每个分组的 y 范围
    return groups.map((g) => {
      let y0 = region.y1;
      let y1 = region.y0;
      for (let y = region.y0; y <= region.y1; y++) {
        for (let x = g.x0; x <= g.x1; x++) {
          if (isFg(x, y)) { if (y < y0) y0 = y; if (y > y1) y1 = y; break; }
        }
      }
      return { ...g, y0, y1, w: g.x1 - g.x0 + 1, h: y1 - y0 + 1 };
    });
  };

  /** 按行聚类（找出内容带） */
  const clusterRows = () => {
    const groups = [];
    let start = -1;
    let gap = 0;
    for (let y = 0; y < height; y++) {
      let has = false;
      for (let x = 0; x < width; x++) if (isFg(x, y)) { has = true; break; }
      if (has) {
        if (start < 0) start = y;
        gap = 0;
      } else if (start >= 0) {
        gap++;
        if (gap > 4) { groups.push({ y0: start, y1: y - gap }); start = -1; }
      }
    }
    if (start >= 0) groups.push({ y0: start, y1: height - 1 });
    return groups.map((g) => ({ ...g, h: g.y1 - g.y0 + 1 }));
  };

  const report = (label, boxes) => {
    console.log(`\n${label}：${boxes.length} 个组`);
    boxes.forEach((b, i) =>
      console.log(`  组${i + 1}  x=${String(b.x0).padStart(4)}..${String(b.x1).padEnd(4)} y=${String(b.y0).padStart(4)}..${String(b.y1).padEnd(4)}  宽 ${String(b.w).padStart(4)} 高 ${String(b.h).padStart(4)}`)
    );
    if (boxes.length > 1) {
      console.log('  相邻水平间距:');
      for (let i = 1; i < boxes.length; i++) {
        console.log(`    组${i}→组${i + 1}: ${boxes[i].x0 - boxes[i - 1].x1 - 1}px`);
      }
      const centers = boxes.map((b) => ((b.y0 + b.y1) / 2).toFixed(1));
      console.log(`  垂直中心: ${centers.join(', ')}`);
    }
  };

  if (wantRows) {
    report('按行聚类（内容带）', clusterRows());
  }

  if (wantCrop) {
    // 逐行聚类后，逐带细分量控件；--max-h=N 可限制只量较矮的带（默认全部）
    const maxH = Number((args.find((a) => a.startsWith('--max-h=')) || '').split('=')[1] || 999);
    const rows = clusterRows().filter((r) => r.h <= maxH);
    console.log(`\n===== 控件级细分（内容带，共 ${rows.length} 个，h<=${maxH}）=====`);
    for (const r of rows) {
      const boxes = clusterCols({ x0: 0, x1: width - 1, y0: r.y0, y1: r.y1 });
      report(`带 y=${r.y0}..${r.y1} (高 ${r.h})`, boxes);
      // 每个控件的配色（判断实心/描边）
      boxes.forEach((b, i) => {
        const counts = {};
        for (let y = b.y0; y <= b.y1; y++) {
          for (let x = b.x0; x <= b.x1; x++) {
            if (!isFg(x, y)) continue;
            const [rr, gg, bb] = at(x, y);
            const key = `${rr},${gg},${bb}`;
            counts[key] = (counts[key] || 0) + 1;
          }
        }
        const top = Object.entries(counts).sort((a, c) => c[1] - a[1]).slice(0, 3);
        console.log(`    组${i + 1} 主色: ${top.map(([c, n]) => `rgb(${c})×${n}`).join('  ')}`);
      });
    }
    return;
  }

  report('按列聚类', clusterCols({ x0: 0, x1: width - 1, y0: 0, y1: height - 1 }));
}

main();
