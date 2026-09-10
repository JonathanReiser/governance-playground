"use strict";

/**
 * Serverless implementation of the frozen Quantum Policy Tic-Tac-Toe protocol.
 *
 * The Python/NumPy implementation remains the independent scientific reference
 * and the Qiskit implementation remains the hardware path. This small Node port
 * exists so the public Vercel function can run the arena without a long-lived
 * Python process. Keep changes locked to protocol v1.0 and verify them against
 * test/fixtures/quantumArenaPythonReference.json.
 */

const crypto = require("crypto");

const BASIS = Object.freeze(["CC", "CD", "DC", "DD"]);
const MAX_ENTANGLEMENT = Math.PI / 2;
const MENU = Object.freeze({
  C: Object.freeze([0, 0]),
  D: Object.freeze([Math.PI, 0]),
  M: Object.freeze([Math.PI / 2, 0]),
  Q: Object.freeze([0, Math.PI / 2]),
});
const BIMATRIX = Object.freeze({
  CC: Object.freeze([0, 0]),
  CD: Object.freeze([-1, 2 / 3]),
  DC: Object.freeze([2 / 3, -1]),
  DD: Object.freeze([-2 / 3, -2 / 3]),
});
const POSITIONAL_ORDER = Object.freeze([4, 0, 2, 6, 8, 1, 3, 5, 7]);
const WIN_LINES = Object.freeze([
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
]);

const complex = (re = 0, im = 0) => ({ re, im });
const add = (a, b) => complex(a.re + b.re, a.im + b.im);
const multiply = (a, b) => complex(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const scale = (a, value) => complex(a.re * value, a.im * value);
const conjugate = (a) => complex(a.re, -a.im);

function unitary(theta, phi) {
  const cosine = Math.cos(theta / 2);
  const sine = Math.sin(theta / 2);
  return [
    [complex(Math.cos(phi) * cosine, Math.sin(phi) * cosine), complex(sine)],
    [complex(-sine), complex(Math.cos(phi) * cosine, -Math.sin(phi) * cosine)],
  ];
}

function kronecker(left, right) {
  const rows = [];
  for (let leftRow = 0; leftRow < left.length; leftRow += 1) {
    for (let rightRow = 0; rightRow < right.length; rightRow += 1) {
      const row = [];
      for (let leftColumn = 0; leftColumn < left[0].length; leftColumn += 1) {
        for (let rightColumn = 0; rightColumn < right[0].length; rightColumn += 1) {
          row.push(multiply(left[leftRow][leftColumn], right[rightRow][rightColumn]));
        }
      }
      rows.push(row);
    }
  }
  return rows;
}

function matrixVector(matrix, vector) {
  return matrix.map((row) => row.reduce(
    (sum, entry, column) => add(sum, multiply(entry, vector[column])),
    complex(),
  ));
}

function dagger(matrix) {
  return matrix[0].map((_, column) => matrix.map((row) => conjugate(row[column])));
}

// Protocol v1.0 requires the entangler generator to be the menu's D operation,
// U(pi, 0) = i sigma_y. Substituting sigma_x reverses the asymmetric classical
// corners at maximum entanglement.
const FLIP = unitary(Math.PI, 0);

function entangler(gamma) {
  const generator = kronecker(FLIP, FLIP);
  const identityWeight = Math.cos(gamma / 2);
  const generatorWeight = Math.sin(gamma / 2);
  return generator.map((row, rowIndex) => row.map((entry, columnIndex) => add(
    rowIndex === columnIndex ? complex(identityWeight) : complex(),
    multiply(complex(0, generatorWeight), entry),
  )));
}

function outcomeProbabilities(operationX, operationO, gamma) {
  const operationPair = kronecker(unitary(...MENU[operationX]), unitary(...MENU[operationO]));
  const j = entangler(gamma);
  const initial = [complex(1), complex(), complex(), complex()];
  const final = matrixVector(dagger(j), matrixVector(operationPair, matrixVector(j, initial)));
  const raw = final.map((amplitude) => amplitude.re ** 2 + amplitude.im ** 2);
  const total = raw.reduce((sum, probability) => sum + probability, 0);
  return Object.fromEntries(BASIS.map((profile, index) => [profile, raw[index] / total]));
}

function validateRequest(body = {}) {
  const { operationX, operationO, gamma } = body;
  if (!Object.hasOwn(MENU, operationX) || !Object.hasOwn(MENU, operationO)) {
    throw new TypeError(`operations must come from the frozen menu ${JSON.stringify(Object.keys(MENU))}`);
  }
  if (typeof gamma !== "number" || !Number.isFinite(gamma)) {
    throw new TypeError("gamma must be a number");
  }
  if (gamma < 0 || gamma > MAX_ENTANGLEMENT + 1e-12) {
    throw new RangeError("gamma must lie in [0, pi/2]");
  }
  return { operationX, operationO, gamma };
}

function secureRandom() {
  return crypto.randomBytes(6).readUIntBE(0, 6) / 2 ** 48;
}

function sampleProfile(probabilities, random = secureRandom) {
  const draw = random();
  let cumulative = 0;
  for (const profile of BASIS) {
    cumulative += probabilities[profile];
    if (draw < cumulative) return profile;
  }
  return BASIS[BASIS.length - 1];
}

function winner(board) {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] !== 0 && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return null;
}

function legalMoves(board) {
  return board.flatMap((cell, index) => (cell === 0 ? [index] : []));
}

function applyMove(board, move, toMove) {
  const next = [...board];
  next[move] = toMove;
  return next;
}

function firstAvailable(moves) {
  const move = POSITIONAL_ORDER.find((candidate) => moves.includes(candidate));
  if (move === undefined) throw new Error("no legal move available");
  return move;
}

function positional(board) {
  return firstAvailable(legalMoves(board));
}

function heuristic(board, toMove) {
  const moves = legalMoves(board);
  for (const move of moves) {
    if (winner(applyMove(board, move, toMove)) === toMove) return move;
  }
  for (const move of moves) {
    if (winner(applyMove(board, move, -toMove)) === -toMove) return move;
  }
  for (const move of moves) {
    const after = applyMove(board, move, toMove);
    if (winner(after) !== null || !after.includes(0)) continue;
    const threats = legalMoves(after).filter(
      (square) => winner(applyMove(after, square, toMove)) === toMove,
    ).length;
    if (threats >= 2) return move;
  }
  return firstAvailable(moves);
}

function playOut(policyX, policyO) {
  let board = Array(9).fill(0);
  let toMove = 1;
  const moves = [];
  while (winner(board) === null && board.includes(0)) {
    const policy = toMove === 1 ? policyX : policyO;
    const move = policy === "C" ? positional(board) : heuristic(board, toMove);
    moves.push(move);
    board = applyMove(board, move, toMove);
    toMove = -toMove;
  }
  return { moves, board_result: winner(board) ?? 0 };
}

function execution(shots) {
  return {
    backend: "serverless-js-statevector",
    simulator: true,
    job_id: null,
    shots,
    detail: "Exact protocol-v1.0 state vector; Born-rule sampling uses node:crypto.",
  };
}

function play(body, random = secureRandom) {
  const { operationX, operationO, gamma } = validateRequest(body);
  const probabilities = outcomeProbabilities(operationX, operationO, gamma);
  const measuredProfile = sampleProfile(probabilities, random);
  const policyX = measuredProfile[0];
  const policyO = measuredProfile[1];
  const [payoffX, payoffO] = BIMATRIX[measuredProfile];
  return {
    schema: "quantum-arena-play/v1",
    recorded_at: new Date().toISOString(),
    gamma,
    operations: { X: operationX, O: operationO },
    measured_profile: measuredProfile,
    policies: { X: policyX, O: policyO },
    game: playOut(policyX, policyO),
    payoffs: { X: payoffX, O: payoffO },
    execution: execution(1),
  };
}

function explain(body, random = secureRandom) {
  const { operationX, operationO, gamma } = validateRequest(body);
  const shots = body.shots === undefined ? 4096 : body.shots;
  if (!Number.isInteger(shots) || shots < 2 || shots > 20000) {
    throw new RangeError("shots must be an integer between 2 and 20000");
  }
  const exact = outcomeProbabilities(operationX, operationO, gamma);
  const counts = Object.fromEntries(BASIS.map((profile) => [profile, 0]));
  for (let shot = 0; shot < shots; shot += 1) counts[sampleProfile(exact, random)] += 1;
  return {
    schema: "quantum-arena-explanation/v1",
    not_a_research_observation: true,
    gamma,
    operations: { X: operationX, O: operationO },
    empirical: Object.fromEntries(BASIS.map((profile) => [profile, counts[profile] / shots])),
    exact,
    shots,
    execution: execution(shots),
  };
}

function menu() {
  return {
    menu: MENU,
    max_entanglement: MAX_ENTANGLEMENT,
    note: "Frozen by protocol v1.0 question 5. Participant-facing labels are neutral; this mapping is retained only in records and the implementation.",
  };
}

module.exports = {
  BASIS, BIMATRIX, FLIP, MAX_ENTANGLEMENT, MENU,
  entangler, explain, menu, outcomeProbabilities, play, playOut,
  sampleProfile, unitary, validateRequest,
};
