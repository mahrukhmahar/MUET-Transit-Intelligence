import React, { useState } from 'react';
import { ParetoPoint } from '../sim/types';

interface SeriesDef {
  key: string;
  label: string;
  color: string;
  values: number[];
  fillOpacity?: number;
}

interface LineChartProps {
  title: string;
  subtitle?: string;
  xLabels: string[];
  series: SeriesDef[];
  yUnit?: string;
  height?: number;
}

export const InteractiveLineChart: React.FC<LineChartProps> = ({
  title,
  subtitle,
  xLabels,
  series,
  yUnit = '',
  height = 240,
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const w = 680;
  const h = height;
  const padL = 46;
  const padR = 16;
  const padT = 16;
  const padB = 30;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const allVals = series.flatMap((s) => s.values);
  const maxVal = Math.max(1, ...allVals) * 1.12;
  const count = Math.max(2, xLabels.length);

  const getX = (i: number) => padL + (i / (count - 1)) * plotW;
  const getY = (v: number) => padT + plotH - (v / maxVal) * plotH;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    val: maxVal * f,
    y: padT + plotH * (1 - f),
  }));

  const xTickIndices = Array.from(
    new Set([0, Math.floor(count * 0.25), Math.floor(count * 0.5), Math.floor(count * 0.75), count - 1])
  ).filter((i) => i >= 0 && i < xLabels.length);

  return (
    <div className="rounded-xl bg-[#0F162E] border border-slate-800/80 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
          {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-sm inline-block"
                style={{ backgroundColor: s.color }}
              />
              <span>{s.label}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="relative w-full">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className="w-full h-auto overflow-visible select-none"
          onMouseLeave={() => setHoverIdx(null)}
        >
          {yUnit && (
            <text
              x={padL - 8}
              y={10}
              textAnchor="end"
              className="fill-slate-400 text-[9px] font-mono"
            >
              ({yUnit.trim()})
            </text>
          )}
          {yTicks.map((t, i) => (
            <g key={i}>
              <line
                x1={padL}
                x2={w - padR}
                y1={t.y}
                y2={t.y}
                stroke="#1E294B"
                strokeDasharray={i === 0 ? undefined : '3 3'}
                strokeWidth="1"
              />
              <text
                x={padL - 8}
                y={t.y + 3.5}
                textAnchor="end"
                className="fill-slate-400 text-[10px] font-mono tabular-nums"
              >
                {t.val >= 100 ? Math.round(t.val) : t.val.toFixed(1)}
              </text>
            </g>
          ))}

          {xTickIndices.map((idx) => (
            <text
              key={idx}
              x={getX(idx)}
              y={h - 6}
              textAnchor="middle"
              className="fill-slate-400 text-[10px] font-mono tabular-nums"
            >
              {xLabels[idx]}
            </text>
          ))}

          {series.map((s) => {
            if (s.values.length === 0) return null;
            const pts = s.values.map((v, i) => `${getX(i).toFixed(1)},${getY(v).toFixed(1)}`).join(' ');
            const areaPts = `${getX(0).toFixed(1)},${(padT + plotH).toFixed(1)} ${pts} ${getX(
              s.values.length - 1
            ).toFixed(1)},${(padT + plotH).toFixed(1)}`;
            return (
              <g key={s.key}>
                {s.fillOpacity ? (
                  <polygon points={areaPts} fill={s.color} fillOpacity={s.fillOpacity} />
                ) : null}
                <polyline
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2.2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={pts}
                />
              </g>
            );
          })}

          {hoverIdx !== null && (
            <g>
              <line
                x1={getX(hoverIdx)}
                x2={getX(hoverIdx)}
                y1={padT}
                y2={padT + plotH}
                stroke="#6366F1"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              {series.map((s) => (
                <circle
                  key={s.key}
                  cx={getX(hoverIdx)}
                  cy={getY(s.values[hoverIdx] ?? 0)}
                  r="4"
                  fill={s.color}
                  stroke="#0F162E"
                  strokeWidth="1.5"
                />
              ))}
            </g>
          )}

          {/* Hover capture columns */}
          {xLabels.map((_, i) => {
            const colW = plotW / count;
            return (
              <rect
                key={i}
                x={getX(i) - colW / 2}
                y={padT}
                width={colW}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
              />
            );
          })}
        </svg>

        {hoverIdx !== null && (
          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs font-mono tabular-nums text-slate-300 bg-[#0B1021] border border-slate-800 rounded-lg px-3 py-1.5">
            <span className="text-slate-400">{xLabels[hoverIdx]}</span>
            {series.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="text-slate-400">{s.label}:</span>
                <span className="text-slate-100 font-semibold">
                  {(s.values[hoverIdx] ?? 0).toFixed(1)}
                  {yUnit}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

interface GroupedBarGroup {
  groupLabel: string;
  bars: Array<{ label: string; value: number; color: string }>;
}

interface GroupedBarChartProps {
  title: string;
  subtitle?: string;
  groups: GroupedBarGroup[];
  unit?: string;
  height?: number;
}

export const GroupedBarChart: React.FC<GroupedBarChartProps> = ({
  title,
  subtitle,
  groups,
  unit = '',
  height = 230,
}) => {
  const [hovered, setHovered] = useState<{ g: number; b: number } | null>(null);
  const w = 680;
  const h = height;
  const padL = 46;
  const padR = 16;
  const padT = 18;
  const padB = 34;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const maxVal = Math.max(
    1,
    ...groups.flatMap((g) => g.bars.map((b) => b.value))
  ) * 1.15;

  const legendItems = groups[0]?.bars ?? [];
  const groupSlot = plotW / Math.max(1, groups.length);

  return (
    <div className="rounded-xl bg-[#0F162E] border border-slate-800/80 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
          {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
          {legendItems.map((item) => (
            <span key={item.label} className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: item.color }} />
              <span>{item.label}</span>
            </span>
          ))}
        </div>
      </div>

      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto overflow-visible select-none">
        {unit && (
          <text
            x={padL - 8}
            y={11}
            textAnchor="end"
            className="fill-slate-400 text-[9px] font-mono"
          >
            ({unit.trim()})
          </text>
        )}
        {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
          const y = padT + plotH * (1 - f);
          const val = maxVal * f;
          return (
            <g key={idx}>
              <line
                x1={padL}
                x2={w - padR}
                y1={y}
                y2={y}
                stroke="#1E294B"
                strokeDasharray={idx === 0 ? undefined : '3 3'}
              />
              <text
                x={padL - 8}
                y={y + 3.5}
                textAnchor="end"
                className="fill-slate-400 text-[10px] font-mono tabular-nums"
              >
                {val >= 100 ? Math.round(val) : val.toFixed(1)}
              </text>
            </g>
          );
        })}

        {groups.map((g, gi) => {
          const innerW = groupSlot * 0.72;
          const barW = innerW / Math.max(1, g.bars.length);
          const startX = padL + gi * groupSlot + (groupSlot - innerW) / 2;
          return (
            <g key={g.groupLabel}>
              {g.bars.map((bar, bi) => {
                const bh = Math.max(2, (bar.value / maxVal) * plotH);
                const bx = startX + bi * barW + 1.5;
                const by = padT + plotH - bh;
                const isHov = hovered?.g === gi && hovered?.b === bi;
                return (
                  <g
                    key={bar.label}
                    onMouseEnter={() => setHovered({ g: gi, b: bi })}
                    onMouseLeave={() => setHovered(null)}
                    className="cursor-pointer"
                  >
                    <rect
                      x={bx}
                      y={by}
                      width={Math.max(4, barW - 3)}
                      height={bh}
                      rx="3"
                      fill={bar.color}
                      fillOpacity={isHov ? 1 : 0.88}
                    />
                    {isHov && (
                      <text
                        x={bx + (barW - 3) / 2}
                        y={by - 6}
                        textAnchor="middle"
                        className="fill-slate-100 text-[10px] font-mono font-semibold tabular-nums"
                      >
                        {bar.value.toFixed(1)}
                        {unit}
                      </text>
                    )}
                  </g>
                );
              })}
              <text
                x={padL + gi * groupSlot + groupSlot / 2}
                y={h - 10}
                textAnchor="middle"
                className="fill-slate-300 text-[11px] font-medium"
              >
                {g.groupLabel}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

interface RadialGaugeProps {
  label: string;
  valuePct: number;
  sublabel: string;
  accentColor?: string;
}

export const RadialGauge: React.FC<RadialGaugeProps> = ({
  label,
  valuePct,
  sublabel,
  accentColor = '#6366F1',
}) => {
  const clamped = Math.max(0, Math.min(100, valuePct));
  const r = 48;
  const c = 2 * Math.PI * r;
  const dash = (clamped / 100) * c;

  return (
    <div className="rounded-xl bg-[#0F162E] border border-slate-800/80 p-5 flex items-center gap-5">
      <div className="relative w-28 h-28 shrink-0 flex items-center justify-center">
        <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
          <circle
            cx="60"
            cy="60"
            r={r}
            fill="none"
            stroke="#1E294B"
            strokeWidth="10"
          />
          <circle
            cx="60"
            cy="60"
            r={r}
            fill="none"
            stroke={accentColor}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${c}`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold font-mono tabular-nums text-slate-100">
            {clamped.toFixed(1)}%
          </span>
        </div>
      </div>
      <div>
        <div className="text-sm font-semibold text-slate-100">{label}</div>
        <div className="text-xs text-slate-400 mt-1 leading-relaxed">{sublabel}</div>
      </div>
    </div>
  );
};

interface ParetoScatterChartProps {
  title: string;
  subtitle?: string;
  points: ParetoPoint[];
  height?: number;
}

const POLICY_COLORS: Record<string, string> = {
  BASELINE_CURRENT: '#EF4444',
  BASELINE_BEST_STATIC: '#F59E0B',
  QUEUE_AWARE: '#38BDF8',
  ADAPTIVE_HEADWAY: '#A855F7',
  COMBINED: '#10B981',
};

export const ParetoScatterChart: React.FC<ParetoScatterChartProps> = ({
  title,
  subtitle,
  points,
  height = 260,
}) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const w = 680;
  const h = height;
  const padL = 50;
  const padR = 22;
  const padT = 20;
  const padB = 36;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const waits = points.map((p) => p.avg_wait_min);
  const utils = points.map((p) => p.utilization_pct);
  const maxX = Math.max(10, ...waits) * 1.1;
  const minY = Math.max(0, Math.floor(Math.min(20, ...utils) / 10) * 10);
  const maxY = Math.min(100, Math.ceil(Math.max(70, ...utils) / 10) * 10 + 5);

  const getX = (v: number) => padL + (v / maxX) * plotW;
  const getY = (v: number) => padT + plotH - ((v - minY) / Math.max(1, maxY - minY)) * plotH;

  const combSweep = points
    .filter((p) => p.policy === 'COMBINED')
    .sort((a, b) => a.avg_wait_min - b.avg_wait_min);

  const bsSweep = points
    .filter((p) => p.policy === 'BASELINE_BEST_STATIC')
    .sort((a, b) => a.avg_wait_min - b.avg_wait_min);

  const hovered = hoveredIdx !== null ? points[hoveredIdx] : null;

  return (
    <div className="rounded-xl bg-[#0F162E] border border-slate-800/80 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
          {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
        <div className="text-[11px] font-mono text-emerald-300">
          Ideal Corner: Top-Left (Low Wait + High Pax Utilization)
        </div>
      </div>

      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto overflow-visible select-none">
        {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
          const y = padT + plotH * (1 - f);
          const yVal = minY + (maxY - minY) * f;
          const x = padL + plotW * f;
          const xVal = maxX * f;
          return (
            <g key={i}>
              <line x1={padL} x2={w - padR} y1={y} y2={y} stroke="#1E294B" strokeDasharray={i === 0 ? undefined : '3 3'} />
              <text x={padL - 8} y={y + 3.5} textAnchor="end" className="fill-slate-400 text-[10px] font-mono tabular-nums">
                {yVal.toFixed(0)}%
              </text>
              <line x1={x} x2={x} y1={padT} y2={padT + plotH} stroke="#1E294B" strokeDasharray={i === 0 ? undefined : '3 3'} />
              <text x={x} y={h - 16} textAnchor="middle" className="fill-slate-400 text-[10px] font-mono tabular-nums">
                {xVal.toFixed(1)}m
              </text>
            </g>
          );
        })}

        <text x={w / 2} y={h - 2} textAnchor="middle" className="fill-slate-400 text-[10px] font-sans">
          Average Passenger Waiting Time (min, lower is better)
        </text>
        <text
          x={14}
          y={padT + plotH / 2}
          transform={`rotate(-90 14 ${padT + plotH / 2})`}
          textAnchor="middle"
          className="fill-slate-400 text-[10px] font-sans"
        >
          Passenger-Carrying Utilization (%)
        </text>

        {bsSweep.length > 1 && (
          <polyline
            fill="none"
            stroke="#F59E0B"
            strokeWidth="1.6"
            strokeDasharray="4 4"
            strokeOpacity="0.6"
            points={bsSweep.map((p) => `${getX(p.avg_wait_min).toFixed(1)},${getY(p.utilization_pct).toFixed(1)}`).join(' ')}
          />
        )}

        {combSweep.length > 1 && (
          <polyline
            fill="none"
            stroke="#10B981"
            strokeWidth="2.2"
            points={combSweep.map((p) => `${getX(p.avg_wait_min).toFixed(1)},${getY(p.utilization_pct).toFixed(1)}`).join(' ')}
          />
        )}

        {points.map((pt, idx) => {
          const cx = getX(pt.avg_wait_min);
          const cy = getY(pt.utilization_pct);
          const color = POLICY_COLORS[pt.policy] ?? '#6366F1';
          const isC10 = pt.fleet_size === 10;
          const isHov = hoveredIdx === idx;
          return (
            <g
              key={`${pt.policy}-${pt.fleet_size}-${idx}`}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              className="cursor-pointer"
            >
              <circle
                cx={cx}
                cy={cy}
                r={isHov ? 8 : isC10 ? 6 : 4.2}
                fill={color}
                stroke={isC10 ? '#F8FAFC' : '#0F162E'}
                strokeWidth={isC10 ? 1.8 : 1.2}
              />
              {(isC10 || pt.fleet_size === 6 || pt.fleet_size === 12) && (
                <text
                  x={cx + 8}
                  y={cy - 5}
                  className="fill-slate-300 text-[9px] font-mono tabular-nums"
                >
                  {pt.policy === 'COMBINED'
                    ? `Comb c=${pt.fleet_size}`
                    : pt.policy === 'BASELINE_BEST_STATIC'
                    ? `Best c=${pt.fleet_size}`
                    : pt.label.replace(` (c=${pt.fleet_size})`, '')}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {hovered && (
        <div className="mt-2 flex flex-wrap items-center gap-4 text-xs font-mono tabular-nums text-slate-300 bg-[#0B1021] border border-slate-800 rounded-lg px-3 py-1.5">
          <span className="text-slate-100 font-semibold">{hovered.label}</span>
          <span>Wait: <strong className="text-emerald-300">{hovered.avg_wait_min}m</strong></span>
          <span>Pax Util: <strong className="text-indigo-300">{hovered.utilization_pct}%</strong></span>
          <span>Empty-Run Ratio: <strong className="text-amber-300">{hovered.empty_run_ratio_pct}%</strong></span>
          <span>Load Factor: <strong className="text-slate-100">{hovered.load_factor_pct}%</strong></span>
        </div>
      )}
    </div>
  );
};

