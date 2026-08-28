import pytest
from q_ai_engine import NationQuantumDeliberationEngine

def test_nation_quantum_deliberation_engine():
    engine = NationQuantumDeliberationEngine(num_qubits=4)
    res = engine.deliberate("US", pressure_index=75.0, risk_posture="hawkish")
    
    assert res["nation_id"] == "US"
    assert res["pressure_index"] == 75.0
    assert res["risk_posture"] == "hawkish"
    assert len(res["collapsed_basis_state"]) == 4
    assert res["posture_decision"] in ["DE_ESCALATE_AND_PRESERVE_STABILITY", "ESCALATE_AND_ASSERT_DETERRENCE"]
    assert res["deliberation_steps"] > 0
    assert res["coherence_at_collapse"] > 0.0

def test_flask_q_ai_deliberate_endpoint():
    from app import app
    client = app.test_client()
    
    response = client.post("/q-ai-deliberate", json={
        "nation_id": "China",
        "pressure": 60.0,
        "risk_posture": "hawkish"
    })
    
    assert response.status_code == 200
    data = response.get_json()
    assert data["nation_id"] == "China"
    assert "posture_decision" in data
    assert "collapsed_basis_state" in data
