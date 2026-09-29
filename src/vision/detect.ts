// Automatic layout detection: find the cards anywhere in a picture of the game.
//
// No calibration needed. The picture is scanned for "ink": strongly saturated red, blue or
// yellow pixels. Connected ink blobs of plausible size are candidate card numbers (or whole
// cards, if the card face itself is coloured). Blobs that line up in a row with similar
// heights are the hand (up to 5) and the field (up to 3). Each one is then read with the
// normal slot reader.

import { inkMask, readSlot, DEFAULT_RECOGNIZER } from './recognize.ts';
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
}

const COLOR_OF = { red: 0, blue: 1, yellow: 2 } as const;

/** Connected components of same-coloured ink (8-neighbour). */
export const findBlobs = (px: Pixels, s: RecognizerSettings = DEFAULT_RECOGNIZER): Blob[] => {
  const { width: W, height: H } = px;
  const { mask } = inkMask(px, s);
  // Colour label per ink pixel.
  const label = new Int8Array(W * H).fill(-1);
  for (let i = 0; i < W * H; i++) {
    if (!mask[i]) continue;
    const r = px.data[i * 4], g = px.data[i * 4 + 1], b = px.data[i * 4 + 2];
    label[i] = b > r && b > g ? COLOR_OF.blue : r > 1.6 * b && g > 0.55 * r ? COLOR_OF.yellow : COLOR_OF.red;
  }
  const seen = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  const blobs: Blob[] = [];
  for (let start = 0; start < W * H; start++) {
    if (label[start] < 0 || seen[start]) continue;
    const color = label[start];
    let top = 0, n = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top > 0) {
      const i = stack[--top];
      const x = i % W, y = (i - x) / W;
      n++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (seen[j] || label[j] !== color) continue;
        seen[j] = 1;
        stack[top++] = j;
      }
    }
    blobs.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, pixels: n, color });
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
  return kept.filter(b => !kept.some(o => contains(b, o) && o.h >= b.h * 0.3));
};

/** Group blobs into horizontal rows of similar height. Rows are sorted by size, biggest first. */
export const rows = (blobs: Blob[]): Blob[][] => {
  const sorted = [...blobs].sort((a, b) => a.x - b.x);
  const groups: Blob[][] = [];
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

/**
 * Find and read the cards in a picture. `book` is the taught (or default) digit glyphs.
 * Only rows whose cards are read confidently are returned, so stray coloured UI elements
 * (icons, text) are ignored.
 */
export const detectCards = (px: Pixels, book: GlyphBook, s: RecognizerSettings = DEFAULT_RECOGNIZER, minConfidence = 0.35): DetectedCard[] => {
  const blobs = plausible(findBlobs(px, s), px.width, px.height);
  const out: DetectedCard[] = [];
  let rowIndex = 0;
  for (const row of rows(blobs)) {
    if (row.length > 5) continue; // not a hand or field row
    const cards = row.map(b => {
      const pad = Math.round(Math.max(b.w, b.h) * 0.15);
      const box = {
        x: Math.max(0, b.x - pad),
        y: Math.max(0, b.y - pad),
        w: Math.min(px.width, b.x + b.w + pad) - Math.max(0, b.x - pad),
        h: Math.min(px.height, b.y + b.h + pad) - Math.max(0, b.y - pad),
      };
      return { box, reading: readSlot(crop(px, box), book, s), row: rowIndex };
    });
    const good = cards.filter(c => c.reading.card !== null && c.reading.confidence >= minConfidence);
    if (good.length === 0) continue;
    out.push(...cards);
    rowIndex++;
    if (out.length >= 8) break;
  }
  return out;
};

/** Unread candidate boxes, for teach mode before any number is known. */
export const candidateBoxes = (px: Pixels, s: RecognizerSettings = DEFAULT_RECOGNIZER): Box[] => {
  const blobs = plausible(findBlobs(px, s), px.width, px.height);
  const best = rows(blobs).filter(r => r.length <= 5).slice(0, 2).flat();
  return best.map(b => {
    const pad = Math.round(Math.max(b.w, b.h) * 0.15);
    return { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), w: b.w + 2 * pad, h: b.h + 2 * pad };
  });
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
