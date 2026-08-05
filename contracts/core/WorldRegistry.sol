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
     * @notice Advance the simulation by one cycle.
     * @dev Each cycle represents approximately 1 month.
     *      The MetricsOracle calculates scores at the end of each cycle.
     */
    function advanceCycle() external onlyOwner {
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
}
