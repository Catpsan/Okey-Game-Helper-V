// Card memory: recognition that learns what the real cards look like.
//
// Fixed colour ranges and font shapes can't cover every client, theme and screen, so this
// reader learns from the player: every time a card in a slot is identified (by a click on the
// 24-card grid, or a confirmed reading), the slot picture is stored with its label. Slots are
// then recognised by comparing with what was learned:
//   1. whole-card match: the same card seen before (colour and number together);
//   2. otherwise colour and number separately, so a red 7 can be read after seeing a blue 7
//      and any red card.
// Before anything is learned, the built-in colour/digit reader is used as a fallback.

import { cardOf, colorOf, numberOf, COLORS } from '../engine/cards.ts';
import type { Card, Color } from '../engine/cards.ts';
import type { Pixels, SlotReading } from './recognize.ts';

const TW = 24;
const TH = 32;
const HUE_BINS = 12;

export interface Features {
  /** Z-normalised RGB thumbnail (colour + shape). */
  rgb: number[];
  /** Hue histogram of coloured pixels (colour only). */
  hue: number[];
  /** Z-normalised gradient-magnitude thumbnail (shape only, mostly colour-independent). */
  edge: number[];
  /** Amount of detail in the slot (low for empty slots). */
  energy: number;
}

/** Label: a card index 0..23, or 'empty'. */
export type Label = Card | 'empty';

export interface Sample {
  label: Label;
  f: Features;
}

const zNorm = (v: number[]): number[] => {
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1;
  return v.map(x => Math.round(((x - m) / sd) * 40) / 40);
};

const dot = (a: number[], b: number[]) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s / a.length; // correlation for z-normalised vectors
};

const histSim = (a: number[], b: number[]) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.min(a[i], b[i]);
  return s; // histogram intersection, 0..1
};

/** Area-average downscale to TW x TH, returning [r, g, b] planes. */
const thumb = (px: Pixels): [number[], number[], number[]] => {
  const r = new Array(TW * TH).fill(0), g = [...r], b = [...r], n = [...r];
  for (let y = 0; y < px.height; y++) {
    const ty = Math.min(TH - 1, Math.floor((y * TH) / px.height));
    for (let x = 0; x < px.width; x++) {
      const tx = Math.min(TW - 1, Math.floor((x * TW) / px.width));
      const i = (y * px.width + x) * 4, t = ty * TW + tx;
      r[t] += px.data[i]; g[t] += px.data[i + 1]; b[t] += px.data[i + 2]; n[t]++;
    }
  }
  for (let t = 0; t < r.length; t++) if (n[t]) { r[t] /= n[t]; g[t] /= n[t]; b[t] /= n[t]; }
  return [r, g, b];
};

export const features = (px: Pixels): Features => {
  const [r, g, b] = thumb(px);
  const lum = r.map((v, i) => 0.299 * v + 0.587 * g[i] + 0.114 * b[i]);
  const edge: number[] = [];
  let energy = 0;
  for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
    const at = (xx: number, yy: number) => lum[Math.min(TH - 1, Math.max(0, yy)) * TW + Math.min(TW - 1, Math.max(0, xx))];
    const gx = at(x + 1, y) - at(x - 1, y), gy = at(x, y + 1) - at(x, y - 1);
    const m = Math.hypot(gx, gy);
    edge.push(m);
    energy += m;
  }
  const hue = new Array(HUE_BINS).fill(0);
  let weight = 0;
  for (let y = 0; y < px.height; y += 2) for (let x = 0; x < px.width; x += 2) {
    const i = (y * px.width + x) * 4;
    const R = px.data[i], G = px.data[i + 1], B = px.data[i + 2];
    const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
    if (max < 40 || d / max < 0.25) continue;
    let h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    h = (h * 60 + 360) % 360;
    const w = (d / max) * (max / 255);
    hue[Math.floor(h / (360 / HUE_BINS)) % HUE_BINS] += w;
    weight += w;
  }
  return {
    rgb: zNorm([...r, ...g, ...b]),
    hue: hue.map(v => (weight ? Math.round((v / weight) * 1000) / 1000 : 0)),
    edge: zNorm(edge),
    energy: Math.round(energy / (TW * TH)),
  };
};

export interface MemoryReading extends SlotReading {
  /** How the reading was made. */
  via: 'card' | 'parts' | 'none';
}

const MAX_PER_LABEL = 3;


export class CardMemory {
  samples: Sample[];
  constructor(samples: Sample[] = []) {
    this.samples = samples;
  }

  get size() {
    return this.samples.length;
  }

  /** Cards (not 'empty') that have been learned at least once. */
  known(): Set<Card> {
    return new Set(this.samples.map(s => s.label).filter((l): l is Card => l !== 'empty'));
  }

  learn(px: Pixels, label: Label) {
    this.meanEdge = null;
    const f = features(px);
    const same = this.samples.filter(s => s.label === label);
    if (same.length >= MAX_PER_LABEL) this.samples.splice(this.samples.indexOf(same[0]), 1);
    this.samples.push({ label, f });
  }

  forget(label: Label) {
    this.meanEdge = null;
    this.samples = this.samples.filter(s => s.label !== label);
  }

  private meanEdge: number[] | null = null;

  /** Average edge map of all learned cards: the parts every card shares (frame, emblem). */
  private common(): number[] | null {
    if (this.meanEdge) return this.meanEdge;
    const cards = this.samples.filter(s => s.label !== 'empty');
    if (cards.length < 2) return null;
    const m = new Array(cards[0].f.edge.length).fill(0);
    for (const s of cards) s.f.edge.forEach((v, i) => (m[i] += v / cards.length));
    return (this.meanEdge = m);
  }

  /** Edge map minus what all cards share, so the comparison looks at the number. */
  private distinct(edge: number[]): number[] {
    const m = this.common();
    return m ? zNorm(edge.map((v, i) => v - m[i])) : edge;
  }

  read(px: Pixels): MemoryReading {
    const none: MemoryReading = { card: null, empty: false, color: null, number: null, confidence: 0, via: 'none' };
    if (this.samples.length === 0) return none;
    const f = features(px);
    const cards = this.samples.filter((s): s is Sample & { label: Card } => s.label !== 'empty');

    // Empty slot: much less detail than a card, or close to a learned empty slot.
    const energies = cards.map(s => s.f.energy).sort((a, b) => a - b);
    const typical = energies[Math.floor(energies.length / 2)];
    if (typical !== undefined && f.energy < typical * 0.3) {
      return { card: null, empty: true, color: null, number: null, confidence: 1 - f.energy / (typical * 0.3), via: 'card' };
    }
    const emptySim = Math.max(-1, ...this.samples.filter(s => s.label === 'empty').map(s => dot(f.rgb, s.f.rgb)));
    if (cards.length === 0) return emptySim > 0.85 ? { ...none, empty: true, confidence: emptySim, via: 'card' } : none;
    if (emptySim > 0.9) return { ...none, empty: true, confidence: emptySim, via: 'card' };

    // Colour: hue histogram against every learned card.
    const colorScore = new Map<Color, number>();
    for (const s of cards) {
      const c = colorOf(s.label);
      colorScore.set(c, Math.max(colorScore.get(c) ?? 0, histSim(f.hue, s.f.hue)));
    }
    const colors = [...colorScore.entries()].sort((a, b) => b[1] - a[1]);
    const [color, cScore] = colors[0];
    const cMargin = cScore - (colors[1]?.[1] ?? 0);
    const colorsSeen = new Set(cards.map(s => colorOf(s.label))).size;

    // Number: distinctive shape against every learned card, whatever its colour.
    const mine = this.distinct(f.edge);
    const numberScore = new Map<number, number>();
    for (const s of cards) {
      const n = numberOf(s.label);
      numberScore.set(n, Math.max(numberScore.get(n) ?? -1, dot(mine, this.distinct(s.f.edge))));
    }
    const numbers = [...numberScore.entries()].sort((a, b) => b[1] - a[1]);
    const [number, nScore] = numbers[0];
    const nMargin = nScore - (numbers[1]?.[1] ?? 0);

    const colorConf = colorsSeen === COLORS.length || colorScore.size === 1 ? Math.min(1, cScore * (0.6 + cMargin)) : cScore > 0.8 ? 0.6 : 0.2;
    const numberConf = Math.min(1, Math.max(0, nScore) * (0.55 + nMargin * 2.5));
    const card = cardOf(color, number);
    const seenBefore = cards.some(s => s.label === card);
    return {
      card, empty: false, color, number,
      confidence: Math.min(1, colorConf * numberConf * (seenBefore ? 1.15 : 1)),
      via: seenBefore ? 'card' : 'parts',
    };
  }

  toJSON() {
    return this.samples;
  }
}
