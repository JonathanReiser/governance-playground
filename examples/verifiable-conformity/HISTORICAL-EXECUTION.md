# Roadmap: evidence of historical execution

H-1 remains unsolved by this patch. Cryptographic consistency of a transcript is
compatible with inventing that transcript after the fact. Replaying the toy workflow
checks its mathematical result; it does not establish that a claimed historical run
occurred. A blockchain timestamp alone proves neither computation nor truthful inputs.

A stronger design would need an independently evaluated chain of observation:

1. **Verifier-issued challenge.** An unpredictable challenge is issued, retained and
   bound into the committed request before execution. Issuance and atomic consumed-
   challenge state prevent a verifier from accidentally accepting old responses in
   new contexts. A challenge alone cannot stop freshly fabricated evidence.
2. **Measured runtime and trustworthy observer.** Capture the actual loaded code,
   model, inputs, policy/configuration, effective parameters and outputs. Include
   relevant dependencies and environment; measure bytes actually used, not just
   mutable filenames or self-reported hashes. Hardware/software attestation may
   help where appropriate, with explicit platform, coverage and supply-chain assumptions.
3. **Signed runtime evidence.** Bind challenge, original commitment/context, actual
   measurements and outputs into one authenticated transcript. The signing key and
   observation/signing path must be outside the operator's control. A signature from
   an operator-controlled key authenticates only the operator's assertion. Even an
   external key is insufficient if its signer blindly signs operator-supplied data.
4. **Trusted time and transparency.** Anchor commitments and runtime receipts in an
   external trusted timestamp service/transparency log with authenticated inclusion,
   ordering and consistency evidence. An anchor may establish existence no later
   than its time; relating that to execution needs trustworthy runtime/time evidence.
5. **Append-only independent retention.** An independent party retains commitments,
   challenges, attestations and complete receipts, with recovery and anti-equivocation
   controls. Account for abandoned jobs and missing receipts. Completeness and absence
   of off-record runs require coverage beyond a single signed transcript.

Keep these interfaces separate from canonical commitment/conformity code. Git,
transparency logs, signature services, Base L2, other ledgers or timestamp providers
could transport/anchor records under different assumptions. None automatically
validates the runtime observer, authenticates an approval, improves a model, makes
inputs true or establishes regulatory compliance. A future claim should name exactly
which observer, key custody, attestation, timestamp and retention guarantees were
independently checked, and which remain trusted assumptions.
