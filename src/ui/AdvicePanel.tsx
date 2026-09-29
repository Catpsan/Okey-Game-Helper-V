import type { AnalyzeResponse } from '../worker/advisor.worker.ts';
import type { Action } from '../engine/solver.ts';
import { actionLabel } from '../engine/explain.ts';

interface Props {
  analysis: AnalyzeResponse | null;
  busy: boolean;
  onApply: (a: Action) => void;
}

const pct = (x: number) => `${(x * 100).toFixed(x > 0 && x < 0.01 ? 1 : 0)}%`;

export const AdvicePanel = ({ analysis, busy, onApply }: Props) => {
  const top = analysis?.ranked[0];
  return (
    <section className="panel advice">
      <h2>
        Next play {busy && <span className="busy">thinking…</span>}
      </h2>
      {!analysis ? (
        <p className="hint">Add your cards to get a suggestion.</p>
      ) : (
        <>
          <p className="headline">{analysis.explanation}</p>
          {top && (
            <button type="button" className="primary" onClick={() => onApply(top.action)}>
              I did it: {actionLabel(top)}
            </button>
          )}
          {analysis.ranked.length > 0 && (
            <table className="ranked">
              <thead>
                <tr>
                  <th>Option</th>
                  <th>Gold</th>
                  <th>Silver+</th>
                  <th>Avg final</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {analysis.ranked.slice(0, 8).map((r, i) => (
                  <tr key={i} className={i === 0 ? 'best' : ''}>
                    <td>{actionLabel(r)}</td>
                    <td>{pct(r.gold)}</td>
                    <td>{pct(r.silver)}</td>
                    <td>{r.expectedScore.toFixed(0)}</td>
                    <td>
                      <span className={`badge ${r.exact ? 'exact' : 'est'}`}>{r.exact ? 'exact' : 'estimate'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
};
