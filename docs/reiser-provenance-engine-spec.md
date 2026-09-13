# Reiser Provenance Engine (RPE)

## Evidence-Qualified Technical and Theoretical Specification

**Author:** Jonathan Reiser  
**Version:** 0.1 — Research specification  
**Status:** Pre-validation; not a clinical product specification  
**Ethos:** “I test ideas before I trust them.”

## 1. Purpose

The Reiser Provenance Engine is a proposed research architecture for testing context-sensitive behavioral hypotheses under reproducible, preregistered conditions. It combines off-chain analysis with cryptographic commitments that can establish when specified artifacts existed and whether later artifacts match those commitments.

RPE does not presently establish clinical efficacy, diagnose mental-health conditions, or prove that its proposed behavioral measures generalize across populations. Blockchain records provide integrity and timing evidence; they do not establish the truth, validity, completeness, or ethical acceptability of an experiment.

## 2. Evidence-status vocabulary

Every scientific claim in the project must carry one of these labels:

| Status | Meaning |
|---|---|
| Hypothesis | Proposed relationship not yet supported by a completed preregistered test. |
| Preliminary result | Observed in exploratory or internally analyzed data; subject to undiscovered confounding or analytic flexibility. |
| Replicated result | Reproduced using a frozen protocol and independent data, implementation, or research team. |
| Validated application | Demonstrated to meet a predefined performance and safety target in the intended population and use context. |
| Refuted or withdrawn | Evidence or audit invalidated the claim; the historical record and reason remain visible. |

No application may silently promote a claim from one category to another.

## 3. Current claim registry

### 3.1 Sequential contrast / order effect

**Status: Hypothesis pending reproducible evaluation.**

The hypothesis is that evaluation at time \(t\) may depend partly on the immediately preceding stimulus or state:

\[
Y_t = f(S_t, S_{t-1}, X_t) + \varepsilon_t,
\]

where \(X_t\) contains measured covariates and the exact estimand must be specified before analysis. This expression is a conceptual model, not proof of causal identification.

Required before claiming support:

1. Identify a lawful, public or properly licensed dataset and record its immutable version.
2. Define the unit of analysis, treatment or contrast, outcome, exclusion rules, and temporal ordering.
3. State the identification assumptions and test whether the proposed effect is distinguishable from time trends, selection, carryover, participant heterogeneity, and model misspecification.
4. Freeze code, environment, seed policy, primary estimand, and acceptance criteria before examining confirmatory outcomes.
5. Report effect sizes, uncertainty intervals, missingness, robustness specifications, negative controls, and all preregistered analyses.
6. Obtain independent review or replication.

### 3.2 Interaction or crowd coupling

**Status: Hypothesis.**

The proposed construct concerns increased statistical dependence among participants when factual grounding is weak. Pearson correlation alone is not an operational definition of mimicry, harmful synchronization, or an echo chamber. Correlation can arise from shared stimuli, timing, platform mechanics, sampling, or common external events.

A valid study must define nodes, observations, windows, lag structure, minimum sample sizes, missing-data treatment, multiple-comparison control, and a falsifiable prediction about an independently introduced factual anchor. Language such as “instant decoupling” must not be used without direct, replicated temporal evidence.

## 4. Reproducible research workflow

Each experiment should produce the following bundle:

- `protocol.md`: research question, hypotheses, estimands, exclusions, stopping rule, and acceptance criteria.
- `config.json`: canonical parameters, dataset identifiers, software versions, seeds, and model specifications.
- `manifest.json`: cryptographic digests for every committed artifact.
- `analysis/`: version-controlled source code.
- `environment.lock`: reproducible dependency specification.
- `results/`: unedited machine outputs plus derived tables and figures.
- `report.md`: interpretation, limitations, deviations, and claim-status decision.

Canonicalization rules must be fixed before hashing. The manifest must specify the digest algorithm, encoding, line-ending policy, and canonical serialization procedure.

## 5. Provenance architecture

### 5.1 What the ledger can demonstrate

The ledger can provide evidence that a commitment was registered no later than a block timestamp, that a later disclosure matches that commitment, and that a particular address performed the registration. It cannot prove authorship, data quality, methodological validity, prospective intent predating off-chain analysis, or that omitted analyses do not exist.

### 5.2 Two-stage commit and reveal

RPE should separate preregistration from result disclosure:

1. **Commit:** register a fixed-size digest of the canonical protocol/configuration manifest before execution.
2. **Run:** execute the frozen analysis off-chain.
3. **Reveal:** register the result-manifest digest and sample size while referencing the earlier commitment.
4. **Verify:** independent software recomputes both digests and checks artifact availability.
5. **Review:** qualified reviewers record attestations separately; the researcher cannot self-declare scientific validity.

The contract should use `bytes32` digests rather than unrestricted strings. Artifact location, encryption, retention, and access belong off-chain. Contract roles must distinguish submitters from reviewers, and attestations must identify the review standard used. Amendments should create linked records rather than overwrite history.

Gas costs are variable. The architecture must measure current costs and support batching or periodic Merkle-root anchoring instead of promising a fixed per-record fee.

## 6. Data protection

No raw text, biometric data, clinical information, stable user identifier, or directly linkable metadata should be written to a public blockchain. Hashing does not anonymize predictable or low-entropy data.

Before processing behavioral-health data, the project requires:

- data minimization and a documented lawful basis or informed consent;
- threat modeling and re-identification analysis;
- encryption and controlled off-chain storage;
- key-management, retention, deletion, and incident-response policies;
- separation between research identity and public-chain addresses;
- ethics and regulatory review appropriate to the actual study and jurisdiction.

Where public anchoring is justified, prefer salted commitments or Merkle roots over per-person records. Salt and keys must remain off-chain.

## 7. Digital-therapeutics boundary

The proposed therapeutic layer is future work. Until prospectively validated, RPE outputs must be described as experimental research signals—not diagnoses, risk scores, treatment recommendations, or evidence of cognitive distortion.

Any future intervention study requires clinician and lived-experience input, predefined safety escalation, subgroup performance analysis, false-positive and false-negative evaluation, accessibility testing, informed consent, human override, and appropriate institutional and regulatory review. Crisis detection must never depend solely on sequential vector distance or group correlation.

Behavioral signals must not automatically determine charitable eligibility, relief payments, insurance, employment, housing, policing, or access to care.

## 8. Minimum validation program

### Phase A — Reproduce the order-effect analysis

- Select and document the dataset.
- Freeze a machine-readable protocol.
- Implement the corrected identifiability analysis.
- Test simulated null and known-effect data before real outcomes.
- Run negative controls and sensitivity analyses.
- Publish complete outputs and deviations.

### Phase B — Independent audit

- Provide reviewers with the protocol, code, data-access instructions, and manifests.
- Require reproduction from a clean environment.
- Record disagreements and failed checks without deleting prior versions.
- Update the claim registry based on predefined criteria.

### Phase C — Test crowd-coupling measures

- Operationalize the construct without clinical labels.
- Compare correlation with lagged, network, and shared-cause models.
- Predefine what evidence would falsify the hypothesis.
- Replicate across independent communities before discussing generalization.

### Phase D — Evaluate provenance infrastructure

- Test commit/reveal ordering and duplicate prevention.
- Test canonicalization and digest verification across environments.
- Model key loss, malicious submissions, unavailable artifacts, chain reorganization, and storage failure.
- Benchmark costs under realistic batching assumptions.

### Phase E — Consider clinical research

Proceed only after earlier phases support a specific, bounded use case. Create a separate clinical protocol and safety case rather than treating research-platform validation as therapeutic validation.

## 9. Immediate deliverables

1. A versioned claim registry.
2. A dataset card for the proposed order-effect dataset.
3. A preregistration protocol with explicit identifiability assumptions.
4. Simulation-based tests for null, confounded, and recoverable effects.
5. A commit/reveal contract specification and test suite.
6. A privacy threat model.
7. An independent-review packet.

## 10. Reviewer request

> This is an evidence-qualified technical proposal, not a statement of validated clinical findings. Please review the mathematical assumptions, supporting evidence, falsification criteria, privacy and safety boundaries, and proposed provenance architecture. In particular, identify claims that exceed the available results and tests required before changing their evidence status.

## 11. Versioning principle

Retractions, corrections, null findings, and failed replications are part of the evidence record. New versions must explain what changed and why. The project’s credibility should rest on transparent correction and reproducibility, not on immutability rhetoric or the apparent certainty of an automated analysis.
