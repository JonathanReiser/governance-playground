# Threat model and claim boundaries

## Assumptions

1. The reviewer independently retains the correct full commitment and expected
   execution ID. An attacker can otherwise substitute the entire bundle.
2. SHA-256 retains collision and second-preimage resistance. No secrecy,
   authenticity or time property follows from hashing alone.
3. The verifier code, its runtime and local replay artifacts are trusted by the
   reviewer. Compromising that environment defeats the checks.
4. To infer actual execution conformity, a separate trustworthy observer must
   capture all relevant settings/artifacts from the actual execution. The demo
   adapter is inspectable and records its effective threshold, but it is not a
   trusted execution environment or attestation mechanism.
5. JSON files enter through the strict reader. In-memory callers supply plain
   data, not executable objects/proxies or values from an ambiguous prior parser.

An adversary may edit every presented JSON field, recompute hashes, omit fields,
reorder keys, replay transcripts and substitute manifests. The independent expected
hash/ID and reviewer environment are outside that adversary's control.

## Adversarial review

| Attack or ambiguity | Behavior and remaining limit |
| --- | --- |
| Key order, integer-like keys, Unicode and number encodings | Explicit canonical profile; strict wire roundtrip rejects ambiguous/noncanonical representations. Unicode normalization remains significant; numeric semantics are binary64. |
| Duplicate/escaped duplicate keys; prototype keys; omitted values | Duplicate wire keys rejected; `__proto__` retained as ordinary data; missing/additional specification fields fail. Unsupported JSON values fail closed. |
| Change threshold/model/input/policy/approval, then reseal | Exhaustive recursive comparison still fails at the affected field, even with a valid replacement evidence digest. |
| Rewrite manifest to match changed evidence | Fails against the independently retained commitment. With only a digest, the verifier cannot identify which original manifest field changed; retain the original manifest for that comparison. |
| Substitute commitment or replay under a different context | Full expected digest and execution ID are mandatory; mismatches fail. Neither defaults to a bundle-supplied value. |
| Replay the identical bundle in the same context | Passes again. This stateless verifier is not a single-use registry. A consuming service needs durable, atomic consumed-ID state and a trusted context/challenge issuer. |
| Fabricate conforming observations after changing actual execution | Can pass, even with matching replay output. A hash cannot authenticate observation. Tests explicitly demonstrate this limitation. Independent witnesses, signatures tied to trusted observers, or attestation would add separate assumptions. |
| Change output and recompute evidence digest | Core can pass because arbitrary output semantics are outside it. `verify-demo` rejects output inconsistent with the local toy computation. This still does not prove historical execution. |
| Omit a relevant parameter from both sides | Generic verifier cannot detect omitted semantics. Adapters need a complete domain schema and trustworthy capture; all fields that are present are compared. |
| Backdate timestamps or create commitment after execution | No trusted timing check exists; transcript may pass. Reports explicitly disclaim timing. Syntax validation is not a timestamp attestation. |
| Leak confidential inputs | Demo is wholly synthetic and manifests use artifact hashes. Reports omit values, but paths, outputs and file contents remain visible. Hashes of guessable inputs permit dictionary attacks; hashes are not encryption. Do not use confidential values, identifying field names, private URLs or credentials. |
| Substitute runner/runtime | Demo hashes its adapter file and rebuilds observed artifact hashes; local replay checks them. That source hash does not cover imports, runtime or environment, nor authenticate the historical binary. Reviewer environment remains trusted. |
| Excessive input | File-size/depth bounds reduce accidental resource exhaustion. Not a hardened multi-tenant verification service. |

## Exact supported claims

On **PASS**, subject to these assumptions:

- The presented manifest recomputes to the independently supplied expected
  commitment under the specified protocol.
- Every presented execution-specification value matches the manifest, with the
  same expected execution context and commitment association.
- The evidence digest is internally consistent with the presented evidence body.
- With `verify-demo`, the synthetic artifact specification and output additionally
  match the reviewer's local deterministic replay.

On **FAIL**, one or more input-validity, binding, digest or specification checks
failed; field paths identify mismatches where possible. This is a finding about
presented evidence, not proof of fraud or a diagnosis of why values differ.

If a future anchor is independently authenticated and its timing guarantees
validated, one could additionally claim the commitment existed no later than its
anchor time. **The current implementation does not establish that claim.**

## Exact unsupported claims

Neither PASS nor a hash proves:

- that the recorded execution actually occurred or used the reported settings;
- that the commitment was made before execution, or that a local timestamp is true;
- that underlying data is truthful, complete, confidential or legitimately obtained;
- that the model is correct, fair or fit for use;
- that an approved policy is good, compliant or actually approved by an authority;
- that an approval hash authenticates a person, signature or authorization;
- that no alternative, off-record, repeated or selectively disclosed execution occurred;
- that arbitrary output is correct (core), or that replay proves historical execution (demo);
- that the full runtime/code/dependency environment is captured by the demo source hash;
- that blockchain or any other storage mechanism automatically makes inputs trustworthy;
- regulatory compliance, certification, production readiness or cryptographic novelty.

The practical result is **verifiable conformity of presented evidence to a retained
commitment**, with a small reproducible synthetic example. Stronger execution,
identity, completeness and chronology guarantees require additional mechanisms.
