import { CalibratedArrivalSeries, TerminalId } from './types';

/**
 * Deterministic seeded PRNG (Mulberry32) shared verbatim with the Python parity core.
 */
export class SeededRNG {
  private state: number;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 1;
  }

  /** Uniform random float in [0, 1) */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Exponential distribution with rate lambda (> 0) */
  exponential(rate: number): number {
    if (rate <= 0) return Infinity;
    const u = Math.max(1e-12, 1 - this.next());
    return -Math.log(u) / rate;
  }

  /** Standard normal N(0, 1) via Box-Muller transform */
  normal(mean = 0, std = 1): number {
    const u1 = Math.max(1e-12, this.next());
    const u2 = this.next();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return mean + std * z0;
  }

  /** Lognormal distribution parameterized by desired arithmetic mean and std */
  lognormal(mean: number, std: number): number {
    if (std <= 0) return mean;
    const variance = std * std;
    const mu = Math.log((mean * mean) / Math.sqrt(variance + mean * mean));
    const sigma = Math.sqrt(Math.log(1 + variance / (mean * mean)));
    return Math.exp(this.normal(mu, sigma));
  }

  /** Bernoulli trial with probability p */
  bernoulli(p: number): boolean {
    return this.next() < p;
  }
}

export interface CRNStreams {
  stcArrivals: SeededRNG;
  mgArrivals: SeededRNG;
  travelTraffic: SeededRNG;
  boarding: SeededRNG;
}

/**
 * Spawns 4 strictly separated CRN streams so passenger arrivals are identical
 * across all dispatch policies under the same replication seed.
 */
export function spawnCRNStreams(seed: number): CRNStreams {
  const s = (seed >>> 0) || 1;
  return {
    stcArrivals: new SeededRNG(Math.imul(s, 1009) ^ 0x9e3779b1),
    mgArrivals: new SeededRNG(Math.imul(s, 2027) ^ 0x85ebca6b),
    travelTraffic: new SeededRNG(Math.imul(s, 3037) ^ 0xc2b2ae35),
    boarding: new SeededRNG(Math.imul(s, 4049) ^ 0x27d4eb2f),
  };
}

/**
 * Time-dependent arrival rate lambda(t) in passengers per minute.
 * Operating day starts at t = 0 (07:30 AM) through t = 510 (04:00 PM).
 * Supports both synthetic NHPP profiles and calibrated CSV empirical rates.
 */
export function getArrivalRate(
  terminal: TerminalId,
  tMinutes: number,
  arrivalMultiplier: number,
  suddenSurgeEnabled: boolean,
  calibratedArrivals?: CalibratedArrivalSeries | null
): number {
  if (arrivalMultiplier <= 0) return 0;

  let baseRate = 0;

  if (calibratedArrivals) {
    const binIdx = Math.max(0, Math.floor(tMinutes / calibratedArrivals.binMinutes));
    const arr =
      terminal === 'STC'
        ? calibratedArrivals.stcRatesPerMin
        : calibratedArrivals.mgRatesPerMin;
    if (arr.length > 0) {
      baseRate = arr[Math.min(binIdx, arr.length - 1)];
    }
  } else {
    const gaussian = (t: number, center: number, sigma: number) =>
      Math.exp(-0.5 * Math.pow((t - center) / sigma, 2));

    if (terminal === 'MAIN_GATE') {
      const baseline = 1.6;
      const morningPeak = 10.2 * gaussian(tMinutes, 60, 22);
      const midMorningShoulder = 1.8 * gaussian(tMinutes, 115, 25);
      const afternoonPeak = 2.6 * gaussian(tMinutes, 435, 32);
      baseRate = baseline + morningPeak + midMorningShoulder + afternoonPeak;
    } else {
      const baseline = 1.8;
      const morningPeak = 2.8 * gaussian(tMinutes, 65, 24);
      const lunchShift = 1.5 * gaussian(tMinutes, 315, 25);
      const afternoonPeak = 11.4 * gaussian(tMinutes, 430, 30);
      baseRate = baseline + morningPeak + lunchShift + afternoonPeak;
    }
  }

  if (suddenSurgeEnabled && terminal === 'STC' && tMinutes >= 240 && tMinutes <= 258) {
    baseRate += 7.5;
  }

  return Math.max(0.05, baseRate * arrivalMultiplier);
}

/**
 * Upper-bound rate lambda_max for Lewis-Shedler NHPP thinning algorithm.
 */
export function getMaxArrivalRate(
  terminal: TerminalId,
  arrivalMultiplier: number,
  suddenSurgeEnabled: boolean,
  calibratedArrivals?: CalibratedArrivalSeries | null
): number {
  if (arrivalMultiplier <= 0) return 0;
  let peak = terminal === 'MAIN_GATE' ? 14.5 : 15.5;
  if (calibratedArrivals) {
    const arr =
      terminal === 'STC'
        ? calibratedArrivals.stcRatesPerMin
        : calibratedArrivals.mgRatesPerMin;
    if (arr.length > 0) {
      peak = Math.max(0.5, ...arr) * 1.15;
    }
  }
  const surgeBonus = suddenSurgeEnabled && terminal === 'STC' ? 8.0 : 0;
  return (peak + surgeBonus) * arrivalMultiplier;
}

/**
 * Formats simulation minutes (0 = 07:30 AM) into HH:MM clock string.
 */
export function formatSimClock(tMinutes: number): string {
  const totalMinutes = Math.round(7 * 60 + 30 + tMinutes);
  const hh = Math.floor(totalMinutes / 60) % 24;
  const mm = totalMinutes % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
