import pytest

from quantum_arena.session import EXPLANATION_SCHEMA, SCHEMA, explain, play
from quantum_arena.protocol import MAX_ENTANGLEMENT


class TestASingleResearchPlay:
    def test_uses_exactly_one_shot(self):
        record = play("Q", "Q", MAX_ENTANGLEMENT)
        assert record["execution"]["shots"] == 1

    def test_records_the_measured_pair_and_the_game_it_produced(self):
        record = play("C", "D", 0.0)
        assert record["measured_profile"] == "CD"
        assert record["policies"] == {"X": "C", "O": "D"}
        assert len(record["game"]["moves"]) >= 5
        assert record["payoffs"]["X"] == pytest.approx(-1.0)

    def test_carries_the_arena_schema_not_a_phase_zero_one(self):
        assert play("C", "C", 0.0)["schema"] == SCHEMA
        assert SCHEMA != "ttt-decision/v1"

    def test_refuses_an_operation_outside_the_frozen_menu(self):
        with pytest.raises(ValueError, match="menu is frozen"):
            play("Z", "C", 0.0)

    def test_simulator_readings_carry_no_pinned_backend_fields(self):
        execution = play("C", "C", 0.0)["execution"]
        assert execution["simulator"] is True
        assert "backend_pinned" not in execution


class TestExplanationModeStaysSeparate:
    def test_uses_a_different_schema_from_a_play(self):
        """A shared schema is exactly how explanatory shots end up pooled with
        research observations — one loader, one array, and the distinction
        survives only in a field somebody forgot to filter on."""
        assert explain("M", "M", 0.0, shots=64)["schema"] == EXPLANATION_SCHEMA
        assert EXPLANATION_SCHEMA != SCHEMA

    def test_flags_itself_as_not_a_research_observation(self):
        assert explain("M", "M", 0.0, shots=64)["not_a_research_observation"] is True

    def test_refuses_to_masquerade_as_a_single_play(self):
        with pytest.raises(ValueError, match="more than one shot"):
            explain("C", "C", 0.0, shots=1)

    def test_empirical_tracks_the_exact_distribution(self):
        result = explain("M", "M", MAX_ENTANGLEMENT / 2, shots=8192)
        for profile, exact in result["exact"].items():
            assert result["empirical"][profile] == pytest.approx(exact, abs=0.03)
