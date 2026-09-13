# Order-Effects External Validation Protocol

**Project:** governance-playground  
**Author:** Jonathan Reiser  
**Version:** 0.1-draft  
**Date:** 2026-09-13  
**Status:** Prospective reanalysis protocol; incomplete and not executable until the dataset and codebook are obtained  

## 1. Purpose

This protocol defines an external-data test of the narrow empirical claim left open by the repository's human-choice identifiability gate: whether a reliable question-order effect is present in an independently collected dataset.

It does **not** preregister recovery of the `SU(2)` parameter `delta`. The repository's analytic reduction and synthetic tests show that the proposed shared-delta design is structurally non-point-identified. It also does not treat an order effect as uniquely quantum; classical carryover, memory, anchoring, response consistency, sampling, and survey-context mechanisms remain live explanations.

Because the target data already exist and published results may be known, this is a prospective **reanalysis** protocol, not a claim that the original hypothesis was registered before data collection.

## 2. Evidence boundaries carried forward

The current repository establishes only engineering and mathematical properties of the proposed model:

- Under `delta = 0`, the modeled order gap is exactly zero.
- A free delta difference can generate a nonzero order gap.
- Under the shared-delta triple design, six nominal orders collapse to two prediction directions per triple.
- The generic Jacobian rank is `2T` for `3T+1` parameters.
- Increasing the simulated sample size improves detection but does not restore point identification.
- A nonzero observed order effect can reject the model's sharp `delta = 0` restriction, but cannot identify delta's magnitude or establish a uniquely quantum mechanism.

This study may update the evidence status of an **order-effect detection claim**. It cannot validate a delta point estimate, the RPE therapeutic applications, or a claim about quantum processes in the brain.

## 3. Research questions

### Primary question

Does the frozen external dataset contain a reproducible difference in response probabilities between the two question orders?

### Secondary questions

1. Do the joint response probabilities satisfy the published QQ-equality constraint within sampling uncertainty?
2. Does a quantum-probability specification predict held-out observations better than prespecified classical alternatives?
3. Are results robust to documented missing-data and coding choices?

The secondary questions are explanatory comparisons. They do not alter the primary detection result.

## 4. Dataset acceptance gate

No outcome analysis may begin until the following dataset card is completed and committed:

| Field | Required value |
|---|---|
| Canonical dataset name | `UNKNOWN` |
| Candidate filename | `QuestOrdData.txt` — unverified |
| Study citation and DOI | `UNKNOWN` |
| Corresponding data provider | `UNKNOWN` |
| Permanent source URL or repository | `UNKNOWN` |
| License or written permission | `UNKNOWN` |
| Cryptographic digest and algorithm | `UNKNOWN` |
| Collection dates | `UNKNOWN` |
| Sampling frame | `UNKNOWN` |
| Unit of observation | `UNKNOWN` |
| Participant count | `UNKNOWN` |
| Question pairs and exact wording | `UNKNOWN` |
| Order-assignment mechanism | `UNKNOWN` |
| Response encoding | `UNKNOWN` |
| Missing-value codes | `UNKNOWN` |
| Published exclusions | `UNKNOWN` |
| Individual-level or aggregate data | `UNKNOWN` |

Acceptance requires authentic provenance, sufficient documentation to reconstruct order and joint responses, lawful permission to analyze and redistribute derived outputs, and a digest recorded before transformation.

If only aggregate tables are available, the protocol must be amended before analysis. Analyses requiring participant-level records will be removed rather than approximated silently.

## 5. Frozen variables and coding

The final protocol must map exact source fields to the following conceptual variables before outcomes are analyzed:

- `participant_id`: anonymous record key, if supplied;
- `pair_id`: question-pair identifier;
- `order`: `AB` or `BA`;
- `a_response`: binary response to question A;
- `b_response`: binary response to question B;
- `weight`: published sampling weight, if any;
- `stratum` and `cluster`: published survey-design fields, if any.

Binary labels must follow the source codebook. No semantic relabeling may be chosen after viewing results. Original fields remain unchanged; transformations occur in a versioned derived file with a row-count and exclusion audit.

## 6. Inclusion, exclusion, and missingness

The analysis population includes every record meeting the source study's documented eligibility rules and containing a verifiable order assignment.

Primary analysis rules:

- Apply only exclusions stated in the source documentation or frozen here before outcome access.
- Do not exclude participants based on response patterns, effect direction, completion time, or model fit unless the codebook defines a preexisting quality rule.
- Do not impute missing binary outcomes in the primary analysis.
- Report the number of records at ingestion, after each exclusion, and in every analysis.
- Analyze survey weights and design variables as specified by the source study. If their use is unclear, report weighted and unweighted analyses as separately labeled sensitivity results.

Duplicate, malformed, or internally inconsistent records must be listed in an exception report. Any new decision requires a dated protocol amendment made before calculating the affected result.

## 7. Outcomes and estimands

### 7.1 Primary order-effect estimands

For each accepted question pair, estimate:

\[
D_A = P(A=1 \mid AB) - P(A=1 \mid BA)
\]

and

\[
D_B = P(B=1 \mid AB) - P(B=1 \mid BA).
\]

Report signed risk differences, 95% confidence intervals, and the response counts forming each estimate. If order was assigned between participants, use design-appropriate independent-group inference. If order varied within participants, use paired or clustered inference. The final choice must be determined from the codebook, not from whichever method yields a smaller p-value.

The primary omnibus null is that both order contrasts equal zero for the prespecified primary question pair or family:

\[
H_0: D_A = D_B = 0.
\]

The exact omnibus test must be frozen after the sampling design is known and before outcomes are accessed.

### 7.2 QQ-equality diagnostic

Using the source study's verified joint-cell convention, calculate the signed QQ expression:

\[
q = P(A_y B_n) + P(A_n B_y) - P(B_y A_n) - P(B_n A_y).
\]

The mapping of each source cell to these terms must be independently checked by two implementations. Report `q`, its uncertainty interval, and the prespecified test against zero. A result consistent with zero is a constraint check, not proof that the quantum account generated the data.

### 7.3 Effect-size interpretation

No delta point estimate, delta interval, or verbal interpretation of delta magnitude will be reported. Statistical significance alone will not be described as practical importance. Effect sizes and uncertainty take priority.

## 8. Prespecified comparison models

All models receive identical training records, folds, outcomes, and allowed covariates.

1. **No-order baseline:** response probability depends on question identity and frozen survey covariates but not presentation order.
2. **Classical order model:** adds freely estimated order indicators and prespecified interactions.
3. **Classical carryover model:** when record structure permits, includes the preceding response as a predictor of the next response.
4. **Quantum-probability model:** implements the exact frozen operator and measurement specification without reporting delta as identified.

The classical order model is intentionally capable of representing an order effect without assigning a quantum mechanism. The comparison asks about predictive adequacy and constraint, not whether one model can fit an in-sample pattern that it was designed to express.

Primary model-comparison metric: held-out log loss. Secondary metrics: Brier score and calibration error. Use participant-grouped folds when multiple records belong to one participant. Fold assignments and random seeds must be committed before fitting.

## 9. Multiplicity

One question pair must be named primary before outcome access. If the dataset contains multiple pairs, all are reported. The primary pair uses the prespecified alpha level of 0.05. Secondary pairwise order-effect tests use Holm correction within the declared family. QQ diagnostics and model comparisons are reported separately and cannot replace a failed primary test.

If no principled primary pair can be chosen without inspecting results, treat all pairs as one confirmatory family and apply Holm correction to all primary order-effect tests.

## 10. Falsification and decision rules

| Result | Permitted conclusion |
|---|---|
| Primary order contrasts are not distinguishable from zero with narrow intervals excluding the minimum meaningful effect | The targeted dataset does not support a meaningful order effect under this protocol. |
| Primary contrasts are uncertain because intervals are wide | The result is inconclusive; absence of significance is not evidence of equivalence. |
| A corrected primary contrast is nonzero | An order effect is detected in this dataset. |
| QQ expression is consistent with zero | The QQ constraint is not rejected; this does not uniquely select a quantum explanation. |
| Quantum model predicts held-out data better | Predictive support for that frozen specification, subject to replication; not evidence of quantum neural processes. |
| Classical model performs similarly or better | No predictive advantage for the quantum specification on this dataset. |

A minimum meaningful order effect must be justified and inserted before outcome access. Equivalence claims require a prespecified equivalence margin and an appropriate equivalence test.

## 11. Negative controls and robustness checks

Before real-outcome analysis, the pipeline must pass:

- simulated data with exactly zero order effect;
- simulated data with a known nonzero order effect;
- permuted order labels;
- a classical carryover generator;
- missing and malformed records matching the anticipated schema;
- repeated execution from a clean environment with identical derived results.

Sensitivity analyses include weighted versus unweighted estimates where applicable, documented alternative missingness handling, cluster-robust inference where warranted, and leave-one-question-pair-out model comparison. These analyses remain secondary.

## 12. Reproducibility and provenance

Before execution, commit:

- this completed protocol;
- the dataset card and source-data digest;
- the transformation script;
- analysis code and tests;
- environment lockfile;
- seed and fold-assignment files;
- an artifact manifest using a named digest algorithm.

After execution, publish unedited machine-readable outputs, an exclusion audit, derived tables, environment information, and a deviation log. A cryptographic or on-chain timestamp can support artifact integrity and ordering, but cannot certify scientific validity or rule out undisclosed prior analyses.

## 13. Deviations and amendments

Every change after the first outcome-bearing file becomes accessible must be recorded with:

- timestamp;
- files and analyses affected;
- reason;
- whether outcomes were known;
- classification as correction, necessary adaptation, sensitivity analysis, or exploratory analysis.

Confirmatory results are always reported under the frozen protocol. Amended or exploratory results appear separately; they do not replace an unfavorable confirmatory result.

## 14. Stop conditions

Stop and do not issue a confirmatory verdict if:

- dataset authenticity or permission cannot be established;
- order assignment or response coding cannot be reconstructed;
- participant-level dependence cannot be determined and changes the valid test;
- required cells are absent;
- the analysis code fails its synthetic controls;
- protocol choices were made after viewing outcome direction without being labeled exploratory.

## 15. Required independent review questions

1. Does the corrected structural argument justify testing only the sharp order-effect contrast while forbidding delta estimation?
2. Does the source dataset permit the primary estimands and QQ-cell reconstruction defined here?
3. Are the classical alternatives strong enough to prevent a nonzero order effect from being mislabeled uniquely quantum?
4. Are sampling design, weights, clustering, and multiplicity handled correctly?
5. What result would the reviewer regard as a decisive failure of the proposed quantum-probability specification?

## 16. Execution status

**Blocked pending data and documentation.** This draft must not be marked frozen or preregistered while any required dataset-card field, sampling-design choice, primary question pair, omnibus test, or minimum meaningful effect remains `UNKNOWN`.

Once those fields are resolved, increment the version, record the commit digest, and obtain a review of the executable protocol before accessing the outcome-bearing data.
