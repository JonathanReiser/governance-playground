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

from instinct_qpu import read_instinct

app = Flask(__name__)


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


@app.get("/health")
def health():
    return jsonify({"ok": True, "hasToken": bool(os.environ.get("IBM_QUANTUM_TOKEN"))})


if __name__ == "__main__":
    port = int(os.environ.get("PYTHON_BRIDGE_PORT", "5001"))
    app.run(host="127.0.0.1", port=port)
