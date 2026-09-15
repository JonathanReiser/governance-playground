# Verifiable conformity

**COMMIT → EXECUTE → CHECK CONFORMITY**

> Given an independently retained commitment and expected context, the verifier
> determines whether the presented manifest/evidence conforms to that committed
> specification.

A PASS is **presented-evidence conformity**, not historical execution verification.
No network, wallet, ledger, application server or npm dependency is required by the
core or demo. Use Node.js 24 for the pilot (tested on 24.19.0). The branch keeps its original name,
`prototype/verifiable-execution-v0`, for review continuity. The revised protocol is
`verifiable-conformity/v1`; the old experimental wire format is intentionally rejected.

## Synthetic demo with separate retention

Choose two new, separate directories whose parents exist:

```sh
node scripts/verifiable-conformity.js demo /tmp/conformity-reviewer /tmp/conformity-operator
```

```text
TRUSTED / INDEPENDENT ANCHOR (simulated retention): /tmp/conformity-reviewer/anchor.json
OPERATOR-PRESENTED EVIDENCE: /tmp/conformity-operator
0.72 → 0.72 = PASS: CONFORMS
0.72 → 0.75 = FAIL: DOES NOT CONFORM
  [field <opaque field ID>] /specification/[redacted]/[redacted]: value differs
```

Use `--verbose` only for public synthetic data to see
`/specification/parameters/threshold`. Dynamic object-key segments are redacted by
default; values are never included in mismatch reports. Even debug paths can reveal
identifiers, so do not use verbose diagnostics with confidential metadata.
Each specification mismatch also has an opaque `fieldId`, distinguishing otherwise
identical redacted paths. IDs are report-local by default. A verifier may explicitly
reuse a private 32-byte `diagnosticKey` Buffer to correlate paths across reports;
keep that key outside all manifests/evidence and do not use a public nonce. Reuse
exposes path equality and enables chosen-input correlation if an attacker can submit
requests and observe reports. Default CLI reports use a fresh key, never persist or
print it, and do not expose names/values through IDs. IDs are diagnostic labels,
not commitments or authentication; their randomness does not change protocol hashes.

Run `node scripts/verifiable-conformity.js --help` for command syntax. Missing or
incorrect arguments produce static usage text with exit 1, while malformed data and
file errors remain generic and do not echo arguments or exception contents.

The fictional transaction-review adapter scores two synthetic rows. A score of
0.73 changes from `review` to `clear` when the threshold changes to 0.75. It observes
the effective threshold and local model/input/policy/approval artifacts. Its committed
output adapter also checks local artifact identity and deterministic output. Nothing
here involves a real financial institution, live model, confidential data or genuine approval.

**The directories illustrate a trust boundary, not enforce it.** One OS user can
edit both. In a real deployment, a reviewer must control retention independently
of the operator. These files are not trusted timestamps. The demo deliberately runs
twice under one commitment; the protocol does not enforce single use or freshness.

### Separate processes: preparation, retention, execution, checking

```sh
# OPERATOR: prepare a manifest. Keep its random blinding nonce private.
node scripts/verifiable-conformity.js prepare-demo /tmp/operator-new

# REVIEWER: inspect the proposed specification, output constraint and context first.
# Choose storage controlled independently of the operator, BEFORE execution.
mkdir -m 700 /tmp/reviewer-new
node scripts/verifiable-conformity.js retain \
  /tmp/operator-new/manifest.json /tmp/reviewer-new/anchor.json

# OPERATOR: obtain the agreed full commitment; substitute it for EXPECTED_HASH.
node scripts/verifiable-conformity.js commit /tmp/operator-new/manifest.json
node scripts/verifiable-conformity.js execute-demo \
  /tmp/operator-new/manifest.json EXPECTED_HASH /tmp/operator-new/evidence.json

# REVIEWER: supply the previously retained anchor, never a replacement in the bundle.
node scripts/verifiable-conformity.js verify-demo \
  /tmp/operator-new/manifest.json /tmp/operator-new/evidence.json /tmp/reviewer-new/anchor.json
```

`retain` writes a full expected commitment and context ID; it refuses to overwrite
the pin. The operator evidence directory contains no expected-anchor file. Replacing
all operator files fails against the retained anchor, as regression tests demonstrate.
This flow provides no independently established time or identity guarantee.
Visual inspection alone is insufficient: Unicode lookalikes or invisible characters
can make distinct keys appear identical. Use an explicit domain schema/adapter that
recognizes exact field names; unconstrained or digest-only modes do not supply that
semantic check. Canonicalization deliberately preserves these distinctions.

`verify-demo` installs a specific trusted local synthetic output adapter. Generic
`verify` handles unconstrained and committed-digest outputs, and **fails** if the
manifest requires an adapter unavailable to it. No code is loaded from evidence,
URLs, paths or adapter identifiers supplied by the operator.

Commands exit 0 for PASS and 1 for failure/malformed input. The two-case `demo` exits
0 only if its positive case passes and its deliberate tampering case fails. File
writes are exclusive with mode 0600; demo directories use 0700. Outputs still contain
their actual data: hashes are not confidentiality controls.

## Primary API: canonical bytes at the trust boundary

```js
const fs = require('node:fs');
const { verify, commitWire } = require('./server/verifiableConformity');

// Received through an independently controlled channel, retained before execution:
const expectedCommitment = '...full 64-character retained hash...';
const expectedExecutionId = '...retained context...';

const report = verify({
  manifestWire: fs.readFileSync('presented-manifest.json'),
  evidenceWire: fs.readFileSync('presented-evidence.json'),
  expectedCommitment,
  expectedExecutionId,
  adapters: new Map(), // install only reviewer-trusted synchronous predicates
  verbose: false
});
// report.status: PASS / FAIL
// report.outputValidation.status: PASS / FAIL / NOT_CHECKED / NOT_RUN
```

The core validates input size before decoding/parsing, strict UTF-8, canonical
serialization, protocol/schema, manifest commitment, expected context association,
evidence digest, internal chronology, every specification field, then the committed
output constraint. Invalid inputs fail closed with no untrusted error excerpts.
For file services, also bound I/O before reading; the CLI uses capped descriptor reads.

Wire files must be canonical JSON with at most one final LF. Duplicate keys,
noncanonical numeric/string encodings, whitespace and malformed input are rejected.
Use `canonicalize` to serialize trusted authored plain data and `commitWire` to commit
wire data. `unsafe.commit` and `unsafe.verifyObjects` exist for internal data/tests
only: they cannot recover distinctions an upstream parser has already discarded.
Never `JSON.parse` untrusted files and pass the result to the unsafe API.

## Manifest, blinding and output constraints

Manifest fields are exactly `protocol`, `executionId`, `blindingNonce`, `createdAt`,
`specification`, `outputConstraint`. `newBlindingNonce()` generates 32 random bytes
encoded as 64 lowercase hex characters. It is committed along with everything else.
The verifier checks its shape, not its entropy; operator-chosen predictable nonces
cannot be detected cryptographically. **This nonce is for blinding, not freshness.**

Publish only the commitment if blinding is needed. Keep the nonce/private manifest
unavailable to guessers until disclosure. Publishing the nonce alongside a digest
allows guessing a low-entropy specification again. Publishing the manifest exposes
its plaintext, and publishing individual unsalted input hashes can expose guessable
inputs regardless of whole-manifest blinding. **Hashes are binding, not encryption.**
Do not put sensitive plaintext or identifying keys in public manifests.

`specification` is any nonempty JSON object. All fields, extensions, types, nested
values and array order are binding. Domain adapters must capture every relevant
setting; the generic protocol cannot identify semantics omitted from both sides.
The synthetic adapter pins its source-file SHA-256, not the complete runtime/import graph.

`outputConstraint` must explicitly choose one form:

| Constraint | Enforcement |
| --- | --- |
| `{ "type": "unconstrained" }` | `NOT_CHECKED`; output correctness is explicitly not verified, even on conformity PASS. |
| `{ "type": "digest", "digest": "<full hash>" }` | Output must hash to this committed `output`-domain digest. |
| `{ "type": "adapter", "id": "name", "version": "1" }` | Requires a trusted local predicate registered as `name@1`; missing/wrong adapters fail. |

A synchronous predicate receives `{ specification, output }` as an isolated copy and
must return literal `true`. Wrap a trusted schema validator or deterministic replay
here; the core does not implement a schema language. False, exceptions, promises or
other truthy values fail. The output constraint is part of the independently pinned
manifest: deleting/downgrading it fails. An adapter is trusted code, not sandboxed;
its quality/meaning and availability remain the reviewer's responsibility.
`id@version` is a coordination label, not a hash of the predicate implementation.
Different verifiers can register different predicates under that label and disagree;
reviewers must agree on the actual adapter code/reference artifacts.

Output `PASS` means only that the selected predicate/digest constraint was satisfied,
not correctness in the real world. A weak schema may check only shape. `evidenceHash`
is an unkeyed consistency digest, **not authentication**; anyone can reseal fabricated
evidence. Both constrained and unconstrained reports state the historical limits.

## Chronology, context and relationship to preregistration

Evidence must assert `completedAt >= createdAt`; calendar-invalid times fail. This
is **internal chronological consistency only**. Both timestamps can be fabricated;
PASS does not establish trusted wall-clock time or pre-execution commitment.
`executionId` is a retained context label, not adversarial freshness: an operator can
copy/relabel a transcript, fabricate matching evidence or replay it repeatedly.

Unlike an after-the-fact audit log, a commitment independently retained beforehand
provides a fixed reference the operator cannot silently replace along with the
presented evidence. Proving that retention preceded the actual execution requires
additional trustworthy time/execution evidence. A local pin cannot prove chronology.

This generalizes the existing scientific preregistration pattern without a novelty
claim. Research preregistration keeps its original serializer, SHA-256 hashes,
archives, NIST binding, commands and tests. Only the SHA-256 primitive was previously
shared; this patch does not alter that scientific workflow. Old prototype transcripts
remain inspectable at commit `4c5622f`; new schema/domain rules require new commitments.

## Further detail and tests

- [Canonicalization profile and vectors](CANONICALIZATION.md)
- [Threat model and exact claims](SECURITY.md)
- [Historical execution architecture roadmap](HISTORICAL-EXECUTION.md)
- [Findings, changed files and test results](REVIEW.md)

```sh
npm ci --ignore-scripts
npm run test:conformity
npm test
python3 examples/verifiable-conformity/check_vectors.py
```
