import {
  computeAnalyticalMMc,
  gridSearchBestStaticTimetable,
  parseArrivalCsv,
  runScenarioComparison,
  SAMPLE_FIELD_CSV,
} from './analytics';
import { computeObjectiveJ, runSingleSimulation } from './engine';
import { evaluateDispatchPolicy, getBestStaticHeadwayAtTime } from './policies';
import { getArrivalRate, SeededRNG } from './prng';
import { DEFAULT_CONFIG, DispatchPolicy } from './types';

export interface VerificationTestCase {
  id: string;
  category: 'Invariant' | 'Unit' | 'Boundary' | 'Reproducibility' | 'Integration';
  name: string;
  passed: boolean;
  durationMs: number;
  assertionDetail: string;
}

export function runFullVerificationSuite(): VerificationTestCase[] {
  const results: VerificationTestCase[] = [];

  const runCase = (
    id: string,
    category: VerificationTestCase['category'],
    name: string,
    fn: () => { passed: boolean; detail: string }
  ) => {
    const t0 = performance.now();
    try {
      const res = fn();
      results.push({
        id,
        category,
        name,
        passed: res.passed,
        durationMs: Number((performance.now() - t0).toFixed(2)),
        assertionDetail: res.detail,
      });
    } catch (err) {
      results.push({
        id,
        category,
        name,
        passed: false,
        durationMs: Number((performance.now() - t0).toFixed(2)),
        assertionDetail: `Exception: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  // T-01: Seeded PRNG bit-exact reproducibility
  runCase('T-01', 'Reproducibility', 'Deterministic Seeded PRNG & Simulation Bit-Exactness', () => {
    const r1 = runSingleSimulation({ ...DEFAULT_CONFIG, seed: 777, policy: 'COMBINED' });
    const r2 = runSingleSimulation({ ...DEFAULT_CONFIG, seed: 777, policy: 'COMBINED' });
    const exact =
      r1.metrics.totalArrivals === r2.metrics.totalArrivals &&
      r1.metrics.avgWaitTime === r2.metrics.avgWaitTime &&
      r1.metrics.completedJourneys === r2.metrics.completedJourneys &&
      r1.metrics.p95WaitTime === r2.metrics.p95WaitTime &&
      r1.metrics.objectiveJ === r2.metrics.objectiveJ;
    return {
      passed: exact,
      detail: `Seed 777 exact match: ${r1.metrics.totalArrivals} pax, ${r1.metrics.avgWaitTime}m wait, J=${r1.metrics.objectiveJ}`,
    };
  });

  // T-02: Distinct seeds produce stochastic variance
  runCase('T-02', 'Unit', 'Independent Seeds Produce Distinct Stochastic Realizations', () => {
    const r1 = runSingleSimulation({ ...DEFAULT_CONFIG, seed: 101 });
    const r2 = runSingleSimulation({ ...DEFAULT_CONFIG, seed: 202 });
    const distinct =
      r1.metrics.totalArrivals !== r2.metrics.totalArrivals ||
      r1.metrics.avgWaitTime !== r2.metrics.avgWaitTime;
    return {
      passed: distinct,
      detail: `Seed 101 (${r1.metrics.totalArrivals} pax, ${r1.metrics.avgWaitTime}m) vs Seed 202 (${r2.metrics.totalArrivals} pax, ${r2.metrics.avgWaitTime}m)`,
    };
  });

  // T-03: Strict CRN arrival stream identity across all 5 policies
  runCase('T-03', 'Reproducibility', 'CRN Arrival Streams Identical Across All 5 Policies', () => {
    const policies: DispatchPolicy[] = [
      'BASELINE_CURRENT',
      'BASELINE_BEST_STATIC',
      'QUEUE_AWARE',
      'ADAPTIVE_HEADWAY',
      'COMBINED',
    ];
    const runs = policies.map((p) => runSingleSimulation({ ...DEFAULT_CONFIG, policy: p, seed: 42 }));
    const refTotal = runs[0].metrics.totalArrivals;
    const refStc = runs[0].metrics.stcArrivals;
    const refMg = runs[0].metrics.mgArrivals;
    const allEqual = runs.every(
      (r) =>
        r.metrics.totalArrivals === refTotal &&
        r.metrics.stcArrivals === refStc &&
        r.metrics.mgArrivals === refMg
    );
    return {
      passed: allEqual,
      detail: `All 5 policies received identical arrivals: STC=${refStc}, MG=${refMg}, Total=${refTotal}`,
    };
  });

  // T-04: NHPP peak profile check
  runCase('T-04', 'Unit', 'NHPP Arrival Intensity Captures AM (08:30) & PM (14:45) Peaks', () => {
    const mgOff = getArrivalRate('MAIN_GATE', 200, 1.0, false);
    const mgPeak = getArrivalRate('MAIN_GATE', 60, 1.0, false);
    const stcOff = getArrivalRate('STC', 200, 1.0, false);
    const stcPeak = getArrivalRate('STC', 430, 1.0, false);
    const ok = mgPeak > mgOff * 3 && stcPeak > stcOff * 3;
    return {
      passed: ok,
      detail: `MG Peak=${mgPeak.toFixed(2)}/m vs Off=${mgOff.toFixed(2)}/m · STC Peak=${stcPeak.toFixed(2)}/m vs Off=${stcOff.toFixed(2)}/m`,
    };
  });

  // T-05..T-09: Invariants (Capacity, Passenger Conservation, Monotonic Clocks, Fleet) across all 5 policies
  const allPolicies: DispatchPolicy[] = [
    'BASELINE_CURRENT',
    'BASELINE_BEST_STATIC',
    'QUEUE_AWARE',
    'ADAPTIVE_HEADWAY',
    'COMBINED',
  ];
  allPolicies.forEach((policy, idx) => {
    runCase(`T-0${5 + idx}`, 'Invariant', `All 4 Conservation & Monotonic Invariants (${policy})`, () => {
      const res = runSingleSimulation({
        ...DEFAULT_CONFIG,
        policy,
        arrivalMultiplier: 1.35,
        trafficSeverity: 1.5,
        seed: 55,
      });
      const ok = res.invariants.every((inv) => inv.passed);
      return {
        passed: ok,
        detail: res.invariants.map((i) => `${i.name.split(' ')[0]}:${i.passed ? 'OK' : 'FAIL'}`).join(' · '),
      };
    });
  });

  // T-10: Boundary c=2 with sudden surge
  runCase('T-10', 'Boundary', 'Boundary Test: Minimum Fleet (c=2) Under Sudden Surge', () => {
    const res = runSingleSimulation({
      ...DEFAULT_CONFIG,
      fleetSize: 2,
      busCapacity: 30,
      suddenSurgeEnabled: true,
      policy: 'COMBINED',
    });
    const ok = res.invariants.every((i) => i.passed) && res.metrics.totalArrivals > 0;
    return {
      passed: ok,
      detail: `2-bus surge handled cleanly: ${res.metrics.completedJourneys}/${res.metrics.totalArrivals} served, capacityViolations=0`,
    };
  });

  // T-11: Boundary zero demand
  runCase('T-11', 'Boundary', 'Boundary Test: Zero Passenger Demand (arrivalMultiplier = 0)', () => {
    const res = runSingleSimulation({
      ...DEFAULT_CONFIG,
      arrivalMultiplier: 0,
      policy: 'COMBINED',
    });
    const ok =
      res.metrics.totalArrivals === 0 &&
      res.metrics.avgWaitTime === 0 &&
      res.metrics.unservedAtClose === 0 &&
      res.invariants.every((i) => i.passed);
    return {
      passed: ok,
      detail: `totalArrivals=${res.metrics.totalArrivals}, avgWait=${res.metrics.avgWaitTime}m, unserved=${res.metrics.unservedAtClose}`,
    };
  });

  // T-12: Boundary extreme demand
  runCase('T-12', 'Boundary', 'Boundary Test: Extreme Demand Stress (arrivalMultiplier = 2.5)', () => {
    const res = runSingleSimulation({
      ...DEFAULT_CONFIG,
      arrivalMultiplier: 2.5,
      policy: 'COMBINED',
    });
    const ok =
      res.invariants.every((i) => i.passed) &&
      res.metrics.totalArrivals > 7000 &&
      res.metrics.avgLoadFactor <= 100.0;
    return {
      passed: ok,
      detail: `${res.metrics.totalArrivals} arrivals handled cleanly, avgLoad=${res.metrics.avgLoadFactor}%, invariants=OK`,
    };
  });

  // T-13: Boundary zero traffic
  runCase('T-13', 'Boundary', 'Boundary Test: Zero Traffic Delay (trafficSeverity = 0.0)', () => {
    const res = runSingleSimulation({
      ...DEFAULT_CONFIG,
      trafficSeverity: 0,
      policy: 'COMBINED',
    });
    const ok = res.metrics.avgTrafficDelay === 0 && res.invariants.every((i) => i.passed);
    return {
      passed: ok,
      detail: `avgTrafficDelay = ${res.metrics.avgTrafficDelay} min (expected 0.0)`,
    };
  });

  // T-14: Baseline headway enforcement unit test
  runCase('T-14', 'Unit', 'Baseline Policy Strictly Enforces Headway Even Under Queue Surge', () => {
    const dec = evaluateDispatchPolicy({
      policy: 'BASELINE_CURRENT',
      terminal: 'STC',
      time: 10,
      queueLength: 140,
      oldestArrivalTime: 0,
      availableBusesAtTerminal: 3,
      oppositeQueueLength: 0,
      oppositeAvailableBuses: 2,
      incomingBusesToTerminal: 0,
      incomingBusesToOpposite: 0,
      busCapacity: 50,
      timeSinceLastDispatch: 8,
      baselineHeadway: 12,
      bestStaticSchedule: DEFAULT_CONFIG.bestStaticSchedule,
      ewmaArrivalRate: 6,
      oppositeEwmaArrivalRate: 1,
      expectedTripTime: 12,
      recentTrafficDelay: 1,
    });
    const ok = dec.shouldDispatch === false && dec.shouldRepositionFromOpposite === false;
    return {
      passed: ok,
      detail: `At t_elapsed=8m < 12m with Q=140: shouldDispatch=${dec.shouldDispatch}, reposition=${dec.shouldRepositionFromOpposite}`,
    };
  });

  // T-15: Best-Tuned Static window switching unit test
  runCase('T-15', 'Unit', 'Best-Tuned Static Timetable Switches Off-Peak vs Peak Windows', () => {
    const sched = { offPeakHeadway: 12, morningPeakHeadway: 5, afternoonPeakHeadway: 6 };
    const h0 = getBestStaticHeadwayAtTime(15, sched);
    const hAm = getBestStaticHeadwayAtTime(60, sched);
    const hMid = getBestStaticHeadwayAtTime(200, sched);
    const hPm = getBestStaticHeadwayAtTime(430, sched);
    const ok = h0 === 12 && hAm === 5 && hMid === 12 && hPm === 6;
    return {
      passed: ok,
      detail: `07:45=${h0}m, 08:30=${hAm}m, 10:50=${hMid}m, 14:40=${hPm}m`,
    };
  });

  // T-16: Objective function J(pi) exact formula check
  runCase('T-16', 'Unit', 'Objective Function J(pi) Exact Formula Verification', () => {
    const j = computeObjectiveJ({
      avgWait: 10,
      p95Wait: 25,
      pctWaitingOver10: 50,
      unservedAtClose: 100,
      totalArrivals: 1000,
      deadheadTrips: 5,
      totalDispatches: 100,
    });
    // Expected: 0.35*(1) + 0.30*(1) + 0.20*(0.5) + 0.10*(0.1) + 0.05*(0.05) = 0.7625
    const ok = Math.abs(j - 0.7625) < 1e-6;
    return {
      passed: ok,
      detail: `Computed J = ${j.toFixed(4)} (analytical = 0.7625)`,
    };
  });

  // T-17: CSV calibration parser + integration test
  runCase('T-17', 'Integration', 'Field Survey CSV Import & Calibrated Simulation Run', () => {
    const parsed = parseArrivalCsv(SAMPLE_FIELD_CSV, 'Test Survey');
    const res = runSingleSimulation({
      ...DEFAULT_CONFIG,
      calibratedArrivals: parsed,
      policy: 'COMBINED',
    });
    const ok = parsed.stcRatesPerMin.length === 10 && res.invariants.every((i) => i.passed);
    return {
      passed: ok,
      detail: `Parsed ${parsed.stcRatesPerMin.length} bins; simulated ${res.metrics.totalArrivals} calibrated arrivals`,
    };
  });

  // T-18: Exponential RNG empirical mean + Grid Search sanity
  runCase('T-18', 'Integration', 'Exponential Distribution Mean & Grid-Search Best Static Sanity', () => {
    const rng = new SeededRNG(12345);
    let sum = 0;
    const n = 5000;
    for (let i = 0; i < n; i++) sum += rng.exponential(2.5);
    const empMean = sum / n;
    const gs = gridSearchBestStaticTimetable({ ...DEFAULT_CONFIG, durationMinutes: 510 });
    const cmp = runScenarioComparison({ ...DEFAULT_CONFIG, replications: 5, bestStaticSchedule: gs.bestSchedule });
    const bestStatic = cmp.find((c) => c.policy === 'BASELINE_BEST_STATIC')!;
    const current = cmp.find((c) => c.policy === 'BASELINE_CURRENT')!;
    const ok =
      Math.abs(empMean - 0.4) < 0.03 &&
      bestStatic.metrics.avgWaitTime.mean < current.metrics.avgWaitTime.mean;
    return {
      passed: ok,
      detail: `Exp mean=${empMean.toFixed(4)}; Best Static (${gs.bestSchedule.offPeakHeadway}/${gs.bestSchedule.morningPeakHeadway}/${gs.bestSchedule.afternoonPeakHeadway}m) ${bestStatic.metrics.avgWaitTime.mean}m < Current ${current.metrics.avgWaitTime.mean}m`,
    };
  });

  // T-19: Passenger-carrying utilization excludes empty deadhead time
  runCase('T-19', 'Invariant', 'Fleet Utilization Excludes Empty Deadhead Minutes', () => {
    const res = runSingleSimulation({ ...DEFAULT_CONFIG, policy: 'COMBINED', seed: 42 });
    const ok =
      res.metrics.fleetUtilization > 0 &&
      res.metrics.fleetUtilization < 100 &&
      res.metrics.emptyRunRatio >= 0 &&
      res.metrics.emptyRunTimePct >= 0 &&
      res.metrics.fleetUtilization + res.metrics.emptyRunTimePct <= 100.1;
    return {
      passed: ok,
      detail: `PaxUtil=${res.metrics.fleetUtilization}%, EmptyRunRatio=${res.metrics.emptyRunRatio}%, EmptyTime=${res.metrics.emptyRunTimePct}%`,
    };
  });

  // T-20: Bus breakdown event disables PT-01 for exactly 60 min
  runCase('T-20', 'Integration', 'Bus Breakdown Event Places PT-01 Out-of-Service for 60 Min', () => {
    const res = runSingleSimulation({
      ...DEFAULT_CONFIG,
      policy: 'COMBINED',
      breakdownEnabled: true,
      seed: 42,
    });
    const ok =
      Math.abs(res.metrics.outOfServiceMinutes - 60.0) < 0.2 &&
      res.invariants.every((i) => i.passed);
    return {
      passed: ok,
      detail: `outOfServiceMinutes=${res.metrics.outOfServiceMinutes}m (expected 60.0m), invariants=OK`,
    };
  });

  // T-21: Ablation variants conserve passengers & capacity
  runCase('T-21', 'Invariant', 'All 4 Ablation Variants Preserve Conservation & Capacity', () => {
    const variants = [
      'ABLATION_NO_REBALANCE',
      'ABLATION_NO_TRAFFIC_COMP',
      'ABLATION_NO_SURPLUS',
      'ABLATION_NO_URGENCY',
    ] as unknown as DispatchPolicy[];
    const runs = variants.map((v) => runSingleSimulation({ ...DEFAULT_CONFIG, policy: v, seed: 42 }));
    const ok = runs.every((r) => r.invariants.every((i) => i.passed));
    return {
      passed: ok,
      detail: `4 ablation variants verified (${runs.map((r) => `${r.metrics.avgWaitTime}m`).join(', ')})`,
    };
  });

  // T-22: Analytical M/M/c off-peak verification vs peak instability
  runCase('T-22', 'Unit', 'Analytical Erlang-C M/M/c Off-Peak Stability & Peak Breakdown Check', () => {
    const off = computeAnalyticalMMc(3.4, 2.0, 10);
    const peak = computeAnalyticalMMc(13.2, 50 / 28, 5);
    const ok = off.stable === true && off.rho < 0.5 && peak.stable === false && peak.rho >= 1.0;
    return {
      passed: ok,
      detail: `Off-peak rho=${off.rho} (stable), Peak unrebalanced rho=${peak.rho} (>=1.0 requires DES)`,
    };
  });

  return results;
}
