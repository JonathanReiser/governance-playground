// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title CitizenToken
 * @notice Represents citizenship and voting power within a NationDAO.
 *
 * Each nation deploys its own CitizenToken. Holding tokens gives you
 * a voice in that nation's governance — proportional to your holdings.
 *
 * Key behaviors:
 *  - Tokens must be DELEGATED to count as votes (delegate to yourself
 *    to vote directly, or delegate to someone you trust)
 *  - The WorldRegistry (the simulation controller) can mint tokens
 *    to set up the initial citizen distribution
 *  - Token supply is fixed at deployment — no inflation
 *
 * Real world parallel:
 *  - Token = citizenship / right to vote
 *  - Delegation = proxy voting or representative democracy
 *  - Supply = relative population size of the nation
 */
contract CitizenToken is ERC20Votes, Ownable {

    // ─────────────────────────────────────────
    // STATE
    // ─────────────────────────────────────────

    string public nationName;       // e.g. "Israel", "Iran", "Saudi Arabia"
    string public nationId;         // e.g. "israel", "iran", "saudi_arabia"
    uint256 public maxSupply;       // total tokens ever mintable

    // ─────────────────────────────────────────
    // EVENTS
    // ─────────────────────────────────────────

    event CitizenshipGranted(address indexed citizen, uint256 amount);
    event CitizenshipRevoked(address indexed citizen, uint256 amount);

    // ─────────────────────────────────────────
    // CONSTRUCTOR
    // ─────────────────────────────────────────

    /**
     * @param _nationName   Human-readable nation name ("Israel")
     * @param _nationId     Machine-readable id ("israel")
     * @param _maxSupply    Total token supply for this nation
     * @param _initialOwner Address that controls minting (WorldRegistry)
     */
    constructor(
        string memory _nationName,
        string memory _nationId,
        uint256 _maxSupply,
        address _initialOwner
    )
        ERC20(_nationName, _nationId)
        EIP712(_nationName, "1")
        Ownable(_initialOwner)
    {
        nationName = _nationName;
        nationId   = _nationId;
        maxSupply  = _maxSupply;
    }

    // ─────────────────────────────────────────
    // MINTING
    // Only the owner (WorldRegistry) can mint
    // ─────────────────────────────────────────

    /**
     * @notice Grant citizenship tokens to an address.
     * @dev Called by WorldRegistry during scenario setup.
     *
     * Auto-delegates first-time recipients to themselves so their tokens
     * count as votes immediately (ERC20Votes requires an explicit delegate
     * before a balance counts for getVotes()/getPastVotes() — recipients
     * who receive tokens via this path shouldn't need a separate
     * transaction just to be able to vote at all). This does NOT weaken
     * NationDAO's vote-snapshotting fix: getPastVotes() is evaluated at a
     * fixed historical block, so no delegation or transfer after that
     * block can retroactively change what a voter's power was at that
     * snapshot — auto-delegating here only affects when a citizen's power
     * starts counting going forward, never a past snapshot. A citizen can
     * still re-delegate to someone else at any time via delegate().
     */
    function grantCitizenship(address citizen, uint256 amount)
        external
        onlyOwner
    {
        require(
            totalSupply() + amount <= maxSupply,
            "CitizenToken: exceeds max supply"
        );
        if (delegates(citizen) == address(0)) {
            _delegate(citizen, citizen);
        }
        _mint(citizen, amount);
        emit CitizenshipGranted(citizen, amount);
    }

    /**
     * @notice Revoke citizenship tokens from an address.
     * @dev Used for sanctions or conflict mechanics.
     */
    function revokeCitizenship(address citizen, uint256 amount)
        external
        onlyOwner
    {
        _burn(citizen, amount);
        emit CitizenshipRevoked(citizen, amount);
    }

    // ─────────────────────────────────────────
    // OVERRIDES
    // ─────────────────────────────────────────

    function _update(
        address from,
        address to,
        uint256 amount
    ) internal override(ERC20Votes) {
        super._update(from, to, amount);
    }

}
