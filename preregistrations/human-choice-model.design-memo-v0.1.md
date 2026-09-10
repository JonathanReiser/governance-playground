# Human-choice model — dimensionality design memo

**Status:** engineering/design proposal. **Not a preregistration.** No participant
data may be collected under this document, and none of the recorded Phase 0
Tic-Tac-Toe observations may be used to tune any model described here.
**Version:** 0.1, 2026-09-10.

## The problem this memo exists to fix

An earlier sketch put the participant's cognitive state in `C²` while asking them
to choose among the arena's **four** settings. That is not a small mismatch. A
projective measurement on a two-dimensional space yields two outcomes; it cannot
produce a distribution over four without additional structure that the sketch
never specified. Any fit would have been silently completing the model on the
analyst's behalf.

Three repairs are possible. They are not equally good, and the criterion is **not**
which is most likely to yield a "quantum" result — by that criterion the worst
option wins, because it has the most free parameters.

## Option 1 — a genuinely binary task in `C²`

Restructure the human task so the choice is binary. The state is a unit vector in
`C²`, each presented consideration applies an `SU(2)` rotation, and the Born rule
on a fixed basis gives the choice probability.

| | |
|---|---|
| **State** | 2 real parameters (Bloch angles, global phase removed) |
| **Per operation** | 3 (`alpha`, `beta`, `delta`), reduced to 1–2 after gauge fixing |
| **Measurement** | fixed computational basis, 0 parameters |
| **Operational meaning** | Direct. The state is the participant's disposition between two named actions; an operation is what one consideration does to it; the Born rule is the choice probability. |
| **Identifiability** | Best of the three. Fewest parameters, most data per parameter. |
| **Cost** | The task is no longer the arena's four-setting menu. |

## Option 2 — four choices via `C⁴`, or a four-outcome POVM on `C²`

| | |
|---|---|
| **State** | `C⁴`: 6 real parameters. |
| **Per operation** | `SU(4)` is 15; restricted to local `SU(2)⊗SU(2)`, 6. |
| **POVM alternative** | Four positive operators summing to identity — roughly 9 free parameters for the measurement alone. |
| **Operational meaning** | **Poor.** What a four-dimensional cognitive state *is*, and what an individual POVM element *means* psychologically, are unanswered. They are fitted objects with no independent interpretation and no way to be wrong on their own terms. |
| **Identifiability** | **Worst.** Most parameters, and POVM elements are notoriously weakly identified from choice frequencies. |

This option is the one a result-seeking analyst would pick. Its flexibility is a
liability, not a feature: a model that can fit anything has not been tested by
fitting the data.

## Option 3 — sequential binary decomposition

Decompose the four-way choice into two binary decisions (for instance *engage or
not*, then *which*), each modelled in `C²`.

| | |
|---|---|
| **Parameters** | ~3 per stage, and each stage is identified from its own sub-dataset. |
| **Operational meaning** | Good **if** the decomposition is psychologically real. |
| **Identifiability** | Good — inherits Option 1's advantage per stage. |
| **Risk** | The tree is a strong, separate empirical assumption. If people do not decide in two stages, every parameter is an artifact of an imposed structure, and the model will still fit. |

## Recommendation — Option 1

The smallest model whose parameters and predictions all have clear operational
meanings.

The decisive argument is not parsimony for its own sake. It is that **the question
the arena bequeaths is already a `C²` question.** `delta` is the third `SU(2)`
angle — the coordinate separating the frozen EWL family (`delta = 0`) from the
full local space that `i*sigma_x` inhabits. Asking whether human choice needs
`delta` requires a qubit and an order manipulation. It does not require four
outcomes, and adding them buys nothing but parameters.

Option 3 is the fallback if a binary task cannot be made strategically meaningful.
Option 2 should not be used without an independent argument for what its extra
dimensions mean — an argument nobody currently has.

### What this costs, stated plainly

The human task stops being the arena's four-setting menu. The arena's role in this
bridge was always to supply the *mathematics* — a specific nested parameter with a
fixed interpretation — not the task. Keeping the four-way task to preserve a
surface resemblance, at the price of a model nobody can interpret, would be the
wrong trade.

## Boundaries carried forward

- **Quantum cognition here is a probability model**, not a claim about quantum
  processes in neurons. Evidence for the model is not evidence about neurons.
- **The referee's quantum hardware is not evidence about a participant.** The
  arena's validated `ibm_marrakesh` result concerns a device; it transfers nothing
  to a person.
- **The frozen v1 protocol and the sealed hardware result are untouched** by this
  memo and must remain so.
- **This is not a preregistration.** It becomes eligible to be one only if the
  synthetic identifiability gate passes; see `quantum_arena/human_model_gate.py`.

## Gate outcome, 2026-09-10 — measured, not projected

The gate was run before this memo was finalised. **It fails, and the failure is
informative rather than fatal.**

| check | result |
|---|---|
| identifiable in principle | pass — 24 conditions vs 13 parameters |
| **delta recovered** | **FAIL** — worst \|error\| 1.79 rad against a declared 0.25 |
| delta detectable | pass — false positives 0.000, true positives 1.000 |
| profile not flat | pass — ~900 nll units between delta = 0 and the optimum |

The cause is the design, not the optimiser. More restarts do not help: on
identical data the error was unchanged from 4 to 48 restarts on four of six
seeds, and on two seeds it got *worse* — the search found a better likelihood
further from the truth, which an underpowered optimiser cannot do. Profiling
confirms why: refitting `beta` at each fixed `delta` produces a plateau across
roughly `[0.8, 2.4]`. **`beta` absorbs `delta`.**

### What this permits and forbids

**`delta` is detectable but not estimable.**

- A study built on the **`delta = 0` versus `delta != 0`** contrast is supportable.
  That contrast is exactly the order-effect test, because `delta = 0` predicts an
  order gap of identically zero — so it needs no parameter estimate at all.
- A study reporting a **`delta` point estimate**, a credible interval on `delta`,
  or any interpretation of its magnitude is **not** supportable at any design
  tested here.

### The sweep, completed 2026-09-10

"Does any feasible design recover `delta`?" is now answered. No.

| participants | trials/participant | worst \|δ\| error | FPR | TPR |
|---|---|---|---|---|
| 10 | 48 | 1.9012 | 0.00 | 0.00 |
| 30 | 96 | 1.9058 | 0.00 | 0.50 |
| 60 | 192 | 1.7933 | 0.00 | 1.00 |
| 200 | 192 | 1.8491 | 0.00 | 1.00 |
| 500 | 384 | 1.8474 | 0.00 | 1.00 |

The error is **flat across a 50-fold increase in participants**. Sampling noise
would fall as `1/sqrt(N)`; this does not move, which is the signature of
structural non-identifiability rather than insufficient data. The largest design
tested — 500 participants at 384 trials each — is well past anything fundable and
recovers `delta` no better than the smallest.

Over the same range the true-positive rate climbs `0.00 -> 0.50 -> 1.00` while
false positives stay at `0.00`. **Detection improves with data exactly as
expected. Estimation does not improve at all.** That contrast is the finding.

Artifact: `preregistrations/human-model-gate/design-sweep-2026-09-10.json`.

### The noiseless limit — stronger than the sweep

The sweep shows no *tested* design recovers `delta`. Feeding the fitter expected
counts instead of binomial draws — the infinite-data limit — shows that no design
**can**:

| true `delta` | fitted \|δ\| | \|error\| |
|---|---|---|
| 0.4 | 2.7104 | 2.3104 |
| 0.8 | 2.0874 | 1.2874 |
| 1.1 | 1.9915 | 0.8915 |
| 1.5 | 1.5755 | 0.0755 |
| 2.0 | 1.8656 | 0.1344 |

At 10⁷ trials per cell and zero sampling noise, `delta` is still not recovered
below about 1.1. So the sweep's flat error is not a sample-size limit — **no
budget reaches it.**

### Correction: what the small errors at 1.5 and 2.0 actually mean

The five rows above invite two readings, and **both are wrong.** The first is
"`delta` recovers above about 1.1." The second — asserted in an earlier draft of
this memo, and withdrawn here — is that every estimate lands in a fixed band of
about `[1.6, 2.7]` regardless of the truth, so the small errors are coincidence.

Small error at one or two values cannot distinguish them, because an estimator
with a fixed output band produces small error wherever the truth happens to fall
inside it. The discriminating question is whether the estimate **moves** with the
truth. Regressing fitted on true answers it directly: slope 1 is full
identification, slope 0 is no information.

Ten values from 0.2 to 2.9, noiseless, full reoptimisation at each point:

| true `delta` | fitted \|δ\| | \|error\| |
|---|---|---|
| 0.20 | 2.9499 | 2.7499 |
| 0.50 | 2.4957 | 1.9957 |
| 0.80 | 2.0874 | 1.2874 |
| 1.10 | 1.9915 | 0.8915 |
| 1.40 | 1.2398 | 0.1602 |
| 1.70 | 1.5224 | 0.1776 |
| 2.00 | 1.8656 | 0.1344 |
| 2.30 | 1.7319 | 0.5681 |
| 2.60 | 1.9060 | 0.6940 |
| 2.90 | 2.7113 | 0.1887 |

```
OVERALL          slope -0.165   corr -0.281
ABOVE 1.1        slope +0.441   corr +0.623   (n = 7)
fully identified slope +1.000   corr +1.000
```

The honest reading is between the two:

- **Above 1.1, `delta` is partially identified and severely attenuated.** Slope
  `+0.44` is not zero — there is real information — but the estimate moves less
  than half as fast as the truth. The "fixed band" claim is falsified: estimates
  span `[1.24, 2.95]` and do track.
- **It is not "recovered" above 1.1 either.** Three of the seven points above the
  threshold miss the 0.25 criterion (errors 0.57 and 0.69). The small errors at
  1.4 / 1.7 / 2.0 are where the attenuated line crosses the identity line.
- **Below 1.1 there is no useful tracking at all** — the relationship inverts.

Whether an estimator with slope 0.44 and a 3-in-7 failure rate can support a study
is a judgement call, not a fact this memo settles. It is recorded here as the
open question it is.

### Consequence for the recommendation above

Option 1 (binary `C²` task) stands, and the case for it strengthens: the extra
parameters of Options 2 and 3 would be absorbed the same way, with less warning.
The revision the gate forces is not to the state space but to the **claim** — the
eventual preregistration should register a directional order-effect hypothesis,
not a parameter recovery.

This document remains an engineering proposal. The gate has not passed on its own
declared terms, and the thresholds were not adjusted to make it pass.
