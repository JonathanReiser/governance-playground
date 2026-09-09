"""The Eisert-Wilkens-Lewenstein protocol as protocol-v1.md specifies it.

Exact state-vector arithmetic in numpy. No qiskit here on purpose: this module
is the reference the hardware path is checked against, so it must not share an
implementation with it.
"""

from __future__ import annotations

import numpy as np

# Basis order [CC, CD, DC, DD] — X's policy first, matching payoffs.PROFILES.
# Measurement result ij executes X policy i against O policy j.
BASIS = ("CC", "CD", "DC", "DD")

MAX_ENTANGLEMENT = np.pi / 2


def unitary(theta: float, phi: float) -> np.ndarray:
    """U(theta, phi) from protocol-v1.md.

    The two-parameter EWL family. A measure-zero, non-closed subset of SU(2) —
    that restriction is exactly what Benjamin & Hayden's objection targets, and
    it is the reason no result from this protocol may be reported without the
    full-SU(2) best response alongside it.
    """
    if not (0 <= theta <= np.pi + 1e-12):
        raise ValueError(f"theta must lie in [0, pi], got {theta}")
    if not (-1e-12 <= phi <= np.pi / 2 + 1e-12):
        raise ValueError(f"phi must lie in [0, pi/2], got {phi}")
    return np.array(
        [
            [np.exp(1j * phi) * np.cos(theta / 2), np.sin(theta / 2)],
            [-np.sin(theta / 2), np.exp(-1j * phi) * np.cos(theta / 2)],
        ],
        dtype=complex,
    )


# The flip strategy, and therefore the entangler's generator. These MUST be the
# same operator: J has to commute with D(x)I and I(x)D for the classical game to
# be embedded at every gamma. Draft 0.1 generated J from sigma_x while its
# theta=pi strategy was i*sigma_y, which inverted the asymmetric classical
# profiles outright at gamma = pi/2. See protocol-v1.md, "What changed from 0.1".
FLIP = unitary(np.pi, 0.0)


def entangler(gamma: float) -> np.ndarray:
    """J(gamma) = exp(i * gamma/2 * FLIP (x) FLIP).

    (FLIP (x) FLIP)^2 = I, so the series closes to cos + i sin exactly rather
    than needing a matrix exponential.
    """
    if not (0 <= gamma <= MAX_ENTANGLEMENT + 1e-12):
        raise ValueError(f"gamma must lie in [0, pi/2], got {gamma}")
    generator = np.kron(FLIP, FLIP)
    return np.cos(gamma / 2) * np.eye(4, dtype=complex) + 1j * np.sin(gamma / 2) * generator


def final_state(operation_x, operation_o, gamma: float) -> np.ndarray:
    """|psi_f> = J(gamma)^dagger (U_X (x) U_O) J(gamma) |00>."""
    j = entangler(gamma)
    initial = np.array([1, 0, 0, 0], dtype=complex)
    return j.conj().T @ np.kron(unitary(*operation_x), unitary(*operation_o)) @ j @ initial


def outcome_probabilities(operation_x, operation_o, gamma: float) -> dict[str, float]:
    """Born-rule probabilities over [CC, CD, DC, DD]."""
    amplitudes = final_state(operation_x, operation_o, gamma)
    return {name: float(abs(a) ** 2) for name, a in zip(BASIS, amplitudes)}


# The preregistered menu (protocol-v1.md, question 5). Frozen: adding, removing
# or retuning an entry is a protocol revision, not a code change.
#
# Keys are the theoretical names. The participant interface MUST NOT show them,
# nor "cooperate"/"defect", nor anything identifying Q as the quantum option —
# the protocol forbids telling a participant a setting is intelligent, optimal
# or "more quantum". Neutral labels in the interface, this mapping in the record.
MENU: dict[str, tuple[float, float]] = {
    "C": (0.0, 0.0),
    "D": (np.pi, 0.0),
    "M": (np.pi / 2, 0.0),
    "Q": (0.0, np.pi / 2),
}
