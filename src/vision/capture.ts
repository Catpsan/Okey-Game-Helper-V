// Screen capture through the browser's own screen-share prompt (getDisplayMedia).
// The player picks the game window; we only receive its pixels. Nothing here can send
// input to the game or read its memory.

import type { Pixels } from './recognize.ts';

/** A rectangle as fractions of the captured frame (0..1), so it survives resizes. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  hand: Region | null; // the 5 hand slots, side by side
  field: Region | null; // the 3 field slots (optional)
  /** Gap between slots as a fraction of slot width. */
  gap: number;
}

export const DEFAULT_LAYOUT: Layout = { hand: null, field: null, gap: 0.08 };

export class Capture {
  readonly video = document.createElement('video');
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  private stream: MediaStream | null = null;

  async start(onEnded: () => void) {
    this.stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
    this.stream.getVideoTracks()[0].addEventListener('ended', onEnded);
    this.video.srcObject = this.stream;
    this.video.muted = true;
    await this.video.play();
  }

  stop() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  get active() {
    return this.stream !== null;
  }

  /** Grab the current frame into the internal canvas. Returns false if no frame yet. */
  grab(): boolean {
    const { videoWidth: w, videoHeight: h } = this.video;
    if (!w || !h) return false;
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.ctx.drawImage(this.video, 0, 0);
    return true;
  }

  frameCanvas() {
    return this.canvas;
  }

  /** Cut a region into `count` equal slots and return their pixels. */
  slots(region: Region, count: number, gap: number): Pixels[] {
    const W = this.canvas.width, H = this.canvas.height;
    const rx = region.x * W, ry = region.y * H, rw = region.w * W, rh = region.h * H;
    const slotW = rw / (count + gap * (count - 1));
    const out: Pixels[] = [];
    for (let i = 0; i < count; i++) {
      const x = Math.round(rx + i * slotW * (1 + gap));
      const w = Math.max(1, Math.round(slotW));
      const h = Math.max(1, Math.round(rh));
      const img = this.ctx.getImageData(x, Math.round(ry), w, h);
      out.push({ data: img.data, width: img.width, height: img.height });
    }
    return out;
  }
}

/** Slot rectangles in frame fractions, for drawing the calibration overlay. */
export const slotRects = (region: Region, count: number, gap: number): Region[] => {
  const slotW = region.w / (count + gap * (count - 1));
  return Array.from({ length: count }, (_, i) => ({ x: region.x + i * slotW * (1 + gap), y: region.y, w: slotW, h: region.h }));
};
