import React, { useMemo, useState } from 'react';
import { runTerminalCongestionHeatmap } from '../sim/analytics';
import { POLICY_CATALOG } from '../sim/policies';
import { DispatchPolicy, SimConfig, TerminalId } from '../sim/types';

interface TerminalCongestionHeatmapProps {
  config: SimConfig;
}

type HeatmapMetric = 'avg_wait' | 'p95_wait' | 'max_queue';
type AxisMode = 'weekday_shifts' | 'crn_days';

interface HoveredCellInfo {
  terminal: TerminalId;
  dayLabel: string;
  shiftNote: string;
  slotLabel: string;
  avgWait: number;
  p95Wait: number;
  maxQueue: number;
  paxCount: number;
}

function getHeatColor(value: number, metric: HeatmapMetric): {
  bg: string;
  text: string;
  severity: string;
} {
  if (metric === 'max_queue') {
    if (value >= 90) return { bg: 'bg-rose-600/85', text: 'text-white', severity: 'Critical' };
    if (value >= 55) return { bg: 'bg-amber-600/80', text: 'text-white', severity: 'High' };
    if (value >= 30) return { bg: 'bg-indigo-600/75', text: 'text-slate-100', severity: 'Elevated' };
    if (value >= 12) return { bg: 'bg-indigo-950/90', text: 'text-indigo-200', severity: 'Moderate' };
    return { bg: 'bg-[#0A1124]', text: 'text-slate-400', severity: 'Nominal' };
  }

  // Wait-time scale (minutes) for Avg Wait and P95 Wait
  const scale = metric === 'p95_wait' ? 1.8 : 1.0;
  if (value >= 25 * scale) {
    return { bg: 'bg-rose-600/85', text: 'text-white', severity: 'Severe' };
  }
  if (value >= 14 * scale) {
    return { bg: 'bg-amber-600/80', text: 'text-white', severity: 'High' };
  }
  if (value >= 7 * scale) {
    return { bg: 'bg-indigo-600/75', text: 'text-slate-100', severity: 'Moderate' };
  }
  if (value >= 3 * scale) {
    return { bg: 'bg-indigo-950/90', text: 'text-indigo-200', severity: 'Light' };
  }
  return { bg: 'bg-[#0A1124]', text: 'text-slate-400', severity: 'Low' };
}

export const TerminalCongestionHeatmap: React.FC<TerminalCongestionHeatmapProps> = ({
  config,
}) => {
  const [policy, setPolicy] = useState<DispatchPolicy>('BASELINE_BEST_STATIC');
  const [metric, setMetric] = useState<HeatmapMetric>('avg_wait');
  const [axisMode, setAxisMode] = useState<AxisMode>('weekday_shifts');
  const [hovered, setHovered] = useState<HoveredCellInfo | null>(null);

  const days = useMemo(
    () => runTerminalCongestionHeatmap(config, policy, axisMode),
    [config, policy, axisMode]
  );

  const slotHeaders = days[0]?.slots.map((s) => s.slotLabel) ?? [];

  // Identify worst stress cell across both terminals
  const peakStress = useMemo(() => {
    let worst: HoveredCellInfo | null = null;
    let worstVal = -1;

    for (const day of days) {
      for (const slot of day.slots) {
        const stcVal =
          metric === 'avg_wait'
            ? slot.stcAvgWait
            : metric === 'p95_wait'
            ? slot.stcP95Wait
            : slot.stcMaxQueue;
        if (stcVal > worstVal) {
          worstVal = stcVal;
          worst = {
            terminal: 'STC',
            dayLabel: day.dayLabel,
            shiftNote: day.shiftNote,
            slotLabel: slot.slotLabel,
            avgWait: slot.stcAvgWait,
            p95Wait: slot.stcP95Wait,
            maxQueue: slot.stcMaxQueue,
            paxCount: slot.stcPaxCount,
          };
        }

        const mgVal =
          metric === 'avg_wait'
            ? slot.mainGateAvgWait
            : metric === 'p95_wait'
            ? slot.mainGateP95Wait
            : slot.mainGateMaxQueue;
        if (mgVal > worstVal) {
          worstVal = mgVal;
          worst = {
            terminal: 'MAIN_GATE',
            dayLabel: day.dayLabel,
            shiftNote: day.shiftNote,
            slotLabel: slot.slotLabel,
            avgWait: slot.mainGateAvgWait,
            p95Wait: slot.mainGateP95Wait,
            maxQueue: slot.mainGateMaxQueue,
            paxCount: slot.mainGatePaxCount,
          };
        }
      }
    }
    return worst;
  }, [days, metric]);

  const metricUnit = metric === 'max_queue' ? 'pax' : 'm';

  const renderTerminalMatrix = (terminal: TerminalId, title: string, subtitle: string) => (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-xs font-semibold text-slate-200">{title}</div>
        <div className="text-[11px] text-slate-400">{subtitle}</div>
      </div>

      <div className="overflow-x-auto pb-1">
        <table className="w-full border-separate border-spacing-1 text-[11px]">
          <thead>
            <tr>
              <th className="text-left font-medium text-slate-400 pr-2 py-1 min-w-[68px]">
                {axisMode === 'weekday_shifts' ? 'Shift' : 'Run'}
              </th>
              {slotHeaders.map((lbl) => (
                <th
                  key={lbl}
                  className="font-mono font-normal text-slate-400 text-center py-1 min-w-[40px] tabular-nums"
                >
                  {lbl}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={`${terminal}-${day.dayLabel}`}>
                <td
                  className="font-medium text-slate-200 pr-2 whitespace-nowrap"
                  title={day.shiftNote}
                >
                  <div>{day.dayLabel}</div>
                  {axisMode === 'weekday_shifts' && (
                    <div className="text-[10px] font-mono text-slate-400 tabular-nums">
                      {day.demandFactor.toFixed(2)}x
                    </div>
                  )}
                </td>
                {day.slots.map((slot) => {
                  const avgWait = terminal === 'STC' ? slot.stcAvgWait : slot.mainGateAvgWait;
                  const p95Wait = terminal === 'STC' ? slot.stcP95Wait : slot.mainGateP95Wait;
                  const maxQueue = terminal === 'STC' ? slot.stcMaxQueue : slot.mainGateMaxQueue;
                  const paxCount = terminal === 'STC' ? slot.stcPaxCount : slot.mainGatePaxCount;
                  const val =
                    metric === 'avg_wait'
                      ? avgWait
                      : metric === 'p95_wait'
                      ? p95Wait
                      : maxQueue;

                  const style = getHeatColor(val, metric);
                  const isHovered =
                    hovered?.terminal === terminal &&
                    hovered?.dayLabel === day.dayLabel &&
                    hovered?.slotLabel === slot.slotLabel;

                  return (
                    <td key={slot.slotLabel} className="p-0">
                      <button
                        type="button"
                        onMouseEnter={() =>
                          setHovered({
                            terminal,
                            dayLabel: day.dayLabel,
                            shiftNote: day.shiftNote,
                            slotLabel: slot.slotLabel,
                            avgWait,
                            p95Wait,
                            maxQueue,
                            paxCount,
                          })
                        }
                        onFocus={() =>
                          setHovered({
                            terminal,
                            dayLabel: day.dayLabel,
                            shiftNote: day.shiftNote,
                            slotLabel: slot.slotLabel,
                            avgWait,
                            p95Wait,
                            maxQueue,
                            paxCount,
                          })
                        }
                        className={`w-full h-9 rounded flex items-center justify-center font-mono tabular-nums text-[11px] font-medium transition-transform cursor-pointer ${
                          style.bg
                        } ${style.text} ${
                          isHovered ? 'ring-2 ring-white scale-[1.04] z-10 relative' : 'border border-slate-800/60'
                        }`}
                        aria-label={`${title} ${day.dayLabel} ${slot.slotLabel}: ${val} ${metricUnit}`}
                      >
                        {metric === 'max_queue' ? Math.round(val) : val.toFixed(0)}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <section className="rounded-xl bg-[#0F162E] border border-slate-800/80 p-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-slate-100">
            Terminal Congestion Heatmap Across Days &amp; 30-Minute Shifts
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Pinpoints high-wait stress periods at STC and Main Gate across simulated weekday demand profiles or CRN replications.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Policy Toggle */}
          <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-[#090E1E] border border-slate-800">
            {(
              [
                'BASELINE_CURRENT',
                'BASELINE_BEST_STATIC',
                'QUEUE_AWARE',
                'ADAPTIVE_HEADWAY',
                'COMBINED',
              ] as DispatchPolicy[]
            ).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPolicy(p)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  policy === p
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {POLICY_CATALOG[p].shortName}
              </button>
            ))}
          </div>

          {/* Metric Toggle */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[#090E1E] border border-slate-800">
            {(
              [
                ['avg_wait', 'Avg Wait (m)'],
                ['p95_wait', 'P95 Wait (m)'],
                ['max_queue', 'Peak Queue (pax)'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setMetric(id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  metric === id
                    ? 'bg-violet-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Axis Mode Toggle */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[#090E1E] border border-slate-800">
            <button
              type="button"
              onClick={() => setAxisMode('weekday_shifts')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                axisMode === 'weekday_shifts'
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Mon–Fri Shifts
            </button>
            <button
              type="button"
              onClick={() => setAxisMode('crn_days')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                axisMode === 'crn_days'
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              CRN Runs 1–5
            </button>
          </div>
        </div>
      </div>

      {/* STC & Main Gate Matrices */}
      <div className="space-y-6">
        {renderTerminalMatrix(
          'STC',
          'STC Terminal — 30-Minute Congestion Matrix',
          'Afternoon outbound peak (14:00–15:30)'
        )}
        {renderTerminalMatrix(
          'MAIN_GATE',
          'Main Gate Terminal — 30-Minute Congestion Matrix',
          'Morning inbound peak (08:00–09:00)'
        )}
      </div>

      {/* Legend & Live Cell Inspector Strip */}
      <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex flex-wrap items-center gap-3 text-slate-400">
          <span className="font-medium text-slate-300">Stress Scale:</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-[#0A1124] border border-slate-700" />
            <span>Low</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-indigo-950 border border-slate-700" />
            <span>Light</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-indigo-600/75" />
            <span>Moderate</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-amber-600/80" />
            <span>High</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-rose-600/85" />
            <span>Severe</span>
          </span>
        </div>

        <div className="font-mono tabular-nums text-slate-300 bg-[#090E1E] border border-slate-800 rounded-lg px-3 py-1.5">
          {hovered ? (
            <span>
              {hovered.terminal === 'STC' ? 'STC' : 'Main Gate'} · {hovered.dayLabel} @{' '}
              {hovered.slotLabel} | Avg: {hovered.avgWait}m · P95: {hovered.p95Wait}m · MaxQ:{' '}
              {hovered.maxQueue} pax · {hovered.paxCount} arrivals
            </span>
          ) : peakStress ? (
            <span>
              Peak Stress Point: {peakStress.terminal === 'STC' ? 'STC' : 'Main Gate'} ·{' '}
              {peakStress.dayLabel} @ {peakStress.slotLabel} (Avg {peakStress.avgWait}m, P95{' '}
              {peakStress.p95Wait}m, MaxQ {peakStress.maxQueue} pax)
            </span>
          ) : (
            <span>Hover any time cell to inspect exact waiting &amp; queue metrics.</span>
          )}
        </div>
      </div>
    </section>
  );
};
