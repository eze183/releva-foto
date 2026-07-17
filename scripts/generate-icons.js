// Genera icon-192.png e icon-512.png (+ variante maskable) sin dependencias npm.
// Dibuja un fondo con el acento del design system "Modernist" y un glifo tipo
// cámara, según la paleta de styles.css (--accent:#ec3013, --bg:#f3f2f2). Correr con:
//   node scripts/generate-icons.js
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const GREEN = [0xec, 0x30, 0x13];
const LIME = [0xf3, 0xf2, 0xf2];

function makeIcon(size, { maskable = false } = {}) {
  const pixels = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  // En modo maskable dejamos más margen (zona segura ~40% del radio) para que
  // los launchers que recortan a círculo no corten el glifo.
  const bgRadius = maskable ? size * 0.5 : size * 0.46;
  const cornerRadius = 0; // Modernist usa esquinas rectas (--radius: 0) en todo el sistema.

  const camW = size * (maskable ? 0.34 : 0.44);
  const camH = camW * 0.68;
  const camX = cx - camW / 2;
  const camY = cy - camH / 2 + camH * 0.06;
  const lensR = camW * 0.26;
  const bumpW = camW * 0.28;
  const bumpH = camH * 0.22;

  function setPx(x, y, [r, g, b], a = 255) {
    const i = (y * size + x) * 4;
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
    pixels[i + 3] = a;
  }

  function insideRoundedSquare(x, y) {
    const half = size / 2;
    const dx = Math.abs(x - cx) - (half - cornerRadius);
    const dy = Math.abs(y - cy) - (half - cornerRadius);
    if (dx <= 0 || dy <= 0) return true;
    return dx * dx + dy * dy <= cornerRadius * cornerRadius;
  }

  function insideCircle(x, y, ox, oy, r) {
    const dx = x - ox;
    const dy = y - oy;
    return dx * dx + dy * dy <= r * r;
  }

  function insideRoundedRect(x, y, rx, ry, rw, rh, r) {
    if (x < rx - r || x > rx + rw + r || y < ry - r || y > ry + rh + r) return false;
    const cxr = Math.min(Math.max(x, rx + r), rx + rw - r);
    const cyr = Math.min(Math.max(y, ry + r), ry + rh - r);
    const dx = x - cxr;
    const dy = y - cyr;
    return dx * dx + dy * dy <= r * r;
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inBg = maskable
        ? insideCircle(x, y, cx, cy, bgRadius)
        : insideRoundedSquare(x, y);
      if (!inBg) {
        setPx(x, y, GREEN, 0);
        continue;
      }
      setPx(x, y, GREEN);

      const inBody = insideRoundedRect(x, y, camX, camY, camW, camH, camW * 0.14);
      const inBump = insideRoundedRect(
        x,
        y,
        cx - bumpW / 2,
        camY - bumpH * 0.6,
        bumpW,
        bumpH,
        bumpH * 0.3
      );
      const inLensOuter = insideCircle(x, y, cx, camY + camH / 2, lensR);
      const inLensInner = insideCircle(x, y, cx, camY + camH / 2, lensR * 0.55);

      if (inBump || (inBody && !inLensOuter) || inLensInner) {
        setPx(x, y, LIME);
      }
    }
  }

  return encodePNG(size, size, pixels);
}

function encodePNG(width, height, rgbaBuffer) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filtro "none"
    rgbaBuffer.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw);

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const crcInput = Buffer.concat([typeBuf, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(crcInput), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let crcTable;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const outDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "icon-192.png"), makeIcon(192));
fs.writeFileSync(path.join(outDir, "icon-512.png"), makeIcon(512));
fs.writeFileSync(path.join(outDir, "icon-512-maskable.png"), makeIcon(512, { maskable: true }));
console.log("Íconos generados en", outDir);
