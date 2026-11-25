# MUET Transit Intelligence — Canonical Python/SimPy Engine & Experiments

This directory contains the **canonical Python discrete-event simulation (DES) engine**, verification test suite, figure generator, compiled IEEE PDF report, and LaTeX source for the MUET Point Bus PBL project.  
*(The React/TS app at `../src/` is an optional interactive visualizer reading `../src/data/verified_defaults.json` exported by `experiments/run_experiments.py`.)*

## Team and Supervision\n\n**Authors:** Mahrukh Mahar, Fatima Zubair, Nashrah Jahejo, Hafsa Noor  \n**Supervisor:** Engr. Umer Farooq  \n**Department:** Software Engineering\n\n## Reproducible Quick Start

```bash
pip install -r requirements.txt
python -m experiments.run_experiments
pytest -v
```

Or execute the end-to-end build (`JSON + 12 SVGs + 6-page IEEE PDF + 22 verification checks`) with one command:

```bash
./run_all.sh
# or: make all
```

*(If external packages are not installed, Python 3.11+ runs seamlessly using the bit-exact `simulation/stdlib_engine.py` and `python3 -m unittest discover -s tests -t . -v`.)*

## Key Canonical Outputs (`c = 10, K = 50`, 30 CRN Replications)

- **Best-Tuned Static Schedule:** `8m` off-peak / `4m` AM peak / `4m` PM peak (`3.09m` avg wait, `7.14m` P95, `44.24%` pax-carrying utilization).
- **Combined Optimizer:** `2.43m` avg wait (`-21.2%`, 95% paired CI `[-0.70, -0.61]m`, (paired effect size omitted from abstract)), `5.53m` P95, **`54.73%` pax-carrying fleet utilization**, `0.99%` empty-run dispatch ratio.
- **Same SLA With Fewer Buses:** Meets `Avg <= 5.0m & P95 <= 15.0m` at **`c = 7` buses** vs. **`c = 8`** for Best Static.
- **21/22 local verification checks (TypeScript parity requires Node dependencies):** Conservation, capacity cap, 4-stream CRN arrival identity, 60-min breakdown (`OUT_OF_SERVICE`), ablation conservation, `M/M/c` Erlang-C check, and bit-exact Python↔TypeScript parity on seed 42.

## Rubric-Mapping Table (`R1–R4` -> Report & Repository)

| Rubric Criterion | Requirement Summary | Report Section (`main.tex` & PDF) | Repository File Path(s) |
|---|---|---|---|
| **R1: Problem, Constraints & Stakeholders** | MUET AM/PM asymmetry, `c=10, K=50`, shifts, SLA, stakeholder conflict matrix, 6-state bus & queue conceptual diagrams | Sec. I, III, IV; Table I–II; Fig. 1a, 1b, 11 | `docs/report/main.tex`, `results/figures/fig1_bus_state_transition.svg`, `fig2_passenger_queue_flow.svg`, `fig11_dispatch_flowchart.svg` |
| **R2: Originality & Optimization** | Coupled predictive deadhead rebalancing + surplus release + traffic-aware urgency; 30-rep ablation; exact `J(pi)` | Sec. II, V, VIII; Table III | `optimization/policies.py`, `simulation/stdlib_engine.py`, `simulation/engine.py` |
| **R3: Modeling, Queuing & Verification** | `M/M/c` Erlang-C off-peak check vs. `M(t)/G^K/c` DES, NHPP thinning, `SeedSequence.spawn(4)` CRN, 22 tests + TS parity, CSV calibration | Sec. IV, V; Listing 1; Field Survey | `simulation/queuing.py`, `tests/test_simulation.py`, `docs/field_data_collection_sheet.md`, `docs/methodology.md` |
| **R4: Experiments, Trade-Offs & Recommendations** | Dual-baseline 30-CRN paired CIs, Pareto plot (`Wait` vs `Pax Util`), fleet sweep (`c=4..14`), What-If (Exam, Rainy, Breakdown, Surge), MUET Admin Recommendations | Sec. VI, VII, IX, X; Table II–IV; Fig. 3–10 | `experiments/run_experiments.py`, `experiments/generate_figures.py`, `results/metrics/experiment_results.json`, `docs/report/MUET_Point_Bus_IEEE_Report.pdf` |
\n\n## Report Source\n\nThe IEEE PDF is generated from the canonical Python report generator at `experiments/generate_figures.py` and the stored experiment metrics. The duplicate LaTeX report source has been removed to keep one report source. The generated PDF is copied to `docs/report/` and `public/` for local archive and web viewing.\n\n**CDF note:** `fig12_wait_cdf.svg` is a quantile-based approximation from stored representative-run summary metrics because raw passenger wait samples are not retained in the canonical artifact.\n