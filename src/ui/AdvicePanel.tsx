import type { AnalyzeResponse } from '../worker/advisor.worker.ts';
import type { Action } from '../engine/solver.ts';
import { actionLabel } from '../engine/explain.ts';

const pct = (x: number) => `${(x * 100).toFixed(x > 0 && x < 0.01 ? 1 : 0)}%`;

interface Props {
  analysis: AnalyzeResponse | null;
  busy: boolean;
  onApply: (a: Action) => void;
}

/** The one suggestion that matters, and a button to confirm it was done. */
export const AdvicePanel = ({ analysis, busy, onApply }: Props) => {
  const top = analysis?.ranked[0];
  if (!analysis) return <p className="advice muted">{busy ? 'Thinking…' : 'Share the game window or tap the cards you drew to get a suggestion.'}</p>;
  return (
    <div className="advice">
      <p className="headline">{analysis.explanation}{busy && <span className="muted"> · updating…</span>}</p>
      {top && (
        <button type="button" className="primary" onClick={() => onApply(top.action)}>
          Done: {actionLabel(top)}
        </button>
      )}
    </div>
  );
};

/** Every option with its chances, for those who want the detail. */
export const OptionsTable = ({ analysis }: { analysis: AnalyzeResponse | null }) => {
  if (!analysis || analysis.ranked.length === 0) return <p className="hint">No options yet.</p>;
  return (
    <table className="ranked">
      <thead>
        <tr>
          <th>Option</th>
          <th>Gold</th>
          <th>Silver+</th>
          <th>Avg</th>
        </tr>
      </thead>
      <tbody>
        {analysis.ranked.slice(0, 8).map((r, i) => (
          <tr key={i} className={i === 0 ? 'best' : ''} title={r.exact ? 'Exact' : 'Estimate'}>
            <td>{actionLabel(r)}</td>
            <td>{pct(r.gold)}</td>
            <td>{pct(r.silver)}</td>
            <td>{r.expectedScore.toFixed(0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
