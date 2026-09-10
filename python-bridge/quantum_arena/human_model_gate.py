"""Synthetic identifiability gate for a possible human-choice model.

NOT a preregistration and NOT a participant study. This decides whether a study
would be worth running at all, by asking on synthetic data whether the parameter
that carries the quantum-cognitive claim can be recovered before any person is
recruited.

The parameter is ``delta``, the third SU(2) angle. It is the exact coordinate
separating the v1 Eisert-Wilkens-Lewenstein family (``delta = 0``) from the full
local SU(2) space that ``i*sigma_x`` inhabits, so "is human choice better
described with delta free?" is a nested question with a fixed meaning rather than
a curve-fitting contest.

BOUNDARY. Quantum cognition here means a probability model over choices. It is
not a claim about quantum processes in neurons, and the referee's quantum
hardware is not evidence about a participant. Nothing in this module touches the
frozen v1 protocol, the sealed hardware result, or any recorded human play.

The gate is built to be failable. A finding that ``delta`` is unidentifiable at
every feasible design is a legitimate and useful outcome, and is reported as
such rather than tuned away.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import itertools
import math

import numpy as np
from scipy.optimize import minimize
from scipy.special import expit

SCHEMA = "human-choice-identifiability-gate/v0.1"
ENGINEERING_ONLY = True
KET0 = np.array([1.0, 0.0], dtype=complex)


# ─────────────────────────────────────────────────────────────
# Structural observability — settled analytically before any fitting
# ─────────────────────────────────────────────────────────────

def su2(alpha: float, beta: float, delta: float) -> np.ndarray:
    """Same three-parameter family as su2_stress.su2, without its domain guards.

    The guards there reject values outside [-pi, pi]; a search needs to wander,
    and wrapping is handled by the gauge analysis instead.
    """
    cosine = math.cos(beta / 2.0)
    sine = math.sin(beta / 2.0)
    return np.array(
        [
            [np.exp(1j * alpha) * cosine, np.exp(1j * delta) * sine],
            [-np.exp(-1j * delta) * sine, np.exp(-1j * alpha) * cosine],
        ],
        dtype=complex,
    )


def choice_probability(operations: list[np.ndarray]) -> float:
    """P(choose option 0) after applying the presented considerations in order."""
    state = KET0.copy()
    for operation in operations:
        state = operation @ state
    return float(abs(state[0]) ** 2)


def structural_observability(seed: int = 0, draws: int = 20000) -> dict:
    """What the preparation, operations and measurement can and cannot see.

    Four facts, each checked numerically rather than asserted. They constrain the
    task design more than any modelling choice does.
    """
    rng = np.random.default_rng(seed)

    # 1. A single operation from |0> measured in the computational basis exposes
    #    beta alone: P(0) = cos^2(beta/2). alpha and delta cancel in the modulus.
    single = []
    for _ in range(draws // 100):
        beta = rng.uniform(0, math.pi)
        values = {
            choice_probability([su2(alpha, beta, delta)])
            for alpha in rng.uniform(-math.pi, math.pi, 4)
            for delta in rng.uniform(-math.pi, math.pi, 4)
        }
        single.append(max(values) - min(values))
    single_spread = float(max(single))

    # 2. Gauge: conjugating every operation by diag(e^{i chi}, e^{-i chi}) shifts
    #    every delta by 2*chi and leaves |0>, the measurement and hence every
    #    prediction untouched. Only DIFFERENCES of delta are observable.
    gauge = []
    for _ in range(draws // 100):
        a1, a2 = rng.uniform(-math.pi, math.pi, 2)
        b1, b2 = rng.uniform(0, math.pi, 2)
        d1, d2 = rng.uniform(-math.pi, math.pi, 2)
        chi = rng.uniform(-math.pi, math.pi)
        base = choice_probability([su2(a2, b2, d2), su2(a1, b1, d1)])
        shifted = choice_probability([su2(a2, b2, d2 + 2 * chi), su2(a1, b1, d1 + 2 * chi)])
        gauge.append(abs(base - shifted))
    gauge_spread = float(max(gauge))

    # 3. With delta held at zero for both considerations the order effect is
    #    zero to machine precision — max 2e-16 across 20,000 draws, against a
    #    ~0.16 mean gap when delta is free. This is the sharp point prediction of
    #    the nested null; the residual is one ULP and is platform-dependent.
    null_gaps = []
    for _ in range(draws):
        a1, a2 = rng.uniform(-math.pi, math.pi, 2)
        b1, b2 = rng.uniform(0, math.pi, 2)
        first, second = su2(a1, b1, 0.0), su2(a2, b2, 0.0)
        null_gaps.append(abs(choice_probability([second, first]) - choice_probability([first, second])))
    null_gap = float(max(null_gaps))

    # 4. With a delta difference the order effect is generically non-zero.
    free_gaps = []
    for _ in range(draws):
        a1, a2 = rng.uniform(-math.pi, math.pi, 2)
        b1, b2 = rng.uniform(0, math.pi, 2)
        difference = rng.uniform(-math.pi, math.pi)
        first, second = su2(a1, b1, 0.0), su2(a2, b2, difference)
        free_gaps.append(abs(choice_probability([second, first]) - choice_probability([first, second])))
    free_gaps = np.array(free_gaps)

    # 5. Discrete gauge: delta and -delta give identical predictions. Found by the
    #    gate itself, not by the analysis above — the recovery error was bimodal
    #    with a mode near 2|delta|, which is the signature of a sign reflection.
    sign_gaps = []
    for _ in range(draws // 100):
        betas = rng.uniform(0.4, math.pi - 0.4, size=(3, 3))
        value = rng.uniform(-math.pi, math.pi)
        sign_gaps.append(float(np.max(np.abs(
            quantum_probabilities(betas, value) - quantum_probabilities(betas, -value)))))
    sign_spread = float(max(sign_gaps))

    return {
        "delta_is_identified_only_up_to_sign": {
            "max_probability_difference_under_reflection": sign_spread,
            "holds": sign_spread < 1e-12,
            "consequence": (
                "The estimand is |delta|, not delta. Scoring a fit against a signed target "
                "produces a bimodal error with a spurious mode near 2|delta| and will make a "
                "working design look broken."
            ),
        },
        "single_operation_hides_alpha_and_delta": {
            "max_probability_spread": single_spread,
            "holds": single_spread < 1e-12,
            "consequence": "A one-consideration task cannot identify delta at any sample size.",
        },
        "delta_is_observable_only_as_a_difference": {
            "max_probability_shift_under_gauge": gauge_spread,
            "holds": gauge_spread < 1e-12,
            "consequence": (
                "Individual delta values are gauge, not parameters. The model must be "
                "written with one delta fixed at zero and the other free, or the fit will "
                "wander a flat direction and report a confident meaningless value."
            ),
        },
        "null_predicts_exactly_zero_order_effect": {
            "max_order_gap_at_delta_zero": null_gap,
            "holds": null_gap < 1e-12,
            "consequence": (
                "The nested null makes a point prediction, not a small one. Any reliably "
                "non-zero order effect falsifies delta = 0 without needing a fitted comparison."
            ),
        },
        "free_delta_generically_produces_an_order_effect": {
            "mean_order_gap": float(free_gaps.mean()),
            "max_order_gap": float(free_gaps.max()),
            "fraction_above_0_05": float((free_gaps > 0.05).mean()),
            "consequence": (
                "The order effect IS delta's observable signature. It follows that a design "
                "with no order manipulation cannot identify delta, and that a design showing "
                "no order effect leaves delta unidentified rather than estimated at zero."
            ),
        },
    }


# ─────────────────────────────────────────────────────────────
# Task design — forced by the observability facts above
# ─────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class TaskDesign:
    """Triples of considerations, every ordering presented.

    The six nominal orderings collapse to two distinct predictions under the
    shipped shared-delta restriction.  Consequently triples do not escape the
    saturation problem that motivated them: the generic Jacobian rank is 2T
    against 3T+1 free parameters.
    """

    triples: int = 4
    trials_per_ordering: int = 8
    participants: int = 60

    @property
    def orderings(self) -> int:
        return 6

    @property
    def conditions(self) -> int:
        return self.triples * self.orderings

    @property
    def free_parameters(self) -> int:
        return 3 * self.triples + 1  # per-consideration strengths, one shared delta

    @property
    def trials_per_participant(self) -> int:
        return self.conditions * self.trials_per_ordering

    def is_identifiable_in_principle(self) -> bool:
        """Whether the effective Jacobian rank reaches the free-parameter count.

        Nominal condition counting is insufficient here: six orderings contain
        only two independent prediction directions per triple.  Thus the
        effective Jacobian has at most 2T rows against 3T+1 free parameters, so
        the shipped shared-delta model is structurally non-identifiable.
        """
        return quantum_jacobian_rank(self.triples) == self.free_parameters


def _orderings() -> list[tuple[int, int, int]]:
    return list(itertools.permutations(range(3)))


def quantum_probabilities(betas: np.ndarray, delta: float) -> np.ndarray:
    """P(option 0) for every ordering of every triple.

    ``betas`` has shape (triples, 3). Gauge is fixed by giving consideration 0 a
    delta of zero; the shared free ``delta`` is carried by considerations 1 and 2.
    """
    betas = np.atleast_2d(betas)
    deltas = (0.0, delta, delta)
    out = np.empty((len(betas), 6))
    for triple_index, triple in enumerate(betas):
        for order_index, order in enumerate(_orderings()):
            operations = [su2(0.0, triple[i], deltas[i]) for i in order]
            out[triple_index, order_index] = choice_probability(list(reversed(operations)))
    return out


def quantum_two_observables(betas: np.ndarray, delta: float) -> np.ndarray:
    """Analytic reduction of each triple to its two distinct probabilities.

    Column 0 is the probability when consideration 0 is at either end; column 1
    is the probability when it is in the middle.  The reduction is exact for the
    substantive ``deltas=(0, delta, delta)`` restriction, not for independently
    varying deltas.
    """
    betas = np.atleast_2d(betas)
    x = betas[:, 0] / 2.0
    u = betas[:, 1] / 2.0
    v = betas[:, 2] / 2.0
    y = u + v
    common = (np.cos(x) * np.cos(y) - np.sin(x) * np.sin(y) * np.cos(delta)) ** 2
    scale = np.sin(x) ** 2 * np.sin(delta) ** 2
    end = common + scale * np.sin(y) ** 2
    middle = common + scale * np.sin(u - v) ** 2
    return np.column_stack((end, middle))


def quantum_two_observable_jacobian(betas: np.ndarray, delta: float) -> np.ndarray:
    """Analytic Jacobian of :func:`quantum_two_observables`.

    Columns are the flattened beta values followed by the shared ``delta``.
    Using the closed-form reduction avoids manufacturing small nonzero singular
    values at the finite-difference roundoff floor.
    """
    betas = np.atleast_2d(np.asarray(betas, dtype=float))
    triples = len(betas)
    jacobian = np.zeros((2 * triples, 3 * triples + 1))

    sine_delta = math.sin(delta)
    cosine_delta = math.cos(delta)
    for triple_index, (beta0, beta1, beta2) in enumerate(betas):
        x, u, v = beta0 / 2.0, beta1 / 2.0, beta2 / 2.0
        y, z = u + v, u - v
        sine_x, cosine_x = math.sin(x), math.cos(x)
        sine_y, cosine_y = math.sin(y), math.cos(y)
        sine_z, cosine_z = math.sin(z), math.cos(z)

        amplitude = (
            cosine_x * cosine_y
            - sine_x * sine_y * cosine_delta
        )
        scale = sine_x ** 2 * sine_delta ** 2

        amplitude_x = -sine_x * cosine_y - cosine_x * sine_y * cosine_delta
        amplitude_y = -cosine_x * sine_y - sine_x * cosine_y * cosine_delta
        amplitude_delta = sine_x * sine_y * sine_delta
        scale_x = 2.0 * sine_x * cosine_x * sine_delta ** 2
        scale_delta = 2.0 * sine_x ** 2 * sine_delta * cosine_delta

        end_factor = sine_y ** 2
        middle_factor = sine_z ** 2
        end_factor_y = 2.0 * sine_y * cosine_y
        middle_factor_z = 2.0 * sine_z * cosine_z

        row_end = 2 * triple_index
        row_middle = row_end + 1
        beta_column = 3 * triple_index

        # x, u and v are half-angles, hence the factor 0.5 in beta derivatives.
        jacobian[row_end, beta_column] = 0.5 * (
            2.0 * amplitude * amplitude_x + scale_x * end_factor
        )
        jacobian[row_middle, beta_column] = 0.5 * (
            2.0 * amplitude * amplitude_x + scale_x * middle_factor
        )
        jacobian[row_end, beta_column + 1] = 0.5 * (
            2.0 * amplitude * amplitude_y + scale * end_factor_y
        )
        jacobian[row_end, beta_column + 2] = jacobian[row_end, beta_column + 1]
        jacobian[row_middle, beta_column + 1] = 0.5 * (
            2.0 * amplitude * amplitude_y + scale * middle_factor_z
        )
        jacobian[row_middle, beta_column + 2] = 0.5 * (
            2.0 * amplitude * amplitude_y - scale * middle_factor_z
        )
        jacobian[row_end, -1] = (
            2.0 * amplitude * amplitude_delta + scale_delta * end_factor
        )
        jacobian[row_middle, -1] = (
            2.0 * amplitude * amplitude_delta + scale_delta * middle_factor
        )

    return jacobian


def quantum_jacobian_rank(triples: int) -> int:
    """Generic local rank of the shipped quantum prediction map.

    This is a deterministic analytic diagnostic at an interior, nonsymmetric
    point. Comparing this effective rank with the free-parameter count diagnoses
    local identifiability without a finite-difference step or a hand-tuned
    absolute tolerance.  For T triples, rank is bounded by 2T while the model
    has 3T+1 free parameters.
    """
    betas = np.linspace(0.61, 2.41, 3 * triples)
    jacobian = quantum_two_observable_jacobian(betas.reshape(triples, 3), 0.83)
    return int(np.linalg.matrix_rank(jacobian))


def markov_probabilities(rates: np.ndarray, asymmetry: float = 0.9) -> np.ndarray:
    """Matched-parameter classical competitor.

    Each consideration is a 2-state stochastic update rather than a unitary.

    The transition matrices must be ASYMMETRIC. A symmetric doubly-stochastic
    2x2 matrix commutes with every other one, so a model built from those cannot
    produce an order effect at all and would be a strawman dressed as a rival —
    it would lose to the quantum model by construction rather than on evidence.
    A shared ``asymmetry`` offset breaks that commutation while keeping the
    parameter count matched to the quantum model: one per consideration, plus
    one shared, exactly as the quantum model has one beta per consideration plus
    one shared delta.
    """
    rates = np.atleast_2d(rates)
    out = np.empty((len(rates), 6))
    for triple_index, triple in enumerate(rates):
        matrices = []
        for value in triple:
            stay_from_zero = float(expit(value))
            stay_from_one = float(expit(value + asymmetry))
            matrices.append(np.array([
                [stay_from_zero, 1.0 - stay_from_one],
                [1.0 - stay_from_zero, stay_from_one],
            ]))
        for order_index, order in enumerate(_orderings()):
            state = np.array([1.0, 0.0])
            for i in order:
                state = matrices[i] @ state
            out[triple_index, order_index] = float(state[0])
    return out


def logistic_probabilities(weights: np.ndarray) -> np.ndarray:
    """Order as an additive covariate — the plain classical account.

    One intercept per triple plus one shared position weight per slot. It can
    represent 'being shown a consideration last matters', but not the
    non-commutative structure the quantum model claims.
    """
    weights = np.atleast_1d(weights)
    triples = len(weights) - 3
    intercepts = weights[:triples]
    positions = weights[triples:]
    out = np.empty((triples, 6))
    for triple_index in range(triples):
        for order_index, order in enumerate(_orderings()):
            score = intercepts[triple_index] + sum(positions[slot] * order[slot] for slot in range(3))
            out[triple_index, order_index] = float(expit(score))
    return out


# ─────────────────────────────────────────────────────────────
# Synthetic data, blind fitting, and the metrics the gate turns on
# ─────────────────────────────────────────────────────────────

@dataclass
class SyntheticDataset:
    successes: np.ndarray          # (triples, 6) counts of option 0
    trials: np.ndarray             # (triples, 6) counts of trials
    generating_model: str          # withheld from every fitter
    generating_delta: float


def generate(design: TaskDesign, delta: float, seed: int, model: str = "quantum") -> SyntheticDataset:
    rng = np.random.default_rng(seed)
    betas = rng.uniform(0.4, math.pi - 0.4, size=(design.triples, 3))
    if model == "quantum":
        probabilities = quantum_probabilities(betas, delta)
    elif model == "markov":
        probabilities = markov_probabilities(rng.uniform(-1.5, 1.5, size=(design.triples, 3)),
                                             asymmetry=float(rng.uniform(0.5, 1.5)))
    else:
        raise ValueError(f"unknown generating model {model!r}")
    trials = np.full((design.triples, 6), design.participants * design.trials_per_ordering)
    successes = rng.binomial(trials, np.clip(probabilities, 1e-9, 1 - 1e-9))
    return SyntheticDataset(successes, trials, model, delta)


def _negative_log_likelihood(probabilities: np.ndarray, data: SyntheticDataset) -> float:
    p = np.clip(probabilities, 1e-12, 1 - 1e-12)
    return float(-(data.successes * np.log(p) + (data.trials - data.successes) * np.log(1 - p)).sum())


def _fit(objective, x0_sampler, restarts: int, seed: int) -> tuple[np.ndarray, float]:
    rng = np.random.default_rng(seed)
    best_x, best_value = None, math.inf
    for _ in range(restarts):
        result = minimize(objective, x0_sampler(rng), method="Nelder-Mead",
                          options={"maxiter": 20000, "xatol": 1e-8, "fatol": 1e-10})
        if result.fun < best_value:
            best_x, best_value = result.x, float(result.fun)
    return best_x, best_value


def fit_quantum(data: SyntheticDataset, triples: int, delta_free: bool, restarts: int = 12,
                seed: int = 0) -> dict:
    def objective(vector):
        betas = vector[: 3 * triples].reshape(triples, 3)
        delta = vector[3 * triples] if delta_free else 0.0
        return _negative_log_likelihood(quantum_probabilities(betas, delta), data)

    size = 3 * triples + (1 if delta_free else 0)

    def sampler(rng):
        start = rng.uniform(0.3, math.pi - 0.3, size=size)
        if delta_free:
            start[-1] = rng.uniform(-math.pi, math.pi)
        return start

    x, value = _fit(objective, sampler, restarts, seed)
    return {
        "parameters": x,
        "negative_log_likelihood": value,
        "delta": float(x[3 * triples]) if delta_free else 0.0,
        "free_parameters": size,
    }


def fit_markov(data: SyntheticDataset, triples: int, restarts: int = 12, seed: int = 0) -> dict:
    """Parameter-matched to the quantum model: 3*triples rates plus one shared asymmetry."""

    def objective(vector):
        return _negative_log_likelihood(
            markov_probabilities(vector[: 3 * triples].reshape(triples, 3), vector[3 * triples]), data)

    def sampler(rng):
        start = rng.uniform(-2, 2, size=3 * triples + 1)
        start[-1] = rng.uniform(-2, 2)
        return start

    x, value = _fit(objective, sampler, restarts, seed)
    return {"parameters": x, "negative_log_likelihood": value, "free_parameters": 3 * triples + 1}


def fit_logistic(data: SyntheticDataset, triples: int, restarts: int = 12, seed: int = 0) -> dict:
    def objective(vector):
        return _negative_log_likelihood(logistic_probabilities(vector), data)

    x, value = _fit(objective, lambda rng: rng.uniform(-2, 2, size=triples + 3), restarts, seed)
    return {"parameters": x, "negative_log_likelihood": value, "free_parameters": triples + 3}


def profile_likelihood(data: SyntheticDataset, triples: int, grid: np.ndarray,
                       restarts: int = 4, seed: int = 0) -> list[dict]:
    """Negative log-likelihood as a function of delta, everything else refitted.

    A flat profile means delta is unidentified whatever the point estimate says.
    This is the check the repository's earlier envelope diagnostic lacked.
    """
    profile = []
    for value in grid:
        def objective(vector, fixed=value):
            return _negative_log_likelihood(
                quantum_probabilities(vector.reshape(triples, 3), fixed), data)

        _, nll = _fit(objective, lambda rng: rng.uniform(0.3, math.pi - 0.3, size=3 * triples),
                      restarts, seed)
        profile.append({"delta": float(value), "negative_log_likelihood": nll})
    return profile


def held_out_log_loss(probabilities: np.ndarray, data: SyntheticDataset) -> float:
    p = np.clip(probabilities, 1e-12, 1 - 1e-12)
    total = data.trials.sum()
    return float(-(data.successes * np.log(p) + (data.trials - data.successes) * np.log(1 - p)).sum() / total)


# ─────────────────────────────────────────────────────────────
# The gate
# ─────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────
# MEASURED OUTCOME, 2026-09-10 — recorded here so it is not rediscovered
#
# The gate FAILS delta recovery at every design tested, and the cause is the
# design, not the fitter. Three pieces of evidence:
#
#   1. More restarts do not help. On identical data, worst |delta| error was
#      unchanged from 4 to 48 restarts on four of six seeds, and on two seeds it
#      got WORSE — the search found a better likelihood at a delta further from
#      the truth. An underpowered optimiser cannot do that.
#
#   2. The six nominal orderings reduce exactly to two probabilities per triple,
#      so the generic Jacobian rank is 2T against 3T+1 parameters.  At delta=0
#      or pi, and at other special beta values, the rank is lower still.
#
#   3. delta <-> pi-delta IS an exact symmetry after refitting beta, but that
#      reflection does not determine the endpoints of the identified set.  The
#      feasible set depends on the observed probability pair and nuisance betas;
#      it is generically non-singleton even when the truth is pi/2.
#
# SWEEP, 2026-09-10 — the question "does any feasible design work?" is now
# answered, and the answer is no. Recovery error against participant count:
#
#     10 participants x  48 trials -> 1.9012 rad
#     30 participants x  96 trials -> 1.9058 rad
#     60 participants x 192 trials -> 1.7933 rad
#    200 participants x 192 trials -> 1.8491 rad
#    500 participants x 384 trials -> 1.8474 rad
#
# Flat across a 50-fold increase in participants. Sampling noise would fall as
# 1/sqrt(N). Over the same range the true-positive rate climbs 0.00 -> 0.50 ->
# 1.00 while false positives stay at 0.00, so detection improves with data
# exactly as expected and estimation does not improve at all.
# Artifact: preregistrations/human-model-gate/design-sweep-2026-09-10.json
#
# CONSEQUENCE, and it is a useful one rather than a dead end: delta is
# DETECTABLE but not ESTIMABLE under this design. Discrimination is perfect
# (false positives 0.000, true positives 1.000, profile drop ~900 nll), so the
# question "is delta zero?" is answerable. The question "what is delta?" is not.
#
# A study may therefore be built on the delta = 0 versus delta != 0 contrast —
# which is exactly the order-effect test, since delta = 0 predicts an order gap
# of identically zero. A study reporting a delta ESTIMATE may not.
# ─────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class GateThresholds:
    """Declared before running. Changing these to obtain a pass is the failure
    mode this whole module exists to prevent, so they live in one place where a
    diff makes such a change visible."""

    max_delta_recovery_error: float = 0.25       # radians
    max_false_positive_rate: float = 0.10        # selecting free-delta when delta = 0
    min_true_positive_rate: float = 0.80         # selecting free-delta when delta != 0
    min_profile_drop: float = 10.0               # nll units between delta=0 and the optimum
    min_markov_separation: float = 0.0           # quantum must not lose to Markov on its own data


def _select_model(data: SyntheticDataset, triples: int, restarts: int, seed: int) -> dict:
    """Blind model selection. The fitters never see `generating_model`."""
    free = fit_quantum(data, triples, True, restarts, seed)
    null = fit_quantum(data, triples, False, restarts, seed)
    markov = fit_markov(data, triples, restarts, seed)
    logistic = fit_logistic(data, triples, restarts, seed)

    def bic(fit):
        return 2 * fit["negative_log_likelihood"] + fit["free_parameters"] * math.log(data.trials.sum())

    scores = {
        "quantum_delta_free": bic(free),
        "quantum_delta_zero": bic(null),
        "markov": bic(markov),
        "logistic": bic(logistic),
    }
    return {
        "selected": min(scores, key=scores.get),
        "bic": scores,
        "delta_hat": free["delta"],
        "nll": {
            "quantum_delta_free": free["negative_log_likelihood"],
            "quantum_delta_zero": null["negative_log_likelihood"],
            "markov": markov["negative_log_likelihood"],
            "logistic": logistic["negative_log_likelihood"],
        },
    }


def run_gate(design: TaskDesign, replicates: int = 8, restarts: int = 6, seed: int = 0,
             thresholds: GateThresholds | None = None,
             true_deltas: tuple[float, ...] = (0.6, 1.1)) -> dict:
    """Generate, fit blind, and decide whether this design could support a study."""
    thresholds = thresholds or GateThresholds()
    confusion: dict[str, dict[str, int]] = {}
    recovery_errors: list[float] = []
    false_positives = 0
    true_positives = 0
    null_runs = 0
    signal_runs = 0

    def record(truth: str, selected: str) -> None:
        confusion.setdefault(truth, {}).setdefault(selected, 0)
        confusion[truth][selected] += 1

    for replicate in range(replicates):
        # delta = 0 — the nested null. Selecting the free model here is a false positive.
        null_data = generate(design, 0.0, seed + 1000 + replicate)
        null_choice = _select_model(null_data, design.triples, restarts, seed + replicate)
        record("quantum_delta_zero", null_choice["selected"])
        null_runs += 1
        if null_choice["selected"] == "quantum_delta_free":
            false_positives += 1

        # delta != 0 — the signal case.
        for true_delta in true_deltas:
            data = generate(design, true_delta, seed + 2000 + replicate * 10 + int(true_delta * 10))
            choice = _select_model(data, design.triples, restarts, seed + replicate)
            record("quantum_delta_free", choice["selected"])
            signal_runs += 1
            if choice["selected"] == "quantum_delta_free":
                true_positives += 1
            # |delta| is the identified quantity; delta and -delta are the same model.
            recovery_errors.append(abs(abs(_wrap(choice["delta_hat"])) - abs(true_delta)))

        # Markov-generated data. A quantum model winning here is a different
        # failure: the formalism claiming credit for classical structure.
        markov_data = generate(design, 0.0, seed + 3000 + replicate, model="markov")
        record("markov", _select_model(markov_data, design.triples, restarts, seed + replicate)["selected"])

    # Profile likelihood on one representative signal dataset.
    probe = generate(design, true_deltas[-1], seed + 77)
    grid = np.linspace(0.0, math.pi, 13)  # half-domain: the profile is symmetric in delta
    profile = profile_likelihood(probe, design.triples, grid, restarts=3, seed=seed)
    best = min(entry["negative_log_likelihood"] for entry in profile)
    at_zero = min(entry["negative_log_likelihood"] for entry in profile if entry["delta"] < 0.3)
    profile_drop = at_zero - best

    false_positive_rate = false_positives / null_runs
    true_positive_rate = true_positives / signal_runs
    worst_recovery = max(recovery_errors) if recovery_errors else math.inf

    checks = {
        "identifiable_in_principle": design.is_identifiable_in_principle(),
        "delta_recovered": worst_recovery <= thresholds.max_delta_recovery_error,
        # Reported separately because they can and do diverge: the design answers
        # "is delta zero?" while failing to answer "what is delta?".
        "delta_detectable": (false_positives / null_runs <= thresholds.max_false_positive_rate
                             and true_positives / signal_runs >= thresholds.min_true_positive_rate),
        "false_positive_rate_acceptable": false_positive_rate <= thresholds.max_false_positive_rate,
        "true_positive_rate_acceptable": true_positive_rate >= thresholds.min_true_positive_rate,
        "profile_is_not_flat": profile_drop >= thresholds.min_profile_drop,
    }
    return {
        "schema": SCHEMA,
        "engineering_only": ENGINEERING_ONLY,
        "preregistration": False,
        "design": {
            "triples": design.triples,
            "participants": design.participants,
            "trials_per_ordering": design.trials_per_ordering,
            "trials_per_participant": design.trials_per_participant,
            "conditions": design.conditions,
            "free_parameters": design.free_parameters,
        },
        "thresholds": thresholds.__dict__,
        "delta_recovery": {
            "worst_absolute_error": worst_recovery,
            "median_absolute_error": float(np.median(recovery_errors)) if recovery_errors else None,
        },
        "profile_likelihood": {"grid": profile, "drop_from_delta_zero_to_optimum": profile_drop},
        "confusion": confusion,
        "false_positive_rate": false_positive_rate,
        "true_positive_rate": true_positive_rate,
        "checks": checks,
        "passed": all(checks.values()),
        "estimation_verdict": (
            "delta ESTIMABLE" if worst_recovery <= thresholds.max_delta_recovery_error
            else "delta NOT estimable — the prediction map is rank-deficient; report no delta point estimate"
        ),
        "detection_verdict": (
            "delta DETECTABLE — the zero versus non-zero contrast is answerable"
            if checks["delta_detectable"] else
            "delta not even detectable — this design supports no delta claim at all"
        ),
        "interpretation": (
            "A pass means the design could in principle distinguish delta = 0 from delta != 0 "
            "on synthetic data. It says nothing about whether human choices behave this way, "
            "and is not permission to collect."
        ),
    }


def _wrap(value: float) -> float:
    return (value + math.pi) % (2 * math.pi) - math.pi


def noiseless_limit_recovery(triples: int = 4, seed: int = 2020, restarts: int = 20,
                            true_deltas: tuple[float, ...] = (0.4, 0.8, 1.1, 1.5, 2.0),
                            trials_per_cell: float = 1e7) -> dict:
    """Can delta be recovered with NO sampling noise at all?

    Feeds the fitter expected counts rather than binomial draws, which is the
    infinite-data limit. This separates two explanations the design sweep cannot:
    a parameter that merely needs more participants, and one that no amount of
    data recovers.

    If recovery fails here, no sample size succeeds. That is a stronger statement
    than any sweep can make, and it is cheap — no simulation of participants is
    involved.
    """
    rng = np.random.default_rng(seed)
    betas = rng.uniform(0.4, math.pi - 0.4, size=(triples, 3))
    rows = []
    for true_delta in true_deltas:
        probabilities = quantum_probabilities(betas, true_delta)
        trials = np.full((triples, 6), float(trials_per_cell))
        data = SyntheticDataset(probabilities * trials, trials, "quantum", true_delta)
        fit = fit_quantum(data, triples, delta_free=True, restarts=restarts, seed=1)
        estimate = abs(_wrap(fit["delta"]))
        rows.append({
            "true_delta": float(true_delta),
            "fitted_absolute_delta": float(estimate),
            "absolute_error": float(abs(estimate - true_delta)),
        })
    errors = [row["absolute_error"] for row in rows]
    estimates = [row["fitted_absolute_delta"] for row in rows]
    return {
        "schema": SCHEMA,
        "engineering_only": ENGINEERING_ONLY,
        "trials_per_cell": float(trials_per_cell),
        "rows": rows,
        "worst_absolute_error": float(max(errors)),
        "estimate_range": [float(min(estimates)), float(max(estimates))],
        "reading": (
            "Recovery fails at infinite data because the shared-delta prediction map has "
            "generic Jacobian rank 2T against 3T+1 parameters. Small point-estimate errors "
            "at selected true values do not establish recovery: an optimizer chooses one "
            "representative from a data-dependent feasible set. The slope of those chosen "
            "representatives is not an identifiability diagnostic."
        ),
    }


def tracking_slope(triples: int = 4, seed: int = 2020, restarts: int = 6,
                   true_deltas: tuple[float, ...] = (0.2, 0.5, 0.8, 1.1, 1.4, 1.7, 2.0, 2.3, 2.6, 2.9),
                   trials_per_cell: float = 1e7,
                   tracking_threshold: float = 1.1) -> dict:
    """Historical point-estimate diagnostic retained to reproduce the artifact.

    Small recovery error at one or two values proves nothing on its own: an
    estimator with a fixed output band produces small error wherever the truth
    happens to fall inside that band. The discriminating question is whether the
    estimate MOVES with the truth.

    The slope does not diagnose identification.  In a structurally nonidentified
    model, the feasible set can move with truth and an optimizer-selected member
    can therefore have a positive slope even though no unique delta is recovered.
    """
    rng = np.random.default_rng(seed)
    betas = rng.uniform(0.4, math.pi - 0.4, size=(triples, 3))
    rows = []
    for true_delta in true_deltas:
        probabilities = quantum_probabilities(betas, true_delta)
        trials = np.full((triples, 6), float(trials_per_cell))
        data = SyntheticDataset(probabilities * trials, trials, "quantum", true_delta)
        fit = fit_quantum(data, triples, delta_free=True, restarts=restarts, seed=1)
        estimate = abs(_wrap(fit["delta"]))
        rows.append({
            "true_delta": float(true_delta),
            "fitted_absolute_delta": float(estimate),
            "absolute_error": float(abs(estimate - true_delta)),
        })

    truth = np.array([row["true_delta"] for row in rows])
    fitted = np.array([row["fitted_absolute_delta"] for row in rows])
    upper = truth >= tracking_threshold
    slope_all = float(np.polyfit(truth, fitted, 1)[0])
    slope_upper = float(np.polyfit(truth[upper], fitted[upper], 1)[0])
    return {
        "schema": SCHEMA,
        "engineering_only": ENGINEERING_ONLY,
        "trials_per_cell": float(trials_per_cell),
        "tracking_threshold": float(tracking_threshold),
        "rows": rows,
        "slope_overall": slope_all,
        "correlation_overall": float(np.corrcoef(truth, fitted)[0, 1]),
        "slope_above_threshold": slope_upper,
        "correlation_above_threshold": float(np.corrcoef(truth[upper], fitted[upper])[0, 1]),
        "points_above_threshold": int(upper.sum()),
        "estimate_range": [float(fitted.min()), float(fitted.max())],
        "identified_slope_would_be": 1.0,
        "reading": (
            "These slopes describe which representatives the optimizer selected from "
            "data-dependent feasible sets. A positive slope does not imply partial or "
            "attenuated identification, and the apparent threshold at 1.1 has no structural "
            "status. Use the analytic two-observable reduction and Jacobian rank instead."
        ),
    }


def sweep_designs(configurations: tuple[tuple[int, int], ...] = ((10, 2), (30, 4), (60, 8)),
                  triples: int = 4, replicates: int = 4, restarts: int = 4, seed: int = 0) -> dict:
    """Vary participants and trials to find whether ANY feasible design recovers delta."""
    results = []
    for participants, trials_per_ordering in configurations:
        design = TaskDesign(triples=triples, trials_per_ordering=trials_per_ordering,
                            participants=participants)
        outcome = run_gate(design, replicates=replicates, restarts=restarts, seed=seed)
        results.append({
            "participants": participants,
            "trials_per_ordering": trials_per_ordering,
            "trials_per_participant": design.trials_per_participant,
            "passed": outcome["passed"],
            "worst_delta_error": outcome["delta_recovery"]["worst_absolute_error"],
            "false_positive_rate": outcome["false_positive_rate"],
            "true_positive_rate": outcome["true_positive_rate"],
            "profile_drop": outcome["profile_likelihood"]["drop_from_delta_zero_to_optimum"],
            "checks": outcome["checks"],
        })
    passing = [r for r in results if r["passed"]]
    return {
        "schema": SCHEMA,
        "engineering_only": ENGINEERING_ONLY,
        "results": results,
        "any_feasible_design_passes": bool(passing),
        "smallest_passing_design": min(
            passing, key=lambda r: r["participants"] * r["trials_per_participant"]
        ) if passing else None,
        "verdict": (
            "At least one tested design recovers delta and discriminates the models."
            if passing else
            "No tested design recovers delta. Do not build a participant study on this model."
        ),
    }
