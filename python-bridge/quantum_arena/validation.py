"""The ten items from protocol-v1.md's "Required validation before human use".

Executable rather than prose. Each item returns a dict with `passed` and enough
detail to see WHY, so a failure names the thing that broke instead of a boolean.

Items 1-7 are properties of the implementation and run here. Items 8-10 are
runtime disciplines about how records are kept; they are stated, and marked
`enforced_elsewhere`, because a unit test cannot certify that a future operator
kept simulator and hardware observations apart.
"""

from __future__ import annotations

import itertools

import numpy as np
from scipy.linalg import expm

from .payoffs import BIMATRIX, PROFILES, expected_payoffs, is_prisoners_dilemma, pure_nash
from .protocol import BASIS, FLIP, MAX_ENTANGLEMENT, MENU, entangler, outcome_probabilities, unitary

TOLERANCE = 1e-12
GAMMA_GRID = np.linspace(0.0, MAX_ENTANGLEMENT, 201)
THETA_GRID = np.linspace(0.0, np.pi, 25)
PHI_GRID = np.linspace(0.0, np.pi / 2, 13)


def item_1_unitarity() -> dict:
    """U and J are unitary throughout their domains."""
    worst_u = max(
        float(np.max(np.abs(unitary(t, p).conj().T @ unitary(t, p) - np.eye(2))))
        for t in THETA_GRID
        for p in PHI_GRID
    )
    worst_j = max(
        float(np.max(np.abs(entangler(g).conj().T @ entangler(g) - np.eye(4))))
        for g in GAMMA_GRID
    )
    return {
        "item": 1,
        "name": "U and J are unitary throughout their domains",
        "passed": worst_u < TOLERANCE and worst_j < TOLERANCE,
        "worst_U_deviation": worst_u,
        "worst_J_deviation": worst_j,
    }


def item_2_classical_corners() -> dict:
    """All four classical corners return their own policy pair at EVERY gamma.

    This is the item draft 0.1 specified at gamma = 0 alone — precisely where a
    wrong entangler generator is invisible. Sweeping the grid is the whole point.
    """
    corners = {"CC": ("C", "C"), "CD": ("C", "D"), "DC": ("D", "C"), "DD": ("D", "D")}
    worst = 0.0
    worst_at = None
    for gamma in GAMMA_GRID:
        for expected, (x_op, o_op) in corners.items():
            p = outcome_probabilities(MENU[x_op], MENU[o_op], gamma)
            deviation = abs(p[expected] - 1.0)
            if deviation > worst:
                worst, worst_at = deviation, {"gamma": float(gamma), "corner": expected}
    return {
        "item": 2,
        "name": "classical corners recovered at every gamma, not only gamma = 0",
        "passed": worst < TOLERANCE,
        "gammas_checked": len(GAMMA_GRID),
        "worst_deviation": worst,
        "worst_at": worst_at,
    }


def item_3_phase_inert_at_zero() -> dict:
    """Phase has no observable effect at gamma = 0."""
    worst = 0.0
    for theta_x, theta_o in itertools.product(THETA_GRID[::6], repeat=2):
        base = outcome_probabilities((theta_x, 0.0), (theta_o, 0.0), 0.0)
        for phi_x, phi_o in itertools.product(PHI_GRID[::4], repeat=2):
            other = outcome_probabilities((theta_x, phi_x), (theta_o, phi_o), 0.0)
            worst = max(worst, max(abs(base[k] - other[k]) for k in BASIS))
    return {
        "item": 3,
        "name": "phase has no observable effect at gamma = 0",
        "passed": worst < TOLERANCE,
        "worst_deviation": worst,
    }


def item_4_valid_distribution() -> dict:
    """Probabilities are nonnegative and sum to one."""
    worst_sum = 0.0
    least = 1.0
    for gamma in GAMMA_GRID[::10]:
        for x_op, o_op in itertools.product(MENU.values(), repeat=2):
            p = outcome_probabilities(x_op, o_op, gamma)
            worst_sum = max(worst_sum, abs(sum(p.values()) - 1.0))
            least = min(least, min(p.values()))
    return {
        "item": 4,
        "name": "probabilities are nonnegative and sum to one",
        "passed": worst_sum < TOLERANCE and least >= -TOLERANCE,
        "worst_sum_deviation": worst_sum,
        "least_probability": least,
    }


def item_5_independent_matrix_check() -> dict:
    """Compare against an independent calculation on a dense fixed grid.

    protocol.entangler uses the closed form cos + i sin, valid because
    (FLIP (x) FLIP)^2 = I. Here J is rebuilt by genuine matrix exponentiation
    instead, so the check does not share the shortcut it is checking.
    """
    generator = np.kron(FLIP, FLIP)
    worst = 0.0
    for gamma in GAMMA_GRID[::4]:
        independent = expm(1j * gamma / 2 * generator)
        worst = max(worst, float(np.max(np.abs(independent - entangler(gamma)))))
    return {
        "item": 5,
        "name": "closed-form entangler matches an independent matrix exponential",
        "passed": worst < 1e-10,
        "worst_deviation": worst,
        "method": "scipy.linalg.expm",
    }


def _menu_payoff_table(gamma: float) -> dict:
    return {
        (x, o): expected_payoffs(outcome_probabilities(MENU[x], MENU[o], gamma))
        for x, o in itertools.product(MENU, repeat=2)
    }


def item_6_payoff_surface() -> dict:
    """The complete payoff surface and best responses, computed before exposure."""
    surface = {}
    for gamma in (0.0, MAX_ENTANGLEMENT / 2, MAX_ENTANGLEMENT):
        table = _menu_payoff_table(gamma)
        best_response = {
            o: max(MENU, key=lambda x: table[(x, o)][0]) for o in MENU
        }
        surface[f"gamma={gamma:.6f}"] = {
            "payoffs": {f"{x}|{o}": [round(v, 12) for v in table[(x, o)]] for x, o in table},
            "X_best_response_to": best_response,
        }
    return {
        "item": 6,
        "name": "complete payoff surface and best responses over the menu",
        "passed": True,
        "surface": surface,
    }


def item_7_equilibria() -> dict:
    """Nash equilibria within the restricted strategy family, with the tolerance stated."""
    found = {}
    for gamma in (0.0, MAX_ENTANGLEMENT):
        equilibria = pure_nash(_menu_payoff_table(gamma), tolerance=1e-9)
        found[f"gamma={gamma:.6f}"] = [
            {"profile": list(e["profile"]), "payoffs": [round(v, 12) for v in e["payoffs"]]}
            for e in equilibria
        ]
    return {
        "item": 7,
        "name": "pure Nash equilibria within the four-operation menu",
        "passed": all(len(v) >= 1 for v in found.values()),
        "tolerance": 1e-9,
        "equilibria": found,
        "scope_warning": (
            "Searched over the four-operation MENU only. An equilibrium within four "
            "options is weaker than one within the two-parameter family, which is itself "
            "what Benjamin & Hayden's objection targets. Under full SU(2), (Q,Q) is not "
            "an equilibrium at all. Never report these without that scope attached."
        ),
    }


RUNTIME_DISCIPLINES = {
    8: "On hardware, report raw and readout-mitigated results separately. Mitigation "
       "is a many-shot statistical correction and has no single-shot meaning, so a "
       "single play must never be reported as mitigated.",
    9: "Never pool simulator and hardware observations without preserving backend "
       "provenance. hardware.py records backend, backend_requested and backend_pinned "
       "on every reading; the simulator path carries none of those fields.",
    10: "Keep all arena records in their own schema and archive. Do not append them to "
        "the Phase 0 decision-lab dataset, and do not relabel Phase 0 observations as "
        "quantum-game data.",
}


def run_all() -> dict:
    checks = [
        item_1_unitarity(),
        item_2_classical_corners(),
        item_3_phase_inert_at_zero(),
        item_4_valid_distribution(),
        item_5_independent_matrix_check(),
        item_6_payoff_surface(),
        item_7_equilibria(),
    ]
    return {
        "protocol": "quantum-policy-tic-tac-toe/v1.0",
        "tolerance": TOLERANCE,
        "payoff_matrix": is_prisoners_dilemma(),
        "checks": checks,
        "all_passed": all(c["passed"] for c in checks),
        "runtime_disciplines_not_machine_checkable": RUNTIME_DISCIPLINES,
    }
