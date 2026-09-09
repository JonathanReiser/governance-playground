"""
Tests for dyad_baseline.py.

The classifier is the part of this module that could quietly determine
the answer, so it gets the most hostile tests: every rule is exercised in
BOTH directions (a de-escalatory input must actually classify as C, not
just fail to classify as D), and the deliberate exclusion of
proxyActivity is tested with an input that would flip the result if it
were included.

Assertions about the published preregistration data are structural only —
counts that add up, error records skipped, both nations present. The
substantive numbers are asserted against fixed synthetic observations
instead, so that adding a new preregistered batch to the repo changes the
reported finding without breaking the test suite. A test that had to be
edited every time real data arrived would train exactly the wrong reflex.
"""

import pytest

from dyad_baseline import (
    DYAD,
    DYAD_PAYOFFS,
    PREREGISTRATIONS_DIR,
    _profile_summary,
    build_report,
    classify_conflict_events,
    classify_indicator_vote,
    format_report,
    load_dyad_decisions,
)

ESCALATORY = {"conflictEvents": 2, "dealIntegrity": -13, "stability": -4, "proxyActivity": 13}
DE_ESCALATORY = {"conflictEvents": -1, "dealIntegrity": 6, "stability": 3, "proxyActivity": -5}


def observation(p1_deltas, p2_deltas, conditions=()):
    return {
        "registration": "test",
        "starting_conditions": conditions,
        "cycle": 1,
        "p1_deltas": p1_deltas,
        "p2_deltas": p2_deltas,
        "quantum_labels": {},
    }


class TestConflictEventsClassifier:
    def test_positive_conflict_delta_is_escalation(self):
        assert classify_conflict_events(ESCALATORY) == "D"

    def test_negative_conflict_delta_is_de_escalation(self):
        # The direction that never occurs in the published data. If the
        # classifier could not return C at all, the empirical finding
        # would be an artifact of the classifier rather than the runs.
        assert classify_conflict_events(DE_ESCALATORY) == "C"

    def test_zero_and_missing_are_unresolved_rather_than_guessed(self):
        assert classify_conflict_events({"conflictEvents": 0}) is None
        assert classify_conflict_events({}) is None


class TestIndicatorVoteClassifier:
    def test_all_indicators_escalatory(self):
        assert classify_indicator_vote(ESCALATORY) == "D"

    def test_all_indicators_de_escalatory(self):
        assert classify_indicator_vote(DE_ESCALATORY) == "C"

    def test_majority_wins_over_a_dissenting_indicator(self):
        assert classify_indicator_vote({"conflictEvents": 1, "dealIntegrity": -2, "stability": 5}) == "D"
        assert classify_indicator_vote({"conflictEvents": -1, "dealIntegrity": 2, "stability": -5}) == "C"

    def test_exact_tie_is_unresolved(self):
        assert classify_indicator_vote({"conflictEvents": 1, "dealIntegrity": 4}) is None

    def test_proxy_activity_is_excluded_even_when_it_would_flip_the_answer(self):
        # Israel escalates by striking convoys, which LOWERS proxy
        # activity; Iran escalates by raising it. The field's escalatory
        # direction is nation-dependent, so including it would encode an
        # assumption. This input is 1-1 on the neutral indicators with a
        # large proxyActivity term that would break the tie if counted.
        tied_with_large_proxy = {"conflictEvents": 1, "stability": 4, "proxyActivity": 99}
        assert classify_indicator_vote(tied_with_large_proxy) is None


class TestProfileSummary:
    def test_distribution_and_payoffs_are_computed_from_the_actual_counts(self):
        # Three DD and one CC: expected payoff is 0.75*1 + 0.25*3 = 1.5
        # for both players under the stipulated matrix. An exact number,
        # not a range.
        observations = [observation(ESCALATORY, ESCALATORY) for _ in range(3)]
        observations.append(observation(DE_ESCALATORY, DE_ESCALATORY))
        summary = _profile_summary(observations, "conflict_events")

        assert summary["profile_counts"] == {"CC": 1, "CD": 0, "DC": 0, "DD": 3}
        assert summary["profile_distribution"]["DD"] == pytest.approx(0.75)
        assert summary["realised_expected_payoffs"] == pytest.approx((1.5, 1.5))
        assert summary["modal_profile"] == "DD"

    def test_asymmetric_profiles_are_not_transposed(self):
        # Player 1 is Iran, player 2 is Israel. An Iran-escalates /
        # Israel-de-escalates cycle must be DC and pay (5, 0), not CD.
        summary = _profile_summary([observation(ESCALATORY, DE_ESCALATORY)], "conflict_events")
        assert summary["profile_counts"]["DC"] == 1
        assert summary["profile_counts"]["CD"] == 0
        assert summary["realised_expected_payoffs"] == pytest.approx((5.0, 0.0))

    def test_unresolved_cycles_are_excluded_from_the_distribution_not_bucketed(self):
        observations = [
            observation(ESCALATORY, ESCALATORY),
            observation(ESCALATORY, {"conflictEvents": 0}),
        ]
        summary = _profile_summary(observations, "conflict_events")
        assert summary["resolved_cycles"] == 1
        assert summary["unresolved_cycles"] == 1
        assert sum(summary["profile_counts"].values()) == 1


class TestDegeneracyFlag:
    def test_flag_fires_when_one_profile_takes_everything(self):
        summary = _profile_summary([observation(ESCALATORY, ESCALATORY) for _ in range(20)], "conflict_events")
        assert summary["classifier_is_near_degenerate"] is True
        assert summary["degeneracy_note"] is not None

    def test_flag_stays_off_on_a_genuinely_spread_dataset(self):
        # Otherwise the flag would be decoration rather than a diagnostic.
        observations = [observation(ESCALATORY, ESCALATORY) for _ in range(10)]
        observations += [observation(DE_ESCALATORY, DE_ESCALATORY) for _ in range(10)]
        summary = _profile_summary(observations, "conflict_events")
        assert summary["classifier_is_near_degenerate"] is False
        assert summary["degeneracy_note"] is None


class TestPublishedData:
    """Structural assertions only — see this module's docstring for why."""

    def test_loads_real_preregistered_cycles_for_both_nations(self):
        observations = load_dyad_decisions()
        assert len(observations) > 0
        for entry in observations:
            assert entry["p1_deltas"] and entry["p2_deltas"]

    def test_failed_agent_calls_are_skipped_rather_than_treated_as_decisions(self):
        # At least one published cycle records {"error": ...} in place of
        # a decision. Nothing in the loader may invent deltas for it.
        import json

        nations = (DYAD["player1"]["nation"], DYAD["player2"]["nation"])
        cycles_with_both_nations = 0
        cycles_spoiled_by_an_error = 0

        for path in sorted(PREREGISTRATIONS_DIR.glob("*.result.json")):
            registration = PREREGISTRATIONS_DIR / f"{path.name.split('.')[0]}.registration.json"
            if not registration.exists():
                continue
            if json.loads(registration.read_text()).get("scenarioId") != DYAD["scenario_id"]:
                continue
            result = json.loads(path.read_text())
            trials = result.get("trials") or [{"cycles": result.get("cycles", [])}]
            for trial in trials:
                for cycle in trial.get("cycles", []):
                    records = [(cycle.get("decisions") or {}).get(n) or {} for n in nations]
                    if not all(records):
                        continue
                    cycles_with_both_nations += 1
                    if any("metricDeltas" not in record.get("decision", record) for record in records):
                        cycles_spoiled_by_an_error += 1

        # The case being guarded actually exists in the published data —
        # otherwise this test would pass against a loader that never skips.
        assert cycles_spoiled_by_an_error > 0
        assert len(load_dyad_decisions()) == cycles_with_both_nations - cycles_spoiled_by_an_error

    def test_report_is_internally_consistent(self):
        report = build_report()
        for summary in report["observed"]["by_classifier"].values():
            assert sum(summary["profile_counts"].values()) == summary["resolved_cycles"]
            assert summary["resolved_cycles"] + summary["unresolved_cycles"] == report["observed"]["total_cycles"]
            if summary["resolved_cycles"]:
                counts = summary["profile_counts"]
                assert counts[summary["modal_profile"]] == max(counts.values())


class TestReport:
    def test_reference_points_are_the_expected_exact_values(self):
        reference = build_report(observations=[])["reference_points"]
        assert [e["profile"] for e in reference["classical_nash"]["pure"]] == ["DD"]
        assert reference["classical_correlated_equilibrium"]["unique_profile"] == "DD"
        assert reference["correlated_welfare_exceeds_best_nash_welfare"] is False
        assert reference["correlated_polytope_strictly_larger_than_nash_set"] is False
        assert [e["profile"] for e in reference["ewl_quantum_restricted"]["equilibria"]] == ["QQ"]

    def test_stipulated_matrix_is_declared_as_stipulated_and_verified_as_a_pd(self):
        payoff_block = build_report(observations=[])["payoff_matrix"]
        assert "stipulated" in payoff_block["source"]
        assert payoff_block["structure_check"]["is_prisoners_dilemma"] is True
        assert payoff_block["matrix"] == DYAD_PAYOFFS.as_dict()

    def test_report_is_labelled_as_counterfactual_not_mechanism(self):
        # The constraint this whole module exists under has to survive
        # into the output object, not just the source comments.
        label = build_report(observations=[])["label"]
        assert "THEORY" in label and "not a mechanism" in label

    def test_formatter_renders_all_three_reference_points(self):
        rendered = format_report(build_report())
        assert "Classical Nash" in rendered
        assert "Classical correlated (Aumann)" in rendered
        assert "EWL quantum (restricted set)" in rendered
        assert "THEORY / COUNTERFACTUAL" in rendered


class TestFlaskEndpoint:
    def test_ewl_baseline_endpoint_returns_the_report_with_its_constraint_intact(self):
        from app import app

        response = app.test_client().get("/ewl-baseline")
        assert response.status_code == 200
        payload = response.get_json()

        assert "not a mechanism" in payload["label"]
        assert payload["payoff_matrix"]["structure_check"]["is_prisoners_dilemma"] is True
        assert [e["profile"] for e in payload["reference_points"]["classical_nash"]["pure"]] == ["DD"]
        assert [e["profile"] for e in payload["reference_points"]["ewl_quantum_restricted"]["equilibria"]] == ["QQ"]
        assert "RESTRICTED" in payload["reference_points"]["ewl_quantum_restricted"]["caveat"]
        assert payload["observed"]["total_cycles"] > 0


class TestRegistrationMatchesRun:
    """
    A sealed result is permanent, including one that didn't execute the
    condition it declared. 700254f5 is exactly that: registered as
    mou_deal_concluded, ran at plain baseline. Any analysis that
    reconstructs starting values from the registration would attribute
    that run's 20 cycles to a condition it never applied —
    prompt_gates.py counted 20 phantom "gate open" cycles from it before
    this check existed.
    """

    def _scenario(self):
        import json

        from dyad_baseline import REPO_ROOT

        return json.loads((REPO_ROOT / "frontend" / "src" / "scenarios" / "middle-east-2026.json").read_text())

    def test_declared_stability_reflects_the_condition_not_just_the_baseline(self):
        from dyad_baseline import declared_starting_stability

        scenario = self._scenario()
        assert declared_starting_stability({"startingConditionIds": []}, scenario) == 32.0
        assert declared_starting_stability({"startingConditionIds": ["mou_deal_concluded"]}, scenario) == 62.0

    def test_flags_a_run_whose_data_contradicts_its_registration(self):
        from dyad_baseline import registration_matches_run

        cycles = [{"cycle": 1, "committed": {"stability": 31}}]
        matches, reason = registration_matches_run(
            {"startingConditionIds": ["mou_deal_concluded"]}, cycles, self._scenario()
        )
        assert matches is False
        assert "did not execute its registration" in reason

    def test_accepts_a_run_that_did_execute_its_registration(self):
        # Same declared condition, data consistent with it — must NOT be
        # flagged, or the check would throw away the valid arm too.
        from dyad_baseline import registration_matches_run

        cycles = [{"cycle": 1, "committed": {"stability": 70}}]
        matches, reason = registration_matches_run(
            {"startingConditionIds": ["mou_deal_concluded"]}, cycles, self._scenario()
        )
        assert matches is True and reason is None

    def test_accepts_an_ordinary_baseline_run(self):
        from dyad_baseline import registration_matches_run

        cycles = [{"cycle": 1, "committed": {"stability": 29}}]
        assert registration_matches_run({"startingConditionIds": []}, cycles, self._scenario())[0] is True

    def test_no_opinion_when_there_is_nothing_to_check_against(self):
        # Absent cycle-1 stability, the honest answer is "can't tell",
        # not a fabricated mismatch.
        from dyad_baseline import registration_matches_run

        assert registration_matches_run({"startingConditionIds": ["mou_deal_concluded"]}, [], self._scenario())[0] is True

    def test_the_real_void_run_is_excluded_from_the_loaded_corpus(self):
        # End-to-end: 700254f5 is sealed and in preregistrations/, and must
        # not contribute decisions to any analysis.
        assert all(not o["registration"].startswith("700254f5") for o in load_dyad_decisions())

    def test_the_real_valid_arm_is_still_included(self):
        # The check must not be so blunt it discards the arm that worked.
        assert any(o["registration"].startswith("7f84ea20") for o in load_dyad_decisions())
