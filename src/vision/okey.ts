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
import { glyphOf, similarity } from './recognize.ts';
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
  const faces = findBlobs(px).filter(isFace);
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
  const body = [...lums].sort((a, b) => a - b)[Math.floor(lums.length * 0.7)];
  const threshold = Math.min(70, body * 0.55);
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

export const matchDigit = (glyph: number[], books: DigitBook[], holes?: number): { number: number | null; score: number; margin: number } => {
  const best = new Map<number, number>();
  for (const book of books) for (const [n, samples] of Object.entries(book)) {
    // A digit with the wrong number of loops (e.g. an 8 read as a 6) is heavily penalised.
    const penalty = holes === undefined || HOLES[Number(n)]?.includes(Math.min(holes, 2)) ? 0 : 0.3;
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
  rows.slice(0, 2).forEach((row, r) => {
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
