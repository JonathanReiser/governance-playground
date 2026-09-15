# Verifiable execution v0

**COMMIT → EXECUTE → VERIFY**

A small, domain-neutral prototype: bind a JSON specification to a SHA-256
commitment, then compare presented execution evidence against that specification.
No network, blockchain, wallet, application server or npm dependencies are required
for the core verifier or demo. Use Node.js 22+ (tested with Node 24).

## Run the synthetic demo

From the repository root, choose a new output directory:

```sh
node scripts/verifiable-execution.js demo /tmp/verifiable-execution-demo
```

Expected output includes:

```text
0.72 → 0.72 = VERIFIED
0.72 → 0.75 = VERIFICATION FAILED
  /specification/parameters/threshold: value differs
```

This is a fictional transaction-review workflow with two synthetic inputs and a
toy scoring model. One score is 0.73, so changing the threshold from 0.72 to 0.75
also changes its decision from `review` to `clear`. There is no financial
institution involvement, confidential data, live model service or real approval.

The demo writes a canonical manifest, the full expected commitment and execution
ID, and both evidence/report pairs. It refuses to overwrite existing output.
Two executions under one commitment are deliberate here to illustrate tampering;
this is not a single-use execution service.

### Separate phases and independent verifier

```sh
# 1. COMMIT: hash the manifest before running the workflow.
node scripts/verifiable-execution.js commit /tmp/verifiable-execution-demo/manifest.json
# Independently retain the printed 64-character hash and the manifest's executionId.
# For an actual timing claim, anchor the hash before execution using a trusted service.

# 2. EXECUTE: substitute your retained hash for EXPECTED_HASH.
node scripts/verifiable-execution.js execute-demo \
  /tmp/verifiable-execution-demo/manifest.json EXPECTED_HASH /tmp/evidence.json

# 3. VERIFY: in a separate process, provide your independently retained hash and ID.
node scripts/verifiable-execution.js verify \
  /tmp/verifiable-execution-demo/manifest.json /tmp/evidence.json \
  EXPECTED_HASH EXPECTED_EXECUTION_ID

# Optional demo-specific artifact and deterministic output replay:
node scripts/verifiable-execution.js verify-demo \
  /tmp/verifiable-execution-demo/manifest.json /tmp/evidence.json \
  EXPECTED_HASH EXPECTED_EXECUTION_ID

# Deliberately execute a changed threshold; verification must exit 1.
node scripts/verifiable-execution.js execute-demo \
  /tmp/verifiable-execution-demo/manifest.json EXPECTED_HASH /tmp/tampered.json 0.75
node scripts/verifiable-execution.js verify \
  /tmp/verifiable-execution-demo/manifest.json /tmp/tampered.json \
  EXPECTED_HASH EXPECTED_EXECUTION_ID
```

`verify` returns structured `PASS`/`FAIL`, JSON Pointer mismatch paths and explicit
claim limitations. Exit status is 0 for PASS and 1 for failure, including malformed
input. The intentional two-case `demo` exits 0 only when both expected outcomes
occur. Reports omit field values; the threshold values printed by `demo` are public
constants. Files contain the actual manifest/evidence, so keep secrets out of them.

**Do not obtain the expected commitment only from an untrusted evidence bundle.**
An operator could replace the manifest, evidence and hash together. The demo's
adjacent `expected-*.txt` files are convenient local outputs, not independent
anchors. Retain the commitment and context in a verifier-controlled channel.

## Architecture and API

- `server/sha256.js`: shared existing UTF-8 SHA-256 implementation.
- `server/verifiableExecution.js`: strict canonicalization, manifest commitment,
  evidence digest and exhaustive specification comparison. Imports only SHA-256.
- `scripts/verifiable-execution.js`: offline CLI, exclusive local file writes,
  strict UTF-8/canonical-JSON reads and demo orchestration.
- `synthetic-workflow.js`: domain-specific adapter; records actual local artifact
  hashes and the effective threshold used in its calculation. The optional
  `verify-demo` also recomputes local artifacts and output.

The manifest has exactly `protocol`, `executionId`, `createdAt`, `specification`.
The protocol is `verifiable-execution/v0`; the ID identifies the expected execution
context and should be freshly generated and retained by the verifier (demo: UUID).
The specification is any nonempty JSON object. **Every specification field is
binding**, including extensions, nested arrays and nulls; there is no ignored
metadata area. Domain adapters must define which fields are required for their
workflow and observe all execution-relevant choices. The generic verifier cannot
know about a relevant setting omitted from both manifest and evidence.

The demo specification contains workflow ID/version, model ID/version/content
hash, source-file SHA-256, input hash, threshold, policy ID/version/hash and a
fictional approval ID/version/hash. Full input rows, model contents and approval
text need not appear in the manifest. The source hash covers the demo adapter
file, not Node, imported helpers or the entire environment. Deterministic toy
arithmetic needs no random seed; stochastic adapters should commit their seed and
other applicable runtime settings.

```js
const { commit, createEvidence, verify, canonicalize } = require('./server/verifiableExecution');
const expectedCommitment = commit(manifest); // persist independently before execution
// Execute with actual artifacts/settings, then produce evidence from observations.
const evidence = createEvidence({
  commitment: expectedCommitment, executionId: manifest.executionId,
  observedSpecification, output, completedAt: new Date().toISOString()
});
const result = verify({ manifest, evidence, expectedCommitment, expectedExecutionId });
// Serialize protocol files with canonicalize(value) + '\n'.
```

Evidence has exactly `protocol`, `commitment`, `executionId`,
`observedSpecification`, `output`, `completedAt`, `evidenceHash`. Its digest covers
all the other fields. This detects edits without resealing; **anyone can recompute
it**, so it is not a signature or independent witness. The core checks specification
conformity and evidence digest consistency, not the semantics of arbitrary outputs.

### Canonical bytes: a versioned, restricted JSON profile

This is a local protocol, not a claim of implementing an external canonicalization
standard. Object keys sort lexicographically by UTF-16 code units and are emitted
directly (including integer-like keys). Arrays preserve order. Strings and finite
numbers use ECMAScript `JSON.stringify` scalar encoding; no Unicode normalization.
UTF-8 encodes the resulting text, with no whitespace in the hashed representation.

Reject negative zero, unsafe integers, nonfinite numbers, unpaired surrogates,
undefined, functions, BigInt, sparse/decorated arrays, non-plain objects, accessors,
hidden/symbol properties and cycles. Max depth is 64; max canonical size is 1 MiB.
Numbers are IEEE-754 binary64, not arbitrary-precision decimals; encode exact money
or higher-precision values as strings under an adapter's explicit schema.

CLI files must already be canonical JSON, with at most one final LF. Reading
validates strict UTF-8, parses, reserializes and requires byte equality. Consequently
it rejects duplicate keys (including escaped aliases), noncanonical key order,
pretty printing and numeric lexemes that would lose information during parsing.
Author files using `canonicalize` on plain in-memory JSON values. Do not normalize
untrusted files with a lossy `JSON.parse` and call that validation. In-memory APIs
cannot recover distinctions already lost by an upstream parser. Hostile executable
JavaScript objects/proxies are outside the JSON-file threat model.

Digests are lowercase full SHA-256 hex, with domain-separated UTF-8 preimages:

```text
manifest: verifiable-execution/v0 + LF + manifest + LF + canonical(manifest)
evidence: verifiable-execution/v0 + LF + evidence + LF + canonical(evidence minus evidenceHash)
artifact: verifiable-execution/v0 + LF + artifact + LF + canonical(artifact)
```

Cross-implementation vector (no final LF inside the hash):

```text
canonical value: {"10":"ten","2":"two","a":{"c":3,"d":4},"b":1}
artifact digest: b4d2288e57cf5df69929e2aa9423853eccda85cd990f0709cafdf0fd5ea3ff9e
```

## Why commit before execution?

An ordinary after-the-fact log can document what an operator later says happened.
An independently retained pre-execution commitment gives a verifier a fixed
reference against which later claims can be compared. Replacing both the
specification and reported execution then fails against that retained reference.

Hashing alone establishes neither publication nor chronology. Local files, Git
commit dates, `createdAt` and `completedAt` are operator assertions, not trusted
timestamps. This prototype deliberately makes **no chronological inference** from
those timestamp fields, even if they are backdated or inconsistent.

Storage/anchoring is separate: future integrations could retain commitments in
Git, a transparency log, a signature system, Base L2, another ledger or an external
timestamp service. Each has its own trust assumptions. A digital signature alone
does not establish time; an independently validated anchor can establish that the
commitment existed **no later than its independently established anchor time**.
Proving it preceded execution also requires trustworthy evidence about when that
execution occurred. No anchor integration or verification is implemented here.

## Relation to scientific preregistration

This reuses the repository's existing commit-first, canonical-JSON/SHA-256 pattern;
it makes no novelty claim. The research implementation adds experiment-specific
fields, future NIST beacon binding, run/batch sealing and publication expectations.
The new protocol isolates specification/evidence conformity for other domains,
without requiring that beacon or importing research lifecycle assumptions.

Only the existing SHA-256 function is extracted, byte-for-byte, into a shared
module. The old canonical serializer, exports, registration formats, commands,
archives and existing tests remain unchanged. The new strict serializer is separate
because changing the legacy serialization rules could invalidate historical hashes.
A regression test recomputes an archived registration and verifies its result offline.
The new protocol's limited claims do not retroactively strengthen older reports.

## Tests and security review

```sh
npm ci --ignore-scripts
npm run test:verifiable-execution
npm test
```

The targeted suite includes all new tests plus existing scientific and arena
preregistration tests. The full root suite also compiles/tests the contracts and
other backend functionality. See [SECURITY.md](SECURITY.md) for assumptions, adversarial
findings and exact supported/unsupported claims; [REVIEW.md](REVIEW.md) records results.
