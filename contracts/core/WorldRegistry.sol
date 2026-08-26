// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./NationDAO.sol";
import "./CitizenToken.sol";
import "./CitizenTokenFactory.sol";
import "./NationDAOFactory.sol";

/**
 * @title WorldRegistry
 * @notice The simulation controller — the "map" of the entire world.
 *
 * The WorldRegistry:
 *  - Deploys and tracks all NationDAOs
 *  - Loads scenario configs (like middle-east-2026)
 *  - Manages relationships between nations
 *  - Controls active global events (peace deals, sanctions, resource events)
 *  - Runs simulation cycles and triggers the MetricsOracle
 *
 * Think of it as the UN + the laws of physics of the simulation.
 * It doesn't govern individual nations — it governs the world they live in.
 */
contract WorldRegistry is Ownable {

    // ─────────────────────────────────────────
    // STRUCTS
    // ─────────────────────────────────────────

    struct Nation {
        string id;
        string name;
        address daoAddress;
        address tokenAddress;
        bool active;
        uint256 registeredAt;
    }

    struct Relationship {
        string fromNationId;
        string toNationId;
        RelationshipType relType;
        uint256 stabilityScore;   // 0–100, how likely to hold
        bool treatyActive;
        string treatyName;
        uint256 lastUpdated;
    }

    struct GlobalEvent {
        string id;
        string name;
        EventType eventType;
        EventStatus status;
        string[] parties;         // nation IDs involved
        string description;
        uint256 createdAt;
        uint256 updatedAt;
    }

    // Calldata-only input shapes for the batched setRelationships /
    // createGlobalEvents below — same fields as setRelationship's /
    // createGlobalEvent's own parameter lists, just packaged as one
    // struct per item so a deploy can pass N of them in a single
    // transaction instead of N separate ones.
    struct RelationshipInput {
        string fromId;
        string toId;
        RelationshipType relType;
        uint256 stabilityScore;
        bool treatyActive;
        string treatyName;
    }

    struct GlobalEventInput {
        string id;
        string name;
        EventType eventType;
        string[] parties;
        string description;
    }

    // Calldata-only shape for commitCycleWithNarrative below — never
    // written to storage, only ever read out of calldata and re-emitted
    // as a DecisionRecorded event per nation.
    struct DecisionRecord {
        string nationId;
        string primaryAction;
        string reasoning;
        string researchNote;
    }

    // ─────────────────────────────────────────
    // ENUMS
    // ─────────────────────────────────────────

    enum RelationshipType {
        ALLIED,
        PARTNER,
        NEUTRAL,
        FRAGILE_PEACE,
        COLD,
        SANCTIONED,
        HOSTILE
    }

    enum EventType {
        PEACE_DEAL,
        WAR,
        RESOURCE_EVENT,
        ECONOMIC_CRISIS,
        ELECTION,
        COUP,
        SANCTIONS
    }

    enum EventStatus {
        PENDING,
        ACTIVE,
        ACTIVE_FRAGILE,
        RESOLVED,
        COLLAPSED
    }

    // ─────────────────────────────────────────
    // STATE
    // ─────────────────────────────────────────

    string public scenarioName;
    string public scenarioVersion;
    uint256 public currentCycle;
    uint256 public totalCycles;
    bool    public simulationActive;

    // Nation registry
    mapping(string => Nation) public nations;
    string[] public nationIds;

    // Relationships — key is "fromId:toId"
    mapping(bytes32 => Relationship) public relationships;
    bytes32[] public relationshipKeys;

    // Global events
    mapping(string => GlobalEvent) public globalEvents;
    string[] public eventIds;

    // MetricsOracle address
    address public metricsOracle;

    // Deploy the CitizenToken + NationDAO pair per nation — kept out of this
    // contract's own bytecode (each `new` call inlines the full creation
    // bytecode of what it deploys, and this contract doing that for two
    // contracts at once pushed it well past the EIP-170 24KB limit that real
    // networks enforce; local Hardhat's allowUnlimitedContractSize hid this).
    CitizenTokenFactory public citizenTokenFactory;
    NationDAOFactory    public nationDAOFactory;

    // ─────────────────────────────────────────
    // EVENTS
    // ─────────────────────────────────────────

    event ScenarioLoaded(string name, string version);
    event NationRegistered(string nationId, address dao, address token);
    event RelationshipSet(
        string fromId,
        string toId,
        RelationshipType relType
    );
    event GlobalEventCreated(string eventId, EventType eventType);
    event GlobalEventUpdated(string eventId, EventStatus newStatus);
    event CycleAdvanced(uint256 cycle);
    event SimulationStarted(uint256 totalCycles);
    event SimulationEnded(uint256 finalCycle);

    // A decision/narrative record is never stored in contract storage —
    // only emitted as an event. Events are far cheaper than storage and
    // are permanently queryable via any RPC's getLogs, which is exactly
    // what a "replay this run's reasoning" viewer needs and nothing more:
    // this is the mechanism, not a place to add on-chain business logic.
    event DecisionRecorded(
        uint256 indexed cycle,
        string nationId,
        string primaryAction,
        string reasoning,
        string researchNote
    );
    event CycleNarrativeRecorded(
        uint256 indexed cycle,
        string quantumSummary,
        string marketSummary
    );

    // ─────────────────────────────────────────
    // CONSTRUCTOR
    // ─────────────────────────────────────────

    constructor(address _initialOwner) Ownable(_initialOwner) {}

    /**
     * @notice Point this registry at its two nation factories. Must be
     *         called once before registerNation(); separate from the
     *         constructor so existing deploy call sites (tests, scripts)
     *         don't all need extra constructor arguments.
     */
    function setNationFactories(address _tokenFactory, address _daoFactory) external onlyOwner {
        citizenTokenFactory = CitizenTokenFactory(_tokenFactory);
        nationDAOFactory    = NationDAOFactory(_daoFactory);
    }

    /**
     * @notice Wire the oracle and factories, and initialize the
     *         scenario, all in ONE transaction.
     * @dev Ergonomics-only addition, same reasoning as commitCycle's own
     *      doc comment: setMetricsOracle, setNationFactories, and
     *      initializeScenario were always called back-to-back by the
     *      same deploy signer, immediately after the registry, oracle,
     *      and both factories finish deploying (which — unlike this —
     *      genuinely can't be merged: each is a separate large contract
     *      whose creation bytecode can't be embedded into a wrapper
     *      without blowing past EIP-170's 24,576-byte limit). This one
     *      combines three plain storage writes with no such limit.
     *      setMetricsOracle/setNationFactories/initializeScenario all
     *      remain independently available for any caller that wants
     *      finer-grained control (e.g. re-wiring just one piece later).
     */
    function bootstrapConfig(
        address _oracle,
        address _tokenFactory,
        address _daoFactory,
        string calldata _name,
        string calldata _version,
        uint256 _totalCycles
    ) external onlyOwner {
        metricsOracle = _oracle;
        citizenTokenFactory = CitizenTokenFactory(_tokenFactory);
        nationDAOFactory    = NationDAOFactory(_daoFactory);

        scenarioName    = _name;
        scenarioVersion = _version;
        totalCycles     = _totalCycles;
        currentCycle    = 0;
        simulationActive = false;

        emit ScenarioLoaded(_name, _version);
    }

    // ─────────────────────────────────────────
    // SCENARIO SETUP
    // ─────────────────────────────────────────

    /**
     * @notice Initialize a new scenario.
     * @dev Called once before registering nations and events.
     */
    function initializeScenario(
        string calldata _name,
        string calldata _version,
        uint256 _totalCycles
    ) external onlyOwner {
        scenarioName    = _name;
        scenarioVersion = _version;
        totalCycles     = _totalCycles;
        currentCycle    = 0;
        simulationActive = false;

        emit ScenarioLoaded(_name, _version);
    }

    /**
     * @notice Deploy and register a new nation in the simulation.
     * @dev Deploys a CitizenToken and NationDAO, then registers both.
     */
    function registerNation(
        NationDAO.NationConfig calldata _config,
        uint256 _tokenSupply,
        uint256 _initialTreasury,
        uint256 _initialMilitaryPower
    ) external onlyOwner returns (address daoAddress, address tokenAddress) {
        require(
            address(citizenTokenFactory) != address(0) && address(nationDAOFactory) != address(0),
            "WorldRegistry: factories not set"
        );

        address token = citizenTokenFactory.deployToken(
            _config.name,
            _config.nationId,
            _tokenSupply,
            address(this)           // WorldRegistry owns the token
        );

        address dao = nationDAOFactory.deployDAO(
            _config,
            token,
            address(this),           // WorldRegistry owns the DAO
            _initialTreasury,
            _initialMilitaryPower
        );

        // Register
        nations[_config.nationId] = Nation({
            id:            _config.nationId,
            name:          _config.name,
            daoAddress:    dao,
            tokenAddress:  token,
            active:        true,
            registeredAt:  block.timestamp
        });

        nationIds.push(_config.nationId);

        emit NationRegistered(_config.nationId, dao, token);

        return (dao, token);
    }

    /**
     * @notice Distribute citizenship tokens to initial holders.
     * @dev Called after registerNation to set up the citizen distribution.
     *      In the simulation, these represent population segments.
     */
    function distributeCitizenship(
        string calldata _nationId,
        address[] calldata _citizens,
        uint256[] calldata _amounts
    ) external onlyOwner {
        require(
            _citizens.length == _amounts.length,
            "WorldRegistry: length mismatch"
        );

        Nation storage nation = nations[_nationId];
        require(nation.active, "WorldRegistry: nation not found");

        CitizenToken token = CitizenToken(nation.tokenAddress);

        for (uint256 i = 0; i < _citizens.length; i++) {
            token.grantCitizenship(_citizens[i], _amounts[i]);
        }
    }

    /**
     * @notice Deploy, register, AND distribute citizenship for one
     *         nation, in ONE transaction.
     * @dev Ergonomics-only addition — registerNation() and
     *      distributeCitizenship() were always called back-to-back for
     *      the same nation by the same deploy signer, and the latter
     *      needs nothing distributeCitizenship() itself doesn't already
     *      have (it just needs THIS nation's token address, which this
     *      function already has fresh from the deploy above — no new
     *      capability, just fewer round trips). Both remain
     *      independently available; this doesn't touch either.
     */
    function registerNationAndDistributeCitizenship(
        NationDAO.NationConfig calldata _config,
        uint256 _tokenSupply,
        uint256 _initialTreasury,
        uint256 _initialMilitaryPower,
        address[] calldata _citizens,
        uint256[] calldata _amounts
    ) external onlyOwner returns (address daoAddress, address tokenAddress) {
        require(
            address(citizenTokenFactory) != address(0) && address(nationDAOFactory) != address(0),
            "WorldRegistry: factories not set"
        );
        require(_citizens.length == _amounts.length, "WorldRegistry: length mismatch");

        address token = citizenTokenFactory.deployToken(
            _config.name,
            _config.nationId,
            _tokenSupply,
            address(this)
        );

        address dao = nationDAOFactory.deployDAO(
            _config,
            token,
            address(this),
            _initialTreasury,
            _initialMilitaryPower
        );

        nations[_config.nationId] = Nation({
            id:            _config.nationId,
            name:          _config.name,
            daoAddress:    dao,
            tokenAddress:  token,
            active:        true,
            registeredAt:  block.timestamp
        });

        nationIds.push(_config.nationId);

        emit NationRegistered(_config.nationId, dao, token);

        CitizenToken tokenContract = CitizenToken(token);
        for (uint256 i = 0; i < _citizens.length; i++) {
            tokenContract.grantCitizenship(_citizens[i], _amounts[i]);
        }

        return (dao, token);
    }

    // ─────────────────────────────────────────
    // RELATIONSHIPS
    // ─────────────────────────────────────────

    /**
     * @notice Set the relationship between two nations.
     */
    function setRelationship(
        string calldata _fromId,
        string calldata _toId,
        RelationshipType _relType,
        uint256 _stabilityScore,
        bool _treatyActive,
        string calldata _treatyName
    ) external onlyOwner {
        bytes32 key = _relationshipKey(_fromId, _toId);

        relationships[key] = Relationship({
            fromNationId:   _fromId,
            toNationId:     _toId,
            relType:        _relType,
            stabilityScore: _stabilityScore,
            treatyActive:   _treatyActive,
            treatyName:     _treatyName,
            lastUpdated:    block.timestamp
        });

        // Mirror it — A→B is same as B→A
        bytes32 mirrorKey = _relationshipKey(_toId, _fromId);
        relationships[mirrorKey] = relationships[key];

        relationshipKeys.push(key);

        // Update each nation's DAO
        NationDAO fromDao = NationDAO(nations[_fromId].daoAddress);
        NationDAO toDao   = NationDAO(nations[_toId].daoAddress);

        fromDao.setRelationship(_toId, _relTypeToString(_relType));
        toDao.setRelationship(_fromId, _relTypeToString(_relType));

        emit RelationshipSet(_fromId, _toId, _relType);
    }

    /**
     * @notice Set several relationships in ONE transaction.
     * @dev Ergonomics-only addition — a deploy's relationships are
     *      always known in full up front and set back-to-back by the
     *      same signer, with no dependency between them, so there's no
     *      reason each one needs its own transaction. setRelationship()
     *      remains available for setting or updating just one later.
     */
    function setRelationships(RelationshipInput[] calldata _rels) external onlyOwner {
        for (uint256 i = 0; i < _rels.length; i++) {
            RelationshipInput calldata r = _rels[i];

            bytes32 key = _relationshipKey(r.fromId, r.toId);

            relationships[key] = Relationship({
                fromNationId:   r.fromId,
                toNationId:     r.toId,
                relType:        r.relType,
                stabilityScore: r.stabilityScore,
                treatyActive:   r.treatyActive,
                treatyName:     r.treatyName,
                lastUpdated:    block.timestamp
            });

            bytes32 mirrorKey = _relationshipKey(r.toId, r.fromId);
            relationships[mirrorKey] = relationships[key];

            relationshipKeys.push(key);

            NationDAO fromDao = NationDAO(nations[r.fromId].daoAddress);
            NationDAO toDao   = NationDAO(nations[r.toId].daoAddress);

            fromDao.setRelationship(r.toId, _relTypeToString(r.relType));
            toDao.setRelationship(r.fromId, _relTypeToString(r.relType));

            emit RelationshipSet(r.fromId, r.toId, r.relType);
        }
    }

    /**
     * @notice Update relationship stability score.
     * @dev Called by MetricsOracle each cycle.
     */
    function updateRelationshipStability(
        string calldata _fromId,
        string calldata _toId,
        uint256 _newScore
    ) external {
        require(
            msg.sender == metricsOracle || msg.sender == owner(),
            "WorldRegistry: not authorized"
        );

        bytes32 key = _relationshipKey(_fromId, _toId);
        relationships[key].stabilityScore = _newScore;
        relationships[key].lastUpdated    = block.timestamp;
    }

    // ─────────────────────────────────────────
    // GLOBAL EVENTS
    // ─────────────────────────────────────────

    /**
     * @notice Register a global event (peace deal, war, sanctions, etc.)
     */
    function createGlobalEvent(
        string calldata _id,
        string calldata _name,
        EventType _eventType,
        string[] calldata _parties,
        string calldata _description
    ) external onlyOwner {
        globalEvents[_id] = GlobalEvent({
            id:          _id,
            name:        _name,
            eventType:   _eventType,
            status:      EventStatus.ACTIVE,
            parties:     _parties,
            description: _description,
            createdAt:   block.timestamp,
            updatedAt:   block.timestamp
        });

        eventIds.push(_id);

        emit GlobalEventCreated(_id, _eventType);
    }

    /**
     * @notice Create several global events in ONE transaction.
     * @dev Ergonomics-only addition, same reasoning as setRelationships.
     *      createGlobalEvent() remains available for adding one later
     *      (e.g. a researcher-triggered experiment mid-run).
     */
    function createGlobalEvents(GlobalEventInput[] calldata _events) external onlyOwner {
        for (uint256 i = 0; i < _events.length; i++) {
            GlobalEventInput calldata e = _events[i];

            globalEvents[e.id] = GlobalEvent({
                id:          e.id,
                name:        e.name,
                eventType:   e.eventType,
                status:      EventStatus.ACTIVE,
                parties:     e.parties,
                description: e.description,
                createdAt:   block.timestamp,
                updatedAt:   block.timestamp
            });

            eventIds.push(e.id);

            emit GlobalEventCreated(e.id, e.eventType);
        }
    }

    /**
     * @notice Update the status of a global event.
     * @dev This is how experiments are run — changing event status
     *      triggers cascading effects in the simulation.
     */
    function updateEventStatus(
        string calldata _eventId,
        EventStatus _newStatus
    ) external onlyOwner {
        GlobalEvent storage evt = globalEvents[_eventId];
        evt.status    = _newStatus;
        evt.updatedAt = block.timestamp;

        // Cascading effects based on event type and new status
        _applyEventEffects(_eventId, _newStatus);

        emit GlobalEventUpdated(_eventId, _newStatus);
    }

    // ─────────────────────────────────────────
    // SIMULATION CONTROL
    // ─────────────────────────────────────────

    /**
     * @notice Start running the simulation.
     */
    function startSimulation() external onlyOwner {
        require(!simulationActive, "WorldRegistry: already running");
        simulationActive = true;
        emit SimulationStarted(totalCycles);
    }

    /**
     * @notice Set the scenario's starting metrics AND start the
     *         simulation, in ONE transaction.
     * @dev Ergonomics-only addition, same reasoning as commitCycle's own
     *      doc comment (which does the equivalent combination for every
     *      cycle after the first) — a deploy always set the starting
     *      metrics on the oracle immediately before calling
     *      startSimulation(), from the same signer. Both remain
     *      independently available.
     */
    function setInitialMetricsAndStart(
        uint256 _stabilityIndex,
        uint256 _conflictEvents,
        uint256 _tradeVolume,
        uint256 _proxyActivity,
        uint256 _dealIntegrity
    ) external onlyOwner {
        require(metricsOracle != address(0), "WorldRegistry: oracle not wired");
        require(!simulationActive, "WorldRegistry: already running");

        IMetricsOracle(metricsOracle).updateMetrics(
            _stabilityIndex,
            _conflictEvents,
            _tradeVolume,
            _proxyActivity,
            _dealIntegrity
        );

        simulationActive = true;
        emit SimulationStarted(totalCycles);
    }

    /**
     * @notice Advance the simulation by one cycle.
     * @dev Each cycle represents approximately 1 month.
     *      The MetricsOracle calculates scores at the end of each cycle.
     */
    function advanceCycle() external onlyOwner {
        _advanceCycle();
    }

    /**
     * @notice Update this cycle's metrics AND advance the simulation, in
     *         ONE transaction.
     * @dev Ergonomics-only addition, not a new capability: the AI Agent
     *      Cycle flow always called oracle.updateMetrics() immediately
     *      followed by registry.advanceCycle() from the same signer —
     *      two separate MetaMask approvals per cycle on a real network
     *      (Sepolia) for what's really one logical step. This combines
     *      them. oracle.updateMetrics() directly and advanceCycle()
     *      separately both remain available for any caller that wants
     *      finer-grained control (e.g. the CLI experiment scripts, which
     *      sign locally and don't pay the same per-tx approval cost).
     */
    function commitCycle(
        uint256 _stabilityIndex,
        uint256 _conflictEvents,
        uint256 _tradeVolume,
        uint256 _proxyActivity,
        uint256 _dealIntegrity
    ) external onlyOwner {
        require(metricsOracle != address(0), "WorldRegistry: oracle not wired");
        IMetricsOracle(metricsOracle).updateMetrics(
            _stabilityIndex,
            _conflictEvents,
            _tradeVolume,
            _proxyActivity,
            _dealIntegrity
        );
        _advanceCycle();
    }

    /**
     * @notice Same as commitCycle, but also permanently records why: each
     *         nation's decision this cycle, plus a quantum-collapse and
     *         market narrative summary — all as event logs, not storage.
     * @dev A separate function, not a new commitCycle overload/signature
     *      change: the existing wallet-connected AI Agent Cycle call site
     *      (contracts.js -> registry.commitCycle(5 args)) keeps working
     *      unmodified. This is purely additive. Decisions/narrative are
     *      never written to storage or read back on-chain by this
     *      contract — they only ever need to be queryable later via
     *      getLogs, which events already give you for free and far more
     *      cheaply than storage would.
     */
    function commitCycleWithNarrative(
        uint256 _stabilityIndex,
        uint256 _conflictEvents,
        uint256 _tradeVolume,
        uint256 _proxyActivity,
        uint256 _dealIntegrity,
        DecisionRecord[] calldata _decisions,
        string calldata _quantumSummary,
        string calldata _marketSummary
    ) external onlyOwner {
        require(metricsOracle != address(0), "WorldRegistry: oracle not wired");
        IMetricsOracle(metricsOracle).updateMetrics(
            _stabilityIndex,
            _conflictEvents,
            _tradeVolume,
            _proxyActivity,
            _dealIntegrity
        );

        // currentCycle hasn't incremented yet at this point — _advanceCycle()
        // below is what bumps it — so the cycle these decisions belong to
        // is currentCycle + 1, matching the CycleAdvanced event it emits.
        uint256 recordedCycle = currentCycle + 1;
        for (uint256 i = 0; i < _decisions.length; i++) {
            emit DecisionRecorded(
                recordedCycle,
                _decisions[i].nationId,
                _decisions[i].primaryAction,
                _decisions[i].reasoning,
                _decisions[i].researchNote
            );
        }
        emit CycleNarrativeRecorded(recordedCycle, _quantumSummary, _marketSummary);

        _advanceCycle();
    }

    function _advanceCycle() private {
        require(simulationActive, "WorldRegistry: simulation not active");
        require(currentCycle < totalCycles, "WorldRegistry: simulation complete");

        currentCycle++;

        // Trigger metrics calculation
        if (metricsOracle != address(0)) {
            IMetricsOracle(metricsOracle).calculateCycleMetrics(currentCycle);
        }

        emit CycleAdvanced(currentCycle);

        if (currentCycle >= totalCycles) {
            simulationActive = false;
            emit SimulationEnded(currentCycle);
        }
    }

    /**
     * @notice Apply an experiment — change one variable and observe effects.
     * @dev This is the core research function. Researchers call this
     *      to test "what if" scenarios.
     */
    function applyExperiment(
        string calldata _experimentId,
        string calldata _targetNationId,
        string calldata _parameter,
        uint256 _newValue
    ) external onlyOwner {
        Nation storage nation = nations[_targetNationId];
        require(nation.active, "WorldRegistry: nation not found");

        NationDAO dao = NationDAO(nation.daoAddress);

        // Route to the correct parameter
        bytes32 param = keccak256(abi.encodePacked(_parameter));

        if (param == keccak256("treasury")) {
            dao.setTreasury(_newValue);
        } else if (param == keccak256("militaryPower")) {
            dao.setMilitaryPower(_newValue);
        } else if (param == keccak256("stabilityScore")) {
            dao.setStabilityScore(_newValue);
        } else if (param == keccak256("hardlinerPressure")) {
            dao.setHardlinerPressure(_newValue);
        }

        // MetricsOracle records the experiment change
        if (metricsOracle != address(0)) {
            IMetricsOracle(metricsOracle).recordExperiment(
                _experimentId,
                _targetNationId,
                _parameter,
                _newValue,
                currentCycle
            );
        }
    }

    // ─────────────────────────────────────────
    // VIEWS
    // ─────────────────────────────────────────

    function getNation(string calldata _nationId)
        external
        view
        returns (Nation memory)
    {
        return nations[_nationId];
    }

    function getRelationship(string calldata _fromId, string calldata _toId)
        external
        view
        returns (Relationship memory)
    {
        return relationships[_relationshipKey(_fromId, _toId)];
    }

    function getAllNationIds() external view returns (string[] memory) {
        return nationIds;
    }

    function getGlobalEvent(string calldata _eventId)
        external
        view
        returns (GlobalEvent memory)
    {
        return globalEvents[_eventId];
    }

    function getNationCount() external view returns (uint256) {
        return nationIds.length;
    }

    // ─────────────────────────────────────────
    // ADMIN
    // ─────────────────────────────────────────

    function setMetricsOracle(address _oracle) external onlyOwner {
        metricsOracle = _oracle;
    }

    // ─────────────────────────────────────────
    // INTERNAL
    // ─────────────────────────────────────────

    function _relationshipKey(string memory _a, string memory _b)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(_a, ":", _b));
    }

    function _relTypeToString(RelationshipType _type)
        internal
        pure
        returns (string memory)
    {
        if (_type == RelationshipType.ALLIED)        return "ALLIED";
        if (_type == RelationshipType.PARTNER)       return "PARTNER";
        if (_type == RelationshipType.NEUTRAL)       return "NEUTRAL";
        if (_type == RelationshipType.FRAGILE_PEACE) return "FRAGILE_PEACE";
        if (_type == RelationshipType.COLD)          return "COLD";
        if (_type == RelationshipType.SANCTIONED)    return "SANCTIONED";
        return "HOSTILE";
    }

    /**
     * @dev Apply cascading effects when a global event changes status.
     *      This is where the simulation logic lives — events have
     *      real consequences on nation parameters.
     */
    function _applyEventEffects(
        string memory _eventId,
        EventStatus _newStatus
    ) internal {
        GlobalEvent storage evt = globalEvents[_eventId];

        // Peace deal collapses — increase tensions between parties
        if (
            evt.eventType == EventType.PEACE_DEAL &&
            _newStatus == EventStatus.COLLAPSED
        ) {
            for (uint256 i = 0; i < evt.parties.length; i++) {
                for (uint256 j = i + 1; j < evt.parties.length; j++) {
                    bytes32 key = _relationshipKey(
                        evt.parties[i],
                        evt.parties[j]
                    );
                    // Downgrade relationship
                    if (relationships[key].relType == RelationshipType.FRAGILE_PEACE) {
                        relationships[key].relType = RelationshipType.HOSTILE;
                        relationships[key].stabilityScore = 10;

                        // Update DAOs
                        NationDAO fromDao = NationDAO(
                            nations[evt.parties[i]].daoAddress
                        );
                        fromDao.setRelationship(
                            evt.parties[j],
                            "HOSTILE"
                        );
                    }
                }
            }
        }

        // Sanctions imposed — reduce target nation treasury
        if (
            evt.eventType == EventType.SANCTIONS &&
            _newStatus == EventStatus.ACTIVE
        ) {
            for (uint256 i = 0; i < evt.parties.length; i++) {
                Nation storage nation = nations[evt.parties[i]];
                if (nation.active) {
                    NationDAO dao = NationDAO(nation.daoAddress);
                    // Reduce treasury by 20%
                    uint256 current = dao.treasury();
                    dao.setTreasury((current * 80) / 100);
                }
            }
        }
    }
}

// Interface for MetricsOracle
interface IMetricsOracle {
    function calculateCycleMetrics(uint256 cycle) external;
    function recordExperiment(
        string calldata experimentId,
        string calldata nationId,
        string calldata parameter,
        uint256 newValue,
        uint256 cycle
    ) external;
    function updateMetrics(
        uint256 stabilityIndex,
        uint256 conflictEvents,
        uint256 tradeVolume,
        uint256 proxyActivity,
        uint256 dealIntegrity
    ) external;
}
