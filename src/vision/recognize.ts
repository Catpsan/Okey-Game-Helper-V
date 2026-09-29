// Card recognition from pixels. Pure functions over RGBA pixel buffers, so they can be unit
// tested without a browser.
//
// Approach (read-only, no game access):
//   1. Color: the dominant hue among saturated pixels decides red / blue / yellow.
//      Too few saturated pixels means the slot is empty.
//   2. Number: the saturated-pixel mask is shrunk to a small grid ("glyph") and compared with
//      glyphs the player taught once per number (teach mode). Using the mask makes the glyph
//      the same whatever the card's color, so 8 samples cover all 24 cards.

import { cardOf, COLORS } from '../engine/cards.ts';
import type { Card, Color } from '../engine/cards.ts';

export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export const GLYPH_W = 12;
export const GLYPH_H = 16;

export interface RecognizerSettings {
  /** Minimum saturation (0..1) for a pixel to count as "ink". */
  minSaturation: number;
  /** Minimum brightness (0..1) for a pixel to count as "ink". */
  minValue: number;
  /** Fraction of ink pixels below which a slot counts as empty. */
  emptyBelow: number;
  /** Minimum glyph similarity (0..1) to accept a number. */
  minMatch: number;
}

export const DEFAULT_RECOGNIZER: RecognizerSettings = {
  minSaturation: 0.45,
  minValue: 0.3,
  emptyBelow: 0.02,
  minMatch: 0.6,
};

/** Taught glyphs: number (1..8) -> list of samples. */
export type GlyphBook = Record<number, number[][]>;

export interface SlotReading {
  card: Card | null;
  empty: boolean;
  color: Color | null;
  number: number | null;
  /** 0..1, how sure the reading is. */
  confidence: number;
}

const hsv = (r: number, g: number, b: number): [number, number, number] => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max / 255];
};

export const hueBucket = (h: number): Color | null => {
  if (h < 20 || h >= 330) return 'red';
  if (h >= 35 && h < 75) return 'yellow';
  if (h >= 185 && h < 260) return 'blue';
  return null;
};

export const inkMask = (px: Pixels, s: RecognizerSettings = DEFAULT_RECOGNIZER) => {
  const mask = new Uint8Array(px.width * px.height);
  const votes: Record<Color, number> = { red: 0, blue: 0, yellow: 0 };
  let ink = 0;
  for (let i = 0; i < mask.length; i++) {
    const [h, sat, val] = hsv(px.data[i * 4], px.data[i * 4 + 1], px.data[i * 4 + 2]);
    if (sat < s.minSaturation || val < s.minValue) continue;
    const bucket = hueBucket(h);
    if (!bucket) continue;
    mask[i] = 1;
    votes[bucket]++;
    ink++;
  }
  return { mask, votes, inkFraction: ink / mask.length };
};

/** Shrink the ink mask to its bounding box, then to a GLYPH_W x GLYPH_H grid of fill fractions. */
export const glyphOf = (mask: Uint8Array, width: number, height: number): number[] => {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!mask[y * width + x]) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const g = new Array(GLYPH_W * GLYPH_H).fill(0);
  if (x1 < 0) return g;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const counts = new Array(GLYPH_W * GLYPH_H).fill(0);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const gx = Math.min(GLYPH_W - 1, Math.floor(((x - x0) * GLYPH_W) / bw));
    const gy = Math.min(GLYPH_H - 1, Math.floor(((y - y0) * GLYPH_H) / bh));
    counts[gy * GLYPH_W + gx]++;
    g[gy * GLYPH_W + gx] += mask[y * width + x];
  }
  return g.map((v, i) => (counts[i] ? v / counts[i] : 0));
};

/** Cosine similarity of two centred glyphs (1 = identical shape). */
export const similarity = (a: number[], b: number[]): number => {
  const ma = a.reduce((s, v) => s + v, 0) / a.length;
  const mb = b.reduce((s, v) => s + v, 0) / b.length;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
};

export const readSlot = (px: Pixels, book: GlyphBook, s: RecognizerSettings = DEFAULT_RECOGNIZER): SlotReading => {
  const { mask, votes, inkFraction } = inkMask(px, s);
  if (inkFraction < s.emptyBelow) return { card: null, empty: true, color: null, number: null, confidence: 1 - inkFraction / s.emptyBelow / 2 };
  const total = votes.red + votes.blue + votes.yellow;
  const color = COLORS.reduce((best, c) => (votes[c] > votes[best] ? c : best), 'red' as Color);
  const colorShare = votes[color] / total;
  const glyph = glyphOf(mask, px.width, px.height);
  let number: number | null = null, bestSim = -1, secondSim = -1;
  for (const [n, samples] of Object.entries(book)) {
    for (const sample of samples) {
      const sim = similarity(glyph, sample);
      if (sim > bestSim) {
        if (Number(n) !== number) secondSim = bestSim;
        bestSim = sim;
        number = Number(n);
      } else if (sim > secondSim && Number(n) !== number) secondSim = sim;
    }
  }
  if (number === null || bestSim < s.minMatch) return { card: null, empty: false, color, number: null, confidence: 0 };
  const margin = Math.max(0, bestSim - Math.max(0, secondSim));
  const confidence = Math.min(1, colorShare * (0.5 + margin * 2) * bestSim);
  return { card: cardOf(color, number), empty: false, color, number, confidence };
};

/** Glyph for teach mode: call on a slot the player has labelled. */
export const teachGlyph = (px: Pixels, s: RecognizerSettings = DEFAULT_RECOGNIZER): number[] | null => {
  const { mask, inkFraction } = inkMask(px, s);
  return inkFraction < s.emptyBelow ? null : glyphOf(mask, px.width, px.height);
};
