require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

// Only the deployer (SEPOLIA_KEY_0) ever signs a transaction — see
// scripts/deploy.js. Keys 1-5 just need to exist as distinct addresses
// for guardian/royal/citizen roles. Missing keys are filtered out so
// `npx hardhat test` etc. still work fine with no .env present at all.
const sepoliaAccounts = [0, 1, 2, 3, 4, 5]
  .map((i) => process.env[`SEPOLIA_KEY_${i}`])
  .filter(Boolean);

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "cancun",
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      allowUnlimitedContractSize: true,
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
      chainId: 11155111,
      accounts: sepoliaAccounts,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};
