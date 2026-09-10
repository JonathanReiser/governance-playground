#!/usr/bin/env python3
"""Run the synthetic identifiability gate and print a verdict.

    python run_human_model_gate.py            # structural facts + one design
    python run_human_model_gate.py --sweep    # vary participants and trials

Engineering only. Passing does not authorise collecting participant data; it
only means a study built on this model would not be doomed before it started.
"""

import json
import sys

from quantum_arena.human_model_gate import (
    TaskDesign, run_gate, structural_observability, sweep_designs,
)


def main() -> int:
    if "--json" in sys.argv:
        payload = {
            "structural_observability": structural_observability(draws=4000),
            "gate": run_gate(TaskDesign(), replicates=4, restarts=4),
        }
        json.dump(payload, sys.stdout, indent=2)
        return 0

    print("Structural observability")
    print("=" * 60)
    for name, fact in structural_observability(draws=4000).items():
        holds = fact.get("holds")
        mark = "confirmed" if holds else ("—" if holds is None else "VIOLATED")
        print(f"  [{mark}] {name}")
        print(f"      {fact['consequence']}")
    print()

    if "--sweep" in sys.argv:
        print("Design sweep")
        print("=" * 60)
        report = sweep_designs(replicates=3, restarts=4)
        for row in report["results"]:
            verdict = "PASS" if row["passed"] else "fail"
            print(f"  [{verdict}] {row['participants']:>3} participants x "
                  f"{row['trials_per_participant']:>4} trials  "
                  f"worst |delta| error {row['worst_delta_error']:.3f}  "
                  f"FPR {row['false_positive_rate']:.2f}  TPR {row['true_positive_rate']:.2f}")
        print()
        print(f"  {report['verdict']}")
        return 0 if report["any_feasible_design_passes"] else 1

    design = TaskDesign()
    print(f"Gate — {design.participants} participants x {design.trials_per_participant} trials")
    print("=" * 60)
    report = run_gate(design, replicates=4, restarts=4)
    for name, passed in report["checks"].items():
        print(f"  [{'PASS' if passed else 'FAIL'}] {name}")
    print()
    print(f"  worst |delta| error : {report['delta_recovery']['worst_absolute_error']:.4f} rad")
    print(f"  false positive rate : {report['false_positive_rate']:.3f}")
    print(f"  true positive rate  : {report['true_positive_rate']:.3f}")
    print(f"  profile drop        : {report['profile_likelihood']['drop_from_delta_zero_to_optimum']:.1f}")
    print()
    print(f"  GATE {'PASSED' if report['passed'] else 'FAILED'}")
    print(f"  {report['interpretation']}")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
