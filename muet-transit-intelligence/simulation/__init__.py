"""MUET Point Bus Discrete-Event Simulation Package."""

from .stdlib_engine import ParityConfig, run_parity_simulation

try:
    from .engine import MuetPointSimulation, SimConfig, load_config
except ImportError:
    MuetPointSimulation = None  # type: ignore[assignment]
    SimConfig = ParityConfig  # type: ignore[assignment]
    load_config = None  # type: ignore[assignment]

__all__ = [
    "MuetPointSimulation",
    "SimConfig",
    "load_config",
    "ParityConfig",
    "run_parity_simulation",
]
