// Card recognition from pixels. Pure functions over RGBA pixel buffers, so they can be unit
// tested without a browser.
//
// Approach (read-only, no game access):
//   1. Color: the dominant hue among saturated ("ink") pixels decides red / blue / yellow.
//      Too few ink pixels means the slot is empty.
//   2. Number: only the biggest ink shape in the slot is used (the main number), so corner
//      indices, symbols and frame bits don't spoil the reading. If that shape is a solid block
//      (a coloured card with a light number on it), the light pixels inside it are read instead.
//      The shape is shrunk to a small grid ("glyph") plus its width/height ratio and compared
//      with built-in and taught glyphs. Glyphs ignore colour, so 8 samples cover all 24 cards.

import { cardOf, COLORS } from '../engine/cards.ts';
import type { Card, Color } from '../engine/cards.ts';

export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export const GLYPH_W = 12;
export const GLYPH_H = 16;
const GRID = GLYPH_W * GLYPH_H;

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
  minMatch: 0.55,
};

/** Inside a detected card face the background is known to be light and grey, so fainter ink counts. */
export const FACE_RECOGNIZER: RecognizerSettings = { ...DEFAULT_RECOGNIZER, minSaturation: 0.3, emptyBelow: 0.012 };

/**
 * Taught glyphs: number (1..8) -> list of samples. A sample is GLYPH_W * GLYPH_H fill values,
 * optionally followed by the shape's width / height ratio (older saved samples lack it).
 */
export type GlyphBook = Record<number, number[][]>;

export interface SlotReading {
  card: Card | null;
  empty: boolean;
  color: Color | null;
  number: number | null;
  /** 0..1, how sure the reading is. */
  confidence: number;
}

export const hsv = (r: number, g: number, b: number): [number, number, number] => {
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

/** Game reds lean orange and yellows lean gold, so the buckets are wide. */
export const hueBucket = (h: number): Color | null => {
  if (h < 22 || h >= 325) return 'red';
  if (h >= 22 && h < 80) return 'yellow';
  if (h >= 170 && h < 275) return 'blue';
  return null;
};

const COLOR_INDEX: Record<Color, number> = { red: 0, blue: 1, yellow: 2 };

/** Per pixel: -1 = no ink, otherwise the colour index (0 red, 1 blue, 2 yellow). */
export const inkLabels = (px: Pixels, s: RecognizerSettings = DEFAULT_RECOGNIZER): Int8Array => {
  const labels = new Int8Array(px.width * px.height).fill(-1);
  for (let i = 0; i < labels.length; i++) {
    const [h, sat, val] = hsv(px.data[i * 4], px.data[i * 4 + 1], px.data[i * 4 + 2]);
    if (sat < s.minSaturation || val < s.minValue) continue;
    const bucket = hueBucket(h);
    if (bucket) labels[i] = COLOR_INDEX[bucket];
  }
  return labels;
};

export const inkMask = (px: Pixels, s: RecognizerSettings = DEFAULT_RECOGNIZER) => {
  const labels = inkLabels(px, s);
  const mask = new Uint8Array(labels.length);
  const votes: Record<Color, number> = { red: 0, blue: 0, yellow: 0 };
  let ink = 0;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] < 0) continue;
    mask[i] = 1;
    votes[COLORS[labels[i]]]++;
    ink++;
  }
  return { mask, votes, inkFraction: ink / Math.max(1, labels.length) };
};

export interface Component {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  pixels: number;
  /** Pixel indices belonging to the component. */
  members: Int32Array;
}

/** 8-connected components of a 0/1 mask. `members` is only filled when asked for (it costs memory on big pictures). */
export const components = (mask: Uint8Array, width: number, height: number, keepMembers = true): Component[] => {
  const seen = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  const out: Component[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let top = 0, n = 0, x0 = width, y0 = height, x1 = 0, y1 = 0;
    const members: number[] = [];
    stack[top++] = start;
    seen[start] = 1;
    while (top > 0) {
      const i = stack[--top];
      const x = i % width, y = (i - x) / width;
      if (keepMembers) members.push(i);
      n++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (!mask[j] || seen[j]) continue;
        seen[j] = 1;
        stack[top++] = j;
      }
    }
    out.push({ x0, y0, x1, y1, pixels: n, members: Int32Array.from(members) });
  }
  return out;
};

/**
 * The main number's pixels: the biggest ink shape, plus smaller pieces that overlap it
 * (broken strokes). Corner indices and symbols elsewhere on the card are dropped.
 */
export const mainShape = (mask: Uint8Array, width: number, height: number): { mask: Uint8Array; main: Component | null } => {
  const parts = components(mask, width, height);
  if (parts.length === 0) return { mask, main: null };
  const main = parts.reduce((a, b) => (b.pixels > a.pixels ? b : a));
  const keep = new Uint8Array(mask.length);
  let x0 = main.x0, y0 = main.y0, x1 = main.x1, y1 = main.y1;
  for (const p of parts) {
    const overlaps = p.x0 <= main.x1 && p.x1 >= main.x0 && p.y0 <= main.y1 && p.y1 >= main.y0;
    if (p !== main && !(overlaps && p.pixels >= main.pixels * 0.05)) continue;
    for (const i of p.members) keep[i] = 1;
    x0 = Math.min(x0, p.x0); y0 = Math.min(y0, p.y0); x1 = Math.max(x1, p.x1); y1 = Math.max(y1, p.y1);
  }
  return { mask: keep, main: { ...main, x0, y0, x1, y1 } };
};

/** Shrink a mask to its bounding box, then to a GLYPH_W x GLYPH_H grid of fill fractions, plus the w/h ratio. */
export const glyphOf = (mask: Uint8Array, width: number, height: number): number[] => {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!mask[y * width + x]) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const g = new Array(GRID).fill(0);
  if (x1 < 0) return [...g, 1];
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const counts = new Array(GRID).fill(0);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const gx = Math.min(GLYPH_W - 1, Math.floor(((x - x0) * GLYPH_W) / bw));
    const gy = Math.min(GLYPH_H - 1, Math.floor(((y - y0) * GLYPH_H) / bh));
    counts[gy * GLYPH_W + gx]++;
    g[gy * GLYPH_W + gx] += mask[y * width + x];
  }
  return [...g.map((v, i) => (counts[i] ? v / counts[i] : 0)), bw / bh];
};

/**
 * Similarity of two glyphs (1 = identical shape): cosine of the centred grids, lowered when
 * the shapes have clearly different width/height ratios (a "1" is much narrower than a "7").
 */
export const similarity = (a: number[], b: number[]): number => {
  let ma = 0, mb = 0;
  for (let i = 0; i < GRID; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= GRID;
  mb /= GRID;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < GRID; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const shape = na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
  const ra = a[GRID], rb = b[GRID];
  if (!(ra > 0) || !(rb > 0)) return shape;
  const ratio = Math.abs(Math.log(ra / rb));
  return shape * (1 - Math.min(0.45, Math.max(0, ratio - 0.12) * 0.7));
};

/** Glyph of the number in a slot (see the file comment), or null if the slot is empty. */
const numberGlyph = (px: Pixels, s: RecognizerSettings) => {
  const labels = inkLabels(px, s);
  const all = new Uint8Array(labels.length);
  let ink = 0;
  for (let i = 0; i < labels.length; i++) if (labels[i] >= 0) { all[i] = 1; ink++; }
  const inkFraction = ink / Math.max(1, labels.length);
  if (inkFraction < s.emptyBelow) return { glyph: null, inkFraction, color: null, colorShare: 0 };
  const { mask, main } = mainShape(all, px.width, px.height);
  const votes = [0, 0, 0];
  let kept = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) { votes[labels[i]]++; kept++; }
  const ci = votes[0] >= votes[1] && votes[0] >= votes[2] ? 0 : votes[1] >= votes[2] ? 1 : 2;
  const color = (['red', 'blue', 'yellow'] as const)[ci];
  const colorShare = votes[ci] / Math.max(1, kept);
  if (!main) return { glyph: null, inkFraction, color, colorShare };
  const bw = main.x1 - main.x0 + 1, bh = main.y1 - main.y0 + 1;
  const solid = kept / (bw * bh) > 0.62 && bw * bh > labels.length * 0.25;
  if (!solid) return { glyph: glyphOf(mask, px.width, px.height), inkFraction, color, colorShare };
  // A coloured card face (as in Metin 2: black number on a red, blue or yellow card): the
  // number is the dark or light, non-coloured area inside the block.
  const inner = new Uint8Array(mask.length);
  const ix0 = main.x0 + Math.round(bw * 0.06), ix1 = main.x1 - Math.round(bw * 0.06);
  const iy0 = main.y0 + Math.round(bh * 0.06), iy1 = main.y1 - Math.round(bh * 0.06);
  for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) {
    const i = y * px.width + x;
    const [, sat, val] = hsv(px.data[i * 4], px.data[i * 4 + 1], px.data[i * 4 + 2]);
    if (!mask[i] && (val < 0.35 || (val > 0.55 && sat < 0.35))) inner[i] = 1;
  }
  const number = mainShape(inner, px.width, px.height).mask;
  return { glyph: glyphOf(number, px.width, px.height), inkFraction, color, colorShare };
};

export const readSlot = (px: Pixels, book: GlyphBook, s: RecognizerSettings = DEFAULT_RECOGNIZER): SlotReading => {
  const { glyph, inkFraction, color, colorShare } = numberGlyph(px, s);
  if (!glyph || !color) return { card: null, empty: true, color: null, number: null, confidence: Math.max(0, 1 - inkFraction / s.emptyBelow / 2) };
  // Best match per number, so several samples of the same number don't crowd out the runner-up.
  const best: number[] = [];
  for (const [n, samples] of Object.entries(book)) {
    for (const sample of samples) {
      const sim = similarity(glyph, sample);
      if (!(best[Number(n)] >= sim)) best[Number(n)] = sim;
    }
  }
  let number: number | null = null, bestSim = -1, secondSim = -1;
  for (let n = 1; n <= 8; n++) {
    const sim = best[n];
    if (sim === undefined) continue;
    if (sim > bestSim) {
      secondSim = bestSim;
      bestSim = sim;
      number = n;
    } else if (sim > secondSim) secondSim = sim;
  }
  if (number === null || bestSim < s.minMatch) return { card: null, empty: false, color, number: null, confidence: 0 };
  const margin = Math.max(0, bestSim - Math.max(0, secondSim));
  const confidence = Math.min(1, colorShare * (0.55 + margin * 2.5) * bestSim);
  return { card: cardOf(color, number), empty: false, color, number, confidence };
};

/** Glyph for teach mode: call on a slot the player has labelled. */
export const teachGlyph = (px: Pixels, s: RecognizerSettings = DEFAULT_RECOGNIZER): number[] | null => numberGlyph(px, s).glyph;
