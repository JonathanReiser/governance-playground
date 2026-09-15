# Review handoff

Branch: `prototype/verifiable-execution-v0`

Base: `f969be97d54f5f70a736965e12c1b5db44fc4c35` (`main`, pulled before branching)

The implementation is additive. No merge to main, research-archive edits or changes
to existing tests are part of this branch. A separate checkout was used because
another local checkout had unrelated uncommitted work.

## Files added/changed

| File | Purpose |
| --- | --- |
| `server/verifiableExecution.js` (added) | Domain-neutral canonicalization, commitment, evidence and verification |
| `server/sha256.js` (added) | Extracted shared SHA-256 function |
| `server/prereg.js` (changed) | Import that same SHA-256 function; legacy serialization and behavior preserved |
| `scripts/verifiable-execution.js` (added) | Independent offline verifier and CLI lifecycle |
| `examples/verifiable-execution/synthetic-workflow.js` (added) | Synthetic artifact observations, computation and evidence |
| `test/verifiableExecution.test.js` (added) | Positive, negative, adversarial, CLI and historical compatibility tests |
| `examples/verifiable-execution/README.md` (added) | Demo, API, protocol and preregistration relationship |
| `examples/verifiable-execution/SECURITY.md` (added) | Threat model, adversarial findings and exact claim boundaries |
| `examples/verifiable-execution/REVIEW.md` (added) | This handoff |
| `package.json` (changed) | Targeted test and demo scripts; no new dependencies |
| `README.md` (changed) | Link to prototype |

## Architecture

Manifest → restricted canonical JSON → domain-separated SHA-256 commitment →
adapter execution → evidence with observed specification/output → standalone
verification against an independently retained full commitment and execution ID.
The core compares all specification fields, including unknown extensions. Storage,
identity authentication and trusted time remain separate. Optional synthetic replay
checks the demo's local artifact hashes and output, without asserting historical
execution authenticity.

## Tests and results

Final run: Node.js **24.19.0**, macOS.

- `npm run test:verifiable-execution`: **76 passing** (36 new, 40 existing).
- `npm test`: **267 passing**; the full existing root suite plus new tests.
  The first full run compiled 32 Solidity files successfully.
- `node scripts/verifiable-execution.js demo /private/tmp/verifiable-execution-v0-final`:
  both expected outcomes, exit 0; changed threshold reported specifically at
  `/specification/parameters/threshold`. This manual demo also ran under Node 26.
- CLI tests check independent processes, PASS/FAIL exit codes, separate execution,
  substitution rejection, no-overwrite behavior and a minimal verifier-only copy
  with no npm packages, research module or demo adapter.
- `git diff --check`: clean.

Environment issues encountered and resolved, with no tests weakened or removed:

- The initial Mocha launch on the machine's Node 26 failed inside the existing
  `yargs` dependency (`require is not defined in ES module scope`). The test suite
  was then run with bundled Node 24; no dependency changes were needed.
- The initial sandboxed full run had 262 passes and two existing arena HTTP
  before/after-hook failures because its local listener could not start. With
  local listener permission, the unchanged suite passed. After additional
  adversarial tests, the final full run had 267 passes.

## Security findings and assumptions

Reviewed canonicalization ambiguity, replay, commitment substitution, execution
binding, timestamps, confidential-data exposure, report language and false PASS
routes. [SECURITY.md](SECURITY.md) records each finding and remaining limit.

The verifier assumes a trusted implementation/runtime, correct independently
retained expected commitment/context, SHA-256 resistance and validated JSON input.
Interpreting reported settings as actual execution requires a trustworthy observer
that the prototype does not provide. A hash of an approval does not authenticate it.

## Exact claims and known limitations

**Supported:** the presented manifest hashes to the expected commitment; presented
execution specifications match every committed field and expected context; the
presented evidence digest is internally consistent. Optional synthetic replay
additionally matches local artifact hashes and deterministic output.

**Unsupported:** actual historical execution, truthful inputs, model correctness,
good or authentic policy/approval, completeness, uniqueness, absence of off-record
runs, confidentiality, pre-execution timing, compliance, production readiness or
novelty. An operator can fabricate a conforming transcript and recompute its digest;
the core can also accept arbitrary resealed output. Tests explicitly preserve and
expose these limits rather than implying stronger guarantees.

The stateless verifier accepts the same bundle repeatedly. An integrated consumer
would need durable single-use state. Local timestamps are only assertions. A future
independently validated external anchor could support an existed-no-later-than claim,
but no such anchor is implemented or verified here. Neither a ledger nor a signature
automatically establishes truthful inputs or actual execution.
