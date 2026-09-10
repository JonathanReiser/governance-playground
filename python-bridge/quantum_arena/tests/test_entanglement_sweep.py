import json
import math
from pathlib import Path

import pytest

from quantum_arena.entanglement_sweep import (
    SCHEMA,
    restricted_stability_threshold,
    run_entanglement_sweep,
    sweep_point,
)
from quantum_arena.protocol import MAX_ENTANGLEMENT


def assert_records_close(actual, expected, path="record"):
    """Compare a generated record across platforms without demanding bit identity."""

    assert type(actual) is type(expected), f"{path}: {type(actual)} != {type(expected)}"
    if isinstance(actual, dict):
        assert actual.keys() == expected.keys(), f"{path}: keys differ"
        for key in actual:
            assert_records_close(actual[key], expected[key], f"{path}.{key}")
    elif isinstance(actual, list):
        assert len(actual) == len(expected), f"{path}: lengths differ"
        for index, (actual_item, expected_item) in enumerate(zip(actual, expected)):
            assert_records_close(actual_item, expected_item, f"{path}[{index}]")
    elif isinstance(actual, float):
        assert actual == pytest.approx(expected, rel=1e-12, abs=1e-12), path
    else:
        assert actual == expected, path


class TestEntanglementSweep:
    def test_restricted_menu_has_a_reproducible_stability_transition(self):
        threshold = restricted_stability_threshold()
        assert threshold == pytest.approx(math.asin(math.sqrt(2 / 5)), abs=1e-12)
        assert sweep_point(threshold - 1e-5)["restricted_menu"]["exploitability"] > 0
        assert sweep_point(threshold + 1e-5)["restricted_menu"]["exploitability"] == pytest.approx(0, abs=1e-12)

    @pytest.mark.parametrize("gamma", [0.0, 0.2, 0.7, 1.1, MAX_ENTANGLEMENT])
    def test_full_su2_witness_is_a_certified_best_response_everywhere(self, gamma):
        point = sweep_point(gamma)
        for seat in ("X", "O"):
            response = point["full_su2"]["responses"][seat]
            assert response["globally_certified_by_payoff_ceiling"] is True
            assert response["best_payoff"] == pytest.approx(2 / 3, abs=1e-12)
            assert response["gain"] == pytest.approx(2 / 3, abs=1e-12)
            favourable_profile = "DC" if seat == "X" else "CD"
            assert response["probabilities"][favourable_profile] == pytest.approx(1, abs=1e-12)

    def test_record_is_complete_separate_and_does_not_overclaim(self):
        record = run_entanglement_sweep(intervals=8)
        assert record["schema"] == SCHEMA
        assert record["schema"] != "quantum-arena-play/v1"
        assert len(record["points"]) == 9
        assert record["points"][0]["gamma"] == 0
        assert record["points"][-1]["gamma"] == pytest.approx(MAX_ENTANGLEMENT)
        assert record["engineering_only"] is True
        assert record["preregistered_experiment"] is False
        assert record["full_su2_certificate"]["certified_at_every_grid_point"] is True
        assert "not participant data" in record["claim_boundary"]

    def test_checked_in_visualization_artifact_matches_the_python_generator(self):
        artifact_path = Path(__file__).parents[3] / "frontend/src/data/arenaEntanglementSweep.json"
        artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
        regenerated = run_entanglement_sweep(intervals=artifact["gamma_domain"]["intervals"])
        artifact.pop("generated_at")
        regenerated.pop("generated_at")
        # NumPy/SciPy transcendental results can differ in their last bits across
        # Python and libc builds. The artifact must reproduce to the protocol's
        # 1e-12 numerical precision, not to platform-specific byte identity.
        assert_records_close(artifact, regenerated)

    @pytest.mark.parametrize("intervals", [0, 1, 513, 2.5])
    def test_rejects_invalid_grid_sizes(self, intervals):
        with pytest.raises(ValueError):
            run_entanglement_sweep(intervals=intervals)


class TestMenuEquilibriumRegimes:
    """The menu game has an equilibrium at every gamma; which one changes twice.

    Reporting only (Q,Q)'s status invites reading "the menu stabilises" as "the
    menu had no equilibrium before", which is false.
    """

    def test_three_regimes_with_the_documented_occupants(self):
        from quantum_arena.entanglement_sweep import menu_equilibrium_regimes

        regimes = menu_equilibrium_regimes()["regimes"]
        assert [r["equilibria"] for r in regimes] == [
            [["D", "D"]],
            [["D", "Q"], ["Q", "D"]],
            [["Q", "Q"]],
        ]

    def test_the_middle_band_holds_two_equilibria(self):
        from quantum_arena.entanglement_sweep import menu_equilibrium_regimes

        middle = menu_equilibrium_regimes()["regimes"][1]
        assert len(middle["equilibria"]) == 2
        assert "coordination" in middle["description"].lower()

    def test_boundaries_are_the_exact_roots(self):
        import math

        from quantum_arena.entanglement_sweep import menu_equilibrium_regimes

        boundaries = menu_equilibrium_regimes()["boundaries"]
        # Q overtakes D as a reply to D at arctan(1/2).
        assert boundaries["dd_to_asymmetric"]["gamma"] == pytest.approx(math.atan(0.5), abs=1e-12)
        # (Q,Q) becomes stable where sin^2(gamma) = 2/5.
        upper = boundaries["asymmetric_to_qq"]["gamma"]
        assert math.sin(upper) ** 2 == pytest.approx(0.4, abs=1e-12)

    def test_boundaries_do_not_land_on_plotted_grid_points(self):
        """If they did, "exact vs grid" would be a distinction without a difference."""
        import math

        from quantum_arena.entanglement_sweep import DEFAULT_INTERVALS, menu_equilibrium_regimes
        from quantum_arena.protocol import MAX_ENTANGLEMENT

        spacing = MAX_ENTANGLEMENT / DEFAULT_INTERVALS
        for boundary in menu_equilibrium_regimes()["boundaries"].values():
            steps = boundary["gamma"] / spacing
            assert abs(steps - round(steps)) > 1e-6

    def test_regimes_tile_the_domain_without_gap_or_overlap(self):
        from quantum_arena.entanglement_sweep import menu_equilibrium_regimes
        from quantum_arena.protocol import MAX_ENTANGLEMENT

        regimes = menu_equilibrium_regimes()["regimes"]
        assert regimes[0]["gamma_min"] == 0.0
        assert regimes[-1]["gamma_max"] == pytest.approx(MAX_ENTANGLEMENT, abs=1e-12)
        for earlier, later in zip(regimes, regimes[1:]):
            assert later["gamma_min"] == pytest.approx(earlier["gamma_max"], abs=1e-12)

    def test_per_point_equilibria_match_the_regime_they_fall_in(self):
        from quantum_arena.entanglement_sweep import menu_equilibria, menu_equilibrium_regimes

        regimes = menu_equilibrium_regimes()["regimes"]
        for regime in regimes:
            midpoint = (regime["gamma_min"] + regime["gamma_max"]) / 2.0
            assert menu_equilibria(midpoint) == regime["equilibria"]

    def test_the_classical_limit_note_is_recorded(self):
        """At gamma = 0 the deviation is defection against cooperation, not a
        quantum effect. The record has to say so or the flat red line misleads."""
        from quantum_arena.entanglement_sweep import run_entanglement_sweep

        record = run_entanglement_sweep(intervals=8)
        assert "classical_limit_note" in record
        assert "no quantum content" in record["classical_limit_note"]
        assert "grid_versus_exact" in record
        assert record["grid_versus_exact"]["plotted_grid_points"] == 9
