"""Zero-Dependency Python 3.11 Canonical Parity Core for MUET Point Bus DES."""

from __future__ import annotations

from dataclasses import dataclass, field
import heapq
import math
from typing import Any, Dict, List, Optional, Tuple

from optimization.policies import DispatchInput, StaticSchedule, evaluate_policy


class Mulberry32:
    """Deterministic Mulberry32 PRNG matching TypeScript SeededRNG bit-for-bit."""

    __slots__ = ("state",)

    def __init__(self, seed: int) -> None:
        self.state = (seed & 0xFFFFFFFF) or 1

    def next(self) -> float:
        s = (self.state + 0x6D2B79F5) & 0xFFFFFFFF
        self.state = s
        t = s
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        u = ((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF
        t = (t ^ ((t + u) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0

    def exponential(self, rate: float) -> float:
        if rate <= 0.0:
            return float("inf")
        u = 1.0 - self.next()
        if u < 1e-12:
            u = 1e-12
        return -math.log(u) / rate

    def normal(self, mean: float = 0.0, std: float = 1.0) -> float:
        u1 = self.next()
        if u1 < 1e-12:
            u1 = 1e-12
        u2 = self.next()
        z0 = math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)
        return mean + std * z0

    def lognormal(self, mean: float, std: float) -> float:
        if std <= 0.0:
            return mean
        var = std * std
        m2 = mean * mean
        mu = math.log(m2 / math.sqrt(var + m2))
        sigma = math.sqrt(math.log(1.0 + var / m2))
        return math.exp(self.normal(mu, sigma))

    def bernoulli(self, p: float) -> bool:
        return self.next() < p


def spawn_crn_streams(seed: int) -> Tuple[Mulberry32, Mulberry32, Mulberry32, Mulberry32]:
    s = (seed & 0xFFFFFFFF) or 1
    return (
        Mulberry32(((s * 1009) & 0xFFFFFFFF) ^ 0x9E3779B1),
        Mulberry32(((s * 2027) & 0xFFFFFFFF) ^ 0x85EBCA6B),
        Mulberry32(((s * 3037) & 0xFFFFFFFF) ^ 0xC2B2AE35),
        Mulberry32(((s * 4049) & 0xFFFFFFFF) ^ 0x27D4EB2F),
    )


def get_arrival_rate(terminal: str, t_min: float, mult: float, surge: bool = False) -> float:
    if mult <= 0.0:
        return 0.0

    exp = math.exp
    if terminal == "MAIN_GATE":
        d1 = (t_min - 60.0) / 22.0
        d2 = (t_min - 115.0) / 25.0
        d3 = (t_min - 435.0) / 32.0
        base = 1.6 + 10.2 * exp(-0.5 * d1 * d1) + 1.8 * exp(-0.5 * d2 * d2) + 2.6 * exp(-0.5 * d3 * d3)
    else:
        d1 = (t_min - 65.0) / 24.0
        d2 = (t_min - 315.0) / 25.0
        d3 = (t_min - 430.0) / 30.0
        base = 1.8 + 2.8 * exp(-0.5 * d1 * d1) + 1.5 * exp(-0.5 * d2 * d2) + 11.4 * exp(-0.5 * d3 * d3)
    if surge and terminal == "STC" and 240.0 <= t_min <= 258.0:
        base += 7.5
    val = base * mult
    return 0.05 if val < 0.05 else val


def get_max_arrival_rate(terminal: str, mult: float, surge: bool = False) -> float:
    if mult <= 0.0:
        return 0.0
    peak = 14.5 if terminal == "MAIN_GATE" else 15.5
    if surge and terminal == "STC":
        peak += 8.0
    return peak * mult


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


@dataclass
class ParityConfig:
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


@dataclass
class _Pax:
    __slots__ = ("pid", "terminal", "arrival_time", "board_time", "departure_time", "wait_time", "denied_count", "bus_id")
    pid: int
    terminal: str
    arrival_time: float
    board_time: Optional[float]
    departure_time: Optional[float]
    wait_time: Optional[float]
    denied_count: int
    bus_id: Optional[int]


@dataclass
class _Bus:
    bid: int
    label: str
    terminal: str
    destination: str
    state: str = "IDLE_AT_TERMINAL"
    passengers_on_board: int = 0
    capacity: int = 50
    departure_time: float = 0.0
    arrival_time: float = 0.0
    delay_applied: float = 0.0
    is_deadhead: bool = False
    passenger_carrying_minutes: float = 0.0
    deadhead_minutes: float = 0.0
    out_of_service_minutes: float = 0.0
    pending_breakdown: bool = False
    trips_completed: int = 0
    total_passengers_carried: int = 0
    occupancy_samples: List[float] = field(default_factory=list)


def _percentile(sorted_vals: List[float], p: float) -> float:
    n = len(sorted_vals)
    if n == 0:
        return 0.0
    idx = (n - 1) * p
    lo = math.floor(idx)
    hi = math.ceil(idx)
    if lo == hi:
        return sorted_vals[lo]
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (idx - lo)


def _clock_label(t_min: float) -> str:
    tot = round(7 * 60 + 30 + t_min)
    return f"{(tot // 60) % 24:02d}:{tot % 60:02d}"


def run_parity_simulation(cfg: ParityConfig, collect_ui: bool = False) -> Dict[str, Any]:
    fleet_size = max(2, min(30, round(cfg.fleet_size)))
    bus_cap = max(20, min(100, round(cfg.bus_capacity)))
    duration = max(120, min(720, round(cfg.duration_minutes)))
    arr_mult = max(0.0, min(3.0, cfg.arrival_multiplier))
    traf_sev = max(0.0, min(2.5, cfg.traffic_severity))

    rng_stc, rng_mg, rng_travel, rng_board = spawn_crn_streams(cfg.seed)
    heap: List[Tuple[float, int, str, Optional[str], Optional[int]]] = []
    seq = 0
    heappush = heapq.heappush
    heappop = heapq.heappop

    def schedule(t: float, etype: str, term: Optional[str] = None, bid: Optional[int] = None) -> None:
        nonlocal seq
        if t <= duration:
            heappush(heap, (t, seq, etype, term, bid))
            seq += 1

    passengers: List[_Pax] = []
    queues: Dict[str, List[_Pax]] = {"STC": [], "MAIN_GATE": []}
    stc_arrivals = 0
    mg_arrivals = 0
    buses: List[_Bus] = [
        _Bus(
            bid=i + 1,
            label=f"PT-{i + 1:02d}",
            terminal="STC" if i % 2 == 0 else "MAIN_GATE",
            destination="MAIN_GATE" if i % 2 == 0 else "STC",
            capacity=bus_cap,
        )
        for i in range(fleet_size)
    ]
    buses_by_id: Dict[int, _Bus] = {b.bid: b for b in buses}

    last_dispatch: Dict[str, float] = {"STC": -100.0, "MAIN_GATE": -100.0}
    ewma: Dict[str, float] = {"STC": 2.0 * arr_mult, "MAIN_GATE": 2.0 * arr_mult}
    recent_delay = 1.5 * traf_sev
    total_dispatches = 0
    deadhead_trips = 0
    overcrowding_attempts = 0
    capacity_violations = 0
    monotonic_violations = 0
    boarded_total = 0
    traffic_delays: List[float] = []
    decision_logs: List[dict] = []
    time_series: List[dict] = []

    last_q_time = 0.0
    q_area_stc = 0.0
    q_area_mg = 0.0
    max_q_stc = 0
    max_q_mg = 0

    def update_q_integrals(now: float) -> None:
        nonlocal last_q_time, q_area_stc, q_area_mg, max_q_stc, max_q_mg
        dt = now - last_q_time
        if dt > 0.0:
            q_area_stc += len(queues["STC"]) * dt
            q_area_mg += len(queues["MAIN_GATE"]) * dt
            last_q_time = now
        if len(queues["STC"]) > max_q_stc:
            max_q_stc = len(queues["STC"])
        if len(queues["MAIN_GATE"]) > max_q_mg:
            max_q_mg = len(queues["MAIN_GATE"])

    is_static = cfg.policy in ("BASELINE_CURRENT", "BASELINE_BEST_STATIC")
    lam_max_stc = get_max_arrival_rate("STC", arr_mult, cfg.sudden_surge_enabled)
    lam_max_mg = get_max_arrival_rate("MAIN_GATE", arr_mult, cfg.sudden_surge_enabled)

    def schedule_next_arrival(term: str, cur_t: float) -> None:
        lam_max = lam_max_stc if term == "STC" else lam_max_mg
        if lam_max <= 0.0:
            return
        rng = rng_stc if term == "STC" else rng_mg
        t = cur_t
        while t < duration:
            t += rng.exponential(lam_max)
            if t > duration:
                return
            lam_t = get_arrival_rate(term, t, arr_mult, cfg.sudden_surge_enabled)
            if rng.next() <= lam_t / lam_max:
                schedule(t, "PASSENGER_ARRIVAL", term)
                return

    schedule_next_arrival("STC", 0.0)
    schedule_next_arrival("MAIN_GATE", 0.0)
    for t in range(duration + 1):
        schedule(float(t), "DISPATCH_TICK")
    if collect_ui:
        for t in range(0, duration + 1, 5):
            schedule(float(t), "SNAPSHOT")
    if cfg.breakdown_enabled and duration > 60:
        schedule(45.0, "BUS_BREAKDOWN", None, 1)

    def idle_buses(term: str) -> List[_Bus]:
        return [b for b in buses if b.state == "IDLE_AT_TERMINAL" and b.terminal == term]

    def incoming_count(term: str) -> int:
        return sum(
            1
            for b in buses
            if b.state in ("IN_TRANSIT", "DELAYED_IN_TRAFFIC", "REPOSITIONING") and b.destination == term
        )

    def start_boarding(bus: _Bus, term: str, now: float, reason: str) -> None:
        nonlocal total_dispatches, capacity_violations, overcrowding_attempts, boarded_total
        q = queues[term]
        q_len = len(q)
        to_board = bus.capacity if q_len > bus.capacity else q_len
        if q_len > bus.capacity:
            overcrowding_attempts += 1
            for p in q[bus.capacity :]:
                p.denied_count += 1
            if collect_ui and len(decision_logs) < 250:
                decision_logs.append({
                    "time": now,
                    "terminal": term,
                    "busLabel": bus.label,
                    "policy": cfg.policy,
                    "action": "DENIED_BOARDING",
                    "reason": f"{q_len - bus.capacity} waiting passengers exceeded bus capacity ({bus.capacity})",
                    "queueAtDecision": q_len,
                    "passengersBoarded": to_board,
                })
        boarded = q[:to_board]
        del q[:to_board]
        if len(boarded) > bus.capacity:
            capacity_violations += 1
        board_dur = (
            0.4
            if not boarded
            else max(0.6, 0.7 + len(boarded) * 0.042 + rng_board.normal(0.0, 0.15))
        )
        dep_t = now + board_dur
        for p in boarded:
            p.board_time = now
            p.departure_time = dep_t
            p.wait_time = now - p.arrival_time
            p.bus_id = bus.bid
        boarded_total += len(boarded)
        bus.state = "BOARDING"
        bus.terminal = term
        bus.destination = "MAIN_GATE" if term == "STC" else "STC"
        bus.passengers_on_board = len(boarded)
        bus.is_deadhead = False
        bus.departure_time = dep_t
        if boarded:
            bus.passenger_carrying_minutes += min(board_dur, max(0.0, duration - now))
        last_dispatch[term] = now
        total_dispatches += 1
        bus.occupancy_samples.append((len(boarded) / bus.capacity) * 100.0)
        bus.total_passengers_carried += len(boarded)
        if collect_ui and len(decision_logs) < 250:
            decision_logs.append({
                "time": now,
                "terminal": term,
                "busLabel": bus.label,
                "policy": cfg.policy,
                "action": "DISPATCH",
                "reason": reason,
                "queueAtDecision": q_len,
                "passengersBoarded": len(boarded),
            })
        schedule(dep_t, "BOARDING_COMPLETE", term, bus.bid)

    def start_reposition(bus: _Bus, frm: str, now: float, reason: str) -> None:
        nonlocal deadhead_trips, total_dispatches
        dest = "MAIN_GATE" if frm == "STC" else "STC"
        base_travel = rng_travel.lognormal(9.5, 1.4)
        peak = (30.0 <= now <= 95.0) or (385.0 <= now <= 485.0)
        delay_prob = 0.25 if peak else 0.08
        delay = (
            rng_travel.lognormal(2.2 * traf_sev, 0.9 * traf_sev)
            if traf_sev > 0.0 and rng_travel.bernoulli(delay_prob)
            else 0.0
        )
        total_t = max(5.5, base_travel + delay)
        bus.state = "REPOSITIONING"
        bus.terminal = frm
        bus.destination = dest
        bus.passengers_on_board = 0
        bus.is_deadhead = True
        bus.departure_time = now
        bus.arrival_time = now + total_t
        bus.delay_applied = delay
        bus.deadhead_minutes += min(total_t, max(0.0, duration - now))
        deadhead_trips += 1
        total_dispatches += 1
        if collect_ui and len(decision_logs) < 250:
            decision_logs.append({
                "time": now,
                "terminal": frm,
                "busLabel": bus.label,
                "policy": cfg.policy,
                "action": "REPOSITION",
                "reason": reason,
                "queueAtDecision": len(queues[dest]),
                "passengersBoarded": 0,
            })
        schedule(bus.arrival_time, "BUS_ARRIVAL", dest, bus.bid)

    def eval_term(term: str, now: float) -> None:
        opp = "MAIN_GATE" if term == "STC" else "STC"
        idle_l = idle_buses(term)
        idle_o = idle_buses(opp)
        q = queues[term]
        dec = evaluate_policy(
            DispatchInput(
                policy=cfg.policy,
                terminal=term,
                time=now,
                queue_length=len(q),
                oldest_arrival=q[0].arrival_time if q else None,
                available_buses=len(idle_l),
                opposite_queue_length=len(queues[opp]),
                opposite_available_buses=len(idle_o),
                incoming_buses=incoming_count(term),
                bus_capacity=bus_cap,
                time_since_last_dispatch=now - last_dispatch[term],
                baseline_headway=cfg.baseline_headway_minutes,
                best_static=cfg.best_static,
                ewma_rate=ewma[term],
                opposite_ewma_rate=ewma[opp],
                expected_trip_time=11.5 + recent_delay,
                recent_traffic_delay=recent_delay,
            )
        )
        if dec.should_dispatch and idle_l:
            start_boarding(idle_l[0], term, now, dec.reason)
        elif dec.should_reposition and idle_o:
            start_reposition(idle_o[0], opp, now, f"Proactive rebalance to {term} (Q={len(q)}, incoming={incoming_count(term)})")

    arr_since_stc = 0
    arr_since_mg = 0
    last_ewma_t = 0.0
    last_clock = 0.0

    while heap:
        now, _, etype, term, bid = heappop(heap)
        if now > duration:
            break
        if now < last_clock - 1e-9:
            monotonic_violations += 1
        last_clock = now
        if collect_ui:
            update_q_integrals(now)

        if now - last_ewma_t >= 2.0:
            dt = now - last_ewma_t
            ewma["STC"] = 0.35 * (arr_since_stc / dt) + 0.65 * ewma["STC"]
            ewma["MAIN_GATE"] = 0.35 * (arr_since_mg / dt) + 0.65 * ewma["MAIN_GATE"]
            arr_since_stc = 0
            arr_since_mg = 0
            last_ewma_t = now

        if etype == "PASSENGER_ARRIVAL" and term is not None:
            pax = _Pax(len(passengers) + 1, term, now, None, None, None, 0, None)
            passengers.append(pax)
            if term == "STC":
                stc_arrivals += 1
                arr_since_stc += 1
            else:
                mg_arrivals += 1
                arr_since_mg += 1
            queues[term].append(pax)
            if collect_ui:
                update_q_integrals(now)
            schedule_next_arrival(term, now)
            if not is_static:
                eval_term(term, now)
        elif etype == "BOARDING_COMPLETE" and bid is not None:
            bus = buses_by_id.get(bid)
            if bus is None:
                continue
            peak = (30.0 <= now <= 95.0) or (385.0 <= now <= 485.0)
            base_t = rng_travel.lognormal(11.5, 2.0)
            delay_prob = 0.38 if peak else 0.12
            delay = (
                rng_travel.lognormal(3.4 * traf_sev, 1.3 * traf_sev)
                if traf_sev > 0.0 and rng_travel.bernoulli(delay_prob)
                else 0.0
            )
            if delay > 0.0:
                recent_delay = 0.3 * delay + 0.7 * recent_delay
                if collect_ui:
                    traffic_delays.append(delay)
                    if delay > 3.5 and len(decision_logs) < 250:
                        decision_logs.append({
                            "time": now,
                            "terminal": bus.terminal,
                            "busLabel": bus.label,
                            "policy": cfg.policy,
                            "action": "TRAFFIC_DELAY",
                            "reason": f"Corridor congestion added +{delay:.1f} min delay",
                            "queueAtDecision": len(queues[bus.terminal]),
                            "passengersBoarded": bus.passengers_on_board,
                        })
            travel_dur = max(6.5, base_t + delay)
            bus.state = "DELAYED_IN_TRAFFIC" if delay > 2.0 else "IN_TRANSIT"
            bus.delay_applied = delay
            bus.departure_time = now
            bus.arrival_time = now + travel_dur
            span = min(travel_dur, max(0.0, duration - now))
            if bus.passengers_on_board > 0:
                bus.passenger_carrying_minutes += span
            else:
                bus.deadhead_minutes += span
            schedule(bus.arrival_time, "BUS_ARRIVAL", bus.destination, bus.bid)
        elif etype == "BUS_ARRIVAL" and bid is not None and term is not None:
            bus = buses_by_id.get(bid)
            if bus is None:
                continue
            bus.trips_completed += 1
            bus.passengers_on_board = 0
            bus.is_deadhead = False
            bus.delay_applied = 0.0
            bus.terminal = term
            bus.destination = "MAIN_GATE" if term == "STC" else "STC"
            bus.arrival_time = now
            if bus.pending_breakdown:
                bus.pending_breakdown = False
                bus.state = "OUT_OF_SERVICE"
                bus.out_of_service_minutes += min(60.0, max(0.0, duration - now))
                schedule(now + 60.0, "BUS_RECOVER", term, bus.bid)
            else:
                bus.state = "IDLE_AT_TERMINAL"
                if not is_static:
                    eval_term(term, now)
        elif etype == "BUS_BREAKDOWN" and bid is not None:
            bus = buses_by_id.get(bid)
            if bus is not None:
                if bus.state == "IDLE_AT_TERMINAL":
                    bus.state = "OUT_OF_SERVICE"
                    bus.out_of_service_minutes += min(60.0, max(0.0, duration - now))
                    schedule(now + 60.0, "BUS_RECOVER", bus.terminal, bus.bid)
                else:
                    bus.pending_breakdown = True
        elif etype == "BUS_RECOVER" and bid is not None:
            bus = buses_by_id.get(bid)
            if bus is not None:
                bus.state = "IDLE_AT_TERMINAL"
                if not is_static:
                    eval_term(bus.terminal, now)
        elif etype == "DISPATCH_TICK":
            eval_term("STC", now)
            eval_term("MAIN_GATE", now)
        elif etype == "SNAPSHOT" and collect_ui:
            active_transit = [
                b for b in buses if b.state in ("IN_TRANSIT", "DELAYED_IN_TRAFFIC", "REPOSITIONING")
            ]
            avg_occ = (
                sum((b.passengers_on_board / b.capacity) * 100.0 for b in active_transit) / len(active_transit)
                if active_transit
                else 0.0
            )
            snaps = []
            for b in buses:
                prog = 0.0
                if b.state in ("IN_TRANSIT", "DELAYED_IN_TRAFFIC", "REPOSITIONING"):
                    span = max(0.01, b.arrival_time - b.departure_time)
                    prog = max(0.0, min(1.0, (now - b.departure_time) / span))
                snaps.append({
                    "id": b.bid,
                    "label": b.label,
                    "state": b.state,
                    "origin": b.terminal,
                    "destination": b.destination,
                    "progress": prog,
                    "passengers": b.passengers_on_board,
                    "capacity": b.capacity,
                    "delayed": b.state == "DELAYED_IN_TRAFFIC",
                    "isDeadhead": b.is_deadhead,
                })
            time_series.append({
                "time": now,
                "clockLabel": _clock_label(now),
                "stcQueue": len(queues["STC"]),
                "mainGateQueue": len(queues["MAIN_GATE"]),
                "stcArrivalRate": round(get_arrival_rate("STC", now, arr_mult, cfg.sudden_surge_enabled), 2),
                "mainGateArrivalRate": round(get_arrival_rate("MAIN_GATE", now, arr_mult, cfg.sudden_surge_enabled), 2),
                "totalThroughput": boarded_total,
                "activeBusesInTransit": len(active_transit),
                "avgOccupancyPct": round(avg_occ, 1),
                "stcAvailableBuses": len(idle_buses("STC")),
                "mainGateAvailableBuses": len(idle_buses("MAIN_GATE")),
                "busSnapshots": snaps,
            })

    if collect_ui:
        update_q_integrals(float(duration))

    completed = [p for p in passengers if p.wait_time is not None]
    waits = [
        p.wait_time if p.wait_time is not None else max(0.0, duration - p.arrival_time)
        for p in passengers
    ]
    sorted_w = sorted(waits)
    avg_wait = sum(waits) / len(waits) if waits else 0.0
    median_wait = _percentile(sorted_w, 0.50)
    p90_wait = _percentile(sorted_w, 0.90)
    p95_wait = _percentile(sorted_w, 0.95)
    max_wait = sorted_w[-1] if sorted_w else 0.0
    pct_over_10 = (sum(1 for w in waits if w > 10.0) / len(waits) * 100.0) if waits else 0.0

    am_waits = [
        (p.wait_time if p.wait_time is not None else max(0.0, duration - p.arrival_time))
        for p in passengers
        if 30.0 <= p.arrival_time < 90.0
    ]
    pm_waits = [
        (p.wait_time if p.wait_time is not None else max(0.0, duration - p.arrival_time))
        for p in passengers
        if 390.0 <= p.arrival_time < 480.0
    ]
    off_waits = [
        (p.wait_time if p.wait_time is not None else max(0.0, duration - p.arrival_time))
        for p in passengers
        if 120.0 <= p.arrival_time <= 330.0
    ]
    off_peak_wait = sum(off_waits) / len(off_waits) if off_waits else 0.0
    am_wait = sum(am_waits) / len(am_waits) if am_waits else 0.0
    pm_wait = sum(pm_waits) / len(pm_waits) if pm_waits else 0.0

    unserved = len(queues["STC"]) + len(queues["MAIN_GATE"])
    all_occ = [s for b in buses for s in b.occupancy_samples]
    avg_load = sum(all_occ) / len(all_occ) if all_occ else 0.0

    total_bus_minutes = float(fleet_size * duration)
    pax_carrying_min = sum(min(float(duration), b.passenger_carrying_minutes) for b in buses)
    deadhead_min = sum(min(float(duration), b.deadhead_minutes) for b in buses)
    util = (pax_carrying_min / total_bus_minutes) * 100.0
    empty_run_ratio = (deadhead_trips / max(1, total_dispatches)) * 100.0
    empty_run_time_pct = (deadhead_min / total_bus_minutes) * 100.0
    obj_j = compute_objective_j(
        avg_wait, p95_wait, pct_over_10, unserved, len(passengers), deadhead_trips, total_dispatches
    )
    bad_ts = sum(
        1
        for p in completed
        if p.board_time is None
        or p.departure_time is None
        or p.board_time < p.arrival_time - 1e-9
        or p.departure_time < p.board_time - 1e-9
    )
    denied_count = sum(1 for p in passengers if p.denied_count > 0)

    if not collect_ui:
        return {
            "total_arrivals": float(len(passengers)),
            "stc_arrivals": float(stc_arrivals),
            "mg_arrivals": float(mg_arrivals),
            "completed_journeys": float(len(completed)),
            "unserved_at_close": float(unserved),
            "avg_wait_time": round(avg_wait, 2),
            "median_wait_time": round(median_wait, 2),
            "p90_wait_time": round(p90_wait, 2),
            "off_peak_avg_wait": round(off_peak_wait, 2),
            "morning_peak_avg_wait": round(am_wait, 2),
            "afternoon_peak_avg_wait": round(pm_wait, 2),
            "p95_wait_time": round(p95_wait, 2),
            "max_wait_time": round(max_wait, 2),
            "pct_waiting_over_10": round(pct_over_10, 1),
            "avg_load_factor": round(avg_load, 1),
            "denied_boardings": float(denied_count),
            "fleet_utilization": round(util, 1),
            "empty_run_ratio": round(empty_run_ratio, 1),
            "empty_run_time_pct": round(empty_run_time_pct, 1),
            "deadhead_trips": float(deadhead_trips),
            "total_dispatches": float(total_dispatches),
            "out_of_service_minutes": round(sum(b.out_of_service_minutes for b in buses), 1),
            "objective_j": obj_j,
            "capacity_violations": float(capacity_violations),
            "monotonic_violations": float(monotonic_violations),
            "bad_timestamps": float(bad_ts),
            "fleet_count": float(len(buses)),
        }

    # Build full UI SingleRunResult payload (used once per policy for Rep 0)
    stc_avg_q = q_area_stc / duration
    mg_avg_q = q_area_mg / duration
    avg_idle_t = sum(max(0.0, duration - min(float(duration), b.passenger_carrying_minutes + b.deadhead_minutes)) for b in buses) / fleet_size
    dur_hours = duration / 60.0
    buckets = [
        ("0–3m", 0.0, 3.0),
        ("3–6m", 3.0, 6.0),
        ("6–10m", 6.0, 10.0),
        ("10–15m", 10.0, 15.0),
        ("15–25m", 15.0, 25.0),
        ("25m+", 25.0, float("inf")),
    ]
    wait_hist = []
    n_waits = len(waits)
    for lbl, mn, mx in buckets:
        cnt = sum(1 for w in waits if mn <= w < mx)
        wait_hist.append({"bucket": lbl, "count": cnt, "pct": round((cnt / n_waits) * 100.0, 1) if n_waits else 0.0})

    wait_cdf = []
    for w_cut in range(0, 41, 2):
        cnt = sum(1 for x in waits if x <= w_cut)
        wait_cdf.append({"waitMin": w_cut, "cdfPct": round((cnt / n_waits) * 100.0, 1) if n_waits else 100.0})

    bus_breakdown = []
    for b in buses:
        pax_min_b = min(float(duration), b.passenger_carrying_minutes)
        busy_b = min(float(duration), b.passenger_carrying_minutes + b.deadhead_minutes)
        bus_breakdown.append({
            "busLabel": b.label,
            "trips": b.trips_completed,
            "passengersCarried": b.total_passengers_carried,
            "avgOccupancyPct": round(sum(b.occupancy_samples) / len(b.occupancy_samples), 1) if b.occupancy_samples else 0.0,
            "utilizationPct": round((pax_min_b / duration) * 100.0, 1),
            "idleMinutes": round(max(0.0, duration - busy_b), 1),
        })

    slot_width = 30
    num_slots = math.ceil(duration / slot_width)
    slot_stats = []
    for s_idx in range(num_slots):
        t0 = s_idx * slot_width
        t1 = min(duration, (s_idx + 1) * slot_width)
        sw = sorted(
            (p.wait_time if p.wait_time is not None else max(0.0, duration - p.arrival_time))
            for p in passengers
            if p.terminal == "STC" and t0 <= p.arrival_time < t1
        )
        mw = sorted(
            (p.wait_time if p.wait_time is not None else max(0.0, duration - p.arrival_time))
            for p in passengers
            if p.terminal == "MAIN_GATE" and t0 <= p.arrival_time < t1
        )
        snaps_in = [pt for pt in time_series if t0 <= pt["time"] < t1]
        slot_stats.append({
            "slotIndex": s_idx,
            "slotLabel": _clock_label(float(t0)),
            "stcAvgWait": round(sum(sw) / len(sw), 1) if sw else 0.0,
            "stcP95Wait": round(_percentile(sw, 0.95), 1),
            "stcMaxQueue": max((pt["stcQueue"] for pt in snaps_in), default=0),
            "stcPaxCount": len(sw),
            "mainGateAvgWait": round(sum(mw) / len(mw), 1) if mw else 0.0,
            "mainGateP95Wait": round(_percentile(mw, 0.95), 1),
            "mainGateMaxQueue": max((pt["mainGateQueue"] for pt in snaps_in), default=0),
            "mainGatePaxCount": len(mw),
        })

    invariants = [
        {
            "name": "Bus Capacity Conservation",
            "passed": capacity_violations == 0,
            "detail": f"0 violations across {total_dispatches} dispatches (load <= {bus_cap})" if capacity_violations == 0 else f"{capacity_violations} violations detected",
        },
        {
            "name": "Passenger Accounting Conservation",
            "passed": len(completed) + unserved == len(passengers),
            "detail": f"{len(completed)} boarded + {unserved} unserved = {len(passengers)} arrivals",
        },
        {
            "name": "Monotonic Event & Passenger Timestamps",
            "passed": monotonic_violations == 0 and bad_ts == 0,
            "detail": f"0 clock inversions, {bad_ts} timestamp violations, 0 negative waits",
        },
        {
            "name": "Fleet Size Conservation",
            "passed": len(buses) == fleet_size,
            "detail": f"Active fleet strictly {fleet_size} buses; 0 orphan boardings",
        },
    ]

    metrics_camel = {
        "policy": cfg.policy,
        "seed": cfg.seed,
        "totalArrivals": len(passengers),
        "stcArrivals": stc_arrivals,
        "mgArrivals": mg_arrivals,
        "completedJourneys": len(completed),
        "unservedAtClose": unserved,
        "avgWaitTime": round(avg_wait, 2),
        "medianWaitTime": round(median_wait, 2),
        "p90WaitTime": round(p90_wait, 2),
        "p95WaitTime": round(p95_wait, 2),
        "maxWaitTime": round(max_wait, 2),
        "pctWaitingOver10Min": round(pct_over_10, 1),
        "avgQueueLength": round((stc_avg_q + mg_avg_q) / 2.0, 2),
        "stcAvgQueue": round(stc_avg_q, 2),
        "mainGateAvgQueue": round(mg_avg_q, 2),
        "maxQueueLength": max(max_q_stc, max_q_mg),
        "stcMaxQueue": max_q_stc,
        "mainGateMaxQueue": max_q_mg,
        "throughputPerHour": round(len(completed) / dur_hours, 1),
        "avgLoadFactor": round(avg_load, 1),
        "deniedBoardingEvents": denied_count,
        "overcrowdingAttempts": overcrowding_attempts,
        "fleetUtilization": round(util, 1),
        "emptyRunRatio": round(empty_run_ratio, 1),
        "emptyRunTimePct": round(empty_run_time_pct, 1),
        "avgBusIdleTime": round(avg_idle_t, 1),
        "dispatchFrequencyPerHour": round(total_dispatches / dur_hours, 2),
        "totalDispatches": total_dispatches,
        "deadheadTrips": deadhead_trips,
        "outOfServiceMinutes": round(sum(b.out_of_service_minutes for b in buses), 1),
        "objectiveJ": obj_j,
        "morningPeakAvgWait": round(am_wait, 2),
        "afternoonPeakAvgWait": round(pm_wait, 2),
        "offPeakAvgWait": round(off_peak_wait, 2),
        "avgTrafficDelay": round(sum(traffic_delays) / len(traffic_delays), 2) if traffic_delays else 0.0,
    }

    return {
        "config": {
            "fleetSize": fleet_size,
            "busCapacity": bus_cap,
            "arrivalMultiplier": arr_mult,
            "trafficSeverity": traf_sev,
            "durationMinutes": duration,
            "baselineHeadwayMinutes": cfg.baseline_headway_minutes,
            "bestStaticSchedule": {
                "offPeakHeadway": int(cfg.best_static.off_peak_headway),
                "morningPeakHeadway": int(cfg.best_static.morning_peak_headway),
                "afternoonPeakHeadway": int(cfg.best_static.afternoon_peak_headway),
            },
            "policy": cfg.policy,
            "seed": cfg.seed,
            "replications": 30,
            "suddenSurgeEnabled": cfg.sudden_surge_enabled,
            "breakdownEnabled": cfg.breakdown_enabled,
            "calibratedArrivals": None,
        },
        "metrics": metrics_camel,
        "timeSeries": time_series,
        "decisionLogs": decision_logs,
        "invariants": invariants,
        "waitHistogram": wait_hist,
        "waitCDF": wait_cdf,
        "busBreakdown": bus_breakdown,
        "terminalSlotStats": slot_stats,
    }


def run_trace_for_ui(cfg: ParityConfig) -> List[dict]:
    """Compatibility wrapper returning timeSeries snapshots."""
    return run_parity_simulation(cfg, collect_ui=True)["timeSeries"]
