// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./CitizenToken.sol";

/**
 * @title CitizenTokenFactory
 * @notice Deploys one CitizenToken. Split out from WorldRegistry purely for
 *         bytecode size — see WorldRegistry.sol's registerNation() comment.
 */
contract CitizenTokenFactory {
    function deployToken(
        string calldata _name,
        string calldata _nationId,
        uint256 _tokenSupply,
        address _owner
    ) external returns (address) {
        CitizenToken token = new CitizenToken(_name, _nationId, _tokenSupply, _owner);
        return address(token);
    }
}
