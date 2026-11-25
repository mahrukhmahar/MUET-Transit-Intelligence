#!/usr/bin/env python3
from pathlib import Path
import sys
root = Path(__file__).resolve().parents[1]
project = root / "muet-transit-intelligence"
outputs = [
 project / "results/metrics/experiment_results.json",
 root / "src/data/verified_defaults.json",
 project / "docs/report/MUET_Point_Bus_IEEE_Report.pdf",
 root / "public/MUET_Point_Bus_IEEE_Report.pdf",
 *sorted((project / "results/figures").glob("*.svg")),
]
empty = [str(p.relative_to(root)) for p in outputs if not p.exists() or p.stat().st_size == 0]
if empty:
 print("ERROR: missing/zero-byte outputs:\\n" + "\\n".join(empty))
 sys.exit(1)
print(f"OK: checked {len(outputs)} output files; none missing or zero bytes")
