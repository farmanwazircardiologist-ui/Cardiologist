import { useState } from 'react';
import { SEG_STATES, SEG_NAMES, segArray } from '../lib/studies.js';

// 17-segment (AHA) bullseye. Angles run counter-clockwise from the top.
const CX = 100, CY = 100;
const pt = (r, deg) => { const a = (deg * Math.PI) / 180; return [CX - r * Math.sin(a), CY - r * Math.cos(a)]; };
function arc(ri, ro, a1, a2) {
  const [x1, y1] = pt(ro, a1), [x2, y2] = pt(ro, a2), [x3, y3] = pt(ri, a2), [x4, y4] = pt(ri, a1);
  return `M${x1} ${y1} A${ro} ${ro} 0 0 0 ${x2} ${y2} L${x3} ${y3} A${ri} ${ri} 0 0 1 ${x4} ${y4}Z`;
}
// segment number (1..17) -> shape
const SHAPES = (() => {
  const out = {};
  for (let i = 0; i < 6; i += 1) { // basal and mid rings, 60 degrees each, segment 1 centred on the top
    out[1 + i] = { d: arc(72, 95, -30 + i * 60, 30 + i * 60), c: pt(83.5, i * 60) };
    out[7 + i] = { d: arc(49, 72, -30 + i * 60, 30 + i * 60), c: pt(60.5, i * 60) };
  }
  for (let i = 0; i < 4; i += 1) out[13 + i] = { d: arc(26, 49, -45 + i * 90, 45 + i * 90), c: pt(37.5, i * 90) };
  out[17] = { d: `M${CX - 26} ${CY} A26 26 0 1 0 ${CX + 26} ${CY} A26 26 0 1 0 ${CX - 26} ${CY}Z`, c: [CX, CY] };
  return out;
})();
const FILL = { 1: '#ffffff', 2: '#ffe08a', 3: '#ffa94d', 4: '#ff7b72', 5: '#d687e0' };

export function SegSvg({ value, onPick, size = 200 }) {
  const a = segArray(value);
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} className="segplot" role="img" aria-label="17 segment wall motion diagram">
      {Array.from({ length: 17 }, (_, i) => i + 1).map((s) => {
        const st = a ? a[s - 1] : 0;
        return (
          <g key={s} onClick={onPick ? () => onPick(s) : undefined} style={onPick ? { cursor: 'pointer' } : undefined}>
            <path d={SHAPES[s].d} fill={st ? FILL[st] : '#f1f4f8'} stroke="#43536a" strokeWidth="1" />
            <text x={SHAPES[s].c[0]} y={SHAPES[s].c[1] + 4} textAnchor="middle" fontSize="11" fill="#1f2a3a" style={{ pointerEvents: 'none' }}>{s}</text>
          </g>
        );
      })}
      <text x="100" y="8" textAnchor="middle" fontSize="8" fill="#5b6b80">Anterior</text>
      <text x="4" y="103" fontSize="8" fill="#5b6b80">Septal</text>
      <text x="196" y="103" textAnchor="end" fontSize="8" fill="#5b6b80">Lateral</text>
      <text x="100" y="198" textAnchor="middle" fontSize="8" fill="#5b6b80">Inferior</text>
    </svg>
  );
}

export function SegLegend() {
  return (
    <div className="seg-legend">
      {SEG_STATES.map(([k, l]) => <span key={k}><i style={{ background: FILL[k] }} />{l}</span>)}
    </div>
  );
}

// Paint-style editor: pick a state, then tap segments.
export default function SegPlot({ value, onChange, disabled }) {
  const [brush, setBrush] = useState(2);
  const a = segArray(value) || Array(17).fill(0);
  const paint = (s) => { if (disabled) return; const x = [...a]; x[s - 1] = brush; onChange(x.map((v) => v || 1).join('')); };
  const bad = a.map((v, i) => [v, i]).filter(([v]) => v > 1);
  return (
    <div className="segbox">
      <div>
        <div className="chips" style={{ marginBottom: 8 }}>
          {SEG_STATES.map(([k, l]) => (
            <button type="button" key={k} className={`chip ${brush === k ? 'on' : ''}`} onClick={() => setBrush(k)}>{l}</button>
          ))}
        </div>
        <SegSvg value={value} onPick={paint} />
        <div className="row" style={{ marginTop: 6 }}>
          <button type="button" className="btn small" onClick={() => onChange('1'.repeat(17))}>All normal</button>
          <button type="button" className="btn small ghost" onClick={() => onChange('')}>Clear</button>
        </div>
      </div>
      <div className="seg-list">
        {!segArray(value) && <p className="faint">Not assessed. Pick a state, then tap segments, or press All normal.</p>}
        {segArray(value) && !bad.length && <p>All 17 segments normal.</p>}
        {bad.map(([v, i]) => <div key={i}>{i + 1}. {SEG_NAMES[i]}: <b>{SEG_STATES.find((x) => x[0] === v)[1]}</b></div>)}
      </div>
    </div>
  );
}
