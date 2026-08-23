"""
Tests for layer1_qpu.py. TestBitOrdering is the one that matters most —
it doesn't trust the module docstring's derivation, it prepares concrete
asymmetric states and checks the measured (a_outcome, b_outcome) actually
match what those states mean. A silent bit-ordering bug here would
corrupt the actual research record (this collapse feeds the committed
on-chain outcome when Tier 2 is on), not just crash loudly — exactly the
class of mistake worth a dedicated, concrete test rather than trusting
the reasoning alone.

Everything here runs on the local Aer simulator — no IBM_QUANTUM_TOKEN,
no network call to real hardware. See TestRealHardwareLive at the bottom
for the one class that touches real hardware, skipped without a token.
"""

import math
import os

import pytest

from layer1_qpu import build_state_prep_circuit, collapse_entangled_pair

AMP = lambda re, im=0.0: {"re": re, "im": im}  # noqa: E731
ZERO = AMP(0.0)
ONE = AMP(1.0)
INV_SQRT2 = 1 / math.sqrt(2)


class TestBitOrdering:
    """
    quantum.js's joint array is [A0B0, A0B1, A1B0, A1B1]. Each test below
    prepares a state with weight on exactly ONE basis state, then confirms
    the measured (a_outcome, b_outcome) matches that specific label — not
    a swapped one. Run many shots per case (via repeated collapse calls)
    since a single shot passing by chance would prove nothing for a
    binary outcome.
    """

    def test_a0_b0_state(self):
        joint = [ONE, ZERO, ZERO, ZERO]
        for _ in range(5):
            r = collapse_entangled_pair(joint)
            assert (r["a_outcome"], r["b_outcome"]) == (0, 0)

    def test_a0_b1_state(self):
        joint = [ZERO, ONE, ZERO, ZERO]
        for _ in range(5):
            r = collapse_entangled_pair(joint)
            assert (r["a_outcome"], r["b_outcome"]) == (0, 1)

    def test_a1_b0_state(self):
        joint = [ZERO, ZERO, ONE, ZERO]
        for _ in range(5):
            r = collapse_entangled_pair(joint)
            assert (r["a_outcome"], r["b_outcome"]) == (1, 0)

    def test_a1_b1_state(self):
        joint = [ZERO, ZERO, ZERO, ONE]
        for _ in range(5):
            r = collapse_entangled_pair(joint)
            assert (r["a_outcome"], r["b_outcome"]) == (1, 1)

    def test_genuinely_entangled_bell_like_state_correlates_a_and_b(self):
        # Zero amplitude on the two "disagreeing" branches (A0B1, A1B0) —
        # a real Bell-like entangled state. If the qubit-role mapping were
        # backwards, this specific state wouldn't reveal it (it's
        # symmetric under swapping A and B) — this test checks the
        # CORRELATION survives state prep, complementing the asymmetric
        # tests above which check the LABELING.
        joint = [AMP(INV_SQRT2), ZERO, ZERO, AMP(INV_SQRT2)]
        outcomes = [collapse_entangled_pair(joint) for _ in range(20)]
        assert all(r["a_outcome"] == r["b_outcome"] for r in outcomes)
        # And both outcomes actually occur across enough shots — not
        # trivially always the same branch (would also pass the equality
        # check above by accident if state prep just always produced 00).
        assert len({r["a_outcome"] for r in outcomes}) == 2


class TestBuildStatePrepCircuit:
    def test_rejects_wrong_length_input(self):
        with pytest.raises(ValueError, match="expected exactly 4 amplitudes"):
            build_state_prep_circuit([ONE, ZERO, ZERO])

    def test_rejects_unnormalized_state(self):
        with pytest.raises(ValueError, match="not normalized"):
            build_state_prep_circuit([ONE, ONE, ZERO, ZERO])  # sums to 2, not 1

    def test_accepts_a_properly_normalized_superposition(self):
        joint = [AMP(0.6), AMP(0.8), ZERO, ZERO]  # 0.36 + 0.64 = 1.0
        circuit = build_state_prep_circuit(joint)
        assert circuit.num_qubits == 2


class TestCollapseEntangledPair:
    def test_no_token_falls_back_to_simulator_honestly_labeled(self, monkeypatch):
        monkeypatch.delenv("IBM_QUANTUM_TOKEN", raising=False)
        r = collapse_entangled_pair([ONE, ZERO, ZERO, ZERO])
        assert r["simulator"] is True
        assert r["backend"] == "aer_simulator"
        assert r["job_id"] is None
        assert "no IBM_QUANTUM_TOKEN" in r["detail"]

    def test_a_bad_token_falls_back_to_simulator_rather_than_crashing(self):
        # Real network call with a deliberately invalid token — proves the
        # fallback degrades gracefully on a genuine failure, not just a
        # mocked one, same as instinct_qpu.py's equivalent test.
        r = collapse_entangled_pair([ONE, ZERO, ZERO, ZERO], token="not-a-real-token")
        assert r["simulator"] is True
        assert "IBM hardware call failed" in r["detail"]


@pytest.mark.skipif(
    not os.environ.get("IBM_QUANTUM_TOKEN"),
    reason="no IBM_QUANTUM_TOKEN in this environment — set one locally to exercise the real-hardware path",
)
class TestRealHardwareLive:
    def test_a_real_reading_actually_reaches_hardware_and_gets_the_bit_ordering_right(self):
        # pressure-tested case: an asymmetric state on real hardware,
        # where gate/readout noise is real — confirms the bit-ordering
        # derivation holds up under actual noise, not just an ideal
        # simulator.
        joint = [ZERO, ONE, ZERO, ZERO]  # A0B1
        r = collapse_entangled_pair(joint)
        assert r["simulator"] is False
        assert r["job_id"] is not None
        assert (r["a_outcome"], r["b_outcome"]) == (0, 1)
