// The World in One Day — Monday, 23 November 2026.
//
// A program that draws the day's front page as a 1024x1024 PNG, using
// only the Node standard library. The page is painted onto an RGB
// framebuffer: a masthead, a lead story, six stories in a two-column
// grid, and a footer strip. Text is set in a 5x7 bitmap font defined
// below, and the PNG is encoded by hand (zlib for the deflate stream,
// a small CRC32 for the chunks). No network, no clock, no randomness:
// every run writes the same bytes.
//
// Run it:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Output:  $MAKEFUN_OUTPUT_DIR/entry.png (1024x1024, about 25 KB)

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------------------
// Framebuffer and drawing primitives
// ---------------------------------------------------------------------------

const INK: [number, number, number] = [17, 17, 17];
const PAPER: [number, number, number] = [255, 255, 255];
const RED: [number, number, number] = [178, 28, 28];
const GREY: [number, number, number] = [110, 110, 110];
const LIGHT: [number, number, number] = [226, 226, 226];
const BLUE: [number, number, number] = [29, 78, 176];
const GOLD: [number, number, number] = [176, 124, 20];

type RGB = [number, number, number];

const fb = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) {
  fb[i * 3] = PAPER[0];
  fb[i * 3 + 1] = PAPER[1];
  fb[i * 3 + 2] = PAPER[2];
}

function px(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = (y * W + x) * 3;
  fb[o] = c[0];
  fb[o + 1] = c[1];
  fb[o + 2] = c[2];
}

function fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(W, x + w);
  const y1 = Math.min(H, y + h);
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const o = (yy * W + xx) * 3;
      fb[o] = c[0];
      fb[o + 1] = c[1];
      fb[o + 2] = c[2];
    }
  }
}

function hline(x: number, y: number, w: number, t: number, c: RGB): void {
  fillRect(x, y, w, t, c);
}

function vline(x: number, y: number, h: number, t: number, c: RGB): void {
  fillRect(x, y, t, h, c);
}

function outline(x: number, y: number, w: number, h: number, t: number, c: RGB): void {
  hline(x, y, w, t, c);
  hline(x, y + h - t, w, t, c);
  vline(x, y, h, t, c);
  vline(x + w - t, y, h, t, c);
}

// Bresenham line, t pixels thick (square brush).
function line(x0: number, y0: number, x1: number, y1: number, t: number, c: RGB): void {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    fillRect(x - Math.floor(t / 2), y - Math.floor(t / 2), t, t, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

function disc(cx: number, cy: number, r: number, c: RGB): void {
  for (let y = -r; y <= r; y++) {
    const half = Math.floor(Math.sqrt(r * r - y * y));
    for (let x = -half; x <= half; x++) px(cx + x, cy + y, c);
  }
}

function ring(cx: number, cy: number, r: number, t: number, c: RGB): void {
  for (let a = 0; a < 360; a += 1) {
    const rad = (a * Math.PI) / 180;
    for (let k = 0; k < t; k++) {
      px(Math.round(cx + (r + k - t / 2) * Math.cos(rad)), Math.round(cy + (r + k - t / 2) * Math.sin(rad)), c);
    }
  }
}

// Filled triangle.
function triangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: RGB): void {
  const minX = Math.min(x0, x1, x2);
  const maxX = Math.max(x0, x1, x2);
  const minY = Math.min(y0, y1, y2);
  const maxY = Math.max(y0, y1, y2);
  const d = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
  if (d === 0) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const a = ((x1 - x) * (y2 - y) - (y1 - y) * (x2 - x)) / d;
      const b = ((x2 - x) * (y0 - y) - (y2 - y) * (x0 - x)) / d;
      const g = 1 - a - b;
      if (a >= 0 && b >= 0 && g >= 0) px(x, y, c);
    }
  }
}

// ---------------------------------------------------------------------------
// PNG encoder (hand-written: signature, IHDR, IDAT, IEND)
// ---------------------------------------------------------------------------

const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, "ascii");
  data.copy(out, 8);
  const crcBuf = Buffer.concat([Buffer.from(type, "ascii"), data]);
  out.writeUInt32BE(crc32(crcBuf), 8 + data.length);
  return out;
}

function encodePNG(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // One filter byte (0 = none) per scanline, then the raw RGB row.
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    fb.copy(raw, y * (1 + W * 3) + 1, y * W * 3, (y + 1) * W * 3);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// 5x7 bitmap font. Each glyph is seven rows of five bits, "1" = ink.
// Letters are capitals; lowercase input is folded to upper case.
// ---------------------------------------------------------------------------

const GLYPHS: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "01100", "00100", "01000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  ";": ["00000", "01100", "01100", "00000", "01100", "00100", "01000"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "?": ["01110", "10001", "00001", "00110", "00100", "00000", "00100"],
  "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  '"': ["01010", "01010", "01010", "00000", "00000", "00000", "00000"],
  "-": ["00000", "00000", "00000", "01110", "00000", "00000", "00000"],
  "—": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
  "%": ["11001", "11010", "00010", "00100", "01000", "01011", "10011"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  "=": ["00000", "00000", "11111", "00000", "11111", "00000", "00000"],
  $: ["00100", "01111", "10100", "01110", "00101", "11110", "00100"],
  "#": ["01010", "01010", "11111", "01010", "11111", "01010", "01010"],
  "@": ["01110", "10001", "10111", "10101", "10110", "10000", "01110"],
  _: ["00000", "00000", "00000", "00000", "00000", "00000", "11111"],
  "*": ["00000", "00100", "10101", "01110", "10101", "00100", "00000"],
  "•": ["00000", "00100", "01110", "01110", "01110", "00100", "00000"],
};

function glyphOf(ch: string): string[] {
  const up = ch.toUpperCase();
  if (up === "’" || up === "‘") return GLYPHS["'"];
  if (up === "–") return GLYPHS["-"];
  return GLYPHS[up] ?? GLYPHS[" "];
}

// Draw one glyph at scale s (each font pixel becomes an s x s block).
function drawChar(ch: string, x: number, y: number, s: number, c: RGB): void {
  const g = glyphOf(ch);
  for (let r = 0; r < 7; r++) {
    for (let col = 0; col < 5; col++) {
      if (g[r][col] === "1") fillRect(x + col * s, y + r * s, s, s, c);
    }
  }
}

// Width in pixels of a string at scale s (5 px + 1 px tracking per char).
function textWidth(str: string, s: number): number {
  if (str.length === 0) return 0;
  return str.length * 6 * s - s;
}

function drawText(str: string, x: number, y: number, s: number, c: RGB): void {
  let cx = x;
  for (const ch of str) {
    drawChar(ch, cx, y, s, c);
    cx += 6 * s;
  }
}

function drawTextCentered(str: string, cx: number, y: number, s: number, c: RGB): void {
  drawText(str, cx - Math.floor(textWidth(str, s) / 2), y, s, c);
}

// Greedy word wrap: returns lines that each fit maxWidth pixels at scale s.
function wrapText(str: string, maxWidth: number, s: number): string[] {
  const words = str.split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur === "" ? w : cur + " " + w;
    if (textWidth(trial, s) <= maxWidth || cur === "") {
      cur = trial;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}

// Draw wrapped text; returns the y just below the last line.
function drawPara(str: string, x: number, y: number, maxWidth: number, s: number, c: RGB, maxLines: number): number {
  const lines = wrapText(str, maxWidth, s).slice(0, maxLines);
  const lh = 8 * s + 2;
  for (let i = 0; i < lines.length; i++) drawText(lines[i], x, y + i * lh, s, c);
  return y + lines.length * lh;
}

// ---------------------------------------------------------------------------
// Pictograms. Each draws inside a small box centred on (cx, cy).
// ---------------------------------------------------------------------------

// A globe with a crack through it.
function picGlobe(cx: number, cy: number, r: number): void {
  ring(cx, cy, r, 5, INK);
  // Latitude chords.
  for (const dy of [-Math.floor(r / 2), 0, Math.floor(r / 2)]) {
    const half = Math.floor(Math.sqrt(r * r - dy * dy));
    hline(cx - half, cy + dy, half * 2, 3, INK);
  }
  // Longitude chords.
  for (const dx of [-Math.floor(r / 2), Math.floor(r / 2)]) {
    const half = Math.floor(Math.sqrt(r * r - dx * dx));
    vline(cx + dx, cy - half, half * 2, 3, INK);
  }
  // The crack: a red zig-zag across the globe.
  line(cx - r + 8, cy - r + 26, cx - 12, cy - 8, 4, RED);
  line(cx - 12, cy - 8, cx + 6, cy + 12, 4, RED);
  line(cx + 6, cy + 12, cx + r - 10, cy + r - 22, 4, RED);
}

// A flame over a refinery tower.
function picFlame(cx: number, cy: number, s: number): void {
  // Tower.
  fillRect(cx - s, cy - 6, 14, s + 6, INK);
  triangle(cx - s - 2, cy - 6, cx - s + 16, cy - 6, cx - s + 7, cy - 20, INK);
  fillRect(cx + 4, cy + 2, 22, s - 2, INK);
  // Flame: three tongues.
  triangle(cx - 26, cy - 2, cx - 12, cy - 2, cx - 19, cy - s - 6, RED);
  triangle(cx - 14, cy - 2, cx + 2, cy - 2, cx - 6, cy - s - 16, GOLD);
  triangle(cx + 0, cy - 2, cx + 16, cy - 2, cx + 8, cy - s - 4, RED);
}

// Two flags on poles: Nepal's double pennant and India's tricolour.
function picFlags(cx: number, cy: number, s: number): void {
  // Nepal (left): crimson double pennant.
  vline(cx - 22, cy - s, s * 2, 3, INK);
  triangle(cx - 19, cy - s, cx + 4, cy - s + 10, cx - 19, cy - s + 20, RED);
  triangle(cx - 19, cy - s + 20, cx + 4, cy - s + 30, cx - 19, cy - s + 40, RED);
  // India (right): saffron, white, green with a navy wheel.
  vline(cx + 8, cy - s, s * 2, 3, INK);
  fillRect(cx + 11, cy - s, 30, 12, [255, 153, 51]);
  fillRect(cx + 11, cy - s + 12, 30, 12, PAPER);
  outline(cx + 11, cy - s + 12, 30, 12, 1, LIGHT);
  fillRect(cx + 11, cy - s + 24, 30, 12, [19, 136, 8]);
  disc(cx + 26, cy - s + 18, 5, [0, 0, 128]);
}

// A graduation cap over an exam paper.
function picCap(cx: number, cy: number, s: number): void {
  // Paper.
  fillRect(cx - 6, cy - 2, 34, s, PAPER);
  outline(cx - 6, cy - 2, 34, s, 2, INK);
  hline(cx - 1, cy + 8, 24, 2, INK);
  hline(cx - 1, cy + 16, 24, 2, INK);
  hline(cx - 1, cy + 24, 16, 2, INK);
  // Cap board (a flat diamond) and skull.
  triangle(cx - s, cy - 14, cx - 4, cy - 26, cx - 4, cy - 2, INK);
  triangle(cx - 4, cy - 26, cx + 30, cy - 14, cx - 4, cy - 2, INK);
  fillRect(cx - 12, cy - 14, 20, 14, INK);
  line(cx + 30, cy - 14, cx + 30, cy + 4, 2, GOLD);
  disc(cx + 30, cy + 8, 4, GOLD);
}

// A robot head: the UN's killer-robot talks.
function picRobot(cx: number, cy: number, s: number): void {
  vline(cx, cy - s - 6, 12, 3, INK);
  disc(cx, cy - s - 8, 4, RED);
  outline(cx - 26, cy - s + 4, 52, 40, 3, INK);
  fillRect(cx - 32, cy - s + 14, 6, 16, INK);
  fillRect(cx + 26, cy - s + 14, 6, 16, INK);
  disc(cx - 12, cy - s + 16, 5, BLUE);
  disc(cx + 12, cy - s + 16, 5, BLUE);
  hline(cx - 14, cy - s + 30, 28, 3, INK);
  hline(cx - 14, cy - s + 36, 28, 3, INK);
}

// A quad-rotor drone over a cracked apartment block.
function picDrone(cx: number, cy: number, s: number): void {
  // Block.
  fillRect(cx - 30, cy - 2, 60, s + 2, PAPER);
  outline(cx - 30, cy - 2, 60, s + 2, 3, INK);
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 4; c++) {
      fillRect(cx - 24 + c * 14, cy + 6 + r * 14, 8, 8, INK);
    }
  }
  // Crack down the block.
  line(cx + 8, cy - 2, cx - 2, cy + 12, 3, RED);
  line(cx - 2, cy + 12, cx + 10, cy + s - 4, 3, RED);
  // Drone above it.
  const dy = cy - s + 6;
  line(cx - 22, dy - 10, cx + 22, dy + 10, 3, INK);
  line(cx - 22, dy + 10, cx + 22, dy - 10, 3, INK);
  disc(cx, dy, 7, INK);
  for (const [rx, ry] of [[-22, -10], [22, 10], [-22, 10], [22, -10]] as const) {
    ring(cx + rx, dy + ry, 8, 2, INK);
  }
}

// A factory with a sawtooth roof and smoking chimney.
function picFactory(cx: number, cy: number, s: number): void {
  // Chimney with smoke.
  fillRect(cx + 22, cy - s - 2, 12, s + 2, INK);
  disc(cx + 28, cy - s - 10, 6, GREY);
  disc(cx + 34, cy - s - 20, 8, GREY);
  disc(cx + 26, cy - s - 30, 6, GREY);
  // Sawtooth roof.
  triangle(cx - 34, cy, cx - 12, cy, cx - 12, cy - 18, INK);
  triangle(cx - 12, cy, cx + 10, cy, cx + 10, cy - 18, INK);
  fillRect(cx - 34, cy, 48, s, INK);
  fillRect(cx - 26, cy + 10, 12, 12, PAPER);
  fillRect(cx - 6, cy + 10, 12, 12, PAPER);
}

// ---------------------------------------------------------------------------
// The front page
// ---------------------------------------------------------------------------

const M = 36; // margin
const CW = W - 2 * M; // content width, 952

function storyCell(x: number, y: number, w: number, kicker: string, headline: string, body: string, pic: (cx: number, cy: number) => void): void {
  const px0 = x;
  const py0 = y + 30;
  pic(px0 + 40, py0 + 40);
  const tx = x + 96;
  const tw = w - 96;
  drawText(kicker, tx, y, 2, RED);
  const hy = drawPara(headline, tx, y + 20, tw, 2, INK, 2);
  drawPara(body, tx, hy + 6, tw, 2, INK, 4);
}

function main(): void {
  // Top rule and masthead.
  hline(M, 20, CW, 3, INK);
  drawTextCentered("THE WORLD IN ONE DAY", W / 2, 32, 6, INK);
  hline(M, 82, CW, 1, INK);
  drawTextCentered("MONDAY, 23 NOVEMBER 2026", W / 2, 90, 3, RED);
  hline(M, 118, CW, 3, INK);
  hline(M, 123, CW, 1, INK);

  // Lead story: COP31 collapses.
  drawText("CLIMATE — ANTALYA, TURKEY", M, 136, 2, RED);
  drawText("CLIMATE TALKS", M, 160, 5, INK);
  drawText("COLLAPSE", M, 202, 5, INK);
  drawPara(
    "No deal as the EU and others reject a pact that never names fossil fuels. The longest climate summit in history ends in failure, the first major breakdown since 2009.",
    M, 250, 600, 2, INK, 4,
  );
  picGlobe(824, 232, 78);

  // Rule above the grid.
  hline(M, 340, CW, 3, INK);

  // Six stories, two columns by three rows.
  const rows = [356, 536, 716];
  const cols = [M, M + 488];
  const cellW = 464;
  storyCell(cols[0], rows[0], cellW, "THE GULF WAR", "HOUTHIS CLAIM SAUDI REFINERY HIT",
    "Yemen's Houthis claim a direct hit on the Rabigh refinery and a radar site. Six were hurt in a strike on Sanaa.",
    (cx, cy) => picFlame(cx, cy, 30));
  storyCell(cols[1], rows[0], cellW, "SOUTH ASIA", "NEPAL PM MEETS MODI IN DELHI",
    "Nepal's Balendra Shah holds bilateral talks with Narendra Modi on his two-day state visit to India.",
    (cx, cy) => picFlags(cx, cy, 30));
  storyCell(cols[0], rows[1], cellW, "EDUCATION", "MINISTER QUITS OVER AI CHEATING",
    "South Korea's Choi Kyo-jin quits after rule changes to stop AI cheating sowed chaos at the college entrance exam.",
    (cx, cy) => picCap(cx, cy, 30));
  storyCell(cols[1], rows[1], cellW, "UNITED NATIONS", "LETHAL-AI TALKS TO GO ON",
    "Nations agree to keep negotiating curbs on lethal autonomous weapons at the UN conference.",
    (cx, cy) => picRobot(cx, cy, 30));
  storyCell(cols[0], rows[2], cellW, "UKRAINE", "DRONE HITS FLAT, 14 MISSING",
    "A Russian drone tears through a five-storey block in Dymer, near Kyiv. One dead, 14 missing.",
    (cx, cy) => picDrone(cx, cy, 30));
  storyCell(cols[1], rows[2], cellW, "INDONESIA", "50 STILL MISSING AFTER FACTORY FIRE",
    "Seven body bags are recovered from a candy factory in Serang, Banten, as rescuers search for about 50 workers.",
    (cx, cy) => picFactory(cx, cy, 30));

  // Dividers between the grid rows and columns.
  vline(M + 476, 356, 528, 1, LIGHT);
  hline(M, 530, CW, 1, LIGHT);
  hline(M, 710, CW, 1, LIGHT);

  // Footer strip.
  hline(M, 896, CW, 3, INK);
  drawText("ALSO TODAY", M, 908, 2, RED);
  drawText("• INDIA PILES UP A RECORD 720 FOR 9 IN THE WELLINGTON TEST", M, 930, 2, INK);
  drawText("• FIDE WORLD CHAMPIONSHIP: SINDAROV TAKES WHITE IN GAME 1", M, 952, 2, INK);
  drawText("• AUSTRALIA'S PM: COP31 FAILURE A SIGN OF DIFFICULT TIMES", M, 974, 2, INK);
  hline(M, 998, CW, 3, INK);

  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "out";
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "entry.png");
  const png = encodePNG();
  fs.writeFileSync(outFile, png);
  console.log(`wrote ${outFile}: ${png.length} bytes, ${W}x${H}`);
}

main();
