# Quantum Policy Tic-Tac-Toe — protocol draft

**Status:** design draft only  
**Version:** 0.1  
**Scope of release 1:** implementation-only. No payoff comparison, no advantage
claim, no behavioural claim.  
**Data collection:** still prohibited. Independent review is done and questions
1, 2, 3 and 6 are settled, but **4 and 5 remain open** — the hardware backend is
unpinned and the participant control scheme is unchosen. Neither can be decided
after the fact without deciding it from the data. Collection unblocks when both
are frozen and a v1.0 is committed.

## Why this document exists

This protocol describes a possible quantum game built from Tic-Tac-Toe
strategies. It is separate from the Phase 0 human decision lab. Phase 0 contains
no quantum mechanism, and none of its archived observations may be relabeled as
quantum-game data.

The first objective is modest and testable: implement player strategies as
unitary quantum operations while preserving a precisely defined classical
limit. **Release 1 is implementation-only** (question 2, resolved). It claims a
correct construction and nothing about payoffs, advantage, or human behaviour.

A later experiment may test for a quantum strategic advantage, but only after
the classical comparison set and the relevant payoff bound have been fixed in
advance. Note what such a test could and could not reach: a *nonclassical
correlation* bound is unavailable in this design at any point, because the
protocol has no Bell/CHSH structure. Adding one is a redesign, not a follow-up.

## Claim boundary

Successful implementation would establish that:

1. the strategy-selection protocol uses a valid quantum state, unitary player
   operations, an entangling referee operation, and Born-rule measurement;
2. classical pure and mixed strategies occur as an explicitly identified
   subset of the protocol, with the four classical corners recovered exactly at
   every gamma, not only at gamma = 0; and
3. the same circuit can be executed by an exact state-vector simulator and,
   after validation, by compatible quantum hardware.

It would **not** by itself establish:

- that a human brain is a quantum computer;
- that quantum cognition explains ordinary Tic-Tac-Toe choices;
- computational quantum advantage;
- a payoff advantage over every classical correlated strategy; or
- that ordinary Tic-Tac-Toe is no longer solved.

**Release 1 claims items 1 to 3 and nothing further.** The three claims above are
the whole of it: a correct construction, an exact classical limit, and the same
circuit running in simulation and on hardware. No payoff is compared, so no
advantage is claimed, so the non-claims below are not hedges against a result
this release could produce — they are the boundary of what it is even asking.

The non-zero-sum payoff makes a quantum advantage *possible* to ask about later;
it does not make one true, and release 1 does not ask. Two limits are known in
advance and must be reported alongside any future positive result. First, the `(Q, Q)` equilibrium exists only
inside the restricted two-parameter strategy family; under full SU(2) it does
not survive (Benjamin & Hayden, reproduced in `python-bridge/ewl_game.py`'s
`best_response_over_su2`). Second, the referee measures a fixed basis once, so
the resulting distribution over four policy pairs is reproducible by a classical
device holding shared randomness — this protocol contains no Bell or CHSH
structure and therefore cannot certify nonclassicality.

## Game layers

### Layer 1: ordinary board execution

The board follows ordinary Tic-Tac-Toe rules. X moves first, players alternate,
only empty squares are legal, and the first three-in-a-row wins. A draw is a
full board without a winner. Utilities are `+1` for an X win, `0` for a draw,
and `-1` for an O win.

Each player has two deterministic, total policies. A policy maps every reachable
nonterminal board on that player's turn to exactly one legal square. Both players
draw from the same two policies, and the four policy-pair outcomes form a fixed
2 by 2 **bimatrix** — a payoff pair `(a_ij, b_ij)` per cell, not one matrix read
in two directions.

**The payoff is deliberately not zero-sum.** An earlier version set `O receives
-A`. Under that structure no quantum advantage is reachable even in principle:
in a two-player zero-sum game every correlated equilibrium has value equal to
the minimax value, and entanglement acts here as a correlating device, so there
is no value to raise. Verified by grid search over the Eisert-Wilkens-Lewenstein
family — the quantum-minus-classical delta was never positive at any gamma, for
any matrix tried, and was strongly negative for two of them. Zero-sum also has
no Pareto-improvable cell by construction, so the phenomenon EWL exists to
exhibit cannot occur in it.

The payoff is therefore the zero-sum board result **plus a non-zero-sum cost of
engagement**, which is what creates a dilemma for the quantum layer to act on:

```text
payoff(i, j) = g(i, j)  -  c * [i = D]  -  d * [i = D and j = D]
```

where `g` is the seat-symmetrised board result, `c` is the unilateral cost of
engaging and `d` the additional surcharge when both players engage. The
policies, `g`, `c`, `d`, and the resulting bimatrix are fixed in the companion
document `frozen-policy-payoff-spec.md`, which is normative and must be read as
part of this protocol.

The policies and their complete move mappings must be frozen before inspecting
the quantum payoff surface. They must be chosen for an interpretable reason,
not searched for a matrix that makes the quantum treatment look favorable.

That freeze has now happened. The two policies are `positional` (policy C, the
cooperative action: plays a fixed square order and never reacts to the opponent)
and `heuristic` (policy D, the defecting action: takes a win, else blocks, else
forks, else falls back to the same fixed order). They differ in exactly one
respect — whether the player engages with threats — which is precisely what the
cost term prices. Full algorithms, every tie-break, the seat-symmetrisation rule,
the measured per-seat results, and the frozen values of `c` and `d` are in
`frozen-policy-payoff-spec.md`.

Note on reading: “cooperate” here means *disengaged*, not *nice*, and “defect”
means *engaged*, not *hostile*. The dilemma is about the cost of contesting. No
moral reading is intended or supported.

### Layer 2: quantum strategy selection

The referee owns two qubits, initialized to

```text
|00>
```

The first qubit selects X's policy and the second selects O's policy. Measurement
result `ij` executes X policy `i` against O policy `j` on the ordinary board.

The referee applies the entangler

```text
J(gamma) = exp(i * gamma/2 * D tensor D),   D = U(pi, 0) = [[0, 1], [-1, 0]]
```

where `0 <= gamma <= pi/2`. The generator `D` is the `theta = pi` member of the
strategy family below, and it has to be. The entangler must be generated by the
same operator as the flip strategy so that `J` commutes with `D tensor I` and
`I tensor D`; that commutation is exactly what embeds the classical game at every
gamma. An earlier version of this document generated `J` from `sigma_x` while its
`theta = pi` strategy was `i * sigma_y`. That breaks the embedding: verified by
exact state-vector computation, at `gamma = pi/2` the asymmetric classical
profiles inverted completely — choosing X policy 0 against O policy 1 executed X
policy 1 against O policy 0 with probability 1 — and at `gamma = pi/4` they
became a fair coin.

Each player then applies one local strategy operation from the two-parameter
Eisert-Wilkens-Lewenstein family

```text
U(theta, phi) =
  [ exp(i phi) cos(theta/2),       sin(theta/2) ]
  [       -sin(theta/2),     exp(-i phi) cos(theta/2) ]
```

with `0 <= theta <= pi` and `0 <= phi <= pi/2`. X applies `U_X` to qubit 0 and O
applies `U_O` to qubit 1. The referee applies `J(gamma)` dagger and measures both
qubits in the computational basis.

The final state is therefore

```text
|psi_f> = J(gamma) dagger * (U_X tensor U_O) * J(gamma) * |00>
```

and outcome probability is

```text
p_ij = |<ij|psi_f>|^2.
```

Expected payoffs are

```text
E_X = sum over i,j of p_ij * a_ij
E_O = sum over i,j of p_ij * b_ij
```

where `(a_ij, b_ij)` is the bimatrix cell for profile `ij`. `E_O` is **not**
`-E_X`; see Layer 1 for why that structure was abandoned.

At `gamma = 0`, the entangler is the identity. The two measurement bits then
reduce to independent classical randomization controlled by `theta_X` and
`theta_O`; phase cannot change the measurement probabilities.

The settings `theta = 0` and `theta = pi` embed the two classical pure policies,
up to an irrelevant global phase. With `J` generated by `D`, that embedding holds
at **every** gamma in `[0, pi/2]`, not only at `gamma = 0`. This is the defining
property of the Eisert-Wilkens-Lewenstein construction and the most important
regression test in this document: all four classical corners must return their
own policy pair with probability 1 at every gamma on a dense grid, to 1e-12.

A corner test performed only at `gamma = 0` is worthless for this purpose,
because `gamma = 0` is precisely where a wrong entangler generator is invisible.

## What the human does

The research interface must not tell a participant that a particular setting
is intelligent, optimal, or “more quantum.” It initially presents two controls:

- **blend** controls `theta`, changing the balance between the two policies;
- **phase** controls `phi`, changing interference when entanglement is enabled.

The participant submits one operation without seeing the opponent's operation.
The circuit is measured once to select the policy pair, and the resulting
ordinary Tic-Tac-Toe game is animated move by move. A separate explanation mode
may show estimated outcome probabilities from many shots, but those explanatory
shots must not be mixed with single-play research records.

## Experimental comparisons

The first implementation has three visibly distinct modes:

1. **Classical:** `gamma = 0`; phase has no effect.
2. **Quantum simulation:** `gamma > 0`; exact state-vector probabilities and
   seeded measurement sampling.
3. **Quantum hardware:** the identical transpiled circuit executed on a named
   backend, with provider job ID, calibration timestamp, shot count, and raw
   counts retained.

No interface may label a result “quantum advantage” merely because the quantum
mode beats one hand-picked classical opponent. Before such a label is permitted,
the protocol must define the strongest allowed classical comparator, including
whether shared correlated randomness is allowed, and preregister a bound that
the quantum observations must exceed with a stated uncertainty procedure.

## Required validation before human use

1. Verify `U(theta, phi)` and `J(gamma)` are unitary throughout their domains.
2. Verify all four classical pure-strategy corners produce their corresponding
   policy pairs with probability one at every `gamma` on a dense grid over
   `[0, pi/2]`, to 1e-12 — not at `gamma = 0` alone.
3. Verify phase has no observable effect at `gamma = 0`.
4. Verify probabilities are nonnegative and sum to one.
5. Compare the implementation against an independent matrix calculation for a
   dense, fixed grid of parameter values.
6. Calculate the complete payoff surface and best responses before exposing the
   arena to participants.
7. State whether a pure or mixed Nash equilibrium exists within the restricted
   strategy family and document the numerical tolerance used.
8. On hardware, report raw results and readout-mitigation results separately.
9. Never pool simulator and hardware observations without preserving backend
   provenance.
10. Keep all Quantum Arena records in a new schema and archive; do not append
    them to the Phase 0 decision-lab dataset.

## Questions that must be resolved before version 1.0

1. ~~What are the two exact deterministic policies?~~ **Resolved** — frozen in
   `frozen-policy-payoff-spec.md` (`positional` / `heuristic`, with `c = d = 1/3`,
   giving a strict Prisoner's Dilemma affinely equivalent to the canonical EWL
   matrix `(5, 3, 1, 0)`).
2. ~~Implementation-only, or a preregistered payoff bound?~~ **Resolved —
   implementation-only.** The first release claims a correct EWL-form
   implementation and nothing else: a valid quantum state, unitary player
   operations, an entangling referee operation, Born-rule measurement, an exact
   classical limit at every gamma, and the same circuit running on a simulator
   and on hardware. It makes **no** payoff comparison and **no** advantage claim.
3. ~~Does the classical comparison permit shared correlated randomness?~~ **Not
   applicable to this release.** There is no classical comparison in an
   implementation-only release, so there is nothing for a comparator to be
   strong or weak against. This question returns, unanswered and load-bearing,
   the moment a payoff comparison is proposed — and the answer should then be
   yes, since excluding correlated randomness would mean choosing a weakened
   opponent.
4. **Open.** Which quantum provider and backend will run the hardware circuit?
   Required before any hardware execution: the backend must be *pinned*, not
   selected by `least_busy`, or each run silently samples a different noise
   profile.
5. **Open.** Will participants choose continuous controls or a small
   preregistered menu of operations?
6. ~~What observations constitute learning?~~ **Not applicable to this release.**
   An implementation-only release makes no learning claim, so there is no
   learning measure to freeze. Returns with any behavioural claim.

## Independent-review request

An independent reviewer should try to falsify the design, with particular
attention to:

- whether the claimed classical limit is exact;
- whether the strategy restriction manufactures an apparent advantage;
- whether a classical correlated device reproduces every reported distribution;
- whether the payoff matrix was selected after inspecting quantum results;
- whether the human controls correspond to the stated unitary operations;
- whether hardware noise could be mistaken for strategic variation; and
- whether any proposed conclusion exceeds the claim boundary above.

Until those issues are resolved, this file is an architecture draft—not a
preregistration, a research result, or evidence of quantum cognition.
