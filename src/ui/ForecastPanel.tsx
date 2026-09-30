import type { AnalyzeResponse } from '../worker/advisor.worker.ts';
import { cardName } from '../engine/cards.ts';
import { describeCombo } from '../engine/scoring.ts';

const pct = (x: number) => `${(x * 100).toFixed(x > 0 && x < 0.01 ? 1 : 0)}%`;

/** Chest odds, final-score spread and the combos that are one card away. */
export const ForecastPanel = ({ analysis }: { analysis: AnalyzeResponse | null }) => {
  if (!analysis) return <p className="hint">No forecast yet.</p>;
  const f = analysis.forecast;
  return (
    <>
      <div className="stats">
        <div><b>{pct(f.gold)}</b><span>gold (400+)</span></div>
        <div><b>{pct(f.silver)}</b><span>silver+ (300+)</span></div>
        <div><b>{f.expected.toFixed(0)}</b><span>avg final score</span></div>
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

/** Small always-visible chest forecast: gold / silver odds and a tiny final-score chart. */
export const MiniForecast = ({ analysis }: { analysis: AnalyzeResponse | null }) => {
  if (!analysis) return null;
  const f = analysis.forecast;
  const max = Math.max(1, ...f.histogram);
  return (
    <div className="mini-forecast" title="Chance of each final score (bars: 0 to 450+, silver from 300, gold from 400)">
      <div className="mini-bars" aria-hidden="true">
        {f.histogram.map((n, i) => (
          <i key={i} className={i >= 8 ? 'gold' : i >= 6 ? 'silver' : ''} style={{ height: `${Math.max(6, (n / max) * 100)}%`, opacity: n ? 1 : 0.25 }} />
        ))}
      </div>
      <span><b className="gold">{pct(f.gold)}</b> gold</span>
      <span><b>{pct(f.silver)}</b> silver+</span>
    </div>
  );
};
