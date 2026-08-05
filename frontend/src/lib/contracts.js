import { ethers } from "ethers";
import WorldRegistryABI       from "../abi/WorldRegistry.json";
import MetricsOracleABI       from "../abi/MetricsOracle.json";
import CitizenTokenFactoryABI from "../abi/CitizenTokenFactory.json";
import NationDAOFactoryABI    from "../abi/NationDAOFactory.json";

export const HARDHAT_CHAIN_ID = 31337;
export const HARDHAT_RPC     = "http://127.0.0.1:8545";
export const SEPOLIA_CHAIN_ID = 11155111;
export const SEPOLIA_RPC      = "https://ethereum-sepolia-rpc.publicnode.com";

// Networks connectWallet() (MetaMask) will accept. Dev Mode (connectDirect,
// below) is intentionally NOT part of this — it signs with a publicly known
// private key and must only ever be able to reach localhost, never a real
// network, which is guaranteed by construction (its RPC URL is hardcoded to
// 127.0.0.1 and never touches window.ethereum's selected network at all).
const SUPPORTED_CHAINS = {
  [HARDHAT_CHAIN_ID]: "Hardhat Local",
  [SEPOLIA_CHAIN_ID]: "Sepolia",
};

const SEPOLIA_ADD_CHAIN_PARAMS = {
  chainId: "0x" + SEPOLIA_CHAIN_ID.toString(16),
  chainName: "Sepolia",
  nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: [SEPOLIA_RPC],
  blockExplorerUrls: ["https://sepolia.etherscan.io"],
};

// First Hardhat default account — pre-funded with 10,000 ETH, no confirmations needed
const HARDHAT_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export async function connectDirect() {
  const provider = new ethers.JsonRpcProvider(HARDHAT_RPC);
  const network  = await provider.getNetwork();
  if (Number(network.chainId) !== HARDHAT_CHAIN_ID) {
    throw new Error(`Hardhat node not found at ${HARDHAT_RPC}. Run: npx hardhat node`);
  }
  const wallet = new ethers.Wallet(HARDHAT_PRIVATE_KEY, provider);
  const signer = new ethers.NonceManager(wallet);
  return { provider, signer, chainId: HARDHAT_CHAIN_ID, networkName: SUPPORTED_CHAINS[HARDHAT_CHAIN_ID] };
}

/**
 * Prompt MetaMask to switch to Sepolia (EIP-3326), adding it first (EIP-3085)
 * if the user has never had it in their wallet before. Only ever called from
 * an explicit user click — never automatically — so the network-switch
 * prompt doesn't appear out of nowhere.
 */
export async function switchToSepolia() {
  if (!window.ethereum) throw new Error("MetaMask not found. Install it to continue.");
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: SEPOLIA_ADD_CHAIN_PARAMS.chainId }],
    });
  } catch (err) {
    if (err.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [SEPOLIA_ADD_CHAIN_PARAMS],
      });
    } else {
      throw err;
    }
  }
}

export async function connectWallet() {
  if (!window.ethereum) throw new Error("MetaMask not found. Install it to continue.");
  const provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  if (!SUPPORTED_CHAINS[chainId]) {
    const err = new Error(
      `Unsupported network. Switch MetaMask to Hardhat localhost (${HARDHAT_CHAIN_ID}) or Sepolia (${SEPOLIA_CHAIN_ID}).`
    );
    err.unsupportedNetwork = true; // lets the UI offer a one-click Sepolia switch
    throw err;
  }
  const signer = await provider.getSigner();
  return { provider, signer, chainId, networkName: SUPPORTED_CHAINS[chainId] };
}

// Enum maps
export const GovernanceType  = { PARLIAMENTARY_DEMOCRACY: 0, THEOCRATIC_REPUBLIC: 1, ABSOLUTE_MONARCHY: 2, FEDERAL_REPUBLIC: 3, MILITARY_JUNTA: 4 };
export const VotingMechanism = { ONE_TOKEN_ONE_VOTE: 0, DUAL_LAYER: 1, COUNCIL_WEIGHTED: 2, QUADRATIC: 3 };
export const RelationshipType = { ALLIED: 0, PARTNER: 1, NEUTRAL: 2, FRAGILE_PEACE: 3, COLD: 4, SANCTIONED: 5, HOSTILE: 6 };
export const EventType        = { PEACE_DEAL: 0, WAR: 1, RESOURCE_EVENT: 2, ECONOMIC_CRISIS: 3, ELECTION: 4, COUP: 5, SANCTIONS: 6 };
export const EventStatus      = { PENDING: 0, ACTIVE: 1, ACTIVE_FRAGILE: 2, RESOLVED: 3, COLLAPSED: 4 };

export async function deployScenario(signer, scenario, onStatus) {
  const deployer = signer;
  const addr     = await deployer.getAddress();
  const signerAddresses = await Promise.all(
    (await signer.provider.listAccounts()).slice(0, 8)
  );

  onStatus("Deploying WorldRegistry…");
  const RegistryFactory = new ethers.ContractFactory(
    WorldRegistryABI.abi, WorldRegistryABI.bytecode, deployer
  );
  const registry = await RegistryFactory.deploy(addr);
  await registry.waitForDeployment();

  onStatus("Deploying MetricsOracle…");
  const OracleFactory = new ethers.ContractFactory(
    MetricsOracleABI.abi, MetricsOracleABI.bytecode, deployer
  );
  const oracle = await OracleFactory.deploy(await registry.getAddress(), addr);
  await oracle.waitForDeployment();

  onStatus("Wiring oracle…");
  await (await registry.setMetricsOracle(await oracle.getAddress())).wait();

  onStatus("Deploying nation factories…");
  const TokenFactoryFactory = new ethers.ContractFactory(
    CitizenTokenFactoryABI.abi, CitizenTokenFactoryABI.bytecode, deployer
  );
  const tokenFactory = await TokenFactoryFactory.deploy();
  await tokenFactory.waitForDeployment();

  const DaoFactoryFactory = new ethers.ContractFactory(
    NationDAOFactoryABI.abi, NationDAOFactoryABI.bytecode, deployer
  );
  const daoFactory = await DaoFactoryFactory.deploy();
  await daoFactory.waitForDeployment();

  await (await registry.setNationFactories(
    await tokenFactory.getAddress(),
    await daoFactory.getAddress()
  )).wait();

  onStatus("Initializing scenario…");
  await (await registry.initializeScenario(
    scenario.meta.name,
    scenario.meta.version,
    BigInt(scenario.simulation.defaultCycles)
  )).wait();

  const getAddr = (i) => signerAddresses[i]?.address ?? signerAddresses[i] ?? addr;

  for (const nation of scenario.nations) {
    onStatus(`Deploying ${nation.name}…`);
    const gov = nation.governance;
    const config = {
      name:               nation.name,
      nationId:           nation.id,
      governanceType:     GovernanceType[gov.type] ?? 0,
      votingMechanism:    VotingMechanism[gov.votingMechanism] ?? 0,
      proposalThreshold:  BigInt(gov.proposalThreshold),
      quorumPercent:      BigInt(gov.quorum),
      votingDelayBlocks:  BigInt(1),
      votingPeriodBlocks: BigInt(5),
      timelockBlocks:     BigInt(2),
      hasGuardianVeto:    gov.guardianVeto || false,
      hasRoyalVeto:       gov.royalVeto    || false,
      guardianCouncil:    gov.guardianVeto ? getAddr(1) : ethers.ZeroAddress,
      royalAuthority:     gov.royalVeto    ? getAddr(2) : ethers.ZeroAddress,
      hardlinerPressure:  BigInt(gov.hardlinerPressure || 0),
      reformPressure:     BigInt(gov.reformPressure    || 0),
    };
    await (await registry.registerNation(
      config,
      BigInt(1_000_000) * BigInt(10 ** 18),
      BigInt(nation.economy.treasury),
      BigInt(nation.military.power)
    )).wait();
  }

  onStatus("Distributing citizenship tokens…");
  const dist = {
    israel:       [[getAddr(0), getAddr(3), getAddr(4), getAddr(5)], [200_000n, 500_000n, 200_000n, 100_000n].map(n => n * BigInt(10**18))],
    iran:         [[getAddr(0), getAddr(3), getAddr(4), getAddr(5)], [100_000n, 300_000n, 500_000n, 100_000n].map(n => n * BigInt(10**18))],
    saudi_arabia: [[getAddr(2), getAddr(3), getAddr(5)],             [800_000n, 150_000n,  50_000n].map(n => n * BigInt(10**18))],
  };
  for (const [id, [addrs, amounts]] of Object.entries(dist)) {
    await (await registry.distributeCitizenship(id, addrs, amounts)).wait();
  }

  onStatus("Setting relationships…");
  for (const rel of scenario.relationships) {
    await (await registry.setRelationship(
      rel.from, rel.to,
      RelationshipType[rel.type] ?? RelationshipType.NEUTRAL,
      BigInt(rel.stabilityScore),
      rel.treatyActive, rel.treatyName || ""
    )).wait();
  }

  onStatus("Registering events…");
  for (const evt of scenario.activeEvents) {
    if (evt.type === "PEACE_DEAL" || evt.type === "RESOURCE_EVENT") {
      await (await registry.createGlobalEvent(
        evt.id, evt.name,
        EventType[evt.type] ?? EventType.PEACE_DEAL,
        evt.parties || [], evt.description
      )).wait();
    }
  }

  onStatus("Setting initial metrics…");
  const m = scenario.simulation.metrics;
  await (await oracle.updateMetrics(
    BigInt(m.find(x => x.id === "stability_index").startingValue),
    BigInt(m.find(x => x.id === "conflict_events").startingValue),
    BigInt(m.find(x => x.id === "trade_volume").startingValue),
    BigInt(m.find(x => x.id === "proxy_activity").startingValue),
    BigInt(m.find(x => x.id === "deal_integrity").startingValue)
  )).wait();

  await (await registry.startSimulation()).wait();
  onStatus("Deployed.");

  return {
    registryAddress: await registry.getAddress(),
    oracleAddress:   await oracle.getAddress(),
    registry,
    oracle,
  };
}
