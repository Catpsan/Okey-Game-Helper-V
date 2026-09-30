import { useCallback, useEffect, useRef, useState } from 'react';
import { Capture, DEFAULT_LAYOUT, ANALYSIS_WIDTH, toPixels, slotBoxes } from '../vision/capture.ts';
import type { Layout, Region } from '../vision/capture.ts';
import { readSlot, teachGlyph, DEFAULT_RECOGNIZER } from '../vision/recognize.ts';
import type { GlyphBook, Pixels, RecognizerSettings, SlotReading } from '../vision/recognize.ts';
import { detectCards, candidateBoxes, crop } from '../vision/detect.ts';
import type { Box } from '../vision/detect.ts';
import { withDefaults } from '../vision/defaultGlyphs.ts';
import { ScreenTracker, reconcile } from '../vision/tracker.ts';
import type { TrackerEvent } from '../vision/tracker.ts';
import { bit, cardName } from '../engine/cards.ts';
import { load, save } from './storage.ts';

interface Props {
  hand: number;
  gone: number;
  onEvents: (events: TrackerEvent[], source: 'live' | 'paste') => void;
}

interface VisionConfig {
  auto: boolean;
  layout: Layout;
  book: GlyphBook;
}

interface Seen {
  box: Box;
  reading: SlotReading;
  settings: RecognizerSettings;
}

const STORAGE = 'okey-v2-vision';
const shortName = (card: number) => cardName(card).replace(/^(\w)\w* /,(_, c: string) => c.toUpperCase());
const MIN_CONFIDENCE = 0.35;
const PREVIEW_W = 640;

/** Read every card in a picture: automatic detection, or the manual slots. */
const analyse = (px: Pixels, config: VisionConfig): Seen[] => {
  const book = withDefaults(config.book);
  if (config.auto) {
    const found = detectCards(px, book, undefined, MIN_CONFIDENCE);
    if (found.length) return found;
    // Nothing recognised yet (e.g. before teaching): show candidates so they can be taught.
    return candidateBoxes(px).map(({ box, settings }) => ({ box, settings, reading: readSlot(crop(px, box), book, settings) }));
  }
  const { hand, field, gap } = config.layout;
  const boxes = [
    ...(hand ? slotBoxes(hand, 5, gap, px.width, px.height) : []),
    ...(field ? slotBoxes(field, 3, gap, px.width, px.height) : []),
  ];
  return boxes.map(box => ({ box, settings: DEFAULT_RECOGNIZER, reading: readSlot(crop(px, box), book) }));
};

const confident = (list: Seen[]) => list.some(x => x.reading.card !== null && x.reading.confidence >= MIN_CONFIDENCE);

/**
 * The part of the source picture around the cards found in `px` (which shows `rect` of it),
 * roomy enough for the whole Okey window: the hand, the field below it and every hand slot.
 */
const focusAround = (list: Seen[], px: Pixels, rect: Box, w: number, h: number): Box | null => {
  if (list.length === 0) return null;
  const k = rect.w / px.width;
  const x0 = Math.min(...list.map(s => s.box.x)), y0 = Math.min(...list.map(s => s.box.y));
  const x1 = Math.max(...list.map(s => s.box.x + s.box.w)), y1 = Math.max(...list.map(s => s.box.y + s.box.h));
  const ch = Math.max(...list.map(s => s.box.h)) * k, cw = Math.max(...list.map(s => s.box.w)) * k;
  const cx = rect.x + ((x0 + x1) / 2) * k;
  const half = Math.max(((x1 - x0) * k) / 2 + 1.5 * cw, 4.5 * cw);
  const left = Math.max(0, Math.round(cx - half)), right = Math.min(w, Math.round(cx + half));
  const top = Math.max(0, Math.round(rect.y + y0 * k - 1.5 * ch)), bottom = Math.min(h, Math.round(rect.y + y1 * k + 3.5 * ch));
  return right > left && bottom > top ? { x: left, y: top, w: right - left, h: bottom - top } : null;
};

const union = (a: Box | null, b: Box | null): Box | null => {
  if (!a || !b) return a ?? b;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

/** Overlapping full-resolution tiles covering a big picture; the Okey window fits inside one. */
const tiles = (w: number, h: number): Box[] => {
  const tw = Math.min(w, ANALYSIS_WIDTH), th = Math.min(h, Math.round((ANALYSIS_WIDTH * 9) / 16));
  const starts = (size: number, t: number) => {
    const out: number[] = [];
    for (let v = 0; v < size - t; v += Math.round(t * 0.6)) out.push(v);
    out.push(size - t);
    return out;
  };
  return starts(h, th).flatMap(y => starts(w, tw).map(x => ({ x, y, w: tw, h: th })));
};

/**
 * Read a picture. With `focus`, only that part is read (at full resolution). Without it, a
 * big picture (e.g. a 4K screen) is first scaled down to find the cards, and if that fails,
 * searched tile by tile at full resolution (`tile` picks one tile; by default all are tried).
 * Once found, the area around the cards is read at full resolution so small cards stay sharp.
 */
const readFrame = (src: CanvasImageSource, w: number, h: number, config: VisionConfig, focus: Box | null, tile?: number) => {
  const rect = config.auto && focus ? focus : { x: 0, y: 0, w, h };
  const px = toPixels(src, w, h, rect);
  const list = analyse(px, config);
  if (!config.auto || focus || w <= ANALYSIS_WIDTH || (confident(list) && px.width === w)) return { px, list, rect };
  const zoomIn = (found: Seen[], fpx: Pixels, frect: Box) => {
    const zoom = focusAround(found, fpx, frect, w, h);
    if (!zoom) return null;
    const px2 = toPixels(src, w, h, zoom);
    const list2 = analyse(px2, config);
    return confident(list2) ? { px: px2, list: list2, rect: zoom } : null;
  };
  const first = zoomIn(list, px, rect);
  if (first) return first;
  const all = tiles(w, h);
  for (const t of tile === undefined ? all : [all[tile % all.length]]) {
    const tpx = toPixels(src, w, h, t);
    const found = analyse(tpx, config);
    if (confident(found)) return zoomIn(found, tpx, t) ?? { px: tpx, list: found, rect: t };
  }
  return { px, list, rect };
};

/** The set of visible cards, or null if anything is unreadable or duplicated. */
const visibleSet = (seen: Seen[]): number | null => {
  let visible = 0;
  for (const { reading: r } of seen) {
    if (r.empty) continue;
    if (r.card === null || r.confidence < MIN_CONFIDENCE || visible & bit(r.card)) return null;
    visible |= bit(r.card);
  }
  return visible;
};

export const ScreenReader = ({ hand, gone, onEvents }: Props) => {
  const capture = useRef<Capture | null>(null);
  const tracker = useRef(new ScreenTracker(3));
  const preview = useRef<HTMLCanvasElement>(null);
  const lastPx = useRef<Pixels | null>(null);
  const pasted = useRef<ImageBitmap | null>(null);
  const focus = useRef<Box | null>(null);
  const misses = useRef(0);
  const searchTile = useRef(0);
  const [active, setActive] = useState(false);
  const [source, setSource] = useState<'none' | 'live' | 'paste'>('none');
  const [message, setMessage] = useState<string | null>(null);
  const [config, setConfig] = useState<VisionConfig>(() => load(STORAGE, { auto: true, layout: DEFAULT_LAYOUT, book: {} }));
  const [mode, setMode] = useState<'idle' | 'hand' | 'field'>('idle');
  const [drag, setDrag] = useState<{ x: number; y: number; x2: number; y2: number } | null>(null);
  const [seen, setSeen] = useState<Seen[]>([]);
  const [follow, setFollow] = useState(true);
  const state = useRef({ hand, gone, follow, onEvents, config });
  state.current = { hand, gone, follow, onEvents, config };

  useEffect(() => save(STORAGE, config), [config]);

  /** Draw the picture and the boxes on the preview canvas. */
  const draw = useCallback((src: CanvasImageSource, rect: Box, list: Seen[], px: Pixels) => {
    const canvas = preview.current;
    if (!canvas) return;
    canvas.width = PREVIEW_W;
    canvas.height = Math.round((rect.h / rect.w) * PREVIEW_W);
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = rect.w < PREVIEW_W ? false : true;
    ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height);
    const k = canvas.width / px.width;
    ctx.lineWidth = 2;
    ctx.font = '12px system-ui';
    for (const { box, reading } of list) {
      const ok = reading.empty || (reading.card !== null && reading.confidence >= MIN_CONFIDENCE);
      ctx.strokeStyle = ok ? '#4ade80' : '#f59e0b';
      ctx.strokeRect(box.x * k, box.y * k, box.w * k, box.h * k);
      if (reading.card !== null) {
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fillText(shortName(reading.card), box.x * k, Math.max(10, box.y * k - 3));
      }
    }
  }, []);

  /** Analyse a pasted screenshot and bring the game in line with it. */
  const readPicture = useCallback((bitmap: ImageBitmap) => {
    const { px, list, rect } = readFrame(bitmap, bitmap.width, bitmap.height, state.current.config, null);
    lastPx.current = px;
    setSeen(list);
    draw(bitmap, rect, list, px);
    const visible = visibleSet(list);
    const cards = list.filter(s => s.reading.card !== null).length;
    if (visible === null || cards === 0) {
      setMessage(
        cards === 0
          ? 'No cards found in that picture. Snip the Okey window with your cards visible.'
          : 'Some cards could not be read (orange). Use fix to pick their numbers.',
      );
      return;
    }
    setMessage(null);
    const s = state.current;
    const events = reconcile(visible, s.hand, s.gone);
    if (events.length) s.onEvents(events, 'paste');
  }, [draw]);

  const readPictureRef = useRef(readPicture);
  readPictureRef.current = readPicture;

  // After teaching a number, read the pasted screenshot again straight away.
  useEffect(() => {
    if (source === 'paste' && pasted.current) readPictureRef.current(pasted.current);
  }, [config.book]);

  // Ctrl+V anywhere in the app (e.g. right after Win+Shift+S), or drop an image file.
  useEffect(() => {
    const take = async (file: File | null | undefined) => {
      if (!file || !file.type.startsWith('image/')) return false;
      const bitmap = await createImageBitmap(file);
      pasted.current = bitmap;
      setSource('paste');
      requestAnimationFrame(() => readPicture(bitmap));
      return true;
    };
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find(i => i.type.startsWith('image/'));
      if (item) {
        e.preventDefault();
        void take(item.getAsFile());
      }
    };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      void take(e.dataTransfer?.files?.[0]);
    };
    window.addEventListener('paste', onPaste);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [readPicture]);

  const start = async () => {
    setMessage(null);
    try {
      const c = new Capture();
      await c.start(() => {
        setActive(false);
        setSource(s => (s === 'live' ? 'none' : s));
      });
      capture.current = c;
      tracker.current.reset();
      focus.current = null;
      setActive(true);
      setSource('live');
    } catch (e) {
      setMessage(e instanceof Error && e.name === 'NotAllowedError' ? 'Screen sharing was cancelled.' : String(e));
    }
  };

  const stop = () => {
    capture.current?.stop();
    setActive(false);
    setSource('none');
  };

  // Live: sample the shared window a few times per second.
  useEffect(() => {
    if (!active || source !== 'live') return;
    const timer = setInterval(() => {
      const c = capture.current;
      if (!c?.ready) return;
      const { videoWidth: w, videoHeight: h } = c.video;
      const s = state.current;
      const { px, list, rect } = readFrame(c.video, w, h, s.config, focus.current, searchTile.current++);
      // Stay zoomed on the Okey window once the cards are found; search the whole picture
      // again if they can't be read for a while (window moved or covered).
      if (s.config.auto && confident(list)) {
        focus.current = union(focus.current, focusAround(list, px, rect, w, h));
        misses.current = 0;
      } else if (++misses.current >= 8) {
        focus.current = null;
        misses.current = 0;
      }
      lastPx.current = px;
      setSeen(list);
      draw(c.video, rect, list, px);
      if (!s.follow) {
        tracker.current.reset();
        return;
      }
      const visible = list.some(x => x.reading.card !== null) ? visibleSet(list) : null;
      const events = tracker.current.observe(visible, s.hand, s.gone);
      if (events.length) s.onEvents(events, 'live');
    }, 250);
    return () => clearInterval(timer);
  }, [active, source, draw]);

  const toFraction = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  };

  const finishDrag = () => {
    if (!drag || mode === 'idle') return;
    const region: Region = {
      x: Math.min(drag.x, drag.x2),
      y: Math.min(drag.y, drag.y2),
      w: Math.abs(drag.x2 - drag.x),
      h: Math.abs(drag.y2 - drag.y),
    };
    if (region.w > 0.01 && region.h > 0.01) setConfig(c => ({ ...c, layout: { ...c.layout, [mode]: region } }));
    setDrag(null);
    setMode('idle');
  };

  const teach = (index: number, number: number) => {
    const px = lastPx.current;
    const item = seen[index];
    const glyph = px && item && teachGlyph(crop(px, item.box), item.settings);
    if (!glyph) return;
    setConfig(c => ({ ...c, book: { ...c.book, [number]: [...(c.book[number] ?? []), glyph].slice(-5) } }));
  };

  const exportConfig = () => {
    const blob = new Blob([JSON.stringify(config)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'okey-helper-screen-setup.json';
    a.click();
  };

  const importConfig = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as Partial<VisionConfig>;
      if (parsed.book) setConfig(c => ({ ...c, ...parsed }));
    } catch {
      setMessage('That file is not a screen setup export.');
    }
  };

  const taught = Object.keys(config.book).length;
  const showCanvas = source !== 'none';
  const read = seen.filter(x => x.reading.card !== null && x.reading.confidence >= MIN_CONFIDENCE).length;
  const unsure = seen.filter(x => !x.reading.empty && (x.reading.card === null || x.reading.confidence < MIN_CONFIDENCE)).length;
  const status = source === 'none' ? null : unsure ? `${read} read · ${unsure} unsure` : `${read} card${read === 1 ? '' : 's'} read`;

  return (
    <section className="panel screen">
      <div className="screen-bar">
        <span className={`dot ${active ? 'live' : source === 'paste' ? 'paste' : ''}`} />
        <span className="bar-title">{active ? 'Watching the game' : source === 'paste' ? 'Screenshot' : 'Screen'}</span>
        {status && <span className="muted">{status}</span>}
        <span className="grow" />
        {source === 'paste' && pasted.current && (
          <button type="button" className="ghost" onClick={() => pasted.current && readPicture(pasted.current)}>Read again</button>
        )}
        {active ? (
          <button type="button" className="ghost" onClick={stop}>Stop</button>
        ) : (
          <button type="button" className="primary" onClick={start}>Share game window</button>
        )}
      </div>
      {source === 'none' && (
        <p className="hint">
          Or snip the Okey window (<kbd>Win</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>) and press <kbd>Ctrl</kbd>+<kbd>V</kbd> here.
        </p>
      )}
      {message && <p className="hint strong">{message}</p>}
      {mode !== 'idle' && <p className="hint">Drag a box around the {mode === 'hand' ? 'five hand' : 'three field'} slots.</p>}
      <canvas
        ref={preview}
        hidden={!showCanvas}
        className={`preview ${mode !== 'idle' ? 'drawing' : ''}`}
        onMouseDown={e => mode !== 'idle' && setDrag({ ...toFraction(e), x2: toFraction(e).x, y2: toFraction(e).y })}
        onMouseMove={e => drag && setDrag({ ...drag, x2: toFraction(e).x, y2: toFraction(e).y })}
        onMouseUp={finishDrag}
      />
      {seen.length > 0 && showCanvas && (
        <div className="chips">
          {seen.map(({ reading: r }, i) => {
            const ok = r.card !== null && r.confidence >= MIN_CONFIDENCE;
            if (r.empty) return null;
            return (
              <label key={i} className={`chip ${ok ? 'ok' : 'unsure'}`} title="Wrong? Pick the number shown on this card to teach it">
                <b>{r.card !== null ? shortName(r.card) : r.color ? `${r.color[0].toUpperCase()}?` : '?'}</b>
                <select value="" onChange={e => teach(i, Number(e.target.value))} aria-label={`Teach card ${i + 1}`}>
                  <option value="">fix</option>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            );
          })}
        </div>
      )}
      {unsure > 0 && <p className="hint">Orange = not sure. Use <b>fix</b> to pick the number on that card once; it learns the game's font.</p>}
      <details className="settings">
        <summary>Reading settings</summary>
        <div className="row">
          <label className="check">
            <input type="checkbox" checked={config.auto} onChange={e => setConfig(c => ({ ...c, auto: e.target.checked }))} /> Find cards automatically
          </label>
          <label className="check">
            <input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} /> Follow the game
          </label>
        </div>
        {!config.auto && (
          <div className="row">
            <button type="button" className={mode === 'hand' ? 'on' : ''} onClick={() => setMode('hand')} disabled={!showCanvas}>Mark hand (5)</button>
            <button type="button" className={mode === 'field' ? 'on' : ''} onClick={() => setMode('field')} disabled={!showCanvas}>Mark field (3)</button>
            <label>
              Gap{' '}
              <input
                type="range" min={0} max={0.5} step={0.01} value={config.layout.gap}
                onChange={e => setConfig(c => ({ ...c, layout: { ...c.layout, gap: Number(e.target.value) } }))}
              />
            </label>
          </div>
        )}
        <div className="row">
          <span className="muted">Numbers taught: {taught}/8</span>
          <button type="button" className="ghost" onClick={() => setConfig(c => ({ ...c, book: {} }))} disabled={taught === 0}>Forget</button>
          <button type="button" className="ghost" onClick={exportConfig}>Export</button>
          <label className="file ghost">
            Import
            <input type="file" accept="application/json" onChange={e => e.target.files?.[0] && importConfig(e.target.files[0])} />
          </label>
        </div>
      </details>
    </section>
  );
};
