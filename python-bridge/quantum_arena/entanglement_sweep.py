"""Auditable entanglement sweep for the Quantum Arena strategy-space test.

The frozen candidate is ``(Q, Q)``.  At each value of ``gamma`` this module
compares two unilateral-deviation domains:

* the four operations frozen by protocol v1.0; and
* the explicit full-SU(2) witness ``i*sigma_x`` from the A4 stress test.

The full-space result does not rely on rerunning a numerical optimizer at every
point: the witness attains the largest payoff present anywhere in the frozen
bimatrix, so it is a certified global best response for this one-sided test.
This remains an engineering result, not human evidence or a hardware run.
"""

from __future__ import annotations

from datetime import datetime, timezone
import math

from scipy.optimize import brentq

from .payoffs import BIMATRIX, expected_payoffs
from .protocol import BASIS, MAX_ENTANGLEMENT, MENU, outcome_probabilities
from .su2_stress import (
    EXPLOITABILITY_TOLERANCE,
    I_SIGMA_X_PARAMETERS,
    Q_OPERATION,
    evaluate_deviation,
    expected_payoffs_for_operations,
)

SCHEMA = "quantum-arena-entanglement-sweep/v0.1"
DEFAULT_INTERVALS = 64


def _candidate(gamma: float) -> tuple[tuple[float, float], dict[str, float]]:
    return expected_payoffs_for_operations(Q_OPERATION, Q_OPERATION, gamma)


def _restricted_response(seat: str, gamma: float, candidate_payoff: float) -> dict:
    index = 0 if seat == "X" else 1
    alternatives: dict[str, float] = {}
    for name, operation in MENU.items():
        operation_x = operation if seat == "X" else MENU["Q"]
        operation_o = MENU["Q"] if seat == "X" else operation
        probabilities = outcome_probabilities(operation_x, operation_o, gamma)
        alternatives[name] = float(expected_payoffs(probabilities)[index])
    best_operation = max(alternatives, key=alternatives.get)
    best_payoff = alternatives[best_operation]
    return {
        "best_operation": best_operation,
        "best_payoff": best_payoff,
        "candidate_payoff": candidate_payoff,
        "gain": max(0.0, best_payoff - candidate_payoff),
        "all_payoffs": alternatives,
    }


def _full_response(seat: str, gamma: float, candidate_payoff: float) -> dict:
    witness = evaluate_deviation(I_SIGMA_X_PARAMETERS, seat, Q_OPERATION, gamma)
    payoff_ceiling = max(values[0 if seat == "X" else 1] for values in BIMATRIX.values())
    ceiling_gap = payoff_ceiling - witness["deviator_payoff"]
    return {
        "witness": "i*sigma_x",
        "parameters": witness["parameters"],
        "probabilities": witness["probabilities"],
        "best_payoff": witness["deviator_payoff"],
        "candidate_payoff": candidate_payoff,
        "gain": max(0.0, witness["deviator_payoff"] - candidate_payoff),
        "payoff_ceiling": payoff_ceiling,
        "ceiling_gap": ceiling_gap,
        "globally_certified_by_payoff_ceiling": abs(ceiling_gap) <= 1e-12,
    }


def _restricted_d_gain(gamma: float) -> float:
    candidate_payoff = _candidate(gamma)[0][0]
    probabilities = outcome_probabilities(MENU["D"], MENU["Q"], gamma)
    return float(expected_payoffs(probabilities)[0] - candidate_payoff)


def restricted_stability_threshold() -> float:
    """Return the D-to-Q best-response transition for the frozen menu."""

    return float(brentq(_restricted_d_gain, 0.0, MAX_ENTANGLEMENT, xtol=1e-14))


def sweep_point(gamma: float, tolerance: float = EXPLOITABILITY_TOLERANCE) -> dict:
    if not math.isfinite(gamma) or gamma < 0 or gamma > MAX_ENTANGLEMENT + 1e-12:
        raise ValueError("gamma must lie in [0, pi/2]")
    candidate_payoffs, candidate_probabilities = _candidate(gamma)
    restricted = {
        seat: _restricted_response(seat, gamma, candidate_payoffs[0 if seat == "X" else 1])
        for seat in ("X", "O")
    }
    full = {
        seat: _full_response(seat, gamma, candidate_payoffs[0 if seat == "X" else 1])
        for seat in ("X", "O")
    }
    restricted_exploitability = max(response["gain"] for response in restricted.values())
    full_exploitability = max(response["gain"] for response in full.values())
    return {
        "gamma": float(gamma),
        "gamma_fraction_of_max": float(gamma / MAX_ENTANGLEMENT),
        "candidate": {
            "profile": ["Q", "Q"],
            "probabilities": candidate_probabilities,
            "payoffs": {"X": candidate_payoffs[0], "O": candidate_payoffs[1]},
        },
        "restricted_menu": {
            "responses": restricted,
            "exploitability": restricted_exploitability,
            "candidate_is_equilibrium": restricted_exploitability <= tolerance,
        },
        "full_su2": {
            "responses": full,
            "exploitability": full_exploitability,
            "candidate_is_equilibrium": full_exploitability <= tolerance,
        },
    }


def run_entanglement_sweep(
    intervals: int = DEFAULT_INTERVALS,
    tolerance: float = EXPLOITABILITY_TOLERANCE,
) -> dict:
    """Generate a complete, display-ready engineering record."""

    if not isinstance(intervals, int) or intervals < 2 or intervals > 512:
        raise ValueError("intervals must be an integer between 2 and 512")
    if not 0 < tolerance < 1:
        raise ValueError("tolerance must lie between 0 and 1")

    points = [sweep_point(MAX_ENTANGLEMENT * step / intervals, tolerance) for step in range(intervals + 1)]
    threshold = restricted_stability_threshold()
    threshold_point = sweep_point(threshold, tolerance)
    full_certified = all(
        response["globally_certified_by_payoff_ceiling"]
        for point in points
        for response in point["full_su2"]["responses"].values()
    )
    return {
        "schema": SCHEMA,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "engineering_only": True,
        "preregistered_experiment": False,
        "baseline_protocol": "quantum-policy-tic-tac-toe/v1.0",
        "stress_protocol": "quantum-policy-tic-tac-toe-strategy-space/v0.1-draft",
        "candidate": ["Q", "Q"],
        "gamma_domain": {"minimum": 0.0, "maximum": MAX_ENTANGLEMENT, "intervals": intervals},
        "tolerance": tolerance,
        "restricted_menu_transition": {
            "gamma": threshold,
            "gamma_fraction_of_max": threshold / MAX_ENTANGLEMENT,
            "method": "Brent root of the frozen-menu D-versus-Q payoff gain",
            "point": threshold_point,
            "interpretation": "At and above this gamma, no frozen-menu operation improves on Q against Q.",
        },
        "full_su2_certificate": {
            "witness": "i*sigma_x",
            "parameters": {"alpha": 0.0, "beta": math.pi, "delta": math.pi / 2.0},
            "payoff_upper_bound": max(max(values) for values in BIMATRIX.values()),
            "certified_at_every_grid_point": full_certified,
            "reason": "The witness reaches the largest payoff in the frozen bimatrix, so no strategy can do better.",
        },
        "points": points,
        "claim_boundary": (
            "Engineering-only exact-simulator sweep. It is not participant data, hardware evidence, "
            "a quantum-advantage claim, or evidence for or against quantum cognition."
        ),
    }

