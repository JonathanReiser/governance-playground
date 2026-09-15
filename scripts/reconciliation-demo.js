#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const core = require("../server/verifiableConformity");
const workflow = require("../examples/reconciliation-demo/workflow");
const money = cents => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
function build(root) {
  fs.mkdirSync(root, { mode: 0o700 }); // no overwrite
  const packages = path.join(root, "operator-packages"); fs.mkdirSync(packages, { mode: 0o700 });
  const trusted = path.join(root, "reviewer-retained");
  const original = path.join(packages, "original");
  workflow.createPackage(original); workflow.retain(original, trusted);
  for (const [name, deposit, payments] of [["changed-support", 400000, 500000], ["changed-but-balanced", 450000, 600000]]) {
    const dir = path.join(packages, name); fs.cpSync(original, dir, { recursive: true, errorOnExist: true, force: false });
    const file = path.join(dir, "reconciling-items.json");
    fs.writeFileSync(file, workflow.json({ periodEnd: workflow.PERIOD, depositsInTransitCents: deposit, outstandingPaymentsCents: payments }));
    const parse = f => core.parseCanonical(workflow.read(path.join(dir, f)));
    const output = workflow.calculate({ statement: parse("statement.json"), ledger: parse("ledger.json"), items: parse("reconciling-items.json"), assumptions: parse("assumptions.json") });
    fs.writeFileSync(path.join(dir, "calculation.json"), workflow.json(output));
    // Keep the original simulated approval: its package reference is now stale.
  }
  const summaries = [];
  const results = path.join(root, "check-results"); fs.mkdirSync(results, { mode: 0o700 });
  for (const name of ["original", "changed-support", "changed-but-balanced"]) {
    const result = workflow.check(path.join(packages, name), trusted);
    if (result.report.ok !== (name === "original")) throw new Error("unexpected demo result");
    workflow.writeJSON(path.join(results, `${name}.json`), result);
    summaries.push({ case: name, status: result.report.status, calculation: result.calculation, approvalMatches: result.simulatedApprovalMatchesPackage, changedFiles: result.changedFiles });
    console.log(`${name}: ${result.report.status === "PASS" ? "MATCHES RETAINED PACKAGE" : "CHANGED SINCE RETAINED PACKAGE"} | reconciliation difference ${money(result.calculation.differenceCents)}`);
    if (result.changedFiles.length) console.log(`  Changed: ${result.changedFiles.join(", ")}`);
  }
  workflow.writeJSON(path.join(root, "summary.json"), summaries);
  console.log("All data and approvals are simulated. Package comparison does not authenticate a review or prove historical execution.");
}
if (require.main === module) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === "build" && args.length === 1) build(path.resolve(args[0]));
    else if (command === "check" && args.length === 2) {
      const result = workflow.check(args[0], args[1]); console.log(JSON.stringify(result, null, 2));
      if (!result.report.ok) process.exitCode = 1;
    } else { console.error("Usage: node scripts/reconciliation-demo.js build NEW_DIRECTORY | check CANDIDATE_PACKAGE REVIEWER_RETAINED_DIRECTORY"); process.exitCode = 1; }
  } catch { console.error("Demo failed: invalid files, arguments or an existing output directory. No input contents echoed."); process.exitCode = 1; }
}
module.exports = { build };
