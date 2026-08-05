// One-time setup script: generates 6 fresh throwaway wallets for Sepolia
// deployment (1 deployer + 5 role/citizen-recipient addresses — only the
// deployer ever signs a transaction, see scripts/deploy.js). Private keys
// are written straight to .env (gitignored) and never printed to stdout.
// Only the public addresses are printed — those are safe to share.

const fs   = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const ENV_PATH = path.join(__dirname, "..", ".env");

if (fs.existsSync(ENV_PATH) && fs.readFileSync(ENV_PATH, "utf8").includes("SEPOLIA_KEY_0")) {
  console.log("Sepolia wallets already exist in .env — not overwriting. Delete the SEPOLIA_KEY_* lines first if you want fresh ones.");
  process.exit(0);
}

const wallets = Array.from({ length: 6 }, () => ethers.Wallet.createRandom());

const envLines = wallets.map((w, i) => `SEPOLIA_KEY_${i}=${w.privateKey}`);
fs.appendFileSync(ENV_PATH, "\n" + envLines.join("\n") + "\n");

console.log("Generated 6 throwaway wallets, private keys written to .env (gitignored).\n");
console.log("Addresses (safe to share):");
wallets.forEach((w, i) => {
  const role = i === 0 ? "deployer — FUND THIS ONE" : `role/citizen slot ${i}`;
  console.log(`  [${i}] ${w.address}  (${role})`);
});
console.log("\nOnly [0] needs Sepolia ETH — the others are just addresses, never sign anything.");
