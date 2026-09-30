// Reads the cards in a picture: finds the slots (marked box, whole snip, or automatic
// detection), then reads each slot with the learned card memory, falling back to the
// built-in colour/digit reader for cards not learned yet.

import { slotBoxes } from './capture.ts';
import type { Layout } from './capture.ts';
import { readSlot } from './recognize.ts';
import type { GlyphBook, Pixels, SlotReading } from './recognize.ts';
import { detectCards, crop } from './detect.ts';
import type { Box } from './detect.ts';
import { CardMemory } from './learn.ts';
import { bit } from '../engine/cards.ts';
import { readOkey, findOkeyWindow } from './okey.ts';
import type { DigitBook } from './okey.ts';

export const MIN_CONFIDENCE = 0.45;

export interface Slot {
  box: Box;
  reading: SlotReading;
  /** Where the reading came from. */
  via: 'learned' | 'built-in' | 'none';
}

export type SlotSource =
  | { kind: 'okey'; digits: DigitBook } // the real Okey window: finds the cards by itself
  | { kind: 'layout'; layout: Layout }
  | { kind: 'whole'; count: number; gap: number } // a snip of just the hand
  | { kind: 'auto' };

export const readSlotPixels = (px: Pixels, memory: CardMemory, book: GlyphBook): { reading: SlotReading; via: Slot['via'] } => {
  const learned = memory.read(px);
  if (learned.via !== 'none' && (learned.empty || learned.confidence >= MIN_CONFIDENCE)) return { reading: learned, via: 'learned' };
  const builtIn = readSlot(px, book);
  if (builtIn.empty || (builtIn.card !== null && builtIn.confidence >= MIN_CONFIDENCE)) return { reading: builtIn, via: 'built-in' };
  // Neither is sure: report the better guess, marked unsure.
  return learned.confidence >= builtIn.confidence && learned.via !== 'none'
    ? { reading: learned, via: 'learned' }
    : { reading: builtIn, via: builtIn.card !== null ? 'built-in' : 'none' };
};

export const readPicture = (px: Pixels, source: SlotSource, memory: CardMemory, book: GlyphBook): Slot[] => {
  let boxes: Box[];
  if (source.kind === 'okey') {
    return readOkey(px, source.digits).map(c => ({ box: c.box, reading: c.reading, via: 'built-in' as const }));
  }
  if (source.kind === 'auto') {
    boxes = detectCards(px, book, undefined, 0).map(d => d.box);
  } else if (source.kind === 'whole') {
    boxes = slotBoxes({ x: 0, y: 0, w: 1, h: 1 }, source.count, source.gap, px.width, px.height);
  } else {
    const { hand, field, gap } = source.layout;
    boxes = [
      ...(hand ? slotBoxes(hand, 5, gap, px.width, px.height) : []),
      ...(field ? slotBoxes(field, 3, gap, px.width, px.height) : []),
    ];
  }
  return boxes.map(box => ({ box, ...readSlotPixels(crop(px, box), memory, book) }));
};

export const isSure = (s: Slot) => s.reading.empty || (s.reading.card !== null && s.reading.confidence >= MIN_CONFIDENCE);

/** The set of visible cards, or null if anything is unsure or duplicated. */
export const visibleSet = (slots: Slot[]): number | null => {
  let visible = 0;
  for (const s of slots) {
    if (s.reading.empty) continue;
    if (!isSure(s) || visible & bit(s.reading.card!)) return null;
    visible |= bit(s.reading.card!);
  }
  return visible;
};

export interface Rect { x: number; y: number; w: number; h: number }

/**
 * Read a whole screen or window capture with the Okey reader.
 * First it looks for the Okey window itself (title bar + deck) and reads only inside it, at full
 * resolution, so numbers on skill bars, potions or buffs elsewhere on screen are never read.
 * `hint` is where the window was last time (source pixels): it is checked first, so a live share
 * stays locked on the window. Without a window it falls back to searching the whole picture,
 * zooming in when the cards come out small.
 * Returns the pixels that were read (the window when found) so slots can be cropped for teaching.
 */
export const readCapture = (
  source: CanvasImageSource, width: number, height: number, digits: DigitBook,
  toPx: (sx: number, sy: number, sw: number, sh: number, maxW?: number) => Pixels,
  hint: Rect | null = null,
): { px: Pixels; slots: Slot[]; window: Rect | null } => {
  const inWindow = (region: Rect): { px: Pixels; slots: Slot[]; window: Rect } | null => {
    const r = clampRect(region, width, height);
    const rp = toPx(r.x, r.y, r.w, r.h, 1600);
    const win = findOkeyWindow(rp);
    if (!win) return null;
    const sc = rp.width / r.w;
    const slots = readPicture(rp, { kind: 'okey', digits }, new CardMemory(), {}).filter(sl => {
      const cx = sl.box.x + sl.box.w / 2, cy = sl.box.y + sl.box.h / 2;
      return cx > win.x && cx < win.x + win.w && cy > win.y && cy < win.y + win.h;
    });
    return { px: rp, slots, window: { x: r.x + win.x / sc, y: r.y + win.y / sc, w: win.w / sc, h: win.h / sc } };
  };
  const padded = (w: Rect): Rect => ({ x: w.x - w.w * 0.08, y: w.y - w.h * 0.08, w: w.w * 1.16, h: w.h * 1.16 });

  if (hint) {
    const locked = inWindow(padded(hint));
    if (locked) return locked;
  }
  let px = toPx(0, 0, width, height);
  const win = findOkeyWindow(px);
  if (win) {
    const k = width / px.width;
    const found = inWindow(padded({ x: win.x * k, y: win.y * k, w: win.w * k, h: win.h * k }));
    if (found) return found;
    px = toPx(0, 0, width, height);
  }
  let slots = readPicture(px, { kind: 'okey', digits }, new CardMemory(), {});
  const k = width / px.width;
  const faceW = slots[0]?.box.w ?? 0;
  if ((slots.length === 0 && width > px.width) || (faceW > 0 && faceW < 30 && k > 1)) {
    // Zoom: around the cards if we saw some, else the whole picture at up to 2560 px wide.
    let sx = 0, sy = 0, sw = width, sh = height;
    if (slots.length) {
      const x0 = Math.min(...slots.map(s => s.box.x)), y0 = Math.min(...slots.map(s => s.box.y));
      const x1 = Math.max(...slots.map(s => s.box.x + s.box.w)), y1 = Math.max(...slots.map(s => s.box.y + s.box.h));
      const pad = (y1 - y0) * 2;
      sx = Math.max(0, (x0 - pad) * k); sy = Math.max(0, (y0 - pad) * k);
      sw = Math.min(width - sx, (x1 - x0 + 2 * pad) * k); sh = Math.min(height - sy, (y1 - y0 + 2 * pad) * k);
    }
    const zoomed = toPx(sx, sy, sw, sh, 2560);
    const zwin = findOkeyWindow(zoomed);
    if (zwin) {
      const zk = sw / zoomed.width;
      const found = inWindow(padded({ x: sx + zwin.x * zk, y: sy + zwin.y * zk, w: zwin.w * zk, h: zwin.h * zk }));
      if (found) return found;
    }
    const again = readPicture(zoomed, { kind: 'okey', digits }, new CardMemory(), {});
    if (again.length >= slots.length) { px = zoomed; slots = again; }
    else px = toPx(0, 0, width, height); // keep the last drawn picture in step with the slots
  }
  return { px, slots, window: null };
};

const clampRect = (r: Rect, W: number, H: number): Rect => {
  const x = Math.max(0, Math.round(r.x)), y = Math.max(0, Math.round(r.y));
  return { x, y, w: Math.max(1, Math.min(W - x, Math.round(r.w + Math.min(0, r.x)))), h: Math.max(1, Math.min(H - y, Math.round(r.h + Math.min(0, r.y)))) };
};
