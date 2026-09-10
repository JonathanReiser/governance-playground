# Quantum Policy Tic-Tac-Toe — strategy-space stress-test proposal

**Status:** draft protocol; inspection and implementation are permitted; data collection and
advantage claims are not.  
**Version:** 0.1 proposal, 2026-09-09.  
**Baseline:** `quantum-policy-tic-tac-toe.protocol-v1.md` and
`frozen-policy-payoff-spec.md`, unchanged.

## Purpose

Release 1 demonstrates a correct Eisert–Wilkens–Lewenstein (EWL) construction. This proposal
asks the next, narrower question:

> At what enlargement of the players' available strategy space does the apparent `(Q,Q)`
> equilibrium of the frozen four-operation menu acquire a profitable unilateral deviation?

The intended product is a **boundary map**, including negative results. It is not a search for
a favorable setting. The EWL paper motivates the restricted quantum game, while Benjamin and
Hayden show why the deterministic full-`SU(2)` strategy space is a load-bearing test rather
than an optional robustness check:

- [Eisert, Wilkens and Lewenstein, “Quantum Games and Quantum Strategies”](https://doi.org/10.1103/PhysRevLett.83.3077)
- [Benjamin and Hayden, “Comment on ‘Quantum Games and Quantum Strategies’”](https://arxiv.org/abs/quant-ph/0003036)

This protocol does not test quantum cognition, computational speedup, or Bell nonlocality. The
v1 referee has one fixed preparation and measurement arrangement; any output distribution over
`CC`, `CD`, `DC`, and `DD` can be reproduced by a classical shared-randomness sampler.

## Relationship to frozen v1

The following remain normative and unchanged through operation-space stages A0–A5:

- the ordinary tic-tac-toe rules;
- the deterministic `C` and `D` downstream policies;
- the payoff bimatrix `(T,R,P,S) = (2/3, 0, -2/3, -1)`;
- `J(gamma) = exp(i gamma D tensor D / 2)`, where `D = U(pi,0) = i sigma_y`;
- basis order `[CC, CD, DC, DD]`; and
- the exact simulator as the source for equilibrium and exploitability calculations.

The v1 files and records are never edited or relabelled. Every stress-test result uses a new
schema and names the stage that generated it. A change to a policy, payoff, entangler, basis,
or action space is a new protocol version, not a parameter tweak.

## Current-tree audit

This proposal records the repository state without rewriting the frozen document:

| Issue | Finding | Treatment here |
|---|---|---|
| v1 collection status | The header permits release-1 collection, but the final paragraph says collection is not licensed and refers to already-closed gates. | Treat this as frozen historical inconsistency. This draft grants no collection authority. A separate v1 errata note may clarify status without altering the frozen text. |
| preregistration status | v1 says no run was preregistered. The tree now contains a completed **hardware-validation** preregistration and result. | State precisely that hardware validation was preregistered; no behavioral, payoff-advantage, or strategy-space study has been preregistered. |
| validation item 5 | `validation.py` independently reconstructs the entangler with `scipy.linalg.expm`, but does not independently reconstruct the entire final state and probability pipeline. | Require cross-implementation probability parity over every frozen test cell and adversarial bit-order cases. |
| “complete payoff surface” | Item 6 evaluates the 4-by-4 menu at only `gamma = 0, pi/4, pi/2`. | Call it the “menu payoff table at three gamma values.” Reserve “complete surface” for a declared continuous domain and a reproducible search/certificate. |
| equilibrium scope | Item 7 correctly reports pure equilibria only within the four-operation menu; continuous EWL and full `SU(2)` are not searched. | Report menu, continuous-EWL, full-`SU(2)`, and mixed-`SU(2)` results in separate fields. Never promote one scope to another. |
| hardware provenance | The sealed result retains raw counts, backend, job IDs, shot counts, and no-mitigation labels, but its cells do not contain the promised calibration timestamp, `backend_requested`, or `backend_pinned`. | Do not alter the immutable result. Any new hardware schema must retain a calibration snapshot/time (or explicitly state unavailable), requested and actual backend, transpiler seed/version, physical-qubit layout, and job ID. |

## Two expansion axes

Quantum-operation expansion and downstream-policy expansion answer different questions and must
not be changed in the same experimental stage.

### Axis A — player operation space, frozen downstream game

All A stages use the v1 policies and payoff matrix.

1. **A0: classical pure.** `{C,D}`.
2. **A1: frozen menu.** `{C,D,M,Q}`. Reproduce the v1 table; no new claim.
3. **A2: fixed dense EWL grid.** `theta = i*pi/32` for `i=0..32` and
   `phi = j*pi/32` for `j=0..16` (561 operations). Enumerate exactly.
4. **A3: continuous EWL family.** `0 <= theta <= pi`, `0 <= phi <= pi/2`.
5. **A4: deterministic full local `SU(2)`.** Use

   ```text
   V(alpha,beta,delta) =
     [ exp(i alpha) cos(beta/2),        exp(i delta) sin(beta/2) ]
     [ -exp(-i delta) sin(beta/2), exp(-i alpha) cos(beta/2) ]
   ```

   with `0 <= beta <= pi` and `-pi <= alpha,delta < pi`. The EWL family is the
   `delta = 0`, `alpha = phi`, `beta = theta` slice.
6. **A5: mixed distributions over full `SU(2)`.** Use a double-oracle procedure whose
   finite support, weights, best-response calls, convergence trace, seed, and stopping reason
   are retained. Failure to converge is reported as unresolved, never as equilibrium.

The initial stress test fixes `gamma = pi/2`, because that is where v1 reports `(Q,Q)` within
the four-option menu. A later gamma sweep is a separate registered stage with the fixed grid
`gamma = k*pi/64`, `k=0..32`.

### Axis B — downstream policy space, operation space held fixed

Axis B begins only after A0–A5 are reported. Each B stage declares which A-stage operation
space it uses and compares against an identical classical information and compute budget.

1. **B0:** frozen deterministic v1 policies.
2. **B1:** deterministic parameterized policies.
3. **B2:** seeded stochastic policies.
4. **B3:** context- and history-dependent policies with a frozen memory update.
5. **B4:** learning policies with opponent modelling, frozen training budget, checkpoints,
   evaluation seeds, and held-out episodes.
6. **B5:** coalitions and multiplayer policies under a separately specified quantum referee.

No B-stage result may be described as a property of quantum operation space alone.

## Payoff, deviation, and exploitability

For operation profile `(s_X,s_O)` and the frozen v1 payoff table, expected utilities are
computed from exact Born probabilities. Define unilateral exploitability as

```text
gain_X = sup over s'_X [U_X(s'_X,s_O) - U_X(s_X,s_O)]
gain_O = sup over s'_O [U_O(s_X,s'_O) - U_O(s_X,s_O)]
epsilon = max(0, gain_X, gain_O).
```

The candidate is an equilibrium only in the explicitly named strategy space when
`epsilon <= 1e-8` and the search has the required certificate for that stage. An explicit
deviation improving payoff by more than `1e-8` is sufficient to break the candidate; finding
a counterexample does not require proving the global optimum.

Finite stages A0–A2 are exhaustive. Continuous stages use all of the following, fixed before
results are viewed:

- a scrambled Sobol design of `65,536` points per player's unilateral search;
- local bounded optimization from the best `64` points;
- an independently seeded differential-evolution search;
- exact reevaluation of every alleged best response; and
- storage of parameters, payoff gain, optimizer status, evaluation count, tolerances, and seed.

Agreement between optimizers is evidence of search stability, not a proof of a global maximum.
An equilibrium claim in A3–A5 additionally needs either an analytic result or a certified upper
bound on every unsearched region. A profitable witness needs neither.

## Failure criteria, fixed before execution

A stage is marked **broken** when any one of these occurs:

1. a unilateral deviation improves exact expected payoff by more than `1e-8`;
2. `(Q,Q)` is not an equilibrium in that stage's declared strategy space;
3. a shared-randomness classical mechanism reproduces the tested distribution at zero exact
   total-variation distance (expected for this fixed-measurement design, and reported rather
   than hidden);
4. the finding changes under a preregistered payoff perturbation of at most `0.01` in any cell;
5. an adaptive downstream policy makes the operation layer irrelevant, defined as an absolute
   mean payoff effect below `0.01` across the registered evaluation seeds;
6. simulator and hardware disagree beyond a separately preregistered device-level threshold;
7. an unregistered optimizer, reward, policy, stopping rule, or exclusion is introduced after
   results are visible.

Items 4–6 belong to later registered stages. They must not be retroactively applied to A0–A5.

## Strongest classical comparators

“Classical” is not one weak baseline. Every report includes three distinct comparisons:

1. **Exact distributional simulator.** A shared classical draw samples the exact four-outcome
   Born distribution and hands the corresponding policy labels to the executor. This matches
   the fixed-referee outcome distribution exactly. Therefore v1 cannot support a nonclassical-
   correlation claim.
2. **Classical correlated-equilibrium program.** Optimize a probability distribution over the
   same downstream action profiles subject to Aumann obedience inequalities, reporting each
   player's optimum and social-welfare optimum. The definition and constraints follow the
   correlation-device formulation of [Aumann's correlated equilibrium](https://doi.org/10.2307/1911154).
3. **Resource-matched adaptive classical agent.** In Axis B, give the classical comparator the
   same observations, memory, policy class, training episodes, random-seed budget, and inference
   budget as the quantum-conditioned agent. Shared correlated randomness is allowed.

Also report the unconstrained classical joint-distribution payoff ceiling. It is not called an
equilibrium, but it prevents a strategically unconstrained correlating device from being omitted
when an “advantage” number is quoted.

## Minimal governance/adventure environment for Axis B

The first environment is deliberately small and non-generative so that decisions can be replayed
exactly. Narrative text is rendered after state transitions and never enters the policy input.

- **Locations:** Harbor, Clinic, Farm, Depot, Council Hall.
- **Factions:** Commons, Wardens, Brokers.
- **Characters:** six persistent agents, two per faction. Two are focal decision-makers; four
  follow frozen background policies.
- **Resources:** integer food, medicine, transport, and security stocks in `[0,20]`.
- **Social state:** directed trust matrix in `[-1,1]`, reputation in `[-1,1]`, faction loyalty,
  a promise ledger, and timestamped observations with reliability in `[0,1]`.
- **Horizon:** 12 simultaneous-decision rounds. At round 6 a registered supply disruption removes
  a seed-determined resource shipment; effects of promises and shortages may be delayed by up to
  two rounds.
- **Actions:** move, investigate, share, trade, guard, bargain, withhold, and take. Every action's
  preconditions and deterministic transition are table-driven.

A parameterized policy scores each legal action using frozen features:

```text
score(a) = w_survival*survival(a) + w_trust*trust(a)
         + w_resources*resources(a) + w_loyalty*loyalty(a)
         - w_risk*risk(a) + w_reciprocity*reciprocity(a).
```

B1 takes the highest score with square/action-index tie-breaking. B2 samples a softmax with a
registered temperature. Later stages add memory or learning one at a time. Quantum output may
initialize or correlate the two focal agents' dispositions at a declared turning point; it may
not secretly choose ordinary actions. Every disposition-to-parameter mapping is frozen before a
run and compared with a shared-randomness initialization using the identical mapping.

## Evidence separation and records

Exact-simulator strategy analysis is primary. Hardware is a device-reproduction check and cannot
turn a non-equilibrium into an equilibrium.

- `quantum-arena-strategy-search/v0.1`: exact probabilities, stage, strategy domain, candidate,
  deviations, exploitability, algorithm, seed, tolerances, and stopping reason.
- `quantum-arena-hardware-check/v0.2`: registration hash, circuit hash, raw counts, mitigation as
  a separate view, backend requested/actual/pinned, job ID, shots, transpiler/version/seed, layout,
  calibration snapshot timestamp and hash (or explicit unavailability), and exact target.
- `quantum-arena-policy-episode/v0.1`: environment version and hash, state before, operations,
  backend class, measured result, policy parameters, ordinary RNG seed, actions, state transition,
  and delayed effects.

Simulator, hardware, explanation, human, and policy-episode records remain in separate archives.
Aggregations may join them only by explicit identifiers while preserving provenance.

## Smallest falsifying implementation milestone

Do not build the adventure environment first. The smallest useful milestone is **A4-one-sided**:

1. implement the three-parameter `SU(2)` operation independently of v1's two-parameter helper;
2. validate determinant 1 and unitarity over adversarial and random points;
3. reproduce the v1 EWL slice and the Python/Node bit order;
4. hold O at `Q`, `gamma = pi/2`, and the frozen payoff matrix;
5. search X's full `SU(2)` domain and emit the first explicit deviation with gain `> 1e-8`;
6. mirror the test for O and save both witnesses under the new schema.

Because one profitable unilateral deviation is enough to disprove equilibrium in the enlarged
space, this milestone can falsify the restricted-menu result without continuous-policy agents,
human data, hardware time, or a global optimizer certificate. Benjamin and Hayden make this a
replication of a known boundary, not an exploratory claim of a new quantum advantage.

## Preregistration gates

Before any stage is called an experiment, freeze and hash:

- stage and strategy domain;
- candidate profile and gamma grid;
- payoff/environment version;
- search algorithm, seeds, tolerances, budget, stopping rule, and certificate requirement;
- classical comparators and information/resource budgets;
- primary outcome and failure criteria;
- simulator or pinned hardware status and provenance schema; and
- complete reporting rule, including failed optimizers and every registered cell.

Until those fields are registered before results are generated, outputs are engineering tests.
This proposal itself is not a preregistration and is not a licence to collect human data.
