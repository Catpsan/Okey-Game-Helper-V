// Starter digit glyphs rendered in common bold fonts, so recognition can work before the
// player teaches anything. Taught samples are added on top and usually match better.
// Browser only (needs a canvas).

import { teachGlyph } from './recognize.ts';
import type { GlyphBook } from './recognize.ts';

const FONTS = ['bold 72px Arial, sans-serif', 'bold 72px Verdana, sans-serif', 'bold 72px Georgia, serif', 'bold 72px Tahoma, sans-serif'];

let cached: GlyphBook | null = null;

export const defaultGlyphs = (): GlyphBook => {
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 96;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const book: GlyphBook = {};
  for (let n = 1; n <= 8; n++) {
    for (const font of FONTS) {
      ctx.fillStyle = '#e8dcc0';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#d22222';
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(n), canvas.width / 2, canvas.height / 2 + 4);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const g = teachGlyph({ data: img.data, width: img.width, height: img.height });
      if (g) (book[n] ??= []).push(g);
    }
  }
  return (cached = book);
};

/** Taught samples plus the starter ones. */
export const withDefaults = (taught: GlyphBook): GlyphBook => {
  const base = defaultGlyphs();
  const out: GlyphBook = {};
  for (let n = 1; n <= 8; n++) out[n] = [...(taught[n] ?? []), ...(base[n] ?? [])];
  return out;
};
