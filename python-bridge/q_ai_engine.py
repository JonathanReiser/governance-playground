"""
q_ai_engine.py — Q-AI Nation Agent Quantum Deliberation Engine

Provides quantum Hilbert space deliberation and Penrose Orch-OR collapse logic
for geopolitical nation agents (US, China, Taiwan, Japan, Iran, Israel).
"""

import numpy as np
from qiskit import QuantumCircuit, transpile
from qiskit_aer import AerSimulator

# Constants
G_CONSTANT = 6.67430e-11
HBAR = 1.0545718e-34

def calculate_single_tubulin_eg(mass=1.827e-22, displacement=1.0e-11, radius=4.0e-9):
    return G_CONSTANT * (mass ** 2) * (displacement ** 2) / (radius ** 3)

def calculate_coherence_metric(statevector, num_qubits):
    state = np.asarray(statevector)
    
    # Calculate expectation values <Z_i>
    z_expects = []
    for i in range(num_qubits):
        val = 0.0
        for state_idx in range(len(state)):
            bit = (state_idx >> i) & 1
            prob = np.abs(state[state_idx]) ** 2
            val += prob * (1.0 if bit == 0 else -1.0)
        z_expects.append(val)
        
    # Calculate <Z_i Z_j>
    zz_expects = np.zeros((num_qubits, num_qubits))
    for i in range(num_qubits):
        for j in range(num_qubits):
            if i == j:
                zz_expects[i, j] = 1.0
                continue
            val = 0.0
            for state_idx in range(len(state)):
                bit_i = (state_idx >> i) & 1
                bit_j = (state_idx >> j) & 1
                sign_i = 1.0 if bit_i == 0 else -1.0
                sign_j = 1.0 if bit_j == 0 else -1.0
                prob = np.abs(state[state_idx]) ** 2
                val += prob * sign_i * sign_j
            zz_expects[i, j] = val
            
    c_matrix = np.zeros((num_qubits, num_qubits))
    for i in range(num_qubits):
        for j in range(num_qubits):
            c_matrix[i, j] = zz_exp[i, j] - z_expects[i] * z_expects[j] if 'zz_exp' in locals() else zz_expects[i, j] - z_expects[i] * z_expects[j]
            
    return np.sum(np.abs(c_matrix)), c_matrix

class NationQuantumDeliberationEngine:
    def __init__(self, num_qubits=4, eg_scale=1.0e17):
        self.num_qubits = num_qubits
        self.eg_scale = eg_scale
        self.single_eg = calculate_single_tubulin_eg() * eg_scale
        self.simulator = AerSimulator()

    def deliberate(self, nation_id, pressure_index=50.0, risk_posture="dovish", dt=0.005, max_steps=200):
        """
        Runs quantum deliberation for a nation agent until Penrose OR collapse.
        """
        # Map geopolitical pressure (0-100) to quantum parameters
        p_norm = np.clip(pressure_index / 100.0, 0.0, 1.0)
        
        if risk_posture == "hawkish":
            rx_angle = np.pi * p_norm
            ry_angle = np.pi * (1.0 - p_norm) * 0.5
        else:
            rx_angle = np.pi * p_norm * 0.5
            ry_angle = np.pi * (1.0 - p_norm)
            
        J_coupling = 1.0e-3 * (1.0 + p_norm)
        g_tunneling = 5.0e-4 * (2.0 - p_norm)
        
        # Build initial quantum circuit
        qc = QuantumCircuit(self.num_qubits)
        for q in range(self.num_qubits):
            qc.rx(rx_angle, q)
            qc.ry(ry_angle, q)
            
        for q in range(self.num_qubits - 1):
            qc.cx(q, q + 1)
            
        qc.save_statevector()
        
        t_qc = transpile(qc, self.simulator)
        result = self.simulator.run(t_qc).result()
        current_statevector = np.array(result.get_statevector(t_qc))
        
        accumulated_action = 0.0
        coherence_at_collapse = 1.0
        
        for step in range(1, max_steps + 1):
            w_c, _ = calculate_coherence_metric(current_statevector, self.num_qubits)
            inst_eg = self.single_eg * w_c
            accumulated_action += inst_eg * dt
            
            # Check Penrose Collapse Threshold
            if accumulated_action >= HBAR:
                coherence_at_collapse = w_c
                probs = np.abs(current_statevector) ** 2
                probs /= np.sum(probs)
                
                collapsed_idx = np.random.choice(len(current_statevector), p=probs)
                bin_str = format(collapsed_idx, f'0{self.num_qubits}b')
                
                # Map basis state to geopolitical strategic posture
                if collapsed_idx % 2 == 0:
                    posture = "DE_ESCALATE_AND_PRESERVE_STABILITY"
                else:
                    posture = "ESCALATE_AND_ASSERT_DETERRENCE"
                    
                return {
                    "nation_id": nation_id,
                    "pressure_index": pressure_index,
                    "risk_posture": risk_posture,
                    "collapsed_basis_state": bin_str,
                    "posture_decision": posture,
                    "deliberation_steps": step,
                    "coherence_at_collapse": float(coherence_at_collapse),
                    "action_accumulated": float(accumulated_action)
                }
                
        # Fallback if threshold not reached in max_steps
        probs = np.abs(current_statevector) ** 2
        probs /= np.sum(probs)
        collapsed_idx = np.random.choice(len(current_statevector), p=probs)
        bin_str = format(collapsed_idx, f'0{self.num_qubits}b')
        posture = "DE_ESCALATE_AND_PRESERVE_STABILITY" if (collapsed_idx % 2 == 0) else "ESCALATE_AND_ASSERT_DETERRENCE"
        
        return {
            "nation_id": nation_id,
            "pressure_index": pressure_index,
            "risk_posture": risk_posture,
            "collapsed_basis_state": bin_str,
            "posture_decision": posture,
            "deliberation_steps": max_steps,
            "coherence_at_collapse": float(coherence_at_collapse),
            "action_accumulated": float(accumulated_action)
        }
