import type { AnalyzeResponse } from '../worker/advisor.worker.ts';
import { cardName } from '../engine/cards.ts';
import { describeCombo } from '../engine/scoring.ts';

const pct = (x: number) => `${(x * 100).toFixed(x > 0 && x < 0.01 ? 1 : 0)}%`;

/** Chest odds, final-score spread and the combos that are one card away. */
export const ForecastPanel = ({ analysis }: { analysis: AnalyzeResponse | null }) => {
  if (!analysis) return <p className="hint">No forecast yet.</p>;
  const f = analysis.forecast;
  const max = Math.max(1, ...f.histogram);
  return (
    <>
      <div className="stats">
        <div><b>{pct(f.gold)}</b><span>gold (400+)</span></div>
        <div><b>{pct(f.silver)}</b><span>silver+ (300+)</span></div>
        <div><b>{f.expected.toFixed(0)}</b><span>avg final score</span></div>
      </div>
      <div className="histogram" aria-label="Simulated final scores">
        {f.histogram.map((n, i) => (
          <div key={i} className={`bar ${i >= 8 ? 'gold' : i >= 6 ? 'silver' : ''}`} title={`${i * 50}-${i * 50 + 49}: ${n}`}>
            <div style={{ height: `${(n / max) * 100}%` }} />
            <span>{i * 50}</span>
          </div>
        ))}
      </div>
      <p className="hint">{f.exact ? 'Exact odds.' : 'Estimated from simulated games; following the advice usually does a bit better.'}</p>
      {analysis.oneAway.length > 0 && (
        <ul className="outs">
          {analysis.oneAway.slice(0, 5).map((d, i) => (
            <li key={i}>
              <b>{describeCombo(d.combo)}</b> ({d.combo.score}) needs {d.missing.map(cardName).join(', ')}
            </li>
          ))}
        </ul>
      )}
    </>
  );
};
