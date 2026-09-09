# Arena hardware-validation preregistrations

Separate from `../` on purpose. The registrations one level up are shaped around
scenarios, cycles and agent models; these bind a quantum circuit to a device.
Sharing a directory would put two unrelated experiments in one archive and invite
a loader to pool them.

## What is being preregistered

Release 1 of the Quantum Policy Tic-Tac-Toe protocol is implementation-only, so
the hypothesis cannot be about people, strategy or advantage. It is about the
device:

> For every registered cell, the total variation distance between the backend's
> empirical distribution over `[CC, CD, DC, DD]` and the protocol's exact Born
> distribution is at most `tvdThreshold`.

Falsified if **any single cell** exceeds the threshold. Not a majority, not an
average — averaging would let a clean cell pay for a broken one.

## Where the threshold came from

`threshold-basis.json`, written **before** the registration and hashed into it.
An Aer noise model predicts the TVD for every cell; the threshold is
`min(0.25, 2 x worst predicted + 0.05)`.

The model is generic rather than calibrated from `ibm_marrakesh` — no IBM token
was configured when the threshold was derived. Generic and stated is honest; a
threshold tuned to the device after reading its calibration would not be. The
doubling absorbs the gap between a generic model and a real one.

## Running it

```bash
node scripts/prereg-arena.js register --draw-after 2h
node scripts/prereg-arena.js draw <hash-prefix>     # after drawAfter; needs IBM_QUANTUM_TOKEN
node scripts/prereg-arena.js verify <hash-prefix>
node scripts/prereg-arena.js list
```

`draw` refuses to run before `drawAfter`, refuses without a token, and refuses to
publish a result if any cell fell back to the simulator. Every other hardware
path in this project degrades to a labelled simulator, which is right when a
reading is a side channel; here the whole question is what the device did, so a
fallback would publish simulator output under a registration that promised
hardware. It abandons the run instead.

## What a result does not license

That the device reproduces the predicted distributions. Nothing about quantum
advantage, about the `(Q,Q)` equilibrium — which holds only within a four-option
menu and not under full SU(2) — or about human behaviour. Those need a new
protocol version with its own preregistration.
