// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title NationDAO
 * @notice The governance engine for a single nation in the simulation.
 *
 * Each nation is parameterized at deployment to reflect its real-world
 * governance structure. A parliamentary democracy behaves differently
 * from a theocratic republic or an absolute monarchy.
 *
 * The full proposal lifecycle:
 *   PENDING → ACTIVE → SUCCEEDED/DEFEATED → EXECUTED/CANCELLED
 *
 * Real world parallels:
 *   - Proposal     = a policy, law, or action a government takes
 *   - Voting       = citizens or council casting votes
 *   - Quorum       = minimum participation required to be legitimate
 *   - Guardian veto = Iran's clerical council override
 *   - Royal veto    = Saudi king override
 *   - Timelock      = delay between decision and execution
 */
contract NationDAO is Ownable {

    // ─────────────────────────────────────────
    // GOVERNANCE TYPES
    // ─────────────────────────────────────────

    enum GovernanceType {
        PARLIAMENTARY_DEMOCRACY,  // Israel
        THEOCRATIC_REPUBLIC,      // Iran
        ABSOLUTE_MONARCHY,        // Saudi Arabia
        FEDERAL_REPUBLIC,         // generic
        MILITARY_JUNTA            // generic
    }

    enum VotingMechanism {
        ONE_TOKEN_ONE_VOTE,       // pure democracy
        DUAL_LAYER,               // citizen vote + clerical veto (Iran)
        COUNCIL_WEIGHTED,         // small council decides (Saudi)
        QUADRATIC                 // sqrt(tokens) — more balanced
    }

    // ─────────────────────────────────────────
    // PROPOSAL LIFECYCLE
    // ─────────────────────────────────────────

    enum ProposalState {
        PENDING,      // submitted, voting not started
        ACTIVE,       // voting window open
        SUCCEEDED,    // passed — waiting for execution
        DEFEATED,     // failed to pass
        EXECUTED,     // carried out
        CANCELLED,    // withdrawn or vetoed
        VETOED        // blocked by guardian/royal veto
    }

    enum ProposalType {
        DOMESTIC_POLICY,     // internal governance
        DECLARE_ALLIANCE,    // form alliance with another nation
        BREAK_ALLIANCE,      // exit existing alliance
        IMPOSE_SANCTIONS,    // economic warfare
        FUND_PROXY,          // fund a non-state actor
        CLOSE_RESOURCE,      // e.g. close Hormuz Strait
        OPEN_RESOURCE,       // e.g. reopen strait
        DECLARE_CEASEFIRE,   // end active conflict
        SIGN_TREATY          // formal agreement with another nation
    }

    struct Proposal {
        uint256 id;
        address proposer;
        ProposalType proposalType;
        string description;

        // Target — what nation or entity this affects
        address target;
        bytes callData;           // encoded action to execute

        // Voting
        uint256 votingStart;
        uint256 votingEnd;
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 votesAbstain;

        // State
        ProposalState state;
        bool guardianVetoed;      // Iran: clerical council blocked it
        bool royalVetoed;         // Saudi: king blocked it
        string vetoReason;

        // Execution
        bool executed;
        uint256 executedAt;
    }

    // ─────────────────────────────────────────
    // NATION CONFIGURATION
    // Set at deployment — reflects real world
    // ─────────────────────────────────────────

    struct NationConfig {
        string name;
        string nationId;
        GovernanceType governanceType;
        VotingMechanism votingMechanism;

        // How many tokens needed to submit a proposal
        uint256 proposalThreshold;

        // % of total supply that must vote (0–100)
        uint256 quorumPercent;

        // Voting window in blocks (~1 block = 12 seconds on Ethereum)
        uint256 votingPeriodBlocks;

        // Delay between proposal creation and voting start
        uint256 votingDelayBlocks;

        // Delay between passing and execution (safety buffer)
        uint256 timelockBlocks;

        // Special veto powers
        bool hasGuardianVeto;     // Iran — clerical council override
        bool hasRoyalVeto;        // Saudi — king override
        address guardianCouncil;  // address with veto power
        address royalAuthority;   // address with royal veto

        // Internal pressure parameters
        uint256 hardlinerPressure;  // 0–100, affects foreign policy proposals
        uint256 reformPressure;     // 0–100, affects domestic proposals
    }

    // ─────────────────────────────────────────
    // STATE
    // ─────────────────────────────────────────

    NationConfig public config;
    address public citizenToken;       // the CitizenToken contract
    address public worldRegistry;      // the simulation controller

    uint256 public proposalCount;
    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    // Nation resources (relative units 0–100)
    mapping(string => uint256) public resources;

    // Current relationships with other nations
    // nationId => relationship type string
    mapping(string => string) public relationships;

    // Treasury balance in simulation units
    uint256 public treasury;

    // Military power score
    uint256 public militaryPower;

    // Stability score (0–100) — updated by MetricsOracle
    uint256 public stabilityScore;

    // ─────────────────────────────────────────
    // EVENTS
    // ─────────────────────────────────────────

    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        ProposalType proposalType,
        string description
    );

    event VoteCast(
        uint256 indexed proposalId,
        address indexed voter,
        uint8 support,            // 0=against, 1=for, 2=abstain
        uint256 weight
    );

    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalVetoed(uint256 indexed proposalId, string reason);
    event ProposalDefeated(uint256 indexed proposalId);

    event ResourceUpdated(string resource, uint256 oldValue, uint256 newValue);
    event RelationshipChanged(string nationId, string oldType, string newType);
    event TreasuryChanged(uint256 oldValue, uint256 newValue);
    event StabilityUpdated(uint256 oldScore, uint256 newScore);

    // ─────────────────────────────────────────
    // MODIFIERS
    // ─────────────────────────────────────────

    modifier onlyWorldRegistry() {
        require(
            msg.sender == worldRegistry,
            "NationDAO: only WorldRegistry"
        );
        _;
    }

    modifier onlyGuardianCouncil() {
        require(
            msg.sender == config.guardianCouncil,
            "NationDAO: only guardian council"
        );
        _;
    }

    modifier onlyRoyalAuthority() {
        require(
            msg.sender == config.royalAuthority,
            "NationDAO: only royal authority"
        );
        _;
    }

    // ─────────────────────────────────────────
    // CONSTRUCTOR
    // ─────────────────────────────────────────

    constructor(
        NationConfig memory _config,
        address _citizenToken,
        address _worldRegistry,
        uint256 _initialTreasury,
        uint256 _initialMilitaryPower,
        address _initialOwner
    ) Ownable(_initialOwner) {
        config         = _config;
        citizenToken   = _citizenToken;
        worldRegistry  = _worldRegistry;
        treasury       = _initialTreasury;
        militaryPower  = _initialMilitaryPower;
        stabilityScore = 50;      // start at neutral
    }

    // ─────────────────────────────────────────
    // PROPOSALS
    // ─────────────────────────────────────────

    /**
     * @notice Submit a governance proposal.
     * @dev Caller must hold enough CitizenTokens to meet proposalThreshold.
     */
    function propose(
        ProposalType _type,
        string calldata _description,
        address _target,
        bytes calldata _callData
    ) external returns (uint256) {

        // Check proposal threshold
        uint256 voterBalance = _getVotingWeight(msg.sender);
        require(
            voterBalance >= config.proposalThreshold,
            "NationDAO: insufficient tokens to propose"
        );

        // Certain proposal types are blocked based on governance config
        _checkProposalPermissions(_type);

        proposalCount++;
        uint256 proposalId = proposalCount;

        proposals[proposalId] = Proposal({
            id:             proposalId,
            proposer:       msg.sender,
            proposalType:   _type,
            description:    _description,
            target:         _target,
            callData:       _callData,
            votingStart:    block.number + config.votingDelayBlocks,
            votingEnd:      block.number + config.votingDelayBlocks
                                         + config.votingPeriodBlocks,
            votesFor:       0,
            votesAgainst:   0,
            votesAbstain:   0,
            state:          ProposalState.PENDING,
            guardianVetoed: false,
            royalVetoed:    false,
            vetoReason:     "",
            executed:       false,
            executedAt:     0
        });

        emit ProposalCreated(proposalId, msg.sender, _type, _description);
        return proposalId;
    }

    /**
     * @notice Cast a vote on an active proposal.
     * @param _proposalId  The proposal to vote on
     * @param _support     0 = Against, 1 = For, 2 = Abstain
     */
    function castVote(uint256 _proposalId, uint8 _support) external {
        Proposal storage proposal = proposals[_proposalId];

        require(
            block.number >= proposal.votingStart,
            "NationDAO: voting not started"
        );
        require(
            block.number <= proposal.votingEnd,
            "NationDAO: voting ended"
        );
        require(
            !hasVoted[_proposalId][msg.sender],
            "NationDAO: already voted"
        );
        require(_support <= 2, "NationDAO: invalid vote");

        hasVoted[_proposalId][msg.sender] = true;

        // Snapshotted at proposal.votingStart, not msg.sender's live balance
        // — see _getVotingWeightAt()'s doc comment for why this matters.
        uint256 weight = _getVotingWeightAt(msg.sender, proposal.votingStart);
        require(weight > 0, "NationDAO: no voting power");

        if (_support == 0) {
            proposal.votesAgainst += weight;
        } else if (_support == 1) {
            proposal.votesFor += weight;
        } else {
            proposal.votesAbstain += weight;
        }

        // Update state to ACTIVE if still PENDING
        if (proposal.state == ProposalState.PENDING) {
            proposal.state = ProposalState.ACTIVE;
        }

        emit VoteCast(_proposalId, msg.sender, _support, weight);
    }

    /**
     * @notice Finalize a proposal after voting ends.
     * @dev Anyone can call this once the voting period is over.
     */
    function finalizeProposal(uint256 _proposalId) external {
        Proposal storage proposal = proposals[_proposalId];

        require(
            block.number > proposal.votingEnd,
            "NationDAO: voting not ended"
        );
        require(
            proposal.state == ProposalState.ACTIVE ||
            proposal.state == ProposalState.PENDING,
            "NationDAO: already finalized"
        );

        uint256 totalSupply = _getTotalSupplyAt(proposal.votingStart);
        uint256 totalVotes  = proposal.votesFor
                            + proposal.votesAgainst
                            + proposal.votesAbstain;

        // Check quorum
        bool quorumMet = totalSupply > 0 &&
            (totalVotes * 100) / totalSupply >= config.quorumPercent;

        // Check majority
        bool majorityFor = proposal.votesFor > proposal.votesAgainst;

        if (quorumMet && majorityFor) {
            proposal.state = ProposalState.SUCCEEDED;
        } else {
            proposal.state = ProposalState.DEFEATED;
            emit ProposalDefeated(_proposalId);
        }
    }

    /**
     * @notice Execute a succeeded proposal after the timelock.
     */
    function executeProposal(uint256 _proposalId) external {
        Proposal storage proposal = proposals[_proposalId];

        require(
            proposal.state == ProposalState.SUCCEEDED,
            "NationDAO: proposal not succeeded"
        );
        require(
            block.number >= proposal.votingEnd + config.timelockBlocks,
            "NationDAO: timelock not passed"
        );
        require(!proposal.executed, "NationDAO: already executed");

        proposal.executed   = true;
        proposal.executedAt = block.timestamp;
        proposal.state      = ProposalState.EXECUTED;

        // Execute the encoded action if there is one
        if (proposal.callData.length > 0 && proposal.target != address(0)) {
            (bool success, ) = proposal.target.call(proposal.callData);
            require(success, "NationDAO: execution failed");
        }

        emit ProposalExecuted(_proposalId);
    }

    // ─────────────────────────────────────────
    // VETO POWERS
    // Only available to nations with these mechanics
    // ─────────────────────────────────────────

    /**
     * @notice Guardian Council veto — Iran only.
     * @dev Clerical council can block any succeeded proposal.
     */
    function guardianVeto(uint256 _proposalId, string calldata _reason)
        external
        onlyGuardianCouncil
    {
        require(
            config.hasGuardianVeto,
            "NationDAO: no guardian veto in this governance type"
        );

        Proposal storage proposal = proposals[_proposalId];
        require(
            proposal.state == ProposalState.SUCCEEDED,
            "NationDAO: can only veto succeeded proposals"
        );

        proposal.state          = ProposalState.VETOED;
        proposal.guardianVetoed = true;
        proposal.vetoReason     = _reason;

        emit ProposalVetoed(_proposalId, _reason);
    }

    /**
     * @notice Royal veto — Saudi Arabia only.
     * @dev King can block any proposal at any stage.
     */
    function royalVeto(uint256 _proposalId, string calldata _reason)
        external
        onlyRoyalAuthority
    {
        require(
            config.hasRoyalVeto,
            "NationDAO: no royal veto in this governance type"
        );

        Proposal storage proposal = proposals[_proposalId];
        require(
            proposal.state != ProposalState.EXECUTED,
            "NationDAO: already executed"
        );

        proposal.state      = ProposalState.VETOED;
        proposal.royalVetoed = true;
        proposal.vetoReason = _reason;

        emit ProposalVetoed(_proposalId, _reason);
    }

    // ─────────────────────────────────────────
    // WORLD REGISTRY CONTROLS
    // The simulation controller can update state
    // to reflect scenario changes
    // ─────────────────────────────────────────

    function setResource(string calldata resource, uint256 value)
        external
        onlyWorldRegistry
    {
        uint256 old = resources[resource];
        resources[resource] = value;
        emit ResourceUpdated(resource, old, value);
    }

    function setRelationship(string calldata nationId, string calldata relType)
        external
        onlyWorldRegistry
    {
        string memory old = relationships[nationId];
        relationships[nationId] = relType;
        emit RelationshipChanged(nationId, old, relType);
    }

    function setTreasury(uint256 value) external onlyWorldRegistry {
        uint256 old = treasury;
        treasury = value;
        emit TreasuryChanged(old, value);
    }

    function setMilitaryPower(uint256 value) external onlyWorldRegistry {
        militaryPower = value;
    }

    function setStabilityScore(uint256 value) external onlyWorldRegistry {
        require(value <= 100, "NationDAO: score must be 0-100");
        uint256 old = stabilityScore;
        stabilityScore = value;
        emit StabilityUpdated(old, value);
    }

    function setHardlinerPressure(uint256 value) external onlyWorldRegistry {
        require(value <= 100, "NationDAO: must be 0-100");
        config.hardlinerPressure = value;
    }

    // ─────────────────────────────────────────
    // VIEWS
    // ─────────────────────────────────────────

    function getProposal(uint256 _proposalId)
        external
        view
        returns (Proposal memory)
    {
        return proposals[_proposalId];
    }

    function getProposalState(uint256 _proposalId)
        external
        view
        returns (ProposalState)
    {
        return proposals[_proposalId].state;
    }

    function getConfig() external view returns (NationConfig memory) {
        return config;
    }

    function getNationSummary() external view returns (
        string memory name,
        uint256 _treasury,
        uint256 _military,
        uint256 _stability,
        uint256 _proposalCount
    ) {
        return (
            config.name,
            treasury,
            militaryPower,
            stabilityScore,
            proposalCount
        );
    }

    // ─────────────────────────────────────────
    // INTERNAL HELPERS
    // ─────────────────────────────────────────

    /**
     * @dev Get an address's CURRENT voting weight — used only where there's
     *      no proposal snapshot yet to check against (the propose() threshold
     *      check, which happens before the proposal, and thus its
     *      votingStart block, exist). Safe to call at any time, including
     *      the current block.
     */
    function _getVotingWeight(address voter)
        internal
        view
        returns (uint256)
    {
        return IERC20Votes(citizenToken).getVotes(voter);
    }

    /**
     * @dev Get an address's voting weight AS OF a specific past block —
     *      used by castVote() to snapshot weight at proposal.votingStart.
     *      This is the fix for a real vulnerability: reading a live,
     *      freely-transferable balance instead of a checkpoint would let
     *      the same tokens vote multiple times by transferring between
     *      addresses between votes. hasVoted only blocks the same ADDRESS
     *      from voting twice, not the same underlying tokens.
     */
    function _getVotingWeightAt(address voter, uint256 blockNumber)
        internal
        view
        returns (uint256)
    {
        return IERC20Votes(citizenToken).getPastVotes(voter, blockNumber);
    }

    function _getTotalSupply() internal view returns (uint256) {
        return IERC20(citizenToken).totalSupply();
    }

    /// @dev Snapshotted total supply, for the same reason votes are snapshotted.
    function _getTotalSupplyAt(uint256 blockNumber) internal view returns (uint256) {
        return IERC20Votes(citizenToken).getPastTotalSupply(blockNumber);
    }

    /**
     * @dev Some proposal types are restricted based on governance type.
     *      E.g. absolute monarchies cannot have citizens propose treaties.
     */
    function _checkProposalPermissions(ProposalType _type) internal view {

        // In absolute monarchies, only the royal authority can propose
        // foreign policy actions
        if (config.governanceType == GovernanceType.ABSOLUTE_MONARCHY) {
            bool isForeignPolicy = (
                _type == ProposalType.DECLARE_ALLIANCE ||
                _type == ProposalType.BREAK_ALLIANCE   ||
                _type == ProposalType.IMPOSE_SANCTIONS ||
                _type == ProposalType.SIGN_TREATY      ||
                _type == ProposalType.CLOSE_RESOURCE
            );
            if (isForeignPolicy) {
                require(
                    msg.sender == config.royalAuthority,
                    "NationDAO: only royal authority can propose foreign policy"
                );
            }
        }

        // In theocratic republics, proposals that contradict clerical
        // principles are blocked at submission if hardliner pressure is high
        if (
            config.governanceType == GovernanceType.THEOCRATIC_REPUBLIC &&
            config.hardlinerPressure >= 90
        ) {
            require(
                _type != ProposalType.SIGN_TREATY,
                "NationDAO: hardliner pressure too high to propose treaties"
            );
        }
    }
}

// Minimal interface for token balance checks
interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

// CitizenToken is an ERC20Votes token — this exposes its checkpointed
// voting power so NationDAO can snapshot weight instead of reading a live,
// freely-transferable balance (which would let the same tokens vote
// multiple times by transferring between addresses between votes).
interface IERC20Votes {
    function getVotes(address account) external view returns (uint256);
    function getPastVotes(address account, uint256 timepoint) external view returns (uint256);
    function getPastTotalSupply(uint256 timepoint) external view returns (uint256);
}
