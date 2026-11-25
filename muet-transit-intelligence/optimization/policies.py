"""Adaptive, Dual-Baseline, and Ablation Dispatching Policies for MUET Point Bus Transit."""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Optional


@dataclass
class StaticSchedule:
    off_peak_headway: float = 8.0
    morning_peak_headway: float = 4.0
    afternoon_peak_headway: float = 4.0


@dataclass
class DispatchInput:
    policy: str
    terminal: str
    time: float
    queue_length: int
    oldest_arrival: Optional[float]
    available_buses: int
    opposite_queue_length: int
    opposite_available_buses: int
    incoming_buses: int
    bus_capacity: int
    time_since_last_dispatch: float
    baseline_headway: float
    best_static: StaticSchedule
    ewma_rate: float
    opposite_ewma_rate: float
    expected_trip_time: float
    recent_traffic_delay: float


@dataclass
class DispatchDecision:
    should_dispatch: bool
    should_reposition: bool
    reason: str
    priority_score: float


def get_best_static_headway(time_min: float, sched: StaticSchedule) -> float:
    if 30.0 <= time_min < 90.0:
        return sched.morning_peak_headway
    if 390.0 <= time_min < 480.0:
        return sched.afternoon_peak_headway
    return sched.off_peak_headway


def evaluate_policy(inp: DispatchInput) -> DispatchDecision:
    oldest_wait = max(0.0, inp.time - inp.oldest_arrival) if inp.oldest_arrival is not None else 0.0

    if inp.policy == "BASELINE_CURRENT":
        dispatch = inp.available_buses > 0 and inp.time_since_last_dispatch >= inp.baseline_headway - 1e-6
        return DispatchDecision(dispatch, False, "Current assumed 12m headway", 1.0 if dispatch else 0.0)

    if inp.policy == "BASELINE_BEST_STATIC":
        h_static = get_best_static_headway(inp.time, inp.best_static)
        dispatch = inp.available_buses > 0 and inp.time_since_last_dispatch >= h_static - 1e-6
        return DispatchDecision(dispatch, False, f"Best static window ({h_static}m)", 1.0 if dispatch else 0.0)

    if inp.policy == "QUEUE_AWARE":
        q_trig = math.floor(inp.bus_capacity * 0.64 + 0.5)
        dispatch = False
        if inp.available_buses > 0:
            if inp.queue_length >= inp.bus_capacity:
                dispatch = True
            elif inp.queue_length >= q_trig and inp.time_since_last_dispatch >= 2.5:
                dispatch = True
            elif inp.queue_length > 0 and oldest_wait >= 8.0 and inp.time_since_last_dispatch >= 2.5:
                dispatch = True
            elif inp.queue_length > 0 and inp.time_since_last_dispatch >= 15.0:
                dispatch = True
        reposition = (
            inp.available_buses == 0
            and inp.incoming_buses == 0
            and inp.queue_length >= math.floor(inp.bus_capacity * 0.5 + 0.5)
            and inp.opposite_available_buses >= 2
            and inp.opposite_queue_length < math.floor(inp.bus_capacity * 0.35 + 0.5)
        )
        return DispatchDecision(dispatch, reposition, "Queue-aware check", inp.queue_length / inp.bus_capacity)

    if inp.policy == "ADAPTIVE_HEADWAY":
        eff_rate = max(0.4, inp.ewma_rate)
        h_target = max(3.5, min(18.0, 11.0 * math.sqrt(3.0 / eff_rate)))
        dispatch = inp.available_buses > 0 and (
            (inp.queue_length >= inp.bus_capacity * 0.95 and inp.time_since_last_dispatch >= 2.0)
            or (inp.queue_length > 0 and inp.time_since_last_dispatch >= h_target)
        )
        return DispatchDecision(dispatch, False, "Adaptive headway", inp.time_since_last_dispatch / h_target)

    # COMBINED OPTIMIZATION & ABLATION VARIANTS
    use_rebalance = inp.policy != "ABLATION_NO_REBALANCE"
    use_traffic_comp = inp.policy != "ABLATION_NO_TRAFFIC_COMP"
    use_surplus = inp.policy != "ABLATION_NO_SURPLUS"
    use_urgency = inp.policy != "ABLATION_NO_URGENCY"

    eff_rate = max(0.35, inp.ewma_rate)
    traffic_factor = max(0.7, 1.0 - inp.recent_traffic_delay / 30.0) if use_traffic_comp else 1.0
    h_target = max(2.6, min(14.0, 9.5 * math.sqrt(3.0 / eff_rate) * traffic_factor))
    min_safe_gap = 2.0 if inp.available_buses >= 2 else 2.6
    bunching_penalty = 0.9 if (inp.time_since_last_dispatch < min_safe_gap and inp.queue_length < inp.bus_capacity) else 0.0
    score = (
        0.45 * (inp.queue_length / inp.bus_capacity)
        + 0.35 * (oldest_wait / 6.5)
        + 0.28 * (inp.time_since_last_dispatch / h_target)
        + 0.14 * ((eff_rate * 3.5) / inp.bus_capacity)
        - bunching_penalty
    )
    dispatch = False
    if inp.available_buses > 0 and inp.queue_length > 0:
        if inp.queue_length >= inp.bus_capacity and inp.time_since_last_dispatch >= 1.5:
            dispatch = True
        elif (
            use_surplus
            and inp.available_buses >= 2
            and (oldest_wait >= 5.5 or inp.queue_length >= math.floor(inp.bus_capacity * 0.25 + 0.5))
            and inp.time_since_last_dispatch >= 2.5
        ):
            dispatch = True
        elif use_urgency and score >= 0.85 and inp.time_since_last_dispatch >= min_safe_gap:
            dispatch = True
        elif (not use_urgency) and inp.time_since_last_dispatch >= h_target:
            dispatch = True
        elif oldest_wait >= 7.5 and time_check(inp.time_since_last_dispatch):
            dispatch = True

    proj_local = inp.queue_length + eff_rate * min(inp.expected_trip_time, 11.0)
    proj_opp = inp.opposite_queue_length + inp.opposite_ewma_rate * 9.0
    reposition = (
        use_rebalance
        and inp.available_buses == 0
        and inp.opposite_available_buses >= 1
        and (proj_local - inp.incoming_buses * inp.bus_capacity) >= inp.bus_capacity * 0.42
        and inp.opposite_queue_length < inp.bus_capacity * 0.32
        and (inp.opposite_available_buses >= 2 or proj_opp < inp.bus_capacity * 0.45)
    )
    return DispatchDecision(dispatch, reposition, "Combined multi-criteria optimizer", score)


def time_check(elapsed: float) -> bool:
    return elapsed >= 2.0
