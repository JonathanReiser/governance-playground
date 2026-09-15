# Review handoff: pilot cleanup and conformity hardening

Branch: `prototype/verifiable-execution-v0`. No merge to main.

## Latest patch: pilot cleanup following the review of a6d0eaf

Starting commit: `a6d0eafbab021755dea17ac925a73667a8006f61`.
Input: the user's pasted independent adversarial review. This is the agreed small
usability/documentation patch, not an expansion into historical execution evidence.

### Changes

- **L-A:** static CLI usage is reachable for missing/bad commands and wrong arity;
  `--help`/`help` exits successfully. Syntax errors remain distinct from generic
  data/file failures. Arguments, parser excerpts and exception messages stay hidden.
- **L-B:** specification mismatches have distinct HMAC-SHA-256 `fieldId` labels
  even when redacted paths look identical. Default keys are fresh per report. An
  explicitly supplied private 32-byte `diagnosticKey` permits cross-report
  correlation; never derive it from public manifest data. Reuse reveals equality
  and can permit chosen-input correlation to parties with access to requests and
  reports. Default CLI behavior does not reuse, persist or print the key.
- **I-B:** a conformity PASS with unconstrained output explicitly says in its
  `claim` that output correctness is not verified.
- **L-E:** corrected Python checker documentation from “parse agreement” to “value
  agreement.” Its limited assurance remains explicit; no new canonicalizer claimed.
- **L-D / I-C / I-A:** documented Unicode visual-confusability, adapter labels not
  binding adapter implementations, and the manifest context check's consistency role.
  Tests demonstrate the first two limits without pretending to solve them.
- **I-D:** pilot instructions now call for tested Node 24. The external review's
  Node 26 parser anomaly remains unconfirmed here; no runtime defect workaround or
  startup attestation is claimed.

**L-C remains a documented trusted-caller limitation:** plain-object key enumeration
allocates before checking member count. We did not substitute a `for...in` loop and
claim a hard memory bound it cannot portably guarantee. The primary wire boundary
still bounds input size before parsing. H-1, actual historical execution, remains
intentionally unsolved. No freshness or trusted-time mechanism is introduced.

### Files changed in this patch

`server/verifiableConformity.js`, `scripts/verifiable-conformity.js`,
`test/conformityHardening.test.js`, and under `examples/verifiable-conformity/`:
`README.md`, `SECURITY.md`, `CANONICALIZATION.md`, `check_vectors.py`, `REVIEW.md`.

Protocol v1, manifest/evidence schemas and canonical/hash bytes are unchanged.
Diagnostic labels affect reports only; reports may differ across invocations while
commitments and verdicts remain deterministic for the same trusted configuration.
Scientific preregistration code, archives, tests, shared SHA-256 and lockfile are unchanged.

### Validation

On Node 24.19.0:

- `npm run test:conformity`: **143 passing**.
- `npm test`: **334 passing**, including existing HTTP tests with listener access.
- Python byte/value/digest fixture check: **12 fixtures / 84 role digests pass**.
- Manual default-redacted demo: unchanged threshold conforms; 0.75 fails against
  committed 0.72, with an opaque field ID and redacted path.
- `git diff --check`: clean.

All prior tests preserved. Eleven new tests cover field-ID uniqueness, controlled
correlation, fresh defaults, escaped/array paths, invalid keys and strict verbose,
unchecked-output claim language, differing trusted adapters, confusable Unicode,
help, syntax errors and confidential data/file errors.

The independent review found no bypass in its tested attack classes and assessed
readiness for a limited synthetic pilot. That is not proof of absence of bugs or
production readiness. The claim and historical limits below remain unchanged.

## Previous hardening pass

Starting commit: `4c5622f46ae76bcb8aff0294c8979eaddf0937f3`; resulting commit: `a6d0eaf`.
Input for that earlier pass was the user's detailed remediation request; the separate
full review was supplied later and informed the cleanup above.

## 1. Findings addressed

| Finding | Exact change |
| --- | --- |
| H-2 | Committed explicit output constraint: trusted versioned adapter predicate/schema wrapper, expected output-domain digest, or explicit unconstrained status. Missing/failed adapters fail closed; unconstrained output reports correctness not verified. Removing/downgrading a constraint breaks the pin. Unkeyed evidence digests are never called authentication. |
| M-2 | Calendar validity and `completedAt >= createdAt`; described only as internal chronological consistency. Tests distinguish impossible order from coherent fabricated backdating. |
| M-3 | Required manifest blinding nonce, default 32 random bytes. Included in commitment without changing semantic specification values. Explain secret-nonce requirements, predictable-nonce risk, public artifact guessing and no encryption guarantee. |
| M-4 | Exact restricted ECMAScript scalar/UTF-16 canonical profile; 12 accepted vectors, 20 rejected wire cases, three malformed UTF-8 cases and 84 role digests. Independent stdlib Python byte/digest fixture checker. |
| M-5 | Primary `verify` consumes canonical bytes/text; rejects duplicate keys, noncanonical encodings, rounding lexemes, malformed JSON/UTF-8. Object APIs moved under explicit `unsafe`. |
| L-1 | Dynamic mismatch-path segments redacted by default. Explicit verbose mode exposes keys; never include values or raw parser/adapter exception text. |
| L-2 | Reviewer-retained anchor and operator evidence use separate paths; separate preparation/retention/execution/check commands. Tests replace the operator bundle while preserving an independently loaded expected pin. |
| L-3 | Distinct allowed model/input/policy/approval/output/manifest/evidence domains. Unknown roles rejected. |
| L-4 | Aggregate size/structure preflight before canonical allocation; scalar, member, node and depth limits; capped UTF-8/file reads and mismatch count. Plain-array restriction avoids inherited encoding behavior. |
| M-1 | Selected authorized option B: remove freshness claims, retain context matching only. Tests explicitly demonstrate replay and fabrication under new operator contexts. |
| Claim language | Rename implementation/CLI/demo/docs/tests/scripts toward conformity. PASS is never labeled as historical execution verification. Protocol revision is `verifiable-conformity/v1`; branch name remains for review continuity. |

## 2. Intentionally not solved

**H-1 remains open:** an operator can fabricate a conforming transcript and reseal
it, even one satisfying the output predicate. Hashes and local replay cannot prove
historical execution. M-1 is resolved by claim correction, not an anti-replay service.
No verifier-issued challenge, signed observation, independent key custody, runtime
attestation, trusted timestamp/transparency service or durable single-use registry
is added. Separate local directories demonstrate, but do not enforce, independent
custody. The Python fixture checker is not a complete second-language verifier.

## 3. Files changed

Renamed and hardened:

- `server/verifiableExecution.js` → `server/verifiableConformity.js`
- `scripts/verifiable-execution.js` → `scripts/verifiable-conformity.js`
- `test/verifiableExecution.test.js` → `test/verifiableConformity.test.js`
- `examples/verifiable-execution/` → `examples/verifiable-conformity/` for
  `README.md`, `SECURITY.md`, `REVIEW.md`, `synthetic-workflow.js`

Added:

- `test/conformityHardening.test.js`
- `examples/verifiable-conformity/CANONICALIZATION.md`
- `examples/verifiable-conformity/canonicalization-vectors.json`
- `examples/verifiable-conformity/check_vectors.py`
- `examples/verifiable-conformity/HISTORICAL-EXECUTION.md`

Updated: root `README.md` and `package.json` scripts (`test:conformity`,
`demo:conformity`). No added npm dependencies, lockfile changes, research archive
changes, or shared SHA-256 changes.

The experimental wire format intentionally changes: manifest nonce/outputConstraint
and new protocol/domain names require new commitments. Old transcripts are available
at the starting commit; no silent fallback weakens the new checks.

## 4. Regression tests

Preserved all 36 earlier prototype cases with renamed paths/API/fixtures where
required, plus all 40 scientific/arena preregistration tests unchanged. The earlier
case accepting reversed chronology was intentionally changed to reject it (M-2).
The earlier arbitrary-resealed-output case now fails its declared output adapter
(H-2); a new explicit-unconstrained case tests the allowed NOT_CHECKED behavior.
CLI cases now require independent anchor files and appropriate adapters; vector
expectations use the revised protocol/domains. No tests were deleted or skipped.

Added 56 cases covering every finding: adapter false/exception/truthy/async results,
schema and digest rejection, output downgrade/missing adapter, mutation isolation,
chronology boundaries, nonce binding, strict identifier lengths, primary wire API
ambiguity, sensitive keys, domain separation, structural/resource limits and early
abort before large serialization, capped diagnostics, replay limitations, all
canonical vectors and separate retention/overwrite/substitution checks.

## 5. Previous hardening results (a6d0eaf)

Tests for that hardening commit on Node.js 24.19.0, macOS:

- `npm run test:conformity`: **132 passing** (36 preserved prototype cases,
  56 new cases, 40 unchanged preregistration cases).
- `npm test`: **323 passing**; full root suite including existing HTTP/contract tests.
  Run with local HTTP-listener access required by existing arena tests.
- `python3 examples/verifiable-conformity/check_vectors.py`: **12 cross-language
  byte fixtures and 84 role digests pass** (not a complete Python canonicalizer).
- Separate-directory demo: 0.72 → 0.72 gives `PASS: CONFORMS`; 0.72 → 0.75 gives
  `FAIL: DOES NOT CONFORM`. Default paths redact keys; verbose synthetic paths
  identify `/specification/parameters/threshold`.
- `git diff --check`: clean.

## 6. Strongest supported claim

**Given an independently retained commitment and expected context, the verifier
determines whether the presented manifest/evidence conforms to that committed
specification.** This includes internally consistent asserted chronology and the
explicit committed output constraint, if any. Unconstrained output correctness is
not verified. A predicate PASS establishes only what that trusted predicate checks.

## 7. Strongest unsupported claim

It still cannot prove that a historical execution occurred or that the operator did
not fabricate conforming evidence. Nor does PASS prove truthful inputs, correct
models/policies, genuine approval, no alternative runs, trusted wall-clock time,
freshness or regulatory compliance. See [SECURITY.md](SECURITY.md) for assumptions
and precise boundaries, including unkeyed hashes and blinding disclosure limits.

## 8. Architecture still needed

[HISTORICAL-EXECUTION.md](HISTORICAL-EXECUTION.md) describes verifier-issued challenges,
trusted observation/measurement, signed runtime evidence with key/signing path outside
operator control, appropriate attestation, external trusted timestamp/transparency
proofs, and append-only independent retention. A blockchain timestamp alone does
not prove the claimed computation occurred. Each future guarantee needs independent
validation and an explicit trust model.
