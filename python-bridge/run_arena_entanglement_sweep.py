#!/usr/bin/env python3
"""Generate the engineering-only Quantum Arena entanglement sweep as JSON."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from quantum_arena.entanglement_sweep import DEFAULT_INTERVALS, run_entanglement_sweep


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--intervals", type=int, default=DEFAULT_INTERVALS)
    parser.add_argument("--output", type=Path, help="also save the complete engineering record as JSON")
    args = parser.parse_args()
    record = run_entanglement_sweep(intervals=args.intervals)
    payload = json.dumps(record, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload, encoding="utf-8")
    print(payload, end="")


if __name__ == "__main__":
    main()

