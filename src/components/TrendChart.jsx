import { fmtDate } from '../lib/format.js';

// Tiny line chart for vitals across visits (BP, pulse, weight, INR, EF).
// rows: [{ date, values: [n|null, …] }] oldest → newest
// series: [{ name, cls }]; band: [low, high] shaded target zone (optional)
export default function TrendChart({ title, unit, rows, series, band }) {
  const pts = rows.filter((r) => r.values.some((v) => v != null));
  if (pts.length < 1) return null;
  const W = 320, H = 120, L = 30, R = 8, T = 10, B = 22;
  const all = pts.flatMap((r) => r.values.filter((v) => v != null).map(Number));
  if (band) all.push(...band);
  let lo = Math.min(...all), hi = Math.max(...all);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.12;
  lo -= pad; hi += pad;
  const x = (i) => (pts.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (pts.length - 1));
  const y = (v) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  const last = pts[pts.length - 1];
  const ticks = [lo + pad, (lo + hi) / 2, hi - pad];
  const latest = series.map((s, k) => (last.values[k] != null ? <em key={s.name} className={s.cls}>{last.values[k]}</em> : null)).filter(Boolean);
  return (
    <figure className="trend">
      <figcaption>
        <b>{title}</b>
        <span>{latest.reduce((a, e, i) => (i ? [...a, ' / ', e] : [e]), [])} {unit}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title} over ${pts.length} visits`}>
        {band && <rect x={L} width={W - L - R} y={y(band[1])} height={Math.max(0, y(band[0]) - y(band[1]))} className="band" />}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid" />
            <text x={L - 4} y={y(t) + 3} textAnchor="end">{Math.round(t * 10) / 10}</text>
          </g>
        ))}
        {series.map((s, k) => {
          const line = pts.map((r, i) => (r.values[k] == null ? null : [x(i), y(Number(r.values[k]))])).filter(Boolean);
          return (
            <g key={s.name} className={s.cls}>
              {line.length > 1 && <polyline points={line.map((p) => p.join(',')).join(' ')} />}
              {line.map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r="2.8" />)}
            </g>
          );
        })}
        <text x={L} y={H - 6}>{fmtDate(pts[0].date)}</text>
        {pts.length > 1 && <text x={W - R} y={H - 6} textAnchor="end">{fmtDate(last.date)}</text>}
      </svg>
    </figure>
  );
}
