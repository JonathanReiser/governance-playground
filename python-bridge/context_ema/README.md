# Context-sensitive EMA proof of concept

This exploratory analysis asks a prerequisite question for a richer cognitive
state model: do combinations of context and recent within-person state predict
coping choices better than an additive context model?

It uses the CC0 Dryad dataset *Nurses coping with daily stressors*
(`doi:10.5061/dryad.ns1rn8pqv`). The data contain repeated momentary reports of
work task, demand, control, effort, reward, mood, fatigue, and coping behavior.

Four regularized logistic models are compared:

1. `additive`: current context and stable coping traits;
2. `context_interactions`: pairwise interactions among current context inputs;
3. `recent_state`: additive current context plus the person's immediately
   preceding state and coping response;
4. `context_state`: recent state plus pairwise interactions among all dynamic
   inputs.

This decomposition prevents a gain from temporal memory alone from being
misreported as evidence for context interactions.

Validation holds out entire people with `GroupKFold`. Randomly splitting rows
would leak each person's stable traits and repeated state into the test data.
This is an exploratory predictive comparison, not evidence for quantum brain
processes, a causal treatment effect, or clinical guidance.

## First run

The archived file contains 1,901 observations from 96 people (the publication
reports 113 recruited participants). With five-fold person-held-out validation:

| outcome | additive ROC-AUC | interactions | recent state | state + interactions |
|---|---:|---:|---:|---:|
| problem-focused coping | 0.715 | 0.710 | **0.850** | 0.835 |
| emotion-focused coping | 0.614 | 0.587 | **0.744** | 0.706 |
| social support | 0.582 | 0.562 | **0.643** | 0.617 |
| refusal | **0.620** | 0.573 | 0.577 | 0.483 |

The initial signal is temporal rather than interaction-based: recent state adds
substantial held-out predictive information for the two common coping outcomes,
while generic pairwise interactions do not. Refusal has only 50 positive rows,
so its estimates are particularly unstable. These results justify testing a
compact latent-state model next; they do not justify assuming a quantum or
noncommutative mechanism.

Run from the repository root after installing `python-bridge/requirements-ema.txt`:

```bash
PYTHONPATH=python-bridge python3 -m context_ema.nurses_poc \
  path/to/eco2.RData --output path/to/results.json
```
