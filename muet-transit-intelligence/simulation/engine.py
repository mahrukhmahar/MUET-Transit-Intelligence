"""SimPy Discrete-Event Simulation Engine (Canonical Python Deliverable)."""

from __future__ import annotations

from dataclasses import dataclass, field
import math
from pathlib import Path
from typing import Dict, List, Optional
import yaml
import numpy as np
import simpy

from optimization.policies import DispatchInput, StaticSchedule, evaluate_policy


@dataclass
class SimConfig:
    fleet_size: int = 10
    bus_capacity: int = 50
    arrival_multiplier: float = 1.0
    traffic_severity: float = 1.0
    duration_minutes: int = 510
    baseline_headway_minutes: float = 12.0
    best_static: StaticSchedule = field(default_factory=StaticSchedule)
    policy: str = "COMBINED"
    seed: int = 42
    sudden_surge_enabled: bool = False
    breakdown_enabled: bool = False


def compute_objective_j(
    avg_wait: float,
    p95_wait: float,
    pct_wait_over_10: float,
    unserved_at_close: int,
    total_arrivals: int,
    deadhead_trips: int,
    total_dispatches: int,
) -> float:
    return round(
        0.35 * (avg_wait / 10.0)
        + 0.30 * (p95_wait / 25.0)
        + 0.20 * (pct_wait_over_10 / 100.0)
        + 0.10 * (unserved_at_close / max(1, total_arrivals))
        + 0.05 * (deadhead_trips / max(1, total_dispatches)),
        4,
    )


def load_config(path: str | Path = "data/config.yaml") -> SimConfig:
    with open(path, "r", encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)
    return SimConfig(
        fleet_size=int(raw["fleet"]["fleet_size"]),
        bus_capacity=int(raw["fleet"]["bus_capacity"]),
        arrival_multiplier=float(raw["demand"]["arrival_multiplier"]),
        traffic_severity=float(raw["demand"]["traffic_severity"]),
        duration_minutes=int(raw["simulation"]["duration_minutes"]),
        baseline_headway_minutes=float(raw["simulation"]["baseline_headway_minutes"]),
        seed=int(raw["simulation"]["seed"]),
        sudden_surge_enabled=bool(raw["demand"].get("sudden_surge_enabled", False)),
    )


def arrival_rate_lambda(
    terminal: str, t_min: float, mult: float, surge: bool = False
) -> float:
    if mult <= 0.0:
        return 0.0

    def gauss(center: float, sigma: float) -> float:
        return math.exp(-0.5 * ((t_min - center) / sigma) ** 2)

    if terminal == "MAIN_GATE":
        base = 1.6 + 10.2 * gauss(60.0, 22.0) + 1.8 * gauss(115.0, 25.0) + 2.6 * gauss(435.0, 32.0)
    else:
        base = 1.8 + 2.8 * gauss(65.0, 24.0) + 1.5 * gauss(315.0, 25.0) + 11.4 * gauss(430.0, 30.0)

    if surge and terminal == "STC" and 240.0 <= t_min <= 258.0:
        base += 7.5
    return max(0.05, base * mult)


@dataclass
class Passenger:
    pid: int
    terminal: str
    arrival_time: float
    board_time: Optional[float] = None
    departure_time: Optional[float] = None
    denied_count: int = 0


@dataclass
class BusUnit:
    bus_id: int
    label: str
    terminal: str
    state: str = "IDLE_AT_TERMINAL"
    passengers_on_board: int = 0
    passenger_carrying_minutes: float = 0.0
    deadhead_minutes: float = 0.0
    out_of_service_minutes: float = 0.0
    pending_breakdown: bool = False
    trips_completed: int = 0
    occupancy_samples: List[float] = field(default_factory=list)


class MuetPointSimulation:
    """SimPy DES engine using 4 independent SeedSequence-spawned CRN RNG streams."""

    def __init__(self, config: SimConfig) -> None:
        self.cfg = config
        self.env = simpy.Environment()

        ss = np.random.SeedSequence(config.seed)
        c_stc, c_mg, c_travel, c_board = ss.spawn(4)
        self.rng_stc = np.random.default_rng(c_stc)
        self.rng_mg = np.random.default_rng(c_mg)
        self.rng_travel = np.random.default_rng(c_travel)
        self.rng_board = np.random.default_rng(c_board)

        self.passengers: List[Passenger] = []
        self.queues: Dict[str, List[Passenger]] = {"STC": [], "MAIN_GATE": []}
        self.buses: List[BusUnit] = [
            BusUnit(
                bus_id=i + 1,
                label=f"PT-{i + 1:02d}",
                terminal="STC" if i % 2 == 0 else "MAIN_GATE",
            )
            for i in range(config.fleet_size)
        ]
        self.last_dispatch: Dict[str, float] = {"STC": -100.0, "MAIN_GATE": -100.0}
        self.ewma_rate: Dict[str, float] = {
            "STC": 2.0 * config.arrival_multiplier,
            "MAIN_GATE": 2.0 * config.arrival_multiplier,
        }
        self.incoming_count: Dict[str, int] = {"STC": 0, "MAIN_GATE": 0}
        self.recent_traffic_delay = 1.5 * config.traffic_severity
        self.capacity_violations = 0
        self.total_dispatches = 0
        self.deadhead_trips = 0

    def _lognormal(self, rng: np.random.Generator, mean: float, std: float) -> float:
        if std <= 0:
            return mean
        var = std ** 2
        mu = math.log((mean ** 2) / math.sqrt(var + mean ** 2))
        sigma = math.sqrt(math.log(1.0 + var / (mean ** 2)))
        return float(rng.lognormal(mu, sigma))

    def _passenger_generator(self, terminal: str):
        if self.cfg.arrival_multiplier <= 0.0:
            return
        rng = self.rng_stc if terminal == "STC" else self.rng_mg
        lambda_max = (14.5 if terminal == "MAIN_GATE" else 15.5) + (
            8.0 if self.cfg.sudden_surge_enabled and terminal == "STC" else 0.0
        )
        lambda_max *= self.cfg.arrival_multiplier
        t = 0.0
        while t < self.cfg.duration_minutes:
            t += float(rng.exponential(1.0 / lambda_max))
            if t >= self.cfg.duration_minutes:
                break
            lam_t = arrival_rate_lambda(
                terminal, t, self.cfg.arrival_multiplier, self.cfg.sudden_surge_enabled
            )
            if float(rng.random()) <= lam_t / lambda_max:
                yield self.env.timeout(t - self.env.now)
                pax = Passenger(
                    pid=len(self.passengers) + 1,
                    terminal=terminal,
                    arrival_time=float(self.env.now),
                )
                self.passengers.append(pax)
                self.queues[terminal].append(pax)

    def _breakdown_watcher(self):
        if not self.cfg.breakdown_enabled or self.cfg.duration_minutes <= 60:
            return
        yield self.env.timeout(45.0)
        bus = self.buses[0]
        if bus.state == "IDLE_AT_TERMINAL":
            bus.state = "OUT_OF_SERVICE"
            bus.out_of_service_minutes += min(60.0, max(0.0, self.cfg.duration_minutes - self.env.now))
            yield self.env.timeout(60.0)
            bus.state = "IDLE_AT_TERMINAL"
        else:
            bus.pending_breakdown = True

    def _bus_trip_process(self, bus: BusUnit, origin: str, deadhead: bool = False):
        dest = "MAIN_GATE" if origin == "STC" else "STC"
        if not deadhead:
            queue = self.queues[origin]
            to_board = min(self.cfg.bus_capacity, len(queue))
            if len(queue) > self.cfg.bus_capacity:
                for p in queue[self.cfg.bus_capacity :]:
                    p.denied_count += 1
            boarded = queue[:to_board]
            del queue[:to_board]
            if len(boarded) > self.cfg.bus_capacity:
                self.capacity_violations += 1
            for p in boarded:
                p.board_time = float(self.env.now)
            board_dur = (
                0.4
                if to_board == 0
                else max(0.6, 0.7 + to_board * 0.042 + float(self.rng_board.normal(0.0, 0.15)))
            )
            bus.state = "BOARDING"
            bus.passengers_on_board = to_board
            bus.occupancy_samples.append((to_board / self.cfg.bus_capacity) * 100.0)
            self.last_dispatch[origin] = float(self.env.now)
            self.total_dispatches += 1
            if to_board > 0:
                bus.passenger_carrying_minutes += min(
                    board_dur, max(0.0, self.cfg.duration_minutes - self.env.now)
                )
            yield self.env.timeout(board_dur)
            for p in boarded:
                p.departure_time = float(self.env.now)
        else:
            bus.state = "REPOSITIONING"
            bus.passengers_on_board = 0
            self.deadhead_trips += 1
            self.total_dispatches += 1

        peak_window = (30.0 <= self.env.now <= 95.0) or (385.0 <= self.env.now <= 485.0)
        delay_prob = 0.38 if peak_window else 0.12
        delay = (
            self._lognormal(self.rng_travel, 3.4 * self.cfg.traffic_severity, 1.3 * self.cfg.traffic_severity)
            if self.cfg.traffic_severity > 0 and float(self.rng_travel.random()) < delay_prob
            else 0.0
        )
        if delay > 0:
            self.recent_traffic_delay = 0.3 * delay + 0.7 * self.recent_traffic_delay
        base_travel = self._lognormal(self.rng_travel, 9.5 if deadhead else 11.5, 1.4 if deadhead else 2.0)
        travel = max(5.5 if deadhead else 6.5, base_travel + delay)

        bus.state = "DELAYED_IN_TRAFFIC" if delay > 2.0 else ("REPOSITIONING" if deadhead else "IN_TRANSIT")
        self.incoming_count[dest] += 1
        span = min(travel, max(0.0, self.cfg.duration_minutes - self.env.now))
        if (not deadhead) and bus.passengers_on_board > 0:
            bus.passenger_carrying_minutes += span
        else:
            bus.deadhead_minutes += span
        yield self.env.timeout(travel)

        self.incoming_count[dest] -= 1
        bus.trips_completed += 1
        bus.passengers_on_board = 0
        bus.terminal = dest
        if bus.pending_breakdown:
            bus.pending_breakdown = False
            bus.state = "OUT_OF_SERVICE"
            bus.out_of_service_minutes += min(60.0, max(0.0, self.cfg.duration_minutes - self.env.now))
            yield self.env.timeout(60.0)
        bus.state = "IDLE_AT_TERMINAL"

    def _dispatcher_controller(self):
        while self.env.now < self.cfg.duration_minutes:
            for terminal in ("STC", "MAIN_GATE"):
                opp = "MAIN_GATE" if terminal == "STC" else "STC"
                idle_local = [b for b in self.buses if b.state == "IDLE_AT_TERMINAL" and b.terminal == terminal]
                idle_opp = [b for b in self.buses if b.state == "IDLE_AT_TERMINAL" and b.terminal == opp]
                q = self.queues[terminal]
                decision = evaluate_policy(
                    DispatchInput(
                        policy=self.cfg.policy,
                        terminal=terminal,
                        time=float(self.env.now),
                        queue_length=len(q),
                        oldest_arrival=q[0].arrival_time if q else None,
                        available_buses=len(idle_local),
                        opposite_queue_length=len(self.queues[opp]),
                        opposite_available_buses=len(idle_opp),
                        incoming_buses=self.incoming_count[terminal],
                        bus_capacity=self.cfg.bus_capacity,
                        time_since_last_dispatch=float(self.env.now) - self.last_dispatch[terminal],
                        baseline_headway=self.cfg.baseline_headway_minutes,
                        best_static=self.cfg.best_static,
                        ewma_rate=self.ewma_rate[terminal],
                        opposite_ewma_rate=self.ewma_rate[opp],
                        expected_trip_time=11.5 + self.recent_traffic_delay,
                        recent_traffic_delay=self.recent_traffic_delay,
                    )
                )
                if decision.should_dispatch and idle_local:
                    self.env.process(self._bus_trip_process(idle_local[0], terminal, deadhead=False))
                elif decision.should_reposition and idle_opp:
                    self.env.process(self._bus_trip_process(idle_opp[0], opp, deadhead=True))
            yield self.env.timeout(1.0)

    def run(self) -> Dict[str, float]:
        self.env.process(self._passenger_generator("STC"))
        self.env.process(self._passenger_generator("MAIN_GATE"))
        self.env.process(self._dispatcher_controller())
        self.env.process(self._breakdown_watcher())
        self.env.run(until=self.cfg.duration_minutes)

        waits = [
            (p.board_time - p.arrival_time) if p.board_time is not None else (self.cfg.duration_minutes - p.arrival_time)
            for p in self.passengers
        ]
        arr = np.array(waits, dtype=float)
        avg_wait = float(np.mean(arr)) if len(arr) else 0.0
        p95_wait = float(np.percentile(arr, 95)) if len(arr) else 0.0
        pct_over_10 = float(np.mean(arr > 10.0) * 100.0) if len(arr) else 0.0
        off_arr = np.array(
            [
                (p.board_time - p.arrival_time) if p.board_time is not None else (self.cfg.duration_minutes - p.arrival_time)
                for p in self.passengers
                if 120.0 <= p.arrival_time <= 330.0
            ],
            dtype=float,
        )
        unserved = len(self.queues["STC"]) + len(self.queues["MAIN_GATE"])
        total_bus_min = float(self.cfg.fleet_size * self.cfg.duration_minutes)
        pax_min = sum(min(float(self.cfg.duration_minutes), b.passenger_carrying_minutes) for b in self.buses)
        dead_min = sum(min(float(self.cfg.duration_minutes), b.deadhead_minutes) for b in self.buses)
        util = (pax_min / total_bus_min) * 100.0
        empty_run_ratio = (self.deadhead_trips / max(1, self.total_dispatches)) * 100.0
        load_samples = [s for b in self.buses for s in b.occupancy_samples]
        avg_load = float(np.mean(load_samples)) if load_samples else 0.0

        return {
            "total_arrivals": float(len(self.passengers)),
            "stc_arrivals": float(sum(1 for p in self.passengers if p.terminal == "STC")),
            "mg_arrivals": float(sum(1 for p in self.passengers if p.terminal == "MAIN_GATE")),
            "completed_journeys": float(sum(1 for p in self.passengers if p.board_time is not None)),
            "unserved_at_close": float(unserved),
            "avg_wait_time": round(avg_wait, 2),
            "off_peak_avg_wait": round(float(np.mean(off_arr)) if len(off_arr) else 0.0, 2),
            "p95_wait_time": round(p95_wait, 2),
            "max_wait_time": round(float(np.max(arr)) if len(arr) else 0.0, 2),
            "pct_waiting_over_10": round(pct_over_10, 1),
            "avg_load_factor": round(avg_load, 1),
            "denied_boardings": float(sum(1 for p in self.passengers if p.denied_count > 0)),
            "fleet_utilization": round(util, 1),
            "empty_run_ratio": round(empty_run_ratio, 1),
            "empty_run_time_pct": round((dead_min / total_bus_min) * 100.0, 1),
            "out_of_service_minutes": round(sum(b.out_of_service_minutes for b in self.buses), 1),
            "objective_j": compute_objective_j(
                avg_wait, p95_wait, pct_over_10, unserved, len(self.passengers), self.deadhead_trips, self.total_dispatches
            ),
            "capacity_violations": float(self.capacity_violations),
        }
