import { useEffect, useRef, useState } from 'react';
import { Capture, DEFAULT_LAYOUT, slotRects } from '../vision/capture.ts';
import type { Layout, Region } from '../vision/capture.ts';
import { readSlot, teachGlyph, DEFAULT_RECOGNIZER } from '../vision/recognize.ts';
import type { GlyphBook, Pixels, SlotReading } from '../vision/recognize.ts';
import { ScreenTracker } from '../vision/tracker.ts';
import type { TrackerEvent } from '../vision/tracker.ts';
import { bit, cardName } from '../engine/cards.ts';
import { load, save } from './storage.ts';

interface Props {
  hand: number;
  gone: number;
  onEvents: (events: TrackerEvent[]) => void;
}

interface VisionConfig {
  layout: Layout;
  book: GlyphBook;
}

const STORAGE = 'okey-v2-vision';
const MIN_CONFIDENCE = 0.35;
const PREVIEW_W = 480;

export const ScreenReader = ({ hand, gone, onEvents }: Props) => {
  const capture = useRef<Capture | null>(null);
  const tracker = useRef(new ScreenTracker(3));
  const preview = useRef<HTMLCanvasElement>(null);
  const slotPixels = useRef<Pixels[]>([]);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<VisionConfig>(() => load(STORAGE, { layout: DEFAULT_LAYOUT, book: {} }));
  const [mode, setMode] = useState<'idle' | 'hand' | 'field'>('idle');
  const [drag, setDrag] = useState<{ x: number; y: number; x2: number; y2: number } | null>(null);
  const [readings, setReadings] = useState<SlotReading[]>([]);
  const [follow, setFollow] = useState(true);
  const state = useRef({ hand, gone, follow, onEvents });
  state.current = { hand, gone, follow, onEvents };

  useEffect(() => save(STORAGE, config), [config]);

  const start = async () => {
    setError(null);
    try {
      const c = new Capture();
      await c.start(() => setActive(false));
      capture.current = c;
      tracker.current.reset();
      setActive(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const stop = () => {
    capture.current?.stop();
    setActive(false);
  };

  // Sample the shared window a few times per second.
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      const c = capture.current;
      const canvas = preview.current;
      if (!c || !c.grab() || !canvas) return;
      const frame = c.frameCanvas();
      canvas.width = PREVIEW_W;
      canvas.height = Math.round((frame.height / frame.width) * PREVIEW_W);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
      const { layout, book } = config;
      const regions: [Region | null, number][] = [[layout.hand, 5], [layout.field, 3]];
      const pixels: Pixels[] = [];
      ctx.lineWidth = 2;
      for (const [region, count] of regions) {
        if (!region) continue;
        pixels.push(...c.slots(region, count, layout.gap));
        ctx.strokeStyle = region === layout.hand ? '#4ade80' : '#60a5fa';
        for (const r of slotRects(region, count, layout.gap)) ctx.strokeRect(r.x * canvas.width, r.y * canvas.height, r.w * canvas.width, r.h * canvas.height);
      }
      slotPixels.current = pixels;
      const read = pixels.map(p => readSlot(p, book, DEFAULT_RECOGNIZER));
      setReadings(read);
      if (!layout.hand) return;
      // Only trust a frame if every slot is either empty or confidently read, with no duplicates.
      let visible: number | null = 0;
      for (const r of read) {
        if (r.empty) continue;
        if (r.card === null || r.confidence < MIN_CONFIDENCE || visible! & bit(r.card)) { visible = null; break; }
        visible = visible! | bit(r.card);
      }
      const s = state.current;
      if (!s.follow) {
        tracker.current.reset();
        return;
      }
      const events = tracker.current.observe(visible, s.hand, s.gone);
      if (events.length) s.onEvents(events);
    }, 250);
    return () => clearInterval(timer);
  }, [active, config]);

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

  const teach = (slot: number, number: number) => {
    const px = slotPixels.current[slot];
    const glyph = px && teachGlyph(px);
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
      const parsed = JSON.parse(await file.text()) as VisionConfig;
      if (parsed.layout && parsed.book) setConfig(parsed);
    } catch {
      setError('That file is not a screen setup export.');
    }
  };

  const taught = Object.keys(config.book).length;

  return (
    <section className="panel screen">
      <h2>Screen reading</h2>
      <p className="hint">
        Share the Metin 2 window in your browser's screen-share prompt. The helper only looks at the picture; it cannot click,
        type or read the game.
      </p>
      <div className="row">
        {!active ? (
          <button type="button" className="primary" onClick={start}>Share game window</button>
        ) : (
          <button type="button" onClick={stop}>Stop sharing</button>
        )}
        <button type="button" disabled={!active} className={mode === 'hand' ? 'on' : ''} onClick={() => setMode('hand')}>
          Mark hand (5 slots)
        </button>
        <button type="button" disabled={!active} className={mode === 'field' ? 'on' : ''} onClick={() => setMode('field')}>
          Mark field (3 slots)
        </button>
        <label className="check">
          <input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} /> Follow the game
        </label>
      </div>
      <div className="row">
        <label>
          Slot gap{' '}
          <input
            type="range" min={0} max={0.5} step={0.01} value={config.layout.gap}
            onChange={e => setConfig(c => ({ ...c, layout: { ...c.layout, gap: Number(e.target.value) } }))}
          />
        </label>
        <span className="hint">Numbers taught: {taught}/8</span>
        <button type="button" onClick={exportConfig}>Export setup</button>
        <label className="file">
          Import setup
          <input type="file" accept="application/json" onChange={e => e.target.files?.[0] && importConfig(e.target.files[0])} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {mode !== 'idle' && <p className="hint">Drag a box around the {mode === 'hand' ? 'five hand' : 'three field'} slots.</p>}
      {active && (
        <canvas
          ref={preview}
          className={`preview ${mode !== 'idle' ? 'drawing' : ''}`}
          onMouseDown={e => mode !== 'idle' && setDrag({ ...toFraction(e), x2: toFraction(e).x, y2: toFraction(e).y })}
          onMouseMove={e => drag && setDrag({ ...drag, x2: toFraction(e).x, y2: toFraction(e).y })}
          onMouseUp={finishDrag}
        />
      )}
      {readings.length > 0 && (
        <div className="slots">
          {readings.map((r, i) => (
            <div key={i} className={`slot ${r.empty ? 'empty' : r.card === null || r.confidence < MIN_CONFIDENCE ? 'unsure' : 'ok'}`}>
              <span>{i < 5 ? `Hand ${i + 1}` : `Field ${i - 4}`}</span>
              <b>{r.empty ? 'empty' : r.card !== null ? cardName(r.card) : r.color ? `${r.color} ?` : '?'}</b>
              {!r.empty && (
                <select value="" onChange={e => teach(i, Number(e.target.value))} title="Teach the number shown in this slot">
                  <option value="">teach…</option>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
