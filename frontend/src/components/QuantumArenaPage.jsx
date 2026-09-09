import { useEffect, useRef, useState } from "react";
import {
  MAX_ENTANGLEMENT, NEUTRAL_LABELS, appendArenaPlay, drawOpponentOperation,
  explainArena, labelFor, playArena, readArenaPlays,
} from "../lib/ttt/arena";

const MARKS = ["X", "O"];

function boardAfter(moves, upTo) {
  const board = Array(9).fill("");
  moves.slice(0, upTo).forEach((square, index) => { board[square] = MARKS[index % 2]; });
  return board;
}

export function QuantumArenaPage({ onBack }) {
  const [gamma, setGamma] = useState(MAX_ENTANGLEMENT);
  const [choice, setChoice] = useState(null);
  const [record, setRecord] = useState(null);
  const [revealed, setRevealed] = useState(0);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [explanation, setExplanation] = useState(null);
  const [stored, setStored] = useState(() => readArenaPlays().length);
  const opponentDraw = useRef(null);

  // Animate the selected game move by move, as the protocol requires.
  useEffect(() => {
    if (!record) return undefined;
    const total = record.game.moves.length;
    if (revealed >= total) return undefined;
    const timer = window.setTimeout(() => setRevealed((n) => n + 1), 420);
    return () => window.clearTimeout(timer);
  }, [record, revealed]);

  async function submit() {
    if (choice === null || busy) return;
    setBusy(true);
    setError(null);
    setExplanation(null);
    try {
      // Drawn here and NOT shown: the protocol requires the participant submit
      // without seeing the opponent's operation.
      opponentDraw.current = drawOpponentOperation();
      const result = await playArena({
        operationX: choice,
        operationO: opponentDraw.current.operation,
        gamma,
      });
      const enriched = {
        ...result,
        participant: {
          // The neutral label the participant actually saw, and the mapping the
          // protocol says belongs in the record rather than the interface.
          shown_label: labelFor(choice),
          label_mapping: Object.fromEntries(NEUTRAL_LABELS.map((e) => [e.label, e.operation])),
          opponent_entropy_source: opponentDraw.current.source,
        },
      };
      setRecord(enriched);
      setRevealed(0);
      const persisted = appendArenaPlay(enriched);
      setStored(persisted.count);
      if (!persisted.ok) setError(`The play ran, but could not be stored: ${persisted.error}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function showExplanation() {
    if (!record || busy) return;
    setBusy(true);
    try {
      setExplanation(await explainArena({
        operationX: record.operations.X, operationO: record.operations.O, gamma: record.gamma,
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setRecord(null); setChoice(null); setRevealed(0); setExplanation(null); setError(null);
  }

  const board = record ? boardAfter(record.game.moves, revealed) : Array(9).fill("");
  const finished = record && revealed >= record.game.moves.length;

  return (
    <section className="ttt-lab">
      <button className="ttt-back" onClick={onBack}>← Governance Playground</button>
      <div className="ttt-hero">
        <div className="ttt-kicker">Quantum Policy Arena · protocol v1.0</div>
        <h1>Choose a setting. A measurement chooses the game.</h1>
        <p>
          Your setting and your opponent's are applied to a two-qubit circuit. One
          measurement selects which pair of strategies plays the board, and that game
          is then played out in full.
        </p>
      </div>

      {!record && (
        <>
          <div className="ttt-card">
            <h2>Entanglement</h2>
            <div className="ttt-side-toggle" role="group" aria-label="Entanglement setting">
              <button aria-pressed={gamma === 0} className={gamma === 0 ? "active" : ""} onClick={() => setGamma(0)}>
                None
              </button>
              <button aria-pressed={gamma === MAX_ENTANGLEMENT} className={gamma === MAX_ENTANGLEMENT ? "active" : ""} onClick={() => setGamma(MAX_ENTANGLEMENT)}>
                Maximum
              </button>
            </div>
          </div>

          <div className="ttt-card">
            <h2>Your setting</h2>
            <div className="ttt-setup-grid" role="group" aria-label="Choose a setting">
              {NEUTRAL_LABELS.map((entry) => (
                <button
                  key={entry.label}
                  aria-pressed={choice === entry.operation}
                  className={choice === entry.operation ? "active" : ""}
                  onClick={() => setChoice(entry.operation)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <small className="ttt-protocol-note">
              Your opponent's setting is drawn separately and is not shown before you submit.
            </small>
          </div>

          <button className="ttt-start" disabled={choice === null || busy} onClick={submit}>
            {busy ? "Measuring…" : "Submit setting"}
          </button>
        </>
      )}

      {record && (
        <>
          <div className="ttt-status">
            <span>Measurement selected</span>
            <strong>{record.policies.X} vs {record.policies.O}</strong>
          </div>
          <div className="ttt-board" role="group" aria-label="Tic-tac-toe board">
            {board.map((cell, index) => (
              <button key={index} disabled aria-label={`Square ${index + 1}${cell ? `, ${cell}` : ", empty"}`}
                className={cell ? `mark-${cell.toLowerCase()}` : ""}>{cell}</button>
            ))}
          </div>

          {finished && (
            <div className="ttt-scorecard">
              <div><strong>{record.payoffs.X > 0 ? "+" : ""}{record.payoffs.X.toFixed(3)}</strong><span>your payoff</span></div>
              <div><strong>{record.payoffs.O > 0 ? "+" : ""}{record.payoffs.O.toFixed(3)}</strong><span>opponent payoff</span></div>
              <div><strong>{record.game.board_result === 0 ? "draw" : record.game.board_result > 0 ? "X wins" : "O wins"}</strong><span>board</span></div>
              <p>
                You played {labelFor(record.operations.X)}; your opponent played {labelFor(record.operations.O)}.
                Executed on <code>{record.execution.backend}</code>
                {record.execution.simulator ? " (simulator)" : " (hardware)"}
                {record.execution.job_id ? ` · job ${record.execution.job_id}` : ""}.
              </p>
            </div>
          )}

          <div className="ttt-results-actions">
            <button className="ttt-start" onClick={reset} disabled={busy}>Play again</button>
            {finished && (
              <button className="btn-secondary" onClick={showExplanation} disabled={busy}>
                {busy ? "Sampling…" : "Explain this outcome"}
              </button>
            )}
          </div>

          {explanation && (
            <div className="ttt-model-note">
              <strong>Explanation mode — not research data</strong>
              <p>
                {explanation.shots.toLocaleString()} extra measurements of the same circuit, shown
                only to illustrate the distribution your single play was drawn from. These are
                recorded under a separate schema and are never pooled with plays.
              </p>
              <code>
                {Object.entries(explanation.empirical)
                  .map(([profile, value]) => `${profile} ${(100 * value).toFixed(1)}%`)
                  .join(" · ")}
              </code>
            </div>
          )}
        </>
      )}

      {error && <p className="ttt-error" role="alert">{error}</p>}

      <p className="ttt-boundary">
        {stored} arena play{stored === 1 ? "" : "s"} stored locally, under their own schema and
        separate from the Phase 0 decision lab.
      </p>
      <p className="ttt-boundary">
        <strong>Scientific boundary:</strong> release 1 demonstrates a correct implementation
        only. It makes no claim that any setting is better, that quantum strategies confer an
        advantage, or that human choices here are quantum. The equilibrium this protocol can
        exhibit holds within a four-option menu and does not survive an unrestricted strategy
        space.
      </p>
    </section>
  );
}
