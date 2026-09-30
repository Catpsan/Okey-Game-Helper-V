import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Capture, DEFAULT_LAYOUT, toPixels, regionPixels, lastPicture } from '../vision/capture.ts';
import type { Layout, Region } from '../vision/capture.ts';
import type { Pixels } from '../vision/recognize.ts';
import { crop } from '../vision/detect.ts';
import { withDefaults } from '../vision/defaultGlyphs.ts';
import { CardMemory } from '../vision/learn.ts';
import type { Label, Sample } from '../vision/learn.ts';
import { readPicture, readCapture, visibleSet, isSure } from '../vision/reader.ts';
import { digitShape } from '../vision/okey.ts';
import type { DigitBook } from '../vision/okey.ts';
import type { Slot, SlotSource } from '../vision/reader.ts';
import { ScreenTracker, reconcile } from '../vision/tracker.ts';
import type { TrackerEvent } from '../vision/tracker.ts';
import { bit, cardName, cardsIn, FULL_MASK } from '../engine/cards.ts';
import type { Card } from '../engine/cards.ts';
import { load, save } from './storage.ts';

export interface ScreenReaderHandle {
  /** The player entered a card by hand: learn what it looks like on screen. */
  learnDraw: (card: Card, handBefore: number) => void;
}

interface Props {
  hand: number;
  gone: number;
  onEvents: (events: TrackerEvent[]) => void;
}

interface Settings {
  /** okey: find the cards in the Okey window automatically; box: marked box / snip of the hand. */
  mode: 'okey' | 'box';
  layout: Layout;
  auto: boolean;
  gap: number; // gap between cards in a snip of just the hand
}

const SETTINGS = 'okey-v2-screen';
const MEMORY = 'okey-v2-memory';
const DIGITS = 'okey-v2-digits';
const PREVIEW_W = 640;

export const ScreenReader = forwardRef<ScreenReaderHandle, Props>(({ hand, gone, onEvents }, ref) => {
  const capture = useRef<Capture | null>(null);
  const tracker = useRef(new ScreenTracker(3));
  const preview = useRef<HTMLCanvasElement>(null);
  const lastPx = useRef<Pixels | null>(null);
  const lastSlots = useRef<Slot[]>([]);
  const pastedImage = useRef<ImageBitmap | null>(null);
  const memory = useRef(new CardMemory(load<{ samples: Sample[] }>(MEMORY, { samples: [] }).samples));
  const digits = useRef<DigitBook>(load<{ book: DigitBook }>(DIGITS, { book: {} }).book);
  const [settings, setSettings] = useState<Settings>(() => load(SETTINGS, { mode: 'okey', layout: DEFAULT_LAYOUT, auto: false, gap: 0.08 }));
  const [live, setLive] = useState(false);
  const [source, setSource] = useState<'none' | 'live' | 'paste'>('none');
  const [open, setOpen] = useState(false);
  const [marking, setMarking] = useState<'hand' | 'field' | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; x2: number; y2: number } | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [learned, setLearned] = useState(memory.current.known().size);
  const [status, setStatus] = useState<string | null>(null);
  const state = useRef({ hand, gone, onEvents, settings });
  state.current = { hand, gone, onEvents, settings };

  useEffect(() => save(SETTINGS, settings), [settings]);

  const persistMemory = () => {
    save(MEMORY, { samples: memory.current.samples });
    save(DIGITS, { book: digits.current });
    setLearned(memory.current.known().size);
  };

  /** Remember what a slot looks like as `label`. */
  const learnSlot = (px: Pixels, slot: Slot, label: Label) => {
    const face = crop(px, slot.box);
    if (state.current.settings.mode === 'okey') {
      const shape = label !== 'empty' ? digitShape(face) : null;
      if (shape) {
        const n = String((label as number) % 8 + 1);
        digits.current = { ...digits.current, [n]: [...(digits.current[n] ?? []), shape.glyph].slice(-4) };
      }
    } else memory.current.learn(face, label);
  };

  /** Read a full picture (live frame or pasted image). */
  const readSource = (src: CanvasImageSource, w: number, h: number, kind: 'live' | 'paste'): { px: Pixels; list: Slot[] } => {
    if (state.current.settings.mode === 'okey') {
      const r = readCapture(src, w, h, digits.current, (sx, sy, sw, sh, maxW) => regionPixels(src, sx, sy, sw, sh, maxW));
      return { px: r.px, list: r.slots };
    }
    const px = toPixels(src, w, h);
    return { px, list: analyse(px, kind) ?? [] };
  };

  const slotSource = (kind: 'live' | 'paste'): SlotSource | null => {
    const s = state.current.settings;
    if (s.auto) return { kind: 'auto' };
    if (kind === 'paste') return { kind: 'whole', count: 5, gap: s.gap };
    return s.layout.hand ? { kind: 'layout', layout: s.layout } : null;
  };

  const drawPreview = useCallback((src: CanvasImageSource, w: number, h: number, list: Slot[], px: Pixels) => {
    const canvas = preview.current;
    if (!canvas) return;
    canvas.width = PREVIEW_W;
    canvas.height = Math.round((h / w) * PREVIEW_W);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    const k = canvas.width / px.width;
    ctx.lineWidth = 2;
    ctx.font = '600 12px system-ui';
    list.forEach((s, i) => {
      ctx.strokeStyle = isSure(s) ? '#4ade80' : '#f59e0b';
      ctx.strokeRect(s.box.x * k, s.box.y * k, s.box.w * k, s.box.h * k);
      ctx.fillStyle = ctx.strokeStyle;
      const label = s.reading.empty ? '–' : s.reading.card !== null ? cardName(s.reading.card) : '?';
      ctx.fillText(`${i + 1} ${label}`, s.box.x * k + 2, Math.max(12, s.box.y * k - 4));
    });
  }, []);

  const analyse = (px: Pixels, kind: 'live' | 'paste'): Slot[] | null => {
    const src = slotSource(kind);
    if (!src) return null;
    return readPicture(px, src, memory.current, withDefaults({}));
  };

  // A pasted snip may come several moves later, so it is reconciled rather than diffed.
  const readPasted = useCallback((bitmap: ImageBitmap) => {
    const { px, list } = readSource(bitmap, bitmap.width, bitmap.height, 'paste');
    lastPx.current = px;
    lastSlots.current = list;
    setSlots(list);
    drawPreview(lastPicture(), px.width, px.height, list, px);
    const visible = visibleSet(list);
    if (visible === null) {
      setStatus('Some cards are unclear (orange). Click the right card under each one, or add it on the grid below.');
      setOpen(true);
      return;
    }
    setStatus(`Read ${cardsIn(visible).length} cards from your snip.`);
    const s = state.current;
    const events = reconcile(visible, s.hand, s.gone);
    if (events.length) s.onEvents(events);
  }, [drawPreview]);

  // Ctrl+V (after Win+Shift+S) or dropping an image anywhere on the page.
  useEffect(() => {
    const take = async (file: File | null | undefined) => {
      if (!file || !file.type.startsWith('image/')) return;
      const bitmap = await createImageBitmap(file);
      pastedImage.current = bitmap;
      setSource('paste');
      requestAnimationFrame(() => readPasted(bitmap));
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
  }, [readPasted]);

  const startLive = async () => {
    setStatus(null);
    try {
      const c = new Capture();
      await c.start(() => {
        setLive(false);
        setSource(s => (s === 'live' ? 'none' : s));
      });
      capture.current = c;
      tracker.current.reset();
      setLive(true);
      setSource('live');
      if (state.current.settings.mode === 'box' && !state.current.settings.layout.hand && !state.current.settings.auto) {
        setOpen(true);
        setMarking('hand');
      }
    } catch (e) {
      setStatus(e instanceof Error && e.name === 'NotAllowedError' ? 'Screen sharing was cancelled.' : String(e));
    }
  };

  const stopLive = () => {
    capture.current?.stop();
    setLive(false);
    setSource('none');
  };

  useEffect(() => {
    if (!live || source !== 'live') return;
    const timer = setInterval(() => {
      const c = capture.current;
      if (!c?.ready) return;
      const { videoWidth: w, videoHeight: h } = c.video;
      const { px, list } = readSource(c.video, w, h, 'live');
      lastPx.current = px;
      lastSlots.current = list;
      setSlots(list);
      drawPreview(lastPicture(), px.width, px.height, list, px);
      if (!list.length) return;
      const s = state.current;
      const events = tracker.current.observe(visibleSet(list), s.hand, s.gone);
      if (events.length) s.onEvents(events);
    }, 250);
    return () => clearInterval(timer);
  }, [live, source, drawPreview]);

  const teach = (index: number, label: Label) => {
    const px = lastPx.current, slot = lastSlots.current[index];
    if (!px || !slot) return;
    learnSlot(px, slot, label);
    persistMemory();
    if (source === 'paste' && pastedImage.current) readPasted(pastedImage.current);
  };

  useImperativeHandle(ref, () => ({
    learnDraw: (card, handBefore) => {
      const px = lastPx.current;
      if (!px || source === 'none') return;
      // The slot showing this card is the first one that isn't empty and isn't already
      // accounted for by a card in hand.
      const slot = lastSlots.current.find(
        s => !(s.reading.empty && isSure(s)) && !(s.reading.card !== null && isSure(s) && handBefore & bit(s.reading.card)),
      );
      if (!slot) return;
      learnSlot(px, slot, card);
      // Mark the slot as known so the next card entered goes to the next slot.
      slot.reading = { card, empty: false, color: null, number: null, confidence: 1 };
      setSlots([...lastSlots.current]);
      persistMemory();
    },
  }), [source]);

  const toFraction = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const finishDrag = () => {
    if (!drag || !marking) return;
    const region: Region = { x: Math.min(drag.x, drag.x2), y: Math.min(drag.y, drag.y2), w: Math.abs(drag.x2 - drag.x), h: Math.abs(drag.y2 - drag.y) };
    if (region.w > 0.01 && region.h > 0.01) setSettings(s => ({ ...s, auto: false, layout: { ...s.layout, [marking]: region } }));
    setDrag(null);
    setMarking(null);
  };

  const sure = slots.filter(isSure).length;
  const cards = slots.filter(s => !s.reading.empty && s.reading.card !== null && isSure(s)).length;
  const summary =
    source === 'none' ? null
      : !slots.length ? (settings.mode === 'okey' ? 'Looking for the Okey window…' : source === 'live' ? 'Drag a box around your 5 hand cards' : 'Nothing read')
      : sure === slots.length ? `Reading ${cards} card${cards === 1 ? '' : 's'}`
      : `${slots.length - sure} unclear`;

  return (
    <section className="reader">
      <div className="reader-bar">
        {source === 'none' ? (
          <>
            <button type="button" className="primary" onClick={startLive}>Share game window</button>
            <span className="muted">or snip the Okey window (<kbd>Win</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>) and <kbd>Ctrl</kbd>+<kbd>V</kbd></span>
          </>
        ) : (
          <>
            <span className={`dot ${sure === slots.length && slots.length ? 'ok' : 'warn'}`} />
            <span>{summary}</span>
            {live ? <button type="button" onClick={stopLive}>Stop</button> : <button type="button" onClick={startLive}>Share window</button>}
          </>
        )}
        <button type="button" className="link" onClick={() => setOpen(o => !o)}>{open ? 'Hide setup' : 'Setup'}</button>
      </div>
      {status && <p className="muted small">{status}</p>}

      <div hidden={!open} className="setup">
        {marking && <p className="small"><b>Drag a box</b> around the {marking === 'hand' ? '5 hand cards' : '3 field slots'} in the picture.</p>}
        <canvas
          ref={preview}
          hidden={source === 'none'}
          className={`preview ${marking ? 'drawing' : ''}`}
          onMouseDown={e => marking && setDrag({ ...toFraction(e), x2: toFraction(e).x, y2: toFraction(e).y })}
          onMouseMove={e => drag && setDrag({ ...drag, x2: toFraction(e).x, y2: toFraction(e).y })}
          onMouseUp={finishDrag}
        />
        {source === 'none' && <p className="muted small">Share the game window or paste a snip to set up reading.</p>}

        {slots.length > 0 && (
          <div className="teach">
            {slots.map((s, i) => (
              <label key={i} className={isSure(s) ? 'ok' : 'warn'}>
                <span>{i + 1}</span>
                <select
                  value={s.reading.empty ? 'empty' : s.reading.card ?? ''}
                  onChange={e => teach(i, e.target.value === 'empty' ? 'empty' : Number(e.target.value))}
                  title="Pick what this card really is; the helper learns it"
                >
                  <option value="" disabled>?</option>
                  <option value="empty">empty</option>
                  {cardsIn(FULL_MASK).map(c => <option key={c} value={c}>{cardName(c)}</option>)}
                </select>
              </label>
            ))}
          </div>
        )}

        <div className="row small">
          <select value={settings.mode} onChange={e => setSettings(s => ({ ...s, mode: e.target.value as Settings['mode'] }))}>
            <option value="okey">Find cards in the Okey window</option>
            <option value="box">Marked box / snip of the hand</option>
          </select>
          {live && settings.mode === 'box' && <button type="button" onClick={() => setMarking('hand')}>Mark hand</button>}
          {live && settings.mode === 'box' && <button type="button" onClick={() => setMarking('field')}>Mark field</button>}
          {settings.mode === 'box' && <label className="inline">
            Gap
            <input
              type="range" min={0} max={0.5} step={0.01}
              value={source === 'paste' ? settings.gap : settings.layout.gap}
              onChange={e => {
                const v = Number(e.target.value);
                setSettings(s => (source === 'paste' ? { ...s, gap: v } : { ...s, layout: { ...s.layout, gap: v } }));
                if (source === 'paste' && pastedImage.current) readPasted(pastedImage.current);
              }}
            />
          </label>}
          {source === 'paste' && pastedImage.current && <button type="button" onClick={() => readPasted(pastedImage.current!)}>Read again</button>}
        </div>
        <p className="muted small">
          {settings.mode === 'okey'
            ? 'Reads the cards in the Okey window by itself. If a card is read wrong, pick the right one above once and it learns that number.'
            : `Learned ${learned}/24 cards. When a card is unclear, pick it above or add it on the card grid: the helper remembers how it looks.`}{' '}
          <button type="button" className="link" onClick={() => { memory.current = new CardMemory(); digits.current = {}; persistMemory(); }}>Forget learned cards</button>
        </p>
      </div>
    </section>
  );
});
