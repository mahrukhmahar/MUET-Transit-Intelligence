# Simulation & Optimization Methodology

## 1. Canonical Python Engine & System Boundary
`muet-transit-intelligence/` is the canonical Python/SimPy discrete-event simulation (DES) and graded deliverable (`python -m experiments.run_experiments && pytest`). It models the bi-directional MUET Jamshoro Point bus corridor connecting **STC Terminal** and **Main Gate Terminal** from `07:30` to `16:00` (`510` minutes), with fixed fleet `c = 10` buses and capacity `K = 50` passengers.

## 2. Dual Objectives & Utilization Definition
1. **Minimize Student Waiting Time**: Mean, P95, Max wait, and `% waiting > 10 min`.
2. **Maximize Passenger-Carrying Fleet Utilization**: Strictly defined as:
   - `fleet_utilization = passenger_carrying_bus_minutes / total_bus_minutes` (excluding idle parking and empty deadhead repositioning).
   - Paired with `empty_run_ratio = deadhead_trips / total_dispatches`, `empty_run_time_pct`, and `avg_load_factor`.

## 3. Dual Baselines & Provenance Honesty
- **Assumed Context Baseline (`BASELINE_CURRENT`)**: Uniform `12-minute` static headway chosen as an unoptimized pre-study assumption (requires Transport Office departure logs for empirical validation).
- **Primary Scientific Benchmark (`BASELINE_BEST_STATIC`)**: Grid-searched time-of-day static timetable `(8m off-peak / 4m AM peak / 4m PM peak)` minimizing average wait. All headline claims and paired 95% t-CIs are anchored against this strong static benchmark.

## 4. Analytical M/M/c (Erlang-C) Check & Conceptual Lifecycle
- **Queuing Theory Verification (`simulation/queuing.py`)**: Stationary off-peak `M/M/c` (`lambda = 3.4 pax/min`, `mu = 2.0 pax/min/bus`, `c = 10`) yields `rho = 0.170 < 1` (stable), matching DES off-peak wait (`2.83m`). Peak single-terminal demand (`13.2 pax/min`, unrebalanced half-fleet `rho = 1.478 >= 1`) causes analytical blow-up and ignores `K=50` bulk boarding, justifying DES (`M(t)/G^K/c`).
- **6-State Bus Lifecycle**: `IDLE_AT_TERMINAL`, `BOARDING`, `IN_TRANSIT`, `DELAYED_IN_TRAFFIC`, `REPOSITIONING`, and `OUT_OF_SERVICE` (60-min breakdown event at `08:15`).

## 5. Exact Multi-Objective Cost `J(π)`
```
J(π) = 0.35 * (avgWait / 10.0)
     + 0.30 * (p95Wait / 25.0)
     + 0.20 * (pctWaitingOver10 / 100.0)
     + 0.10 * (unservedAtClose / max(1, totalArrivals))
     + 0.05 * (deadheadTrips / max(1, totalDispatches))
```

## 6. Common Random Numbers (CRN), What-If Scenarios & Ablation
- **4-Stream CRN**: `SeedSequence(seed).spawn(4)` separates STC arrivals, MG arrivals, travel/traffic, and boarding durations (`tests/test_simulation.py` proves identical arrivals per seed across all 5 policies).
- **What-If Stress Suite**: Normal Day, Exam Day (`1.35x` demand, `1.15x` traffic, `+120` surge), Rainy Day (`1.10x` demand, `1.85x` traffic), 60-min Bus Breakdown (`PT-01 OUT_OF_SERVICE`), and Sudden Surge (`+120 pax` at `11:30 AM`).
- **Component Ablation**: Evaluates Full Combined vs. removing Proactive Rebalancing, Traffic Compensation, Surplus Early Release, and Urgency Scoring across 30 CRN replications.
