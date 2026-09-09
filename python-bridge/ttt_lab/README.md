# Tic-Tac-Toe Decision Lab — Phase 0

This package supplies the exact classical reference model for the human
decision lab at `?ttt=play`.

Phase 0 contains no quantum mechanism. It provides:

- immutable ordinary tic-tac-toe rules;
- all 5,478 states reachable by legal play;
- an exact minimax oracle;
- a classical softmax family over minimax action values;
- a separate discounted-outcome model for faster wins and slower losses;
- an interpretable feature policy (win, block, fork, center, corner); and
- exhaustive and adversarial regression tests.

## What “human error” means

There can be several perfect moves in one position. A human choice is classified
as suboptimal only when it falls outside the complete minimax-optimal set.
Decision regret is:

```
best available game-theoretic value - selected move's value
```

Values are `+1` (forced win), `0` (forced draw), and `-1` (forced loss), so
regret is 0, 1, or 2. Nonzero choices are labeled as a missed win that produces
a draw, a missed win that produces a loss, or a surrendered draw. In a position
that is already a forced loss, every move with value `-1` is equally optimal.

“Suboptimal” is strictly relative to the goal of maximizing the result against
perfect opposition. It is not a claim that the person is irrational, careless,
or cognitively deficient.

## Run the tests

From `python-bridge/`:

```bash
python -m pytest tests/ ttt_lab/tests/ -v
```

Outcome-class regret deliberately ignores how quickly a forced win is taken or
how long a forced loss is delayed. The discounted-outcome policy models those
preferences separately and is never described as outcome regret.

The browser lab now records both. `decision_regret` is the outcome-class regret
above and is unchanged, so every session recorded before this field existed stays
directly comparable. Alongside it, `tempo_regret` is the discounted-outcome gap at
`tempo_discount` (0.9), with `tempo_slower_within_outcome_class` true exactly when
a choice kept the outcome class but reached it more slowly. The two are reported
side by side and must never be summed: they answer different questions, and only
`decision_regret` carries the "human error" reading described above.

`policies/features.py` is wired into the browser lab as `heuristic_baseline`, a
**zero-parameter reference**. Its weights stay stipulated rather than fitted, and
that is the point: with nothing estimated it cannot overfit, its held-out score
equals its training score by construction, and it predicts out of sample from the
first move. It is the floor the fitted models must clear — seven fitted parameters
that cannot beat a textbook heuristic are not earning their place. Fitting these
weights remains a separate, preregisterable decision.

One convention differs between the two feature implementations, deliberately.
`features.py` evaluates forks on the position after the move, where a winning move
has already ended the game, so a winning move scores no fork. `contextFeatures` in
the JS scans empty squares without checking for termination, so a winning move
scores both. The difference is invisible to a fitted model, which just
redistributes weight between two co-occurring features, but not to the stipulated
baseline — so the baseline suppresses the fork on a winning move to match Python,
and `contextFeatures` is left alone because changing it would alter the fitted
context features and break comparability with sessions already recorded.

The JS implementation in `frontend/src/lib/ttt/game.js` mirrors
`policies/depth_aware.py`. A committed fixture of 120 positions
(`frontend/src/lib/ttt/__tests__/depth-aware-fixture.json`) pins the two together,
so the engines cannot drift apart silently. Regenerate it from this package if the
discount or the scoring rule ever changes. The feature
policy is a transparent comparison model, not a psychological claim: its five
weights must be fit and evaluated out of sample before drawing conclusions.

## Browser feedback-loop versions

Completed validation sessions retain their model version. Version 1 compares an
outcome softmax with a legacy amplitude formula, but the models did not receive
the same information and their scores are not a fair scientific comparison.
Version 2 gives the context and amplitude-constraint predictors the same six
board inputs: minimax value, immediate win, immediate block, fork creation,
center, and corner. Version 3 added an ordinary free-envelope control that nests
the amplitude constraint, but its estimator failed finite-sample synthetic
recovery. All v3 envelope scores are therefore quarantined and omitted from the
interface. Version 4 retains only the equally informed context and amplitude
predictors. Parameters are frozen before a six-game validation session; that
session's choices are never used to tune predictions scored within it, and
results from different versions are never pooled.

The quarantined positive free envelope is evaluated as
`b² + 2ρ√γ·b·r·cos(θ) + γr²`, with `γ > 0` and `-1 ≤ ρ ≤ 1`.
Because probabilities are normalized across legal moves, the coefficient on
`b²` is fixed without loss of generality. The amplitude constraint is the nested
case `γ = 1, ρ = 1`, so held-out performance can falsify any claimed benefit
from that constraint.

The original amplitude predictors reduce algebraically to real-valued positive
models. They are retained as versioned diagnostics, but must not be described as
evidence for quantum cognition. The free-envelope comparison must not be restored
unless a preregistered estimator passes realistic finite-sample synthetic
recovery. A future quantum-cognitive arm still needs genuinely non-commuting
context updates or multiple paths to a shared outcome.

## Durable local research storage

During local Vite development, every recorded move and completed session triggers
an atomic snapshot in `research-data/ttt-research-latest.json`. Each browser has a
monotonic writer sequence: delayed snapshots hard-fail instead of reporting a
false success. Accepted snapshots are merged by immutable record identity, so
new decisions recorded after clearing the browser append to the preserved file
instead of being discarded or deleting earlier records. The prior snapshot is
retained as `research-data/ttt-research-previous.json`, and the directory is
excluded from Git so participant data cannot be committed accidentally. Browser
storage remains the live working copy; the file archive is the recovery copy.
The setup screen can merge that archive back into browser storage without
duplicating existing events. Clearing the browser copy deliberately leaves the
recovery files intact. The manual **Export evidence** download remains available
as an additional backup.
