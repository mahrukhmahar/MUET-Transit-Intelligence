import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bus as BusIcon,
  Pause,
  Play,
  RotateCcw,
} from 'lucide-react';
import { getBestStaticHeadwayAtTime, POLICY_CATALOG } from '../sim/policies';
import { DispatchPolicy, SingleRunResult, TimeSeriesPoint } from '../sim/types';

interface LivePlaybackProps {
  baselineRun: SingleRunResult;
  activeRun: SingleRunResult;
  activePolicy: DispatchPolicy;
  onSelectPolicy: (policy: DispatchPolicy) => void;
}

function getDemandRegime(tMinutes: number): { label: string; colorClass: string } {
  if (tMinutes >= 30 && tMinutes <= 90) {
    return { label: 'Morning Peak (08:00–09:00)', colorClass: 'text-amber-300' };
  }
  if (tMinutes >= 390 && tMinutes <= 480) {
    return { label: 'Afternoon Peak (14:00–15:30)', colorClass: 'text-rose-300' };
  }
  return { label: 'Off-Peak / Regular Flow', colorClass: 'text-emerald-300' };
}

export const LivePlayback: React.FC<LivePlaybackProps> = ({
  activeRun,
  activePolicy,
  onSelectPolicy,
}) => {
  const [stepIdx, setStepIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 2 | 5 | 10>(2);

  const series = activeRun.timeSeries;
  const maxStep = Math.max(0, series.length - 1);

  useEffect(() => {
    setStepIdx(0);
    setIsPlaying(false);
  }, [activeRun]);

  useEffect(() => {
    if (!isPlaying) return;
    const intervalMs = Math.max(80, Math.round(700 / speed));
    const timer = window.setInterval(() => {
      setStepIdx((prev) => {
        if (prev >= maxStep) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [isPlaying, speed, maxStep]);

  const snap: TimeSeriesPoint = series[stepIdx] ?? {
    time: 0,
    clockLabel: '07:30',
    stcQueue: 0,
    mainGateQueue: 0,
    stcArrivalRate: 0,
    mainGateArrivalRate: 0,
    totalThroughput: 0,
    activeBusesInTransit: 0,
    avgOccupancyPct: 0,
    stcAvailableBuses: 0,
    mainGateAvailableBuses: 0,
    busSnapshots: [],
  };

  const regime = getDemandRegime(snap.time);
  const recentLogs = activeRun.decisionLogs
    .filter((l) => l.time <= snap.time)
    .slice(-10)
    .reverse();

  const stcIdleBuses = snap.busSnapshots.filter(
    (b) => b.state === 'IDLE_AT_TERMINAL' && b.origin === 'STC'
  );
  const mgIdleBuses = snap.busSnapshots.filter(
    (b) => b.state === 'IDLE_AT_TERMINAL' && b.origin === 'MAIN_GATE'
  );
  const outOfServiceBuses = snap.busSnapshots.filter(
    (b) => b.state === 'OUT_OF_SERVICE'
  );
  const transitBuses = snap.busSnapshots.filter(
    (b) => b.state !== 'IDLE_AT_TERMINAL' && b.state !== 'OUT_OF_SERVICE'
  );

  const activeStaticHeadway =
    activePolicy === 'BASELINE_CURRENT'
      ? activeRun.config.baselineHeadwayMinutes
      : activePolicy === 'BASELINE_BEST_STATIC'
      ? getBestStaticHeadwayAtTime(snap.time, activeRun.config.bestStaticSchedule)
      : null;

  const estNextStcDispatch =
    activeStaticHeadway !== null
      ? `${Math.max(0, activeStaticHeadway - (snap.time % activeStaticHeadway)).toFixed(0)} min (Fixed ${activeStaticHeadway}m)`
      : snap.stcAvailableBuses === 0
      ? 'Awaiting incoming bus'
      : snap.stcQueue >= Math.round(activeRun.config.busCapacity * 0.65)
      ? 'Immediate trigger'
      : 'Dynamic (demand-triggered)';

  const estNextMgDispatch =
    activeStaticHeadway !== null
      ? `${Math.max(0, activeStaticHeadway - (snap.time % activeStaticHeadway)).toFixed(0)} min (Fixed ${activeStaticHeadway}m)`
      : snap.mainGateAvailableBuses === 0
      ? 'Awaiting incoming bus'
      : snap.mainGateQueue >= Math.round(activeRun.config.busCapacity * 0.65)
      ? 'Immediate trigger'
      : 'Dynamic (demand-triggered)';

  return (
    <div className="space-y-6">
      {/* Control Toolbar */}
      <div className="rounded-xl bg-[#0F162E] border border-slate-800/80 p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (stepIdx >= maxStep) setStepIdx(0);
              setIsPlaying((p) => !p);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{isPlaying ? 'Pause' : stepIdx >= maxStep ? 'Replay' : 'Start Simulation'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setIsPlaying(false);
              setStepIdx(0);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#161F3E] hover:bg-[#1E2A52] text-slate-200 text-xs font-medium border border-slate-700/70 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>

          <div className="flex items-center gap-1 p-1 rounded-lg bg-[#090E1E] border border-slate-800">
            {([1, 2, 5, 10] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                className={`px-2.5 py-1 text-xs font-mono rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  speed === s
                    ? 'bg-indigo-600 text-white font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="text-xs text-slate-400">
            <span>Simulated Clock: </span>
            <span className="font-mono font-bold text-base text-slate-100 tabular-nums ml-1">
              {snap.clockLabel}
            </span>
            <span className="mx-2 text-slate-600">·</span>
            <span className={`font-medium ${regime.colorClass}`}>{regime.label}</span>
          </div>

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
                onClick={() => onSelectPolicy(p)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  activePolicy === p
                    ? 'bg-violet-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {POLICY_CATALOG[p].shortName}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Time Scrubber */}
      <div className="rounded-xl bg-[#0F162E] border border-slate-800/80 px-5 py-3 flex items-center gap-4">
        <span className="text-xs font-mono text-slate-400 tabular-nums whitespace-nowrap">
          07:30
        </span>
        <input
          type="range"
          min={0}
          max={maxStep}
          value={stepIdx}
          onChange={(e) => {
            setIsPlaying(false);
            setStepIdx(Number(e.target.value));
          }}
          aria-label="Simulation timeline scrubber"
          className="w-full accent-indigo-500 cursor-pointer"
        />
        <span className="text-xs font-mono text-slate-400 tabular-nums whitespace-nowrap">
          {series[maxStep]?.clockLabel ?? '16:00'}
        </span>
        <span className="text-xs font-mono text-indigo-300 tabular-nums whitespace-nowrap">
          Served: {snap.totalThroughput} pax
        </span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Corridor Transit Visualization */}
          <div className="xl:col-span-2 rounded-xl bg-[#0F162E] border border-slate-800/80 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">
                  Simulated Corridor Playback — {POLICY_CATALOG[activePolicy].shortName}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Optional Visualizer Over Canonical Python Exports (Synthetic MUET Jamshoro parameters · Not live GPS)
                </p>
              </div>
              <div className="text-xs text-slate-400 font-mono tabular-nums">
                In Transit: {snap.activeBusesInTransit} · Avg Load: {snap.avgOccupancyPct}%{outOfServiceBuses.length > 0 ? ` · Out of Service: ${outOfServiceBuses.length}` : ''}
              </div>
            </div>

            {/* Interactive SVG Transit Corridor */}
            <div className="rounded-lg bg-[#080D1D] border border-slate-800/90 p-4">
              <svg viewBox="0 0 760 280" className="w-full h-auto">
                {/* Road Lanes */}
                <line
                  x1="150"
                  y1="100"
                  x2="610"
                  y2="100"
                  stroke="#312E81"
                  strokeWidth="16"
                  strokeLinecap="round"
                />
                <line
                  x1="150"
                  y1="100"
                  x2="610"
                  y2="100"
                  stroke="#6366F1"
                  strokeWidth="1.5"
                  strokeDasharray="8 8"
                />
                <text
                  x="380"
                  y="78"
                  textAnchor="middle"
                  className="fill-slate-400 text-[10px] font-mono"
                >
                  Eastbound: STC → Main Gate →
                </text>

                <line
                  x1="150"
                  y1="185"
                  x2="610"
                  y2="185"
                  stroke="#312E81"
                  strokeWidth="16"
                  strokeLinecap="round"
                />
                <line
                  x1="150"
                  y1="185"
                  x2="610"
                  y2="185"
                  stroke="#8B5CF6"
                  strokeWidth="1.5"
                  strokeDasharray="8 8"
                />
                <text
                  x="380"
                  y="214"
                  textAnchor="middle"
                  className="fill-slate-400 text-[10px] font-mono"
                >
                  ← Westbound: Main Gate → STC
                </text>

                {/* STC Terminal Box */}
                <rect
                  x="16"
                  y="42"
                  width="138"
                  height="196"
                  rx="10"
                  fill="#121A36"
                  stroke={snap.stcQueue > activeRun.config.busCapacity ? '#F59E0B' : '#334173'}
                  strokeWidth="1.5"
                />
                <text
                  x="85"
                  y="68"
                  textAnchor="middle"
                  className="fill-slate-100 text-[13px] font-semibold"
                >
                  STC Terminal
                </text>
                <text
                  x="85"
                  y="86"
                  textAnchor="middle"
                  className="fill-slate-400 text-[10px] font-mono"
                >
                  λ={snap.stcArrivalRate.toFixed(1)} pax/m
                </text>

                {/* STC Queue Bar */}
                <text
                  x="30"
                  y="114"
                  className="fill-slate-300 text-[11px] font-medium"
                >
                  Queue: {snap.stcQueue} pax
                </text>
                <rect x="30" y="122" width="110" height="12" rx="4" fill="#1E294B" />
                <rect
                  x="30"
                  y="122"
                  width={Math.min(110, (snap.stcQueue / 140) * 110)}
                  height="12"
                  rx="4"
                  fill={
                    snap.stcQueue > activeRun.config.busCapacity * 1.2
                      ? '#EF4444'
                      : snap.stcQueue > activeRun.config.busCapacity * 0.7
                      ? '#F59E0B'
                      : '#10B981'
                  }
                />
                <text
                  x="30"
                  y="160"
                  className="fill-slate-400 text-[10px] font-mono"
                >
                  Idle Buses: {stcIdleBuses.length}
                </text>
                <g transform="translate(30, 170)">
                  {stcIdleBuses.slice(0, 6).map((b, idx) => (
                    <g key={b.id} transform={`translate(${(idx % 3) * 36}, ${Math.floor(idx / 3) * 24})`}>
                      <rect width="32" height="18" rx="3" fill="#1E294B" stroke="#6366F1" strokeWidth="1" />
                      <text x="16" y="12" textAnchor="middle" className="fill-indigo-200 text-[8px] font-mono">
                        {b.label}
                      </text>
                    </g>
                  ))}
                </g>

                {/* Main Gate Terminal Box */}
                <rect
                  x="606"
                  y="42"
                  width="138"
                  height="196"
                  rx="10"
                  fill="#121A36"
                  stroke={
                    snap.mainGateQueue > activeRun.config.busCapacity ? '#F59E0B' : '#334173'
                  }
                  strokeWidth="1.5"
                />
                <text
                  x="675"
                  y="68"
                  textAnchor="middle"
                  className="fill-slate-100 text-[13px] font-semibold"
                >
                  Main Gate
                </text>
                <text
                  x="675"
                  y="86"
                  textAnchor="middle"
                  className="fill-slate-400 text-[10px] font-mono"
                >
                  λ={snap.mainGateArrivalRate.toFixed(1)} pax/m
                </text>

                <text
                  x="620"
                  y="114"
                  className="fill-slate-300 text-[11px] font-medium"
                >
                  Queue: {snap.mainGateQueue} pax
                </text>
                <rect x="620" y="122" width="110" height="12" rx="4" fill="#1E294B" />
                <rect
                  x="620"
                  y="122"
                  width={Math.min(110, (snap.mainGateQueue / 140) * 110)}
                  height="12"
                  rx="4"
                  fill={
                    snap.mainGateQueue > activeRun.config.busCapacity * 1.2
                      ? '#EF4444'
                      : snap.mainGateQueue > activeRun.config.busCapacity * 0.7
                      ? '#F59E0B'
                      : '#10B981'
                  }
                />
                <text
                  x="620"
                  y="160"
                  className="fill-slate-400 text-[10px] font-mono"
                >
                  Idle Buses: {mgIdleBuses.length}
                </text>
                <g transform="translate(620, 170)">
                  {mgIdleBuses.slice(0, 6).map((b, idx) => (
                    <g key={b.id} transform={`translate(${(idx % 3) * 36}, ${Math.floor(idx / 3) * 24})`}>
                      <rect width="32" height="18" rx="3" fill="#1E294B" stroke="#8B5CF6" strokeWidth="1" />
                      <text x="16" y="12" textAnchor="middle" className="fill-violet-200 text-[8px] font-mono">
                        {b.label}
                      </text>
                    </g>
                  ))}
                </g>

                {/* Moving Buses along Eastbound and Westbound lanes */}
                {transitBuses.map((b, idx) => {
                  const isEast = b.origin === 'STC';
                  const startX = isEast ? 168 : 562;
                  const endX = isEast ? 562 : 168;
                  const x = startX + (endX - startX) * b.progress;
                  const laneOffset = ((idx % 2) - 0.5) * 14;
                  const y = (isEast ? 100 : 185) + laneOffset;
                  const fillColor = b.isDeadhead
                    ? '#475569'
                    : b.delayed
                    ? '#D97706'
                    : '#4F46E5';
                  return (
                    <g key={b.id} transform={`translate(${x - 24}, ${y - 13})`}>
                      <rect
                        width="48"
                        height="26"
                        rx="5"
                        fill={fillColor}
                        stroke="#E2E8F0"
                        strokeWidth="1"
                      />
                      <text
                        x="24"
                        y="11"
                        textAnchor="middle"
                        className="fill-white text-[8px] font-mono font-bold"
                      >
                        {b.label}
                      </text>
                      <text
                        x="24"
                        y="21"
                        textAnchor="middle"
                        className="fill-indigo-100 text-[8px] font-mono"
                      >
                        {b.isDeadhead ? 'EMPTY' : `${b.passengers}/${b.capacity}`}
                      </text>
                    </g>
                  );
                })}
              </svg>

              <div className="mt-3 flex flex-wrap items-center gap-5 text-xs text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-[#4F46E5]" />
                  <span>Loaded Bus in Transit</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-[#D97706]" />
                  <span>Traffic-Delayed Bus</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-[#475569]" />
                  <span>Empty Repositioning (Deadhead)</span>
                </span>
                {outOfServiceBuses.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-rose-300">
                    <span className="w-3 h-3 rounded bg-rose-600" />
                    <span>Out of Service ({outOfServiceBuses.map((b) => b.label).join(', ')})</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Live Dispatch Decision Stream */}
          <div className="rounded-xl bg-[#0F162E] border border-slate-800/80 p-5 flex flex-col">
            <h3 className="text-sm font-semibold text-slate-100">
              Dispatch &amp; Event Log
            </h3>
            <p className="text-xs text-slate-400 mt-0.5 mb-3">
              Decisions evaluated up to simulated time {snap.clockLabel}
            </p>
            <div className="flex-1 space-y-2.5 overflow-y-auto max-h-[300px] pr-1">
              {recentLogs.length === 0 ? (
                <div className="text-xs text-slate-500 py-8 text-center">
                  Press Start Simulation or scrub timeline to inspect dispatch events.
                </div>
              ) : (
                recentLogs.map((log, i) => (
                  <div
                    key={`${log.time}-${log.busLabel}-${i}`}
                    className="rounded-lg bg-[#090E1E] border border-slate-800/80 p-3 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2 font-mono">
                      <span className="text-indigo-300 font-semibold">
                        {log.busLabel} · {log.terminal === 'STC' ? 'STC' : 'Main Gate'}
                      </span>
                      <span className="text-slate-400 tabular-nums">
                        +{log.time.toFixed(1)}m
                      </span>
                    </div>
                    <div className="mt-1 text-slate-200 leading-snug">{log.reason}</div>
                    <div className="mt-1 text-[11px] text-slate-400 font-mono">
                      Action: {log.action} · Boarded: {log.passengersBoarded} · Queue was{' '}
                      {log.queueAtDecision}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

      {/* Terminal Monitoring Panels (merged cleanly below corridor playback) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* STC Terminal Panel */}
        <div className="rounded-xl bg-[#0F162E] border border-slate-800/80 p-5">
          <div className="flex items-baseline justify-between gap-2 border-b border-slate-800 pb-3 mb-4">
            <div>
              <h3 className="text-base font-semibold text-slate-100">
                STC Terminal Monitor
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Student Teacher Centre Hub · Outbound Afternoon Peak Focus
              </p>
            </div>
            <span className="text-xs font-mono text-indigo-300 tabular-nums">
              {snap.clockLabel}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="rounded-lg bg-[#090E1E] p-3 border border-slate-800/60">
              <div className="text-xs text-slate-400">Simulated Queue</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-100 mt-1">
                {snap.stcQueue}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Peak Max: {activeRun.metrics.stcMaxQueue} pax
              </div>
            </div>

            <div className="rounded-lg bg-[#090E1E] p-3 border border-slate-800/60">
              <div className="text-xs text-slate-400">Arrival Rate (λ)</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-100 mt-1">
                {snap.stcArrivalRate.toFixed(1)}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">passengers / min</div>
            </div>

            <div className="rounded-lg bg-[#090E1E] p-3 border border-slate-800/60">
              <div className="text-xs text-slate-400">Available Buses</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-100 mt-1">
                {snap.stcAvailableBuses}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Avg Queue: {activeRun.metrics.stcAvgQueue} pax
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-slate-400">
              Next Dispatch Status:{' '}
              <span className="text-slate-200 font-medium">{estNextStcDispatch}</span>
            </span>
            {snap.stcQueue > activeRun.config.busCapacity && (
              <span className="inline-flex items-center gap-1 text-amber-300 font-medium">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Queue exceeds 1 bus capacity ({activeRun.config.busCapacity})</span>
              </span>
            )}
          </div>
        </div>

        {/* Main Gate Terminal Panel */}
        <div className="rounded-xl bg-[#0F162E] border border-slate-800/80 p-5">
          <div className="flex items-baseline justify-between gap-2 border-b border-slate-800 pb-3 mb-4">
            <div>
              <h3 className="text-base font-semibold text-slate-100">
                Main Gate Terminal Monitor
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                MUET Main Gate Approach · Morning Peak Inbound Focus
              </p>
            </div>
            <span className="text-xs font-mono text-violet-300 tabular-nums">
              {snap.clockLabel}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="rounded-lg bg-[#090E1E] p-3 border border-slate-800/60">
              <div className="text-xs text-slate-400">Simulated Queue</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-100 mt-1">
                {snap.mainGateQueue}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Peak Max: {activeRun.metrics.mainGateMaxQueue} pax
              </div>
            </div>

            <div className="rounded-lg bg-[#090E1E] p-3 border border-slate-800/60">
              <div className="text-xs text-slate-400">Arrival Rate (λ)</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-100 mt-1">
                {snap.mainGateArrivalRate.toFixed(1)}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">passengers / min</div>
            </div>

            <div className="rounded-lg bg-[#090E1E] p-3 border border-slate-800/60">
              <div className="text-xs text-slate-400">Available Buses</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-100 mt-1">
                {snap.mainGateAvailableBuses}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Avg Queue: {activeRun.metrics.mainGateAvgQueue} pax
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-slate-400">
              Next Dispatch Status:{' '}
              <span className="text-slate-200 font-medium">{estNextMgDispatch}</span>
            </span>
            {snap.mainGateQueue > activeRun.config.busCapacity && (
              <span className="inline-flex items-center gap-1 text-amber-300 font-medium">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Queue exceeds 1 bus capacity ({activeRun.config.busCapacity})</span>
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl bg-[#0F162E] border border-slate-800/80 p-5">
        <div className="flex items-center gap-2 mb-4">
          <BusIcon className="w-4 h-4 text-indigo-400" />
          <h3 className="text-sm font-semibold text-slate-100">
            Active Fleet Unit Telemetry at {snap.clockLabel}
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-2 pr-4 font-medium">Bus Unit</th>
                <th className="py-2 pr-4 font-medium">Operational State</th>
                <th className="py-2 pr-4 font-medium">Location / Corridor</th>
                <th className="py-2 pr-4 font-medium text-right">Current Load</th>
                <th className="py-2 pr-4 font-medium text-right">Trips Completed</th>
                <th className="py-2 font-medium text-right">Day Utilization</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
              {snap.busSnapshots.map((b) => {
                const totalStats = activeRun.busBreakdown.find(
                  (x) => x.busLabel === b.label
                );
                return (
                  <tr key={b.id} className="hover:bg-[#131C3A]">
                    <td className="py-2.5 pr-4 text-slate-100 font-semibold">{b.label}</td>
                    <td className="py-2.5 pr-4 font-sans">
                      <span
                        className={
                          b.state === 'OUT_OF_SERVICE'
                            ? 'text-rose-400 font-semibold'
                            : b.delayed
                            ? 'text-amber-300'
                            : b.isDeadhead
                            ? 'text-slate-300'
                            : b.state === 'IDLE_AT_TERMINAL'
                            ? 'text-slate-400'
                            : 'text-emerald-300'
                        }
                      >
                        {b.state.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 font-sans text-slate-300">
                      {b.state === 'OUT_OF_SERVICE'
                        ? 'Breakdown Maintenance (60 min)'
                        : b.state === 'IDLE_AT_TERMINAL'
                        ? `Parked at ${b.origin === 'STC' ? 'STC' : 'Main Gate'}`
                        : `${b.origin === 'STC' ? 'STC' : 'Main Gate'} → ${
                            b.destination === 'STC' ? 'STC' : 'Main Gate'
                          } (${Math.round(b.progress * 100)}%)`}
                    </td>
                    <td className="py-2.5 pr-4 text-right text-slate-200">
                      {b.passengers}/{b.capacity}
                    </td>
                    <td className="py-2.5 pr-4 text-right text-slate-300">
                      {totalStats?.trips ?? 0}
                    </td>
                    <td className="py-2.5 text-right text-indigo-300">
                      {totalStats?.utilizationPct ?? 0}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
