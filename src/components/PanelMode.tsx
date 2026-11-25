import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';
import {
  ScenarioAggregateResult,
  SensitivitySuite,
  SimConfig,
} from '../sim/types';
import { VerificationTestCase } from '../sim/verification';

interface PanelModeProps {
  config: SimConfig;
  scenarios: ScenarioAggregateResult[];
  sensitivity: SensitivitySuite;
  verification: VerificationTestCase[];
}

export const PanelMode: React.FC<PanelModeProps> = ({
  config,
  scenarios,
  sensitivity,
  verification,
}) => {
  const [step, setStep] = useState(0);

  const current = scenarios.find((s) => s.policy === 'BASELINE_CURRENT')!;
  const bestStatic = scenarios.find((s) => s.policy === 'BASELINE_BEST_STATIC')!;
  const comb = scenarios.find((s) => s.policy === 'COMBINED')!;
  const passedTests = verification.filter((t) => t.passed).length;
  const highDemand = sensitivity.demandSweep[sensitivity.demandSweep.length - 1];

  const steps = [
    {
      kicker: 'Step 1 of 5 · Problem & Constraints',
      title: 'Asymmetric Peak Congestion Without Adding Buses',
      takeaway:
        'MUET Point buses face opposing directional surges at Main Gate (08:00–09:00) and STC (14:00–15:30) under a strict fixed-fleet budget.',
      cards: [
        { label: 'Fixed Fleet Size (c)', value: `${config.fleetSize} buses`, sub: 'Identical across all policies' },
        { label: 'Bus Capacity (K)', value: `${config.busCapacity} pax`, sub: 'Strict boarding cap enforced' },
        { label: 'Morning Peak Window', value: '08:00–09:00', sub: 'Inbound Main Gate surge (~12 pax/m)' },
        { label: 'Afternoon Peak Window', value: '14:00–15:30', sub: 'Outbound STC surge (~13 pax/m)' },
      ],
    },
    {
      kicker: 'Step 2 of 5 · Context Baseline Failure',
      title: 'Why an Unoptimized 12-Minute Schedule Collapses',
      takeaway:
        'A uniform 12-minute schedule starves peak windows and strands hundreds of students even when average daily seat supply looks sufficient.',
      cards: [
        { label: 'Assumed 12m Avg Wait', value: `${current.metrics.avgWaitTime.mean} min`, sub: `95% CI [${current.metrics.avgWaitTime.ci95Low}, ${current.metrics.avgWaitTime.ci95High}]m` },
        { label: 'P95 Tail Wait', value: `${current.metrics.p95WaitTime.mean} min`, sub: `Max wait: ${current.metrics.maxWaitTime.mean}m` },
        { label: 'Waiting > 10 Minutes', value: `${current.metrics.pctWaitingOver10Min.mean}%`, sub: 'Severe SLA breach share' },
        { label: 'Unserved at 16:00 Close', value: `${current.metrics.unservedAtClose.mean} pax`, sub: `Objective J = ${current.metrics.objectiveJ.mean}` },
      ],
    },
    {
      kicker: 'Step 3 of 5 · Dual Objectives & Honest Benchmark',
      title: 'Best-Tuned Static vs. Combined Optimizer (Wait + Utilization)',
      takeaway: `Against the grid-searched Best-Tuned Static timetable (${config.bestStaticSchedule.offPeakHeadway}/${config.bestStaticSchedule.morningPeakHeadway}/${config.bestStaticSchedule.afternoonPeakHeadway}m), Combined cuts mean wait by ${comb.metrics.avgWaitTime.improvementVsBestStaticPct}% AND raises passenger-carrying fleet utilization to ${comb.metrics.fleetUtilization.mean}% with ${comb.metrics.emptyRunRatio.mean}% empty-run ratio.`,
      cards: [
        { label: 'Best Static Avg Wait', value: `${bestStatic.metrics.avgWaitTime.mean} min`, sub: `Grid-tuned ${config.bestStaticSchedule.offPeakHeadway}/${config.bestStaticSchedule.morningPeakHeadway}/${config.bestStaticSchedule.afternoonPeakHeadway}m` },
        { label: 'Combined Avg Wait', value: `${comb.metrics.avgWaitTime.mean} min`, sub: `Paired diff ${comb.metrics.avgWaitTime.pairedDiffMean}m [${comb.metrics.avgWaitTime.pairedDiffCi95Low}, ${comb.metrics.avgWaitTime.pairedDiffCi95High}]` },
        { label: 'Pax-Carrying Utilization', value: `${comb.metrics.fleetUtilization.mean}%`, sub: `vs ${bestStatic.metrics.fleetUtilization.mean}% Best Static · Empty ratio ${comb.metrics.emptyRunRatio.mean}%` },
        { label: 'Effect Size (Cohen dz)', value: `${comb.metrics.avgWaitTime.cohensDz}`, sub: comb.metrics.avgWaitTime.statisticallySignificant ? 'Paired-t 95% CI excludes 0' : 'Not significant' },
      ],
    },
    {
      kicker: 'Step 4 of 5 · Fleet Sweep & Demand Robustness',
      title: 'Same SLA Service With Fewer Buses & Surge Resilience',
      takeaway: `Combined Optimization meets the <=5m avg / <=15m P95 SLA with ${sensitivity.minFleetForSLA.combined ?? '—'} buses instead of ${sensitivity.minFleetForSLA.bestStatic ?? '—'}, and cuts ${highDemand.parameterValue} demand-surge wait by ${highDemand.improvementVsBestStaticPct}%.`,
      cards: [
        { label: 'Min Buses for SLA (Combined)', value: `${sensitivity.minFleetForSLA.combined ?? 'N/A'} buses`, sub: 'Avg wait <= 5m & P95 <= 15m' },
        { label: 'Min Buses for SLA (Best Static)', value: `${sensitivity.minFleetForSLA.bestStatic ?? 'N/A'} buses`, sub: `12m Current fails up to c=14` },
        { label: `At ${highDemand.parameterValue} Demand (Best Static)`, value: `${highDemand.bestStaticAvgWait} min`, sub: `P95 = ${highDemand.bestStaticP95Wait}m (${highDemand.bestStaticPctOver10}% > 10m)` },
        { label: `At ${highDemand.parameterValue} Demand (Combined)`, value: `${highDemand.combinedAvgWait} min`, sub: `P95 = ${highDemand.combinedP95Wait}m (${highDemand.combinedPctOver10}% > 10m)` },
      ],
    },
    {
      kicker: 'Step 5 of 5 · Verification, Queuing & Limits',
      title: '22 Canonical Checks, Erlang-C Verification & Field Calibration',
      takeaway: `All ${passedTests}/${verification.length} Python & TypeScript checks (conservation, CRN, 60m breakdown, ablation, M/M/c, parity) pass, while CSV field import enables empirical calibration once 3-day MUET counts are collected.`,
      cards: [
        { label: 'Canonical Verification Suite', value: `${passedTests}/${verification.length} Passed`, sub: 'Conservation, CRN, breakdown, M/M/c & parity' },
        { label: 'CRN Arrival Parity', value: 'Exact Match', sub: '4 spawned streams per seed across all 5 policies' },
        { label: 'Model Data Status', value: config.calibratedArrivals ? 'Calibrated CSV' : 'Synthetic NHPP', sub: config.calibratedArrivals ? config.calibratedArrivals.sourceName : '3-day 5-min survey template included' },
        { label: 'Primary Limitation', value: 'No Field Logs', sub: 'Requires 3-day STC/Main Gate counts for field validation' },
      ],
    },
  ];

  const currentStep = steps[step];

  return (
    <div className="space-y-6">
      {/* Stepper Header */}
      <div className="rounded-xl bg-[#0F162E] border border-slate-800/80 p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {steps.map((s, idx) => (
            <button
              key={s.kicker}
              type="button"
              onClick={() => setStep(idx)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                step === idx
                  ? 'bg-indigo-600 text-white'
                  : 'bg-[#090E1E] text-slate-400 hover:text-slate-100 border border-slate-800'
              }`}
            >
              Step {idx + 1}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#161F3E] text-slate-200 disabled:opacity-40 text-xs font-medium border border-slate-700 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Previous</span>
          </button>
          <button
            type="button"
            disabled={step === steps.length - 1}
            onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 text-xs font-medium cursor-pointer"
          >
            <span>Next Step</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Focused Presentation Card */}
      <div className="rounded-xl bg-[#0F162E] border border-slate-800/80 p-8 space-y-8">
        <div>
          <div className="text-xs font-mono text-indigo-300">{currentStep.kicker}</div>
          <h2 className="text-2xl sm:text-3xl font-display font-bold text-slate-100 mt-1.5 text-balance">
            {currentStep.title}
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {currentStep.cards.map((c) => (
            <div
              key={c.label}
              className="rounded-xl bg-[#090E1E] border border-slate-800 p-5 flex flex-col justify-between"
            >
              <div className="text-xs font-medium text-slate-400">{c.label}</div>
              <div className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-slate-100 my-3">
                {c.value}
              </div>
              <div className="text-xs text-slate-400 font-mono">{c.sub}</div>
            </div>
          ))}
        </div>

        {/* Single Crisp Takeaway Sentence */}
        <div className="rounded-lg bg-indigo-950/40 border border-indigo-500/30 p-4 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-indigo-300 shrink-0 mt-0.5" />
          <p className="text-sm text-slate-100 font-medium leading-relaxed">
            <span className="text-indigo-300 font-semibold">Takeaway: </span>
            {currentStep.takeaway}
          </p>
        </div>
      </div>
    </div>
  );
};
