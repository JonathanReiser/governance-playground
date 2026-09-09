"""
dyad_baseline.py — puts the three reference points from ewl_game.py next
to what the Claude-powered nation agents ACTUALLY did, for this project's
one entangled dyad.

The deliverable is the comparison, not the quantum number. Reporting that
the agents landed on the classical Nash point is exactly as publishable a
result as reporting that they landed anywhere else, and the code is
written so that either outcome falls out of the same procedure. Nothing
in this module can, or is meant to, move the agents anywhere — see
ewl_game.py's docstring for the constraint this whole comparison lives
under.

THE DYAD. middle-east-2026's aiAgents.entangled block pairs Iran
(hardline / pragmatic) with Israel (hawkish / dovish). That is a security
dilemma: each side's escalation is individually attractive and jointly
ruinous. Mapping onto game-theoretic labels, escalate = defect and
de-escalate = cooperate:

    Iran   hardline -> D      pragmatic -> C
    Israel hawkish  -> D      dovish    -> C

THE PAYOFF MATRIX IS STIPULATED, NOT MEASURED. DYAD_PAYOFFS below is the
canonical PD matrix, adopted as an ordinal model of the security dilemma.
It is not fitted to the scenario's own numbers, and it should not be:
this project's metrics (stability, dealIntegrity, proxyActivity) are a
0-100 simulation scale, not either nation's utility function, and
inventing a utility function from them so that a quantum result came out
a particular way is the failure mode this comparison exists to avoid. So
the matrix is declared, its PD structure is verified rather than assumed
(is_prisoners_dilemma), and it can be replaced wholesale by a caller who
wants to argue for different numbers. Every equilibrium reported is
re-derived from whatever matrix is actually passed in.

HOW A DECISION IS CLASSIFIED. The agents write natural language plus a
structured `metricDeltas` block; they never emit a C/D label, so one has
to be derived, and the derivation is a modelling choice that could
quietly determine the answer. Two independent rules are therefore
computed and both are always reported:

  * conflict_events (primary) — the sign of the agent's own
    `conflictEvents` delta. The most direct available statement of
    whether the action it chose adds conflict.
  * indicator_vote (robustness) — a sign vote over conflictEvents (up =
    escalate), dealIntegrity (down = escalate) and stability (down =
    escalate).

`proxyActivity` is deliberately excluded from the vote even though it is
present on every decision, because its escalatory direction is
nation-dependent rather than neutral: Iran escalates by RAISING proxy
activity, while Israel escalates by striking convoys, which LOWERS it.
Including it would encode an assumption about who is doing what, not
measure it.

DISCRIMINATING POWER IS REPORTED, NOT ASSUMED. A classifier that returns
"escalate" for every decision agrees with the data trivially. So the
report carries the classification's own spread, and flags when one class
takes 95% or more — because in that case the honest reading is that the
runs available contain almost no de-escalatory variation to detect,
which is a fact about the dataset and not a finding about equilibria.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from ewl_game import (
    CANONICAL_PD,
    MAX_ENTANGLEMENT,
    PROFILES,
    classical_nash,
    correlated_equilibrium,
    entanglement_threshold,
    ewl_equilibria,
    is_correlated_equilibrium,
    is_prisoners_dilemma,
)

# Player 1 is Iran, player 2 is Israel — fixed here so every profile
# string in this module reads Iran-first, matching ewl_game's convention.
DYAD = {
    "scenario_id": "middle-east-2026",
    "player1": {"nation": "iran", "cooperate": "pragmatic", "defect": "hardline"},
    "player2": {"nation": "israel", "cooperate": "dovish", "defect": "hawkish"},
}

DYAD_PAYOFFS = CANONICAL_PD  # stipulated ordinal model — see module docstring

REPO_ROOT = Path(__file__).resolve().parent.parent
PREREGISTRATIONS_DIR = REPO_ROOT / "preregistrations"

DEGENERATE_CLASSIFIER_THRESHOLD = 0.95


def classify_conflict_events(deltas: dict) -> str | None:
    """Primary rule. None means the agent reported no change either way."""
    value = deltas.get("conflictEvents")
    if value is None or value == 0:
        return None
    return "D" if value > 0 else "C"


def classify_indicator_vote(deltas: dict) -> str | None:
    """
    Robustness rule. Nation-neutral indicators only (see module docstring
    for why proxyActivity is not among them). None on an exact tie or when
    every indicator is absent or zero.
    """
    escalatory = 0
    de_escalatory = 0
    for field, escalates_when_positive in (("conflictEvents", True), ("dealIntegrity", False), ("stability", False)):
        value = deltas.get(field)
        if value is None or value == 0:
            continue
        if (value > 0) == escalates_when_positive:
            escalatory += 1
        else:
            de_escalatory += 1
    if escalatory == de_escalatory:
        return None
    return "D" if escalatory > de_escalatory else "C"


CLASSIFIERS = {"conflict_events": classify_conflict_events, "indicator_vote": classify_indicator_vote}


# A run is only usable as evidence about its declared condition if the run
# actually executed that condition. That is not a hypothetical: registration
# 700254f5 declares mou_deal_concluded but ran at plain baseline, because the
# generated scenario JSON was stale and applyStartingConditionOverrides()
# no-ops on an unknown id (fixed in scripts/run-batch.js, but the sealed
# result is permanent and stays in the record on purpose).
#
# Trusting the registration would silently corrupt any analysis that
# reconstructs starting values from it — prompt_gates.py counted 20 phantom
# "gate open" cycles from this one run before the check below existed.
#
# The check is derived rather than hardcoded so it catches the next one too:
# cycle-1 committed stability is real recorded data, so it can be compared
# against what the declared condition should have produced. The agents move
# stability by at most a few points before the first commit, so a gap this
# large means the override never applied.
STABILITY_MISMATCH_TOLERANCE = 15.0


def declared_starting_stability(registration: dict, scenario: dict) -> float:
    """What cycle-1 stability should start from, per the declared condition."""
    metrics = {m["id"]: m["startingValue"] for m in scenario["simulation"]["metrics"]}
    value = float(metrics["stability_index"])
    proposals = {p["id"]: p for p in scenario.get("startingConditionProposals", [])}
    for condition_id in registration.get("startingConditionIds") or []:
        overrides = (proposals.get(condition_id) or {}).get("overrides") or {}
        if "stability_index" in (overrides.get("metrics") or {}):
            value = float(overrides["metrics"]["stability_index"])
    return value


def registration_matches_run(registration: dict, cycles: list[dict], scenario: dict) -> tuple[bool, str | None]:
    """
    Whether a sealed run actually executed the condition it declared.
    Returns (matches, reason-if-not).
    """
    observed = [
        (c.get("committed") or {}).get("stability")
        for c in cycles
        if c.get("cycle") == 1 and (c.get("committed") or {}).get("stability") is not None
    ]
    if not observed:
        return True, None  # nothing to check against; don't invent a failure
    declared = declared_starting_stability(registration, scenario)
    median = sorted(observed)[len(observed) // 2]
    if abs(median - declared) > STABILITY_MISMATCH_TOLERANCE:
        return False, (
            f"declared condition implies starting stability {declared:.0f}, but cycle-1 committed "
            f"stability was {median:.0f} — the override did not apply and this run did not execute "
            f"its registration"
        )
    return True, None


def _iter_cycles(result: dict):
    if "trials" in result:
        for trial in result["trials"]:
            for cycle in trial.get("cycles", []):
                yield cycle
    else:
        for cycle in result.get("cycles", []):
            yield cycle


def _decision_body(raw: dict | None) -> dict | None:
    """
    Two shapes exist in preregistrations/: most runs wrap the model output
    under `decision` alongside `model`/`usage`, one earlier run stores it
    flat. A failed agent call is recorded as `{"error": ...}` and is
    skipped rather than guessed at.
    """
    if not isinstance(raw, dict):
        return None
    body = raw.get("decision", raw)
    return body if isinstance(body, dict) and "metricDeltas" in body else None


def load_dyad_decisions(directory: Path | str = PREREGISTRATIONS_DIR, scenario_id: str = DYAD["scenario_id"]) -> list[dict]:
    """
    Every published preregistered cycle for this scenario that carries
    both nations' decisions. Cycles where either agent call failed are
    dropped, and counted, rather than silently half-used.
    """
    directory = Path(directory)
    p1_nation, p2_nation = DYAD["player1"]["nation"], DYAD["player2"]["nation"]
    observations = []

    for result_path in sorted(directory.glob("*.result.json")):
        digest = result_path.name.split(".")[0]
        registration_path = directory / f"{digest}.registration.json"
        if not registration_path.exists():
            continue
        registration = json.loads(registration_path.read_text())
        if registration.get("scenarioId") != scenario_id:
            continue
        result = json.loads(result_path.read_text())

        # Skip runs that didn't execute the condition they declared — their
        # decisions are real, but they are not evidence about that condition.
        scenario = json.loads((REPO_ROOT / "frontend" / "src" / "scenarios" / f"{scenario_id}.json").read_text())
        matches, _ = registration_matches_run(registration, list(_iter_cycles(result)), scenario)
        if not matches:
            continue

        for cycle in _iter_cycles(result):
            decisions = cycle.get("decisions") or {}
            p1 = _decision_body(decisions.get(p1_nation))
            p2 = _decision_body(decisions.get(p2_nation))
            if p1 is None or p2 is None:
                continue
            observations.append(
                {
                    "registration": digest,
                    # None (field absent) and [] (explicitly no override) are kept
                    # distinct — they are different claims about the run.
                    "starting_conditions": (
                        None
                        if registration.get("startingConditionIds") is None
                        else tuple(registration["startingConditionIds"])
                    ),
                    "cycle": cycle.get("cycle"),
                    "p1_deltas": p1.get("metricDeltas", {}),
                    "p2_deltas": p2.get("metricDeltas", {}),
                    "quantum_labels": {
                        p1_nation: (cycle.get("quantum") or {}).get(p1_nation),
                        p2_nation: (cycle.get("quantum") or {}).get(p2_nation),
                    },
                }
            )

    return observations


def _profile_summary(observations: list[dict], classifier_name: str, payoffs=DYAD_PAYOFFS) -> dict:
    classify = CLASSIFIERS[classifier_name]
    counts: Counter[str] = Counter()
    unresolved = 0
    for observation in observations:
        a = classify(observation["p1_deltas"])
        b = classify(observation["p2_deltas"])
        if a is None or b is None:
            unresolved += 1
            continue
        counts[a + b] += 1

    resolved = sum(counts.values())
    distribution = {profile: (counts.get(profile, 0) / resolved if resolved else 0.0) for profile in PROFILES}
    expected = (
        sum(distribution[k] * payoffs.payoff(k, 0) for k in PROFILES),
        sum(distribution[k] * payoffs.payoff(k, 1) for k in PROFILES),
    )
    dominant_share = max(distribution.values()) if resolved else 0.0

    return {
        "classifier": classifier_name,
        "resolved_cycles": resolved,
        "unresolved_cycles": unresolved,
        "profile_counts": {profile: counts.get(profile, 0) for profile in PROFILES},
        "profile_distribution": {k: round(v, 6) for k, v in distribution.items()},
        "realised_expected_payoffs": (round(expected[0], 6), round(expected[1], 6)),
        "modal_profile": max(PROFILES, key=lambda k: counts.get(k, 0)) if resolved else None,
        "dominant_share": round(dominant_share, 6),
        "classifier_is_near_degenerate": bool(dominant_share >= DEGENERATE_CLASSIFIER_THRESHOLD),
        "degeneracy_note": (
            "one profile takes >=95% of resolved cycles, so this classification has almost no "
            "discriminating power on this dataset — read it as a property of the runs available, "
            "not as evidence about equilibria"
            if dominant_share >= DEGENERATE_CLASSIFIER_THRESHOLD
            else None
        ),
        "is_itself_a_correlated_equilibrium": is_correlated_equilibrium(distribution, payoffs) if resolved else None,
    }


def _by_arm(observations: list[dict], classifier_name: str) -> list[dict]:
    """
    The same summary split by preregistered starting conditions. Worth
    reporting separately because most published batches deliberately seed
    punitive conditions; if the as-researched arm behaves the same way,
    the overall picture is not just an artifact of that seeding.
    """
    arms: dict[tuple | None, list[dict]] = {}
    for observation in observations:
        arms.setdefault(observation["starting_conditions"], []).append(observation)
    rows = []
    for conditions, subset in sorted(arms.items(), key=lambda kv: ("",) if kv[0] is None else kv[0] or ("",)):
        summary = _profile_summary(subset, classifier_name)
        if conditions is None:
            label = ["(no starting conditions recorded)"]
        else:
            label = list(conditions) or ["(as-researched baseline)"]
        rows.append(
            {
                "starting_conditions": label,
                "cycles": len(subset),
                "resolved_cycles": summary["resolved_cycles"],
                "modal_profile": summary["modal_profile"],
                "profile_counts": summary["profile_counts"],
            }
        )
    return rows


def build_report(
    observations: list[dict] | None = None,
    payoffs=DYAD_PAYOFFS,
    gamma: float = MAX_ENTANGLEMENT,
) -> dict:
    """
    The whole deliverable in one object: the three reference points, then
    where the agents actually landed relative to them, under both
    classifiers.
    """
    observations = load_dyad_decisions() if observations is None else observations

    nash = classical_nash(payoffs)
    correlated = correlated_equilibrium(payoffs)
    quantum = ewl_equilibria(payoffs, gamma)
    threshold = entanglement_threshold(payoffs)

    observed = {name: _profile_summary(observations, name, payoffs) for name in CLASSIFIERS}
    classifiers_agree = len({summary["modal_profile"] for summary in observed.values()}) == 1

    # Two different questions, both worth reporting, because they come
    # apart: chicken's correlated set is strictly bigger than its Nash set
    # yet buys no extra welfare over the best pure Nash, while a strict
    # PD's correlated set collapses onto Nash entirely.
    nash_welfares = [sum(entry["payoffs"]) for entry in nash["pure"]]
    if nash["mixed"] is not None:
        nash_welfares.append(sum(nash["mixed"]["expected_payoffs"]))
    correlated_beats_nash = (
        correlated["welfare_range"][1] > max(nash_welfares) + 1e-9 if nash_welfares else None
    )

    return {
        "label": "THEORY / COUNTERFACTUAL — not a mechanism acting on any run",
        "dyad": DYAD,
        "payoff_matrix": {
            "source": "stipulated ordinal model of the security dilemma, not fitted to scenario metrics",
            "matrix": payoffs.as_dict(),
            "structure_check": is_prisoners_dilemma(payoffs),
        },
        "reference_points": {
            "classical_nash": nash,
            "classical_correlated_equilibrium": correlated,
            "correlated_welfare_exceeds_best_nash_welfare": correlated_beats_nash,
            "correlated_polytope_strictly_larger_than_nash_set": not correlated["is_singleton"],
            "ewl_quantum_restricted": quantum,
            "ewl_entanglement_threshold": threshold,
        },
        "observed": {
            "total_cycles": len(observations),
            "by_classifier": observed,
            "classifiers_agree_on_modal_profile": classifiers_agree,
            "by_starting_conditions": _by_arm(observations, "conflict_events"),
        },
    }


def format_report(report: dict) -> str:
    """Terminal rendering of build_report(), for the CLI below."""
    lines = [
        "=" * 74,
        "  EWL BASELINE — " + report["label"],
        "=" * 74,
        "",
        f"Dyad: {report['dyad']['player1']['nation']} (P1) / {report['dyad']['player2']['nation']} (P2)"
        f" — scenario {report['dyad']['scenario_id']}",
        f"  P1  C = {report['dyad']['player1']['cooperate']:<10} D = {report['dyad']['player1']['defect']}",
        f"  P2  C = {report['dyad']['player2']['cooperate']:<10} D = {report['dyad']['player2']['defect']}",
        "",
        "Payoff matrix (" + report["payoff_matrix"]["source"] + "):",
    ]
    for profile, values in report["payoff_matrix"]["matrix"].items():
        lines.append(f"  {profile}  ({values[0]:.2f}, {values[1]:.2f})")
    lines.append(f"  is a prisoner's dilemma: {report['payoff_matrix']['structure_check']['is_prisoners_dilemma']}")
    lines.append("")

    ref = report["reference_points"]
    lines.append("THREE REFERENCE POINTS")
    lines.append("-" * 74)
    pure = ", ".join(f"{e['profile']} -> ({e['payoffs'][0]:.2f}, {e['payoffs'][1]:.2f})" for e in ref["classical_nash"]["pure"])
    lines.append(f"  1. Classical Nash                 {pure or 'no pure equilibrium'}")
    if ref["classical_nash"]["mixed"] is None:
        lines.append("                                    (no interior mixed equilibrium)")

    correlated = ref["classical_correlated_equilibrium"]
    payoff_pair = correlated["expected_payoffs"]
    lines.append(f"  2. Classical correlated (Aumann)  welfare-max -> ({payoff_pair[0]:.2f}, {payoff_pair[1]:.2f})")
    if correlated["is_singleton"]:
        lines.append(
            f"                                    polytope is the single point {correlated['unique_profile']} — "
            "a correlating device buys nothing here"
        )
    else:
        low, high = correlated["welfare_range"]
        lines.append(f"                                    welfare range across the polytope: {low:.2f} to {high:.2f}")
    lines.append(
        f"                                    beats best Nash on welfare: "
        f"{ref['correlated_welfare_exceeds_best_nash_welfare']}; "
        f"larger set than Nash: {ref['correlated_polytope_strictly_larger_than_nash_set']}"
    )

    quantum = ", ".join(f"{e['profile']} -> ({e['payoffs'][0]:.2f}, {e['payoffs'][1]:.2f})" for e in ref["ewl_quantum_restricted"]["equilibria"])
    lines.append(f"  3. EWL quantum (restricted set)   {quantum or 'no pure equilibrium'}")
    lines.append(f"                                    {ref['ewl_quantum_restricted']['caveat']}")
    threshold = ref["ewl_entanglement_threshold"]
    if threshold["threshold"] is not None:
        lines.append(
            f"                                    needs entanglement gamma >= {threshold['threshold']:.4f} rad "
            f"(max is {MAX_ENTANGLEMENT:.4f})"
        )
    lines.append("")

    observed = report["observed"]
    lines.append(f"WHERE THE AGENTS ACTUALLY LANDED  ({observed['total_cycles']} nation-cycle pairs)")
    lines.append("-" * 74)
    for name, summary in observed["by_classifier"].items():
        counts = summary["profile_counts"]
        spread = "  ".join(f"{profile}={counts[profile]}" for profile in PROFILES)
        lines.append(f"  [{name}]  resolved {summary['resolved_cycles']}, unresolved {summary['unresolved_cycles']}")
        lines.append(f"      {spread}")
        realised = summary["realised_expected_payoffs"]
        lines.append(f"      modal profile {summary['modal_profile']} — realised payoffs ({realised[0]:.2f}, {realised[1]:.2f})")
        lines.append(f"      is itself a correlated equilibrium: {summary['is_itself_a_correlated_equilibrium']}")
        if summary["degeneracy_note"]:
            lines.append(f"      CAVEAT: {summary['degeneracy_note']}")
    lines.append(f"  classifiers agree on modal profile: {observed['classifiers_agree_on_modal_profile']}")
    lines.append("")

    lines.append("BY PREREGISTERED ARM (primary classifier)")
    lines.append("-" * 74)
    for row in observed["by_starting_conditions"]:
        counts = "  ".join(f"{profile}={row['profile_counts'][profile]}" for profile in PROFILES)
        lines.append(
            f"  {row['modal_profile']}  {row['resolved_cycles']}/{row['cycles']} resolved  "
            f"{counts}   {'+'.join(row['starting_conditions'])}"
        )
    lines.append("")
    lines.append("=" * 74)
    return "\n".join(lines)


def main() -> None:  # pragma: no cover — CLI shell around build_report()
    import argparse

    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("--json", action="store_true", help="emit the report object instead of the rendered table")
    args = parser.parse_args()

    report = build_report()
    print(json.dumps(report, indent=2, default=str) if args.json else format_report(report))


if __name__ == "__main__":  # pragma: no cover
    main()
