import { AblationPolicy, DispatchPolicy, StaticScheduleParams, TerminalId } from './types';

export interface PolicyMetadata {
  id: DispatchPolicy;
  label: string;
  shortName: string;
  description: string;
  mechanism: string;
}

export const POLICY_CATALOG: Record<DispatchPolicy, PolicyMetadata> = {
  BASELINE_CURRENT: {
    id: 'BASELINE_CURRENT',
    label: 'Context: Assumed Current Static (12-min)',
    shortName: 'Current (12m)',
    description:
      'Assumed unoptimized all-day 12-minute static headway with no peak timetable adjustment or bus rebalancing.',
    mechanism: 'Fixed 12m Headway All Day · Context Only',
  },
  BASELINE_BEST_STATIC: {
    id: 'BASELINE_BEST_STATIC',
    label: 'Baseline: Best-Tuned Static Timetable',
    shortName: 'Best Static',
    description:
      'Grid-searched time-of-day static timetable using optimal fixed headways for off-peak, morning peak, and afternoon peak.',
    mechanism: 'Tuned Static (H_off, H_am, H_pm) · No Live Telemetry',
  },
  QUEUE_AWARE: {
    id: 'QUEUE_AWARE',
    label: 'Policy B: Queue-Aware Dispatching',
    shortName: 'Queue-Aware',
    description:
      'Event-triggered dispatching whenever terminal queue reaches load threshold or oldest waiter approaches SLA bound.',
    mechanism: 'Queue Threshold (0.65K) · Wait SLA Guard (8m)',
  },
  ADAPTIVE_HEADWAY: {
    id: 'ADAPTIVE_HEADWAY',
    label: 'Policy C: Adaptive Headway Scheduling',
    shortName: 'Adaptive Headway',
    description:
      'Continuously adjusts target departure interval H(t) via Newell square-root law on EWMA arrival intensity.',
    mechanism: 'Newell √λ Headway · EWMA Arrival Tracking',
  },
  COMBINED: {
    id: 'COMBINED',
    label: 'Proposed: Combined Adaptive Optimizer',
    shortName: 'Combined Opt.',
    description:
      'Multi-criteria urgency scoring, traffic-compensated adaptive headways, surplus off-peak dispatch, and proactive directional rebalancing.',
    mechanism: 'Urgency Score + Traffic Comp. + Proactive Rebalance',
  },
};

export interface PolicyDecisionInput {
  policy: DispatchPolicy | AblationPolicy;
  terminal: TerminalId;
  time: number;
  queueLength: number;
  oldestArrivalTime: number | null;
  availableBusesAtTerminal: number;
  oppositeQueueLength: number;
  oppositeAvailableBuses: number;
  incomingBusesToTerminal: number;
  incomingBusesToOpposite: number;
  busCapacity: number;
  timeSinceLastDispatch: number;
  baselineHeadway: number;
  bestStaticSchedule: StaticScheduleParams;
  ewmaArrivalRate: number;
  oppositeEwmaArrivalRate: number;
  expectedTripTime: number;
  recentTrafficDelay: number;
}

export interface PolicyDecisionOutput {
  shouldDispatch: boolean;
  shouldRepositionFromOpposite: boolean;
  reason: string;
  targetHeadway: number;
  priorityScore: number;
}

export function getBestStaticHeadwayAtTime(
  time: number,
  sched: StaticScheduleParams
): number {
  if (time >= 30 && time < 90) return sched.morningPeakHeadway;
  if (time >= 390 && time < 480) return sched.afternoonPeakHeadway;
  return sched.offPeakHeadway;
}

export function evaluateDispatchPolicy(
  input: PolicyDecisionInput
): PolicyDecisionOutput {
  const {
    policy,
    terminal,
    time,
    queueLength,
    oldestArrivalTime,
    availableBusesAtTerminal,
    oppositeQueueLength,
    oppositeAvailableBuses,
    incomingBusesToTerminal,
    busCapacity,
    timeSinceLastDispatch,
    baselineHeadway,
    bestStaticSchedule,
    ewmaArrivalRate,
    oppositeEwmaArrivalRate,
    expectedTripTime,
    recentTrafficDelay,
  } = input;

  const oldestWait = oldestArrivalTime !== null ? Math.max(0, time - oldestArrivalTime) : 0;

  // (a) Context: Assumed Current Static (12-min all day)
  if (policy === 'BASELINE_CURRENT') {
    const shouldDispatch =
      availableBusesAtTerminal > 0 && timeSinceLastDispatch >= baselineHeadway - 1e-6;
    return {
      shouldDispatch,
      shouldRepositionFromOpposite: false,
      reason: shouldDispatch
        ? `Fixed ${baselineHeadway}m schedule elapsed at ${terminal}`
        : 'Holding for fixed schedule interval',
      targetHeadway: baselineHeadway,
      priorityScore: timeSinceLastDispatch / Math.max(1, baselineHeadway),
    };
  }

  // (b) Fair Benchmark: Best-Tuned Static Time-of-Day Timetable
  if (policy === 'BASELINE_BEST_STATIC') {
    const hStatic = getBestStaticHeadwayAtTime(time, bestStaticSchedule);
    const shouldDispatch =
      availableBusesAtTerminal > 0 && timeSinceLastDispatch >= hStatic - 1e-6;
    return {
      shouldDispatch,
      shouldRepositionFromOpposite: false,
      reason: shouldDispatch
        ? `Tuned static window headway ${hStatic}m elapsed at ${terminal}`
        : `Holding for static timetable (${hStatic}m)`,
      targetHeadway: hStatic,
      priorityScore: timeSinceLastDispatch / Math.max(1, hStatic),
    };
  }

  // Policy B: Queue-Aware Dispatching
  if (policy === 'QUEUE_AWARE') {
    const queueTrigger = Math.round(busCapacity * 0.64); // 32 pax for K=50
    const minAntiBunchingGap = 2.5;
    const maxWaitThreshold = 8.0;
    const maxFallbackHeadway = 15.0;

    let shouldDispatch = false;
    let reason = 'Monitoring queue';

    if (availableBusesAtTerminal > 0) {
      if (queueLength >= busCapacity) {
        shouldDispatch = true;
        reason = `Full load dispatch (${queueLength}/${busCapacity} waiting)`;
      } else if (queueLength >= queueTrigger && timeSinceLastDispatch >= minAntiBunchingGap) {
        shouldDispatch = true;
        reason = `Queue threshold reached (${queueLength} >= ${queueTrigger} pax)`;
      } else if (
        queueLength > 0 &&
        oldestWait >= maxWaitThreshold &&
        timeSinceLastDispatch >= minAntiBunchingGap
      ) {
        shouldDispatch = true;
        reason = `Wait SLA guard triggered (${oldestWait.toFixed(1)}m oldest wait)`;
      } else if (queueLength > 0 && timeSinceLastDispatch >= maxFallbackHeadway) {
        shouldDispatch = true;
        reason = `Fallback headway safeguard (${maxFallbackHeadway}m)`;
      }
    }

    const shouldRepositionFromOpposite =
      availableBusesAtTerminal === 0 &&
      incomingBusesToTerminal === 0 &&
      queueLength >= Math.round(busCapacity * 0.5) &&
      oppositeAvailableBuses >= 2 &&
      oppositeQueueLength < Math.round(busCapacity * 0.35);

    return {
      shouldDispatch,
      shouldRepositionFromOpposite,
      reason,
      targetHeadway: queueLength >= queueTrigger ? minAntiBunchingGap : maxFallbackHeadway,
      priorityScore: queueLength / busCapacity,
    };
  }

  // Policy C: Adaptive Headway Scheduling (Newell square-root law)
  if (policy === 'ADAPTIVE_HEADWAY') {
    const refRate = 3.0;
    const hBase = 11.0;
    const effectiveRate = Math.max(0.4, ewmaArrivalRate);
    const adaptiveHeadway = Math.max(
      3.5,
      Math.min(18.0, hBase * Math.sqrt(refRate / effectiveRate))
    );

    let shouldDispatch = false;
    let reason = 'Adaptive headway pacing';

    if (availableBusesAtTerminal > 0) {
      if (queueLength >= busCapacity * 0.95 && timeSinceLastDispatch >= 2.0) {
        shouldDispatch = true;
        reason = `Capacity overflow relief (${queueLength} waiting)`;
      } else if (queueLength > 0 && timeSinceLastDispatch >= adaptiveHeadway) {
        shouldDispatch = true;
        reason = `Adaptive headway ${adaptiveHeadway.toFixed(1)}m elapsed (λ̂=${effectiveRate.toFixed(1)}/m)`;
      }
    }

    return {
      shouldDispatch,
      shouldRepositionFromOpposite: false,
      reason,
      targetHeadway: adaptiveHeadway,
      priorityScore: timeSinceLastDispatch / adaptiveHeadway,
    };
  }

  // Proposed Policy D: Combined Adaptive Demand-Aware Optimizer (+ Ablation variants)
  const useRebalance = policy !== 'ABLATION_NO_REBALANCE';
  const useTrafficComp = policy !== 'ABLATION_NO_TRAFFIC_COMP';
  const useSurplus = policy !== 'ABLATION_NO_SURPLUS';
  const useUrgency = policy !== 'ABLATION_NO_URGENCY';

  const effectiveRate = Math.max(0.35, ewmaArrivalRate);
  const trafficFactor = useTrafficComp ? Math.max(0.7, 1 - recentTrafficDelay / 30) : 1.0;
  const targetHeadway = Math.max(
    2.6,
    Math.min(14.0, 9.5 * Math.sqrt(3.0 / effectiveRate) * trafficFactor)
  );

  const queuePressure = queueLength / busCapacity;
  const waitUrgency = oldestWait / 6.5;
  const headwayRatio = timeSinceLastDispatch / targetHeadway;
  const projectedArrivals = (effectiveRate * 3.5) / busCapacity;
  const minSafeGap = availableBusesAtTerminal >= 2 ? 2.0 : 2.6;
  const bunchingPenalty =
    timeSinceLastDispatch < minSafeGap && queueLength < busCapacity ? 0.9 : 0;

  const priorityScore =
    0.45 * queuePressure +
    0.35 * waitUrgency +
    0.28 * headwayRatio +
    0.14 * projectedArrivals -
    bunchingPenalty;

  let shouldDispatch = false;
  let reason = 'Balancing headway and queue load';

  if (availableBusesAtTerminal > 0 && queueLength > 0) {
    if (queueLength >= busCapacity && timeSinceLastDispatch >= 1.5) {
      shouldDispatch = true;
      reason = `Full-capacity priority dispatch (${queueLength} waiting)`;
    } else if (
      useSurplus &&
      availableBusesAtTerminal >= 2 &&
      (oldestWait >= 5.5 || queueLength >= Math.round(busCapacity * 0.25)) &&
      timeSinceLastDispatch >= 2.5
    ) {
      shouldDispatch = true;
      reason = `Surplus-bus responsiveness (Q=${queueLength}, Wmax=${oldestWait.toFixed(1)}m)`;
    } else if (useUrgency && priorityScore >= 0.85 && timeSinceLastDispatch >= minSafeGap) {
      shouldDispatch = true;
      reason = `Multi-criteria urgency trigger (score=${priorityScore.toFixed(2)}, Q=${queueLength})`;
    } else if (!useUrgency && timeSinceLastDispatch >= targetHeadway) {
      shouldDispatch = true;
      reason = `Ablation headway pacing (${targetHeadway.toFixed(1)}m)`;
    } else if (oldestWait >= 7.5 && timeSinceLastDispatch >= 2.0) {
      shouldDispatch = true;
      reason = `Tail-wait SLA guard (${oldestWait.toFixed(1)}m wait)`;
    }
  }

  // Proactive directional rebalancing across terminals
  const projectedLocalDemand =
    queueLength + effectiveRate * Math.min(expectedTripTime, 11);
  const incomingCapacity = incomingBusesToTerminal * busCapacity;
  const projectedOppositeDemand =
    oppositeQueueLength + oppositeEwmaArrivalRate * 9;

  const shouldRepositionFromOpposite =
    useRebalance &&
    availableBusesAtTerminal === 0 &&
    oppositeAvailableBuses >= 1 &&
    projectedLocalDemand - incomingCapacity >= busCapacity * 0.42 &&
    oppositeQueueLength < busCapacity * 0.32 &&
    (oppositeAvailableBuses >= 2 ||
      projectedOppositeDemand < busCapacity * 0.45);

  return {
    shouldDispatch,
    shouldRepositionFromOpposite,
    reason,
    targetHeadway,
    priorityScore,
  };
}
