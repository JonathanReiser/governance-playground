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

from .payoffs import BIMATRIX, expected_payoffs, pure_nash
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


def _menu_payoff_table(gamma: float) -> dict[tuple[str, str], tuple[float, float]]:
    return {
        (x, o): expected_payoffs(outcome_probabilities(MENU[x], MENU[o], gamma))
        for x in MENU
        for o in MENU
    }


def menu_equilibria(gamma: float) -> list[list[str]]:
    """Every pure Nash profile of the four-operation menu at this gamma.

    Distinct from ``restricted_menu.candidate_is_equilibrium``, which asks only
    about ``(Q,Q)``. The menu game has equilibria at every gamma; which ones
    changes twice across the domain, and reporting only the candidate's status
    invites reading "the menu stabilises" as "the menu had no equilibrium
    before", which is false.
    """

    return [list(entry["profile"]) for entry in pure_nash(_menu_payoff_table(gamma))]


def _q_over_d_against_d(gamma: float) -> float:
    """Q's advantage over D as a reply to D. Root = (D,D) ceases to be an equilibrium."""

    table = _menu_payoff_table(gamma)
    return float(table[("Q", "D")][0] - table[("D", "D")][0])


def menu_equilibrium_regimes() -> dict:
    """The three pure-equilibrium regimes of the frozen menu, with exact boundaries.

    Boundaries are Brent roots of best-response crossings, not grid readings. The
    lower one is where Q overtakes D as a reply to D; the upper one is the same
    root already reported as ``restricted_menu_transition``.
    """

    lower = float(brentq(_q_over_d_against_d, 0.0, MAX_ENTANGLEMENT, xtol=1e-14))
    upper = restricted_stability_threshold()
    probe = lambda a, b: menu_equilibria((a + b) / 2.0)  # noqa: E731
    return {
        "method": "Brent roots of frozen-menu best-response crossings; boundaries are exact, not grid readings",
        "boundaries": {
            "dd_to_asymmetric": {
                "gamma": lower,
                "gamma_fraction_of_max": lower / MAX_ENTANGLEMENT,
                "crossing": "Q overtakes D as a best reply to D",
            },
            "asymmetric_to_qq": {
                "gamma": upper,
                "gamma_fraction_of_max": upper / MAX_ENTANGLEMENT,
                "crossing": "D stops beating Q as a best reply to Q",
            },
        },
        "regimes": [
            {
                "label": "low entanglement",
                "gamma_min": 0.0,
                "gamma_max": lower,
                "equilibria": probe(0.0, lower),
                "description": "Mutual defection is the unique pure equilibrium.",
            },
            {
                "label": "middle band",
                "gamma_min": lower,
                "gamma_max": upper,
                "equilibria": probe(lower, upper),
                "description": (
                    "Two asymmetric pure equilibria. This is a coordination regime: the "
                    "players must agree which of them plays which operation."
                ),
            },
            {
                "label": "high entanglement",
                "gamma_min": upper,
                "gamma_max": MAX_ENTANGLEMENT,
                "equilibria": probe(upper, MAX_ENTANGLEMENT),
                "description": "(Q,Q) is the unique pure equilibrium within the menu.",
            },
        ],
    }


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
            "menu_equilibria": menu_equilibria(gamma),
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
        "menu_equilibrium_regimes": menu_equilibrium_regimes(),
        "grid_versus_exact": {
            "plotted_grid_points": intervals + 1,
            "grid_resolves_transition_to": "the interval between adjacent grid points only",
            "exact_values_source": "Brent root-finding on best-response crossings",
            "note": (
                "Every gamma reported to more precision than the grid spacing comes from a "
                "Brent root, not from reading the plotted curve. The two must not be quoted "
                "as though they carry the same precision."
            ),
        },
        "classical_limit_note": (
            "At gamma = 0 the entangler is the identity, Q is indistinguishable from C, and "
            "the i*sigma_x deviation reduces to playing D against a cooperating opponent — "
            "ordinary defection in a classical Prisoner's Dilemma, with no quantum content. "
            "The full-SU(2) exploitability is therefore constant across the domain for two "
            "different reasons, and only its value above the (Q,Q) stability threshold is "
            "information the frozen menu does not already supply."
        ),
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

