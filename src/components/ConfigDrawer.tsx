import React, { useState } from 'react';
import { Play, RotateCcw, Search, Upload, X } from 'lucide-react';
import {
  gridSearchBestStaticTimetable,
  parseArrivalCsv,
  SAMPLE_FIELD_CSV,
} from '../sim/analytics';
import { POLICY_CATALOG } from '../sim/policies';
import { DEFAULT_CONFIG, DispatchPolicy, SimConfig } from '../sim/types';

interface ConfigDrawerProps {
  open: boolean;
  onClose: () => void;
  config: SimConfig;
  onApply: (next: SimConfig) => void;
}

export const ConfigDrawer: React.FC<ConfigDrawerProps> = ({
  open,
  onClose,
  config,
  onApply,
}) => {
  const [draft, setDraft] = useState<SimConfig>(config);
  const [csvText, setCsvText] = useState('');
  const [csvError, setCsvError] = useState<string | null>(null);
  const [gridStatus, setGridStatus] = useState<string | null>(null);

  if (!open) return null;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result ?? '');
      setCsvText(content);
      try {
        const parsed = parseArrivalCsv(content, file.name);
        setDraft((d) => ({ ...d, calibratedArrivals: parsed }));
        setCsvError(null);
      } catch (err) {
        setCsvError(err instanceof Error ? err.message : 'Invalid CSV format');
      }
    };
    reader.readAsText(file);
  };

  const handleApplyCsvText = () => {
    try {
      const parsed = parseArrivalCsv(csvText, 'Pasted Field CSV');
      setDraft((d) => ({ ...d, calibratedArrivals: parsed }));
      setCsvError(null);
    } catch (err) {
      setCsvError(err instanceof Error ? err.message : 'Invalid CSV format');
    }
  };

  const handleRunGridSearch = () => {
    const gs = gridSearchBestStaticTimetable(draft);
    setDraft((d) => ({ ...d, bestStaticSchedule: gs.bestSchedule }));
    setGridStatus(
      `Found optimal static timetable: ${gs.bestSchedule.offPeakHeadway}m off-peak / ${gs.bestSchedule.morningPeakHeadway}m AM / ${gs.bestSchedule.afternoonPeakHeadway}m PM (avg wait ${gs.topCandidates[0].avgWaitTime}m)`
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onApply(draft);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} />
      <aside className="relative z-10 w-full max-w-lg bg-[#0B1023] border-l border-slate-800 h-full flex flex-col">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Simulation &amp; Calibration Configuration
            </h2>
            <p className="text-xs text-slate-400">
              Adjust fleet parameters or import 5-minute empirical CSV arrival counts.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close configuration drawer"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="space-y-4">
            <RangeRow
              label="Fleet Size (c)"
              value={draft.fleetSize}
              min={4}
              max={20}
              step={1}
              unit=" buses"
              onChange={(v) => setDraft((d) => ({ ...d, fleetSize: v }))}
            />
            <RangeRow
              label="Bus Capacity (K)"
              value={draft.busCapacity}
              min={25}
              max={75}
              step={5}
              unit=" pax"
              onChange={(v) => setDraft((d) => ({ ...d, busCapacity: v }))}
            />
            <RangeRow
              label="Arrival Intensity Multiplier"
              value={draft.arrivalMultiplier}
              min={0.5}
              max={1.8}
              step={0.05}
              unit="x"
              onChange={(v) => setDraft((d) => ({ ...d, arrivalMultiplier: v }))}
            />
            <RangeRow
              label="Traffic Delay Severity"
              value={draft.trafficSeverity}
              min={0}
              max={2.0}
              step={0.1}
              unit="x"
              onChange={(v) => setDraft((d) => ({ ...d, trafficSeverity: v }))}
            />
            <RangeRow
              label="CRN Replications (n)"
              value={draft.replications}
              min={5}
              max={40}
              step={5}
              unit=" runs"
              onChange={(v) => setDraft((d) => ({ ...d, replications: v }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Playback Policy
              </label>
              <select
                value={draft.policy}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, policy: e.target.value as DispatchPolicy }))
                }
                className="w-full rounded-lg bg-[#090E1E] border border-slate-700 px-3 py-2 text-xs text-slate-100"
              >
                {(Object.keys(POLICY_CATALOG) as DispatchPolicy[]).map((p) => (
                  <option key={p} value={p}>
                    {POLICY_CATALOG[p].shortName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Master Seed
              </label>
              <input
                type="number"
                min={1}
                value={draft.seed}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, seed: Math.max(1, Number(e.target.value) || 42) }))
                }
                className="w-full rounded-lg bg-[#090E1E] border border-slate-700 px-3 py-2 text-xs font-mono text-slate-100"
              />
            </div>
          </div>

          <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.suddenSurgeEnabled}
              onChange={(e) =>
                setDraft((d) => ({ ...d, suddenSurgeEnabled: e.target.checked }))
              }
              className="w-4 h-4 accent-indigo-600 rounded"
            />
            <span>Enable Sudden Surge (+120 pax burst at 11:30 AM)</span>
          </label>

          <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(draft.breakdownEnabled)}
              onChange={(e) =>
                setDraft((d) => ({ ...d, breakdownEnabled: e.target.checked }))
              }
              className="w-4 h-4 accent-rose-600 rounded"
            />
            <span>Simulate Bus Breakdown (PT-01 out-of-service for 60 min at 08:15 AM)</span>
          </label>

          {/* Best-Tuned Static Grid Search Box */}
          <div className="rounded-lg bg-[#090E1E] border border-slate-800 p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-slate-200">
                Best-Tuned Static Timetable Benchmark
              </div>
              <button
                type="button"
                onClick={handleRunGridSearch}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#161F3E] hover:bg-[#1E2A52] text-indigo-200 text-[11px] font-medium border border-slate-700 cursor-pointer"
              >
                <Search className="w-3 h-3" />
                <span>Re-Run Grid Search</span>
              </button>
            </div>
            <div className="text-xs font-mono text-slate-300">
              Off-Peak: {draft.bestStaticSchedule.offPeakHeadway}m · AM Peak:{' '}
              {draft.bestStaticSchedule.morningPeakHeadway}m · PM Peak:{' '}
              {draft.bestStaticSchedule.afternoonPeakHeadway}m
            </div>
            {gridStatus && <div className="text-[11px] text-emerald-300">{gridStatus}</div>}
          </div>

          {/* CSV Field Data Calibration */}
          <div className="rounded-lg bg-[#090E1E] border border-slate-800 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-slate-200">
                Empirical Field CSV Import (5-Min Arrival Counts)
              </div>
              {draft.calibratedArrivals ? (
                <button
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, calibratedArrivals: null }))}
                  className="text-[11px] text-amber-300 hover:underline cursor-pointer"
                >
                  Clear CSV (Revert to Synthetic)
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setCsvText(SAMPLE_FIELD_CSV);
                    const parsed = parseArrivalCsv(SAMPLE_FIELD_CSV, 'Sample 3-Day Field CSV');
                    setDraft((d) => ({ ...d, calibratedArrivals: parsed }));
                    setCsvError(null);
                  }}
                  className="text-[11px] text-indigo-300 hover:underline cursor-pointer"
                >
                  Load Sample Field CSV
                </button>
              )}
            </div>

            <label className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-700 hover:border-indigo-500 text-xs text-slate-300 cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              <span>Upload CSV (`time_min,stc_count,mg_count`)</span>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>

            <textarea
              rows={3}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder="time_min,stc_count,mg_count&#10;30,22,56&#10;60,25,68"
              className="w-full rounded-lg bg-[#060914] border border-slate-800 p-2 text-[11px] font-mono text-slate-300"
            />
            {csvText.trim().length > 0 && (
              <button
                type="button"
                onClick={handleApplyCsvText}
                className="px-3 py-1.5 rounded bg-[#161F3E] text-slate-200 text-xs border border-slate-700 cursor-pointer"
              >
                Parse Pasted CSV
              </button>
            )}
            {csvError && <div className="text-[11px] text-rose-400">{csvError}</div>}
            {draft.calibratedArrivals && (
              <div className="text-[11px] text-emerald-300">
                Active Calibration: {draft.calibratedArrivals.sourceName} (
                {draft.calibratedArrivals.stcRatesPerMin.length} bins)
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                setDraft(DEFAULT_CONFIG);
                setCsvText('');
                setCsvError(null);
                setGridStatus(null);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#161F3E] text-slate-300 text-xs border border-slate-700 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Defaults</span>
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Apply &amp; Run 30-Rep Suite</span>
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
};

const RangeRow: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, step, unit, onChange }) => (
  <div>
    <div className="flex justify-between text-xs mb-1.5">
      <span className="text-slate-300 font-medium">{label}</span>
      <span className="font-mono text-indigo-300 tabular-nums">
        {value}
        {unit}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full accent-indigo-500 cursor-pointer"
    />
  </div>
);
