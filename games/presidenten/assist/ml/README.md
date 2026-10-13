# P(scum) model for the Presidenten help

The adaptive help (`assist/`) decides per player and per round how much help
to give: 0 = none, 1 = the best move highlighted, 2 = highlighted plus a
one-line explanation. It bases that on **P(scum)**, the predicted chance that
the player finishes this round in last place. A **logistic regression** trained
on simulated games makes that prediction. This folder holds the training code.
*Which* move gets highlighted is decided by a rule-based advisor
(`advisor.ts`), not by the model.

```
simulate.ts --dataset ──► assist/out/rounds.csv     one row per player per round (TS, real game logic)
ml/train.py           ──► assist/out/rounds.sqlite  data model, table `rounds` (p_scum filled in)
                      ──► assist/out/*.png          ROC, calibration, coefficients, P distribution
                      ──► assist/model.ts           GENERATED, committed: scaler, coefficients, T1/T2,
                                                    metrics, golden test cases
browser / simulation:  context.ts → features.ts → model.ts → score.ts (predict, levelFor) → panel.ts
```

Inference runs in TypeScript (a dot product and a sigmoid), so the browser
needs no Python and no server call. Python is only used for training and
evaluation.

## Running it

From the repository root:

```bash
# once: Python environment
python3 -m venv games/presidenten/assist/ml/.venv
games/presidenten/assist/ml/.venv/bin/pip install -r games/presidenten/assist/ml/requirements.txt

# 1. training data (~24k rows, about 40 s)
npx tsx games/presidenten/assist/simulate.ts --dataset

# 2. train, evaluate and write assist/model.ts (a few seconds)
games/presidenten/assist/ml/.venv/bin/python games/presidenten/assist/ml/train.py

# 3. demos
npx tsx games/presidenten/assist/simulate.ts --ab           # same hand, different context
npx tsx games/presidenten/assist/simulate.ts --sensitivity  # one context variable at a time
npx tsx games/presidenten/assist/simulate.ts                # learner: help fades as it improves (out/help.svg)
npx tsx games/presidenten/assist/simulate.ts --weak         # weak players with/without help (out/weak-players.svg, ~1 min)

# 4. check
npm test
```

Live demo: `npm run dev`, then open a game with `?assistDemo=weak` or
`?assistDemo=strong` in the URL. Both start from a fixed fake history and get
a different badge and different highlights for the same game.

- The badge under your own name shows `P(scum) 0.62`. Only you see it.
- The Help section of the settings menu shows your P, the threshold where
  help starts, and the **top 3 factors that push your P up**.
- The browser console logs the full calculation for every round.
- A watcher who is not seated gets no prediction.

The game deals new hands with a secure RNG, and the 20% test players are
only 9 people, so every dataset/training run comes out a little different
(T1 has ranged from 0.28 to 0.35 between runs). All numbers below come from
**one run**.

## Features

`features.ts` computes every feature from the player's own history of
*finished* rounds plus the hand they hold when play starts (after the
exchange). Nothing comes from the round being predicted. `extractFeatures`
ignores any history record that ends after "now", and a test appends round
n's outcome (President or Scum) to the history and checks that the features
at the start of round n do not change. `FEATURE_NAMES` in `features.ts` is
the single list of features. It sets the CSV columns, `FEATURES` in
`train.py` and `FEATURES` in the generated `model.ts`. A test and a runtime
check fail if they differ.

| feature | layer | meaning |
|---|---|---|
| `winrate_20` | long term | share of won rounds in the last 20, smoothed with 3 "average" prior rounds (prior 1/4 = one winner at a table of four) |
| `scum_count_20` | long term | last-place finishes in the last 20 rounds; a missing round (newcomer) counts as 0.25 |
| `loss_streak` | session | rounds in a row **without a win**, within the current session. A win is a finish in the winners' tier (President / Vice-President / Winner). At a table of four only the President wins, so this really means "rounds since I was last President", and a streak of 3+ is normal even for an average player (0.75³ ≈ 42%) |
| `rounds_in_session` | session | rounds already finished in this session (a session ends after a 30-minute break) |
| `session_minutes` | session | minutes since the **end** of the session's first round (the history only stores when rounds finish). The simulation and the browser compute it the same way |
| `hour_sin`, `hour_cos` | environment | hour of day on a circle: 23:00 is next to 00:00, and a linear model can place one bump anywhere in the day without a hand-picked "late" cut-off |
| `hand_strength` | game state | 2 = 3 points (wild, highest), A = 2, K = 1, summed over the hand after the exchange and **scaled to a 13-card hand** (× 13 / cards; an empty hand counts as average, 6). In the exchange the President asks the Scum for a rank (usually a strong one) and gives back a card of their choice, so last round's Scum often starts weaker |

**Helped rounds** (any round played with help, won or lost) count only half,
for both long-term features. For the win rate they get half the weight
against the prior. In the Scum count a helped round counts as
0.5 · actual + 0.5 · 0.25. Help that improves your results therefore does not
switch itself off right away (the dependency loop).

**Mid-hand (re)load.** The level is decided once, when play starts. If the
page is loaded while a hand is already under way (cards on the pile or a
trick already taken), the hand is no longer the starting hand, so the
prediction assumes an average hand instead.

Label: `became_scum` = 1 if the round ended with role `scum` (last place).

### Table size

The model is trained on tables of four only. The game allows three or more
players, so `score.ts` corrects for other sizes:

- `hand_strength` is scaled to a 13-card hand (see above).
- The **shown** P is shifted on the log-odds scale to the table's base rate:
  `P_n = sigmoid(z + logit(1/n) − logit(BASE_RATE))`. With 3 players an
  average player shows about 1/3, with 6 about 1/6.
- The **level** is still decided on the model's own four-player P. T1/T2 were
  chosen at four players, and an average player at a 3-player table would
  otherwise get help just for sitting there (1/3 > T1). The level answers
  "how much more at risk than average?" at every size. The thresholds shown
  in the UI are shifted the same way, so "P vs threshold" stays consistent.

### Context off

With the context switch off (`computeHelp(..., { useContext: false })`),
everyone gets the table's base rate (1/4 at four players). That is below T1,
so everyone gets level 0: no help.

## Training (train.py)

- **Only rows with `help_level = 0`.** With help on, the model would learn
  that helped players do fine and give them less help (the feedback loop).
  *On the current simulated data this filter removes nothing.* The
  simulation already plays without help. The filter is a safeguard for when
  real logged rounds, some of them with help, are used for training.
- **Split by player**, not by row: 20% of the players are held out, stratified
  by profile (weak/average/strong). Rows of one player are strongly
  correlated, so a row split would flatter the test score.
- `StandardScaler` + `LogisticRegression(max_iter=1000)`. A
  `DecisionTreeClassifier(max_depth=4)` runs next to it as a check for
  non-linear structure.
- **Thresholds**: T1 = 70th and T2 = 90th percentile of the predicted P on the
  test set. About 30% of rounds get some help and 10% get the explanation.
- **Golden cases**: `train.py` writes 5 test rows with sklearn's prediction
  into `model.ts` (`GOLDEN`). A test checks that `score.ts` reproduces them
  within 1e-5.
- SQLite follows the handoff schema with one deviation: `scum_count_20` is
  `REAL`, because prior-filled and helped rounds make it fractional.

## Results (one run: 24,144 rows, 48 players; trained on 19,592 rows from 39 players)

| | value |
|---|---|
| ROC-AUC, 9 held-out players (4,552 rows) | **0.758** (decision tree d=4: 0.746) |
| Brier score | 0.164 (always predicting the base rate: 0.197) |
| log loss | 0.497 |
| base rate (training set) | 0.246 |
| thresholds (model scale) | T1 = 0.351, T2 = 0.532 (shown at four players: 0.36 / 0.54) |

Standardised coefficients (log-odds per standard deviation; + = more likely Scum):

| feature | coef |
|---|---|
| winrate_20 | −0.47 |
| scum_count_20 | +0.38 |
| loss_streak | +0.25 |
| hand_strength | −0.23 |
| hour_sin / hour_cos | −0.05 / −0.01 |
| rounds_in_session / session_minutes | +0.05 / +0.04 |

Ablation (test AUC as context layers are added): history 0.736 → + session
0.751 → + time of day 0.751 → + hand 0.758. Adding hour × win-rate
interaction terms changes the AUC from 0.7578 to 0.7576, so they are not used.

The decision tree is no better than the linear model, and the calibration
curve lies close to the diagonal.

Demos in this run:

- **A/B** (same hand, same table): weak history P = 0.75 (level 2), strong
  history 0.06 (level 0), new player 0.21 (level 0), context off 0.25 (level 0).
- **Learner** (gets better over 300 rounds; one run): help in 7% → 1% → 0% of
  rounds over the three thirds; win rate 36% with help vs. 29% without.
- **`--weak`**: a very weak (random) player wins 8% → 15% with help.

### What the data says about time and session (an honest note)

The simulation *injects* effects (see `simulate.ts`). Players blunder more
late at night, after about 45 minutes in a session, and on a losing streak,
and weak players suffer most. What the model makes of them:

1. **The hour pushes P slightly *down* at night, for everyone.** In this run
   the "weaker player" of the sensitivity demo goes from 0.30 at 15:00 to
   0.27 at 02:00. In an earlier run that was enough to drop a borderline
   player from level 1 to level 0 at midnight. So the system can give *less*
   help at night, the opposite of the intuition behind the injected effect.
   The reason: every round has exactly one Scum and everyone at the table
   shares the clock, so at 02:00 the Scum share is still exactly 0.250 (SQL
   output of `train.py`). The hour can only say something relative, and at
   night it mostly describes the **opponents**. Players fresh into a session
   at night end last less often (0.137 vs. 0.171 by day) because the others
   are deep into long sessions. Hour × win-rate interaction terms did not
   help (see above). This is a design and ethics point: a feature can look
   reasonable ("tired players need help") and still act the other way. The
   hour should arguably be dropped, or the model should get context about
   the opponents (which the privacy design rules out).
2. **The streak absorbs fatigue.** Longer sessions raise the Scum share
   (0.217 under 45 min, 0.329 over 120 min). But fatigue shows up as lost
   rounds first, so `loss_streak` already carries most of it. Session length
   adds a little on top (sensitivity, rounds and minutes together: 0.29 →
   0.36 over 3 hours for the weaker player). The session layer as a whole
   adds AUC (0.736 → 0.751).

So the help adapts mainly to long-term history, the current losing streak and
the hand.

## Files

- `train.py`: training and evaluation (commented step by step)
- `requirements.txt`: numpy, scikit-learn, matplotlib
- `reflectie.md`: draft reflection note (in Dutch): MCP, ethics, limitations
- `.venv/`: local Python environment (git-ignored)
- `../out/`: CSV, SQLite and plots (git-ignored, regenerate with the steps above)
- `../tracker.ts`: which finished round goes into the history (no fake round
  for a watcher who is dealt in, no double count after a reload), tested in
  `assist.test.ts`
