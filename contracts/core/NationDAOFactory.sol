// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./NationDAO.sol";

/**
 * @title NationDAOFactory
 * @notice Deploys one NationDAO. Split out from WorldRegistry purely for
 *         bytecode size — see WorldRegistry.sol's registerNation() comment.
 */
contract NationDAOFactory {
    function deployDAO(
        NationDAO.NationConfig calldata _config,
        address _citizenToken,
        address _worldRegistry,
        uint256 _initialTreasury,
        uint256 _initialMilitaryPower
    ) external returns (address) {
        NationDAO dao = new NationDAO(
            _config,
            _citizenToken,
            _worldRegistry,
            _initialTreasury,
            _initialMilitaryPower,
            _worldRegistry
        );
        return address(dao);
    }
}
