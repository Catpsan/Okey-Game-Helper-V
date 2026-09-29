import { useEffect, useRef, useState } from 'react';
import { cardsIn, bit, popcount, HAND_SIZE } from './engine/cards.ts';
import type { Card } from './engine/cards.ts';
import { newGame, draw, discard, play, markGone, restore, needsDraw, unseenOf, isOver } from './engine/game.ts';
import type { GameState } from './engine/game.ts';
import type { Goal } from './engine/advisor.ts';
import type { Action } from './engine/solver.ts';
import { chestFor } from './engine/scoring.ts';
import type { TrackerEvent } from './vision/tracker.ts';
import type { AnalyzeRequest, AnalyzeResponse } from './worker/advisor.worker.ts';
import { CardView } from './ui/CardView.tsx';
import { DeckTracker } from './ui/DeckTracker.tsx';
import { AdvicePanel } from './ui/AdvicePanel.tsx';
import { ForecastPanel } from './ui/ForecastPanel.tsx';
import { ScreenReader } from './ui/ScreenReader.tsx';
import { load, save } from './ui/storage.ts';

const GOALS: Record<string, Goal> = {
  points: { kind: 'points' },
  gold: { kind: 'target', target: 400 },
  silver: { kind: 'target', target: 300 },
};

const STORAGE = 'okey-v2-game';

export const App = () => {
  const [history, setHistory] = useState<GameState[]>(() => load(STORAGE, { games: [newGame()] }).games);
  const [goalKey, setGoalKey] = useState<string>(() => load('okey-v2-goal', { goal: 'points' }).goal);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null);
  const requestId = useRef(0);

  const game = history[history.length - 1];
  const goal = GOALS[goalKey] ?? GOALS.points;
  const handCards = cardsIn(game.hand);
  const unseen = unseenOf(game);
  const over = isOver(game);

  useEffect(() => save(STORAGE, { games: history.slice(-50) }), [history]);
  useEffect(() => save('okey-v2-goal', { goal: goalKey }), [goalKey]);

  useEffect(() => {
    const w = new Worker(new URL('./worker/advisor.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<AnalyzeResponse>) => {
      if (e.data.id !== requestId.current) return; // a newer request is on its way
      setAnalysis(e.data);
      setBusy(false);
    };
    worker.current = w;
    return () => w.terminate();
  }, []);

  useEffect(() => {
    if (!worker.current) return;
    if (game.hand === 0 && game.gone === 0) {
      setAnalysis(null);
      return;
    }
    const req: AnalyzeRequest = {
      id: ++requestId.current,
      hand: game.hand,
      gone: game.gone,
      score: game.score,
      goal,
      drawing: needsDraw(game),
    };
    setBusy(true);
    worker.current.postMessage(req);
  }, [game.hand, game.gone, game.score, goalKey]);

  const update = (next: GameState) => {
    if (next !== game) setHistory(h => [...h, next]);
  };

  const apply = (a: Action) => {
    if (a.type === 'play') update(play(game, a.combo));
    else if (a.type === 'discard') update(discard(game, a.card));
  };

  const onScreenEvents = (events: TrackerEvent[]) => {
    setHistory(h => {
      let g = h[h.length - 1];
      for (const ev of events) {
        if (ev.type === 'draw') g = draw(g, ev.card);
        else if (ev.type === 'discard') g = discard(g, ev.card);
        else if (ev.type === 'play') g = play(g, ev.combo);
        else setNotice(ev.reason);
      }
      return g === h[h.length - 1] ? h : [...h, g];
    });
  };

  const onDraw = (card: Card) => {
    if (popcount(game.hand) >= HAND_SIZE) {
      setNotice('Your hand already has 5 cards. Play or discard first.');
      return;
    }
    setNotice(null);
    update(draw(game, card));
  };

  const suggested = analysis?.ranked[0]?.action;
  const suggestedMask = suggested?.type === 'play' ? suggested.combo.mask : suggested?.type === 'discard' ? bit(suggested.card) : 0;

  return (
    <div className="app">
      <header>
        <h1>Okey Helper <span>V2</span></h1>
        <div className="row">
          <label>
            Play for{' '}
            <select value={goalKey} onChange={e => setGoalKey(e.target.value)}>
              <option value="points">Highest average score</option>
              <option value="gold">Best chance of gold (400)</option>
              <option value="silver">Best chance of silver (300)</option>
            </select>
          </label>
          <button type="button" onClick={() => setHistory(h => (h.length > 1 ? h.slice(0, -1) : h))} disabled={history.length < 2}>
            Undo
          </button>
          <button type="button" onClick={() => { setHistory([newGame()]); setNotice(null); }}>New game</button>
        </div>
      </header>

      {notice && <p className="notice" onClick={() => setNotice(null)}>{notice}</p>}

      <main>
        <div className="col">
          <section className="panel">
            <h2>
              Your hand <span className="score">Score {game.score} · {chestFor(game.score)} · {popcount(unseen)} in deck</span>
            </h2>
            <div className="hand">
              {Array.from({ length: HAND_SIZE }, (_, i) => {
                const card = handCards[i] ?? null;
                return (
                  <CardView
                    key={i}
                    card={card}
                    state={card !== null && suggestedMask & bit(card) ? 'suggested' : 'hand'}
                    title="Click to discard"
                    onClick={card !== null ? () => update(discard(game, card)) : undefined}
                  />
                );
              })}
            </div>
            {over && <p className="headline">Game over: {game.score} points, {chestFor(game.score)} chest.</p>}
          </section>
          <AdvicePanel analysis={analysis} busy={busy} goal={goal} onApply={apply} />
          <ScreenReader hand={game.hand} gone={game.gone} onEvents={onScreenEvents} />
        </div>
        <div className="col">
          <DeckTracker
            game={game}
            onDraw={onDraw}
            onMarkGone={c => update(markGone(game, c))}
            onRestore={c => update(restore(game, c))}
          />
          <ForecastPanel analysis={analysis} />
          <section className="panel">
            <h2>Log</h2>
            <ol className="log">
              {game.log.slice(-12).reverse().map((l, i) => <li key={i}>{l}</li>)}
            </ol>
          </section>
        </div>
      </main>
      <footer>Read-only helper: it never sends input to the game, reads its memory or touches network traffic.</footer>
    </div>
  );
};
