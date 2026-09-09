"""One arena play: measure once, execute the selected policy pair, record it.

Validation item 10 in force — arena records carry their own schema and must
never be appended to the Phase 0 decision-lab dataset, nor Phase 0 observations
relabelled as quantum-game data.
"""

from __future__ import annotations

from datetime import datetime, timezone

from ttt_lab.policies.frozen_arena import POLICIES, play_out

from .hardware import empirical_distribution, execute
from .payoffs import BIMATRIX
from .protocol import MENU, outcome_probabilities

SCHEMA = "quantum-arena-play/v1"
EXPLANATION_SCHEMA = "quantum-arena-explanation/v1"


def _operation(name: str) -> tuple[float, float]:
    if name not in MENU:
        raise ValueError(f"unknown operation {name!r}; the menu is frozen as {sorted(MENU)}")
    return MENU[name]


def play(operation_x: str, operation_o: str, gamma: float, token: str | None = None) -> dict:
    """A single research play.

    ONE shot. The protocol measures once to select the policy pair — drawing
    many and picking, or averaging, would make the record a summary of a
    distribution rather than an observation of a game.
    """
    reading = execute(_operation(operation_x), _operation(operation_o), gamma, shots=1, token=token)
    selected = next(name for name, count in reading["counts"].items() if count == 1)
    policy_x, policy_o = selected[0], selected[1]

    moves, board_result = play_out(POLICIES[policy_x], POLICIES[policy_o])
    payoff_x, payoff_o = BIMATRIX[selected]

    record = {
        "schema": SCHEMA,
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "gamma": gamma,
        "operations": {"X": operation_x, "O": operation_o},
        "measured_profile": selected,
        "policies": {"X": policy_x, "O": policy_o},
        "game": {"moves": list(moves), "board_result": board_result},
        "payoffs": {"X": payoff_x, "O": payoff_o},
        "execution": {
            "backend": reading["backend"],
            "simulator": reading["simulator"],
            "job_id": reading["job_id"],
            "shots": 1,
        },
    }
    # Item 9: backend provenance travels with the observation. These keys exist
    # only on the hardware path, so their absence is itself information.
    for key in ("backend_requested", "backend_pinned", "readout_mitigation", "detail"):
        if key in reading:
            record["execution"][key] = reading[key]
    return record


def explain(operation_x: str, operation_o: str, gamma: float, shots: int = 4096, token: str | None = None) -> dict:
    """Many-shot outcome estimates for the explanation mode.

    Carries a DIFFERENT schema on purpose. The protocol requires that
    explanatory shots never mix with single-play research records, and a shared
    schema is exactly how that mixing happens — one loader, one array, and the
    distinction survives only in a field somebody forgot to filter on.
    """
    if shots < 2:
        raise ValueError("an explanation needs more than one shot; use play() for a research observation")
    reading = execute(_operation(operation_x), _operation(operation_o), gamma, shots=shots, token=token)
    return {
        "schema": EXPLANATION_SCHEMA,
        "not_a_research_observation": True,
        "gamma": gamma,
        "operations": {"X": operation_x, "O": operation_o},
        "empirical": empirical_distribution(reading),
        "exact": outcome_probabilities(_operation(operation_x), _operation(operation_o), gamma),
        "shots": shots,
        "execution": {"backend": reading["backend"], "simulator": reading["simulator"], "job_id": reading["job_id"]},
    }
