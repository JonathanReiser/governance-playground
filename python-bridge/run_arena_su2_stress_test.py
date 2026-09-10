#!/usr/bin/env python3
"""Run the engineering-only A4 one-sided SU(2) stress test and print JSON."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from quantum_arena.su2_stress import SearchConfig, run_stress_test


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--sobol-power", type=int, default=16, help="2**power Sobol points per seat")
    parser.add_argument("--local-starts", type=int, default=64)
    parser.add_argument("--de-maxiter", type=int, default=250)
    parser.add_argument("--de-popsize", type=int, default=15)
    parser.add_argument("--output", type=Path, help="also save the complete engineering record as JSON")
    args = parser.parse_args()
    config = SearchConfig(
        seed=args.seed,
        sobol_power=args.sobol_power,
        local_starts=args.local_starts,
        differential_evolution_maxiter=args.de_maxiter,
        differential_evolution_popsize=args.de_popsize,
    )
    record = run_stress_test(config)
    payload = json.dumps(record, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload, encoding="utf-8")
    print(payload, end="")


if __name__ == "__main__":
    main()
