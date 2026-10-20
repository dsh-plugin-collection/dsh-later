/**
 * 极简 PNG 解码：只支持 **8-bit、非隔行、RGB/RGBA/灰度/调色板** 这几类
 * （仓库里 `docs/media/*seam*.png` 全是 colortype=2 / bitdepth=8 / interlace=0）。
 *
 * 为什么手写而不引依赖：CI 是 `node:22` 容器（见 `.gitea/workflows/ci.yml`），
 * 既没有 PIL 也没有浏览器，而 `package.json` 的运行时依赖是**零**（issue #19 特意
 * 维持这一点）。为一个接缝回归测试引入 sharp/pngjs 不划算，且会把 devDependency
 * 拖进插件包。zlib 是 Node 内置，解码本体只有 unfilter 这 40 行。
 *
 * 只读像素、不写像素；不支持的特性一律抛错，绝不静默给错数据 —— 判据建立在错误
 * 像素上比没有判据更糟。
 * @module dsh-later/scripts/seam-check/png
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 调色板图像需要 PLTE；其余为 null。 */
function parseChunks(buf) {
  const out = { ihdr: null, idat: [], plte: null };
  let i = 8;
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    const data = buf.subarray(i + 8, i + 8 + len);
    if (type === 'IHDR') {
      out.ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === 'IDAT') out.idat.push(Buffer.from(data));
    else if (type === 'PLTE') out.plte = Buffer.from(data);
    else if (type === 'IEND') break;
    i += 12 + len;
  }
  return out;
}

/** PNG 规范里的 5 种行过滤器，逐字节还原。 */
function unfilter(raw, width, height, channels) {
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y += 1) {
    const filterType = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const dst = y * stride;
    const prev = dst - stride;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? out[dst + x - channels] : 0;
      const b = y > 0 ? out[prev + x] : 0;
      const c = x >= channels && y > 0 ? out[prev + x - channels] : 0;
      const v = src[x];
      let value;
      switch (filterType) {
        case 0: value = v; break;
        case 1: value = v + a; break;
        case 2: value = v + b; break;
        case 3: value = v + ((a + b) >> 1); break;
        case 4: value = v + paeth(a, b, c); break;
        default: throw new Error(`未知 PNG 行过滤器: ${filterType}`);
      }
      out[dst + x] = value & 0xff;
    }
  }
  return out;
}

/**
 * 解码为"每像素 3 通道"的紧凑缓冲（RGBA 丢弃 alpha，调色板展开为 RGB）。
 * @returns {{ width:number, height:number, channels:number, data:Buffer }}
 */
export function decodePngRgb(path) {
  const buf = readFileSync(path);
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error(`${path}: 不是 PNG`);
  const { ihdr, idat, plte } = parseChunks(buf);
  if (ihdr === null) throw new Error(`${path}: 缺 IHDR`);
  if (ihdr.bitDepth !== 8) throw new Error(`${path}: 仅支持 8-bit，实际 ${ihdr.bitDepth}`);
  if (ihdr.interlace !== 0) throw new Error(`${path}: 不支持隔行 PNG`);
  if (ihdr.compression !== 0 || ihdr.filter !== 0) throw new Error(`${path}: 不支持的压缩/滤波方法`);

  const channels = ihdr.colorType === 2 ? 3 : ihdr.colorType === 6 ? 4 : ihdr.colorType === 0 ? 1 : ihdr.colorType === 3 ? 1 : null;
  if (channels === null) throw new Error(`${path}: 不支持的 colorType ${ihdr.colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const { width, height } = ihdr;
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) throw new Error(`${path}: IDAT 长度不足`);
  const plane = unfilter(raw, width, height, channels);

  // 统一成 RGB 三通道，方便判据不必再分支
  const rgb = Buffer.alloc(width * height * 3);
  for (let p = 0; p < width * height; p += 1) {
    if (ihdr.colorType === 2) {
      rgb[p * 3] = plane[p * 3];
      rgb[p * 3 + 1] = plane[p * 3 + 1];
      rgb[p * 3 + 2] = plane[p * 3 + 2];
    } else if (ihdr.colorType === 6) {
      rgb[p * 3] = plane[p * 4];
      rgb[p * 3 + 1] = plane[p * 4 + 1];
      rgb[p * 3 + 2] = plane[p * 4 + 2];
    } else if (ihdr.colorType === 0) {
      const g = plane[p];
      rgb[p * 3] = g; rgb[p * 3 + 1] = g; rgb[p * 3 + 2] = g;
    } else {
      const idx = plane[p] * 3;
      if (plte === null || idx + 2 >= plte.length) throw new Error(`${path}: 调色板缺失/越界`);
      rgb[p * 3] = plte[idx]; rgb[p * 3 + 1] = plte[idx + 1]; rgb[p * 3 + 2] = plte[idx + 2];
    }
  }
  return { width, height, channels: 3, data: rgb };
}

/** 取某行的 RGB 视图（零拷贝；判据只读不改，故不复制）。 */
export function rowOf(img, y) {
  const start = y * img.width * img.channels;
  return img.data.subarray(start, start + img.width * img.channels);
}
