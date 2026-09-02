"""
prompt_gates.py — do the agents' own prompts ever offer them a
de-escalatory branch, given where the scenario actually starts?

WHY THIS EXISTS. dyad_baseline.py reports that across the published
preregistered batches the Iran/Israel agents land on mutual escalation in
essentially every cycle, and flags its own classifier as near-degenerate
because `conflictEvents` is never negative in any published cycle. This
module asks the follow-up question: is that a property of the AGENTS, or
of where the SCENARIO STARTS?

The distinction matters for every result this repo publishes. If the
agents escalate because their prompts' de-escalatory branches are gated
behind thresholds the scenario never approaches, then "the agents
escalate" is substantially a restatement of the baseline configuration,
and every published finding is bounded by a regime it never left. That
does not make those findings wrong. It does make them conditional, in a
way nothing currently states.

WHAT IT CHECKS. The nation prompts in server.js are explicit
if/then ladders over world-state variables — prospect-theory risk frames,
two-level-games domestic constraints. Each GATE below records one such
branch: the variable, the threshold, the direction that reaches the
de-escalatory advice, and the server.js line it is quoted from. The
module then walks every published preregistered cycle and reports whether
that gate was ever open.

THRESHOLDS ARE TRANSCRIBED, NOT PARSED. They are declared as data here,
each with a server.js line reference and the prompt's own wording,
because parsing thresholds out of JavaScript template strings would be
brittle and would fail silently when the prompt is reworded — the exact
class of silent-staleness bug that wasted a preregistered batch on
2026-09-02 (see scripts/run-batch.js's guards). A transcription can go
stale too, so verify_transcription() re-reads server.js and checks each
quoted fragment is still present, and the tests fail if one is not.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from dyad_baseline import PREREGISTRATIONS_DIR, REPO_ROOT, registration_matches_run

SERVER_JS = REPO_ROOT / "server.js"


@dataclass(frozen=True)
class Gate:
    """One if/then branch in a nation agent's system prompt."""

    nation: str
    label: str
    variable: str          # where the value lives in the published cycle record
    threshold: float
    direction: str         # "above" or "below" — which side reaches de-escalatory advice
    quote: str             # verbatim fragment from server.js, checked by verify_transcription()
    server_js_line: int
    note: str

    def is_open(self, value: float) -> bool:
        return value > self.threshold if self.direction == "above" else value < self.threshold


GATES = (
    Gate(
        nation="iran",
        label="prospect-theory gains frame",
        variable="stability",
        threshold=60.0,
        direction="above",
        quote="stability > 60: gains frame",
        server_js_line=136,
        note="the only branch in Iran's ladder that counsels restraint; 30-60 explicitly names "
             "'proxy escalation' and < 30 says 'asymmetric risks become rational'",
    ),
    Gate(
        nation="iran",
        label="two-level-games domestic constraint",
        variable="iran_hardliner_pressure",
        threshold=70.0,
        direction="below",
        quote="If > 70: any deal concession triggers a legitimacy crisis",
        server_js_line=132,
        note="above it, the prompt requires compensating 'with visible defiance elsewhere'",
    ),
    Gate(
        nation="israel",
        label="political capital for diplomacy",
        variable="israel_sentiment",
        threshold=65.0,
        direction="above",
        quote="If > 65: political capital available for diplomatic risk-taking",
        server_js_line=229,
        note="below 45 the prompt instead calls for 'visible resolve'; between 45 and 65 it gives "
             "no directional guidance at all, leaving the Operational Code section to carry",
    ),
)

# Baselines as configured in scenarios/middle-east-2026.config.cjs. Read from
# the scenario JSON at runtime rather than hardcoded, so this can't drift.
SCENARIO_JSON = REPO_ROOT / "frontend" / "src" / "scenarios" / "middle-east-2026.json"


def verify_transcription() -> dict[str, bool]:
    """
    Re-read server.js and confirm every transcribed quote is still present.
    A reworded prompt silently invalidates this whole module's premise, so
    this is checked rather than assumed.
    """
    source = SERVER_JS.read_text()
    return {gate.quote: (gate.quote in source) for gate in GATES}


def scenario_baselines() -> dict[str, float]:
    scenario = json.loads(SCENARIO_JSON.read_text())
    metrics = {m["id"]: m["startingValue"] for m in scenario["simulation"]["metrics"]}
    nations = {n["id"]: n for n in scenario["nations"]}
    return {
        "stability": float(metrics["stability_index"]),
        "iran_hardliner_pressure": float(nations["iran"]["governance"]["hardlinerPressure"]),
        "israel_sentiment": float(nations["israel"]["population"]["sentiment"]),
    }


def _running_values(registration: dict, cycles: list[dict]) -> list[dict[str, float]]:
    """
    Reconstruct the three gate variables per cycle. `stability` is recorded
    directly in each cycle's committed block; hardlinerPressure and
    sentiment are not, so they are accumulated from the agents' own deltas
    off the arm's starting value — the same way agents.js carries them in
    agentMemory.
    """
    scenario = json.loads(SCENARIO_JSON.read_text())
    proposals = {p["id"]: p for p in scenario.get("startingConditionProposals", [])}
    base = scenario_baselines()

    hardliner = base["iran_hardliner_pressure"]
    sentiment = base["israel_sentiment"]
    for condition_id in registration.get("startingConditionIds") or []:
        overrides = (proposals.get(condition_id) or {}).get("overrides") or {}
        iran = ((overrides.get("nations") or {}).get("iran") or {}).get("governance") or {}
        israel = ((overrides.get("nations") or {}).get("israel") or {}).get("population") or {}
        if "hardlinerPressure" in iran:
            hardliner = float(iran["hardlinerPressure"])
        if "sentiment" in israel:
            sentiment = float(israel["sentiment"])

    rows = []
    for cycle in cycles:
        committed = cycle.get("committed") or {}
        rows.append(
            {
                "stability": float(committed["stability"]) if committed.get("stability") is not None else None,
                "iran_hardliner_pressure": hardliner,
                "israel_sentiment": sentiment,
            }
        )
        for nation, field, key in (
            ("iran", "hardlinerPressure", "iran_hardliner_pressure"),
            ("israel", "publicSentiment", "israel_sentiment"),
        ):
            raw = (cycle.get("decisions") or {}).get(nation) or {}
            deltas = (raw.get("decision", raw) or {}).get("metricDeltas") or {}
            if deltas.get(field) is not None:
                value = (hardliner if key == "iran_hardliner_pressure" else sentiment) + deltas[field]
                value = max(0.0, min(100.0, value))
                if key == "iran_hardliner_pressure":
                    hardliner = value
                else:
                    sentiment = value
    return rows


def analyse(directory: Path | str = PREREGISTRATIONS_DIR, scenario_id: str = "middle-east-2026") -> dict:
    directory = Path(directory)
    observed: dict[str, list[float]] = {gate.variable: [] for gate in GATES}
    cycle_count = 0
    excluded: list[dict] = []
    scenario = json.loads(SCENARIO_JSON.read_text())

    for result_path in sorted(directory.glob("*.result.json")):
        digest = result_path.name.split(".")[0]
        registration_path = directory / f"{digest}.registration.json"
        if not registration_path.exists():
            continue
        registration = json.loads(registration_path.read_text())
        if registration.get("scenarioId") != scenario_id:
            continue
        result = json.loads(result_path.read_text())
        trials = result.get("trials") or [{"cycles": result.get("cycles", [])}]

        # Two of the three gate variables are reconstructed from the declared
        # condition, so a run that didn't actually execute its registration
        # would contribute values it never had. Excluded and reported rather
        # than silently mixed in — see registration_matches_run().
        all_cycles = [c for t in trials for c in t.get("cycles", [])]
        matches, reason = registration_matches_run(registration, all_cycles, scenario)
        if not matches:
            excluded.append({"registration": digest, "cycles": len(all_cycles), "reason": reason})
            continue

        for trial in trials:
            cycles = trial.get("cycles", [])
            cycle_count += len(cycles)
            for row in _running_values(registration, cycles):
                for key, value in row.items():
                    if value is not None:
                        observed[key].append(value)

    baselines = scenario_baselines()
    gates = []
    for gate in GATES:
        values = observed[gate.variable]
        open_count = sum(1 for v in values if gate.is_open(v))
        gates.append(
            {
                "nation": gate.nation,
                "label": gate.label,
                "variable": gate.variable,
                "threshold": gate.threshold,
                "direction": gate.direction,
                "baseline": baselines[gate.variable],
                "baseline_opens_gate": gate.is_open(baselines[gate.variable]),
                "observed_min": min(values) if values else None,
                "observed_max": max(values) if values else None,
                "cycles_gate_open": open_count,
                "cycles_observed": len(values),
                "ever_open": open_count > 0,
                "server_js_line": gate.server_js_line,
                "quote": gate.quote,
                "note": gate.note,
            }
        )

    return {
        "scenario_id": scenario_id,
        "cycles_analysed": cycle_count,
        "excluded_runs": excluded,
        "transcription_verified": verify_transcription(),
        "gates": gates,
        "any_gate_ever_open": any(g["ever_open"] for g in gates),
    }


def format_report(report: dict) -> str:
    lines = [
        "=" * 78,
        "  PROMPT GATES — was a de-escalatory branch ever reachable?",
        "=" * 78,
        f"  scenario {report['scenario_id']}, {report['cycles_analysed']} published cycles",
        "",
    ]
    for entry in report.get("excluded_runs", []):
        lines.append(f"  EXCLUDED {entry['registration'][:8]} ({entry['cycles']} cycles): {entry['reason']}")
    if report.get("excluded_runs"):
        lines.append("")
    stale = [q for q, ok in report["transcription_verified"].items() if not ok]
    if stale:
        lines += ["  !! TRANSCRIPTION STALE — these quotes are no longer in server.js:"]
        lines += [f"       {q}" for q in stale]
        lines += ["     Re-read the prompts before trusting anything below.", ""]

    for gate in report["gates"]:
        arrow = ">" if gate["direction"] == "above" else "<"
        lines.append(f"  [{gate['nation']}] {gate['label']}  (server.js:{gate['server_js_line']})")
        lines.append(f"      \"{gate['quote']}\"")
        lines.append(
            f"      opens when {gate['variable']} {arrow} {gate['threshold']:.0f}"
            f"  |  baseline {gate['baseline']:.0f} -> {'OPEN' if gate['baseline_opens_gate'] else 'CLOSED'}"
        )
        lines.append(
            f"      observed range [{gate['observed_min']:.0f}, {gate['observed_max']:.0f}]"
            f"  |  open in {gate['cycles_gate_open']} of {gate['cycles_observed']} cycles"
        )
        lines.append(f"      {gate['note']}")
        lines.append("")

    lines.append(
        "  Any de-escalatory branch ever reachable: "
        + ("YES" if report["any_gate_ever_open"] else "NO — in no published cycle did any of these open")
    )
    lines.append("=" * 78)
    return "\n".join(lines)


if __name__ == "__main__":  # pragma: no cover
    print(format_report(analyse()))
