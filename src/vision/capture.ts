// Screen capture through the browser's own screen-share prompt (getDisplayMedia), and
// conversion of any picture (live frame or pasted screenshot) into pixels for recognition.
// Nothing here can send input to the game or read its memory.

import type { Pixels } from './recognize.ts';
import type { Box } from './detect.ts';

/** A rectangle as fractions of the picture (0..1), so it survives resizes. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Manual layout, used only when automatic detection is switched off. */
export interface Layout {
  hand: Region | null; // the 5 hand slots, side by side
  field: Region | null; // the 3 field slots (optional)
  /** Gap between slots as a fraction of slot width. */
  gap: number;
}

export const DEFAULT_LAYOUT: Layout = { hand: null, field: null, gap: 0.08 };

/** Largest width pictures are analysed at; bigger ones are scaled down. */
export const ANALYSIS_WIDTH = 1280;

export class Capture {
  readonly video = document.createElement('video');
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

  get ready() {
    return this.stream !== null && this.video.videoWidth > 0;
  }
}

const work = document.createElement('canvas');
const workCtx = work.getContext('2d', { willReadFrequently: true })!;

/** Draw a picture (video, image bitmap, canvas) at analysis size and return its pixels. */
export const toPixels = (source: CanvasImageSource, width: number, height: number): Pixels => {
  const scale = Math.min(1, ANALYSIS_WIDTH / width);
  work.width = Math.max(1, Math.round(width * scale));
  work.height = Math.max(1, Math.round(height * scale));
  workCtx.drawImage(source, 0, 0, work.width, work.height);
  const img = workCtx.getImageData(0, 0, work.width, work.height);
  return { data: img.data, width: img.width, height: img.height };
};

/** Slot boxes (in pixels) for a manual region. */
export const slotBoxes = (region: Region, count: number, gap: number, width: number, height: number): Box[] => {
  const slotW = region.w / (count + gap * (count - 1));
  return Array.from({ length: count }, (_, i) => ({
    x: Math.round((region.x + i * slotW * (1 + gap)) * width),
    y: Math.round(region.y * height),
    w: Math.max(1, Math.round(slotW * width)),
    h: Math.max(1, Math.round(region.h * height)),
  }));
};
