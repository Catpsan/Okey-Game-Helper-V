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
import { AdvicePanel, OptionsTable } from './ui/AdvicePanel.tsx';
import { ForecastPanel } from './ui/ForecastPanel.tsx';
import { ScreenReader } from './ui/ScreenReader.tsx';
import { load, save } from './ui/storage.ts';

// Gold first, silver as the fallback: a gold chance is worth GOLD_FIRST_WEIGHT times a silver
// chance. Chosen by benchmark (docs/benchmark.md).
export const GOLD_FIRST_WEIGHT = 10;

const GOALS: Record<string, Goal> = {
  'gold-first': { kind: 'chest', weights: { gold: GOLD_FIRST_WEIGHT, silver: 1 } },
  points: { kind: 'points' },
  gold: { kind: 'chest', weights: { gold: 1, silver: 0 } },
  silver: { kind: 'chest', weights: { gold: 0, silver: 1 } },
};

const STORAGE = 'okey-v2-game';

export const App = () => {
  const [history, setHistory] = useState<GameState[]>(() => load(STORAGE, { games: [newGame()] }).games);
  const [goalKey, setGoalKey] = useState<string>(() => load('okey-v2-goal', { goal: 'gold-first' }).goal);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null);
  const requestId = useRef(0);

  const game = history[history.length - 1];
  const goal = GOALS[goalKey] ?? GOALS['gold-first'];
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

  const onScreenEvents = (events: TrackerEvent[], _source: 'live' | 'paste') => {
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

  const chest = chestFor(game.score);

  return (
    <div className="app">
      <header>
        <h1>Okey Helper</h1>
        <select className="goal" value={goalKey} onChange={e => setGoalKey(e.target.value)} aria-label="Play for">
          <option value="gold-first">Goal: gold, else silver</option>
          <option value="points">Goal: highest score</option>
          <option value="gold">Goal: gold only</option>
          <option value="silver">Goal: silver or better</option>
        </select>
        <button type="button" className="ghost" onClick={() => setHistory(h => (h.length > 1 ? h.slice(0, -1) : h))} disabled={history.length < 2}>
          Undo
        </button>
        <button type="button" className="ghost" onClick={() => { setHistory([newGame()]); setNotice(null); }}>New game</button>
      </header>

      {notice && <p className="notice" onClick={() => setNotice(null)}>{notice}</p>}

      <section className="panel hero">
        <div className="scoreline">
          <b className="score">{game.score}</b>
          <span className={`pill ${chest}`}>{chest}</span>
          <span className="muted">{popcount(unseen)} left in deck</span>
        </div>
        <div className="hand">
          {Array.from({ length: HAND_SIZE }, (_, i) => {
            const card = handCards[i] ?? null;
            return (
              <CardView
                key={i}
                card={card}
                state={card !== null && suggestedMask & bit(card) ? 'suggested' : 'hand'}
                title="Tap to discard"
                onClick={card !== null ? () => update(discard(game, card)) : undefined}
              />
            );
          })}
        </div>
        {over ? <p className="headline">Game over: {game.score} points, {chest} chest.</p> : <AdvicePanel analysis={analysis} busy={busy} onApply={apply} />}
      </section>

      <ScreenReader hand={game.hand} gone={game.gone} onEvents={onScreenEvents} />

      <details className="panel more">
        <summary>Cards</summary>
        <DeckTracker
          game={game}
          onDraw={onDraw}
          onMarkGone={c => update(markGone(game, c))}
          onRestore={c => update(restore(game, c))}
        />
      </details>
      <details className="panel more">
        <summary>Odds and other moves</summary>
        <ForecastPanel analysis={analysis} />
        <OptionsTable analysis={analysis} />
      </details>
      <details className="panel more">
        <summary>Log</summary>
        <ol className="log">
          {game.log.slice(-12).reverse().map((l, i) => <li key={i}>{l}</li>)}
        </ol>
      </details>
      <footer>Read-only: it only looks at the picture you share. It never clicks, types or touches the game.</footer>
    </div>
  );
};
