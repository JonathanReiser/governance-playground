# Frozen policy and payoff specification

**Replaces:** the placeholder text at `preregistrations/quantum-policy-tic-tac-toe.protocol-draft.md:53-57`
and the zero-sum stipulation at `:51-52`.

**Status when committed:** frozen. Nothing in this section may be revised after any
quantum payoff surface has been computed. Revising it requires a new protocol version
and voids any data collected under the previous one.

**Frozen on:** 2026-09-09, before any quantum circuit code exists.

---

## 1. Why the payoff is no longer zero-sum

The previous draft set `E_O = -E_X`. In a two-player zero-sum game every correlated
equilibrium has value equal to the minimax value, so no correlating device — entanglement
included — can raise it. Verified by grid search over the EWL family: the quantum-minus-
classical delta was never positive at any γ, for any matrix tried, and was strongly
negative for two. The advantage question was not merely unproven under that structure; it
was unreachable.

This specification replaces the zero-sum stipulation with an additively separable payoff:
the zero-sum game result plus a non-zero-sum cost of engagement. That is what creates a
dilemma for EWL to act on.

## 2. The two policies

Both players draw from the **same** two policies. Each is deterministic, total over every
reachable non-terminal position, and fully tie-broken. `lm` denotes the legal moves in
ascending square index, squares numbered 0–8 row-major.

```
POSITIONAL_ORDER = [4, 0, 2, 6, 8, 1, 3, 5, 7]     # centre, corners, edges
```

### Policy C — "positional" (the dove; the cooperative action)

```
positional(state):
    return the first square in POSITIONAL_ORDER that is in lm
```

Plays a fixed opening plan and never reacts to the opponent. It does not take an available
win and does not block a loss.

### Policy D — "heuristic" (the hawk; the defecting action)

```
heuristic(state):
    if any m in lm wins immediately for the mover:      return the lowest such m
    if any m in lm blocks an immediate opponent win:    return the lowest such m
    if any m in lm creates >= 2 winning threats (fork): return the lowest such m
    return the first square in POSITIONAL_ORDER that is in lm
```

Contests every threat. Note `heuristic` falls back to the identical positional order, so
the two policies differ **only** in whether they engage with threats. That is the entire
behavioural contrast, and it is what the cost term prices.

**Reading.** "Dove" means *disengaged*, not *nice*; "hawk" means *engaged*, not *hostile*.
The dilemma is about the cost of contesting, not about aggression being wrong. Protocol
prose must not import the moral reading.

## 3. Symmetrisation

Tic-tac-toe is asymmetric — X moves first. The protocol already alternates seats across six
games. The payoff mirrors that exactly:

```
g(A, B) = ( result_as_X(A, B)  -  result_as_X(B, A) ) / 2
```

where `result_as_X` returns +1 if the X seat wins, −1 if the O seat wins, 0 for a draw.
`g` is antisymmetric with `g(A,A) = 0` for every A.

**Structural consequence, and the reason this design is tractable:** for symmetric profiles
the symmetrised game payoff is exactly zero. So `R` and `P` are fixed purely by the cost
terms, and only `T` and `S` depend on the board at all. The whole construction reduces to a
single measured quantity, `w = g(D, C)`.

### Measured per-seat results (auditable)

```
C vs C   X-seat first: result = 0   moves = [4,0,2,6,8,1,3,5,7]
C vs D   X-seat first: result = -1  moves = [4,0,2,6,8,3]
D vs C   X-seat first: result = +1  moves = [4,0,2,6,3,8,5]
D vs D   X-seat first: result = 0   moves = [4,0,2,6,3,5,8,1,7]
```

Giving the symmetrised matrix:

```
g(C,C) = 0.00    g(C,D) = -1.00
g(D,C) = +1.00   g(D,D) = 0.00        =>   w = g(D,C) = 1
```

## 4. Cost of engagement

Two frozen constants, applied per player to their own payoff:

```
c = 1/3     unilateral cost of playing D
d = 1/3     additional surcharge when BOTH players play D (escalation)
```

```
payoff(i, j) = g(i, j)  -  c * [i = D]  -  d * [i = D and j = D]
```

`d` is structurally necessary, not decorative. With `c` alone the construction forces
`T − R = P − S`, which cannot reach the canonical Prisoner's Dilemma. The escalation term
removes that constraint, and is independently motivated: mutual conflict costing more than
two unilateral aggressions is the standard arms-race assumption.

## 5. The frozen payoff bimatrix

```
                 O plays C        O plays D
X plays C      ( 0   ,  0  )    ( -1   , 2/3 )
X plays D      ( 2/3 , -1  )    ( -2/3 ,-2/3 )
```

```
T = 2/3     (D against C)
R = 0       (C against C)
P = -2/3    (D against D)
S = -1      (C against D)
```

Strict Prisoner's Dilemma: `T > R > P > S` and `2R > T + S`.

## 6. Calibration to the canonical EWL matrix

Under the positive affine map `x -> 3x + 3`:

```
T = 2/3  -> 5      R = 0   -> 3
P = -2/3 -> 1      S = -1  -> 0
```

This is exactly the canonical EWL Prisoner's Dilemma `(5, 3, 1, 0)`. Nash equilibria and
EWL analysis are invariant under positive affine rescaling of each player's utility, so
every published EWL result transfers to this matrix directly rather than needing
rederivation.

**`c` and `d` were chosen to hit that 1999 literature benchmark, and for no other reason.**
They were fixed before any quantum payoff surface was computed. This rationale is the
preregistered justification; it is checkable against the commit order.

## 7. Independent verification

Cross-checked against this repository's own EWL module (`python-bridge/ewl_game.py`,
merged to `main` in PR #40), not against the arithmetic above:

```
is_prisoners_dilemma(ours)      -> True; symmetric; T>R>P>S; 2R > T+S
classical_nash(ours)            -> pure DD at (-2/3, -2/3), while CC pays (0, 0)
entanglement_threshold(ours)    -> 0.6847192024
entanglement_threshold(CANONICAL) -> 0.6847192028      agreement to 4e-10
```

The threshold is the γ at which `sin²γ = 2/5` — this repository's own sharper result,
confirmed to hold for this matrix.

## 8. Robustness

The finding is not knife-edge. Every `(c, d)` tested preserved a strict Prisoner's Dilemma:

```
c=1/2 d=0     (T,R,P,S) = ( 1/2, 0, -1/2, -1)   strict PD
c=1/3 d=1/3   (T,R,P,S) = ( 2/3, 0, -2/3, -1)   strict PD   <- frozen choice
c=1/4 d=1/4   (T,R,P,S) = ( 3/4, 0, -1/2, -1)   strict PD
c=2/3 d=0     (T,R,P,S) = ( 1/3, 0, -2/3, -1)   strict PD
```

Report the frozen result alongside this range. A conclusion that survives only at
`c = d = 1/3` should be treated as an artifact of the calibration.

## 9. Mandatory regression tests

1. Both policies are total and deterministic over every reachable non-terminal position.
2. Every tie-break resolves to the lowest legal index; assert on a position with ties.
3. `g` is antisymmetric and `g(A,A) = 0` for both policies.
4. The four per-seat results in §3 reproduce exactly, move sequence included.
5. `w = 1` exactly.
6. The bimatrix in §5 reproduces exactly under §4.
7. `is_prisoners_dilemma` returns True.
8. The affine map in §6 yields `(5, 3, 1, 0)` to 1e-12.
9. **The classical corners test from the protocol's validation list must be run over a γ
   grid, not at γ=0 alone** — see the separate review finding S1.1; at γ=0 it cannot detect
   the entangler-generator error.

## 10. What this specification does not establish

- It does not make the classical game non-solved. Tic-tac-toe remains a draw under perfect
  play; `C` and `D` are two chosen policies, not the whole strategy space.
- It does not license a quantum-advantage claim. `(Q,Q)` is a Nash equilibrium only within
  the restricted two-parameter EWL family; under full SU(2) it does not survive
  (Benjamin & Hayden, reproduced in `ewl_game.py:best_response_over_su2`). Reporting the
  restricted-family result without the SU(2) best-response alongside it is an overclaim.
- It does not certify nonclassicality. The referee measures a fixed basis once; the
  resulting distribution over four policy pairs is reproducible by a classical device
  holding shared randomness. Certifying nonclassicality needs a Bell/CHSH structure with
  free setting choice, which this protocol does not have.
- It says nothing about human cognition being quantum.

## 11. Reproduction

```bash
cd python-bridge && python3 dilemma.py       # policy matrix, w, bimatrix, calibration
```

Requires `ttt_lab.game` and `ttt_lab.policies.minimax`. Section 7's cross-check requires
`ewl_game.py`, which is on `main`, so the whole verification runs in one tree.
