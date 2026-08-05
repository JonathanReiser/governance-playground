// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MetricsOracle
 * @notice The measurement engine of the simulation.
 *
 * At the end of every cycle, the MetricsOracle:
 *  - Reads the state of all NationDAOs
 *  - Calculates aggregate scores (stability, conflict, trade, etc.)
 *  - Records them permanently on-chain
 *  - Tracks how metrics change across experiments
 *
 * This is what makes the playground a RESEARCH tool rather than just
 * a game. Every data point is timestamped, attributed, and immutable.
 * Researchers can cite specific blocks and cycles in their papers.
 *
 * Real world parallel:
 *  - Like a political science dataset that writes itself in real time
 *  - Every governance event becomes a data point
 *  - Results are reproducible — anyone can re-run from block N
 */
contract MetricsOracle is Ownable {

    // ─────────────────────────────────────────
    // STRUCTS
    // ─────────────────────────────────────────

    struct CycleSnapshot {
        uint256 cycle;
        uint256 timestamp;
        uint256 blockNumber;

        // Aggregate metrics
        uint256 regionalStabilityIndex;  // 0–100
        uint256 totalConflictEvents;
        uint256 totalTradeVolume;
        uint256 totalProxyActivity;
        uint256 peaceDealIntegrity;      // 0–100

        // Per-nation snapshots
        NationSnapshot[] nations;
    }

    struct NationSnapshot {
        string nationId;
        uint256 stabilityScore;
        uint256 treasury;
        uint256 militaryPower;
        uint256 proposalCount;
        uint256 hardlinerPressure;
        string dominantRelationship;   // most significant current relationship
    }

    struct ExperimentRecord {
        string experimentId;
        string nationId;
        string parameter;
        uint256 valueBefore;
        uint256 valueAfter;
        uint256 cycle;
        uint256 timestamp;
        uint256 blockNumber;
    }

    struct MetricDelta {
        string metricId;
        uint256 baselineValue;
        uint256 experimentValue;
        int256  delta;              // can be negative
        uint256 cycle;
    }

    // ─────────────────────────────────────────
    // STATE
    // ─────────────────────────────────────────

    address public worldRegistry;

    // Full history — every cycle's snapshot stored forever
    mapping(uint256 => CycleSnapshot) public snapshots;
    uint256 public snapshotCount;

    // Experiment records
    ExperimentRecord[] public experimentRecords;

    // Baseline snapshot — taken before any experiment
    CycleSnapshot public baseline;
    bool public baselineSet;

    // Current running metrics (updated each cycle)
    uint256 public regionalStabilityIndex;
    uint256 public totalConflictEvents;
    uint256 public totalTradeVolume;
    uint256 public totalProxyActivity;
    uint256 public peaceDealIntegrity;

    // Conflict event log
    ConflictEvent[] public conflictLog;

    struct ConflictEvent {
        uint256 cycle;
        string fromNationId;
        string toNationId;
        string eventType;
        uint256 intensity;       // 0–100
        uint256 timestamp;
    }

    // ─────────────────────────────────────────
    // EVENTS
    // ─────────────────────────────────────────

    event CycleMetricsCalculated(
        uint256 indexed cycle,
        uint256 stabilityIndex,
        uint256 conflictEvents,
        uint256 tradeVolume
    );

    event BaselineSet(uint256 cycle);

    event ExperimentRecorded(
        string experimentId,
        string nationId,
        string parameter,
        uint256 newValue
    );

    event ConflictLogged(
        uint256 indexed cycle,
        string fromNationId,
        string toNationId,
        string eventType,
        uint256 intensity
    );

    event AnomalyDetected(
        uint256 indexed cycle,
        string metricId,
        uint256 value,
        string description
    );

    // ─────────────────────────────────────────
    // CONSTRUCTOR
    // ─────────────────────────────────────────

    constructor(address _worldRegistry, address _initialOwner)
        Ownable(_initialOwner)
    {
        worldRegistry = _worldRegistry;

        // Initialize starting values from the Middle East 2026 config
        regionalStabilityIndex = 38;
        totalConflictEvents    = 0;
        totalTradeVolume       = 120;
        totalProxyActivity     = 45;
        peaceDealIntegrity     = 52;
    }

    // ─────────────────────────────────────────
    // CYCLE METRICS
    // ─────────────────────────────────────────

    /**
     * @notice Calculate and record metrics at the end of a cycle.
     * @dev Called by WorldRegistry.advanceCycle().
     *      In production this reads live DAO state.
     *      In the MVP it accepts inputs from the simulation runner.
     */
    function calculateCycleMetrics(uint256 _cycle) external {
        require(
            msg.sender == worldRegistry || msg.sender == owner(),
            "MetricsOracle: not authorized"
        );

        // In the full implementation, this would call each NationDAO
        // and aggregate their state. For the MVP, metrics are passed in
        // via updateMetrics() before calling this function.

        snapshotCount++;

        CycleSnapshot storage snap = snapshots[_cycle];
        snap.cycle                  = _cycle;
        snap.timestamp              = block.timestamp;
        snap.blockNumber            = block.number;
        snap.regionalStabilityIndex = regionalStabilityIndex;
        snap.totalConflictEvents    = totalConflictEvents;
        snap.totalTradeVolume       = totalTradeVolume;
        snap.totalProxyActivity     = totalProxyActivity;
        snap.peaceDealIntegrity     = peaceDealIntegrity;

        // Check for anomalies — sudden drops in stability
        if (_cycle > 1) {
            CycleSnapshot storage prev = snapshots[_cycle - 1];
            if (
                prev.regionalStabilityIndex > 0 &&
                regionalStabilityIndex < prev.regionalStabilityIndex &&
                prev.regionalStabilityIndex - regionalStabilityIndex >= 15
            ) {
                emit AnomalyDetected(
                    _cycle,
                    "stability_index",
                    regionalStabilityIndex,
                    "Sharp stability drop - possible crisis event"
                );
            }
        }

        emit CycleMetricsCalculated(
            _cycle,
            regionalStabilityIndex,
            totalConflictEvents,
            totalTradeVolume
        );
    }

    /**
     * @notice Update running metrics for the current cycle.
     * @dev Called by the simulation runner before calculateCycleMetrics.
     */
    function updateMetrics(
        uint256 _stabilityIndex,
        uint256 _conflictEvents,
        uint256 _tradeVolume,
        uint256 _proxyActivity,
        uint256 _dealIntegrity
    ) external {
        require(
            msg.sender == worldRegistry || msg.sender == owner(),
            "MetricsOracle: not authorized"
        );

        require(_stabilityIndex <= 100, "MetricsOracle: stability 0-100");
        require(_dealIntegrity   <= 100, "MetricsOracle: integrity 0-100");

        regionalStabilityIndex = _stabilityIndex;
        totalConflictEvents    = _conflictEvents;
        totalTradeVolume       = _tradeVolume;
        totalProxyActivity     = _proxyActivity;
        peaceDealIntegrity     = _dealIntegrity;
    }

    // ─────────────────────────────────────────
    // BASELINE & EXPERIMENTS
    // ─────────────────────────────────────────

    /**
     * @notice Lock in the baseline state before running experiments.
     * @dev Researchers call this after setup but before any changes.
     *      The baseline becomes the "control group" for comparison.
     */
    function setBaseline(uint256 _cycle) external onlyOwner {
        require(!baselineSet, "MetricsOracle: baseline already set");

        baseline = snapshots[_cycle];
        baselineSet = true;

        emit BaselineSet(_cycle);
    }

    /**
     * @notice Record that an experiment was applied.
     * @dev Called by WorldRegistry.applyExperiment().
     *      Creates a permanent on-chain record of every change made.
     */
    function recordExperiment(
        string calldata _experimentId,
        string calldata _nationId,
        string calldata _parameter,
        uint256 _newValue,
        uint256 _cycle
    ) external {
        require(
            msg.sender == worldRegistry || msg.sender == owner(),
            "MetricsOracle: not authorized"
        );

        experimentRecords.push(ExperimentRecord({
            experimentId: _experimentId,
            nationId:     _nationId,
            parameter:    _parameter,
            valueBefore:  0,           // in full impl: read from DAO first
            valueAfter:   _newValue,
            cycle:        _cycle,
            timestamp:    block.timestamp,
            blockNumber:  block.number
        }));

        emit ExperimentRecorded(
            _experimentId,
            _nationId,
            _parameter,
            _newValue
        );
    }

    /**
     * @notice Log a conflict event between two nations.
     */
    function logConflict(
        uint256 _cycle,
        string calldata _fromId,
        string calldata _toId,
        string calldata _eventType,
        uint256 _intensity
    ) external {
        require(
            msg.sender == worldRegistry || msg.sender == owner(),
            "MetricsOracle: not authorized"
        );

        conflictLog.push(ConflictEvent({
            cycle:        _cycle,
            fromNationId: _fromId,
            toNationId:   _toId,
            eventType:    _eventType,
            intensity:    _intensity,
            timestamp:    block.timestamp
        }));

        emit ConflictLogged(_cycle, _fromId, _toId, _eventType, _intensity);
    }

    // ─────────────────────────────────────────
    // COMPARISON & ANALYSIS
    // ─────────────────────────────────────────

    /**
     * @notice Compare current metrics against the baseline.
     * @dev The core research output — what changed after the experiment?
     */
    function compareToBaseline()
        external
        view
        returns (
            int256 stabilityDelta,
            int256 conflictDelta,
            int256 tradeDelta,
            int256 proxyDelta,
            int256 dealIntegrityDelta
        )
    {
        require(baselineSet, "MetricsOracle: no baseline set");

        stabilityDelta = int256(regionalStabilityIndex)
                       - int256(baseline.regionalStabilityIndex);

        conflictDelta  = int256(totalConflictEvents)
                       - int256(baseline.totalConflictEvents);

        tradeDelta     = int256(totalTradeVolume)
                       - int256(baseline.totalTradeVolume);

        proxyDelta     = int256(totalProxyActivity)
                       - int256(baseline.totalProxyActivity);

        dealIntegrityDelta = int256(peaceDealIntegrity)
                           - int256(baseline.peaceDealIntegrity);
    }

    /**
     * @notice Get metrics for a specific past cycle.
     */
    function getCycleSnapshot(uint256 _cycle)
        external
        view
        returns (CycleSnapshot memory)
    {
        return snapshots[_cycle];
    }

    /**
     * @notice Get the full experiment history.
     * @dev Researchers use this to audit every change made to the simulation.
     */
    function getExperimentHistory()
        external
        view
        returns (ExperimentRecord[] memory)
    {
        return experimentRecords;
    }

    /**
     * @notice Get the full conflict log.
     */
    function getConflictLog()
        external
        view
        returns (ConflictEvent[] memory)
    {
        return conflictLog;
    }

    /**
     * @notice Get a summary of current metrics.
     * @dev The main dashboard data.
     */
    function getCurrentMetrics()
        external
        view
        returns (
            uint256 stability,
            uint256 conflicts,
            uint256 trade,
            uint256 proxy,
            uint256 dealIntegrity,
            uint256 cycle
        )
    {
        return (
            regionalStabilityIndex,
            totalConflictEvents,
            totalTradeVolume,
            totalProxyActivity,
            peaceDealIntegrity,
            snapshotCount
        );
    }
}
