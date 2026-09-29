import type { AnalyzeResponse } from '../worker/advisor.worker.ts';
import { cardName } from '../engine/cards.ts';
import { describeCombo } from '../engine/scoring.ts';

const pct = (x: number) => `${(x * 100).toFixed(x > 0 && x < 0.01 ? 1 : 0)}%`;

export const ForecastPanel = ({ analysis }: { analysis: AnalyzeResponse | null }) => {
  if (!analysis) return null;
  const f = analysis.forecast;
  const max = Math.max(1, ...f.histogram);
  return (
    <>
      <section className="panel">
        <h2>Chest forecast</h2>
        <div className="stats">
          <div><b>{pct(f.gold)}</b><span>gold (400+)</span></div>
          <div><b>{pct(f.silver)}</b><span>silver or better (300+)</span></div>
          <div><b>{f.expected.toFixed(0)}</b><span>average final score</span></div>
        </div>
        <p className="hint">
          {f.exact ? 'Exact: best possible chances if you play for each chest.' : 'Estimated from simulated games that use simpler play than the advisor, so following the advice usually does a bit better.'}
        </p>
        <div className="histogram" aria-label="Simulated final scores">
          {f.histogram.map((n, i) => (
            <div key={i} className={`bar ${i >= 8 ? 'gold' : i >= 6 ? 'silver' : ''}`} title={`${i * 50}-${i * 50 + 49}: ${n}`}>
              <div style={{ height: `${(n / max) * 100}%` }} />
              <span>{i * 50}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>Draw predictions</h2>
        {analysis.oneAway.length === 0 ? (
          <p className="hint">No combo is one card away right now.</p>
        ) : (
          <ul className="outs">
            {analysis.oneAway.slice(0, 6).map((d, i) => (
              <li key={i}>
                <b>{describeCombo(d.combo)}</b> ({d.combo.score}) needs {d.missing.map(cardName).join(', ')}
              </li>
            ))}
          </ul>
        )}
        <p className="hint">
          {analysis.outlook.length} cards left in the deck. Each one is {pct(analysis.outlook[0]?.next ?? 0)} to be your next draw
          {analysis.outlook.length > 0 && <> and {pct(analysis.outlook[0].withinThree)} to come within 3 draws</>}.
        </p>
      </section>
    </>
  );
};
