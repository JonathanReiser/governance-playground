// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title BatchExperimentRegistry
 * @notice Records a batch of independent trials of the same scenario +
 * starting condition, so a finding can be a real distribution ("32 of 50
 * trials landed below baseline stability") instead of one run's single
 * outcome. A single WorldRegistry-based run can't tell signal from the
 * real stochasticity in the pipeline (real LLM sampling, real quantum
 * collapse) — that's exactly what a batch of independent trials is for.
 *
 * Deliberately NOT one WorldRegistry per trial. WorldRegistry's own
 * deploy is ~12 transactions (WorldRegistry + MetricsOracle + a token and
 * a DAO per nation) because a showcased run is meant to be individually
 * inspectable and resumable. A batch trial needs neither — nobody
 * interactively resumes trial #37 of 50 — so paying for a full DAO/token
 * deployment per trial would make anything above a handful of trials
 * impractically slow and expensive for no benefit. This contract records
 * only what a batch actually needs: the declared experiment config, and
 * each trial's final outcome.
 *
 * The AI reasoning, quantum collapse, and market resolution for every
 * trial still happen entirely off-chain (see frontend/src/lib/cycleRunner.js)
 * — same as every other run in this project. Nothing here computes an
 * outcome; it only records one, after the fact, tamper-evidently.
 *
 * Two-step lifecycle:
 *   1. registerExperiment — hypothesis and exact config (scenario,
 *      starting conditions, trial count, cycles per trial), committed
 *      BEFORE any trial runs. This is the preregistration: it's what lets
 *      a batch's results be cited as "the hypothesis was declared before
 *      the data existed," not picked after seeing what looked good.
 *   2. recordTrialResult — one trial's final metrics, after the fact.
 *      Only the final numbers, not the full per-cycle decision history —
 *      that stays off-chain and downloadable (same pattern as every
 *      other run's JSON export), keeping each trial cheap enough that
 *      running dozens of them is actually practical. Recorded one trial
 *      at a time (not batched into a single final transaction) so an
 *      interrupted batch keeps whatever trials it already committed,
 *      the same resilience-over-a-long-run tradeoff WorldRegistry's own
 *      per-cycle commits already make.
 *
 * Permissionless by design, same as a fresh WorldRegistry deploy: anyone
 * can register an experiment, with msg.sender recorded as the researcher
 * of record — there's no admin gate here for the same reason there isn't
 * one on starting a new scenario run. recordTrialResult IS gated to that
 * same researcher address, not because the contract distrusts other
 * callers generally, but because allowing anyone to inject a "trial
 * result" into someone else's already-preregistered experiment would
 * defeat the entire point of preregistration.
 */
contract BatchExperimentRegistry {

    struct Experiment {
        address researcher;
        string scenarioId;
        string[] startingConditionIds;
        string hypothesis;
        uint256 trialCount;
        uint256 cyclesPerTrial;
        uint256 registeredAt;      // block.timestamp
        uint256 registeredAtBlock;
        bool exists;
    }

    struct TrialResult {
        bool recorded;
        uint256 finalStability;      // 0-100
        uint256 finalDealIntegrity;  // 0-100
        uint256 finalProxyActivity;  // 0-100
        uint256 finalTradeVolume;    // 0-500
        uint256 finalConflictEvents; // 0-999
        uint256 recordedAt;          // block.timestamp
    }

    mapping(bytes32 => Experiment) public experiments;
    // experimentId => trialIndex => result
    mapping(bytes32 => mapping(uint256 => TrialResult)) public trialResults;
    // experimentId => how many distinct trials have been recorded so far
    mapping(bytes32 => uint256) public recordedTrialCount;

    event ExperimentRegistered(
        bytes32 indexed experimentId,
        address indexed researcher,
        string scenarioId,
        string[] startingConditionIds,
        string hypothesis,
        uint256 trialCount,
        uint256 cyclesPerTrial
    );

    event TrialResultRecorded(
        bytes32 indexed experimentId,
        uint256 indexed trialIndex,
        uint256 finalStability,
        uint256 finalDealIntegrity,
        uint256 finalProxyActivity,
        uint256 finalTradeVolume,
        uint256 finalConflictEvents
    );

    /**
     * @param experimentId Caller-chosen, not auto-generated — computed
     * client-side (e.g. keccak256 of scenarioId + startingConditionIds +
     * hypothesis + researcher address + a timestamp) so a researcher can
     * derive and share the id before the registration transaction even
     * confirms, and so this contract never has to hand back an id via a
     * return value a caller would need to parse out of a receipt.
     */
    function registerExperiment(
        bytes32 experimentId,
        string calldata scenarioId,
        string[] calldata startingConditionIds,
        string calldata hypothesis,
        uint256 trialCount,
        uint256 cyclesPerTrial
    ) external {
        require(!experiments[experimentId].exists, "BatchExperimentRegistry: experiment id already used");
        require(bytes(scenarioId).length > 0, "BatchExperimentRegistry: scenarioId required");
        require(trialCount > 0, "BatchExperimentRegistry: trialCount must be > 0");
        require(cyclesPerTrial > 0, "BatchExperimentRegistry: cyclesPerTrial must be > 0");

        Experiment storage exp = experiments[experimentId];
        exp.researcher = msg.sender;
        exp.scenarioId = scenarioId;
        exp.startingConditionIds = startingConditionIds;
        exp.hypothesis = hypothesis;
        exp.trialCount = trialCount;
        exp.cyclesPerTrial = cyclesPerTrial;
        exp.registeredAt = block.timestamp;
        exp.registeredAtBlock = block.number;
        exp.exists = true;

        emit ExperimentRegistered(
            experimentId, msg.sender, scenarioId, startingConditionIds, hypothesis, trialCount, cyclesPerTrial
        );
    }

    function recordTrialResult(
        bytes32 experimentId,
        uint256 trialIndex,
        uint256 finalStability,
        uint256 finalDealIntegrity,
        uint256 finalProxyActivity,
        uint256 finalTradeVolume,
        uint256 finalConflictEvents
    ) external {
        Experiment storage exp = experiments[experimentId];
        require(exp.exists, "BatchExperimentRegistry: unknown experiment");
        require(msg.sender == exp.researcher, "BatchExperimentRegistry: not this experiment's researcher");
        require(trialIndex < exp.trialCount, "BatchExperimentRegistry: trialIndex out of range");
        require(!trialResults[experimentId][trialIndex].recorded, "BatchExperimentRegistry: trial already recorded");
        require(finalStability <= 100, "BatchExperimentRegistry: stability 0-100");
        require(finalDealIntegrity <= 100, "BatchExperimentRegistry: dealIntegrity 0-100");
        require(finalProxyActivity <= 100, "BatchExperimentRegistry: proxyActivity 0-100");
        require(finalTradeVolume <= 500, "BatchExperimentRegistry: tradeVolume 0-500");
        require(finalConflictEvents <= 999, "BatchExperimentRegistry: conflictEvents 0-999");

        trialResults[experimentId][trialIndex] = TrialResult({
            recorded: true,
            finalStability: finalStability,
            finalDealIntegrity: finalDealIntegrity,
            finalProxyActivity: finalProxyActivity,
            finalTradeVolume: finalTradeVolume,
            finalConflictEvents: finalConflictEvents,
            recordedAt: block.timestamp
        });
        recordedTrialCount[experimentId] += 1;

        emit TrialResultRecorded(
            experimentId, trialIndex, finalStability, finalDealIntegrity, finalProxyActivity, finalTradeVolume, finalConflictEvents
        );
    }

    // Struct getters auto-generated from `public` mappings omit dynamic-array
    // members (Solidity drops them from the ABI-encoded return) — this is the
    // explicit accessor for `Experiment.startingConditionIds` that the
    // `experiments(experimentId)` getter can't return on its own.
    function getStartingConditionIds(bytes32 experimentId) external view returns (string[] memory) {
        return experiments[experimentId].startingConditionIds;
    }

    function isComplete(bytes32 experimentId) external view returns (bool) {
        Experiment storage exp = experiments[experimentId];
        return exp.exists && recordedTrialCount[experimentId] == exp.trialCount;
    }
}
