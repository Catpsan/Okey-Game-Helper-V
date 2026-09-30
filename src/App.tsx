import { useEffect, useRef, useState } from 'react';
import { cardsIn, bit, popcount, HAND_SIZE, COLORS, NUMBERS, cardOf, cardName } from './engine/cards.ts';
import type { Card } from './engine/cards.ts';
import { newGame, draw, discard, play, markGone, restore, needsDraw, unseenOf, isOver } from './engine/game.ts';
import type { GameState } from './engine/game.ts';
import type { Goal } from './engine/advisor.ts';
import type { Action } from './engine/solver.ts';
import { chestFor, describeCombo } from './engine/scoring.ts';
import { actionLabel } from './engine/explain.ts';
import type { TrackerEvent } from './vision/tracker.ts';
import type { AnalyzeRequest, AnalyzeResponse } from './worker/advisor.worker.ts';
import { CardView } from './ui/CardView.tsx';
import { ScreenReader } from './ui/ScreenReader.tsx';
import type { ScreenReaderHandle } from './ui/ScreenReader.tsx';
import { load, save } from './ui/storage.ts';

// Gold first, silver as the fallback: a gold chance counts GOLD_FIRST_WEIGHT times a silver
// chance. 3:1 kept the gold rate of "gold only" while beating "silver only" on silver
// (docs/benchmark.md).
export const GOLD_FIRST_WEIGHT = 3;

const GOALS: Record<string, { label: string; goal: Goal }> = {
  'gold-first': { label: 'Gold, else silver', goal: { kind: 'chest', weights: { gold: GOLD_FIRST_WEIGHT, silver: 1 } } },
  points: { label: 'Most points', goal: { kind: 'points' } },
  gold: { label: 'Gold only', goal: { kind: 'chest', weights: { gold: 1, silver: 0 } } },
  silver: { label: 'Silver only', goal: { kind: 'chest', weights: { gold: 0, silver: 1 } } },
};

const pct = (x: number) => `${Math.round(x * 100)}%`;

export const App = () => {
  const [history, setHistory] = useState<GameState[]>(() => load('okey-v2-game', { games: [newGame()] }).games);
  const [goalKey, setGoalKey] = useState<string>(() => load('okey-v2-goal', { goal: 'gold-first' }).goal);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null);
  const requestId = useRef(0);
  const reader = useRef<ScreenReaderHandle>(null);

  const game = history[history.length - 1];
  const goal = (GOALS[goalKey] ?? GOALS['gold-first']).goal;
  const handCards = cardsIn(game.hand);
  const unseen = unseenOf(game);
  const over = isOver(game) && game.gone !== 0;

  useEffect(() => save('okey-v2-game', { games: history.slice(-50) }), [history]);
  useEffect(() => save('okey-v2-goal', { goal: goalKey }), [goalKey]);

  useEffect(() => {
    const w = new Worker(new URL('./worker/advisor.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<AnalyzeResponse>) => {
      if (e.data.id !== requestId.current) return;
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
    const req: AnalyzeRequest = { id: ++requestId.current, hand: game.hand, gone: game.gone, score: game.score, goal, drawing: needsDraw(game) };
    setBusy(true);
    worker.current.postMessage(req);
  }, [game.hand, game.gone, game.score, goalKey]);

  const push = (next: GameState) => {
    if (next !== game) setHistory(h => [...h, next]);
  };

  const apply = (a: Action) => {
    if (a.type === 'play') push(play(game, a.combo));
    else if (a.type === 'discard') push(discard(game, a.card));
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

  const onGridClick = (card: Card) => {
    if (game.hand & bit(card)) return push(discard(game, card));
    if (game.gone & bit(card)) return push(restore(game, card));
    if (popcount(game.hand) >= HAND_SIZE) {
      setNotice('Your hand is full. Play or discard first.');
      return;
    }
    setNotice(null);
    reader.current?.learnDraw(card, game.hand);
    push(draw(game, card));
  };

  const top = analysis?.ranked[0];
  const suggestedMask = top?.action.type === 'play' ? top.action.combo.mask : top?.action.type === 'discard' ? bit(top.action.card) : 0;
  const f = analysis?.forecast;

  return (
    <div className="app">
      <header>
        <h1>Okey <span>Helper</span></h1>
        <div className="controls">
          <select value={goalKey} onChange={e => setGoalKey(e.target.value)} title="What to play for">
            {Object.entries(GOALS).map(([k, g]) => <option key={k} value={k}>{g.label}</option>)}
          </select>
          <button type="button" onClick={() => setHistory(h => (h.length > 1 ? h.slice(0, -1) : h))} disabled={history.length < 2} title="Undo">↶</button>
          <button type="button" onClick={() => { setHistory([newGame()]); setNotice(null); }}>New game</button>
        </div>
      </header>

      <div className="layout">
      <div className="col-screen">
        <ScreenReader ref={reader} hand={game.hand} gone={game.gone} onEvents={onScreenEvents} />
        {notice && <p className="notice" onClick={() => setNotice(null)}>{notice}</p>}
      </div>

      <div className="col-game">
      <section className="table">
        <div className="score">
          <b>{game.score}</b> <span className={`chest ${chestFor(game.score)}`}>{chestFor(game.score)}</span>
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
                title={card !== null ? `${cardName(card)}: click to discard` : undefined}
                onClick={card !== null ? () => push(discard(game, card)) : undefined}
              />
            );
          })}
        </div>

        <div className="advice">
          {over ? (
            <p className="headline">Game over: {game.score} points, {chestFor(game.score)} chest.</p>
          ) : !analysis ? (
            <p className="muted">Add the cards you draw, by screen or on the grid below.</p>
          ) : needsDraw(game) ? (
            <p className="muted">Draw until you have 5 cards.</p>
          ) : top ? (
            <>
              <p className={`headline ${busy ? 'stale' : ''}`}>{actionLabel(top)}</p>
              <p className="muted small">{analysis.explanation.replace(/ After it:.*$/, '')}</p>
              <button type="button" className="primary" onClick={() => apply(top.action)}>Done</button>
            </>
          ) : null}
          {f && !over && (
            <div className="forecast">
              <div className="odds">
                <span className="o-gold"><b>{pct(f.gold)}</b> gold</span>
                <span className="o-silver"><b>{pct(f.silver)}</b> silver+</span>
                <span><b>{Math.round(f.expected)}</b> avg</span>
              </div>
              <div className="spark" title="Likely final scores: bronze under 300, silver 300+, gold 400+">
                {f.histogram.slice(2, 11).map((n, i) => {
                  const from = (i + 2) * 50;
                  const max = Math.max(1, ...f.histogram.slice(2, 11));
                  return (
                    <div key={i} className={from >= 400 ? 'gold' : from >= 300 ? 'silver' : 'bronze'} title={`${from}-${from + 49}`}>
                      <i style={{ height: `${Math.max(6, (n / max) * 100)}%` }} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="grid" aria-label="All 24 cards">
        {COLORS.map(color => (
          <div className="grid-row" key={color}>
            {NUMBERS.map(n => {
              const card = cardOf(color, n);
              const state = game.hand & bit(card) ? 'hand' : game.gone & bit(card) ? 'gone' : 'unseen';
              return (
                <CardView
                  key={card}
                  card={card}
                  small
                  state={state}
                  title={`${cardName(card)}: ${state === 'unseen' ? 'click when drawn, right-click if gone' : state === 'hand' ? 'click to discard' : 'click to put back'}`}
                  onClick={() => onGridClick(card)}
                  onContextMenu={() => state === 'unseen' && push(markGone(game, card))}
                />
              );
            })}
          </div>
        ))}
      </section>

      {analysis && (
        <details className="details">
          <summary>Details</summary>
          {analysis.ranked.length > 0 && (
            <table>
              <thead><tr><th>Option</th><th>Gold</th><th>Silver+</th><th>Avg</th></tr></thead>
              <tbody>
                {analysis.ranked.slice(0, 6).map((r, i) => (
                  <tr key={i} className={i === 0 ? 'best' : ''}>
                    <td>{actionLabel(r)}</td><td>{pct(r.gold)}</td><td>{pct(r.silver)}</td><td>{Math.round(r.expectedScore)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {analysis.oneAway.length > 0 && (
            <p className="small">
              <span className="muted">One card away: </span>
              {analysis.oneAway.slice(0, 4).map(d => `${describeCombo(d.combo)} (${d.combo.score}) needs ${d.missing.map(cardName).join('/')}`).join(' · ')}
            </p>
          )}
          <p className="muted small">
            {analysis.ranked[0]?.exact || f?.exact ? 'Exact calculation.' : 'Estimated from simulated games.'} {game.log.slice(-3).reverse().join(' · ')}
          </p>
        </details>
      )}
      </div>
      </div>

      <footer>Only reads the picture of the game. Never clicks, types or reads game memory.</footer>
    </div>
  );
};
