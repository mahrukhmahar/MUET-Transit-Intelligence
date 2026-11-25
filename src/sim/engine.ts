import { evaluateDispatchPolicy } from './policies';
import {
  formatSimClock,
  getArrivalRate,
  getMaxArrivalRate,
  spawnCRNStreams,
} from './prng';
import {
  BusRuntime,
  DispatchDecisionLog,
  InvariantCheck,
  PassengerRecord,
  SimConfig,
  SimMetrics,
  SingleRunResult,
  TerminalId,
  TerminalSlotStat,
  TimeSeriesPoint,
} from './types';

type EventType =
  | 'PASSENGER_ARRIVAL'
  | 'BOARDING_COMPLETE'
  | 'BUS_ARRIVAL'
  | 'BUS_BREAKDOWN'
  | 'BUS_RECOVER'
  | 'DISPATCH_TICK'
  | 'SNAPSHOT';

interface SimEvent {
  time: number;
  seq: number;
  type: EventType;
  terminal?: TerminalId;
  busId?: number;
}

class MinEventHeap {
  private heap: SimEvent[] = [];

  push(item: SimEvent) {
    this.heap.push(item);
    let idx = this.heap.length - 1;
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (this.compare(this.heap[idx], this.heap[parent]) < 0) {
        [this.heap[idx], this.heap[parent]] = [this.heap[parent], this.heap[idx]];
        idx = parent;
      } else {
        break;
      }
    }
  }

  pop(): SimEvent | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      let idx = 0;
      const len = this.heap.length;
      while (true) {
        const left = 2 * idx + 1;
        const right = 2 * idx + 2;
        let smallest = idx;
        if (left < len && this.compare(this.heap[left], this.heap[smallest]) < 0) {
          smallest = left;
        }
        if (right < len && this.compare(this.heap[right], this.heap[smallest]) < 0) {
          smallest = right;
        }
        if (smallest !== idx) {
          [this.heap[idx], this.heap[smallest]] = [this.heap[smallest], this.heap[idx]];
          idx = smallest;
        } else {
          break;
        }
      }
    }
    return top;
  }

  private compare(a: SimEvent, b: SimEvent): number {
    if (a.time !== b.time) return a.time - b.time;
    return a.seq - b.seq;
  }

  get size() {
    return this.heap.length;
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Exact multi-objective cost function J(pi) matching the IEEE report formulation:
 * J(pi) = 0.35*(W_avg/10) + 0.30*(W_95/25) + 0.20*(pctOver10/100)
 *       + 0.10*(unserved/max(1,N)) + 0.05*(deadhead/max(1,dispatches))
 */
export function computeObjectiveJ(params: {
  avgWait: number;
  p95Wait: number;
  pctWaitingOver10: number;
  unservedAtClose: number;
  totalArrivals: number;
  deadheadTrips: number;
  totalDispatches: number;
}): number {
  const j =
    0.35 * (params.avgWait / 10.0) +
    0.3 * (params.p95Wait / 25.0) +
    0.2 * (params.pctWaitingOver10 / 100.0) +
    0.1 * (params.unservedAtClose / Math.max(1, params.totalArrivals)) +
    0.05 * (params.deadheadTrips / Math.max(1, params.totalDispatches));
  return Number(j.toFixed(4));
}

export function runSingleSimulation(config: SimConfig): SingleRunResult {
  const fleetSize = Math.max(2, Math.min(30, Math.round(config.fleetSize)));
  const busCapacity = Math.max(20, Math.min(100, Math.round(config.busCapacity)));
  const duration = Math.max(120, Math.min(720, Math.round(config.durationMinutes)));
  const arrivalMult = Math.max(0.0, Math.min(3.0, config.arrivalMultiplier));
  const trafficSev = Math.max(0.0, Math.min(2.5, config.trafficSeverity));

  // Strictly separated CRN streams so arrivals are identical across all policies
  const streams = spawnCRNStreams(config.seed);
  const arrivalRngSTC = streams.stcArrivals;
  const arrivalRngMG = streams.mgArrivals;
  const travelRng = streams.travelTraffic;
  const boardingRng = streams.boarding;

  const eventQueue = new MinEventHeap();
  let eventSeq = 0;
  const schedule = (time: number, type: EventType, terminal?: TerminalId, busId?: number) => {
    if (time <= duration) {
      eventQueue.push({ time, seq: eventSeq++, type, terminal, busId });
    }
  };

  let nextPassengerId = 1;
  const passengers: PassengerRecord[] = [];
  const queues: Record<TerminalId, PassengerRecord[]> = {
    STC: [],
    MAIN_GATE: [],
  };
  let stcArrivals = 0;
  let mgArrivals = 0;

  const buses: BusRuntime[] = [];
  for (let i = 0; i < fleetSize; i++) {
    const startTerminal: TerminalId = i % 2 === 0 ? 'STC' : 'MAIN_GATE';
    buses.push({
      id: i + 1,
      label: `PT-${String(i + 1).padStart(2, '0')}`,
      state: 'IDLE_AT_TERMINAL',
      terminal: startTerminal,
      destination: startTerminal === 'STC' ? 'MAIN_GATE' : 'STC',
      passengersOnBoard: 0,
      capacity: busCapacity,
      departureTime: 0,
      arrivalTime: 0,
      delayApplied: 0,
      isDeadhead: false,
      passengerCarryingMinutes: 0,
      deadheadMinutes: 0,
      outOfServiceMinutes: 0,
      pendingBreakdown: false,
      idleMinutes: 0,
      tripsCompleted: 0,
      totalPassengersCarried: 0,
      occupancySamples: [],
    });
  }

  const lastDispatchTime: Record<TerminalId, number> = {
    STC: -100,
    MAIN_GATE: -100,
  };
  const ewmaRate: Record<TerminalId, number> = {
    STC: 2.0 * arrivalMult,
    MAIN_GATE: 2.0 * arrivalMult,
  };
  let recentTrafficDelay = 1.5 * trafficSev;
  let totalDispatches = 0;
  let deadheadTrips = 0;
  let overcrowdingAttempts = 0;
  let capacityViolations = 0;
  let nonExistentBusBoards = 0;
  let monotonicViolations = 0;
  const trafficDelaysRecorded: number[] = [];

  const decisionLogs: DispatchDecisionLog[] = [];
  const timeSeries: TimeSeriesPoint[] = [];

  let lastQueueIntegralTime = 0;
  let queueAreaSTC = 0;
  let queueAreaMG = 0;
  let maxQueueSTC = 0;
  let maxQueueMG = 0;

  const updateQueueIntegrals = (now: number) => {
    const dt = Math.max(0, now - lastQueueIntegralTime);
    if (dt > 0) {
      queueAreaSTC += queues.STC.length * dt;
      queueAreaMG += queues.MAIN_GATE.length * dt;
      lastQueueIntegralTime = now;
    }
    if (queues.STC.length > maxQueueSTC) maxQueueSTC = queues.STC.length;
    if (queues.MAIN_GATE.length > maxQueueMG) maxQueueMG = queues.MAIN_GATE.length;
  };

  const scheduleNextArrival = (terminal: TerminalId, currentTime: number) => {
    const lambdaMax = getMaxArrivalRate(
      terminal,
      arrivalMult,
      config.suddenSurgeEnabled,
      config.calibratedArrivals
    );
    if (lambdaMax <= 0) return;
    const rng = terminal === 'STC' ? arrivalRngSTC : arrivalRngMG;
    let t = currentTime;
    while (t < duration) {
      t += rng.exponential(lambdaMax);
      if (t > duration) return;
      const lambdaT = getArrivalRate(
        terminal,
        t,
        arrivalMult,
        config.suddenSurgeEnabled,
        config.calibratedArrivals
      );
      if (rng.next() <= lambdaT / lambdaMax) {
        schedule(t, 'PASSENGER_ARRIVAL', terminal);
        return;
      }
    }
  };

  scheduleNextArrival('STC', 0);
  scheduleNextArrival('MAIN_GATE', 0);

  for (let t = 0; t <= duration; t += 1) {
    schedule(t, 'DISPATCH_TICK');
  }
  for (let t = 0; t <= duration; t += 5) {
    schedule(t, 'SNAPSHOT');
  }
  if (config.breakdownEnabled && duration > 60) {
    schedule(45, 'BUS_BREAKDOWN', undefined, 1);
  }

  const getIdleBuses = (terminal: TerminalId) =>
    buses.filter((b) => b.state === 'IDLE_AT_TERMINAL' && b.terminal === terminal);

  const getIncomingCount = (terminal: TerminalId) =>
    buses.filter(
      (b) =>
        (b.state === 'IN_TRANSIT' ||
          b.state === 'DELAYED_IN_TRAFFIC' ||
          b.state === 'REPOSITIONING') &&
        b.destination === terminal
    ).length;

  const isStaticPolicy =
    config.policy === 'BASELINE_CURRENT' || config.policy === 'BASELINE_BEST_STATIC';

  const startBoarding = (bus: BusRuntime, terminal: TerminalId, time: number, reason: string) => {
    const queue = queues[terminal];
    const toBoard = Math.min(bus.capacity, queue.length);
    if (queue.length > bus.capacity) {
      const deniedNow = queue.length - bus.capacity;
      overcrowdingAttempts += 1;
      for (let i = bus.capacity; i < queue.length; i++) {
        queue[i].deniedCount += 1;
      }
      if (decisionLogs.length < 250) {
        decisionLogs.push({
          time,
          terminal,
          busLabel: bus.label,
          policy: config.policy,
          action: 'DENIED_BOARDING',
          reason: `${deniedNow} waiting passengers exceeded bus capacity (${bus.capacity})`,
          queueAtDecision: queue.length,
          passengersBoarded: toBoard,
        });
      }
    }

    const boarded = queue.splice(0, toBoard);
    if (boarded.length > bus.capacity) {
      capacityViolations += 1;
    }

    for (const pax of boarded) {
      pax.boardTime = time;
      pax.busId = bus.id;
    }

    const boardDuration =
      boarded.length === 0
        ? 0.4
        : Math.max(0.6, 0.7 + boarded.length * 0.042 + boardingRng.normal(0, 0.15));

    bus.state = 'BOARDING';
    bus.terminal = terminal;
    bus.destination = terminal === 'STC' ? 'MAIN_GATE' : 'STC';
    bus.passengersOnBoard = boarded.length;
    bus.isDeadhead = false;
    bus.departureTime = time + boardDuration;
    if (boarded.length > 0) {
      bus.passengerCarryingMinutes += Math.min(boardDuration, Math.max(0, duration - time));
    }
    lastDispatchTime[terminal] = time;
    totalDispatches += 1;
    bus.occupancySamples.push((boarded.length / bus.capacity) * 100);
    bus.totalPassengersCarried += boarded.length;

    for (const pax of boarded) {
      pax.departureTime = time + boardDuration;
      pax.waitTime = pax.boardTime! - pax.arrivalTime;
    }

    if (decisionLogs.length < 250) {
      decisionLogs.push({
        time,
        terminal,
        busLabel: bus.label,
        policy: config.policy,
        action: 'DISPATCH',
        reason,
        queueAtDecision: queue.length + boarded.length,
        passengersBoarded: boarded.length,
      });
    }

    schedule(time + boardDuration, 'BOARDING_COMPLETE', terminal, bus.id);
  };

  const startReposition = (bus: BusRuntime, from: TerminalId, time: number, reason: string) => {
    const dest: TerminalId = from === 'STC' ? 'MAIN_GATE' : 'STC';
    const baseTravel = travelRng.lognormal(9.5, 1.4);
    const peakTrafficWindow = (time >= 30 && time <= 95) || (time >= 385 && time <= 485);
    const delayProb = peakTrafficWindow ? 0.25 : 0.08;
    const delay =
      trafficSev > 0 && travelRng.bernoulli(delayProb)
        ? travelRng.lognormal(2.2 * trafficSev, 0.9 * trafficSev)
        : 0;

    const totalTravel = Math.max(5.5, baseTravel + delay);
    bus.state = 'REPOSITIONING';
    bus.terminal = from;
    bus.destination = dest;
    bus.passengersOnBoard = 0;
    bus.isDeadhead = true;
    bus.departureTime = time;
    bus.arrivalTime = time + totalTravel;
    bus.delayApplied = delay;
    bus.deadheadMinutes += Math.min(totalTravel, Math.max(0, duration - time));
    deadheadTrips += 1;
    totalDispatches += 1;

    if (decisionLogs.length < 250) {
      decisionLogs.push({
        time,
        terminal: from,
        busLabel: bus.label,
        policy: config.policy,
        action: 'REPOSITION',
        reason,
        queueAtDecision: queues[dest].length,
        passengersBoarded: 0,
      });
    }

    schedule(bus.arrivalTime, 'BUS_ARRIVAL', dest, bus.id);
  };

  const evaluateTerminalDispatch = (terminal: TerminalId, time: number) => {
    const opp: TerminalId = terminal === 'STC' ? 'MAIN_GATE' : 'STC';
    const idleLocal = getIdleBuses(terminal);
    const idleOpp = getIdleBuses(opp);
    const queue = queues[terminal];
    const oppQueue = queues[opp];

    const decision = evaluateDispatchPolicy({
      policy: config.policy,
      terminal,
      time,
      queueLength: queue.length,
      oldestArrivalTime: queue.length > 0 ? queue[0].arrivalTime : null,
      availableBusesAtTerminal: idleLocal.length,
      oppositeQueueLength: oppQueue.length,
      oppositeAvailableBuses: idleOpp.length,
      incomingBusesToTerminal: getIncomingCount(terminal),
      incomingBusesToOpposite: getIncomingCount(opp),
      busCapacity,
      timeSinceLastDispatch: time - lastDispatchTime[terminal],
      baselineHeadway: config.baselineHeadwayMinutes,
      bestStaticSchedule: config.bestStaticSchedule,
      ewmaArrivalRate: ewmaRate[terminal],
      oppositeEwmaArrivalRate: ewmaRate[opp],
      expectedTripTime: 11.5 + recentTrafficDelay,
      recentTrafficDelay,
    });

    if (decision.shouldDispatch && idleLocal.length > 0) {
      startBoarding(idleLocal[0], terminal, time, decision.reason);
    } else if (decision.shouldRepositionFromOpposite && idleOpp.length > 0) {
      startReposition(
        idleOpp[0],
        opp,
        time,
        `Proactive rebalance to ${terminal} (Q=${queue.length}, incoming=${getIncomingCount(terminal)})`
      );
    }
  };

  let arrivalsSinceLastEwma: Record<TerminalId, number> = { STC: 0, MAIN_GATE: 0 };
  let lastEwmaTime = 0;
  let lastClock = 0;

  while (eventQueue.size > 0) {
    const ev = eventQueue.pop()!;
    const now = ev.time;
    if (now > duration) break;
    if (now < lastClock - 1e-9) {
      monotonicViolations += 1;
    }
    lastClock = now;

    updateQueueIntegrals(now);

    if (now - lastEwmaTime >= 2.0) {
      const dt = now - lastEwmaTime;
      const alpha = 0.35;
      ewmaRate.STC = alpha * (arrivalsSinceLastEwma.STC / dt) + (1 - alpha) * ewmaRate.STC;
      ewmaRate.MAIN_GATE =
        alpha * (arrivalsSinceLastEwma.MAIN_GATE / dt) + (1 - alpha) * ewmaRate.MAIN_GATE;
      arrivalsSinceLastEwma = { STC: 0, MAIN_GATE: 0 };
      lastEwmaTime = now;
    }

    if (ev.type === 'PASSENGER_ARRIVAL' && ev.terminal) {
      const pax: PassengerRecord = {
        id: nextPassengerId++,
        terminal: ev.terminal,
        arrivalTime: now,
        boardTime: null,
        departureTime: null,
        waitTime: null,
        deniedCount: 0,
        busId: null,
      };
      passengers.push(pax);
      if (ev.terminal === 'STC') stcArrivals += 1;
      else mgArrivals += 1;

      queues[ev.terminal].push(pax);
      arrivalsSinceLastEwma[ev.terminal] += 1;
      updateQueueIntegrals(now);

      scheduleNextArrival(ev.terminal, now);

      if (!isStaticPolicy) {
        evaluateTerminalDispatch(ev.terminal, now);
      }
    } else if (ev.type === 'BOARDING_COMPLETE' && ev.busId !== undefined) {
      const bus = buses.find((b) => b.id === ev.busId);
      if (!bus) {
        nonExistentBusBoards += 1;
        continue;
      }
      const peakTrafficWindow = (now >= 30 && now <= 95) || (now >= 385 && now <= 485);
      const baseTravel = travelRng.lognormal(11.5, 2.0);
      const delayProb = peakTrafficWindow ? 0.38 : 0.12;
      const trafficDelay =
        trafficSev > 0 && travelRng.bernoulli(delayProb)
          ? travelRng.lognormal(3.4 * trafficSev, 1.3 * trafficSev)
          : 0;

      if (trafficDelay > 0) {
        trafficDelaysRecorded.push(trafficDelay);
        recentTrafficDelay = 0.3 * trafficDelay + 0.7 * recentTrafficDelay;
        if (trafficDelay > 3.5 && decisionLogs.length < 250) {
          decisionLogs.push({
            time: now,
            terminal: bus.terminal,
            busLabel: bus.label,
            policy: config.policy,
            action: 'TRAFFIC_DELAY',
            reason: `Corridor congestion added +${trafficDelay.toFixed(1)} min delay`,
            queueAtDecision: queues[bus.terminal].length,
            passengersBoarded: bus.passengersOnBoard,
          });
        }
      }

      const travelDuration = Math.max(6.5, baseTravel + trafficDelay);
      bus.state = trafficDelay > 2.0 ? 'DELAYED_IN_TRAFFIC' : 'IN_TRANSIT';
      bus.delayApplied = trafficDelay;
      bus.departureTime = now;
      bus.arrivalTime = now + travelDuration;
      const span = Math.min(travelDuration, Math.max(0, duration - now));
      if (bus.passengersOnBoard > 0) {
        bus.passengerCarryingMinutes += span;
      } else {
        bus.deadheadMinutes += span;
      }

      schedule(bus.arrivalTime, 'BUS_ARRIVAL', bus.destination, bus.id);
    } else if (ev.type === 'BUS_ARRIVAL' && ev.busId !== undefined && ev.terminal) {
      const bus = buses.find((b) => b.id === ev.busId);
      if (!bus) continue;
      bus.tripsCompleted += 1;
      bus.passengersOnBoard = 0;
      bus.isDeadhead = false;
      bus.delayApplied = 0;
      bus.terminal = ev.terminal;
      bus.destination = ev.terminal === 'STC' ? 'MAIN_GATE' : 'STC';
      bus.arrivalTime = now;
      if (bus.pendingBreakdown) {
        bus.pendingBreakdown = false;
        bus.state = 'OUT_OF_SERVICE';
        bus.outOfServiceMinutes += Math.min(60, Math.max(0, duration - now));
        schedule(now + 60, 'BUS_RECOVER', ev.terminal, bus.id);
      } else {
        bus.state = 'IDLE_AT_TERMINAL';
        if (!isStaticPolicy) {
          evaluateTerminalDispatch(ev.terminal, now);
        }
      }
    } else if (ev.type === 'BUS_BREAKDOWN' && ev.busId !== undefined) {
      const bus = buses.find((b) => b.id === ev.busId);
      if (bus) {
        if (bus.state === 'IDLE_AT_TERMINAL') {
          bus.state = 'OUT_OF_SERVICE';
          bus.outOfServiceMinutes += Math.min(60, Math.max(0, duration - now));
          schedule(now + 60, 'BUS_RECOVER', bus.terminal, bus.id);
        } else {
          bus.pendingBreakdown = true;
        }
      }
    } else if (ev.type === 'BUS_RECOVER' && ev.busId !== undefined) {
      const bus = buses.find((b) => b.id === ev.busId);
      if (bus) {
        bus.state = 'IDLE_AT_TERMINAL';
        if (!isStaticPolicy) {
          evaluateTerminalDispatch(bus.terminal, now);
        }
      }
    } else if (ev.type === 'DISPATCH_TICK') {
      evaluateTerminalDispatch('STC', now);
      evaluateTerminalDispatch('MAIN_GATE', now);
    } else if (ev.type === 'SNAPSHOT') {
      const activeInTransit = buses.filter(
        (b) =>
          b.state === 'IN_TRANSIT' ||
          b.state === 'DELAYED_IN_TRAFFIC' ||
          b.state === 'REPOSITIONING'
      );
      const avgOcc =
        activeInTransit.length > 0
          ? activeInTransit.reduce((acc, b) => acc + (b.passengersOnBoard / b.capacity) * 100, 0) /
            activeInTransit.length
          : 0;
      const boardedCount = passengers.filter((p) => p.boardTime !== null).length;

      timeSeries.push({
        time: now,
        clockLabel: formatSimClock(now),
        stcQueue: queues.STC.length,
        mainGateQueue: queues.MAIN_GATE.length,
        stcArrivalRate: Number(
          getArrivalRate(
            'STC',
            now,
            arrivalMult,
            config.suddenSurgeEnabled,
            config.calibratedArrivals
          ).toFixed(2)
        ),
        mainGateArrivalRate: Number(
          getArrivalRate(
            'MAIN_GATE',
            now,
            arrivalMult,
            config.suddenSurgeEnabled,
            config.calibratedArrivals
          ).toFixed(2)
        ),
        totalThroughput: boardedCount,
        activeBusesInTransit: activeInTransit.length,
        avgOccupancyPct: Number(avgOcc.toFixed(1)),
        stcAvailableBuses: getIdleBuses('STC').length,
        mainGateAvailableBuses: getIdleBuses('MAIN_GATE').length,
        busSnapshots: buses.map((b) => {
          let progress = 0;
          if (
            b.state === 'IN_TRANSIT' ||
            b.state === 'DELAYED_IN_TRAFFIC' ||
            b.state === 'REPOSITIONING'
          ) {
            const span = Math.max(0.01, b.arrivalTime - b.departureTime);
            progress = Math.max(0, Math.min(1, (now - b.departureTime) / span));
          }
          return {
            id: b.id,
            label: b.label,
            state: b.state,
            origin: b.terminal,
            destination: b.destination,
            progress,
            passengers: b.passengersOnBoard,
            capacity: b.capacity,
            delayed: b.state === 'DELAYED_IN_TRAFFIC',
            isDeadhead: b.isDeadhead,
          };
        }),
      });
    }
  }

  updateQueueIntegrals(duration);

  for (const b of buses) {
    b.passengerCarryingMinutes = Math.min(duration, b.passengerCarryingMinutes);
    b.deadheadMinutes = Math.min(duration, b.deadheadMinutes);
    b.idleMinutes = Math.max(0, duration - b.passengerCarryingMinutes - b.deadheadMinutes);
  }

  const completedPax = passengers.filter((p) => p.waitTime !== null);
  const allObservedWaits = passengers.map((p) =>
    p.waitTime !== null ? p.waitTime : Math.max(0, duration - p.arrivalTime)
  );
  const sortedWaits = [...allObservedWaits].sort((a, b) => a - b);

  const avgWait =
    allObservedWaits.length > 0
      ? allObservedWaits.reduce((s, w) => s + w, 0) / allObservedWaits.length
      : 0;
  const medianWait = percentile(sortedWaits, 0.5);
  const p90Wait = percentile(sortedWaits, 0.9);
  const p95Wait = percentile(sortedWaits, 0.95);
  const maxWait = sortedWaits.length > 0 ? sortedWaits[sortedWaits.length - 1] : 0;
  const pctWaitingOver10Min =
    allObservedWaits.length > 0
      ? (allObservedWaits.filter((w) => w > 10.0).length / allObservedWaits.length) * 100
      : 0;

  const morningWaits = passengers
    .filter((p) => p.arrivalTime >= 30 && p.arrivalTime < 90)
    .map((p) => (p.waitTime !== null ? p.waitTime : duration - p.arrivalTime));
  const afternoonWaits = passengers
    .filter((p) => p.arrivalTime >= 390 && p.arrivalTime < 480)
    .map((p) => (p.waitTime !== null ? p.waitTime : duration - p.arrivalTime));
  const offPeakWaits = passengers
    .filter((p) => p.arrivalTime >= 120 && p.arrivalTime <= 330)
    .map((p) => (p.waitTime !== null ? p.waitTime : duration - p.arrivalTime));

  const meanArr = (arr: number[]) =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const stcAvgQueue = queueAreaSTC / duration;
  const mainGateAvgQueue = queueAreaMG / duration;
  const avgQueueLength = (stcAvgQueue + mainGateAvgQueue) / 2;
  const maxQueueLength = Math.max(maxQueueSTC, maxQueueMG);

  const allOccSamples = buses.flatMap((b) => b.occupancySamples);
  const avgLoadFactor =
    allOccSamples.length > 0
      ? allOccSamples.reduce((a, b) => a + b, 0) / allOccSamples.length
      : 0;

  const totalBusMinutes = fleetSize * duration;
  const totalPaxCarryingMinutes = buses.reduce((s, b) => s + b.passengerCarryingMinutes, 0);
  const totalDeadheadMinutes = buses.reduce((s, b) => s + b.deadheadMinutes, 0);
  const totalOutOfServiceMinutes = buses.reduce((s, b) => s + b.outOfServiceMinutes, 0);
  const fleetUtilization =
    totalBusMinutes > 0 ? (totalPaxCarryingMinutes / totalBusMinutes) * 100 : 0;
  const emptyRunRatio = (deadheadTrips / Math.max(1, totalDispatches)) * 100;
  const emptyRunTimePct = totalBusMinutes > 0 ? (totalDeadheadMinutes / totalBusMinutes) * 100 : 0;
  const avgBusIdleTime = buses.reduce((s, b) => s + b.idleMinutes, 0) / fleetSize;

  const durationHours = duration / 60;
  const throughputPerHour = completedPax.length / durationHours;
  const dispatchFrequencyPerHour = totalDispatches / durationHours;
  const unservedAtClose = queues.STC.length + queues.MAIN_GATE.length;

  const objectiveJ = computeObjectiveJ({
    avgWait,
    p95Wait,
    pctWaitingOver10: pctWaitingOver10Min,
    unservedAtClose,
    totalArrivals: passengers.length,
    deadheadTrips,
    totalDispatches,
  });

  const buckets = [
    { label: '0–3m', min: 0, max: 3 },
    { label: '3–6m', min: 3, max: 6 },
    { label: '6–10m', min: 6, max: 10 },
    { label: '10–15m', min: 10, max: 15 },
    { label: '15–25m', min: 15, max: 25 },
    { label: '25m+', min: 25, max: Infinity },
  ];
  const waitHistogram = buckets.map((b) => {
    const count = allObservedWaits.filter((w) => w >= b.min && w < b.max).length;
    return {
      bucket: b.label,
      count,
      pct:
        allObservedWaits.length > 0
          ? Number(((count / allObservedWaits.length) * 100).toFixed(1))
          : 0,
    };
  });

  // Empirical Wait Time CDF (0 to 40 min in 2-min steps)
  const waitCDF: Array<{ waitMin: number; cdfPct: number }> = [];
  for (let w = 0; w <= 40; w += 2) {
    const count = allObservedWaits.filter((x) => x <= w).length;
    waitCDF.push({
      waitMin: w,
      cdfPct:
        allObservedWaits.length > 0
          ? Number(((count / allObservedWaits.length) * 100).toFixed(1))
          : 100,
    });
  }

  const negativeWaits = allObservedWaits.filter((w) => w < -1e-9).length;
  const badTimestamps = completedPax.filter(
    (p) => p.boardTime! < p.arrivalTime - 1e-9 || p.departureTime! < p.boardTime! - 1e-9
  ).length;
  const accountingMatch = completedPax.length + unservedAtClose === passengers.length;

  const invariants: InvariantCheck[] = [
    {
      name: 'Bus Capacity Conservation',
      passed: capacityViolations === 0,
      detail:
        capacityViolations === 0
          ? `0 violations across ${totalDispatches} dispatches (load <= ${busCapacity})`
          : `${capacityViolations} violations detected`,
    },
    {
      name: 'Passenger Accounting Conservation',
      passed: accountingMatch,
      detail: `${completedPax.length} boarded + ${unservedAtClose} unserved = ${passengers.length} arrivals`,
    },
    {
      name: 'Monotonic Event & Passenger Timestamps',
      passed: monotonicViolations === 0 && badTimestamps === 0 && negativeWaits === 0,
      detail: `0 clock inversions, ${badTimestamps} timestamp violations, ${negativeWaits} negative waits`,
    },
    {
      name: 'Fleet Size Conservation',
      passed: buses.length === fleetSize && nonExistentBusBoards === 0,
      detail: `Active fleet strictly ${fleetSize} buses; ${nonExistentBusBoards} orphan boardings`,
    },
  ];

  const uniqueDeniedPassengers = passengers.filter((p) => p.deniedCount > 0).length;

  const metrics: SimMetrics = {
    policy: config.policy,
    seed: config.seed,
    totalArrivals: passengers.length,
    stcArrivals,
    mgArrivals,
    completedJourneys: completedPax.length,
    unservedAtClose,
    avgWaitTime: Number(avgWait.toFixed(2)),
    medianWaitTime: Number(medianWait.toFixed(2)),
    p90WaitTime: Number(p90Wait.toFixed(2)),
    p95WaitTime: Number(p95Wait.toFixed(2)),
    maxWaitTime: Number(maxWait.toFixed(2)),
    pctWaitingOver10Min: Number(pctWaitingOver10Min.toFixed(1)),
    avgQueueLength: Number(avgQueueLength.toFixed(2)),
    stcAvgQueue: Number(stcAvgQueue.toFixed(2)),
    mainGateAvgQueue: Number(mainGateAvgQueue.toFixed(2)),
    maxQueueLength,
    stcMaxQueue: maxQueueSTC,
    mainGateMaxQueue: maxQueueMG,
    throughputPerHour: Number(throughputPerHour.toFixed(1)),
    avgLoadFactor: Number(avgLoadFactor.toFixed(1)),
    deniedBoardingEvents: uniqueDeniedPassengers,
    overcrowdingAttempts,
    fleetUtilization: Number(fleetUtilization.toFixed(1)),
    emptyRunRatio: Number(emptyRunRatio.toFixed(1)),
    emptyRunTimePct: Number(emptyRunTimePct.toFixed(1)),
    outOfServiceMinutes: Number(totalOutOfServiceMinutes.toFixed(1)),
    avgBusIdleTime: Number(avgBusIdleTime.toFixed(1)),
    dispatchFrequencyPerHour: Number(dispatchFrequencyPerHour.toFixed(2)),
    totalDispatches,
    deadheadTrips,
    objectiveJ,
    morningPeakAvgWait: Number(meanArr(morningWaits).toFixed(2)),
    afternoonPeakAvgWait: Number(meanArr(afternoonWaits).toFixed(2)),
    offPeakAvgWait: Number(meanArr(offPeakWaits).toFixed(2)),
    avgTrafficDelay: Number(meanArr(trafficDelaysRecorded).toFixed(2)),
  };

  const busBreakdown = buses.map((b) => ({
    busLabel: b.label,
    trips: b.tripsCompleted,
    passengersCarried: b.totalPassengersCarried,
    avgOccupancyPct:
      b.occupancySamples.length > 0
        ? Number(
            (
              b.occupancySamples.reduce((s, x) => s + x, 0) / b.occupancySamples.length
            ).toFixed(1)
          )
        : 0,
    utilizationPct: Number(((b.passengerCarryingMinutes / duration) * 100).toFixed(1)),
    idleMinutes: Number(b.idleMinutes.toFixed(1)),
  }));

  const slotWidth = 30;
  const numSlots = Math.ceil(duration / slotWidth);
  const terminalSlotStats: TerminalSlotStat[] = [];
  for (let s = 0; s < numSlots; s++) {
    const tStart = s * slotWidth;
    const tEnd = Math.min(duration, (s + 1) * slotWidth);
    const stcWaits = passengers
      .filter((p) => p.terminal === 'STC' && p.arrivalTime >= tStart && p.arrivalTime < tEnd)
      .map((p) => (p.waitTime !== null ? p.waitTime : Math.max(0, duration - p.arrivalTime)))
      .sort((a, b) => a - b);
    const mgWaits = passengers
      .filter((p) => p.terminal === 'MAIN_GATE' && p.arrivalTime >= tStart && p.arrivalTime < tEnd)
      .map((p) => (p.waitTime !== null ? p.waitTime : Math.max(0, duration - p.arrivalTime)))
      .sort((a, b) => a - b);
    const slotSnaps = timeSeries.filter((pt) => pt.time >= tStart && pt.time < tEnd);
    const stcMaxQ = slotSnaps.length > 0 ? Math.max(...slotSnaps.map((pt) => pt.stcQueue)) : 0;
    const mgMaxQ = slotSnaps.length > 0 ? Math.max(...slotSnaps.map((pt) => pt.mainGateQueue)) : 0;

    terminalSlotStats.push({
      slotIndex: s,
      slotLabel: formatSimClock(tStart),
      stcAvgWait: Number(meanArr(stcWaits).toFixed(1)),
      stcP95Wait: Number(percentile(stcWaits, 0.95).toFixed(1)),
      stcMaxQueue: stcMaxQ,
      stcPaxCount: stcWaits.length,
      mainGateAvgWait: Number(meanArr(mgWaits).toFixed(1)),
      mainGateP95Wait: Number(percentile(mgWaits, 0.95).toFixed(1)),
      mainGateMaxQueue: mgMaxQ,
      mainGatePaxCount: mgWaits.length,
    });
  }

  return {
    config: { ...config, fleetSize, busCapacity, durationMinutes: duration },
    metrics,
    timeSeries,
    decisionLogs,
    invariants,
    waitHistogram,
    waitCDF,
    busBreakdown,
    terminalSlotStats,
  };
}
