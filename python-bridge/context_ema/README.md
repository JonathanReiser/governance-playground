# Context-sensitive EMA proof of concept

This exploratory analysis asks a prerequisite question for a richer cognitive
state model: do combinations of context and recent within-person state predict
coping choices better than an additive context model?

It uses the CC0 Dryad dataset *Nurses coping with daily stressors*
(`doi:10.5061/dryad.ns1rn8pqv`). The data contain repeated momentary reports of
work task, demand, control, effort, reward, mood, fatigue, and coping behavior.

Six regularized logistic models are compared:

1. `additive`: current context and stable coping traits;
2. `context_interactions`: pairwise interactions among current context inputs;
3. `recent_momentary`: additive current context plus the person's immediately
   preceding mood, fatigue, demand, effort, control and reward;
4. `own_history`: additive current context plus the running mean of that
   person's own past values of the outcome being predicted, current row excluded;
5. `recent_state`: additive current context plus the person's immediately
   preceding state **and** preceding coping response;
6. `context_state`: recent state plus pairwise interactions among all dynamic
   inputs.

Sets 3 and 4 exist because set 5 bundles two things that a summary cannot tell
apart: recent cognitive state, and the person's own previous choice of the very
outcome being predicted. Reporting a gain from that bundle as evidence about
cognitive state is only defensible if the two are also reported separately.

Together this prevents two distinct misreadings: a gain from temporal memory
being reported as evidence for context interactions, and a gain from stable
individual differences being reported as evidence for recent state.

Validation holds out entire people with `GroupKFold`. Randomly splitting rows
would leak each person's stable traits and repeated state into the test data.
This is an exploratory predictive comparison, not evidence for quantum brain
processes, a causal treatment effect, or clinical guidance.

## Results: withdrawn pending regeneration

**The first run's result table and every conclusion drawn from it have been
withdrawn.** They are not restated here, because restating them would let claims
survive on the strength of having once appeared in this file. `results/
nurses-poc-v0.1.json` is kept as a record of what was run, but it is superseded:
the current module cannot even produce that schema.

Three defects, found in review, made those numbers unsafe to carry forward.

**Two headline numbers were not computable from the code that allegedly produced
them.** The README reported that dropping the six momentary variables "costs
0.031, 0.026, 0.028 and 0.033" ROC-AUC, and that those variables "still add
0.009, 0.008, 0.026 and 0.040 on top of the person's base rate". Both require a
tasks-only model and a base-rate-only model. Neither existed. The shipped
`specifications` table defined six feature sets and included no such arm, and the
committed results file contains no such key. The central positive claim of the
analysis — *"Current state matters"* — rested on numbers no one could reproduce.
Those two models now exist (`tasks_only`, `propensity_only`).

**No uncertainty was computed at all.** The module emitted point estimates and
bare differences. The claimed gains of **+0.009** and **+0.008** are roughly an
order of magnitude smaller than the marginal 95% interval on a single AUC at this
sample size (about ±0.026 and ±0.028 by Hanley–McNeil), before accounting for
clustering at all. With 1,901 observations from 96 people — about 20 each — the
design effect at an intraclass correlation of 0.1 to 0.3 is between 2.9 and 6.6.
Whether those gains are real is an open question, not a settled one.

**Metrics pooled clustered rows as independent.** ROC-AUC, average precision and
Brier were each computed in one call over all 1,901 rows, and per-fold results
were discarded, so not even between-fold variation was recoverable.

### What the module now does differently

| change | why |
|---|---|
| `tasks_only` and `propensity_only` feature sets | the two baselines the claims needed and the code lacked |
| participant bootstrap (people resampled, never rows) | rows are not independent; 96 people, ~20 observations each |
| paired differences on the same folds and the same resampled people | a difference of two pooled AUCs from different splits is not a comparison |
| per-fold AUCs retained, with mean and SD | fold-to-fold spread is evidence, not overhead |
| C selected by inner GroupKFold on training folds only | one fixed `C=0.1` shrank `additive` (~22 features) and `context_state` (~231 interactions) by the same amount, biasing the comparison *against* interactions. The old "interactions do not help" result is confounded with that choice and is withdrawn with the rest |
| Brier removed | every model uses `class_weight="balanced"`, which deliberately decalibrates; a Brier score from those probabilities is not a calibration measure |
| dataset SHA-256 recorded in the output | the Dryad file cannot be redistributed here, so a checksum is the only way to say which bytes produced a result |

### Regenerating

The archived file is not in this repository and Dryad does not permit automated
download, so these results must be regenerated by someone holding `eco2.RData`:

```bash
PYTHONPATH=python-bridge python3 -m context_ema.nurses_poc \
  path/to/eco2.RData --output python-bridge/context_ema/results/nurses-poc-v0.2.json
```

Conclusions should be written from that output — from the paired differences and
their intervals, not from the point estimates. If `propensity_only` matches or
beats the richer models, the honest headline is that a person's habitual rate is
what predicts their coping choice, and that momentary context adds little. That
result is permitted.

### On participant count

The archived file contains 96 people; the publication reports 113 recruited.
This module applies **no** participant exclusions — `load_ema` sorts and
type-checks only — so the shortfall is a property of the Dryad deposit, not of
this analysis. The deposit does not document which participants were withheld or
why, so it cannot be attributed here, and the sample should be described as the
archived subset rather than the recruited cohort. The output records both counts.

### What survives review

Two design choices were checked and hold up, and they are worth keeping in view
when the numbers are regenerated.

`propensity_<outcome>` genuinely excludes the current observation: it is built by
shifting within person and then taking an expanding mean, and row *i* equals the
mean of that person's rows 0…*i*−1. Lags never cross a person boundary.

Holding out whole people stops the model *learning* person-specific parameters,
but handing it that person's own base rate as a feature supplies the same
information by another route. This is not leakage — the base rate uses strictly
earlier rows — but person-held-out validation is not the stringent test it
appears to be once such a feature is present. That caveat applies with more force
now that `propensity_only` is reported on its own.

## Order test

The follow-up is specified in `order-test-spec.md` and implemented in
`order_test.py`. It compares the two preceding moments while controlling for
current context, the unordered content of those moments, and the person's prior
coping rate. A 200-draw within-row swap null finds no incremental predictive
order effect for either common outcome:

| encoding | Problem contribution (p) | Emotion contribution (p) | verdict |
|---|---:|---:|---|
| momentary linear | -0.0014 (0.478) | -0.0028 (0.726) | null |
| momentary commutator | -0.0053 (0.955) | -0.0027 (0.393) | null |
| task commutator | -0.0061 (0.856) | -0.0061 (0.657) | **void** |
| categorical task order | -0.0084 (0.771) | -0.0086 (0.483) | null |

The task-commutator representation is void because 95.9% of its encoded values
are zero.

**The 90% void rule was not applied to the categorical encoding, and that is a
deviation from the spec.** Stated plainly because the two numbers invite the
wrong comparison: the categorical encoding is **98.0%** zero — *higher* than the
95.9% that voided the commutator — yet it is reported as a null rather than void.
The reason is that a one-hot representation of ~49 task-pair levels is ~98% zero
by construction, one `1` per row, so the rule would void any categorical encoding
whatever its information content. The rule was written for the antisymmetric
commutator, where a zero means the row carries no order signal. Power for the
categorical arm is evidenced instead by its 1,327 rows with differing preceding
tasks and its 49 ordered versus 28 unordered levels. Each encoding's output now
carries `void_rule_applied` and `void_rule_note` so the exception is visible in
the results, and `order-test-spec.md` records it as a declared deviation.

These order-test numbers stand: they do not depend on the withdrawn feature sets
above, and the order contribution is measured against its own matched unordered
baseline. They were, however, produced under the same single fixed `C`, so the
same caveat about regularization applies to their magnitudes.

This dataset also cannot test interference or a violation of total probability:
all variables are jointly observed on every one of the 1,901 rows (zero missing
cells and one missingness pattern). Such a test requires an experimental arm in
which a relevant state or question is deliberately left unresolved. More EMA
rows with the same design cannot create that counterfactual condition.

Run from the repository root after installing `python-bridge/requirements-ema.txt`:

```bash
PYTHONPATH=python-bridge python3 -m context_ema.nurses_poc \
  path/to/eco2.RData --output path/to/results.json

PYTHONPATH=python-bridge python3 -m context_ema.order_test \
  path/to/eco2.RData --output path/to/order-results.json
```
