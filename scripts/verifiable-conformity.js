#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { MAX_BYTES, canonicalize, parseCanonical, commitWire, verify } = require("../server/verifiableConformity");
const ANCHOR_PROTOCOL = "verifiable-conformity/retained-anchor-v1";
const USAGE = `Usage: node scripts/verifiable-conformity.js <command>
  prepare-demo OPERATOR_DIR
  retain MANIFEST TRUSTED_ANCHOR
  demo TRUSTED_DIR OPERATOR_DIR [--verbose]
  commit MANIFEST
  execute-demo MANIFEST EXPECTED_HASH OUTPUT [THRESHOLD]
  verify MANIFEST EVIDENCE TRUSTED_ANCHOR [--verbose]
  verify-demo MANIFEST EVIDENCE TRUSTED_ANCHOR [--verbose]
  --help

PASS means presented-evidence conformity only. --verbose reveals object keys.`;
class UsageError extends Error {}
function read(file) {
  const fd = fs.openSync(file, "r");
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BYTES + 1) throw new Error("invalid file size/type");
    const bytes = Buffer.alloc(MAX_BYTES + 2);
    let length = 0, n;
    while (length < bytes.length && (n = fs.readSync(fd, bytes, length, bytes.length - length, null)) > 0) length += n;
    if (length > MAX_BYTES + 1) throw new Error("invalid file size");
    return bytes.subarray(0, length);
  } finally { fs.closeSync(fd); }
}
function write(file, value) { fs.writeFileSync(file, canonicalize(value) + "\n", { flag: "wx", mode: 0o600 }); }
function retain(manifestWire, file) {
  const expectedCommitment = commitWire(manifestWire);
  write(file, { protocol: ANCHOR_PROTOCOL, expectedCommitment, expectedExecutionId: parseCanonical(manifestWire).executionId });
}
function report(manifestWire, evidenceWire, anchorWire, { synthetic = false, verbose = false } = {}) {
  const anchor = parseCanonical(anchorWire);
  if (!anchor || anchor.protocol !== ANCHOR_PROTOCOL || Object.keys(anchor).length !== 3 ||
      !Object.hasOwn(anchor, "expectedCommitment") || !Object.hasOwn(anchor, "expectedExecutionId")) throw new Error("invalid retained anchor");
  return verify({ manifestWire, evidenceWire, expectedCommitment: anchor.expectedCommitment,
    expectedExecutionId: anchor.expectedExecutionId, verbose,
    adapters: synthetic ? require("../examples/verifiable-conformity/synthetic-workflow").adapters : new Map() });
}
function main(args) {
  const [command, ...rest] = args;
  if (args.length === 1 && ["--help", "help"].includes(command)) { console.log(USAGE); return; }
  const verbose = rest.includes("--verbose");
  const a = rest.filter(x => x !== "--verbose");
  if (verbose && !["verify", "verify-demo", "demo"].includes(command)) throw new UsageError();
  if (command === "commit" && a.length === 1) console.log(commitWire(read(a[0])));
  else if (command === "prepare-demo" && a.length === 1) {
    fs.mkdirSync(a[0], { mode: 0o700 });
    const demo = require("../examples/verifiable-conformity/synthetic-workflow");
    write(path.join(a[0], "manifest.json"), demo.makeManifest(randomUUID()));
  } else if (command === "retain" && a.length === 2) {
    retain(read(a[0]), a[1]);
    console.log("Retained expected commitment/context. No independent timestamp or execution freshness established.");
  } else if (command === "execute-demo" && (a.length === 3 || a.length === 4)) {
    const wire = read(a[0]);
    if (commitWire(wire) !== a[1]) throw new Error("manifest does not match expected commitment");
    const demo = require("../examples/verifiable-conformity/synthetic-workflow");
    write(a[2], demo.execute(parseCanonical(wire), a[1], a.length === 4 ? Number(a[3]) : undefined));
  } else if ((command === "verify" || command === "verify-demo") && a.length === 3) {
    const result = report(read(a[0]), read(a[1]), read(a[2]), { synthetic: command === "verify-demo", verbose });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } else if (command === "demo" && a.length === 2) {
    // Directory separation illustrates the trust boundary, not independent custody.
    // Resolve existing parents to reject aliases/nesting, including symlinked parents.
    const resolved = a.map(p => path.join(fs.realpathSync(path.dirname(path.resolve(p))), path.basename(path.resolve(p))));
    if (resolved[0] === resolved[1] || resolved.some((p, i) => p.startsWith(resolved[1 - i] + path.sep))) throw new Error("anchor and evidence directories must be separate");
    const [trusted, operator] = resolved;
    fs.mkdirSync(trusted, { mode: 0o700 });
    fs.mkdirSync(operator, { mode: 0o700 });
    const demo = require("../examples/verifiable-conformity/synthetic-workflow");
    const manifestFile = path.join(operator, "manifest.json");
    write(manifestFile, demo.makeManifest(randomUUID()));
    const anchorFile = path.join(trusted, "anchor.json");
    retain(read(manifestFile), anchorFile); // retain BEFORE running either computation
    console.log(`TRUSTED / INDEPENDENT ANCHOR (simulated retention): ${anchorFile}`);
    console.log(`OPERATOR-PRESENTED EVIDENCE: ${operator}`);
    const manifestWire = read(manifestFile);
    const manifest = parseCanonical(manifestWire);
    const commitment = commitWire(manifestWire);
    for (const [name, threshold] of [["unchanged", 0.72], ["tampered", 0.75]]) {
      const evidenceFile = path.join(operator, `${name}.evidence.json`);
      write(evidenceFile, demo.execute(manifest, commitment, threshold));
      const result = report(manifestWire, read(evidenceFile), read(anchorFile), { synthetic: true, verbose });
      write(path.join(operator, `${name}.report.json`), result);
      console.log(`0.72 → ${threshold} = ${result.ok ? "PASS: CONFORMS" : "FAIL: DOES NOT CONFORM"}`);
      for (const mismatch of result.mismatches) console.log(`  ${mismatch.fieldId ? `[field ${mismatch.fieldId}] ` : ""}${mismatch.path}: ${mismatch.reason}`);
      if (result.ok !== (name === "unchanged")) throw new Error("unexpected demo conformity result");
    }
    console.log("PASS covers presented-evidence conformity only. Directory separation is not trusted custody, time or freshness.");
  } else throw new UsageError();
}
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    // Only static help text is disclosed. Neither argv nor exception messages are echoed.
    const failure = error instanceof UsageError
      ? { status: "FAIL", error: "Invalid command syntax.", usage: USAGE }
      : { status: "FAIL", error: "Invalid wire data, anchor or file operation. Use --help for command syntax. No untrusted input is echoed." };
    console.error(JSON.stringify(failure));
    process.exitCode = 1;
  }
}
module.exports = { read, report, ANCHOR_PROTOCOL };
