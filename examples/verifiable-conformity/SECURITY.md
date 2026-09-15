# Threat model and claim boundaries

## Trust assumptions

The reviewer controls the expected commitment/context and retains them independently
of the operator. SHA-256 resists collisions and second preimages. The verifier,
runtime, output adapters and their local reference artifacts are trusted. Operator
JSON is untrusted and enters via the bounded canonical wire API. Executable JS
objects/proxies and adapter code are not untrusted inputs to be sandboxed.

The operator may rewrite every presented manifest/evidence field, recompute hashes,
replay transcripts, fabricate observations and select runs for disclosure. The
operator cannot change the reviewer's retained commitment/context under this model.
Two directories owned by one OS user do **not** enforce that last assumption; the
demo only illustrates where independent custody belongs.

## Audit findings and boundaries

| Finding | Response and remaining limit |
| --- | --- |
| H-1 historical execution | Intentionally unsolved. Fabricated conforming evidence can pass. See the architecture roadmap. |
| H-2 arbitrary output | A committed digest or versioned trusted adapter predicate is mandatory when declared. Missing adapters and failed predicates fail; unconstrained output is explicitly `NOT_CHECKED`. Schema conformity is not real-world correctness. |
| M-1 replay/context | Option B: remove freshness claims. Operator-generated `executionId` is only a context label. Identical replay and newly fabricated matching contexts remain possible; tests demonstrate both. |
| M-2 timestamps | Reject calendar-invalid times and completion before manifest creation. Accept only internal chronological consistency; assertions can still be backdated together. |
| M-3 privacy | Add 256-bit random manifest blinding nonce. Shape is checked, entropy is not provable. Keep nonce/private manifest undisclosed while only the commitment is public. Hashes are binding, not encryption; public nonces or individual unsalted hashes still enable guessing. |
| M-4 canonical profile | Explicit ECMAScript scalar/UTF-16 rules, frozen vectors, independent Python byte/digest checker. No claim of a complete second-language verifier. |
| M-5 wire boundary | Primary API validates bounded bytes/text, strict UTF-8 and canonical roundtrip. Internal object APIs are explicitly unsafe for untrusted wire; cannot recover information lost by a prior parser. |
| L-1 diagnostic keys | Redact dynamic path segments by default. Explicit verbose mode reveals keys, never values. Reports still expose fixed protocol paths, failure type and a bounded mismatch count. |
| L-2 anchoring flow | Separate reviewer retention from presented evidence; never auto-load an expected pin from the operator bundle. A filesystem pin does not prove independent custody or time. |
| L-3 digest roles | Distinct allowed roles for model, inputs, policy, approval, output, manifest and evidence. Equal values in different roles hash differently. |
| L-4 resource bounds | Size/structure preflight before canonical allocation, bounded byte decoding and file reads, member/node/depth limits and capped comparisons. No multi-tenant sandbox or malicious-adapter timeout mechanism. |

The evidence digest checks internal consistency only. It authenticates nobody.
Changing output and recomputing the digest fails a relevant output constraint, but
an attacker can still fabricate output that satisfies that constraint. Deleting or
downgrading the constraint also changes the committed manifest and fails the pin.
A permissive adapter or schema checks only what it actually specifies.

Blinding the manifest does not hide plaintext placed in public artifacts. Input
hashes can leak low-entropy data through dictionary attacks; metadata, object keys,
outputs, filenames and debug paths can also be sensitive. Avoid sensitive plaintext
in public manifests. The prototype has no encryption or access-control service.

## Strongest supported claim

**Given an independently retained commitment and expected context, the verifier
determines whether the presented manifest/evidence conforms to that committed
specification.** On PASS:

- The presented manifest recomputes to the expected full commitment, including
  nonce and output constraint.
- Every presented specification value conforms; manifest/evidence use the expected
  context label and evidence refers to the expected commitment.
- The evidence digest is internally consistent and asserted chronology is coherent.
- Output satisfies its declared trusted predicate/digest constraint, if any;
  otherwise `outputValidation.status` is `NOT_CHECKED` and correctness is not verified.

FAIL means a required input, binding, chronology, specification or output-constraint
check did not pass. It is not proof of fraud or a diagnosis of the operator's motives.

## What PASS does not prove

- The historical execution occurred or used the reported settings.
- The operator did not fabricate conforming evidence.
- Inputs were truthful, complete, legitimately obtained or confidential.
- The model or policy was correct, fair or appropriate.
- An approval was genuine or authorized by a person/institution.
- Alternative, repeated, off-record or selectively disclosed runs did not occur.
- A timestamp reflects trusted wall-clock time, or commitment preceded execution.
- A context ID provides adversarial freshness or unique execution.
- A digest authenticates evidence; a schema establishes real-world correctness.
- The complete runtime is covered by the demo source-file hash.
- Regulatory compliance, production readiness, certification or novelty.

No external timestamp/transparency anchor, signature, runtime attestation, independent
observer or durable single-use service is implemented. Blockchain storage does not
automatically make inputs trustworthy or prove that a computation occurred.

## Pilot-review clarifications

- Redacted specification mismatches carry HMAC-SHA-256 `fieldId` labels derived from
  full escaped JSON Pointer paths. The default key is fresh, private and report-local.
  A reviewer-controlled `diagnosticKey` can intentionally correlate reports, but
  reusing it reveals path equality and permits chosen-input correlation to anyone
  who can submit and observe diagnostic requests. Never derive it from the manifest
  nonce, reuse a public key value, or disclose it with the report. IDs authenticate
  nothing and do not recover field names. Verbose remains opt-in; values stay hidden.
- Visually confusable Unicode and invisible characters remain distinct committed
  data. Human visual review does not reliably establish semantic equivalence. Domain
  adapters should enforce exact field names; digest/unconstrained output modes do
  not impose such a schema. Normalizing keys would silently change protocol meaning.
- A committed adapter ID/version labels a reviewer-trusted predicate, not its code
  hash. Parties must agree on its actual implementation and reference artifacts.
- The manifest's context check is a reviewer-label consistency check (the manifest
  is already hash-bound); the evidence context check ties presented evidence to
  that label. Neither is independently issued freshness evidence.
- In-memory plain-object key enumeration can allocate before the member check.
  This residual limitation is outside the bounded wire boundary; do not treat the
  unsafe API as a hardened service for attacker-controlled JS objects.
- Use tested Node 24 for the pilot. The external review reported a state-dependent
  Node 26 JSON parser anomaly; it has not been independently reproduced here.
  No claim of safety on all newer runtimes or complete startup parser attestation
  is made. The existing canonical roundtrip is a consistency check, not immunity
  to arbitrary runtime defects.
