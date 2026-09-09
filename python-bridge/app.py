"""
app.py — tiny HTTP wrapper around instinct_qpu.py, proxied by server.js's
new /api/instinct/qpu-reading route (see server.js) the same way
/api/agent/decide proxies to Claude. Deliberately minimal: one endpoint,
no auth of its own (meant to run alongside server.js on localhost/an
internal network, not exposed directly — same trust boundary as any other
internal service this project's Node layer talks to).
"""

import os

from flask import Flask, jsonify, request

from dyad_baseline import build_report as build_ewl_report
from quantum_arena.protocol import MAX_ENTANGLEMENT, MENU
from quantum_arena.session import explain as arena_explain, play as arena_play
from instinct_qpu import read_instinct
from layer1_qpu import collapse_entangled_pair
from q_ai_engine import NationQuantumDeliberationEngine

app = Flask(__name__)
deliberation_engine = NationQuantumDeliberationEngine()


@app.post("/qpu-reading")
def qpu_reading():
    body = request.get_json(silent=True) or {}
    pressure = body.get("pressure")
    entangled_readout = body.get("entangledReadout")  # camelCase in, matching the JS caller

    if not isinstance(pressure, (int, float)):
        return jsonify({"error": "pressure (number, 0-100) is required"}), 400
    if entangled_readout is not None and not isinstance(entangled_readout, (int, float)):
        return jsonify({"error": "entangledReadout, if provided, must be a number (0-1)"}), 400

    reading = read_instinct(pressure, entangled_readout)
    return jsonify(reading)


@app.post("/q-ai-deliberate")
def q_ai_deliberate():
    body = request.get_json(silent=True) or {}
    nation_id = body.get("nation_id", "US")
    pressure = body.get("pressure", 50.0)
    risk_posture = body.get("risk_posture", "dovish")

    if not isinstance(pressure, (int, float)):
        return jsonify({"error": "pressure must be a number (0-100)"}), 400

    result = deliberation_engine.deliberate(nation_id, pressure_index=float(pressure), risk_posture=risk_posture)
    return jsonify(result)


@app.post("/layer1-collapse")
def layer1_collapse():
    # Higher stakes than /qpu-reading: this feeds the actual committed
    # political collapse when the frontend's Tier 2 toggle is on, not a
    # side-channel display — see layer1_qpu.py's module docstring.
    body = request.get_json(silent=True) or {}
    joint = body.get("joint")

    if not isinstance(joint, list) or len(joint) != 4:
        return jsonify({"error": "joint must be an array of exactly 4 {re, im} amplitudes"}), 400
    for amp in joint:
        if not isinstance(amp, dict) or "re" not in amp or "im" not in amp:
            return jsonify({"error": "each joint amplitude must be an object with re and im"}), 400

    try:
        reading = collapse_entangled_pair(joint)
    except ValueError as err:
        # e.g. not normalized — a real validation failure, not a hardware
        # issue, so this is a 400, not falling back to a simulator.
        return jsonify({"error": str(err)}), 400

    return jsonify(reading)


@app.get("/ewl-baseline")
def ewl_baseline():
    # The odd one out among these routes, and deliberately a GET with no
    # body: the other three compute something about a live run, this one
    # returns a fixed theoretical comparison that does not depend on any
    # run state. Nothing it returns feeds simState or the on-chain commit
    # — it cannot, and must not be described as if it could. See
    # ewl_game.py's module docstring; the payload carries that constraint
    # in its own `label` field so it survives being read on its own.
    return jsonify(build_ewl_report())


def _arena_request(body):
    operation_x = body.get("operationX")
    operation_o = body.get("operationO")
    gamma = body.get("gamma")
    if operation_x not in MENU or operation_o not in MENU:
        raise ValueError(f"operations must come from the frozen menu {sorted(MENU)}")
    if not isinstance(gamma, (int, float)) or isinstance(gamma, bool):
        raise ValueError("gamma must be a number")
    if not 0 <= float(gamma) <= MAX_ENTANGLEMENT + 1e-12:
        raise ValueError("gamma must lie in [0, pi/2]")
    return operation_x, operation_o, float(gamma)


@app.post("/arena/play")
def arena_play_route():
    # ONE research observation: a single shot selects the policy pair. Records
    # carry quantum-arena-play/v1 and must never be appended to the Phase 0
    # decision-lab dataset (protocol validation item 10).
    try:
        operation_x, operation_o, gamma = _arena_request(request.get_json(silent=True) or {})
    except ValueError as err:
        return jsonify({"error": str(err)}), 400
    return jsonify(arena_play(operation_x, operation_o, gamma))


@app.post("/arena/explain")
def arena_explain_route():
    # Many-shot estimates for the explanation mode. A DIFFERENT schema, so these
    # cannot be pooled with research observations by a loader that forgot to
    # filter — the protocol requires the two never mix.
    body = request.get_json(silent=True) or {}
    try:
        operation_x, operation_o, gamma = _arena_request(body)
    except ValueError as err:
        return jsonify({"error": str(err)}), 400
    shots = body.get("shots", 4096)
    if not isinstance(shots, int) or isinstance(shots, bool) or not 2 <= shots <= 20000:
        return jsonify({"error": "shots must be an integer between 2 and 20000"}), 400
    return jsonify(arena_explain(operation_x, operation_o, gamma, shots=shots))


@app.get("/arena/menu")
def arena_menu_route():
    return jsonify({
        "menu": {name: list(params) for name, params in MENU.items()},
        "max_entanglement": MAX_ENTANGLEMENT,
        "note": (
            "Frozen by protocol v1.0 question 5. The participant interface must not "
            "show these keys, nor cooperate/defect, nor identify Q as the quantum "
            "option — neutral labels only, mapping recorded in the run record."
        ),
    })


@app.get("/health")
def health():
    return jsonify({"ok": True, "hasToken": bool(os.environ.get("IBM_QUANTUM_TOKEN"))})


if __name__ == "__main__":
    port = int(os.environ.get("PYTHON_BRIDGE_PORT", "5001"))
    app.run(host="127.0.0.1", port=port)
