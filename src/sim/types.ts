export type TerminalId = 'STC' | 'MAIN_GATE';

export type DispatchPolicy =
  | 'BASELINE_CURRENT'
  | 'BASELINE_BEST_STATIC'
  | 'QUEUE_AWARE'
  | 'ADAPTIVE_HEADWAY'
  | 'COMBINED';

export type AblationPolicy =
  | 'COMBINED'
  | 'ABLATION_NO_REBALANCE'
  | 'ABLATION_NO_TRAFFIC_COMP'
  | 'ABLATION_NO_SURPLUS'
  | 'ABLATION_NO_URGENCY';

export type BusState =
  | 'IDLE_AT_TERMINAL'
  | 'BOARDING'
  | 'IN_TRANSIT'
  | 'DELAYED_IN_TRAFFIC'
  | 'REPOSITIONING'
  | 'OUT_OF_SERVICE';

export interface StaticScheduleParams {
  offPeakHeadway: number;
  morningPeakHeadway: number;
  afternoonPeakHeadway: number;
}

export interface CalibratedArrivalSeries {
  sourceName: string;
  binMinutes: number; // e.g., 5 min bins
  stcRatesPerMin: number[]; // length covers horizon
  mgRatesPerMin: number[];
}

export interface SimConfig {
  fleetSize: number; // Number of Point buses (c)
  busCapacity: number; // Max passengers per bus (K)
  arrivalMultiplier: number; // Scales arrival rates (0.0 - 2.5)
  trafficSeverity: number; // Scales stochastic traffic delay magnitude (0.0 - 2.5)
  durationMinutes: number; // Operating window from 07:30 (default 510 min -> 16:00)
  baselineHeadwayMinutes: number; // Assumed current static headway (default 12 min)
  bestStaticSchedule: StaticScheduleParams; // Best-tuned static timetable found by grid search
  policy: DispatchPolicy;
  seed: number;
  replications: number;
  suddenSurgeEnabled: boolean; // Stress-test demand spike
  breakdownEnabled?: boolean; // PT-01 out-of-service for 60 min at 08:15
  calibratedArrivals?: CalibratedArrivalSeries | null;
}

export const DEFAULT_BEST_STATIC: StaticScheduleParams = {
  offPeakHeadway: 8,
  morningPeakHeadway: 4,
  afternoonPeakHeadway: 4,
};

export const DEFAULT_CONFIG: SimConfig = {
  fleetSize: 10,
  busCapacity: 50,
  arrivalMultiplier: 1.0,
  trafficSeverity: 1.0,
  durationMinutes: 510, // 07:30 AM to 04:00 PM
  baselineHeadwayMinutes: 12,
  bestStaticSchedule: DEFAULT_BEST_STATIC,
  policy: 'COMBINED',
  seed: 42,
  replications: 30,
  suddenSurgeEnabled: false,
  breakdownEnabled: false,
  calibratedArrivals: null,
};

export interface PassengerRecord {
  id: number;
  terminal: TerminalId;
  arrivalTime: number;
  boardTime: number | null;
  departureTime: number | null;
  waitTime: number | null;
  deniedCount: number;
  busId: number | null;
}

export interface BusRuntime {
  id: number;
  label: string;
  state: BusState;
  terminal: TerminalId;
  destination: TerminalId;
  passengersOnBoard: number;
  capacity: number;
  departureTime: number;
  arrivalTime: number;
  delayApplied: number;
  isDeadhead: boolean;
  passengerCarryingMinutes: number;
  deadheadMinutes: number;
  outOfServiceMinutes: number;
  pendingBreakdown: boolean;
  idleMinutes: number;
  tripsCompleted: number;
  totalPassengersCarried: number;
  occupancySamples: number[];
}

export interface DispatchDecisionLog {
  time: number;
  terminal: TerminalId;
  busLabel: string;
  policy: DispatchPolicy;
  action: 'DISPATCH' | 'REPOSITION' | 'TRAFFIC_DELAY' | 'DENIED_BOARDING';
  reason: string;
  queueAtDecision: number;
  passengersBoarded: number;
}

export interface TimeSeriesPoint {
  time: number;
  clockLabel: string;
  stcQueue: number;
  mainGateQueue: number;
  stcArrivalRate: number;
  mainGateArrivalRate: number;
  totalThroughput: number;
  activeBusesInTransit: number;
  avgOccupancyPct: number;
  stcAvailableBuses: number;
  mainGateAvailableBuses: number;
  busSnapshots: Array<{
    id: number;
    label: string;
    state: BusState;
    origin: TerminalId;
    destination: TerminalId;
    progress: number;
    passengers: number;
    capacity: number;
    delayed: boolean;
    isDeadhead: boolean;
  }>;
}

export interface InvariantCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface TerminalSlotStat {
  slotIndex: number;
  slotLabel: string;
  stcAvgWait: number;
  stcP95Wait: number;
  stcMaxQueue: number;
  stcPaxCount: number;
  mainGateAvgWait: number;
  mainGateP95Wait: number;
  mainGateMaxQueue: number;
  mainGatePaxCount: number;
}

export interface CongestionHeatmapDay {
  dayLabel: string;
  shiftNote: string;
  demandFactor: number;
  slots: TerminalSlotStat[];
}

export interface SimMetrics {
  policy: DispatchPolicy;
  seed: number;
  totalArrivals: number;
  stcArrivals: number;
  mgArrivals: number;
  completedJourneys: number;
  unservedAtClose: number;
  avgWaitTime: number;
  medianWaitTime: number;
  p90WaitTime: number;
  p95WaitTime: number;
  maxWaitTime: number;
  pctWaitingOver10Min: number;
  avgQueueLength: number;
  stcAvgQueue: number;
  mainGateAvgQueue: number;
  maxQueueLength: number;
  stcMaxQueue: number;
  mainGateMaxQueue: number;
  throughputPerHour: number;
  avgLoadFactor: number; // % capacity occupied across dispatched trips
  deniedBoardingEvents: number;
  overcrowdingAttempts: number;
  fleetUtilization: number; // Passenger-carrying bus-minutes / total bus-minutes (%)
  emptyRunRatio: number; // Deadhead trips / total dispatches (%)
  emptyRunTimePct: number; // Deadhead bus-minutes / total bus-minutes (%)
  outOfServiceMinutes: number;
  avgBusIdleTime: number;
  dispatchFrequencyPerHour: number;
  totalDispatches: number;
  deadheadTrips: number;
  objectiveJ: number; // Exact multi-objective J(pi) matching report formula
  morningPeakAvgWait: number;
  afternoonPeakAvgWait: number;
  offPeakAvgWait: number;
  avgTrafficDelay: number;
}

export interface SingleRunResult {
  config: SimConfig;
  metrics: SimMetrics;
  timeSeries: TimeSeriesPoint[];
  decisionLogs: DispatchDecisionLog[];
  invariants: InvariantCheck[];
  waitHistogram: Array<{ bucket: string; count: number; pct: number }>;
  waitCDF: Array<{ waitMin: number; cdfPct: number }>;
  busBreakdown: Array<{
    busLabel: string;
    trips: number;
    passengersCarried: number;
    avgOccupancyPct: number;
    utilizationPct: number;
    idleMinutes: number;
  }>;
  terminalSlotStats: TerminalSlotStat[];
}

export interface PairedMetricSummary {
  mean: number;
  std: number;
  ci95Low: number;
  ci95High: number;
  // Paired difference vs Best-Tuned Static Timetable (policy - bestStatic)
  pairedDiffMean: number;
  pairedDiffCi95Low: number;
  pairedDiffCi95High: number;
  improvementVsBestStaticPct: number;
  improvementVsCurrentPct: number;
  cohensDz: number;
  statisticallySignificant: boolean; // 95% paired CI excludes 0
}

export interface ScenarioAggregateResult {
  policy: DispatchPolicy;
  label: string;
  shortName: string;
  description: string;
  replications: number;
  metrics: {
    avgWaitTime: PairedMetricSummary;
    medianWaitTime: PairedMetricSummary;
    p90WaitTime: PairedMetricSummary;
    p95WaitTime: PairedMetricSummary;
    maxWaitTime: PairedMetricSummary;
    pctWaitingOver10Min: PairedMetricSummary;
    unservedAtClose: PairedMetricSummary;
    avgLoadFactor: PairedMetricSummary;
    avgQueueLength: PairedMetricSummary;
    maxQueueLength: PairedMetricSummary;
    deniedBoardingEvents: PairedMetricSummary;
    throughputPerHour?: PairedMetricSummary;
    fleetUtilization: PairedMetricSummary;
    emptyRunRatio: PairedMetricSummary;
    emptyRunTimePct: PairedMetricSummary;
    objectiveJ: PairedMetricSummary;
    morningPeakAvgWait: PairedMetricSummary;
    afternoonPeakAvgWait: PairedMetricSummary;
    offPeakAvgWait: PairedMetricSummary;
  };
  representativeRun: SingleRunResult;
}

export interface ParetoPoint {
  policy: DispatchPolicy;
  fleet_size: number;
  label: string;
  avg_wait_min: number;
  utilization_pct: number;
  empty_run_ratio_pct: number;
  load_factor_pct: number;
}

export interface WhatIfScenarioResult {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  replications: number;
  policies: Record<DispatchPolicy, Record<string, PairedMetricSummary>>;
}

export interface AblationVariantResult {
  policy: AblationPolicy;
  label: string;
  shortLabel: string;
  metrics: Record<string, PairedMetricSummary>;
}

export interface QueuingVerificationSummary {
  off_peak_lambda_corridor: number;
  mu_pax_per_bus: number;
  off_peak_mmc: {
    stable: boolean;
    rho: number;
    p_wait: number;
    lq: number | null;
    wq_min: number | null;
  };
  off_peak_scheduled_uniform_wait_min: number;
  off_peak_sim_combined_avg_wait_min: number;
  peak_unrebalanced_mmc: {
    stable: boolean;
    rho: number;
    p_wait: number;
    lq: number | null;
    wq_min: number | null;
  };
  des_justification: string;
}

export interface GridSearchCandidate {
  schedule: StaticScheduleParams;
  avgWaitTime: number;
  p95WaitTime: number;
  unservedAtClose: number;
  objectiveJ: number;
}

export interface FleetSweepPoint {
  fleetSize: number;
  bestStaticAvgWait: number;
  bestStaticP95Wait: number;
  bestStaticPctOver10: number;
  bestStaticMeetsSLA: boolean;
  combinedAvgWait: number;
  combinedP95Wait: number;
  combinedPctOver10: number;
  combinedMeetsSLA: boolean;
  queueAwareAvgWait: number;
  queueAwareP95Wait: number;
  queueAwareMeetsSLA: boolean;
  currentAvgWait: number;
  currentP95Wait: number;
}

export interface SensitivityPoint {
  parameterValue: string;
  numericValue: number;
  currentAvgWait: number;
  bestStaticAvgWait: number;
  combinedAvgWait: number;
  bestStaticP95Wait: number;
  combinedP95Wait: number;
  bestStaticPctOver10: number;
  combinedPctOver10: number;
  improvementVsBestStaticPct: number;
}

export interface SensitivitySuite {
  demandSweep: SensitivityPoint[];
  trafficSweep: SensitivityPoint[];
  fleetSweep: FleetSweepPoint[];
  minFleetForSLA: {
    bestStatic: number | null;
    combined: number | null;
    queueAware: number | null;
    currentAssumed: number | null;
  };
  surgeComparison: {
    normalBestStaticWait: number;
    normalCombinedWait: number;
    surgeBestStaticWait: number;
    surgeCombinedWait: number;
    surgeBestStaticP95: number;
    surgeCombinedP95: number;
    surgeBestStaticMaxQueue: number;
    surgeCombinedMaxQueue: number;
  };
}
