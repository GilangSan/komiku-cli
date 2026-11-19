// Single-file builders for a chapter: PDF (JPEG pages) and CBZ (zip store).
// Pure Node; the only external need is an image decoder for PDF, since the site
// serves WebP and PDF cannot embed WebP. CBZ keeps WebP as-is.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Read width/height from a JPEG (first SOF marker). */
export function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error("not a JPEG");
  let i = 2;
  while (i < buf.length - 1) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    i += 2;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const len = buf.readUInt16BE(i);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
      return { width: buf.readUInt16BE(i + 5), height: buf.readUInt16BE(i + 3) };
    i += len;
  }
  throw new Error("no SOF marker");
}

/** One JPEG per page, page sized to the image (1px = 1pt). */
export function pdfFromJpegs(images) {
  const chunks = [];
  const offsets = [];
  let size = 0;
  const put = (data) => {
    const b = Buffer.isBuffer(data) ? data : Buffer.from(data, "latin1");
    chunks.push(b);
    size += b.length;
  };
  const obj = (id, body) => {
    offsets[id] = size;
    put(`${id} 0 obj\n${body}\nendobj\n`);
  };

  const n = images.length;
  put("%PDF-1.4\n%\xff\xff\xff\xff\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  const kids = images.map((_, i) => `${3 + i * 3} 0 R`).join(" ");
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  images.forEach((jpg, i) => {
    const { width, height } = jpegSize(jpg);
    const page = 3 + i * 3;
    const content = page + 1;
    const image = page + 2;
    obj(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
      `/Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R >>`);
    const stream = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;
    obj(content, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    offsets[image] = size;
    put(`${image} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);
    put(jpg);
    put("\nendstream\nendobj\n");
  });

  const xref = size;
  const count = 1 + n * 3 + 1;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id++) table += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  put(table);
  put(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(chunks);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Minimal store-only (no compression) zip — valid CBZ. */
export function zipStore(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, e.data);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(e.data.length, 20);
    dir.writeUInt32LE(e.data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([dir, name]));
    offset += local.length + name.length + e.data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, eocd]);
}

const IMAGE_DECODERS = [
  { cmd: "magick", args: (i, o) => [i, o] },
  { cmd: "convert", args: (i, o) => [i, o] },
  { cmd: "ffmpeg", args: (i, o) => ["-y", "-loglevel", "error", "-i", i, "-f", "image2", "-c:v", "mjpeg", o] },
];

/** First decoder available on PATH — name of `KOMIKU_IMAGE_DECODER` wins. */
export function pickDecoder() {
  const forced = process.env.KOMIKU_IMAGE_DECODER;
  if (forced) return IMAGE_DECODERS.find((d) => d.cmd === forced) || null;
  return IMAGE_DECODERS.find((d) => spawnSync("which", [d.cmd], { stdio: "ignore" }).status === 0) || null;
}

/** Convert any image buffer to JPEG (passes JPEG through untouched). */
export function decodeToJpeg(buf, decoder = pickDecoder()) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return buf;
  if (!decoder) throw new Error("PDF butuh dekoder gambar (ImageMagick/ffmpeg); pakai format cbz atau set KOMIKU_IMAGE_DECODER");
  const dir = mkdtempSync(join(tmpdir(), "komiku-"));
  try {
    const input = join(dir, "in.img");
    const output = join(dir, "out.jpg");
    writeFileSync(input, buf);
    const r = spawnSync(decoder.cmd, decoder.args(input, output), { stdio: "ignore" });
    if (r.status !== 0 || !existsSync(output)) throw new Error(`${decoder.cmd} gagal mengubah gambar`);
    return readFileSync(output);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
