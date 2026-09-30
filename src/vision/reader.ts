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
import { readOkey } from './okey.ts';
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

/**
 * Read a whole screen or window capture with the Okey reader. If the cards come out small (a big
 * screen scaled down for speed), zoom into the area around them at full resolution and read again.
 * Returns the pixels that were read (the zoomed area when zoomed) so slots can be cropped for teaching.
 */
export const readCapture = (
  source: CanvasImageSource, width: number, height: number, digits: DigitBook,
  toPx: (sx: number, sy: number, sw: number, sh: number, maxW?: number) => Pixels,
): { px: Pixels; slots: Slot[] } => {
  let px = toPx(0, 0, width, height);
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
    const again = readPicture(zoomed, { kind: 'okey', digits }, new CardMemory(), {});
    if (again.length >= slots.length) { px = zoomed; slots = again; }
    else px = toPx(0, 0, width, height); // keep the last drawn picture in step with the slots
  }
  return { px, slots };
};
