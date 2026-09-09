"""The frozen payoff bimatrix from frozen-policy-payoff-spec.md.

Not zero-sum, deliberately. Under E_O = -E_X no quantum advantage is reachable
even in principle, because every correlated equilibrium of a two-player zero-sum
game has the value of the game. See protocol-v1.md, "What changed from 0.1".
"""

from __future__ import annotations

import itertools

PROFILES = ("CC", "CD", "DC", "DD")

T, R, P, S = 2 / 3, 0.0, -2 / 3, -1.0

# (payoff to X, payoff to O)
BIMATRIX: dict[str, tuple[float, float]] = {
    "CC": (R, R),
    "CD": (S, T),
    "DC": (T, S),
    "DD": (P, P),
}

# x -> 3x + 3 maps (T,R,P,S) onto the canonical EWL matrix (5,3,1,0). Nash
# equilibria are invariant under a positive affine rescaling of each player's
# utility, so published EWL results transfer directly.
CANONICAL_AFFINE = (3.0, 3.0)


def to_canonical(value: float) -> float:
    scale, offset = CANONICAL_AFFINE
    return scale * value + offset


def is_prisoners_dilemma(tolerance: float = 1e-12) -> dict:
    return {
        "ordering_T_gt_R_gt_P_gt_S": T > R > P > S,
        "mutual_cooperation_beats_alternating": 2 * R > T + S + tolerance,
        "T_R_P_S": (T, R, P, S),
        "canonical": tuple(to_canonical(v) for v in (T, R, P, S)),
    }


def expected_payoffs(probabilities: dict[str, float]) -> tuple[float, float]:
    """Expected (X, O) payoff under a distribution over policy pairs."""
    missing = set(PROFILES) - set(probabilities)
    if missing:
        raise ValueError(f"distribution is missing profiles: {sorted(missing)}")
    x = sum(probabilities[p] * BIMATRIX[p][0] for p in PROFILES)
    o = sum(probabilities[p] * BIMATRIX[p][1] for p in PROFILES)
    return x, o


def pure_nash(payoff_table: dict[tuple[str, str], tuple[float, float]], tolerance: float = 1e-9):
    """Pure Nash equilibria over whatever operation set the table covers.

    The set matters: an equilibrium within a four-option menu is a far weaker
    statement than one within the two-parameter family, which is itself weaker
    than one over SU(2). Callers must say which set they searched.
    """
    names = sorted({row for row, _ in payoff_table})
    equilibria = []
    for row, col in itertools.product(names, repeat=2):
        x, o = payoff_table[(row, col)]
        x_best = all(payoff_table[(alt, col)][0] <= x + tolerance for alt in names)
        o_best = all(payoff_table[(row, alt)][1] <= o + tolerance for alt in names)
        if x_best and o_best:
            equilibria.append({"profile": (row, col), "payoffs": (x, o)})
    return equilibria
