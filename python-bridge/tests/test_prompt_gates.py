"""
Tests for prompt_gates.py.

TestTranscription is the load-bearing one. This module's entire premise is
that three specific if/then branches exist in server.js's nation prompts
at specific thresholds. If a prompt is reworded, every number this module
reports becomes a claim about a prompt that no longer exists — and it
would keep reporting them confidently. So the quotes are checked against
the live server.js on every test run, not transcribed once and trusted.
That is the same silent-staleness failure that wasted a preregistered
batch on 2026-09-02, caught here by construction rather than by noticing
a suspicious result afterwards.

Substantive assertions about the published corpus are deliberately NOT
made against the live preregistrations directory: a gates-open arm will
legitimately open gates that no earlier run did, and a test asserting "no
gate has ever opened" would then fail on correct new data. Gate LOGIC is
tested on synthetic values instead, and the scenario baseline — which is
config, not run output — is tested directly.
"""

import pytest

from prompt_gates import GATES, Gate, analyse, scenario_baselines, verify_transcription


class TestTranscription:
    def test_every_quoted_prompt_fragment_is_still_in_server_js(self):
        results = verify_transcription()
        stale = [quote for quote, present in results.items() if not present]
        assert not stale, (
            "these prompt fragments are no longer in server.js, so the thresholds "
            f"in prompt_gates.py may be describing a prompt that no longer exists: {stale}"
        )

    def test_transcription_check_can_actually_fail(self):
        # A checker that only ever returns True would pass the test above
        # while guarding nothing.
        from prompt_gates import SERVER_JS

        source = SERVER_JS.read_text()
        assert "this string is definitely not in server.js" not in source

    def test_every_gate_declares_its_provenance(self):
        for gate in GATES:
            assert gate.quote and gate.server_js_line > 0
            assert gate.direction in ("above", "below")


class TestGateLogic:
    ABOVE = Gate("x", "l", "v", 60.0, "above", "q", 1, "n")
    BELOW = Gate("x", "l", "v", 70.0, "below", "q", 1, "n")

    def test_above_gate_opens_strictly_above_threshold(self):
        assert self.ABOVE.is_open(61.0) is True
        assert self.ABOVE.is_open(60.0) is False   # the prompt says "> 60", not ">="
        assert self.ABOVE.is_open(59.0) is False

    def test_below_gate_opens_strictly_below_threshold(self):
        assert self.BELOW.is_open(69.0) is True
        assert self.BELOW.is_open(70.0) is False
        assert self.BELOW.is_open(71.0) is False

    def test_direction_actually_changes_the_answer(self):
        # Same threshold, opposite directions, same value — if is_open
        # ignored `direction` and always compared one way, these would
        # agree. Comparing the two gates above at a single value would NOT
        # catch that: at 65 both are legitimately open (65 > 60 and 65 < 70).
        up = Gate("x", "l", "v", 60.0, "above", "q", 1, "n")
        down = Gate("x", "l", "v", 60.0, "below", "q", 1, "n")
        assert up.is_open(65.0) is True
        assert down.is_open(65.0) is False
        assert up.is_open(55.0) is False
        assert down.is_open(55.0) is True


class TestScenarioBaseline:
    """
    Config, not run output — stable, and the crux of the finding: the
    scenario starts with every de-escalatory branch closed.
    """

    def test_baseline_values_match_the_scenario_config(self):
        base = scenario_baselines()
        assert base["stability"] == 32.0
        assert base["iran_hardliner_pressure"] == 80.0
        assert base["israel_sentiment"] == 52.0

    def test_baseline_closes_every_de_escalatory_gate(self):
        base = scenario_baselines()
        for gate in GATES:
            assert gate.is_open(base[gate.variable]) is False, (
                f"{gate.nation} {gate.label} is open at baseline — the premise of this module "
                "no longer holds and the writeup needs revisiting"
            )

    def test_israel_baseline_sits_in_the_unguided_band(self):
        # 52 is above the < 45 "visible resolve" trigger and below the > 65
        # diplomacy gate — the prompt gives no directional advice there,
        # which is a different failure from a closed gate and is claimed
        # as such in the module docstring.
        assert 45.0 < scenario_baselines()["israel_sentiment"] < 65.0


class TestAnalyse:
    def test_report_is_structurally_consistent(self):
        report = analyse()
        assert report["cycles_analysed"] > 0
        assert len(report["gates"]) == len(GATES)
        for gate in report["gates"]:
            assert 0 <= gate["cycles_gate_open"] <= gate["cycles_observed"]
            assert gate["observed_min"] <= gate["observed_max"]
            assert gate["ever_open"] == (gate["cycles_gate_open"] > 0)

    def test_any_gate_ever_open_agrees_with_the_per_gate_rows(self):
        report = analyse()
        assert report["any_gate_ever_open"] == any(g["ever_open"] for g in report["gates"])

    def test_observed_values_are_in_range_for_a_0_100_scale(self):
        for gate in analyse()["gates"]:
            assert 0.0 <= gate["observed_min"] <= 100.0
            assert 0.0 <= gate["observed_max"] <= 100.0

    def test_analyse_reports_transcription_status_rather_than_assuming_it(self):
        assert set(analyse()["transcription_verified"]) == {g.quote for g in GATES}
