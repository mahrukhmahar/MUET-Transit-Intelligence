# MUET Transit Intelligence — Point Bus Scheduling & Queue Optimization

**Canonical Deliverable:** `muet-transit-intelligence/` (Python + SimPy discrete-event simulation engine, automated experiment pipeline, 22 verification/parity tests, 11 SVG figures, and compiled two-column IEEE PDF report).  
The React + TypeScript application at the repository root is an **optional interactive visualizer** reading canonical Python exports from `src/data/verified_defaults.json`.

---

## Canonical Execution (Python / SimPy)

```bash
cd muet-transit-intelligence
pip install -r requirements.txt
python -m experiments.run_experiments
pytest -v
# Or run the full automated pipeline (JSON + 11 SVGs + IEEE PDF + 22 tests):
./run_all.sh
```

> Zero external dependencies are required in Python 3.11+ fallback mode (`python3 -m unittest discover -s tests -t . -v`), while installing `requirements.txt` enables full `SimPy` + `NumPy` + `pytest` execution automatically.

---

## Verified Canonical Results (`c = 10, K = 50`, 30 CRN Replications)

All evaluations use 4 spawned Common Random Numbers (CRN) streams (`SeedSequence(seed).spawn(4)`). Headline claims compare against the **Best-Tuned Static Timetable** (`8m off-peak / 4m AM peak / 4m PM peak`); the **12-minute static schedule** is an assumed unoptimized context baseline. Fleet utilization is strictly defined as **`passenger_carrying_bus_minutes / total_bus_minutes`** (excluding idle time and empty deadheads).

| Policy (`c=10, K=50`) | Avg Wait (min) | P95 Wait (min) | Waiting > 10m | Pax-Carrying Util | Empty-Run Ratio | Unserved | `J(π)` |
|---|---:|---:|---:|---:|---:|---:|---:|
| Assumed 12m Static *(context)* | 30.75 | 87.28 | 60.94% | 23.52% | 0.00% | 548.4 | 2.26 |
| **Best-Tuned Static (8/4/4m)** | **3.09** | **7.14** | **0.01%** | **44.24%** | **0.00%** | **5.0** | **0.19** |
| Queue-Aware Dispatch | 10.11 | 35.45 | 30.05% | 35.70% | 0.33% | 166.1 | 0.84 |
| Adaptive Headway (Newell) | 13.18 | 46.24 | 37.88% | 26.12% | 0.00% | 260.8 | 1.10 |
| **Combined Optimizer** | **2.43** | **5.53** | **0.00%** | **54.73%** | **0.99%** | **10.7** | **0.15** |

- **Mean Wait Reduction vs. Best Static:** **21.2%** (`-0.66 min`, 95% paired-t CI `[-0.70, -0.61] min`, Cohen's `dz = -5.02`).
- **Dual-Objective Utilization Gain:** **+10.49 pp** higher passenger-carrying utilization (`54.73%` vs. `44.24%`) with only `0.99%` empty-run dispatch ratio.
- **Same SLA With Fewer Buses (`c = 4..14` sweep):** Combined meets `Avg Wait ≤ 5.0m & P95 ≤ 15.0m` at **`c = 7` buses** (`4.10m` avg, `10.36m` P95) vs. **`c = 8` buses** for Best Static (`12m` fails up to `c = 14`).
- **What-If Stress Scenarios (95% Paired CIs vs. Best Static):** Exam Day (`2.83m` vs. `7.53m`, CI `[-5.00, -4.40]m`), Rainy Day (`2.74m` vs. `3.93m`, CI `[-1.59, -0.79]m`), 60-min Bus Breakdown (`2.58m` vs. `3.15m`, CI `[-0.69, -0.45]m`), Sudden Surge (`2.46m` vs. `3.30m`, CI `[-0.94, -0.75]m`).
- **Analytical M/M/c Verification:** Off-peak (`lambda = 3.4 pax/min`, `c = 10`) gives stable `rho = 0.170 < 1`, whereas peak single-terminal demand (`13.2 pax/min`) drives unrebalanced half-fleet `rho = 1.478 >= 1`, confirming DES necessity.

---

## Optional React Visualizer (`npm run dev`, Port 3000)

```bash
npm install
npm run dev   # Reads Python-exported src/data/verified_defaults.json
```

---

## Rubric-Mapping Table (`R1–R4` -> Report & Repository)

| Rubric Criterion | Requirement Summary | Report Section | Repository File Path(s) |
|---|---|---|---|
| **R1: Problem, Constraints & Stakeholders** | MUET peak asymmetry, fixed fleet `c=10, K=50`, shifts, SLA, stakeholder conflict matrix, conceptual lifecycle & queue diagrams | Sec. I, III, IV; Table I–II; Fig. 1a, 1b, 11 | `muet-transit-intelligence/docs/report/main.tex`, `muet-transit-intelligence/results/figures/fig1_bus_state_transition.svg`, `fig2_passenger_queue_flow.svg`, `fig11_dispatch_flowchart.svg`, `src/components/ReportView.tsx` |
| **R2: Originality & Optimization** | Coupled predictive deadhead rebalancing + surplus early release + traffic-aware urgency; 30-rep component ablation; exact `J(pi)` | Sec. II, V, VIII; Table III | `muet-transit-intelligence/optimization/policies.py`, `muet-transit-intelligence/simulation/stdlib_engine.py`, `src/sim/policies.ts` |
| **R3: Modeling, Queuing & Verification** | `M/M/c` Erlang-C off-peak check vs. `M(t)/G^K/c` DES, NHPP thinning, 4-stream CRN (`SeedSequence`), 22 automated tests + TS parity, CSV calibration protocol | Sec. IV, V; Listing 1; Field Survey Sheet | `muet-transit-intelligence/simulation/queuing.py`, `simulation/engine.py`, `tests/test_simulation.py`, `docs/field_data_collection_sheet.md`, `docs/methodology.md` |
| **R4: Experiments, Trade-Offs & Recommendations** | Dual-baseline 30-CRN paired CIs, Pareto plot (`Wait` vs `Pax Util`), fleet sweep (`c=4..14`), What-If (Exam, Rainy, 60m Breakdown, Surge), MUET Admin Recommendations | Sec. VI, VII, IX, X; Table II–IV; Fig. 3–10 | `muet-transit-intelligence/experiments/run_experiments.py`, `experiments/generate_figures.py`, `results/metrics/experiment_results.json`, `public/MUET_Point_Bus_IEEE_Report.pdf`, `src/App.tsx` |
