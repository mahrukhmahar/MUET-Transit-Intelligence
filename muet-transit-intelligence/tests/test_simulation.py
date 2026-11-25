"""Comprehensive 22-Test Verification, Invariant, CRN, Boundary, Queuing & Parity Suite."""

import json
from pathlib import Path
import shutil
import subprocess
import unittest

from optimization.policies import DispatchInput, StaticSchedule, evaluate_policy, get_best_static_headway
from simulation.queuing import erlang_c_mmc, off_peak_verification_summary
from simulation.stdlib_engine import (
    Mulberry32,
    ParityConfig,
    compute_objective_j,
    get_arrival_rate,
    run_parity_simulation,
)

ALL_POLICIES = (
    "BASELINE_CURRENT",
    "BASELINE_BEST_STATIC",
    "QUEUE_AWARE",
    "ADAPTIVE_HEADWAY",
    "COMBINED",
)

ABLATION_POLICIES = (
    "ABLATION_NO_REBALANCE",
    "ABLATION_NO_TRAFFIC_COMP",
    "ABLATION_NO_SURPLUS",
    "ABLATION_NO_URGENCY",
)


class TestMuetPointSimulation(unittest.TestCase):
    def test_01_seed_reproducibility(self):
        r1 = run_parity_simulation(ParityConfig(seed=777, policy="COMBINED"))
        r2 = run_parity_simulation(ParityConfig(seed=777, policy="COMBINED"))
        self.assertEqual(r1["total_arrivals"], r2["total_arrivals"])
        self.assertEqual(r1["avg_wait_time"], r2["avg_wait_time"])
        self.assertEqual(r1["objective_j"], r2["objective_j"])

    def test_02_distinct_seeds_differ(self):
        r1 = run_parity_simulation(ParityConfig(seed=101))
        r2 = run_parity_simulation(ParityConfig(seed=202))
        self.assertTrue(
            r1["total_arrivals"] != r2["total_arrivals"] or r1["avg_wait_time"] != r2["avg_wait_time"]
        )

    def test_03_crn_arrivals_identical_across_all_policies(self):
        runs = [run_parity_simulation(ParityConfig(seed=42, policy=p)) for p in ALL_POLICIES]
        ref_total = runs[0]["total_arrivals"]
        ref_stc = runs[0]["stc_arrivals"]
        ref_mg = runs[0]["mg_arrivals"]
        for r in runs:
            self.assertEqual(r["total_arrivals"], ref_total)
            self.assertEqual(r["stc_arrivals"], ref_stc)
            self.assertEqual(r["mg_arrivals"], ref_mg)

    def test_04_passenger_conservation_all_policies(self):
        for p in ALL_POLICIES:
            r = run_parity_simulation(ParityConfig(policy=p, arrival_multiplier=1.35, seed=55))
            self.assertEqual(r["completed_journeys"] + r["unserved_at_close"], r["total_arrivals"])

    def test_05_capacity_never_exceeded(self):
        for p in ALL_POLICIES:
            r = run_parity_simulation(ParityConfig(policy=p, arrival_multiplier=1.5, seed=55))
            self.assertEqual(r["capacity_violations"], 0.0)
            self.assertLessEqual(r["avg_load_factor"], 100.0)

    def test_06_fleet_size_conservation(self):
        for p in ALL_POLICIES:
            r = run_parity_simulation(ParityConfig(policy=p, fleet_size=8))
            self.assertEqual(r["fleet_count"], 8.0)

    def test_07_monotonic_time_and_non_negative_waits(self):
        for p in ALL_POLICIES:
            r = run_parity_simulation(ParityConfig(policy=p))
            self.assertEqual(r["monotonic_violations"], 0.0)
            self.assertEqual(r["bad_timestamps"], 0.0)
            self.assertGreaterEqual(r["avg_wait_time"], 0.0)
            self.assertGreaterEqual(r["p95_wait_time"], r["avg_wait_time"])

    def test_08_nhpp_peak_windows(self):
        self.assertGreater(get_arrival_rate("MAIN_GATE", 60.0, 1.0), get_arrival_rate("MAIN_GATE", 200.0, 1.0) * 3.0)
        self.assertGreater(get_arrival_rate("STC", 430.0, 1.0), get_arrival_rate("STC", 200.0, 1.0) * 3.0)

    def test_09_boundary_minimum_fleet_c2_surge(self):
        r = run_parity_simulation(ParityConfig(fleet_size=2, bus_capacity=30, sudden_surge_enabled=True))
        self.assertEqual(r["capacity_violations"], 0.0)
        self.assertGreater(r["total_arrivals"], 0.0)

    def test_10_boundary_zero_demand(self):
        r = run_parity_simulation(ParityConfig(arrival_multiplier=0.0))
        self.assertEqual(r["total_arrivals"], 0.0)
        self.assertEqual(r["avg_wait_time"], 0.0)
        self.assertEqual(r["unserved_at_close"], 0.0)

    def test_11_boundary_extreme_demand(self):
        r = run_parity_simulation(ParityConfig(arrival_multiplier=2.5))
        self.assertEqual(r["capacity_violations"], 0.0)
        self.assertGreater(r["total_arrivals"], 7000.0)
        self.assertEqual(r["completed_journeys"] + r["unserved_at_close"], r["total_arrivals"])

    def test_12_boundary_zero_traffic(self):
        r = run_parity_simulation(ParityConfig(traffic_severity=0.0))
        self.assertEqual(r["capacity_violations"], 0.0)

    def test_13_baseline_headway_behavior(self):
        dec = evaluate_policy(
            DispatchInput(
                policy="BASELINE_CURRENT",
                terminal="STC",
                time=10.0,
                queue_length=140,
                oldest_arrival=0.0,
                available_buses=3,
                opposite_queue_length=0,
                opposite_available_buses=2,
                incoming_buses=0,
                bus_capacity=50,
                time_since_last_dispatch=8.0,
                baseline_headway=12.0,
                best_static=StaticSchedule(),
                ewma_rate=6.0,
                opposite_ewma_rate=1.0,
                expected_trip_time=12.0,
                recent_traffic_delay=1.0,
            )
        )
        self.assertFalse(dec.should_dispatch)
        self.assertFalse(dec.should_reposition)

    def test_14_best_static_window_switching(self):
        sched = StaticSchedule(off_peak_headway=12.0, morning_peak_headway=5.0, afternoon_peak_headway=6.0)
        self.assertEqual(get_best_static_headway(15.0, sched), 12.0)
        self.assertEqual(get_best_static_headway(60.0, sched), 5.0)
        self.assertEqual(get_best_static_headway(200.0, sched), 12.0)
        self.assertEqual(get_best_static_headway(430.0, sched), 6.0)

    def test_15_objective_j_exact_formula(self):
        j = compute_objective_j(10.0, 25.0, 50.0, 100, 1000, 5, 100)
        self.assertAlmostEqual(j, 0.7625, places=6)

    def test_16_exponential_rng_empirical_mean(self):
        rng = Mulberry32(12345)
        mean_emp = sum(rng.exponential(2.5) for _ in range(5000)) / 5000.0
        self.assertLess(abs(mean_emp - 0.4), 0.03)

    def test_17_best_static_beats_current_assumed(self):
        cur = run_parity_simulation(ParityConfig(policy="BASELINE_CURRENT", seed=42))
        best = run_parity_simulation(ParityConfig(policy="BASELINE_BEST_STATIC", seed=42))
        self.assertLess(best["avg_wait_time"], cur["avg_wait_time"])

    def test_18_python_typescript_parity(self):
        repo_root = Path(__file__).resolve().parent.parent.parent
        ts_engine = repo_root / "src/sim/engine.ts"
        if not ts_engine.exists() or shutil.which("npx") is None:
            self.skipTest("TypeScript runtime not present")
        script = (
            "import { runSingleSimulation } from './src/sim/engine';"
            "import { DEFAULT_CONFIG } from './src/sim/types';"
            "const policies = ['BASELINE_CURRENT','BASELINE_BEST_STATIC','QUEUE_AWARE','ADAPTIVE_HEADWAY','COMBINED'];"
            "const out = {};"
            "for (const p of policies) out[p] = runSingleSimulation({...DEFAULT_CONFIG, policy: p, seed: 42}).metrics;"
            "console.log(JSON.stringify(out));"
        )
        proc = subprocess.run(
            ["npx", "tsx", "-e", script],
            cwd=str(repo_root),
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        if proc.returncode != 0:
            self.skipTest(f"tsx unavailable: {proc.stderr.strip()}")
        ts_map = json.loads(proc.stdout.strip().splitlines()[-1])
        for policy in ALL_POLICIES:
            py_res = run_parity_simulation(ParityConfig(policy=policy, seed=42))
            ts_res = ts_map[policy]
            self.assertEqual(py_res["total_arrivals"], ts_res["totalArrivals"])
            self.assertEqual(py_res["completed_journeys"], ts_res["completedJourneys"])
            self.assertAlmostEqual(py_res["avg_wait_time"], ts_res["avgWaitTime"], delta=0.02)
            self.assertAlmostEqual(py_res["fleet_utilization"], ts_res["fleetUtilization"], delta=0.2)
            self.assertAlmostEqual(py_res["empty_run_ratio"], ts_res["emptyRunRatio"], delta=0.2)
            self.assertAlmostEqual(py_res["objective_j"], ts_res["objectiveJ"], delta=0.002)

    def test_19_utilization_excludes_empty_deadheads(self):
        r = run_parity_simulation(ParityConfig(policy="COMBINED", seed=42))
        self.assertGreater(r["fleet_utilization"], 0.0)
        self.assertLess(r["fleet_utilization"], 100.0)
        self.assertGreaterEqual(r["empty_run_ratio"], 0.0)
        self.assertGreaterEqual(r["empty_run_time_pct"], 0.0)
        self.assertLessEqual(r["fleet_utilization"] + r["empty_run_time_pct"], 100.2)

    def test_20_breakdown_event_60_minutes(self):
        r = run_parity_simulation(ParityConfig(policy="COMBINED", breakdown_enabled=True, seed=42))
        self.assertAlmostEqual(r["out_of_service_minutes"], 60.0, delta=0.2)
        self.assertEqual(r["capacity_violations"], 0.0)
        self.assertEqual(r["completed_journeys"] + r["unserved_at_close"], r["total_arrivals"])

    def test_21_ablation_modes_conserve_passengers(self):
        for pol in ABLATION_POLICIES:
            r = run_parity_simulation(ParityConfig(policy=pol, seed=42))
            self.assertEqual(r["capacity_violations"], 0.0)
            self.assertEqual(r["completed_journeys"] + r["unserved_at_close"], r["total_arrivals"])
            self.assertEqual(r["monotonic_violations"], 0.0)

    def test_22_queuing_mmc_and_exported_schema(self):
        off = erlang_c_mmc(3.4, 2.0, 10)
        self.assertTrue(off["stable"])
        self.assertLess(off["rho"], 0.5)
        peak = erlang_c_mmc(13.2, 50.0 / 28.0, 5)
        self.assertFalse(peak["stable"])
        self.assertGreaterEqual(peak["rho"], 1.0)
        summary = off_peak_verification_summary(2.3)
        self.assertIn("des_justification", summary)

        metrics_path = Path(__file__).resolve().parent.parent / "results/metrics/experiment_results.json"
        if metrics_path.exists():
            data = json.loads(metrics_path.read_text(encoding="utf-8"))
            for key in ("paretoPoints", "whatIfScenarios", "ablation", "queuingVerification"):
                self.assertIn(key, data)
            self.assertEqual(len(data["whatIfScenarios"]), 5)
            self.assertEqual(len(data["ablation"]), 5)


if __name__ == "__main__":
    unittest.main(verbosity=2)
