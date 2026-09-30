// Automatic layout detection: find the cards anywhere in a picture of the game.
//
// No calibration needed. Two strategies, the first one that finds cards wins:
//   1. Card faces: light, grey-ish rectangles with a card's proportions that contain a coloured
//      number. Faces that touch each other are split by the card width. Reading only inside a
//      face means the game's gold/brown frame, coloured text and icons can't be mistaken for cards.
//   2. Coloured shapes: if the cards have coloured faces (or no face was found), strongly
//      coloured shapes of plausible size are the candidates.
// Candidates that line up in a row with similar sizes are the hand (up to 5) and the field
// (up to 3). A row only counts if its cards read as real cards.

import { components, inkLabels, readSlot, DEFAULT_RECOGNIZER, FACE_RECOGNIZER } from './recognize.ts';
import type { GlyphBook, Pixels, RecognizerSettings, SlotReading } from './recognize.ts';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Blob extends Box {
  pixels: number;
  color: number; // 0 red, 1 blue, 2 yellow
}

export interface DetectedCard {
  /** Box in the coordinates of the input picture. */
  box: Box;
  reading: SlotReading;
  /** Index of the row it belongs to (0 = the row with the most cards, i.e. the hand). */
  row: number;
  /** Settings the box was read with (reuse them when teaching from this box). */
  settings: RecognizerSettings;
}

/** Card height / width. Real cards are about 1.4; allow for borders and odd crops. */
const FACE_ASPECT_MIN = 1.05;
const FACE_ASPECT_MAX = 2.4;

/** Light, low-saturation areas with card proportions. Touching cards are split evenly. */
export const findFaces = (px: Pixels): Box[] => {
  const { width: W, height: H } = px;
  const light = new Uint8Array(W * H);
  const d = px.data;
  for (let i = 0; i < light.length; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    const max = r > g ? (r > b ? r : b) : g > b ? g : b;
    const min = r < g ? (r < b ? r : b) : g < b ? g : b;
    // Brightness >= 0.58 and saturation <= 0.32 (same scale as hsv()).
    if (max >= 148 && max - min <= 0.32 * max) light[i] = 1;
  }
  const minH = Math.max(14, H * 0.03);
  const faces: Box[] = [];
  for (const c of components(light, W, H, false)) {
    const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
    if (h < minH || h > H * 0.6 || w < 8) continue;
    const fill = c.pixels / (w * h);
    const aspect = h / w;
    if (aspect >= FACE_ASPECT_MIN && aspect <= FACE_ASPECT_MAX && fill >= 0.4) {
      faces.push({ x: c.x0, y: c.y0, w, h });
    } else if (aspect < FACE_ASPECT_MIN && fill >= 0.5) {
      // Several cards side by side merged into one light area.
      const k = Math.round(w / (h / 1.45));
      if (k < 2 || k > 5) continue;
      const cw = w / k;
      for (let i = 0; i < k; i++) faces.push({ x: Math.round(c.x0 + i * cw), y: c.y0, w: Math.round(cw), h });
    }
  }
  return faces;
};

/** Connected shapes of same-coloured ink (8-neighbour). */
export const findBlobs = (px: Pixels, s: RecognizerSettings = DEFAULT_RECOGNIZER): Blob[] => {
  const labels = inkLabels(px, s);
  const blobs: Blob[] = [];
  for (let color = 0; color < 3; color++) {
    const mask = new Uint8Array(labels.length);
    for (let i = 0; i < labels.length; i++) if (labels[i] === color) mask[i] = 1;
    for (const c of components(mask, px.width, px.height)) {
      blobs.push({ x: c.x0, y: c.y0, w: c.x1 - c.x0 + 1, h: c.y1 - c.y0 + 1, pixels: c.pixels, color });
    }
  }
  return blobs;
};

const contains = (a: Box, b: Box) => a !== b && a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h;

/** Keep blobs that could be a card number (or a coloured card), drop noise and outer frames. */
export const plausible = (blobs: Blob[], W: number, H: number): Blob[] => {
  const minH = Math.max(8, H * 0.015);
  const kept = blobs.filter(b => {
    const aspect = b.h / b.w;
    const fill = b.pixels / (b.w * b.h);
    return b.h >= minH && b.h <= H * 0.5 && b.w <= W * 0.25 && aspect >= 0.5 && aspect <= 7 && fill >= 0.08 && b.pixels >= 25;
  });
  // A coloured card frame around a coloured number: keep the number.
  const inner = kept.filter(b => !kept.some(o => contains(b, o) && o.h >= b.h * 0.3));
  // A small corner index next to a big number on the same card: keep the big one.
  return inner.filter(b => !inner.some(o => o !== b && o.h >= b.h * 1.5 && Math.abs(o.x - b.x) < o.h && Math.abs(o.y - b.y) < o.h));
};

/** Group boxes into horizontal rows of similar height. Rows are sorted by size, biggest first. */
export const rows = <T extends Box>(boxes: T[]): T[][] => {
  const sorted = [...boxes].sort((a, b) => a.x - b.x);
  const groups: T[][] = [];
  for (const b of sorted) {
    const cy = b.y + b.h / 2;
    const g = groups.find(g => {
      const ref = g[0];
      const rcy = ref.y + ref.h / 2;
      return Math.abs(cy - rcy) < ref.h * 0.5 && Math.max(b.h, ref.h) / Math.min(b.h, ref.h) < 1.35;
    });
    if (g) g.push(b);
    else groups.push([b]);
  }
  return groups.sort((a, b) => b.length - a.length || b[0].h - a[0].h);
};

const padded = (b: Box, W: number, H: number, k: number): Box => {
  const pad = Math.round(Math.max(b.w, b.h) * k);
  const x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad);
  return { x, y, w: Math.min(W, b.x + b.w + pad) - x, h: Math.min(H, b.y + b.h + pad) - y };
};

/** Shrink a face box a little so its border and shadow aren't read. */
const inset = (b: Box): Box => {
  const dx = Math.round(b.w * 0.06), dy = Math.round(b.h * 0.04);
  return { x: b.x + dx, y: b.y + dy, w: Math.max(1, b.w - 2 * dx), h: Math.max(1, b.h - 2 * dy) };
};

/** Read candidate rows; keep up to two rows (hand + field) whose cards read confidently. */
const readRows = (px: Pixels, candidates: Box[], toSlot: (b: Box) => Box, book: GlyphBook, s: RecognizerSettings, minConfidence: number) => {
  const out: DetectedCard[] = [];
  let rowIndex = 0;
  for (const row of rows(candidates)) {
    if (row.length > 5) continue; // not a hand or field row
    const cards = row.map(b => {
      const box = toSlot(b);
      return { box, reading: readSlot(crop(px, box), book, s), row: rowIndex, settings: s };
    });
    const good = cards.filter(c => c.reading.card !== null && c.reading.confidence >= minConfidence);
    // At least half the non-empty cards must read well, so coloured UI text doesn't count as a row.
    const shown = cards.filter(c => !c.reading.empty);
    if (good.length === 0 || good.length * 2 < shown.length) continue;
    out.push(...cards.filter(c => !c.reading.empty));
    rowIndex++;
    if (rowIndex >= 2 || out.length >= 8) break;
  }
  return out;
};

/**
 * Find and read the cards in a picture. `book` is the taught (or default) digit glyphs.
 * Only rows whose cards are read confidently are returned, so stray coloured UI elements
 * (icons, text) are ignored.
 */
export const detectCards = (px: Pixels, book: GlyphBook, s: RecognizerSettings = DEFAULT_RECOGNIZER, minConfidence = 0.35): DetectedCard[] => {
  const faces = findFaces(px);
  if (faces.length) {
    const found = readRows(px, faces, inset, book, { ...FACE_RECOGNIZER, minMatch: s.minMatch }, minConfidence);
    if (found.length) return found;
  }
  const blobs = plausible(findBlobs(px, s), px.width, px.height);
  return readRows(px, blobs, b => padded(b, px.width, px.height, 0.15), book, s, minConfidence);
};

/** Unread candidate boxes, for teach mode before any number is known. */
export const candidateBoxes = (px: Pixels, s: RecognizerSettings = DEFAULT_RECOGNIZER): { box: Box; settings: RecognizerSettings }[] => {
  const faces = rows(findFaces(px)).filter(r => r.length <= 5).slice(0, 2).flat();
  if (faces.length) return faces.map(f => ({ box: inset(f), settings: { ...FACE_RECOGNIZER, minMatch: s.minMatch } }));
  const blobs = plausible(findBlobs(px, s), px.width, px.height);
  return rows(blobs).filter(r => r.length <= 5).slice(0, 2).flat().map(b => ({ box: padded(b, px.width, px.height, 0.15), settings: s }));
};

export const crop = (px: Pixels, box: Box): Pixels => {
  const w = Math.max(1, Math.min(box.w, px.width - box.x));
  const h = Math.max(1, Math.min(box.h, px.height - box.y));
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = ((box.y + y) * px.width + box.x) * 4;
    data.set(px.data.subarray(src, src + w * 4), y * w * 4);
  }
  return { data, width: w, height: h };
};
