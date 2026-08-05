/**
 * GOVERNANCE PLAYGROUND — Test Suite
 *
 * Tests every critical behavior of the four contracts:
 *   CitizenToken   — citizenship, minting, delegation
 *   NationDAO      — proposals, voting, vetoes, lifecycle
 *   WorldRegistry  — nation registration, relationships, events
 *   MetricsOracle  — metrics, baseline, experiment recording
 *
 * Also tests the full integrated scenario:
 *   → Deploy Middle East 2026
 *   → Run a proposal through full lifecycle
 *   → Test Iran's guardian veto
 *   → Test Saudi's royal veto
 *   → Test peace deal collapse cascade
 *   → Verify research findings are recorded on-chain
 */

import { expect } from "chai";
import hre        from "hardhat";
const { ethers }  = hre;

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

// Mine N blocks (simulates time passing for voting periods)
async function mineBlocks(n) {
  for (let i = 0; i < n; i++) {
    await ethers.provider.send("evm_mine", []);
  }
}

// Build a NationConfig struct
function nationConfig(overrides = {}) {
  return {
    name:               overrides.name               ?? "TestNation",
    nationId:           overrides.nationId           ?? "test",
    governanceType:     overrides.governanceType     ?? 0, // PARLIAMENTARY_DEMOCRACY
    votingMechanism:    overrides.votingMechanism    ?? 0, // ONE_TOKEN_ONE_VOTE
    proposalThreshold:  overrides.proposalThreshold  ?? 100n,
    quorumPercent:      overrides.quorumPercent      ?? 40n,
    votingDelayBlocks:  overrides.votingDelayBlocks  ?? 1n,
    votingPeriodBlocks: overrides.votingPeriodBlocks ?? 5n,
    timelockBlocks:     overrides.timelockBlocks     ?? 2n,
    hasGuardianVeto:    overrides.hasGuardianVeto    ?? false,
    hasRoyalVeto:       overrides.hasRoyalVeto       ?? false,
    guardianCouncil:    overrides.guardianCouncil    ?? ethers.ZeroAddress,
    royalAuthority:     overrides.royalAuthority     ?? ethers.ZeroAddress,
    hardlinerPressure:  overrides.hardlinerPressure  ?? 0n,
    reformPressure:     overrides.reformPressure     ?? 0n,
  };
}

const TOKEN_SUPPLY = 1_000_000n * 10n**18n;
const PROPOSAL_TYPE = {
  DOMESTIC_POLICY:  0,
  DECLARE_ALLIANCE: 1,
  BREAK_ALLIANCE:   2,
  IMPOSE_SANCTIONS: 3,
  FUND_PROXY:       4,
  CLOSE_RESOURCE:   5,
  OPEN_RESOURCE:    6,
  DECLARE_CEASEFIRE:7,
  SIGN_TREATY:      8,
};

// ─────────────────────────────────────────────────────────────
// CITIZEN TOKEN TESTS
// ─────────────────────────────────────────────────────────────

describe("CitizenToken", function () {
  let token, owner, alice, bob;

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();
    const CitizenToken = await ethers.getContractFactory("CitizenToken");
    token = await CitizenToken.deploy(
      "Israel", "israel", TOKEN_SUPPLY, owner.address
    );
  });

  describe("Deployment", function () {
    it("sets the correct name and symbol", async function () {
      expect(await token.name()).to.equal("Israel");
      expect(await token.symbol()).to.equal("israel");
    });

    it("sets the correct max supply", async function () {
      expect(await token.maxSupply()).to.equal(TOKEN_SUPPLY);
    });

    it("starts with zero total supply", async function () {
      expect(await token.totalSupply()).to.equal(0n);
    });
  });

  describe("Citizenship Granting", function () {
    it("owner can grant citizenship", async function () {
      await token.grantCitizenship(alice.address, 500n * 10n**18n);
      expect(await token.balanceOf(alice.address)).to.equal(500n * 10n**18n);
    });

    it("emits CitizenshipGranted event", async function () {
      await expect(
        token.grantCitizenship(alice.address, 500n * 10n**18n)
      ).to.emit(token, "CitizenshipGranted")
        .withArgs(alice.address, 500n * 10n**18n);
    });

    it("non-owner cannot grant citizenship", async function () {
      await expect(
        token.connect(alice).grantCitizenship(bob.address, 100n * 10n**18n)
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });

    it("cannot exceed max supply", async function () {
      await token.grantCitizenship(alice.address, TOKEN_SUPPLY);
      await expect(
        token.grantCitizenship(bob.address, 1n)
      ).to.be.revertedWith("CitizenToken: exceeds max supply");
    });
  });

  describe("Citizenship Revocation", function () {
    beforeEach(async function () {
      await token.grantCitizenship(alice.address, 500n * 10n**18n);
    });

    it("owner can revoke citizenship", async function () {
      await token.revokeCitizenship(alice.address, 200n * 10n**18n);
      expect(await token.balanceOf(alice.address)).to.equal(300n * 10n**18n);
    });

    it("emits CitizenshipRevoked event", async function () {
      await expect(
        token.revokeCitizenship(alice.address, 200n * 10n**18n)
      ).to.emit(token, "CitizenshipRevoked");
    });
  });
});

// ─────────────────────────────────────────────────────────────
// NATION DAO TESTS
// ─────────────────────────────────────────────────────────────

describe("NationDAO", function () {
  let dao, token, owner, alice, bob, carol, guardian, royal;

  beforeEach(async function () {
    [owner, alice, bob, carol, guardian, royal] = await ethers.getSigners();

    // Deploy token
    const CitizenToken = await ethers.getContractFactory("CitizenToken");
    token = await CitizenToken.deploy(
      "TestNation", "test", TOKEN_SUPPLY, owner.address
    );

    // Distribute tokens
    await token.grantCitizenship(alice.address, 400_000n * 10n**18n);
    await token.grantCitizenship(bob.address,   400_000n * 10n**18n);
    await token.grantCitizenship(carol.address, 100_000n * 10n**18n);
    // owner keeps remainder

    // Deploy DAO
    const NationDAO = await ethers.getContractFactory("NationDAO");
    dao = await NationDAO.deploy(
      nationConfig({ guardianCouncil: guardian.address }),
      await token.getAddress(),
      owner.address,   // worldRegistry = owner for testing
      5000n,           // treasury
      500n,            // military
      owner.address
    );
  });

  // ── Proposals ─────────────────────────────────────────────

  describe("Proposals", function () {
    it("citizen with enough tokens can propose", async function () {
      await expect(
        dao.connect(alice).propose(
          PROPOSAL_TYPE.DOMESTIC_POLICY,
          "Increase education budget",
          ethers.ZeroAddress,
          "0x"
        )
      ).to.emit(dao, "ProposalCreated");
    });

    it("citizen without enough tokens cannot propose", async function () {
      const [, , , , , , poorCitizen] = await ethers.getSigners();
      // poorCitizen has 0 tokens
      await expect(
        dao.connect(poorCitizen).propose(
          PROPOSAL_TYPE.DOMESTIC_POLICY,
          "Increase budget",
          ethers.ZeroAddress,
          "0x"
        )
      ).to.be.revertedWith("NationDAO: insufficient tokens to propose");
    });

    it("increments proposal count", async function () {
      await dao.connect(alice).propose(
        PROPOSAL_TYPE.DOMESTIC_POLICY, "Test", ethers.ZeroAddress, "0x"
      );
      expect(await dao.proposalCount()).to.equal(1n);
    });

    it("proposal starts in PENDING state", async function () {
      await dao.connect(alice).propose(
        PROPOSAL_TYPE.DOMESTIC_POLICY, "Test", ethers.ZeroAddress, "0x"
      );
      const proposal = await dao.getProposal(1n);
      expect(proposal.state).to.equal(0); // PENDING
    });
  });

  // ── Voting ─────────────────────────────────────────────────

  describe("Voting", function () {
    let proposalId;

    beforeEach(async function () {
      await dao.connect(alice).propose(
        PROPOSAL_TYPE.DOMESTIC_POLICY, "Test proposal",
        ethers.ZeroAddress, "0x"
      );
      proposalId = 1n;
      // Mine past the voting delay
      await mineBlocks(2);
    });

    it("token holder can vote FOR", async function () {
      await expect(
        dao.connect(alice).castVote(proposalId, 1)
      ).to.emit(dao, "VoteCast");
    });

    it("token holder can vote AGAINST", async function () {
      await expect(
        dao.connect(bob).castVote(proposalId, 0)
      ).to.emit(dao, "VoteCast");
    });

    it("token holder can ABSTAIN", async function () {
      await expect(
        dao.connect(carol).castVote(proposalId, 2)
      ).to.emit(dao, "VoteCast");
    });

    it("cannot vote twice", async function () {
      await dao.connect(alice).castVote(proposalId, 1);
      await expect(
        dao.connect(alice).castVote(proposalId, 1)
      ).to.be.revertedWith("NationDAO: already voted");
    });

    it("cannot vote before voting period starts", async function () {
      // Deploy fresh with longer delay
      const CitizenToken = await ethers.getContractFactory("CitizenToken");
      const t2 = await CitizenToken.deploy(
        "T", "t", TOKEN_SUPPLY, owner.address
      );
      await t2.grantCitizenship(alice.address, 500_000n * 10n**18n);

      const NationDAO = await ethers.getContractFactory("NationDAO");
      const dao2 = await NationDAO.deploy(
        nationConfig({ votingDelayBlocks: 100n }),
        await t2.getAddress(),
        owner.address, 0n, 0n, owner.address
      );
      await dao2.connect(alice).propose(
        PROPOSAL_TYPE.DOMESTIC_POLICY, "Test", ethers.ZeroAddress, "0x"
      );
      await expect(
        dao2.connect(alice).castVote(1n, 1)
      ).to.be.revertedWith("NationDAO: voting not started");
    });

    it("records correct vote weights", async function () {
      await dao.connect(alice).castVote(proposalId, 1); // FOR: 400k tokens
      await dao.connect(bob).castVote(proposalId, 0);   // AGAINST: 400k tokens

      const proposal = await dao.getProposal(proposalId);
      expect(proposal.votesFor).to.equal(400_000n * 10n**18n);
      expect(proposal.votesAgainst).to.equal(400_000n * 10n**18n);
    });
  });

  // ── Finalization & Execution ───────────────────────────────

  describe("Proposal Finalization", function () {
    let proposalId;

    beforeEach(async function () {
      await dao.connect(alice).propose(
        PROPOSAL_TYPE.DOMESTIC_POLICY, "Pass me",
        ethers.ZeroAddress, "0x"
      );
      proposalId = 1n;
      await mineBlocks(2); // past voting delay
    });

    it("succeeds when quorum met and majority FOR", async function () {
      // alice (400k) + bob (400k) = 800k / 900k total = 88% quorum
      await dao.connect(alice).castVote(proposalId, 1); // FOR
      await dao.connect(bob).castVote(proposalId, 1);   // FOR
      await mineBlocks(6); // past voting period

      await dao.finalizeProposal(proposalId);
      expect(await dao.getProposalState(proposalId)).to.equal(2); // SUCCEEDED
    });

    it("is defeated when quorum not met", async function () {
      // carol only has 100k / 900k = 11% — below 40% quorum
      await dao.connect(carol).castVote(proposalId, 1);
      await mineBlocks(6);

      await dao.finalizeProposal(proposalId);
      expect(await dao.getProposalState(proposalId)).to.equal(3); // DEFEATED
    });

    it("is defeated when majority votes AGAINST", async function () {
      await dao.connect(alice).castVote(proposalId, 1); // FOR: 400k
      await dao.connect(bob).castVote(proposalId, 0);   // AGAINST: 400k
      await dao.connect(carol).castVote(proposalId, 0); // AGAINST: 100k
      await mineBlocks(6);

      await dao.finalizeProposal(proposalId);
      expect(await dao.getProposalState(proposalId)).to.equal(3); // DEFEATED
    });

    it("emits ProposalDefeated when defeated", async function () {
      await dao.connect(carol).castVote(proposalId, 1); // too few tokens
      await mineBlocks(6);

      await expect(
        dao.finalizeProposal(proposalId)
      ).to.emit(dao, "ProposalDefeated").withArgs(proposalId);
    });

    it("can execute after timelock passes", async function () {
      await dao.connect(alice).castVote(proposalId, 1);
      await dao.connect(bob).castVote(proposalId, 1);
      await mineBlocks(6);
      await dao.finalizeProposal(proposalId);
      await mineBlocks(3); // past timelock

      await expect(
        dao.executeProposal(proposalId)
      ).to.emit(dao, "ProposalExecuted").withArgs(proposalId);
    });

    it("cannot execute before timelock passes", async function () {
      // Deploy a fresh DAO with a long timelock so we can test it
      const CitizenToken = await ethers.getContractFactory("CitizenToken");
      const t3 = await CitizenToken.deploy("T3", "t3", TOKEN_SUPPLY, owner.address);
      await t3.grantCitizenship(alice.address, 400_000n * 10n**18n);
      await t3.grantCitizenship(bob.address,   400_000n * 10n**18n);

      const NationDAO = await ethers.getContractFactory("NationDAO");
      const dao3 = await NationDAO.deploy(
        nationConfig({ votingDelayBlocks: 1n, votingPeriodBlocks: 5n, timelockBlocks: 100n }),
        await t3.getAddress(),
        owner.address, 0n, 0n, owner.address
      );

      await dao3.connect(alice).propose(
        PROPOSAL_TYPE.DOMESTIC_POLICY, "Test", ethers.ZeroAddress, "0x"
      );
      await mineBlocks(2);
      await dao3.connect(alice).castVote(1n, 1);
      await dao3.connect(bob).castVote(1n, 1);
      await mineBlocks(6);
      await dao3.finalizeProposal(1n);
      // Only 1 block mined after finalize — well short of 100 block timelock

      await expect(
        dao3.executeProposal(1n)
      ).to.be.revertedWith("NationDAO: timelock not passed");
    });
  });

  // ── Iran: Guardian Veto ────────────────────────────────────

  describe("Iran — Guardian Council Veto", function () {
    let iranDao;

    beforeEach(async function () {
      const CitizenToken = await ethers.getContractFactory("CitizenToken");
      const iranToken = await CitizenToken.deploy(
        "Iran", "iran", TOKEN_SUPPLY, owner.address
      );
      await iranToken.grantCitizenship(alice.address, 400_000n * 10n**18n);
      await iranToken.grantCitizenship(bob.address,   400_000n * 10n**18n);

      const NationDAO = await ethers.getContractFactory("NationDAO");
      iranDao = await NationDAO.deploy(
        nationConfig({
          name:            "Iran",
          nationId:        "iran",
          governanceType:  1,   // THEOCRATIC_REPUBLIC
          votingMechanism: 1,   // DUAL_LAYER
          hasGuardianVeto: true,
          guardianCouncil: guardian.address,
        }),
        await iranToken.getAddress(),
        owner.address,
        4200n, 620n, owner.address
      );
    });

    it("Guardian Council can veto a succeeded proposal", async function () {
      // Submit and pass a proposal
      await iranDao.connect(alice).propose(
        PROPOSAL_TYPE.SIGN_TREATY,
        "Sign normalization treaty with Israel",
        ethers.ZeroAddress, "0x"
      );
      await mineBlocks(2);
      await iranDao.connect(alice).castVote(1n, 1);
      await iranDao.connect(bob).castVote(1n, 1);
      await mineBlocks(6);
      await iranDao.finalizeProposal(1n);

      // Proposal succeeded — guardian now vetoes it
      await expect(
        iranDao.connect(guardian).guardianVeto(
          1n, "Contradicts Islamic Republic principles"
        )
      ).to.emit(iranDao, "ProposalVetoed")
        .withArgs(1n, "Contradicts Islamic Republic principles");

      expect(await iranDao.getProposalState(1n)).to.equal(6); // VETOED
    });

    it("non-guardian cannot use guardian veto", async function () {
      await iranDao.connect(alice).propose(
        PROPOSAL_TYPE.DOMESTIC_POLICY, "Test",
        ethers.ZeroAddress, "0x"
      );
      await mineBlocks(2);
      await iranDao.connect(alice).castVote(1n, 1);
      await iranDao.connect(bob).castVote(1n, 1);
      await mineBlocks(6);
      await iranDao.finalizeProposal(1n);

      await expect(
        iranDao.connect(alice).guardianVeto(1n, "Fake veto")
      ).to.be.revertedWith("NationDAO: only guardian council");
    });

    it("cannot use guardian veto on non-succeeded proposals", async function () {
      await iranDao.connect(alice).propose(
        PROPOSAL_TYPE.DOMESTIC_POLICY, "Still pending",
        ethers.ZeroAddress, "0x"
      );
      // Still in PENDING state
      await expect(
        iranDao.connect(guardian).guardianVeto(1n, "Too early")
      ).to.be.revertedWith("NationDAO: can only veto succeeded proposals");
    });

    it("DAO without guardian veto cannot use it", async function () {
      // Regular DAO (no guardian veto)
      await dao.connect(alice).propose(
        PROPOSAL_TYPE.DOMESTIC_POLICY, "Test",
        ethers.ZeroAddress, "0x"
      );
      await mineBlocks(2);
      await dao.connect(alice).castVote(1n, 1);
      await dao.connect(bob).castVote(1n, 1);
      await mineBlocks(6);
      await dao.finalizeProposal(1n);

      await expect(
        dao.connect(guardian).guardianVeto(1n, "No veto here")
      ).to.be.revertedWith("NationDAO: no guardian veto in this governance type");
    });
  });

  // ── Saudi Arabia: Royal Veto ───────────────────────────────

  describe("Saudi Arabia — Royal Veto", function () {
    let saudiDao, saudiToken;

    beforeEach(async function () {
      const CitizenToken = await ethers.getContractFactory("CitizenToken");
      saudiToken = await CitizenToken.deploy(
        "Saudi Arabia", "saudi_arabia", TOKEN_SUPPLY, owner.address
      );
      await saudiToken.grantCitizenship(royal.address, 800_000n * 10n**18n);

      const NationDAO = await ethers.getContractFactory("NationDAO");
      saudiDao = await NationDAO.deploy(
        nationConfig({
          name:             "Saudi Arabia",
          nationId:         "saudi_arabia",
          governanceType:   2,   // ABSOLUTE_MONARCHY
          votingMechanism:  2,   // COUNCIL_WEIGHTED
          proposalThreshold: 50_000n * 10n**18n,
          hasRoyalVeto:     true,
          royalAuthority:   royal.address,
        }),
        await saudiToken.getAddress(),
        owner.address,
        18000n, 720n, owner.address
      );
    });

    it("Royal authority can veto any proposal at any stage", async function () {
      await saudiDao.connect(royal).propose(
        PROPOSAL_TYPE.DOMESTIC_POLICY,
        "Reduce oil production",
        ethers.ZeroAddress, "0x"
      );

      // Veto immediately — even before voting starts
      await expect(
        saudiDao.connect(royal).royalVeto(
          1n, "The King has decided otherwise"
        )
      ).to.emit(saudiDao, "ProposalVetoed")
        .withArgs(1n, "The King has decided otherwise");

      expect(await saudiDao.getProposalState(1n)).to.equal(6); // VETOED
    });

    it("non-royal cannot use royal veto", async function () {
      await saudiDao.connect(royal).propose(
        PROPOSAL_TYPE.DOMESTIC_POLICY, "Test",
        ethers.ZeroAddress, "0x"
      );
      await expect(
        saudiDao.connect(alice).royalVeto(1n, "Fake royal veto")
      ).to.be.revertedWith("NationDAO: only royal authority");
    });

    it("cannot royal veto an already executed proposal", async function () {
      await saudiDao.connect(royal).propose(
        PROPOSAL_TYPE.DOMESTIC_POLICY, "Test",
        ethers.ZeroAddress, "0x"
      );
      await mineBlocks(2);
      await saudiDao.connect(royal).castVote(1n, 1);
      await mineBlocks(6);
      await saudiDao.finalizeProposal(1n);
      await mineBlocks(3);
      await saudiDao.executeProposal(1n);

      await expect(
        saudiDao.connect(royal).royalVeto(1n, "Too late")
      ).to.be.revertedWith("NationDAO: already executed");
    });
  });

  // ── World Registry Controls ────────────────────────────────

  describe("World Registry Controls", function () {
    it("WorldRegistry can update treasury", async function () {
      await dao.connect(owner).setTreasury(9999n);
      expect(await dao.treasury()).to.equal(9999n);
    });

    it("WorldRegistry can update military power", async function () {
      await dao.connect(owner).setMilitaryPower(999n);
      expect(await dao.militaryPower()).to.equal(999n);
    });

    it("WorldRegistry can update stability score", async function () {
      await dao.connect(owner).setStabilityScore(75n);
      expect(await dao.stabilityScore()).to.equal(75n);
    });

    it("stability score cannot exceed 100", async function () {
      await expect(
        dao.connect(owner).setStabilityScore(101n)
      ).to.be.revertedWith("NationDAO: score must be 0-100");
    });

    it("WorldRegistry can set relationships", async function () {
      await dao.connect(owner).setRelationship("iran", "FRAGILE_PEACE");
      expect(await dao.relationships("iran")).to.equal("FRAGILE_PEACE");
    });

    it("non-WorldRegistry cannot update state", async function () {
      await expect(
        dao.connect(alice).setTreasury(0n)
      ).to.be.revertedWith("NationDAO: only WorldRegistry");
    });
  });
});

// ─────────────────────────────────────────────────────────────
// WORLD REGISTRY TESTS
// ─────────────────────────────────────────────────────────────

describe("WorldRegistry", function () {
  let registry, oracle, owner, alice;

  beforeEach(async function () {
    [owner, alice] = await ethers.getSigners();

    const WorldRegistry = await ethers.getContractFactory("WorldRegistry");
    registry = await WorldRegistry.deploy(owner.address);

    const MetricsOracle = await ethers.getContractFactory("MetricsOracle");
    oracle = await MetricsOracle.deploy(
      await registry.getAddress(), owner.address
    );

    await registry.setMetricsOracle(await oracle.getAddress());
  });

  describe("Scenario Initialization", function () {
    it("can initialize a scenario", async function () {
      await expect(
        registry.initializeScenario("Middle East 2026", "1.0.0", 20n)
      ).to.emit(registry, "ScenarioLoaded")
        .withArgs("Middle East 2026", "1.0.0");
    });

    it("stores scenario metadata", async function () {
      await registry.initializeScenario("Test", "1.0", 10n);
      expect(await registry.scenarioName()).to.equal("Test");
      expect(await registry.totalCycles()).to.equal(10n);
    });
  });

  describe("Nation Registration", function () {
    beforeEach(async function () {
      await registry.initializeScenario("Test", "1.0", 10n);
    });

    it("can register a nation", async function () {
      await expect(
        registry.registerNation(
          nationConfig({ name: "Israel", nationId: "israel" }),
          TOKEN_SUPPLY, 8500n, 850n
        )
      ).to.emit(registry, "NationRegistered");
    });

    it("deployed nation has correct treasury", async function () {
      await registry.registerNation(
        nationConfig({ name: "Israel", nationId: "israel" }),
        TOKEN_SUPPLY, 8500n, 850n
      );
      const nation = await registry.getNation("israel");
      const NationDAO = await ethers.getContractFactory("NationDAO");
      const dao = NationDAO.attach(nation.daoAddress);
      expect(await dao.treasury()).to.equal(8500n);
    });

    it("deployed nation has correct military power", async function () {
      await registry.registerNation(
        nationConfig({ name: "Israel", nationId: "israel" }),
        TOKEN_SUPPLY, 8500n, 850n
      );
      const nation = await registry.getNation("israel");
      const NationDAO = await ethers.getContractFactory("NationDAO");
      const dao = NationDAO.attach(nation.daoAddress);
      expect(await dao.militaryPower()).to.equal(850n);
    });

    it("tracks nation count", async function () {
      await registry.registerNation(
        nationConfig({ name: "Israel", nationId: "israel" }),
        TOKEN_SUPPLY, 0n, 0n
      );
      await registry.registerNation(
        nationConfig({ name: "Iran", nationId: "iran" }),
        TOKEN_SUPPLY, 0n, 0n
      );
      expect(await registry.getNationCount()).to.equal(2n);
    });
  });

  describe("Relationships", function () {
    beforeEach(async function () {
      await registry.initializeScenario("Test", "1.0", 10n);
      await registry.registerNation(
        nationConfig({ name: "Israel", nationId: "israel" }),
        TOKEN_SUPPLY, 0n, 0n
      );
      await registry.registerNation(
        nationConfig({ name: "Iran", nationId: "iran" }),
        TOKEN_SUPPLY, 0n, 0n
      );
    });

    it("can set relationship between nations", async function () {
      await expect(
        registry.setRelationship(
          "israel", "iran",
          6,      // HOSTILE
          28n,    // stability score
          false,  // no treaty
          ""
        )
      ).to.emit(registry, "RelationshipSet")
        .withArgs("israel", "iran", 6);
    });

    it("relationship is mirrored — A→B equals B→A", async function () {
      await registry.setRelationship(
        "israel", "iran", 3, 28n, true, "Test Treaty"
      );
      const rel1 = await registry.getRelationship("israel", "iran");
      const rel2 = await registry.getRelationship("iran", "israel");
      expect(rel1.relType).to.equal(rel2.relType);
      expect(rel1.stabilityScore).to.equal(rel2.stabilityScore);
    });

    it("stores treaty information", async function () {
      await registry.setRelationship(
        "israel", "iran", 3, 28n, true, "Hormuz Agreement"
      );
      const rel = await registry.getRelationship("israel", "iran");
      expect(rel.treatyActive).to.equal(true);
      expect(rel.treatyName).to.equal("Hormuz Agreement");
    });
  });

  describe("Global Events", function () {
    beforeEach(async function () {
      await registry.initializeScenario("Test", "1.0", 10n);
    });

    it("can create a global event", async function () {
      await expect(
        registry.createGlobalEvent(
          "peace_deal_1",
          "US-Israel-Iran Peace Deal",
          0, // PEACE_DEAL
          ["israel", "iran"],
          "Post-war agreement"
        )
      ).to.emit(registry, "GlobalEventCreated");
    });

    it("can update event status", async function () {
      await registry.createGlobalEvent(
        "deal1", "Test Deal", 0, [], "Test"
      );
      await expect(
        registry.updateEventStatus("deal1", 4) // COLLAPSED
      ).to.emit(registry, "GlobalEventUpdated")
        .withArgs("deal1", 4);
    });
  });

  describe("Simulation Control", function () {
    beforeEach(async function () {
      await registry.initializeScenario("Test", "1.0", 3n);
    });

    it("can start simulation", async function () {
      await expect(
        registry.startSimulation()
      ).to.emit(registry, "SimulationStarted").withArgs(3n);
      expect(await registry.simulationActive()).to.equal(true);
    });

    it("can advance cycles", async function () {
      await registry.startSimulation();
      await expect(
        registry.advanceCycle()
      ).to.emit(registry, "CycleAdvanced").withArgs(1n);
      expect(await registry.currentCycle()).to.equal(1n);
    });

    it("ends simulation at total cycles", async function () {
      await registry.startSimulation();
      await registry.advanceCycle();
      await registry.advanceCycle();
      await expect(
        registry.advanceCycle()
      ).to.emit(registry, "SimulationEnded");
      expect(await registry.simulationActive()).to.equal(false);
    });

    it("cannot advance past total cycles", async function () {
      await registry.startSimulation();
      await registry.advanceCycle();
      await registry.advanceCycle();
      await registry.advanceCycle();
      // Simulation is now ended (simulationActive = false)
      // so it correctly reverts with "not active" rather than "complete"
      await expect(
        registry.advanceCycle()
      ).to.be.revertedWith("WorldRegistry: simulation not active");
    });
  });
});

// ─────────────────────────────────────────────────────────────
// METRICS ORACLE TESTS
// ─────────────────────────────────────────────────────────────

describe("MetricsOracle", function () {
  let oracle, registry, owner, alice;

  beforeEach(async function () {
    [owner, alice] = await ethers.getSigners();

    const WorldRegistry = await ethers.getContractFactory("WorldRegistry");
    registry = await WorldRegistry.deploy(owner.address);

    const MetricsOracle = await ethers.getContractFactory("MetricsOracle");
    oracle = await MetricsOracle.deploy(
      await registry.getAddress(), owner.address
    );

    await registry.setMetricsOracle(await oracle.getAddress());
    await registry.initializeScenario("Test", "1.0", 10n);
    await registry.startSimulation();
  });

  describe("Metric Updates", function () {
    it("can update metrics", async function () {
      await oracle.updateMetrics(65n, 2n, 150n, 30n, 70n);
      expect(await oracle.regionalStabilityIndex()).to.equal(65n);
      expect(await oracle.totalConflictEvents()).to.equal(2n);
      expect(await oracle.totalTradeVolume()).to.equal(150n);
    });

    it("stability index cannot exceed 100", async function () {
      await expect(
        oracle.updateMetrics(101n, 0n, 0n, 0n, 0n)
      ).to.be.revertedWith("MetricsOracle: stability 0-100");
    });

    it("deal integrity cannot exceed 100", async function () {
      await expect(
        oracle.updateMetrics(50n, 0n, 0n, 0n, 101n)
      ).to.be.revertedWith("MetricsOracle: integrity 0-100");
    });

    it("non-authorized address cannot update metrics", async function () {
      await expect(
        oracle.connect(alice).updateMetrics(50n, 0n, 0n, 0n, 50n)
      ).to.be.revertedWith("MetricsOracle: not authorized");
    });
  });

  describe("Cycle Snapshots", function () {
    it("records snapshot on cycle advance", async function () {
      await oracle.updateMetrics(45n, 3n, 120n, 40n, 55n);
      await registry.advanceCycle();

      const snap = await oracle.getCycleSnapshot(1n);
      expect(snap.regionalStabilityIndex).to.equal(45n);
      expect(snap.totalConflictEvents).to.equal(3n);
    });

    it("emits CycleMetricsCalculated event", async function () {
      await oracle.updateMetrics(45n, 3n, 120n, 40n, 55n);
      await expect(
        registry.advanceCycle()
      ).to.emit(oracle, "CycleMetricsCalculated");
    });

    it("detects sharp stability drops as anomalies", async function () {
      // Cycle 1 — stable
      await oracle.updateMetrics(60n, 0n, 200n, 20n, 80n);
      await registry.advanceCycle();

      // Cycle 2 — sudden drop of 22 points (above 15 threshold)
      await oracle.updateMetrics(38n, 8n, 80n, 65n, 30n);
      await expect(
        registry.advanceCycle()
      ).to.emit(oracle, "AnomalyDetected");
    });
  });

  describe("Baseline & Comparison", function () {
    it("can set baseline after first cycle", async function () {
      await oracle.updateMetrics(38n, 3n, 120n, 45n, 52n);
      await registry.advanceCycle();

      await expect(
        oracle.setBaseline(1n)
      ).to.emit(oracle, "BaselineSet").withArgs(1n);
    });

    it("cannot set baseline twice", async function () {
      await oracle.updateMetrics(38n, 3n, 120n, 45n, 52n);
      await registry.advanceCycle();
      await oracle.setBaseline(1n);

      await expect(
        oracle.setBaseline(1n)
      ).to.be.revertedWith("MetricsOracle: baseline already set");
    });

    it("compareToBaseline returns correct deltas", async function () {
      // Set baseline at cycle 1
      await oracle.updateMetrics(50n, 2n, 150n, 30n, 70n);
      await registry.advanceCycle();
      await oracle.setBaseline(1n);

      // Run another cycle with worse metrics
      await oracle.updateMetrics(30n, 8n, 80n, 70n, 20n);
      await registry.advanceCycle();

      const [stabDelta, confDelta, tradeDelta, proxyDelta, dealDelta] =
        await oracle.compareToBaseline();

      expect(stabDelta).to.equal(-20n);
      expect(confDelta).to.equal(6n);
      expect(tradeDelta).to.equal(-70n);
      expect(proxyDelta).to.equal(40n);
      expect(dealDelta).to.equal(-50n);
    });

    it("cannot compare without baseline", async function () {
      await expect(
        oracle.compareToBaseline()
      ).to.be.revertedWith("MetricsOracle: no baseline set");
    });
  });

  describe("Experiment Recording", function () {
    it("records experiment changes", async function () {
      await expect(
        oracle.recordExperiment(
          "exp_deal_collapse",
          "iran",
          "activeEvents.hormuz_nuclear_deal.status",
          4n, 0n
        )
      ).to.emit(oracle, "ExperimentRecorded");
    });

    it("experiment history is retrievable", async function () {
      await oracle.recordExperiment(
        "exp_1", "iran", "hardlinerPressure", 95n, 0n
      );
      await oracle.recordExperiment(
        "exp_2", "saudi", "treasury", 5000n, 0n
      );
      const history = await oracle.getExperimentHistory();
      expect(history.length).to.equal(2);
      expect(history[0].experimentId).to.equal("exp_1");
      expect(history[1].nationId).to.equal("saudi");
    });
  });

  describe("Conflict Logging", function () {
    it("can log a conflict event", async function () {
      await expect(
        oracle.logConflict(1n, "iran", "israel", "PROXY_ATTACK", 70n)
      ).to.emit(oracle, "ConflictLogged")
        .withArgs(1n, "iran", "israel", "PROXY_ATTACK", 70n);
    });

    it("conflict log is retrievable", async function () {
      await oracle.logConflict(1n, "iran", "israel", "PROXY", 50n);
      await oracle.logConflict(2n, "saudi", "iran",  "SANCTION", 30n);
      const log = await oracle.getConflictLog();
      expect(log.length).to.equal(2);
      expect(log[0].fromNationId).to.equal("iran");
      expect(log[1].eventType).to.equal("SANCTION");
    });
  });
});

// ─────────────────────────────────────────────────────────────
// INTEGRATION TEST — FULL MIDDLE EAST SCENARIO
// ─────────────────────────────────────────────────────────────

describe("Integration — Middle East Scenario", function () {
  let registry, oracle, owner, signers;
  let israelDao, iranDao, saudiDao;

  before(async function () {
    signers = await ethers.getSigners();
    owner   = signers[0];

    // Deploy core
    const WorldRegistry = await ethers.getContractFactory("WorldRegistry");
    registry = await WorldRegistry.deploy(owner.address);

    const MetricsOracle = await ethers.getContractFactory("MetricsOracle");
    oracle = await MetricsOracle.deploy(
      await registry.getAddress(), owner.address
    );
    await registry.setMetricsOracle(await oracle.getAddress());
    await registry.initializeScenario("Middle East 2026", "1.0.0", 20n);

    // Deploy Israel
    await registry.registerNation(
      nationConfig({
        name: "Israel", nationId: "israel",
        governanceType: 0, votingMechanism: 0,
        proposalThreshold: 100n, quorumPercent: 40n,
      }),
      TOKEN_SUPPLY, 8500n, 850n
    );

    // Deploy Iran (with guardian veto)
    await registry.registerNation(
      nationConfig({
        name: "Iran", nationId: "iran",
        governanceType: 1, votingMechanism: 1,
        proposalThreshold: 5000n, quorumPercent: 20n,
        hasGuardianVeto: true,
        guardianCouncil: signers[1].address,
      }),
      TOKEN_SUPPLY, 4200n, 620n
    );

    // Deploy Saudi (with royal veto)
    await registry.registerNation(
      nationConfig({
        name: "Saudi Arabia", nationId: "saudi_arabia",
        governanceType: 2, votingMechanism: 2,
        proposalThreshold: 50_000n * 10n**18n,
        quorumPercent: 10n,
        hasRoyalVeto: true,
        royalAuthority: signers[2].address,
      }),
      TOKEN_SUPPLY, 18000n, 720n
    );

    // Get DAO references
    const NationDAO = await ethers.getContractFactory("NationDAO");
    israelDao = NationDAO.attach((await registry.getNation("israel")).daoAddress);
    iranDao   = NationDAO.attach((await registry.getNation("iran")).daoAddress);
    saudiDao  = NationDAO.attach((await registry.getNation("saudi_arabia")).daoAddress);

    // Distribute tokens
    const CitizenToken = await ethers.getContractFactory("CitizenToken");
    const israelToken  = CitizenToken.attach((await registry.getNation("israel")).tokenAddress);
    const iranToken    = CitizenToken.attach((await registry.getNation("iran")).tokenAddress);
    const saudiToken   = CitizenToken.attach((await registry.getNation("saudi_arabia")).tokenAddress);

    await registry.distributeCitizenship("israel",
      [signers[3].address, signers[4].address],
      [400_000n * 10n**18n, 400_000n * 10n**18n]
    );
    await registry.distributeCitizenship("iran",
      [signers[3].address, signers[4].address],
      [400_000n * 10n**18n, 400_000n * 10n**18n]
    );
    await registry.distributeCitizenship("saudi_arabia",
      [signers[2].address],
      [800_000n * 10n**18n]
    );

    // Set relationships
    await registry.setRelationship(
      "israel", "iran", 3, 28n, true, "Hormuz Agreement 2026"
    );
    await registry.setRelationship(
      "iran", "saudi_arabia", 3, 42n, true, "Beijing Agreement 2023"
    );
    await registry.setRelationship(
      "israel", "saudi_arabia", 4, 55n, false, ""
    );

    // Register peace deal event
    await registry.createGlobalEvent(
      "hormuz_deal", "US-Israel-Iran Peace Deal",
      0, ["israel", "iran"], "2026 agreement"
    );

    await registry.startSimulation();
  });

  it("all three nations are registered", async function () {
    expect(await registry.getNationCount()).to.equal(3n);
  });

  it("Israel is a parliamentary democracy", async function () {
    const config = await israelDao.getConfig();
    expect(config.governanceType).to.equal(0); // PARLIAMENTARY_DEMOCRACY
  });

  it("Iran has a theocratic republic structure", async function () {
    const config = await iranDao.getConfig();
    expect(config.governanceType).to.equal(1); // THEOCRATIC_REPUBLIC
    expect(config.hasGuardianVeto).to.equal(true);
  });

  it("Saudi Arabia is an absolute monarchy", async function () {
    const config = await saudiDao.getConfig();
    expect(config.governanceType).to.equal(2); // ABSOLUTE_MONARCHY
    expect(config.hasRoyalVeto).to.equal(true);
  });

  it("Israel-Iran relationship is FRAGILE_PEACE", async function () {
    const rel = await registry.getRelationship("israel", "iran");
    expect(rel.relType).to.equal(3); // FRAGILE_PEACE
    expect(rel.stabilityScore).to.equal(28n);
    expect(rel.treatyActive).to.equal(true);
  });

  it("peace deal collapse cascades to HOSTILE relationship", async function () {
    await registry.updateEventStatus("hormuz_deal", 4); // COLLAPSED
    const rel = await registry.getRelationship("israel", "iran");
    expect(rel.relType).to.equal(6); // HOSTILE
    expect(rel.stabilityScore).to.equal(10n);
  });

  it("simulation advances cycles and records metrics", async function () {
    await oracle.updateMetrics(38n, 3n, 120n, 45n, 52n);
    await registry.advanceCycle();
    expect(await registry.currentCycle()).to.equal(1n);
    const snap = await oracle.getCycleSnapshot(1n);
    expect(snap.regionalStabilityIndex).to.equal(38n);
  });

  it("full research report — baseline vs. experiment", async function () {
    // Run 2 more baseline cycles
    await oracle.updateMetrics(40n, 2n, 130n, 43n, 50n);
    await registry.advanceCycle();
    await oracle.updateMetrics(42n, 1n, 140n, 41n, 48n);
    await registry.advanceCycle();

    // Set baseline
    await oracle.setBaseline(3n);

    // Apply experiment — raise Iran hardliner pressure via WorldRegistry
    await registry.applyExperiment(
      "exp_hardliners_win", "iran", "hardlinerPressure", 95n
    );
    await oracle.recordExperiment(
      "exp_hardliners_win", "iran", "hardlinerPressure", 95n, 3n
    );

    // Run experiment cycle with worse metrics
    await oracle.updateMetrics(28n, 9n, 90n, 72n, 18n);
    await registry.advanceCycle();

    // Compare
    const [stabDelta] = await oracle.compareToBaseline();
    expect(stabDelta).to.be.lt(0n); // stability decreased

    // Verify experiment is recorded on-chain
    const history = await oracle.getExperimentHistory();
    expect(history[0].experimentId).to.equal("exp_hardliners_win");
    expect(history[0].valueAfter).to.equal(95n);
  });
});
