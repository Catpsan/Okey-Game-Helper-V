import { useCallback, useEffect, useRef, useState } from 'react';
import { Capture, DEFAULT_LAYOUT, toPixels, slotBoxes } from '../vision/capture.ts';
import type { Layout, Region } from '../vision/capture.ts';
import { readSlot, teachGlyph } from '../vision/recognize.ts';
import type { GlyphBook, Pixels, SlotReading } from '../vision/recognize.ts';
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
}

const STORAGE = 'okey-v2-vision';
const MIN_CONFIDENCE = 0.35;
const PREVIEW_W = 560;

/** Read every card in a picture: automatic detection, or the manual slots. */
const analyse = (px: Pixels, config: VisionConfig): Seen[] => {
  const book = withDefaults(config.book);
  if (config.auto) {
    const found = detectCards(px, book, undefined, MIN_CONFIDENCE);
    if (found.length) return found;
    // Nothing recognised yet (e.g. before teaching): show candidates so they can be taught.
    return candidateBoxes(px).map(box => ({ box, reading: readSlot(crop(px, box), book) }));
  }
  const { hand, field, gap } = config.layout;
  const boxes = [
    ...(hand ? slotBoxes(hand, 5, gap, px.width, px.height) : []),
    ...(field ? slotBoxes(field, 3, gap, px.width, px.height) : []),
  ];
  return boxes.map(box => ({ box, reading: readSlot(crop(px, box), book) }));
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
  const draw = useCallback((src: CanvasImageSource, w: number, h: number, list: Seen[], px: Pixels) => {
    const canvas = preview.current;
    if (!canvas) return;
    canvas.width = PREVIEW_W;
    canvas.height = Math.round((h / w) * PREVIEW_W);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    const k = canvas.width / px.width;
    ctx.lineWidth = 2;
    ctx.font = '12px system-ui';
    for (const { box, reading } of list) {
      const ok = reading.empty || (reading.card !== null && reading.confidence >= MIN_CONFIDENCE);
      ctx.strokeStyle = ok ? '#4ade80' : '#f59e0b';
      ctx.strokeRect(box.x * k, box.y * k, box.w * k, box.h * k);
      if (reading.card !== null) {
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fillText(cardName(reading.card), box.x * k, Math.max(10, box.y * k - 3));
      }
    }
  }, []);

  /** Analyse a pasted screenshot and bring the game in line with it. */
  const readPicture = useCallback((bitmap: ImageBitmap) => {
    const px = toPixels(bitmap, bitmap.width, bitmap.height);
    const list = analyse(px, state.current.config);
    lastPx.current = px;
    setSeen(list);
    draw(bitmap, bitmap.width, bitmap.height, list, px);
    const visible = visibleSet(list);
    const cards = list.filter(s => s.reading.card !== null).length;
    if (visible === null || cards === 0) {
      setMessage(
        cards === 0
          ? 'No cards found in that picture. Snip the Okey window with the cards visible, or teach the numbers below.'
          : 'Some cards could not be read (orange boxes). Teach their numbers below, then press Read again.',
      );
      return;
    }
    setMessage(`Read ${cards} card${cards === 1 ? '' : 's'} from the screenshot.`);
    const s = state.current;
    const events = reconcile(visible, s.hand, s.gone);
    if (events.length) s.onEvents(events, 'paste');
  }, [draw]);

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
      const px = toPixels(c.video, w, h);
      const s = state.current;
      const list = analyse(px, s.config);
      lastPx.current = px;
      setSeen(list);
      draw(c.video, w, h, list, px);
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
    const glyph = px && item && teachGlyph(crop(px, item.box));
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

  return (
    <section className="panel screen">
      <h2>Screen reading</h2>
      {source === 'none' && (
        <div className="start">
          <button type="button" className="primary big" onClick={start}>Share game window</button>
          <p>
            or press <kbd>Win</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd>, snip the Okey window, then <kbd>Ctrl</kbd> + <kbd>V</kbd> here.
          </p>
          <p className="hint">
            Browsers only allow screen sharing after you click, so this one click is needed each time the page opens.
            The helper only looks at the picture: it cannot click, type or read the game.
          </p>
        </div>
      )}
      <div className="row">
        {active && <button type="button" onClick={stop}>Stop sharing</button>}
        {source === 'paste' && pasted.current && (
          <button type="button" onClick={() => pasted.current && readPicture(pasted.current)}>Read again</button>
        )}
        {source === 'paste' && !active && <button type="button" onClick={start}>Share game window instead</button>}
        <label className="check">
          <input type="checkbox" checked={config.auto} onChange={e => setConfig(c => ({ ...c, auto: e.target.checked }))} /> Find cards automatically
        </label>
        {active && (
          <label className="check">
            <input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} /> Follow the game
          </label>
        )}
      </div>
      {!config.auto && showCanvas && (
        <div className="row">
          <button type="button" className={mode === 'hand' ? 'on' : ''} onClick={() => setMode('hand')}>Mark hand (5 slots)</button>
          <button type="button" className={mode === 'field' ? 'on' : ''} onClick={() => setMode('field')}>Mark field (3 slots)</button>
          <label>
            Slot gap{' '}
            <input
              type="range" min={0} max={0.5} step={0.01} value={config.layout.gap}
              onChange={e => setConfig(c => ({ ...c, layout: { ...c.layout, gap: Number(e.target.value) } }))}
            />
          </label>
        </div>
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
        <div className="slots">
          {seen.map(({ reading: r }, i) => (
            <div key={i} className={`slot ${r.empty ? 'empty' : r.card === null || r.confidence < MIN_CONFIDENCE ? 'unsure' : 'ok'}`}>
              <span>Card {i + 1}</span>
              <b>{r.empty ? 'empty' : r.card !== null ? cardName(r.card) : r.color ? `${r.color} ?` : '?'}</b>
              {!r.empty && (
                <select value="" onChange={e => teach(i, Number(e.target.value))} title="Teach the number shown here">
                  <option value="">teach…</option>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="row small">
        <span className="hint">Numbers taught: {taught}/8 (built-in shapes are used until then)</span>
        <button type="button" onClick={exportConfig}>Export setup</button>
        <label className="file">
          Import setup
          <input type="file" accept="application/json" onChange={e => e.target.files?.[0] && importConfig(e.target.files[0])} />
        </label>
      </div>
    </section>
  );
};
