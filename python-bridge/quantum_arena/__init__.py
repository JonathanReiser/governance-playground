"""Quantum Policy Tic-Tac-Toe arena — the implementation of protocol v1.0.

See preregistrations/quantum-policy-tic-tac-toe.protocol-v1.md. This package is
the circuit and payoff layer that document specifies and did not previously
exist. It is deliberately NOT the participant interface: release 1 is
implementation-only, and nothing here collects human data.
"""

from .protocol import (
    MENU,
    FLIP,
    entangler,
    final_state,
    outcome_probabilities,
    unitary,
)
from .payoffs import BIMATRIX, PROFILES, expected_payoffs, pure_nash

__all__ = [
    "MENU", "FLIP", "entangler", "final_state", "outcome_probabilities", "unitary",
    "BIMATRIX", "PROFILES", "expected_payoffs", "pure_nash",
]
