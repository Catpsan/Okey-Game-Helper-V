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

export const MIN_CONFIDENCE = 0.45;

export interface Slot {
  box: Box;
  reading: SlotReading;
  /** Where the reading came from. */
  via: 'learned' | 'built-in' | 'none';
}

export type SlotSource =
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
