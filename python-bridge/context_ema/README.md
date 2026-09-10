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

## First run

The archived file contains 1,901 observations from 96 people (the publication
reports 113 recruited participants). With five-fold person-held-out validation:

| outcome | additive | interactions | recent momentary | own history | recent state | state + interactions |
|---|---:|---:|---:|---:|---:|---:|
| problem-focused coping | 0.715 | 0.710 | 0.719 | **0.861** | 0.850 | 0.835 |
| emotion-focused coping | 0.614 | 0.587 | 0.612 | **0.820** | 0.744 | 0.706 |
| social support | 0.582 | 0.562 | 0.569 | **0.709** | 0.643 | 0.617 |
| refusal | **0.620** | 0.573 | 0.600 | 0.586 | 0.577 | 0.483 |

Read the middle two columns first, because they decompose the fourth.

**Generic pairwise interactions do not help.** Every outcome is worse with them
(−0.005, −0.027, −0.020, −0.046). That is a clean negative and it is the result
this analysis was built to obtain.

**Cognitive state does help, but only the current moment's.** Dropping the six
momentary variables from the additive model costs 0.031, 0.026, 0.028 and 0.033
ROC-AUC, and they still add 0.009, 0.008, 0.026 and 0.040 on top of the person's
base rate — eight gains out of eight. Current state matters.

The *previous* moment's state is what adds nothing. `recent momentary` moves
ROC-AUC by +0.004, −0.002, −0.013 and −0.020 beyond the additive model, three of
four negative. That is expected when state is autocorrelated: once the current
value is known, the lag is largely redundant. It is a statement about the lag,
not about cognitive state.

**What predicts a coping choice is how often that person makes it.** A single
feature — the running mean of that person's own past choices, excluding the
current row — reaches 0.861 / 0.820 / 0.709, beating the entire ten-feature
`recent state` bundle on three of four outcomes.

So the `recent state` gain reported by the fourth column is not evidence about
cognitive state. It comes almost entirely from including the lagged value of the
outcome being predicted, and that lag is in turn a worse proxy for something
simpler: the person's habitual rate. Adding the lag on top of the base rate gains
+0.006, +0.001 and −0.001.

This interacts with the validation design and is worth stating plainly. Holding
out whole people stops the model *learning* person-specific parameters, but
handing it that person's own base rate as a feature supplies the same
information by another route. This is not leakage — the base rate uses strictly
earlier rows, and the prediction is legitimate wherever a person's history is
available — but person-held-out validation is not the stringent test it appears
to be once such a feature is present.

Refusal has only 50 positive rows and behaves inconsistently throughout; treat
its column as noise.

**The supported conclusion.** Three effects of very different size, which the
first run's single `recent state` column merged into one:

| effect | size |
|---|---|
| the person's stable rate of that coping style | +0.15 to +0.21 |
| the current moment's cognitive state | +0.03 |
| the previous moment's state, given the current | ~0 |
| pairwise interactions among context variables | negative |

So the model these data support is a stable per-person baseline plus a smaller
but genuine momentary term. A latent *temporal* state model is not supported:
once the current moment is known, the previous one adds nothing.

Nothing here supports a quantum or noncommutative mechanism either — but note
what has and has not been tested. Pairwise interactions in a logistic model are
not order effects, and non-commutativity is an order effect: whether high demand
*then* low control predicts differently from low control *then* high demand,
beyond their aggregate. The dataset carries sequence, so that question is
answerable here, and it has not yet been asked.

Run from the repository root after installing `python-bridge/requirements-ema.txt`:

```bash
PYTHONPATH=python-bridge python3 -m context_ema.nurses_poc \
  path/to/eco2.RData --output path/to/results.json
```
