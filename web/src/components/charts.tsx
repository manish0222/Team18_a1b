// Hand-rolled SVG charts (no chart library): a time line chart, a vertical
// bar chart and a horizontal bar list. Each measures its container so it
// redraws crisply at any width, and each has a text alternative.
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';

function useWidth<T extends HTMLElement>(fallback = 600) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth || fallback);
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, width] as const;
}

function niceTicks(min: number, max: number, count = 4) {
  if (min === max) { max = min + 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; ticks.length < 2 || ticks[ticks.length - 1] < max - step * 1e-6; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

export const SERIES_COLORS = ['#0B7A72', '#3B5BDB', '#B5470F'];

export interface LineSeries {
  id: string;
  label: ReactNode;
  color?: string;
  points: { x: number; y: number; meta?: ReactNode }[];
}

export function LineChart({
  series, height = 260, formatY, formatX, ariaLabel, step = false, yFromZero = true,
}: {
  series: LineSeries[];
  height?: number;
  formatY: (v: number) => string;
  formatX: (v: number) => string;
  ariaLabel: string;
  step?: boolean;
  yFromZero?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ sx: number; items: { s: LineSeries; p: LineSeries['points'][number] }[] } | null>(null);
  const pad = { top: 12, right: 16, bottom: 28, left: 64 };
  const all = series.flatMap((s) => s.points);

  const scales = useMemo(() => {
    if (!all.length) return null;
    const xs = all.map((p) => p.x);
    const ys = all.map((p) => p.y);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs) === xMin ? xMin + 86_400_000 : Math.max(...xs);
    const yTicks = niceTicks(yFromZero ? Math.min(0, ...ys) : Math.min(...ys), Math.max(...ys));
    const yMin = yTicks[0];
    const yMax = yTicks[yTicks.length - 1];
    const iw = width - pad.left - pad.right;
    const ih = height - pad.top - pad.bottom;
    const sx = (x: number) => pad.left + ((x - xMin) / (xMax - xMin)) * iw;
    const sy = (y: number) => pad.top + ih - ((y - yMin) / (yMax - yMin || 1)) * ih;
    const xTickCount = Math.max(2, Math.min(6, Math.floor(iw / 110)));
    const xTicks = Array.from({ length: xTickCount }, (_, i) => xMin + ((xMax - xMin) * i) / (xTickCount - 1));
    return { sx, sy, yTicks, xTicks, xMin, xMax, iw, ih };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, width, height, yFromZero]);

  if (!scales) return <div ref={ref} className="chart-empty">No data points for this selection.</div>;
  const { sx, sy, yTicks, xTicks } = scales;

  const pathFor = (pts: LineSeries['points']) =>
    pts
      .map((p, i) => {
        if (i === 0) return `M${sx(p.x)},${sy(p.y)}`;
        return step ? `H${sx(p.x)}V${sy(p.y)}` : `L${sx(p.x)},${sy(p.y)}`;
      })
      .join('');

  function onMove(e: ReactMouseEvent<SVGRectElement>) {
    const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const items = series
      .map((s) => {
        let best: LineSeries['points'][number] | null = null;
        let bestD = Infinity;
        for (const p of s.points) {
          const d = Math.abs(sx(p.x) - mx);
          if (d < bestD) { bestD = d; best = p; }
        }
        return best && bestD < 40 ? { s, p: best } : null;
      })
      .filter(Boolean) as { s: LineSeries; p: LineSeries['points'][number] }[];
    setHover(items.length ? { sx: sx(items[0].p.x), items } : null);
  }

  return (
    <div ref={ref} className="chart">
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={sy(t)} y2={sy(t)} className="chart-grid" />
            <text x={pad.left - 8} y={sy(t)} dy="0.32em" textAnchor="end" className="chart-axis">{formatY(t)}</text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={i} x={sx(t)} y={height - 8} textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'} className="chart-axis">
            {formatX(t)}
          </text>
        ))}
        {series.map((s, i) => (
          <g key={s.id}>
            <path d={pathFor(s.points)} fill="none" stroke={s.color ?? SERIES_COLORS[i % 3]} strokeWidth={2.25} strokeLinejoin="round" />
            {s.points.length < 60 && s.points.map((p, j) => (
              <circle key={j} cx={sx(p.x)} cy={sy(p.y)} r={2.6} fill={s.color ?? SERIES_COLORS[i % 3]} />
            ))}
          </g>
        ))}
        {hover && (
          <g pointerEvents="none">
            <line x1={hover.sx} x2={hover.sx} y1={pad.top} y2={height - pad.bottom} className="chart-cursor" />
            {hover.items.map(({ s, p }) => (
              <circle key={s.id} cx={sx(p.x)} cy={sy(p.y)} r={5} fill="#fff" stroke={s.color ?? SERIES_COLORS[series.indexOf(s) % 3]} strokeWidth={2.5} />
            ))}
          </g>
        )}
        <rect x={pad.left} y={pad.top} width={Math.max(0, width - pad.left - pad.right)} height={Math.max(0, height - pad.top - pad.bottom)}
          fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </svg>
      {hover && (
        <div className="chart-tip" style={{ left: Math.min(hover.sx + 12, width - 220) }}>
          <div className="chart-tip-title">{formatX(hover.items[0].p.x)}</div>
          {hover.items.map(({ s, p }) => (
            <div key={s.id} className="chart-tip-row">
              <span className="swatch" style={{ background: s.color ?? SERIES_COLORS[series.indexOf(s) % 3] }} />
              <span>{s.label}</span>
              <strong>{formatY(p.y)}</strong>
              {p.meta && <span className="chart-tip-meta">{p.meta}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Vertical bars with value labels (rating distribution). */
export function BarChart({ data, height = 220, ariaLabel, formatValue = String, color = '#0B7A72' }: {
  data: { label: string; value: number; color?: string }[];
  height?: number;
  ariaLabel: string;
  formatValue?: (v: number) => string;
  color?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(400);
  const pad = { top: 22, bottom: 28, side: 8 };
  const max = Math.max(1, ...data.map((d) => d.value));
  const slot = (width - pad.side * 2) / Math.max(1, data.length);
  const bw = Math.min(64, slot * 0.62);
  const ih = height - pad.top - pad.bottom;
  return (
    <div ref={ref} className="chart">
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        <line x1={pad.side} x2={width - pad.side} y1={height - pad.bottom} y2={height - pad.bottom} className="chart-baseline" />
        {data.map((d, i) => {
          const h = (d.value / max) * ih;
          const x = pad.side + slot * i + (slot - bw) / 2;
          const y = height - pad.bottom - h;
          return (
            <g key={d.label}>
              <rect x={x} y={y} width={bw} height={Math.max(h, d.value ? 1 : 0)} rx={3} fill={d.color ?? color} />
              <text x={x + bw / 2} y={y - 6} textAnchor="middle" className="chart-value">{formatValue(d.value)}</text>
              <text x={x + bw / 2} y={height - 8} textAnchor="middle" className="chart-axis">{d.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Horizontal bars as an HTML list - reads well at any width (top tags). */
export function HBarList({ data, formatValue = String, ariaLabel }: { data: { label: ReactNode; value: number; key: string }[]; formatValue?: (v: number) => string; ariaLabel: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ol className="hbars" aria-label={ariaLabel}>
      {data.map((d) => (
        <li key={d.key}>
          <span className="hbars-label">{d.label}</span>
          <span className="hbars-track"><span className="hbars-fill" style={{ width: `${(d.value / max) * 100}%` }} /></span>
          <span className="hbars-value num">{formatValue(d.value)}</span>
        </li>
      ))}
    </ol>
  );
}
