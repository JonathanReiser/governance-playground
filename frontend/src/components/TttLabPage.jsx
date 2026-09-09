import { useEffect, useMemo, useRef, useState } from "react";
import {
  O, X, actionValues, analyzeChoice, applyMove, initialState, isTerminal, legalMoves, minimaxMove, samplePerfectMove, winner,
} from "../lib/ttt/game";
import {
  CONSENT_VERSION, appendDecisionEvent, appendSessionResult, clearActiveResearchSession,
  clearDecisionEvents, exportDecisionEvents, newSessionId, participantId,
  persistResearchSnapshot, readDecisionEvents, readSessionResults, readTrainingEvents, replaceParticipant,
  restoreResearchSnapshot,
  setActiveResearchSession,
} from "../lib/ttt/events";
import { randomUint32 } from "../lib/ttt/experiment";
import { nowMs } from "../lib/ttt/clock";
import { analyzeFeedback, analyzeValidationSessions, fitFrozenModels, predictFrozen } from "../lib/ttt/feedback";

const RESEARCH_GAMES = 6;

function mark(player) {
  return player === X ? "X" : player === O ? "O" : "";
}

function validationScoresFor(decisions) {
  const predicted = decisions.filter((decision) => decision.modelPredictions);
  if (!predicted.length) return [];
  const candidates = [
    ["Random guessing", "random_guessing"],
    ["Legacy classical", "classical_strategy"],
    ["Legacy amplitude", "quantum_style"],
    ["Classical context v2", "classical_context"],
    ["Amplitude constraint v3", "quantum_context"],
  ].filter(([, key]) => predicted.every((decision) => Number.isFinite(decision.modelPredictions[key])));
  return candidates.map(([name, key]) => ({
    name,
    error: -predicted.reduce((sum, decision) => sum + Math.log(Math.max(decision.modelPredictions[key], 1e-12)), 0) / predicted.length,
  })).sort((a, b) => a.error - b.error);
}

export function TttLabPage({ onBack }) {
  const [mode, setMode] = useState("human-minimax");
  const [humanSide, setHumanSide] = useState(X);
  const [researchMode, setResearchMode] = useState(false);
  const [consented, setConsented] = useState(false);
  const [started, setStarted] = useState(false);
  const [sessionFinished, setSessionFinished] = useState(false);
  const [showLearning, setShowLearning] = useState(false);
  const [state, setState] = useState(initialState);
  const [storageError, setStorageError] = useState(null);
  const [eventCount, setEventCount] = useState(() => readDecisionEvents().length);
  const [sessionDecisions, setSessionDecisions] = useState([]);
  const [sessionGames, setSessionGames] = useState([]);
  const [gameIndex, setGameIndex] = useState(1);
  const [frozenTrainingCount, setFrozenTrainingCount] = useState(0);
  const [backupStatus, setBackupStatus] = useState(() => readDecisionEvents().length ? "saving" : "empty");
  const [participant, setParticipant] = useState(() => participantId());
  const sessionId = useRef(null);
  const gameId = useRef(null);
  const firstHumanSide = useRef(X);
  const opponentRandomization = useRef(null);
  const turnStartedAt = useRef(null);
  const frozenModels = useRef(null);

  const humanTurn = mode === "human-human" || state.toMove === humanSide;
  const values = useMemo(() => isTerminal(state) ? null : actionValues(state), [state]);
  const oracleMove = useMemo(() => isTerminal(state) ? null : minimaxMove(state), [state]);
  const feedback = analyzeFeedback(readTrainingEvents());
  const sessionHistory = readSessionResults();
  const validationHistory = analyzeValidationSessions(sessionHistory);
  const comparingEnvelope = Number.isFinite(validationHistory.envelopeGap);
  const comparisonGap = comparingEnvelope ? validationHistory.envelopeGap : validationHistory.difference;
  const comparisonInterval = comparingEnvelope ? validationHistory.envelopeInterval : validationHistory.interval;
  const reportableValidation = ["v2 context diagnostic", "v4 context only"].includes(validationHistory.version);

  useEffect(() => {
    if (!eventCount) return undefined;
    let current = true;
    persistResearchSnapshot().then((result) => {
      if (!current) return;
      setBackupStatus(result.ok ? "saved" : "failed");
      if (!result.ok) setStorageError(`Durable local backup failed: ${result.error} Export the research JSON before continuing.`);
    });
    return () => { current = false; };
  }, [eventCount, sessionFinished]);

  function beginTurn(nextState) {
    setState(nextState);
    turnStartedAt.current = nowMs();
  }

  function prepareGame(index) {
    gameId.current = newSessionId();
    opponentRandomization.current = null;
    setGameIndex(index);
    setStarted(true);
    beginTurn(initialState());
  }

  function startSession() {
    if (researchMode && !consented) return;
    sessionId.current = newSessionId();
    if (researchMode) setActiveResearchSession(sessionId.current);
    firstHumanSide.current = humanSide;
    setStorageError(null);
    setSessionDecisions([]);
    setSessionGames([]);
    setSessionFinished(false);
    frozenModels.current = researchMode ? fitFrozenModels(readTrainingEvents()) : null;
    setFrozenTrainingCount(frozenModels.current?.training_decisions ?? 0);
    prepareGame(1);
  }

  async function restoreBackup() {
    const result = await restoreResearchSnapshot();
    if (result.ok) {
      setEventCount(result.eventCount);
      setBackupStatus("saved");
      setParticipant(participantId());
      setStorageError(null);
    } else {
      setStorageError(`The durable backup could not be restored: ${result.error}`);
    }
  }

  function startNextGame() {
    const victor = winner(state);
    const completedGames = [...sessionGames, {
      game: gameIndex,
      winner: victor === null ? null : mark(victor),
      human_side: mark(humanSide),
    }];
    setSessionGames(completedGames);
    if (researchMode && gameIndex >= RESEARCH_GAMES) {
      const persisted = appendSessionResult({
        schema: "ttt-session-result/v1",
        participant_id: participant,
        session_id: sessionId.current,
        completed_at: new Date().toISOString(),
        games: completedGames,
        decisions: sessionDecisions,
        frozen_training_decisions: frozenTrainingCount,
      });
      if (!persisted.ok) setStorageError(`Session finished, but its summary could not be stored: ${persisted.error}`);
      else setBackupStatus("saving");
      clearActiveResearchSession();
      setSessionFinished(true);
      return;
    }
    const nextIndex = gameIndex + 1;
    if (researchMode && mode === "human-minimax") {
      setHumanSide(nextIndex % 2 === 1 ? firstHumanSide.current : -firstHumanSide.current);
    }
    prepareGame(nextIndex);
  }

  function playHumanMove(move) {
    if (!humanTurn || !legalMoves(state).includes(move)) return;
    const { selectedValue, bestValue, optimalMoves, regret, errorType } = analyzeChoice(state, move);
    const predictionInput = {
      board_before: [...state.board],
      player: mark(state.toMove),
      legal_moves: legalMoves(state),
      selected_move: move,
      minimax_action_values: values,
    };
    const modelPredictions = predictFrozen(predictionInput, frozenModels.current);
    const decision = {
      player: mark(state.toMove),
      move,
      optimalMoves,
      selectedValue,
      bestValue,
      regret,
      errorType,
      modelPredictions,
    };
    setSessionDecisions((current) => [...current, decision]);
    if (researchMode && consented) {
      const event = {
        schema: "ttt-decision/v1",
        event_id: newSessionId(),
        participant_id: participant,
        session_id: sessionId.current,
        game_id: gameId.current,
        game_index: gameIndex,
        planned_games: RESEARCH_GAMES,
        recorded_at: new Date().toISOString(),
        mode,
        player: mark(state.toMove),
        board_before: [...state.board],
        legal_moves: legalMoves(state),
        selected_move: move,
        response_ms: nowMs() - (turnStartedAt.current ?? nowMs()),
        experimental_condition: "neutral-play",
        consent: { version: CONSENT_VERSION, granted: true },
        minimax_move: oracleMove,
        minimax_optimal_moves: optimalMoves,
        minimax_action_values: values,
        decision_regret: regret,
        error_type: errorType,
        frozen_model: frozenModels.current ? {
          schema: frozenModels.current.schema,
          training_decisions: frozenModels.current.training_decisions,
          classical: frozenModels.current.classical,
          amplitude: { kappa: frozenModels.current.amplitude.kappa, phase: frozenModels.current.amplitude.phase },
          contextual: frozenModels.current.contextual,
        } : null,
        model_predictions: modelPredictions,
        opponent_policy: mode === "human-minimax" ? {
          name: "perfect-minimax-uniform-optimal-ties",
          last_randomization: opponentRandomization.current,
        } : null,
      };
      const persisted = appendDecisionEvent(event);
      setEventCount(persisted.count);
      if (persisted.ok) setBackupStatus("saving");
      setStorageError(persisted.ok ? null : `The move was played, but this decision could not be stored: ${persisted.error}`);
    }
    beginTurn(applyMove(state, move));
  }

  useEffect(() => {
    if (!started || mode !== "human-minimax" || humanTurn || isTerminal(state)) return;
    const timer = window.setTimeout(() => {
      try {
        const draw = randomUint32(globalThis.crypto, !researchMode);
        const sampled = samplePerfectMove(state, draw.value);
        opponentRandomization.current = { source: draw.source, move: sampled.move, optimal_moves: sampled.optimalMoves };
        beginTurn(applyMove(state, sampled.move));
      } catch (error) {
        setStorageError(error instanceof Error ? error.message : String(error));
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [started, mode, humanTurn, researchMode, state]);

  const victor = winner(state);
  const status = isTerminal(state)
    ? victor === null ? "Draw — perfect play's expected destination." : `${mark(victor)} wins.`
    : humanTurn ? `${mark(state.toMove)} to decide` : "Minimax is calculating…";

  if (showLearning) {
    return (
      <section className="ttt-lab">
        <button className="ttt-back" onClick={() => setShowLearning(false)}>← {sessionFinished ? "Session results" : "Experiment setup"}</button>
        <div className="ttt-hero ttt-results-hero">
          <div className="ttt-kicker">Cognitive model feedback loop</div>
          <h1>{feedback.decisions} decisions are teaching the models.</h1>
          <p>Each model tried to predict your squares. A lower prediction-error number means better guesses.</p>
        </div>
        <div className="ttt-model-grid">
          {feedback.models.map((model) => (
            <article key={model.name}>
              <span>Historical descriptive fit</span>
              <h2>{model.name}</h2>
              <strong>{model.meanLogLoss === null ? "—" : model.meanLogLoss.toFixed(3)}</strong>
              <small>prediction error · lower is better</small>
              <p>Typical probability the model assigned to the square you chose: {model.geometricProbability === null ? "—" : `${(100 * model.geometricProbability).toFixed(1)}%`}</p>
              {model.parameters.tau && <code>τ = {model.parameters.tau}</code>}
              {model.parameters.phase !== undefined && <code>κ = {model.parameters.kappa} · φ = {model.parameters.phase.toFixed(2)}</code>}
            </article>
          ))}
        </div>
        <div className="ttt-model-note">
          <strong>What the loop can claim now</strong>
          <p>The two legacy fits did not receive the same information, and the amplitude formula reduces exactly to an ordinary real-valued equation. Their old scores are retained for auditability, not for comparison or as evidence for quantum cognition.</p>
          <p>Average recorded response time: {feedback.meanResponseMs === null ? "—" : `${Math.round(feedback.meanResponseMs)} ms`}. Before the next research session, fresh model parameters are fitted from all eligible earlier decisions and then frozen.</p>
        </div>
        <div className="ttt-model-note ttt-v2-ready">
          <strong>Free-envelope diagnostic paused</strong>
          <p>The v3 envelope estimator failed finite-sample synthetic recovery, so its historical scores are quarantined and no envelope comparison is reported. Current sessions retain only the equally informed classical-context and amplitude-constraint predictors; neither establishes quantum physics in the brain.</p>
        </div>
        {sessionHistory.length > 0 && (
          <div className="ttt-session-history">
            <div className="ttt-kicker">Completed validation sessions</div>
            {validationHistory.version === "v1 baseline" && (
              <div className="ttt-evidence-summary">
                <strong>Legacy sessions are audit records, not a valid model comparison</strong>
                <span>The legacy predictors received different information, so no leader or uncertainty range is reported from these sessions.</span>
                <span>{validationHistory.rows.filter((row) => row.version === validationHistory.version).length} completed legacy session(s) remain stored.</span>
              </div>
            )}
            {validationHistory.version === "v3 envelope quarantined" && (
              <div className="ttt-evidence-summary">
                <strong>Envelope comparison withheld</strong>
                <span>The estimator did not recover known coupling values reliably at realistic sample sizes. These archived scores remain available in the export for audit, but are not interpreted or ranked.</span>
              </div>
            )}
            {reportableValidation && comparisonGap !== null && (
              <div className="ttt-evidence-summary">
                <strong>{comparingEnvelope
                  ? comparisonGap > 0 ? "Free classical envelope currently has lower error" : "Amplitude constraint currently has lower error"
                  : comparisonGap > 0 ? "Classical context currently has lower error" : "Amplitude constraint currently has lower error"}</strong>
                <span>Average {comparingEnvelope ? "amplitude-versus-envelope" : "amplitude-versus-classical-context"} gap: {Math.abs(comparisonGap).toFixed(3)} prediction-error points.</span>
                <span>{validationHistory.version}: {validationHistory.rows.filter((row) => row.version === validationHistory.version).length} completed session(s).</span>
                {comparisonInterval
                  ? <span>Session-bootstrap range: {comparisonInterval[0].toFixed(3)} to {comparisonInterval[1].toFixed(3)}. {comparisonInterval[0] <= 0 && comparisonInterval[1] >= 0 ? "The range crosses zero, so the lead is not stable." : "The range does not cross zero."}</span>
                  : <span>No uncertainty interval is reported until at least eight completed sessions exist for this model version.</span>}
              </div>
            )}
            {sessionHistory.map((session, index) => {
              const scores = validationScoresFor(session.decisions || []);
              const row = validationHistory.rows.find((item) => item.sessionId === session.session_id);
              return (
                <div className="ttt-history-row" key={session.session_id}>
                  <strong>Session {index + 1}</strong>
                  <span>{session.decisions?.length || 0} moves</span>
                  <span>{row?.version === "v1 baseline"
                    ? "Audit only · v1 baseline"
                    : row?.version === "v3 envelope quarantined"
                      ? "Audit only · invalid envelope comparison"
                    : `${scores.length ? `${scores[0].name} had lowest held-out error` : "Training data only"}${row ? ` · ${row.version}` : ""}`}</span>
                  <code>{row?.version === "v1 baseline" ? "Historical scores (not comparable): " : ""}{scores.map((score) => `${score.name}: ${score.error.toFixed(3)}`).join(" · ") || "—"}</code>
                  {row && ["v2 context diagnostic", "v4 context only"].includes(row.version) && <div className="ttt-history-bars" aria-label={`Session ${index + 1} prediction errors`}>
                    <i className="classical" style={{ width: `${Math.min(100, row.classical / 1.6 * 100)}%` }} />
                    <i className="quantum" style={{ width: `${Math.min(100, row.quantum / 1.6 * 100)}%` }} />
                  </div>}
                </div>
              );
            })}
          </div>
        )}
        <div className="ttt-results-actions">
          <button className="ttt-start" onClick={exportDecisionEvents} disabled={!eventCount}>Export evidence</button>
          {sessionFinished && <button className="btn-secondary" onClick={() => setShowLearning(false)}>Back to validation results</button>}
          <button className="btn-secondary" onClick={() => { setShowLearning(false); setSessionFinished(false); setStarted(false); }}>Start another session</button>
        </div>
        <p className="ttt-boundary">Durable local file backup: {backupStatus === "saved" ? "up to date" : backupStatus === "failed" ? "failed — export before continuing" : backupStatus === "unavailable" ? "unavailable — use Export evidence" : backupStatus === "preserved" ? "earlier archive preserved; new data will be merged" : "saving…"}.</p>
      </section>
    );
  }

  if (!started) {
    return (
      <section className="ttt-lab">
        <button className="ttt-back" onClick={onBack}>← Governance Playground</button>
        <div className="ttt-hero">
          <div className="ttt-kicker">Human Decision Laboratory · Phase 0</div>
          <h1>Nine squares. One actual choice.</h1>
          <p>Play inside a completely knowable strategy space. The classical oracle lets us distinguish what is optimal from what a person actually decides.</p>
        </div>

        <div className="ttt-setup-grid">
          <div className="ttt-card">
            <h2>Choose a game</h2>
            <label className="ttt-choice">
              <input name="game-mode" type="radio" checked={mode === "human-minimax"} onChange={() => setMode("human-minimax")} />
              <span><strong>Human vs minimax</strong><small>The AI chooses uniformly among exact, equally optimal moves.</small></span>
            </label>
            <label className="ttt-choice">
              <input name="game-mode" type="radio" checked={mode === "human-human"} onChange={() => setMode("human-human")} />
              <span><strong>Human vs human</strong><small>Two people share this device.</small></span>
            </label>
            {mode === "human-minimax" && (
              <div className="ttt-side-toggle" role="group" aria-label="Choose human side">
                <button aria-pressed={humanSide === X} className={humanSide === X ? "active" : ""} onClick={() => setHumanSide(X)}>You open · X</button>
                <button aria-pressed={humanSide === O} className={humanSide === O ? "active" : ""} onClick={() => setHumanSide(O)}>AI opens · You are O</button>
              </div>
            )}
            {researchMode && mode === "human-minimax" && <small className="ttt-protocol-note">Across six games, opening side alternates: three human openings and three AI openings.</small>}
          </div>

          <div className="ttt-card">
            <h2>Data mode</h2>
            <label className="ttt-choice">
              <input name="data-mode" type="radio" checked={!researchMode} onChange={() => setResearchMode(false)} />
              <span><strong>Casual play</strong><small>No decision events are stored.</small></span>
            </label>
            <label className="ttt-choice">
              <input name="data-mode" type="radio" checked={researchMode} onChange={() => setResearchMode(true)} />
              <span><strong>Local research mode</strong><small>Anonymous events stay on this computer in the browser and a local backup file.</small></span>
            </label>
            {researchMode && (
              <label className="ttt-consent">
                <input type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} />
                <span>I consent to storing my board choices and response times on this computer. No name or contact information is collected. The browser copy can be cleared below; the recovery file remains in the project's research-data folder.</span>
              </label>
            )}
          </div>
        </div>

        <button className="ttt-start" disabled={researchMode && !consented} onClick={startSession}>Begin experiment</button>
        <div className="ttt-data-tools">
          <span>{eventCount} locally stored decision{eventCount === 1 ? "" : "s"}</span>
          <button onClick={exportDecisionEvents} disabled={!eventCount}>Export JSON</button>
          <button onClick={() => { clearDecisionEvents(); setEventCount(0); setBackupStatus("preserved"); }} disabled={!eventCount}>Clear browser copy</button>
          <button onClick={restoreBackup}>Restore/merge file backup</button>
          <button onClick={() => { setParticipant(replaceParticipant()); sessionId.current = null; }}>New participant</button>
          <button onClick={() => setShowLearning(true)} disabled={!eventCount}>View learning loop</button>
        </div>
        <p className="ttt-boundary">Durable local file backup: {backupStatus === "saved" ? "saved" : backupStatus === "failed" ? "failed — export before continuing" : backupStatus === "unavailable" ? "unavailable — use Export JSON" : backupStatus === "preserved" ? "earlier archive preserved; new data will be merged" : backupStatus === "empty" ? "waiting for research data" : "saving…"}.</p>
        {storageError && <p className="ttt-error" role="alert">{storageError}</p>}
        <p className="ttt-boundary"><strong>Scientific boundary:</strong> this phase measures human choices against classical models. It makes no claim that cognition or consciousness is physically quantum.</p>
      </section>
    );
  }

  if (sessionFinished) {
    const perfectChoices = sessionDecisions.filter((decision) => decision.regret === 0).length;
    const errors = sessionDecisions.length - perfectChoices;
    const draws = sessionGames.filter((game) => game.winner === null).length;
    const firstWins = mode === "human-minimax"
      ? sessionGames.filter((game) => game.winner !== null && game.winner === game.human_side).length
      : sessionGames.filter((game) => game.winner === "X").length;
    const secondWins = mode === "human-minimax"
      ? sessionGames.filter((game) => game.winner !== null && game.winner !== game.human_side).length
      : sessionGames.filter((game) => game.winner === "O").length;
    const predicted = sessionDecisions.filter((decision) => decision.modelPredictions);
    const validationScores = validationScoresFor(sessionDecisions);
    return (
      <section className="ttt-lab">
        <div className="ttt-hero ttt-results-hero">
          <div className="ttt-kicker">Research session complete</div>
          <h1>Your six-game record.</h1>
          <p>The oracle comparison was hidden during play. These are descriptive results, not a judgment of intelligence or rationality.</p>
        </div>
        <div className="ttt-results-grid">
          <div><strong>{firstWins}</strong><span>{mode === "human-minimax" ? "human wins" : "X wins"}</span></div>
          <div><strong>{draws}</strong><span>draws</span></div>
          <div><strong>{secondWins}</strong><span>{mode === "human-minimax" ? "AI wins" : "O wins"}</span></div>
          <div><strong>{perfectChoices}/{sessionDecisions.length}</strong><span>optimal choices</span></div>
          <div><strong>{errors}</strong><span>outcome-changing choices</span></div>
          <div><strong>{sessionDecisions.reduce((sum, decision) => sum + decision.regret, 0)}</strong><span>total outcome regret</span></div>
        </div>
        {validationScores.length > 0 && (
          <div className="ttt-validation">
            <div className="ttt-kicker">New-move prediction test · lower error is better</div>
            <h2>{validationScores[0].name} had the lowest prediction error this session.</h2>
            <p>These models were frozen before you began, using {frozenTrainingCount} earlier decisions. Your {predicted.length} new choices were not used to tune them.</p>
            <div className="ttt-validation-scores">
              {validationScores.map((model) => <span key={model.name}><strong>{model.error.toFixed(3)}</strong>{model.name}</span>)}
            </div>
          </div>
        )}
        {!validationScores.length && researchMode && <p className="ttt-boundary">This was the training session. Your next research session will be the first frozen-model prediction test.</p>}
        <div className="ttt-results-actions">
          <button className="btn-secondary" onClick={() => setShowLearning(true)}>View model feedback</button>
          <button className="ttt-start" onClick={exportDecisionEvents} disabled={!eventCount}>Export research JSON</button>
          <button className="btn-secondary" onClick={startSession}>Start another research session</button>
          <button className="btn-secondary" onClick={() => { setStarted(false); setSessionFinished(false); }}>Change setup</button>
        </div>
        <p className="ttt-boundary"><strong>Durable local file backup:</strong> {backupStatus === "saved" ? "saved" : backupStatus === "failed" ? "failed — export before continuing" : backupStatus === "unavailable" ? "unavailable — use Export research JSON" : backupStatus === "preserved" ? "earlier archive preserved; new data will be merged" : "saving…"}.</p>
        <p className="ttt-boundary">{eventCount} decision event{eventCount === 1 ? " is" : "s are"} stored in this browser. The recovery archive also preserves earlier cleared records and merges new records without duplicates. Export preserves the full boards, response times, oracle values, session ID, and game IDs.</p>
        {storageError && <p className="ttt-error" role="alert">{storageError}</p>}
      </section>
    );
  }

  return (
    <section className="ttt-lab">
      <div className="ttt-play-header">
        {!researchMode && <button className="ttt-back" onClick={() => setStarted(false)}>← Experiment setup</button>}
        {researchMode && <span className="ttt-protocol-note">Research session in progress · finish six games to unlock feedback</span>}
        <span className={`ttt-recording ${researchMode ? "is-on" : ""}`}>{researchMode ? "● recording locally" : "casual · not recorded"}</span>
      </div>

      <div className="ttt-game-layout">
        <div>
          <div className="ttt-status"><span>{researchMode ? `Game ${gameIndex} of ${RESEARCH_GAMES}` : "Game state"}</span><strong>{status}</strong></div>
          <div className="ttt-board" role="group" aria-label="Tic-tac-toe board">
            {state.board.map((cell, index) => (
              <button
                key={index}
                aria-label={`Square ${index + 1}${cell ? `, ${mark(cell)}` : ", empty"}`}
                disabled={cell !== 0 || !humanTurn || isTerminal(state)}
                className={cell ? `mark-${mark(cell).toLowerCase()}` : ""}
                onClick={() => playHumanMove(index)}
              >{mark(cell)}</button>
            ))}
          </div>
          {isTerminal(state) && (
            <button className="ttt-start" onClick={startNextGame}>
              {researchMode ? gameIndex < RESEARCH_GAMES ? `Next game (${gameIndex + 1}/${RESEARCH_GAMES})` : "Finish research session" : "Play another game"}
            </button>
          )}
          {isTerminal(state) && !researchMode && sessionDecisions.length > 0 && (
            <div className="ttt-scorecard">
              <div><strong>{sessionDecisions.filter((decision) => decision.regret === 0).length}</strong><span>perfect-play choices</span></div>
              <div><strong>{sessionDecisions.filter((decision) => decision.regret > 0).length}</strong><span>suboptimal choices</span></div>
              <div><strong>{sessionDecisions.reduce((sum, decision) => sum + decision.regret, 0)}</strong><span>total decision regret</span></div>
              <p>“Suboptimal” means only that another move guaranteed a better tic-tac-toe outcome against perfect opposition. It is not a judgment about rationality.</p>
            </div>
          )}
          {isTerminal(state) && researchMode && gameIndex === RESEARCH_GAMES && sessionDecisions.length > 0 && (
            <div className="ttt-scorecard">
              <div><strong>{sessionDecisions.filter((decision) => decision.regret === 0).length}</strong><span>perfect-play choices</span></div>
              <div><strong>{sessionDecisions.filter((decision) => decision.regret > 0).length}</strong><span>suboptimal choices</span></div>
              <div><strong>{sessionDecisions.reduce((sum, decision) => sum + decision.regret, 0)}</strong><span>session outcome regret</span></div>
              <p>Feedback appears only after all six games, so it cannot train choices inside the recorded session.</p>
            </div>
          )}
        </div>

        <aside className="ttt-deliberation">
          {!isTerminal(state) && humanTurn && (
            <div className="ttt-selection">
              <span>Your move</span>
              <strong>Click any empty square to play.</strong>
            </div>
          )}

          <div className="ttt-oracle-note">
            <strong>Oracle remains hidden during play</strong>
            <span>In research mode, the move, response time, and game-theoretic regret are recorded without prompting or coaching you.</span>
          </div>
          {storageError && <p className="ttt-error" role="alert">{storageError}</p>}
        </aside>
      </div>
    </section>
  );
}
