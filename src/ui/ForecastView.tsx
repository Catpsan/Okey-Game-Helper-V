import type { Forecast } from '../engine/forecast.ts';
import type { Tier } from './PixelChest.tsx';

const pct = (x: number) => `${Math.round(Math.max(0, x) * 100)}%`;
const FIRST = 2; // bins are 50 points wide; start the chart at 100
const tierOf = (from: number): Tier => (from >= 400 ? 'gold' : from >= 300 ? 'silver' : 'bronze');

export const ForecastView = ({ f, current }: { f: Forecast; current: number }) => {
  const bins = f.histogram.slice(FIRST);
  const total = Math.max(1, f.histogram.reduce((a, b) => a + b, 0));
  const max = Math.max(1, ...bins);
  const chances: [Tier, number][] = [['gold', f.gold], ['silver', f.silver - f.gold], ['bronze', 1 - f.silver]];
  return (
    <section className="forecast-panel" aria-label="Chest forecast">
      <div className="chests">
        {chances.map(([tier, p]) => (
          <div key={tier} className={`chest-tile ${tier}`}>
            <b>{pct(p)}</b>
            <span>{tier}</span>
          </div>
        ))}
        <div className="chest-tile avg">
          <span className="avg-num">{Math.round(f.expected)}</span>
          <span>avg score</span>
        </div>
      </div>

      <div className="hist" title="Where this game is likely to finish">
        <div className="hist-bars">
          {bins.map((n, i) => {
            const from = (i + FIRST) * 50;
            const last = i === bins.length - 1;
            return (
              <div key={i} className={`bar ${tierOf(from)} ${from <= current && current < from + 50 ? 'now' : ''}`} title={`${from}${last ? '+' : `-${from + 49}`}: ${Math.round((n / total) * 100)}%`}>
                {n > 0 && (() => {
                  const h = Math.max(14, (n / max) * 100);
                  const p = Math.round((n / total) * 100);
                  return <i style={{ height: `${h}%` }}><em className={h < 26 ? 'above' : ''}>{p < 1 ? '<1' : p}%</em></i>;
                })()}
              </div>
            );
          })}
        </div>
        <div className="hist-axis">
          {bins.map((_, i) => {
            const from = (i + FIRST) * 50;
            return <span key={i}>{i === bins.length - 1 ? `${from}+` : from % 100 === 0 ? from : ''}</span>;
          })}
        </div>
      </div>
      <p className="muted tiny">{f.exact ? 'Exact odds.' : 'From simulated games.'} Bronze under 300, silver 300+, gold 400+.</p>
    </section>
  );
};
