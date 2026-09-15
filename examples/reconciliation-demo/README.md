# Synthetic reconciliation review package

A small example for discussing management review controls around quarterly close.
The question is: **which exact calculation and supporting files belong to the
package associated with a review, and what differs in a later presentation?**

All amounts, files, notes, roles and approvals are fictional. There is no involvement
by a real financial institution. This is a package-comparison demonstration, not an
accounting policy, compliance control, approval service or evidence of real review.

## Clickable demonstration

The [interactive example](site/README.md) lets a reviewer edit supporting amounts,
inspect before/after files, and compute the package check in their browser. It
also has a self-contained HTML export for sharing. It uses live SHA-256 checks,
not stored outcome labels. The browser checker is tested against the independent
Node checker for the same candidate bytes.

## One-page explanation

[reconciliation-example.pdf](reconciliation-example.pdf) is the nontechnical handout.
It shows three cases using these amounts (USD):

| Item | Original | Revision A | Revision B |
| --- | ---: | ---: | ---: |
| Statement balance | 125,000 | 125,000 | 125,000 |
| Add deposits in transit | 4,000 | 4,000 | 4,500 |
| Less outstanding payments | 5,500 | 5,000 | 6,000 |
| Adjusted statement balance | 123,500 | 124,000 | 123,500 |
| Ledger balance | 123,500 | 123,500 | 123,500 |
| Difference | 0 | 500 | 0 |
| Package comparison | Matches | Changed | Changed |

Revision A changes supporting data and recalculates, creating a $500 difference.
Revision B changes two amounts and still balances, but the exact supporting files
no longer match the retained package. Both keep the earlier simulated approval;
its package reference is therefore stale. Neither revised package is silently
presented as the earlier reviewed version.

**PASS means the presented package matches the retained reference and its arithmetic
checks. It does not mean the account balances.** A correctly calculated, retained
package with a nonzero difference can pass; inspect `calculation.withinTolerance`
and `calculation.differenceCents` separately.

## Run it

Use Node 24, from the repository root, with a system clock after the fictional
manifest time (July 1, 2026, 10:00 UTC). That time is not independently authenticated.
Choose a new directory:

```sh
npm run demo:reconciliation -- /tmp/reconciliation-example
node scripts/reconciliation-demo.js check \
  /tmp/reconciliation-example/operator-packages/original \
  /tmp/reconciliation-example/reviewer-retained
node scripts/reconciliation-demo.js check \
  /tmp/reconciliation-example/operator-packages/changed-support \
  /tmp/reconciliation-example/reviewer-retained
```

The original check exits 0. Each changed package exits 1. The three-case build exits
0 only when all expected outcomes occur. Existing output is never overwritten by
`build`; its deliberate edits are confined to newly created synthetic revision folders.

Generated layout:

```text
reviewer-retained/manifest.json, anchor.json
operator-packages/original/
operator-packages/changed-support/
operator-packages/changed-but-balanced/
check-results/<case>.json
summary.json
```

Each package has seven files:

- `statement.json`: fictional statement closing balance.
- `ledger.json`: fictional ledger closing balance.
- `reconciling-items.json`: aggregate deposits in transit and outstanding payments.
- `assumptions.json`: USD, explicit adjustment rule, zero difference tolerance.
- `review-notes.txt`: explicitly fictional review notes.
- `calculation.json`: adjusted balance, ledger balance, difference and tolerance result.
- `approval.json`: explicitly simulated role, decision, asserted time and a fingerprint
  of the other six files. The approval is excluded from its own scope to avoid a cycle.

Amounts use bounded integer cents; the checker recalculates independently from the
presented support and assumptions. The retained manifest contains file hashes and
references, not underlying balance amounts. It binds the full package, including the
simulated approval, using the existing verifiable-conformity/v1 core. The required
local adapter checks both the arithmetic output and the approval's package reference.
No core protocol or scientific preregistration behavior is changed.

## What the checker does

1. Reads the candidate package's seven files, rejecting missing/extra files and
   invalid input schemas. It hashes actual file bytes and recalculates the balances.
2. Creates comparison evidence from those observed files **at checking time**.
3. Uses the canonical-wire verifier with the previously retained manifest, full
   expected commitment and context, plus the local reconciliation output adapter.
4. Produces the core report and safe domain-known names of changed files. These
   labels are from a fixed list, not arbitrary confidential filenames.

Evidence generated here is a current file observation, not a historical runtime
receipt. A passing package check does not prove that a person reviewed the files,
that an approval is genuine, that the files reflect real balances, or that the
asserted review time is trustworthy. The comparison also does not establish which
revisions were authorized outside this example.

**The reviewer must retain the expected commitment and context somewhere the
operator cannot change them.** If the operator can replace both the package and
its retained reference, the checker can accept a replacement as its new baseline.

Separate directories demonstrate the expected trust boundary but do not enforce
independent custody when one user controls both. A real workflow would need source-
system capture, actual reviewer identity/approval integration and independently
controlled retention. Reading individual local files is not an atomic cross-system
snapshot; this demo uses static local packages. Exact bytes are compared, so even
formatting-only file changes alter a package hash.

Do not use real or confidential data with this demo. No files are sent to anyone.

## Rebuild the PDF and test

The renderer reads the generated check results and package amounts; it is a
presentation layer, not a second cryptographic verifier. It requires Python/reportlab:

```sh
python3 examples/reconciliation-demo/render_onepager.py \
  --demo /tmp/reconciliation-example --output /tmp/reconciliation-example.pdf
npm run test:conformity
npm test
```

Validation for this addition: 17 reconciliation cases; **160 targeted tests**
and **351 full-suite tests** passing on Node 24.19.0. Tests cover unchanged and
balanced/imbalanced revisions, edits to every file role, stale approval scope,
invalid input/extra/missing files, bounded cents, wrong retained manifests,
incorrect recalculation with a resealed approval, nonblocking rejection of POSIX
named pipes, a matching but unbalanced package, replacement-reference trust limits,
and standalone CLI exit behavior.
The one-page PDF was rendered and visually checked before delivery.

Interactive addition validation: **169 targeted tests and 360 full-suite tests**
pass on Node 24.19.0, including nine browser-checker parity and binding tests.
