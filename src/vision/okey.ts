// Reader tuned to the real Metin 2 Okey window ("Jogo de Cartas Okey" / "Okey Card Game"):
// five hand cards in a row, each a solid red, blue or yellow card face with a large black
// number in the middle. No calibration: it works on a snip of the whole window, a snip of the
// hand, or a live capture.
//
//   1. Card faces are big, solid blobs of red/blue/yellow (fill > 60%, portrait shape), of the
//      same size, lined up in a row. The blob's colour is the card's colour.
//   2. The number is the largest dark shape near the middle of the card face (the corner
//      ornaments and the frame are ignored), compared with the digit shapes of the game font.

import { findBlobs, crop } from './detect.ts';
import type { Box, Blob } from './detect.ts';
import { glyphOf, similarity, GLYPH_W } from './recognize.ts';
import type { Pixels, SlotReading } from './recognize.ts';
import { cardOf, COLORS } from '../engine/cards.ts';
import DIGITS from './okeyDigits.json' with { type: 'json' };

export interface OkeyCard {
  box: Box;
  reading: SlotReading;
  row: number;
}

/** Digit glyphs: number -> samples. 1, 2, 5, 6, 7 come from the real screenshot in tests/fixtures; all 8 also from serif fonts that match the game font. */
export type DigitBook = Record<string, number[][]>;
export const GAME_DIGITS: DigitBook = DIGITS as DigitBook;

const isFace = (b: Blob) => {
  const fill = b.pixels / (b.w * b.h);
  const aspect = b.h / b.w;
  return fill >= 0.6 && aspect >= 1.1 && aspect <= 1.9 && b.w >= 12 && b.h >= 16;
};

/** Card faces grouped in rows (most cards first). */
export const findCardFaces = (px: Pixels): Blob[][] => {
  const all = findBlobs(px).filter(isFace);
  // A bit of card colour inside a digit loop (the middle of a 6) is not a card of its own.
  const inside = (a: Blob, b: Blob) => a !== b && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
  const faces = all.filter(f => !all.some(g => inside(f, g)));
  const rows: Blob[][] = [];
  for (const f of faces.sort((a, b) => a.x - b.x)) {
    const row = rows.find(r => {
      const ref = r[0];
      const sameSize = Math.abs(f.w - ref.w) <= ref.w * 0.2 && Math.abs(f.h - ref.h) <= ref.h * 0.2;
      const sameLine = Math.abs(f.y + f.h / 2 - (ref.y + ref.h / 2)) < ref.h * 0.3;
      return sameSize && sameLine;
    });
    if (row) row.push(f);
    else rows.push([f]);
  }
  return rows.filter(r => r.length <= 5).sort((a, b) => b.length - a.length || b[0].w * b[0].h - a[0].w * a[0].h);
};

const lum = (d: Uint8ClampedArray, i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

/** Glyph of the number printed on a card face, or null if there is no clear dark shape. */
export const digitGlyph = (face: Pixels): number[] | null => digitShape(face)?.glyph ?? null;

/** Closed loops in each digit of the game font (4 may render open or closed). */
const HOLES: Record<number, number[]> = { 1: [0], 2: [0], 3: [0], 4: [0, 1], 5: [0], 6: [1], 7: [0], 8: [2] };

/** Count enclosed background regions (loops) in a mask: 8 has two, 6 one, 3 none. */
const countHoles = (mask: Uint8Array, W: number, H: number, minSize: number): number => {
  const seen = new Uint8Array(W * H);
  let holes = 0;
  for (let s = 0; s < W * H; s++) {
    if (mask[s] || seen[s]) continue;
    let size = 0, border = false;
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % W, y = (i - x) / W;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, j = ny * W + nx;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[j] || mask[j]) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    if (!border && size >= minSize) holes++;
  }
  return holes;
};

export const digitShape = (face: Pixels): { glyph: number[]; holes: number } | null => {
  const { width: W, height: H, data } = face;
  // The card colour's brightness sets the "dark" threshold (blue cards are much darker than yellow).
  const lums: number[] = [];
  for (let i = 0; i < W * H; i++) lums.push(lum(data, i * 4));
  const sorted = [...lums].sort((a, b) => a - b);
  const body = sorted[Math.floor(lums.length * 0.7)];
  // Halfway between the darkest ink and the card colour, so a blurred or small capture (where
  // the black number turns grey) still separates; never above 60% of the card's brightness.
  const ink = sorted[Math.floor(lums.length * 0.03)];
  const threshold = Math.min(body * 0.6, Math.max(Math.min(70, body * 0.55), (ink + body) / 2));
  const x0 = Math.round(W * 0.14), x1 = Math.round(W * 0.86), y0 = Math.round(H * 0.12), y1 = Math.round(H * 0.88);
  const dark = new Uint8Array(W * H);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (lums[y * W + x] < threshold) dark[y * W + x] = 1;
  // Largest connected dark shape, weighted towards the centre.
  const seen = new Uint8Array(W * H);
  let best: number[] = [], bestScore = 0;
  for (let s = 0; s < W * H; s++) {
    if (!dark[s] || seen[s]) continue;
    const comp: number[] = [];
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      comp.push(i);
      const x = i % W, y = (i - x) / W;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, j = ny * W + nx;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[j] || !dark[j]) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    let cx = 0, cy = 0;
    for (const i of comp) { cx += i % W; cy += Math.floor(i / W); }
    cx /= comp.length; cy /= comp.length;
    const off = Math.hypot((cx - W / 2) / W, (cy - H / 2) / H);
    const score = comp.length * Math.max(0, 1 - off * 2.5);
    if (score > bestScore) { bestScore = score; best = comp; }
  }
  if (best.length < W * H * 0.03) return null;
  const mask = new Uint8Array(W * H);
  for (const i of best) mask[i] = 1;
  return { glyph: glyphOf(mask, W, H), holes: countHoles(mask, W, H, Math.max(3, Math.round(W * H * 0.004))) };
};

/**
 * 2 and 5 are the easiest pair to mix up (both open, similar size). The upper right tells them
 * apart: a 2's top curve comes down on the right side, a 5 is empty there (its upright stroke is
 * on the left). Ink share of rows 3-6, columns 8-11 of the glyph: 2 >= 0.38, 5 <= 0.19 on the
 * real game font, also on blurry low-resolution shares.
 */
export const upperRight = (glyph: number[]): number => {
  let sum = 0, n = 0;
  for (let r = 3; r <= 6; r++) for (let c = GLYPH_W - 4; c < GLYPH_W; c++) { sum += glyph[r * GLYPH_W + c]; n++; }
  return sum / n;
};
const looksLike2 = (glyph: number[]) => upperRight(glyph) >= 0.28;

/** Longest run of filled cells in the given glyph rows, as a fraction of the glyph width. */
const flatRun = (g: number[], rows: number[]) =>
  Math.max(...rows.map(r => {
    let best = 0, cur = 0;
    for (let x = 0; x < GLYPH_W; x++) {
      cur = g[r * GLYPH_W + x] > 0.5 ? cur + 1 : 0;
      best = Math.max(best, cur);
    }
    return best / GLYPH_W;
  }));

/** Mean fill of a block of glyph cells (rows r0..r1, columns c0..c1). */
const fill = (g: number[], r0: number, r1: number, c0: number, c1: number) => {
  let s = 0;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) s += g[r * GLYPH_W + c];
  return s / ((r1 - r0 + 1) * (c1 - c0 + 1));
};

/**
 * Strokes that tell look-alike digits apart in the game's serif font, robust to blur and scale:
 * a 2 has a flat base and its upper stroke on the right; a 5 has a flat top bar and its upper
 * stroke on the left; a 6 never has a flat top. True if `n` contradicts the shape.
 */
export const contradicts = (n: number, g: number[]): boolean => {
  const top = flatRun(g, [0, 1, 2]), bottom = flatRun(g, [13, 14, 15]);
  const left = fill(g, 3, 7, 0, 3), right = fill(g, 3, 7, 8, 11);
  if (n === 2) return !(bottom >= 0.66 && bottom > top + 0.15) || left > right + 0.15;
  if (n === 5) return !(top >= 0.6 && top > bottom + 0.1) || right > left + 0.15;
  if (n === 6) return top >= 0.66;
  return false;
};

export const matchDigit = (glyph: number[], books: DigitBook[], holes?: number): { number: number | null; score: number; margin: number } => {
  const best = new Map<number, number>();
  for (const book of books) for (const [n, samples] of Object.entries(book)) {
    // A digit with the wrong number of loops (e.g. an 8 read as a 6), or whose strokes don't fit
    // (a 2 read as a 5), is heavily penalised, whatever the samples say, even learned ones.
    const wrongLoops = holes !== undefined && !HOLES[Number(n)]?.includes(Math.min(holes, 2));
    const penalty = (wrongLoops ? 0.3 : 0) + (contradicts(Number(n), glyph) ? 0.35 : 0);
    for (const s of samples) best.set(Number(n), Math.max(best.get(Number(n)) ?? -1, similarity(glyph, s) - penalty));
  }
  const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return { number: null, score: 0, margin: 0 };
  return { number: ranked[0][0], score: ranked[0][1], margin: ranked[0][1] - (ranked[1]?.[1] ?? 0) };
};

/** Find and read every card in a picture of the Okey window. */
export const readOkey = (px: Pixels, learned: DigitBook = {}): OkeyCard[] => {
  const rows = findCardFaces(px);
  const out: OkeyCard[] = [];
  // Other rows must be card-sized too (the field slots are the same size as the hand).
  const main = rows[0]?.[0];
  rows.slice(0, 2).filter(row => main && row[0].w * row[0].h >= main.w * main.h * 0.5).forEach((row, r) => {
    for (const face of row) {
      const box = { x: face.x, y: face.y, w: face.w, h: face.h };
      const color = COLORS[face.color];
      const shape = digitShape(crop(px, box));
      const m = shape ? matchDigit(shape.glyph, [GAME_DIGITS, learned], shape.holes) : { number: null, score: 0, margin: 0 };
      const confidence = m.number === null ? 0 : Math.min(1, Math.max(0, m.score) * (0.6 + m.margin * 3));
      out.push({
        box,
        row: r,
        reading: {
          card: m.number === null ? null : cardOf(color, m.number),
          empty: false,
          color,
          number: m.number,
          confidence,
        },
      });
    }
  });
  return out;
};

// ---- Finding the Okey window inside a whole game screen ----
// The window has a fixed layout (325 x 306 at 100% UI scale): a long red-brown title bar
// across the top ("Jogo de Cartas Okey") and the green deck at the bottom left. Reading only
// inside it keeps skill-bar, potion and buff icons (which also show numbers) out.

const WIN_W = 325, WIN_H = 306, BAR_W = 318;
const isBar = (r: number, g: number, b: number) => r > 70 && r < 190 && g < r * 0.55 && b < r * 0.5 && g > 12;
const isDeckGreen = (r: number, g: number, b: number) => g > 90 && g > r * 1.3 && g > b * 1.15;

/** The Okey window in `px` (pixel box), or null. */
export const findOkeyWindow = (px: Pixels): Box | null => {
  const { width: W, height: H, data } = px;
  const seen = new Uint8Array(W * H);
  let best: { box: Box; score: number } | null = null;
  for (let s = 0; s < W * H; s++) {
    if (seen[s] || !isBar(data[s * 4], data[s * 4 + 1], data[s * 4 + 2])) continue;
    let x0 = s % W, x1 = x0, y0 = (s - x0) / W, y1 = y0, n = 0;
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      n++;
      const x = i % W, y = (i - x) / W;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const j of [i - 1, i + 1, i - W, i + W]) {
        if (j < 0 || j >= W * H || seen[j] || Math.abs((j % W) - x) > 1) continue;
        if (!isBar(data[j * 4], data[j * 4 + 1], data[j * 4 + 2])) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    // A long thin strip, mostly filled: the title bar.
    if (w < 60 || w / h < 12 || w / h > 40 || n < w * h * 0.6) continue;
    const k = w / BAR_W;
    const box = { x: Math.round(x0 - 2 * k), y: Math.round(y0 - 2 * k), w: Math.round(WIN_W * k), h: Math.round(WIN_H * k) };
    if (box.x + box.w > W + 4 * k || box.y + box.h > H + 4 * k) continue;
    // Confirm with the green deck (it may be gone at the very end, so it only adds to the score).
    let green = 0, total = 0;
    const dx0 = Math.round(box.x + 40 * k), dy0 = Math.round(box.y + 237 * k), dw = Math.round(31 * k), dh = Math.round(44 * k);
    for (let y = dy0; y < Math.min(H, dy0 + dh); y++) for (let x = dx0; x < Math.min(W, dx0 + dw); x++) {
      const i = (y * W + x) * 4;
      total++;
      if (isDeckGreen(data[i], data[i + 1], data[i + 2])) green++;
    }
    const score = w + (total && green / total > 0.25 ? 1000 : 0);
    if (!best || score > best.score) best = { box: { x: Math.max(0, box.x), y: Math.max(0, box.y), w: Math.min(box.w, W - Math.max(0, box.x)), h: Math.min(box.h, H - Math.max(0, box.y)) }, score };
  }
  return best?.box ?? null;
};

/**
 * Should a corrected sample be remembered as `n`? Only if it has the loops that digit has and
  * its upper right matches for 2/5, so a mislabeled sample can't teach a 2 as a 5.
 */
export const plausibleSample = (shape: { glyph: number[]; holes: number }, n: number): boolean => {
  if (!HOLES[n]?.includes(Math.min(shape.holes, 2))) return false;
  if (n === 2 && !looksLike2(shape.glyph)) return false;
  if (n === 5 && looksLike2(shape.glyph)) return false;
  if (contradicts(n, shape.glyph)) return false;
  return true;
};
