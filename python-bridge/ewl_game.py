"""
ewl_game.py — the Eisert-Wilkens-Lewenstein quantum prisoner's dilemma,
as a COMPARISON BASELINE for the nation-agent runs. Not a mechanism.

WHAT THIS IS FOR. The security dilemma — escalate/de-escalate, arm/disarm
— is a prisoner's dilemma, the canonical formal model in international
relations. EWL (Eisert, Wilkens & Lewenstein, "Quantum Games and Quantum
Strategies", Phys. Rev. Lett. 83, 3077 (1999)) is a PD result: if both
players share a maximally entangled pair and each applies a local
unitary to their own qubit, a strategy outside the classical set becomes
available and the mutual-defection trap can be escaped. This module
computes that result, plus its two classical reference points, so a run
of Claude-powered nation agents has something to be measured AGAINST.

WHAT THIS IS NOT — and this is the whole point of the module, so it is
stated before any of the code rather than in a footnote:

EWL requires both players to apply quantum unitaries to shared entangled
qubits. Real nations do not do this. The Claude-powered nation agents in
this project do not do this either — they reason in natural language over
a scenario briefing. Nothing computed here makes, or could make, the
simulated nations cooperate more. It is a theoretical reference point on
the same axis, and that is its entire role. Any writeup that reports EWL
as a cause of anything observed in a run of this project is wrong, and
wrong in exactly the way the sibling repo quantum-orch-or was wrong.

This module therefore deliberately has NO real-hardware path, unlike
instinct_qpu.py and layer1_qpu.py. Those two measure something whose
value depends on being physically real. This one evaluates a closed-form
counterfactual: the payoffs below are exact statevector algebra, and
running them on a noisy QPU would produce a worse estimate of a number
that is already known exactly, while implying the counterfactual is a
measurement of something. The one thing worth checking on hardware —
that state preparation and joint measurement of an entangled pair behave
as derived — is already checked, live, by layer1_qpu.py.

THREE REFERENCE POINTS, and why the middle one is the one that matters:

  1. Classical Nash equilibrium. In a strict PD this is mutual defection
     — the dilemma itself.
  2. Classical correlated equilibrium (Aumann 1974). A shared correlating
     signal, no quantum anything. This is the honest comparison, because
     in many games a correlating device ALREADY improves on Nash, and any
     quantum result has to beat this bar, not the Nash bar, before
     "quantum helps" means anything. See correlated_equilibrium() — for
     the canonical PD payoffs it does NOT improve on Nash (a strictly
     dominated action gets zero weight in every correlated equilibrium,
     so the correlated set collapses to the Nash point), which is a
     result in its own right and is asserted in the tests.
  3. The EWL quantum equilibrium, RE-DERIVED rather than assumed.

On re-deriving rather than assuming: (Q,Q) -> (3,3) is a property of the
canonical PD payoffs AND of maximal entanglement in J, not a general
fact. Both dependencies are computed here rather than taken on faith:
ewl_equilibria() searches the restricted strategy set for whatever the
equilibria actually are under the payoffs handed in, and
entanglement_threshold() scans the entangling parameter to find where
the quantum equilibrium starts to exist at all. For the canonical PD
that threshold is sin^2(gamma) = 2/5, i.e. maximal entanglement is not
required but a substantial amount is.

BENJAMIN & HAYDEN. Benjamin & Hayden, "Comment on 'Quantum Games and
Quantum Strategies'", Phys. Rev. Lett. 87, 069801 (2001), argue that
EWL's (Q,Q) equilibrium is an artifact of an arbitrarily restricted
strategy space: allow all of SU(2) and Q is no longer an equilibrium,
because the counter-strategy to Q is in the space EWL excluded. This
module does not merely cite that objection, it reproduces it —
best_response_over_su2() finds a unitary that scores 5.0 against Q,
beating Q's own 3.0, and tests/test_ewl_game.py asserts it. So the
quantum equilibrium reported here is always an equilibrium OF THE
RESTRICTED GAME, and is labeled that way everywhere it is returned.

BIT ORDERING. Player 1 is qubit 0, player 2 is qubit 1. Qiskit's
statevector index for 2 qubits is 2*q1 + q0, so index 1 = |01> = player 1
in the "defect" basis state and player 2 in "cooperate" — i.e. the DC
profile, not CD. Getting this backwards would silently transpose the
asymmetric payoffs (0,5) and (5,0) without raising anything, the same
class of silent bug layer1_qpu.py's TestBitOrdering exists to catch, so
it gets its own asymmetric-profile assertions in the tests rather than
resting on this paragraph.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from qiskit import QuantumCircuit
from qiskit.quantum_info import Operator, Statevector
from scipy.linalg import expm
from scipy.optimize import linprog, minimize

# Profile keys are (player-1 action, player-2 action), always in that order.
PROFILES = ("CC", "CD", "DC", "DD")


@dataclass(frozen=True)
class PayoffMatrix:
    """
    A 2x2 symmetric-form game. Each field is (payoff to player 1, payoff
    to player 2) for that action profile, player 1's action first.
    """

    cc: tuple[float, float]
    cd: tuple[float, float]
    dc: tuple[float, float]
    dd: tuple[float, float]

    def payoff(self, profile: str, player: int) -> float:
        return getattr(self, profile.lower())[player]

    def as_dict(self) -> dict[str, tuple[float, float]]:
        return {p: getattr(self, p.lower()) for p in PROFILES}


# The canonical PD used throughout the EWL literature, and the default
# stipulated payoffs for a security-dilemma dyad. See dyad_baseline.py for
# why a stipulated ordinal matrix — rather than one fitted to a scenario —
# is the honest choice for this comparison.
CANONICAL_PD = PayoffMatrix(cc=(3.0, 3.0), cd=(0.0, 5.0), dc=(5.0, 0.0), dd=(1.0, 1.0))

_X = np.array([[0.0, 1.0], [1.0, 0.0]], dtype=complex)
_I = np.eye(2, dtype=complex)

U_C = _I.copy()                                            # cooperate / de-escalate
U_D = _X.copy()                                            # defect / escalate
U_Q = np.array([[1j, 0.0], [0.0, -1j]], dtype=complex)      # EWL's quantum strategy

# The restricted strategy set EWL's result lives in. Named explicitly
# because "restricted" is load-bearing — see Benjamin & Hayden above.
RESTRICTED_STRATEGIES: dict[str, np.ndarray] = {"C": U_C, "D": U_D, "Q": U_Q}

MAX_ENTANGLEMENT = math.pi / 2  # gamma; J is maximally entangling here


def entangling_operator(gamma: float = MAX_ENTANGLEMENT) -> np.ndarray:
    """
    EWL's J = exp(i * gamma/2 * X (x) X). gamma=0 is the product (fully
    classical) game; gamma=pi/2 is maximal entanglement, where J reduces
    to the familiar (1/sqrt(2)) * (I(x)I + i * X(x)X).
    """
    return expm(1j * gamma / 2.0 * np.kron(_X, _X))


def _profile_probabilities(u1: np.ndarray, u2: np.ndarray, gamma: float) -> dict[str, float]:
    """
    Run the EWL circuit J -> (U1 on q0, U2 on q1) -> J_dagger and return the
    probability of each action profile. Exact statevector algebra, no
    sampling — this is a closed-form counterfactual, not a measurement
    (see module docstring).
    """
    j_matrix = entangling_operator(gamma)
    circuit = QuantumCircuit(2, name="ewl_game")
    circuit.append(Operator(j_matrix), [0, 1])
    circuit.append(Operator(u1), [0])
    circuit.append(Operator(u2), [1])
    circuit.append(Operator(j_matrix.conj().T), [0, 1])

    probs = np.abs(Statevector.from_instruction(circuit).data) ** 2
    # Qiskit index = 2*q1 + q0, player 1 on q0 -> index 1 is DC, index 2 is CD.
    return {"CC": float(probs[0]), "DC": float(probs[1]), "CD": float(probs[2]), "DD": float(probs[3])}


def ewl_payoffs(
    u1: np.ndarray,
    u2: np.ndarray,
    payoffs: PayoffMatrix = CANONICAL_PD,
    gamma: float = MAX_ENTANGLEMENT,
) -> tuple[tuple[float, float], dict[str, float]]:
    """
    Expected payoffs to (player 1, player 2) when they apply local
    unitaries u1 and u2 in an EWL game with entanglement gamma, plus the
    profile probabilities those payoffs were computed from.
    """
    probs = _profile_probabilities(u1, u2, gamma)
    p1 = sum(probs[k] * payoffs.payoff(k, 0) for k in PROFILES)
    p2 = sum(probs[k] * payoffs.payoff(k, 1) for k in PROFILES)
    return (p1, p2), probs


def restricted_game(
    payoffs: PayoffMatrix = CANONICAL_PD,
    gamma: float = MAX_ENTANGLEMENT,
    strategies: dict[str, np.ndarray] | None = None,
) -> dict[tuple[str, str], tuple[float, float]]:
    """
    The full bimatrix of the EWL game over a finite strategy set — by
    default EWL's own restricted {C, D, Q}. This is the object the
    quantum "equilibrium" is an equilibrium of; nothing here claims it is
    an equilibrium of the unrestricted quantum game.
    """
    strategies = strategies if strategies is not None else RESTRICTED_STRATEGIES
    return {
        (s1, s2): ewl_payoffs(strategies[s1], strategies[s2], payoffs, gamma)[0]
        for s1 in strategies
        for s2 in strategies
    }


def pure_nash(bimatrix: dict[tuple[str, str], tuple[float, float]], tol: float = 1e-9) -> list[tuple[str, str]]:
    """Every pure-strategy Nash equilibrium of an arbitrary finite bimatrix."""
    rows = sorted({s1 for s1, _ in bimatrix})
    cols = sorted({s2 for _, s2 in bimatrix})
    equilibria = []
    for s1 in rows:
        for s2 in cols:
            p1, p2 = bimatrix[(s1, s2)]
            if p1 + tol < max(bimatrix[(alt, s2)][0] for alt in rows):
                continue
            if p2 + tol < max(bimatrix[(s1, alt)][1] for alt in cols):
                continue
            equilibria.append((s1, s2))
    return equilibria


def classical_bimatrix(payoffs: PayoffMatrix) -> dict[tuple[str, str], tuple[float, float]]:
    """The ordinary 2x2 game, with no quantum layer of any kind."""
    return {(p[0], p[1]): getattr(payoffs, p.lower()) for p in PROFILES}


def classical_nash(payoffs: PayoffMatrix = CANONICAL_PD) -> dict:
    """
    Reference point 1. Pure equilibria by best-response enumeration, plus
    the interior mixed equilibrium if one exists (it does not when either
    player has a strictly dominant action, as in a strict PD — the
    indifference solution falls outside [0,1] and is reported as absent
    rather than clipped into range).
    """
    bimatrix = classical_bimatrix(payoffs)
    pure = pure_nash(bimatrix)

    # q = P(player 2 plays C) making player 1 indifferent, and vice versa.
    def _indifference(a_same: float, a_other: float, b_same: float, b_other: float) -> float | None:
        denom = (a_same - a_other) + (b_same - b_other)
        if abs(denom) < 1e-12:
            return None
        value = (b_same - b_other) / denom
        return value if 0.0 < value < 1.0 else None

    q = _indifference(payoffs.cc[0], payoffs.dc[0], payoffs.dd[0], payoffs.cd[0])
    p = _indifference(payoffs.cc[1], payoffs.cd[1], payoffs.dd[1], payoffs.dc[1])

    mixed = None
    if q is not None and p is not None:
        joint = {"CC": p * q, "CD": p * (1 - q), "DC": (1 - p) * q, "DD": (1 - p) * (1 - q)}
        mixed = {
            "p1_prob_cooperate": p,
            "p2_prob_cooperate": q,
            "expected_payoffs": _expected_payoffs(joint, payoffs),
        }

    return {
        "pure": [{"profile": f"{s1}{s2}", "payoffs": bimatrix[(s1, s2)]} for s1, s2 in pure],
        "mixed": mixed,
    }


def _expected_payoffs(dist: dict[str, float], payoffs: PayoffMatrix) -> tuple[float, float]:
    return (
        sum(dist.get(k, 0.0) * payoffs.payoff(k, 0) for k in PROFILES),
        sum(dist.get(k, 0.0) * payoffs.payoff(k, 1) for k in PROFILES),
    )


def _obedience_constraints(payoffs: PayoffMatrix) -> list[list[float]]:
    """
    Aumann's incentive constraints, as rows of A for A @ p <= 0.

    For each player i and each pair of own actions (recommended, deviation),
    the recommendation must be weakly better in expectation conditional on
    having been recommended it:
        sum over opponent actions of p(own, opp) * [u_i(own, opp) - u_i(dev, opp)] >= 0
    Negated here because linprog takes <= constraints.
    """
    rows = []
    for own, dev in (("C", "D"), ("D", "C")):
        row = [0.0] * len(PROFILES)
        for i, profile in enumerate(PROFILES):
            if profile[0] == own:  # player 1's own action is the first character
                row[i] = -(payoffs.payoff(profile, 0) - payoffs.payoff(dev + profile[1], 0))
        rows.append(row)
    for own, dev in (("C", "D"), ("D", "C")):
        row = [0.0] * len(PROFILES)
        for i, profile in enumerate(PROFILES):
            if profile[1] == own:  # player 2's own action is the second character
                row[i] = -(payoffs.payoff(profile, 1) - payoffs.payoff(profile[0] + dev, 1))
        rows.append(row)
    return rows


def is_correlated_equilibrium(dist: dict[str, float], payoffs: PayoffMatrix, tol: float = 1e-9) -> bool:
    """
    Check a specific joint distribution directly against Aumann's
    constraints. Deliberately independent of the LP below, so the LP's
    answers can be verified against a hand-computed distribution rather
    than only against itself.
    """
    vector = np.array([dist.get(k, 0.0) for k in PROFILES], dtype=float)
    if vector.min() < -tol or abs(vector.sum() - 1.0) > 1e-8:
        return False
    return bool((np.array(_obedience_constraints(payoffs)) @ vector <= tol).all())


def correlated_equilibrium(payoffs: PayoffMatrix = CANONICAL_PD) -> dict:
    """
    Reference point 2, and the one that actually matters — a shared
    correlating signal is a purely classical device, so any claim that
    entanglement helps has to clear this bar rather than the Nash bar.

    Returns the welfare-maximising correlated equilibrium, the range of
    total welfare across the whole correlated-equilibrium polytope, and
    the per-profile probability range. When every profile's probability
    range is a single point, the correlated set is the singleton reported
    in `unique_profile` — which is what happens in a strict PD, where a
    strictly dominated action gets zero weight in every correlated
    equilibrium and the polytope collapses onto the Nash point.
    """
    a_ub = _obedience_constraints(payoffs)
    b_ub = [0.0] * len(a_ub)
    a_eq = [[1.0] * len(PROFILES)]
    bounds = [(0.0, 1.0)] * len(PROFILES)
    welfare = [payoffs.payoff(k, 0) + payoffs.payoff(k, 1) for k in PROFILES]

    def _solve(objective: list[float]) -> tuple[np.ndarray, float]:
        res = linprog(objective, A_ub=a_ub, b_ub=b_ub, A_eq=a_eq, b_eq=[1.0], bounds=bounds)
        if not res.success:  # pragma: no cover — the CE polytope is never empty (Nash is in it)
            raise RuntimeError(f"correlated-equilibrium LP failed: {res.message}")
        return res.x, float(res.fun)

    best_x, neg_max = _solve([-w for w in welfare])
    _, min_welfare = _solve(welfare)

    ranges = {}
    for i, profile in enumerate(PROFILES):
        objective = [0.0] * len(PROFILES)
        objective[i] = -1.0
        _, neg_hi = _solve(objective)
        objective[i] = 1.0
        _, lo = _solve(objective)
        ranges[profile] = (round(lo, 9) + 0.0, round(-neg_hi, 9) + 0.0)  # + 0.0 normalises LP -0.0

    dist = {profile: round(float(best_x[i]), 9) + 0.0 for i, profile in enumerate(PROFILES)}
    singleton = all(abs(hi - lo) < 1e-7 for lo, hi in ranges.values())
    unique_profile = None
    if singleton:
        pinned = [p for p, v in dist.items() if v > 1.0 - 1e-7]
        unique_profile = pinned[0] if pinned else None

    return {
        "welfare_maximising_distribution": dist,
        "expected_payoffs": _expected_payoffs(dist, payoffs),
        "welfare_range": (round(min_welfare, 9), round(-neg_max, 9)),
        "probability_ranges": ranges,
        "is_singleton": singleton,
        "unique_profile": unique_profile,
    }


def ewl_equilibria(payoffs: PayoffMatrix = CANONICAL_PD, gamma: float = MAX_ENTANGLEMENT) -> dict:
    """
    Reference point 3, re-derived rather than assumed. Builds the EWL
    bimatrix over the restricted strategy set under whatever payoffs and
    entanglement are handed in, then enumerates its pure equilibria. If
    the payoffs are not the canonical PD there is no guarantee (Q,Q)
    appears at all, which is the point of computing it.
    """
    bimatrix = restricted_game(payoffs, gamma)
    equilibria = pure_nash(bimatrix)
    return {
        "gamma": gamma,
        "strategy_set": sorted(RESTRICTED_STRATEGIES),
        "equilibria": [{"profile": f"{s1}{s2}", "payoffs": bimatrix[(s1, s2)]} for s1, s2 in equilibria],
        "bimatrix": {f"{s1}{s2}": v for (s1, s2), v in bimatrix.items()},
        "caveat": (
            "equilibrium of the RESTRICTED game over {C, D, Q} only — Benjamin & Hayden, "
            "Phys. Rev. Lett. 87, 069801 (2001); see best_response_over_su2()"
        ),
    }


def entanglement_threshold(
    payoffs: PayoffMatrix = CANONICAL_PD,
    profile: tuple[str, str] = ("Q", "Q"),
    samples: int = 721,
) -> dict:
    """
    The smallest entanglement gamma above which `profile` is a Nash
    equilibrium of the restricted game and stays one all the way to
    maximal entanglement. Scanned on a grid and then bisected within the
    bracketing interval, rather than bisected from the start, because
    nothing guarantees the property is monotone in gamma for an arbitrary
    payoff matrix — `monotone` reports whether it actually was.

    For the canonical PD this returns gamma = arcsin(sqrt(2/5)) ~ 0.6847,
    well below maximal: the deviation that binds is D against Q, whose
    payoff falls as 5*cos^2(gamma) and drops below Q's flat 3.0 there.
    """
    grid = np.linspace(0.0, MAX_ENTANGLEMENT, samples)
    holds = [profile in pure_nash(restricted_game(payoffs, float(g))) for g in grid]

    if not holds[-1]:
        return {"threshold": None, "holds_at_maximal": False, "monotone": None}

    first_true = next(i for i in range(len(holds)) if all(holds[i:]))
    monotone = all(holds[i] for i in range(first_true, len(holds))) and not any(holds[:first_true])

    if first_true == 0:
        return {"threshold": 0.0, "holds_at_maximal": True, "monotone": monotone}

    lo, hi = float(grid[first_true - 1]), float(grid[first_true])
    for _ in range(60):
        mid = (lo + hi) / 2.0
        if profile in pure_nash(restricted_game(payoffs, mid)):
            hi = mid
        else:
            lo = mid
    return {"threshold": hi, "holds_at_maximal": True, "monotone": monotone}


def _su2(params: np.ndarray) -> np.ndarray:
    theta, phi, lam = params
    c, s = math.cos(theta / 2.0), math.sin(theta / 2.0)
    return np.array(
        [[np.exp(1j * phi) * c, np.exp(1j * lam) * s], [-np.exp(-1j * lam) * s, np.exp(-1j * phi) * c]],
        dtype=complex,
    )


# The closed-form counter to Q that Benjamin & Hayden's objection turns on:
# a real rotation by pi, in SU(2) but outside EWL's restricted set. Kept as a
# constant so the objection can be asserted exactly in a test rather than
# through an optimiser's numerical output.
U_COUNTER_Q = np.array([[0.0, 1.0], [-1.0, 0.0]], dtype=complex)


def best_response_over_su2(
    opponent: np.ndarray = U_Q,
    payoffs: PayoffMatrix = CANONICAL_PD,
    gamma: float = MAX_ENTANGLEMENT,
    restarts: int = 60,
    seed: int = 0,
) -> dict:
    """
    Reproduce Benjamin & Hayden's objection instead of only citing it:
    search the FULL SU(2) strategy space for player 1's best response to
    `opponent`, and compare it to the best response available inside
    EWL's restricted set. Against Q under the canonical PD this finds
    5.0 versus Q's own 3.0 — so (Q,Q) is not an equilibrium once the
    strategy space is closed, and the quantum reference point is only
    ever an equilibrium of the restricted game.
    """
    rng = np.random.default_rng(seed)

    def negative_payoff(params: np.ndarray) -> float:
        return -ewl_payoffs(_su2(params), opponent, payoffs, gamma)[0][0]

    best_value, best_params = -math.inf, None
    for _ in range(restarts):
        result = minimize(
            negative_payoff,
            rng.uniform(0.0, 2.0 * math.pi, 3),
            method="Nelder-Mead",
            options={"xatol": 1e-10, "fatol": 1e-12, "maxiter": 5000},
        )
        if -result.fun > best_value:
            best_value, best_params = -float(result.fun), result.x

    restricted_best = max(
        ewl_payoffs(u, opponent, payoffs, gamma)[0][0] for u in RESTRICTED_STRATEGIES.values()
    )
    return {
        "best_payoff_over_su2": best_value,
        "best_payoff_within_restricted_set": restricted_best,
        "restricted_set_is_closed": best_value <= restricted_best + 1e-6,
        "best_params_theta_phi_lambda": None if best_params is None else [float(x) for x in best_params],
    }


def is_prisoners_dilemma(payoffs: PayoffMatrix, tol: float = 1e-9) -> dict:
    """
    Whether a symmetric matrix is actually a PD: T > R > P > S, and
    2R > T + S so mutual cooperation beats alternating exploitation.
    Checked rather than assumed, because a scenario dyad can be
    stipulated into chicken or a stag hunt by accident, and the three
    reference points mean different things in those games.
    """
    r, s = payoffs.cc[0], payoffs.cd[0]
    t, p = payoffs.dc[0], payoffs.dd[0]
    symmetric = (
        abs(payoffs.cc[0] - payoffs.cc[1]) < tol
        and abs(payoffs.dd[0] - payoffs.dd[1]) < tol
        and abs(payoffs.cd[0] - payoffs.dc[1]) < tol
        and abs(payoffs.dc[0] - payoffs.cd[1]) < tol
    )
    ordering = t > r > p > s
    return {
        "is_prisoners_dilemma": bool(symmetric and ordering and 2 * r > t + s),
        "symmetric": bool(symmetric),
        "ordering_T_gt_R_gt_P_gt_S": bool(ordering),
        "mutual_cooperation_beats_alternating": bool(2 * r > t + s),
        "T_R_P_S": (t, r, p, s),
    }
