#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { TextDecoder } = require("node:util");
const { MAX_BYTES, canonicalize, parseCanonical, commit, differences, verify } = require("../server/verifiableExecution");

function read(file) {
  if (fs.statSync(file).size > MAX_BYTES + 1) throw new Error("maximum JSON size exceeded");
  const data = fs.readFileSync(file);
  if (data.length > MAX_BYTES + 1) throw new Error("maximum JSON size exceeded");
  return parseCanonical(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data));
}
function write(file, value) { fs.writeFileSync(file, canonicalize(value) + "\n", { flag: "wx" }); }
function report(manifest, evidence, expectedCommitment, expectedExecutionId, synthetic = false) {
  const result = verify({ manifest, evidence, expectedCommitment, expectedExecutionId });
  if (synthetic && result.ok) {
    const demo = require("../examples/verifiable-execution/synthetic-workflow");
    try {
      const threshold = evidence.observedSpecification.parameters.threshold;
      result.mismatches.push(...differences(demo.actualSpecification(threshold), evidence.observedSpecification));
      result.mismatches.push(...differences(demo.compute(threshold), evidence.output, "/output"));
    } catch { result.mismatches.push({ path: "/synthetic", reason: "unsupported synthetic execution" }); }
    result.ok = result.mismatches.length === 0;
    result.status = result.ok ? "PASS" : "FAIL";
    result.claim = result.ok ? "Evidence conforms to the expected commitment; synthetic artifacts and output also match local deterministic replay." : "Synthetic artifact/output replay failed.";
  }
  return result;
}
function main(args) {
  const [command, ...a] = args;
  if (command === "commit" && a.length === 1) console.log(commit(read(a[0])));
  else if (command === "execute-demo" && (a.length === 3 || a.length === 4)) {
    const manifest = read(a[0]);
    if (commit(manifest) !== a[1]) throw new Error("manifest does not match expected commitment");
    const demo = require("../examples/verifiable-execution/synthetic-workflow");
    write(a[2], demo.execute(manifest, a[1], a.length === 4 ? Number(a[3]) : undefined));
  } else if ((command === "verify" || command === "verify-demo") && a.length === 4) {
    const result = report(read(a[0]), read(a[1]), a[2], a[3], command === "verify-demo");
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } else if (command === "demo" && a.length === 1) {
    // mkdir without recursive refuses to overwrite a previous demonstration.
    fs.mkdirSync(a[0]);
    const demo = require("../examples/verifiable-execution/synthetic-workflow");
    const manifest = demo.makeManifest(randomUUID());
    write(path.join(a[0], "manifest.json"), manifest);
    const commitment = commit(manifest);
    fs.writeFileSync(path.join(a[0], "expected-commitment.txt"), commitment + "\n", { flag: "wx" });
    fs.writeFileSync(path.join(a[0], "expected-execution-id.txt"), manifest.executionId + "\n", { flag: "wx" });
    console.log(`COMMIT ${commitment}\nEXECUTION ${manifest.executionId}`);
    for (const [name, threshold] of [["unchanged", 0.72], ["tampered", 0.75]]) {
      const evidence = demo.execute(manifest, commitment, threshold);
      write(path.join(a[0], `${name}.evidence.json`), evidence);
      const result = report(manifest, evidence, commitment, manifest.executionId, true);
      write(path.join(a[0], `${name}.report.json`), result);
      console.log(`0.72 → ${threshold} = ${result.ok ? "VERIFIED" : "VERIFICATION FAILED"}`);
      for (const mismatch of result.mismatches) console.log(`  ${mismatch.path}: ${mismatch.reason}`);
      if (result.ok !== (name === "unchanged")) throw new Error("unexpected demo verification result");
    }
    console.log("VERIFIED means presented-evidence conformity. No trusted timestamp or execution attestation.");
  } else throw new Error("usage: verifiable-execution <demo DIR | commit MANIFEST | execute-demo MANIFEST EXPECTED_HASH OUTPUT [THRESHOLD] | verify[-demo] MANIFEST EVIDENCE EXPECTED_HASH EXPECTED_EXECUTION_ID>");
}
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    // Parser errors can contain input excerpts; do not echo untrusted confidential values.
    console.error(JSON.stringify({ status: "FAIL", error: error instanceof SyntaxError ? "invalid JSON" : error.message }));
    process.exitCode = 1;
  }
}
module.exports = { read, report };
