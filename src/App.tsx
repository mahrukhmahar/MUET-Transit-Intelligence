import React, { useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  FileText,
  GitCompare,
  LayoutDashboard,
  Menu,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  GroupedBarChart,
  InteractiveLineChart,
} from './components/Charts';
import { ConfigDrawer } from './components/ConfigDrawer';
import { LivePlayback } from './components/LivePlayback';

import verifiedDefaults from './data/verified_defaults.json';
import {
  computeCustomAddendumSuite,
  generateEvidenceInsights,
  gridSearchBestStaticTimetable,
  runScenarioComparison,
  runSensitivitySuite,
} from './sim/analytics';
import {
  AblationVariantResult,
  DEFAULT_CONFIG,
  DispatchPolicy,
  GridSearchCandidate,
  ParetoPoint,
  QueuingVerificationSummary,
  ScenarioAggregateResult,
  SensitivitySuite,
  SimConfig,
  WhatIfScenarioResult,
} from './sim/types';
import { runFullVerificationSuite, VerificationTestCase } from './sim/verification';

type NavSection = 'overview' | 'live' | 'scenarios' | 'report';

const NAV_ITEMS: Array<{
  id: NavSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'live', label: 'Live Simulation', icon: Activity },
  { id: 'scenarios', label: 'Scenarios', icon: GitCompare },
  { id: 'report', label: 'Report', icon: FileText },
];

interface SnapshotBundle {
  canonicalEngine?: string;
  config: SimConfig;
  gridSearchTop: GridSearchCandidate[];
  scenarios: ScenarioAggregateResult[];
  sensitivity: SensitivitySuite;
  paretoPoints: ParetoPoint[];
  whatIfScenarios: WhatIfScenarioResult[];
  ablation: AblationVariantResult[];
  queuingVerification: QueuingVerificationSummary;
  verification: VerificationTestCase[];
}

const INITIAL_BUNDLE = verifiedDefaults as unknown as SnapshotBundle;

export default function App() {
  const [activeSection, setActiveSection] = useState<NavSection>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isComputing, setIsComputing] = useState(false);

  const [bundle, setBundle] = useState<SnapshotBundle>(INITIAL_BUNDLE);
  const [playbackPolicy, setPlaybackPolicy] = useState<DispatchPolicy>('COMBINED');

  const {
    canonicalEngine,
    config,
    scenarios,
    sensitivity,
    gridSearchTop,
    paretoPoints,
    whatIfScenarios,
    ablation,
    queuingVerification,
    verification,
  } = bundle;
  const insights = useMemo(() => generateEvidenceInsights(scenarios, sensitivity), [scenarios, sensitivity]);

  const currentScenario = scenarios.find((s) => s.policy === 'BASELINE_CURRENT')!;
  const bestStaticScenario = scenarios.find((s) => s.policy === 'BASELINE_BEST_STATIC')!;
  const combinedScenario = scenarios.find((s) => s.policy === 'COMBINED')!;
  const activeScenario =
    scenarios.find((s) => s.policy === playbackPolicy) ?? combinedScenario;

  const currentRun = currentScenario.representativeRun;
  const bestStaticRun = bestStaticScenario.representativeRun;
  const combRun = combinedScenario.representativeRun;
  const activeRun = activeScenario.representativeRun;

  const passedTests = verification.filter((t) => t.passed).length;
  const timeLabels = bestStaticRun.timeSeries.map((pt) => pt.clockLabel);

  const handleApplyConfig = (nextConfig: SimConfig) => {
    const isDefaultMatch =
      nextConfig.fleetSize === DEFAULT_CONFIG.fleetSize &&
      nextConfig.busCapacity === DEFAULT_CONFIG.busCapacity &&
      nextConfig.arrivalMultiplier === DEFAULT_CONFIG.arrivalMultiplier &&
      nextConfig.trafficSeverity === DEFAULT_CONFIG.trafficSeverity &&
      nextConfig.durationMinutes === DEFAULT_CONFIG.durationMinutes &&
      nextConfig.baselineHeadwayMinutes === DEFAULT_CONFIG.baselineHeadwayMinutes &&
      nextConfig.seed === DEFAULT_CONFIG.seed &&
      nextConfig.replications === DEFAULT_CONFIG.replications &&
      nextConfig.suddenSurgeEnabled === DEFAULT_CONFIG.suddenSurgeEnabled &&
      Boolean(nextConfig.breakdownEnabled) === Boolean(DEFAULT_CONFIG.breakdownEnabled) &&
      !nextConfig.calibratedArrivals &&
      nextConfig.bestStaticSchedule.offPeakHeadway === DEFAULT_CONFIG.bestStaticSchedule.offPeakHeadway &&
      nextConfig.bestStaticSchedule.morningPeakHeadway === DEFAULT_CONFIG.bestStaticSchedule.morningPeakHeadway &&
      nextConfig.bestStaticSchedule.afternoonPeakHeadway === DEFAULT_CONFIG.bestStaticSchedule.afternoonPeakHeadway;

    if (isDefaultMatch) {
      setBundle(INITIAL_BUNDLE);
      setPlaybackPolicy(nextConfig.policy);
      return;
    }

    setIsComputing(true);
    window.setTimeout(() => {
      const gs = gridSearchBestStaticTimetable(nextConfig);
      const updatedConfig: SimConfig = {
        ...nextConfig,
        bestStaticSchedule: gs.bestSchedule,
      };
      const nextScenarios = runScenarioComparison(updatedConfig);
      const nextSensitivity = runSensitivitySuite(updatedConfig);
      const addendum = computeCustomAddendumSuite(updatedConfig, nextScenarios);
      const nextTests = runFullVerificationSuite();
      setBundle({
        canonicalEngine: 'TypeScript Interactive Parity Engine (Custom Parameters)',
        config: updatedConfig,
        gridSearchTop: gs.topCandidates,
        scenarios: nextScenarios,
        sensitivity: nextSensitivity,
        paretoPoints: addendum.paretoPoints,
        whatIfScenarios: addendum.whatIfScenarios,
        ablation: addendum.ablation,
        queuingVerification: addendum.queuingVerification,
        verification: nextTests,
      });
      setPlaybackPolicy(updatedConfig.policy);
      setIsComputing(false);
    }, 20);
  };

  const currentNavLabel =
    NAV_ITEMS.find((n) => n.id === activeSection)?.label ?? 'Overview';

  return (
    <div className="min-h-screen bg-[#080C1A] text-slate-100 flex">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-[#0B1023] border-r border-slate-800/80 z-30">
        <div className="px-5 py-5 border-b border-slate-800/80">
          <div className="font-display text-base font-bold tracking-tight text-slate-100 whitespace-nowrap">
            MUET Transit Intelligence
          </div>
          <div className="text-xs text-slate-400 mt-1">
            Optional Visualizer Over Canonical Python/SimPy Exports
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Primary Navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveSection(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer text-left ${
                  active
                    ? 'bg-indigo-600/20 text-indigo-200 border border-indigo-500/40'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-[#121A36] border border-transparent'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="px-5 py-4 border-t border-slate-800/80 text-xs text-slate-400 space-y-1 font-mono tabular-nums">
          <div className="text-slate-300 font-sans font-medium">
            {canonicalEngine ?? 'Python Canonical DES Engine'}
          </div>
          <div>
            Fleet: c={config.fleetSize} · Cap: K={config.busCapacity}
          </div>
          <div>
            Best Static: {config.bestStaticSchedule.offPeakHeadway}/{config.bestStaticSchedule.morningPeakHeadway}/{config.bestStaticSchedule.afternoonPeakHeadway}m
          </div>
          <div>
            Reps: {config.replications}  · Seed: {config.seed}
          </div>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="relative w-64 max-w-full bg-[#0B1023] border-r border-slate-800 flex flex-col z-10">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <span className="font-display text-sm font-bold text-slate-100">
                MUET Transit Intelligence
              </span>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close navigation menu"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveSection(item.id);
                      setMobileNavOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${
                      active
                        ? 'bg-indigo-600/20 text-indigo-200 border border-indigo-500/40'
                        : 'text-slate-400 hover:text-slate-100 hover:bg-[#121A36] border border-transparent'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Shell */}
      <div className="print-main-shell flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="no-print sticky top-0 z-20 bg-[#080C1A]/90 backdrop-blur border-b border-slate-800/80 px-6 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 rounded-lg bg-[#0F162E] border border-slate-800 text-slate-300"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="text-slate-400 hidden sm:inline">
                MUET Jamshoro DES Platform
              </span>
              <span className="text-slate-600 hidden sm:inline">/</span>
              <h1 className="font-display font-semibold text-slate-100 truncate">
                {currentNavLabel}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <div className="hidden md:flex items-center gap-2 text-xs font-mono text-slate-300">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>
                {passedTests}/{verification.length} Tests Passing
              </span>
              <span className="text-slate-600">·</span>
              <span className={config.calibratedArrivals ? 'text-emerald-300' : 'text-amber-300'}>
                {config.calibratedArrivals
                  ? `Calibrated: ${config.calibratedArrivals.sourceName}`
                  : 'Synthetic demand'}
              </span>
            </div>

            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Configure &amp; Run</span>
            </button>
          </div>
        </header>

        {/* Viewport Container */}
        <main className="flex-1 px-6 py-6 max-w-[1440px] w-full mx-auto space-y-6">
          {/* 1. EXECUTIVE OVERVIEW */}
          {activeSection === 'overview' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <KPICard
                  title="Average Wait"
                  value={`${combinedScenario.metrics.avgWaitTime.mean} min`}
                  baselineValue={`Best Static: ${bestStaticScenario.metrics.avgWaitTime.mean} min`}
                  delta={`${combinedScenario.metrics.avgWaitTime.improvementVsBestStaticPct}% lower`}
                  positive={combinedScenario.metrics.avgWaitTime.mean < bestStaticScenario.metrics.avgWaitTime.mean}
                  subtext="Average passenger waiting time."
                />
                <KPICard
                  title="Worst 5% Wait"
                  value={`${combinedScenario.metrics.p95WaitTime.mean} min`}
                  baselineValue={`Best Static: ${bestStaticScenario.metrics.p95WaitTime.mean} min`}
                  delta={`${combinedScenario.metrics.p95WaitTime.improvementVsBestStaticPct}% lower`}
                  positive={combinedScenario.metrics.p95WaitTime.mean < bestStaticScenario.metrics.p95WaitTime.mean}
                  subtext="95th-percentile waiting time."
                />
                <KPICard
                  title="Passenger Utilization"
                  value={`${combinedScenario.metrics.fleetUtilization.mean}%`}
                  baselineValue={`Best Static: ${bestStaticScenario.metrics.fleetUtilization.mean}%`}
                  delta={`+${combinedScenario.metrics.fleetUtilization.improvementVsBestStaticPct}%`}
                  positive={combinedScenario.metrics.fleetUtilization.mean > bestStaticScenario.metrics.fleetUtilization.mean}
                  subtext={`Load factor: ${combinedScenario.metrics.avgLoadFactor.mean}% · Empty trips: ${combinedScenario.metrics.emptyRunRatio.mean}%`}
                />
                <KPICard
                  title="Buses Needed for SLA"
                  value={`${sensitivity.minFleetForSLA.combined ?? 'N/A'}`}
                  baselineValue={`Best Static needs ${sensitivity.minFleetForSLA.bestStatic ?? 'N/A'}`}
                  delta="1 fewer bus"
                  positive={(sensitivity.minFleetForSLA.combined ?? 99) < (sensitivity.minFleetForSLA.bestStatic ?? 99)}
                  subtext="Average wait ≤ 5 min and worst 5% ≤ 15 min."
                />
              </div>

              <section className="rounded-xl bg-[#0F162E] border border-slate-800/80 p-4">
                <InteractiveLineChart
                  title="Passenger Queue Over Time"
                  subtitle="Combined queue at both terminals · representative simulation"
                  xLabels={timeLabels}
                  yUnit=" passengers"
                  series={[
                    { key: 'best', label: 'Best Static', color: '#F59E0B', values: bestStaticRun.timeSeries.map((p) => p.stcQueue + p.mainGateQueue) },
                    { key: 'combined', label: 'Combined', color: '#10B981', values: combRun.timeSeries.map((p) => p.stcQueue + p.mainGateQueue) },
                  ]}
                />
                <p className="text-xs text-slate-400 mt-2">Takeaway: Combined dispatch reduces the total waiting queue during peak periods.</p>
              </section>

              <section className="rounded-xl border border-slate-800 bg-[#0F162E] p-4">
                <h3 className="text-sm font-semibold text-slate-100 mb-2">Panel Walkthrough</h3>
                <ol className="list-decimal list-inside space-y-1 text-sm text-slate-300">
                  <li><strong>Overview:</strong> Compare the main service and fleet outcomes. The queue chart shows how waiting passengers change over time.</li>
                  <li><strong>Live Simulation:</strong> Watch buses move and see dispatch events. Pause or select a policy to inspect its behavior.</li>
                  <li><strong>Scenarios:</strong> Change demand and traffic or compare fleet sizes. Use results to explore what-if conditions.</li>
                  <li><strong>Report:</strong> Read the PDF report for figures, assumptions, validation needs, and references.</li>
                </ol>
              </section>

              <details className="rounded-xl border border-slate-800 bg-[#0F162E] p-4">
                <summary className="cursor-pointer text-sm font-semibold text-slate-100">Technical details</summary>
                <div className="mt-3 space-y-2 text-xs text-slate-400">
                  <p>Simulation uses 30 replications, shared random seeds across policies, and a time-varying synthetic passenger arrival profile.</p>
                  <p>Verification: {passedTests} of {verification.length} checks passed. The tests cover passenger conservation, capacity, event timing, edge cases, disruption handling, and parity checks.</p>
                  <p>Passenger utilization is passenger-carrying bus-minutes divided by total fleet bus-minutes. Load factor is average occupancy while carrying passengers divided by bus capacity. Higher utilization can reduce idle time but may increase crowding; review both together.</p>
                  <p>Results are synthetic and require validation with observed arrivals, departures, boarding counts, travel times, and queue lengths.</p>
                </div>
              </details>
            </div>
          )}

          {/* 3. LIVE SIMULATION & TERMINALS (MERGED) */}
          {activeSection === 'live' && (
            <LivePlayback
              baselineRun={bestStaticRun}
              activeRun={activeRun}
              activePolicy={playbackPolicy}
              onSelectPolicy={setPlaybackPolicy}
            />
          )}

          {/* 4. SCENARIOS & FLEET SWEEP */}
          {activeSection === 'scenarios' && (
            <div className="space-y-5">
              <section className="rounded-xl bg-[#0F162E] border border-slate-800/80 p-4">
                <GroupedBarChart
                  title="What-If Scenarios: Average Wait"
                  subtitle="Best Static compared with Combined"
                  unit=" min"
                  groups={whatIfScenarios.map((w) => ({
                    groupLabel: w.shortLabel,
                    bars: [
                      { label: 'Best Static', value: w.policies.BASELINE_BEST_STATIC.avgWaitTime.mean, color: '#F59E0B' },
                      { label: 'Combined', value: w.policies.COMBINED.avgWaitTime.mean, color: '#10B981' },
                    ],
                  }))}
                />
                <p className="text-xs text-slate-400 mt-2">Takeaway: Combined lowers average wait across the tested stress cases.</p>
              </section>

              <section className="rounded-xl bg-[#0F162E] border border-slate-800/80 p-4">
                <InteractiveLineChart
                  title="Demand Increase"
                  subtitle="Average wait as demand changes"
                  xLabels={sensitivity.demandSweep.map((p) => p.parameterValue)}
                  yUnit=" min"
                  series={[
                    { key: 'best', label: 'Best Static', color: '#F59E0B', values: sensitivity.demandSweep.map((p) => p.bestStaticAvgWait) },
                    { key: 'combined', label: 'Combined', color: '#10B981', values: sensitivity.demandSweep.map((p) => p.combinedAvgWait) },
                  ]}
                />
                <p className="text-xs text-slate-400 mt-2">Takeaway: Combined keeps average wait lower as demand rises.</p>
              </section>

              <section className="rounded-xl bg-[#0F162E] border border-slate-800/80 p-4">
                <InteractiveLineChart
                  title="Fleet Size Comparison"
                  subtitle="Average wait by number of buses"
                  xLabels={sensitivity.fleetSweep.map((p) => String(p.fleetSize))}
                  yUnit=" min"
                  series={[
                    { key: 'best', label: 'Best Static', color: '#F59E0B', values: sensitivity.fleetSweep.map((p) => p.bestStaticAvgWait) },
                    { key: 'combined', label: 'Combined', color: '#10B981', values: sensitivity.fleetSweep.map((p) => p.combinedAvgWait) },
                  ]}
                />
                <p className="text-xs text-slate-400 mt-2">Takeaway: Combined meets the wait targets with one fewer bus in the tested sweep.</p>
              </section>
            </div>
          )}

{activeSection === 'report' && (
            <section className="rounded-xl border border-slate-800 bg-[#0F162E] p-4 space-y-3">
              <h2 className="text-lg font-semibold text-slate-100">Research Report</h2>
              <p className="text-sm text-slate-400">View the compiled report or download the PDF.</p>
              <a href="/MUET_Point_Bus_IEEE_Report.pdf" download className="inline-flex rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white">Download report PDF</a>
              <iframe title="MUET Transit Research Report" src="/MUET_Point_Bus_IEEE_Report.pdf" className="w-full h-[75vh] rounded-lg bg-white" />
            </section>
          )}
        </main>
      </div>

      {/* Side Configuration & Calibration Drawer */}
      <ConfigDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        config={config}
        onApply={handleApplyConfig}
      />
    </div>
  );
}

const KPICard: React.FC<{
  title: string;
  value: string;
  baselineValue: string;
  delta: string;
  positive: boolean;
  subtext: string;
}> = ({ title, value, baselineValue, delta, positive, subtext }) => (
  <div className="rounded-xl bg-[#0F162E] border border-slate-800/80 p-5 flex flex-col justify-between">
    <div className="text-xs font-medium text-slate-400">{title}</div>
    <div className="mt-2 flex items-baseline justify-between gap-2">
      <div className="text-2xl font-bold font-mono tabular-nums text-slate-100">{value}</div>
      <div
        className={`text-xs font-mono font-semibold tabular-nums ${
          positive ? 'text-emerald-300' : 'text-amber-300'
        }`}
      >
        {delta}
      </div>
    </div>
    <div className="mt-2 pt-2 border-t border-slate-800/80 text-xs text-slate-400 space-y-0.5">
      <div className="font-mono text-slate-300 tabular-nums">{baselineValue}</div>
      <div className="text-[11px] text-slate-400 leading-snug">{subtext}</div>
    </div>
  </div>
);
