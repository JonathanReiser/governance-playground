"""Full-local-SU(2) stress test for the frozen Quantum Arena.

This is Axis A4 from
``preregistrations/quantum-policy-tic-tac-toe.strategy-space-stress-test-v0.1.md``.
It leaves the v1 menu, policies, payoff matrix, and entangler untouched and asks
only whether the menu candidate (Q,Q) remains an equilibrium when either player
may choose any deterministic local SU(2) operation.

The output is an engineering record, not a preregistered experiment or evidence
of quantum cognition/advantage. A single explicit profitable deviation is enough
to falsify equilibrium in the enlarged space; no global-optimum claim is needed.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import math

import numpy as np
from scipy.optimize import differential_evolution, minimize
from scipy.stats import qmc

from .payoffs import BIMATRIX, expected_payoffs
from .protocol import BASIS, MAX_ENTANGLEMENT, MENU, entangler, outcome_probabilities, unitary

SCHEMA = "quantum-arena-strategy-search/v0.1"
STAGE = "A4-one-sided"
EXPLOITABILITY_TOLERANCE = 1e-8
PARAMETER_NAMES = ("alpha", "beta", "delta")
BOUNDS = ((-math.pi, math.pi), (0.0, math.pi), (-math.pi, math.pi))


@dataclass(frozen=True)
class SearchConfig:
    """The numerical budget fixed by the v0.1 stress-test proposal."""

    seed: int = 0
    sobol_power: int = 16
    local_starts: int = 64
    differential_evolution_maxiter: int = 250
    differential_evolution_popsize: int = 15
    tolerance: float = EXPLOITABILITY_TOLERANCE

    def validate(self) -> None:
        if self.sobol_power < 1 or self.sobol_power > 22:
            raise ValueError("sobol_power must be between 1 and 22")
        if self.local_starts < 1:
            raise ValueError("local_starts must be positive")
        if self.differential_evolution_maxiter < 1:
            raise ValueError("differential_evolution_maxiter must be positive")
        if self.differential_evolution_popsize < 1:
            raise ValueError("differential_evolution_popsize must be positive")
        if not 0 < self.tolerance < 1:
            raise ValueError("tolerance must lie between 0 and 1")


def su2(alpha: float, beta: float, delta: float) -> np.ndarray:
    """The three-parameter local SU(2) family specified for stage A4.

    Implemented independently of protocol.unitary(). The v1 EWL family is the
    slice ``su2(phi, theta, 0)`` and is checked against that helper in tests.
    """

    if not all(math.isfinite(value) for value in (alpha, beta, delta)):
        raise ValueError("SU(2) parameters must be finite")
    if not -math.pi - 1e-12 <= alpha <= math.pi + 1e-12:
        raise ValueError("alpha must lie in [-pi, pi]")
    if not 0.0 <= beta <= math.pi + 1e-12:
        raise ValueError("beta must lie in [0, pi]")
    if not -math.pi - 1e-12 <= delta <= math.pi + 1e-12:
        raise ValueError("delta must lie in [-pi, pi]")

    cosine = math.cos(beta / 2.0)
    sine = math.sin(beta / 2.0)
    return np.array(
        [
            [np.exp(1j * alpha) * cosine, np.exp(1j * delta) * sine],
            [-np.exp(-1j * delta) * sine, np.exp(-1j * alpha) * cosine],
        ],
        dtype=complex,
    )


def _su2_batch(parameters: np.ndarray) -> np.ndarray:
    parameters = np.asarray(parameters, dtype=float)
    if parameters.ndim != 2 or parameters.shape[1] != 3:
        raise ValueError("parameters must have shape (n, 3)")
    alpha, beta, delta = parameters.T
    cosine = np.cos(beta / 2.0)
    sine = np.sin(beta / 2.0)
    matrices = np.empty((len(parameters), 2, 2), dtype=complex)
    matrices[:, 0, 0] = np.exp(1j * alpha) * cosine
    matrices[:, 0, 1] = np.exp(1j * delta) * sine
    matrices[:, 1, 0] = -np.exp(-1j * delta) * sine
    matrices[:, 1, 1] = np.exp(-1j * alpha) * cosine
    return matrices


Q_PARAMETERS = (math.pi / 2.0, 0.0, 0.0)
Q_OPERATION = su2(*Q_PARAMETERS)
I_SIGMA_X_PARAMETERS = (0.0, math.pi, math.pi / 2.0)
I_SIGMA_X = su2(*I_SIGMA_X_PARAMETERS)


def operation_is_su2(operation: np.ndarray, tolerance: float = 1e-12) -> bool:
    operation = np.asarray(operation, dtype=complex)
    if operation.shape != (2, 2):
        return False
    unitary_error = np.max(np.abs(operation.conj().T @ operation - np.eye(2)))
    determinant_error = abs(np.linalg.det(operation) - 1.0)
    return bool(unitary_error <= tolerance and determinant_error <= tolerance)


def probabilities_for_operations(
    operation_x: np.ndarray,
    operation_o: np.ndarray,
    gamma: float = MAX_ENTANGLEMENT,
) -> dict[str, float]:
    """Exact Born probabilities for arbitrary local operations.

    This expands only the local-operation domain. It deliberately reuses the
    frozen v1 entangler and basis ordering, while reconstructing the rest of the
    final-state calculation here so arbitrary matrices can enter it.
    """

    operation_x = np.asarray(operation_x, dtype=complex)
    operation_o = np.asarray(operation_o, dtype=complex)
    if not operation_is_su2(operation_x) or not operation_is_su2(operation_o):
        raise ValueError("both player operations must be 2x2 SU(2) matrices")
    j_matrix = entangler(gamma)
    initial = np.array([1.0, 0.0, 0.0, 0.0], dtype=complex)
    final = j_matrix.conj().T @ np.kron(operation_x, operation_o) @ j_matrix @ initial
    raw = np.abs(final) ** 2
    raw /= raw.sum()
    return {profile: float(raw[index]) for index, profile in enumerate(BASIS)}


def expected_payoffs_for_operations(
    operation_x: np.ndarray,
    operation_o: np.ndarray,
    gamma: float = MAX_ENTANGLEMENT,
) -> tuple[tuple[float, float], dict[str, float]]:
    probabilities = probabilities_for_operations(operation_x, operation_o, gamma)
    payoff_x = sum(probabilities[profile] * BIMATRIX[profile][0] for profile in BASIS)
    payoff_o = sum(probabilities[profile] * BIMATRIX[profile][1] for profile in BASIS)
    return (float(payoff_x), float(payoff_o)), probabilities


def _batch_payoffs(
    parameters: np.ndarray,
    seat: str,
    opponent: np.ndarray = Q_OPERATION,
    gamma: float = MAX_ENTANGLEMENT,
) -> np.ndarray:
    """Vectorized exact payoff evaluation for the Sobol stage."""

    if seat not in ("X", "O"):
        raise ValueError("seat must be X or O")
    operations = _su2_batch(parameters)
    j_matrix = entangler(gamma)
    entangled = (j_matrix @ np.array([1.0, 0.0, 0.0, 0.0], dtype=complex)).reshape(2, 2)
    if seat == "X":
        middle = np.einsum("nai,ij,bj->nab", operations, entangled, opponent)
        payoff_values = np.array([BIMATRIX[profile][0] for profile in BASIS])
    else:
        middle = np.einsum("ai,ij,nbj->nab", opponent, entangled, operations)
        payoff_values = np.array([BIMATRIX[profile][1] for profile in BASIS])
    final = middle.reshape(len(parameters), 4) @ j_matrix.conj()
    probabilities = np.abs(final) ** 2
    probabilities /= probabilities.sum(axis=1, keepdims=True)
    return probabilities @ payoff_values


def _scale_sobol(points: np.ndarray) -> np.ndarray:
    lower = np.array([bound[0] for bound in BOUNDS])
    upper = np.array([bound[1] for bound in BOUNDS])
    return qmc.scale(points, lower, upper)


def _matrix_json(operation: np.ndarray) -> list[list[list[float]]]:
    return [
        [[float(value.real), float(value.imag)] for value in row]
        for row in np.asarray(operation, dtype=complex)
    ]


def evaluate_deviation(
    parameters: tuple[float, float, float] | list[float] | np.ndarray,
    seat: str,
    opponent: np.ndarray = Q_OPERATION,
    gamma: float = MAX_ENTANGLEMENT,
) -> dict:
    params = np.asarray(parameters, dtype=float)
    operation = su2(*params)
    operation_x, operation_o = (operation, opponent) if seat == "X" else (opponent, operation)
    payoffs, probabilities = expected_payoffs_for_operations(operation_x, operation_o, gamma)
    return {
        "seat": seat,
        "parameters": dict(zip(PARAMETER_NAMES, (float(value) for value in params))),
        "matrix_re_im": _matrix_json(operation),
        "is_su2": operation_is_su2(operation),
        "probabilities": probabilities,
        "payoffs": {"X": payoffs[0], "O": payoffs[1]},
        "deviator_payoff": payoffs[0 if seat == "X" else 1],
    }


def search_deviation(
    seat: str,
    config: SearchConfig = SearchConfig(),
    opponent: np.ndarray = Q_OPERATION,
    gamma: float = MAX_ENTANGLEMENT,
) -> dict:
    """Search one player's full local SU(2) space for a profitable deviation."""

    config.validate()
    if seat not in ("X", "O"):
        raise ValueError("seat must be X or O")
    seat_offset = 0 if seat == "X" else 1

    sobol = qmc.Sobol(d=3, scramble=True, seed=config.seed + seat_offset)
    sampled_parameters = _scale_sobol(sobol.random_base2(config.sobol_power))
    # Fixed boundary/adversarial anchors ensure the search actually examines
    # beta=0 and beta=pi, which a continuous quasi-random draw reaches with
    # probability zero. i*sigma_x is a closed-form Benjamin-Hayden-style witness.
    anchors = np.array([
        Q_PARAMETERS,
        (0.0, 0.0, 0.0),
        (0.0, math.pi, 0.0),
        I_SIGMA_X_PARAMETERS,
        (-math.pi, math.pi, math.pi / 2.0),
        (math.pi, math.pi, -math.pi / 2.0),
    ])
    grid_parameters = np.vstack((sampled_parameters, anchors))
    grid_payoffs = _batch_payoffs(grid_parameters, seat, opponent, gamma)
    best_grid_index = int(np.argmax(grid_payoffs))

    starts_count = min(config.local_starts, len(grid_parameters))
    top_indices = np.argpartition(grid_payoffs, -starts_count)[-starts_count:]

    def objective(params: np.ndarray) -> float:
        return -float(_batch_payoffs(np.asarray(params).reshape(1, 3), seat, opponent, gamma)[0])

    local_results = []
    for index in top_indices:
        result = minimize(
            objective,
            grid_parameters[index],
            method="L-BFGS-B",
            bounds=BOUNDS,
            options={"ftol": 1e-15, "gtol": 1e-12, "maxiter": 2000},
        )
        local_results.append(result)

    differential = differential_evolution(
        objective,
        bounds=BOUNDS,
        seed=config.seed + 10_000 + seat_offset,
        maxiter=config.differential_evolution_maxiter,
        popsize=config.differential_evolution_popsize,
        tol=1e-10,
        atol=1e-12,
        polish=True,
        updating="immediate",
        workers=1,
    )

    candidates = [
        ("sobol_or_anchor", grid_parameters[best_grid_index], float(grid_payoffs[best_grid_index])),
        ("differential_evolution", differential.x, -float(differential.fun)),
    ]
    candidates.extend(("local_L-BFGS-B", result.x, -float(result.fun)) for result in local_results)
    source, best_parameters, _ = max(candidates, key=lambda item: item[2])
    witness = evaluate_deviation(best_parameters, seat, opponent, gamma)

    candidate_operations = (Q_OPERATION, opponent) if seat == "X" else (opponent, Q_OPERATION)
    candidate_payoffs, _ = expected_payoffs_for_operations(*candidate_operations, gamma)
    candidate_payoff = candidate_payoffs[0 if seat == "X" else 1]
    gain = witness["deviator_payoff"] - candidate_payoff

    known = evaluate_deviation(I_SIGMA_X_PARAMETERS, seat, opponent, gamma)
    known["gain_over_candidate"] = known["deviator_payoff"] - candidate_payoff

    best_local = max(local_results, key=lambda result: -float(result.fun))
    witness.update({
        "source": source,
        "candidate_payoff": candidate_payoff,
        "gain_over_candidate": gain,
        "profitable_above_tolerance": gain > config.tolerance,
    })
    return {
        "seat": seat,
        "witness": witness,
        "known_closed_form_witness": known,
        "search_evidence": {
            "sobol": {
                "seed": config.seed + seat_offset,
                "scrambled": True,
                "dimensions": 3,
                "points": 2 ** config.sobol_power,
                "fixed_boundary_anchors": len(anchors),
                "best_payoff": float(grid_payoffs[best_grid_index]),
                "best_parameters": [float(value) for value in grid_parameters[best_grid_index]],
            },
            "local_L-BFGS-B": {
                "starts": len(local_results),
                "successful": sum(bool(result.success) for result in local_results),
                "best_payoff": -float(best_local.fun),
                "best_parameters": [float(value) for value in best_local.x],
            },
            "differential_evolution": {
                "seed": config.seed + 10_000 + seat_offset,
                "success": bool(differential.success),
                "message": str(differential.message),
                "evaluations": int(differential.nfev),
                "iterations": int(differential.nit),
                "best_payoff": -float(differential.fun),
                "best_parameters": [float(value) for value in differential.x],
            },
        },
    }


def run_stress_test(config: SearchConfig = SearchConfig()) -> dict:
    """Run the symmetric one-sided A4 test and return its complete record."""

    config.validate()
    candidate_payoffs, candidate_probabilities = expected_payoffs_for_operations(
        Q_OPERATION, Q_OPERATION, MAX_ENTANGLEMENT
    )
    deviations = {
        seat: search_deviation(seat, config, Q_OPERATION, MAX_ENTANGLEMENT)
        for seat in ("X", "O")
    }
    exploitability = max(
        0.0,
        deviations["X"]["witness"]["gain_over_candidate"],
        deviations["O"]["witness"]["gain_over_candidate"],
    )
    menu_baseline = restricted_menu_baseline(config.tolerance)
    return {
        "schema": SCHEMA,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "engineering_only": True,
        "preregistered_experiment": False,
        "stage": STAGE,
        "baseline_protocol": "quantum-policy-tic-tac-toe/v1.0",
        "stress_protocol": "quantum-policy-tic-tac-toe-strategy-space/v0.1-draft",
        "gamma": MAX_ENTANGLEMENT,
        "candidate": {
            "profile": ["Q", "Q"],
            "parameters": {"X": dict(zip(PARAMETER_NAMES, Q_PARAMETERS)), "O": dict(zip(PARAMETER_NAMES, Q_PARAMETERS))},
            "probabilities": candidate_probabilities,
            "payoffs": {"X": candidate_payoffs[0], "O": candidate_payoffs[1]},
        },
        "strategy_domain": {
            "name": "deterministic full local SU(2)",
            "parameters": list(PARAMETER_NAMES),
            "bounds": {name: list(bound) for name, bound in zip(PARAMETER_NAMES, BOUNDS)},
            "downstream_policies": "frozen v1 positional/heuristic",
            "payoff_matrix": {profile: list(BIMATRIX[profile]) for profile in BASIS},
        },
        "search_config": asdict(config),
        "restricted_menu_baseline": menu_baseline,
        "deviations": deviations,
        "exploitability": exploitability,
        "candidate_is_equilibrium_in_tested_space": exploitability <= config.tolerance,
        "conclusion": (
            "BROKEN: an explicit profitable unilateral deviation exists in full local SU(2)."
            if exploitability > config.tolerance
            else "UNRESOLVED: no profitable witness was found; this is not an equilibrium certificate."
        ),
        "claim_boundary": (
            "Engineering replication of a known strategy-space limitation. This is not human data, "
            "not hardware evidence, not a global-optimum certificate, and not evidence for or against quantum cognition."
        ),
        "classical_comparator": {
            "shared_randomness_allowed": True,
            "fixed_measurement_distribution_reproducible_exactly": True,
            "implication": "No nonclassical-correlation claim is available from this fixed measurement arrangement.",
        },
        "v1_compatibility": validate_against_v1(),
    }


def restricted_menu_baseline(tolerance: float = EXPLOITABILITY_TOLERANCE) -> dict:
    """Show that the same candidate is stable before the strategy-space expansion."""

    candidate_probabilities = outcome_probabilities(MENU["Q"], MENU["Q"], MAX_ENTANGLEMENT)
    candidate_payoffs = expected_payoffs(candidate_probabilities)
    deviations = {}
    for seat, index in (("X", 0), ("O", 1)):
        alternatives = {}
        for name, operation in MENU.items():
            probabilities = outcome_probabilities(
                operation if seat == "X" else MENU["Q"],
                MENU["Q"] if seat == "X" else operation,
                MAX_ENTANGLEMENT,
            )
            alternatives[name] = expected_payoffs(probabilities)[index]
        best_name = max(alternatives, key=alternatives.get)
        gain = alternatives[best_name] - candidate_payoffs[index]
        deviations[seat] = {
            "best_operation": best_name,
            "best_payoff": alternatives[best_name],
            "candidate_payoff": candidate_payoffs[index],
            "gain": gain,
            "all_payoffs": alternatives,
        }
    exploitability = max(0.0, deviations["X"]["gain"], deviations["O"]["gain"])
    return {
        "stage": "A1-frozen-menu",
        "operations": list(MENU),
        "exploitability": exploitability,
        "candidate_is_equilibrium": exploitability <= tolerance,
        "deviations": deviations,
    }


def validate_against_v1() -> dict:
    """Machine checks that the enlarged implementation still embeds frozen v1."""

    worst_slice_error = 0.0
    for theta in np.linspace(0.0, math.pi, 9):
        for phi in np.linspace(0.0, math.pi / 2.0, 7):
            worst_slice_error = max(
                worst_slice_error,
                float(np.max(np.abs(su2(float(phi), float(theta), 0.0) - unitary(float(theta), float(phi))))),
            )

    worst_probability_error = 0.0
    for gamma in np.linspace(0.0, MAX_ENTANGLEMENT, 7):
        for operation_x in ("C", "D", "M", "Q"):
            for operation_o in ("C", "D", "M", "Q"):
                expanded = probabilities_for_operations(
                    su2(MENU_PARAMETERS[operation_x][0], MENU_PARAMETERS[operation_x][1], 0.0),
                    su2(MENU_PARAMETERS[operation_o][0], MENU_PARAMETERS[operation_o][1], 0.0),
                    float(gamma),
                )
                reference = outcome_probabilities(
                    (MENU_PARAMETERS[operation_x][1], MENU_PARAMETERS[operation_x][0]),
                    (MENU_PARAMETERS[operation_o][1], MENU_PARAMETERS[operation_o][0]),
                    float(gamma),
                )
                worst_probability_error = max(
                    worst_probability_error,
                    max(abs(expanded[profile] - reference[profile]) for profile in BASIS),
                )
    return {
        "ewl_slice_matches_v1": worst_slice_error < 1e-12,
        "worst_ewl_slice_error": worst_slice_error,
        "probabilities_match_v1": worst_probability_error < 1e-12,
        "worst_probability_error": worst_probability_error,
    }


# (alpha, beta) coordinates on the delta=0 EWL slice. Kept separately from
# protocol.MENU so the SU(2) construction does not call the v1 unitary helper.
MENU_PARAMETERS = {
    "C": (0.0, 0.0),
    "D": (0.0, math.pi),
    "M": (0.0, math.pi / 2.0),
    "Q": (math.pi / 2.0, 0.0),
}
