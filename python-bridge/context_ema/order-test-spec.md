# EMA sequence test — analysis specification

**Status:** written before the reconstructed analysis was run. This is an
exploratory feasibility test, not a clinical or quantum-mechanism claim.

## Question

Does the order of the two preceding EMA contexts predict the current coping
choice after accounting for the current context, the person's running prior
rate of that coping choice, and the unordered content of those two preceding
observations?

The confirmatory outcomes for this exploratory test are `Problem` and
`Emotion`. `Support` is descriptive. `Refusal` is not assessed because only 50
of 1,901 rows are positive and those positives are concentrated among a small
number of participants.

## Encodings

1. **Momentary linear:** symmetric sums and absolute differences describe the
   unordered pair; signed `t-1 minus t-2` differences add order.
2. **Momentary commutator:** add every antisymmetric cross-product
   `A(t-1)B(t-2) - A(t-2)B(t-1)`.
3. **Task commutator:** apply the same antisymmetric encoding to the six task
   indicators. If at least 90% of all order columns are zero, label the result
   `VOID`, regardless of its score or p-value.
4. **Categorical task order:** reduce each moment to its single active task (or
   `Other` when zero/multiple tasks are marked). Compare an unordered task-pair
   baseline with the ordered pair.

All models are regularized logistic regressions. Five-fold `GroupKFold` holds
out entire people. The score is held-out ROC-AUC. The order contribution is the
ordered model's AUC minus its matched unordered baseline.

## Null and decision rule

For each encoding, independently swap `t-1` and `t-2` on half the eligible rows,
refit, and repeat for 200 fixed-seed draws. The one-sided permutation p-value is
`(1 + count(null >= observed)) / 201`.

- `order-supported`: contribution > 0 and p <= 0.05;
- `null`: otherwise;
- `void`: representation fails the predeclared 90% zero-feature power check.

**Scope of the void rule (deviation, recorded).** The 90% check is applied to
the commutator encodings only. It is **not** applied to the categorical task-pair
encoding: a one-hot representation of ~49 levels is ~98% zero by construction,
one `1` per row, so the rule would void any categorical encoding regardless of
its information content. The rule was written for the antisymmetric commutator,
where a zero means the row carries no order signal at all. For the categorical
encoding, power is evidenced instead by the count of rows with differing
preceding tasks and by the ordered-versus-unordered level counts, both reported.
Each encoding's output now carries `void_rule_applied` and `void_rule_note`, so
the exception is visible in the results rather than inferred from the code.

A null result means this dataset did not detect incremental predictive order
information. It does not prove that cognition is commutative. This observational
dataset cannot test interference or violations of total probability because all
variables are jointly measured at every prompt.
