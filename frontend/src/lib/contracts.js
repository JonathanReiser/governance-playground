import { ethers } from "ethers";
import WorldRegistryABI  from "../abi/WorldRegistry.json";
import MetricsOracleABI  from "../abi/MetricsOracle.json";

export const HARDHAT_CHAIN_ID = 31337;
export const HARDHAT_RPC     = "http://127.0.0.1:8545";

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
  return { provider, signer };
}

export async function connectWallet() {
  if (!window.ethereum) throw new Error("MetaMask not found. Install it to continue.");
  const provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== HARDHAT_CHAIN_ID) {
    throw new Error(
      `Wrong network. Switch MetaMask to Hardhat localhost (chain ID ${HARDHAT_CHAIN_ID}).`
    );
  }
  const signer = await provider.getSigner();
  return { provider, signer };
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
