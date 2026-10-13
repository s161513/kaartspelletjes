"""Train the P(scum) model for the Presidenten help (Lab 8, option B).

Pipeline (see README.md):

    simulate.ts --dataset  ->  assist/out/rounds.csv      one row per player per round
    train.py (this file)   ->  assist/out/rounds.sqlite   the data model (table `rounds`)
                           ->  assist/out/*.png           evaluation plots
                           ->  assist/model.ts            the trained model, used in TypeScript

What the model does: for one player, just before a round is played, predict
the probability that they finish that round in last place (role "scum") from
their context: long-term history, the current session, the time of day and the
strength of the hand they start with. The browser turns that probability into a
help level (0 / 1 / 2) with two thresholds T1 and T2, which are also chosen
here.

Why logistic regression:
  - its output is a probability, so the thresholds have a meaning ("help when
    the chance of ending last is above x") and calibration can be checked;
  - it is linear in the (standardised) features, so every prediction can be
    explained as a sum of per-feature contributions — the UI shows those as
    the reasons for the help;
  - inference is a dot product and a sigmoid: a few lines of TypeScript, so the
    model runs locally in the browser and no data ever leaves the player's
    machine.
A small decision tree is trained next to it as a sanity check: if a non-linear
model did much better, the linear one would be missing structure.

Run from the repository root:
    games/presidenten/assist/ml/.venv/bin/python games/presidenten/assist/ml/train.py
"""

from __future__ import annotations

import csv
import math
import sqlite3
from datetime import date
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # no display needed: plots are written to PNG files
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from sklearn.calibration import calibration_curve  # noqa: E402
from sklearn.linear_model import LogisticRegression  # noqa: E402
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score, roc_curve  # noqa: E402
from sklearn.pipeline import make_pipeline  # noqa: E402
from sklearn.preprocessing import StandardScaler  # noqa: E402
from sklearn.tree import DecisionTreeClassifier  # noqa: E402

ASSIST = Path(__file__).resolve().parent.parent
OUT = ASSIST / "out"
CSV_PATH = OUT / "rounds.csv"
DB_PATH = OUT / "rounds.sqlite"
MODEL_TS = ASSIST / "model.ts"

# Must match FEATURE_NAMES in features.ts (score.ts refuses a model.ts whose
# FEATURES differ, and a test checks it too).
FEATURES = [
    "winrate_20",
    "scum_count_20",
    "loss_streak",
    "rounds_in_session",
    "session_minutes",
    "hour_sin",
    "hour_cos",
    "hand_strength",
]

# Thresholds = these percentiles of the predicted P(scum) on the test set:
# about 30% of rounds get some help (level >= 1), 10% the full explanation.
PERCENTILES = (70, 90)
TEST_SHARE = 0.2
SEED = 42

# Colours (dataviz reference palette): blue = the model, orange = the tree,
# grey = references. Text stays in ink colours.
BLUE, ORANGE, GREY, INK, INK2, GRID, SURFACE = (
    "#2a78d6", "#eb6834", "#898781", "#0b0b0b", "#52514e", "#e1e0d9", "#fcfcfb",
)

# The handoff's data model. One deviation: scum_count_20 is REAL, not INTEGER,
# because a newcomer's missing rounds (and helped rounds) count as a fraction
# (0.25 each, see context.ts), so the count is not always a whole number.
SCHEMA = """
CREATE TABLE rounds (
  round_id INTEGER PRIMARY KEY,
  player_id INTEGER,
  session_id TEXT,
  played_at TEXT,
  winrate_20 REAL,
  scum_count_20 REAL,
  loss_streak INTEGER,
  rounds_in_session INTEGER,
  session_minutes INTEGER,
  hour_of_day INTEGER,
  hand_strength INTEGER,
  p_scum REAL,
  help_level INTEGER,
  final_role TEXT,
  became_scum INTEGER
);
"""


# ---------------------------------------------------------------------------
# 1. Load the CSV and store it in SQLite
# ---------------------------------------------------------------------------

def load_csv() -> list[dict]:
    if not CSV_PATH.exists():
        raise SystemExit(f"{CSV_PATH} not found: run `npx tsx games/presidenten/assist/simulate.ts --dataset` first")
    with CSV_PATH.open(newline="") as f:
        rows = list(csv.DictReader(f))
    missing = [c for c in FEATURES if c not in rows[0]]
    if missing:
        raise SystemExit(f"CSV lacks feature columns {missing}: FEATURES out of sync with features.ts")
    return rows


def check_hour_encoding(rows: list[dict]) -> None:
    """The CSV's hour_sin/hour_cos come from encode() in features.ts; recompute
    them here from hour_of_day to prove both languages encode the hour alike."""
    for r in rows[:5000]:
        angle = 2 * math.pi * int(r["hour_of_day"]) / 24
        assert abs(math.sin(angle) - float(r["hour_sin"])) < 1e-4, r
        assert abs(math.cos(angle) - float(r["hour_cos"])) < 1e-4, r


def write_sqlite(rows: list[dict]) -> sqlite3.Connection:
    """The data model of the assignment: one row per player per round. The
    file is rebuilt from scratch on every run, so it always matches the CSV.
    p_scum is filled in after training (see fill_predictions)."""
    DB_PATH.unlink(missing_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.executescript(SCHEMA)
    db.executemany(
        """INSERT INTO rounds VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)""",
        [
            (
                int(r["round_id"]), int(r["player_id"]), r["session_id"], r["played_at"],
                float(r["winrate_20"]), float(r["scum_count_20"]), int(r["loss_streak"]),
                int(r["rounds_in_session"]), int(r["session_minutes"]), int(r["hour_of_day"]),
                # 13-card hands at four players, so a whole number here
                round(float(r["hand_strength"])), int(r["help_level"]), r["final_role"],
                int(r["became_scum"]),
            )
            for r in rows
        ],
    )
    db.commit()
    return db


def describe(db: sqlite3.Connection) -> None:
    """A few SQL queries on the data model, for the report: does the scum share
    actually move with the context? (These are raw shares, not the model.)"""
    print("\nScum share by context (SQL on rounds.sqlite):")
    queries = {
        "time of day": """
            SELECT CASE WHEN hour_of_day >= 23 OR hour_of_day < 5 THEN '23:00-05:00'
                        WHEN hour_of_day >= 18 THEN '18:00-23:00' ELSE '05:00-18:00' END AS k,
                   COUNT(*), AVG(became_scum) FROM rounds GROUP BY k ORDER BY k""",
        "session length": """
            SELECT CASE WHEN session_minutes < 45 THEN 'a  < 45 min'
                        WHEN session_minutes < 120 THEN 'b  45-120 min' ELSE 'c  >= 120 min' END AS k,
                   COUNT(*), AVG(became_scum) FROM rounds GROUP BY k ORDER BY k""",
        # Scum share is zero-sum per table (always 1 in 4), so the clock can
        # only matter relatively. Fresh players (short session, no tilt) at
        # night face tired opponents and end last *less* often:
        "fresh players": """
            SELECT CASE WHEN hour_of_day >= 23 OR hour_of_day < 5 THEN 'b  night 23-05'
                        ELSE 'a  day 05-23' END AS k,
                   COUNT(*), AVG(became_scum) FROM rounds
            WHERE session_minutes < 45 AND loss_streak < 3 GROUP BY k ORDER BY k""",
        "loss streak": """
            SELECT CASE WHEN loss_streak < 3 THEN 'a  0-2' WHEN loss_streak < 6 THEN 'b  3-5'
                        ELSE 'c  6+' END AS k,
                   COUNT(*), AVG(became_scum) FROM rounds GROUP BY k ORDER BY k""",
    }
    for name, sql in queries.items():
        cells = "  ".join(f"{k.split('  ')[-1]}: {share:.3f} (n={n})" for k, n, share in db.execute(sql))
        print(f"  {name:15s} {cells}")


# ---------------------------------------------------------------------------
# 2. Train / test split by player
# ---------------------------------------------------------------------------

def split_by_player(rows: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    """Rows of the same player are strongly correlated (same skill, overlapping
    history windows). A random row split would put a player's neighbouring
    rounds in both sets and flatter the test score. Instead we hold out whole
    players (20%), picked per profile so the test set has the same mix of
    weak/average/strong players. The test score therefore answers: how well
    does the model do for players it has never seen?"""
    rng = np.random.default_rng(SEED)
    test_players: set[str] = set()
    profiles = sorted({r["profile"] for r in rows})
    for prof in profiles:
        players = sorted({r["player_id"] for r in rows if r["profile"] == prof}, key=int)
        k = max(1, round(TEST_SHARE * len(players)))
        test_players.update(rng.choice(players, size=k, replace=False))
    is_test = np.array([r["player_id"] in test_players for r in rows])
    return np.where(~is_test)[0], np.where(is_test)[0]


# ---------------------------------------------------------------------------
# 3. Ablation: what does each context layer add?
# ---------------------------------------------------------------------------

# Nested feature sets, one context layer at a time (same split, same model).
LAYERS = [
    ("history (long term)", ["winrate_20", "scum_count_20"]),
    ("+ session", ["loss_streak", "rounds_in_session", "session_minutes"]),
    ("+ time of day", ["hour_sin", "hour_cos"]),
    ("+ hand (game state)", ["hand_strength"]),
]


def ablation(X, y, train, test) -> list[tuple[str, float]]:
    """Test AUC when the model may only use the first k context layers. Shows
    which kinds of context actually carry information about ending last."""
    results, used = [], []
    for name, feats in LAYERS:
        used += feats
        cols = [FEATURES.index(f) for f in used]
        m = make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000))
        m.fit(X[train][:, cols], y[train])
        results.append((name, float(roc_auc_score(y[test], m.predict_proba(X[test][:, cols])[:, 1]))))
    return results


def interaction_experiment(X, y, train, test) -> tuple[float, float]:
    """Could the hour matter *relative to the player's level*? (Hypothesis:
    tired weak players fall behind at night.) Add hour × win-rate terms and
    compare the test AUC. They are NOT part of the final model: when the AUC
    does not improve, the simpler model wins."""
    wr = X[:, FEATURES.index("winrate_20")]
    extra = np.column_stack([X[:, FEATURES.index("hour_sin")] * wr, X[:, FEATURES.index("hour_cos")] * wr])
    X2 = np.column_stack([X, extra])
    aucs = []
    for data in (X, X2):
        m = make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000))
        m.fit(data[train], y[train])
        aucs.append(float(roc_auc_score(y[test], m.predict_proba(data[test])[:, 1])))
    return aucs[0], aucs[1]


# ---------------------------------------------------------------------------
# 4. Plots
# ---------------------------------------------------------------------------

def style(ax, title: str, xlabel: str, ylabel: str) -> None:
    ax.set_facecolor(SURFACE)
    ax.set_title(title, loc="left", fontsize=13, fontweight="bold", color=INK)
    ax.set_xlabel(xlabel, color=INK2)
    ax.set_ylabel(ylabel, color=INK2)
    ax.grid(color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color("#c3c2b7")
    ax.tick_params(colors=INK2)


def save(fig, name: str) -> None:
    fig.patch.set_facecolor(SURFACE)
    fig.tight_layout()
    fig.savefig(OUT / name, dpi=150)
    plt.close(fig)


def plot_roc(y, p_lr, p_tree, auc_lr, auc_tree) -> None:
    fig, ax = plt.subplots(figsize=(6, 5.2))
    for p, colour, label in ((p_lr, BLUE, f"Logistic regression (AUC {auc_lr:.3f})"),
                             (p_tree, ORANGE, f"Decision tree, depth 4 (AUC {auc_tree:.3f})")):
        fpr, tpr, _ = roc_curve(y, p)
        ax.plot(fpr, tpr, color=colour, linewidth=2, label=label)
    ax.plot([0, 1], [0, 1], color=GREY, linewidth=1, linestyle="--", label="Chance (AUC 0.5)")
    style(ax, "ROC on held-out players", "False positive rate", "True positive rate")
    ax.legend(frameon=False, loc="lower right")
    save(fig, "roc.png")


def plot_calibration(y, p_lr, base_rate) -> None:
    """Calibration: when the model says 40%, do 40% of those rounds end in
    Scum? Points on the diagonal = trustworthy probabilities (important,
    because the thresholds and the badge show P itself)."""
    frac, mean_pred = calibration_curve(y, p_lr, n_bins=10, strategy="quantile")
    fig, ax = plt.subplots(figsize=(6, 5.2))
    top = max(frac.max(), mean_pred.max()) * 1.1
    ax.plot([0, top], [0, top], color=GREY, linewidth=1, linestyle="--", label="Perfectly calibrated")
    ax.axhline(base_rate, color=GREY, linewidth=1, linestyle=":", label=f"Base rate {base_rate:.2f}")
    ax.plot(mean_pred, frac, color=BLUE, linewidth=2, marker="o", markersize=7, label="Logistic regression")
    style(ax, "Calibration (10 equal-size bins)", "Predicted P(scum)", "Observed share Scum")
    ax.set_xlim(0, top)
    ax.set_ylim(0, top)
    ax.legend(frameon=False, loc="upper left")
    save(fig, "calibration.png")


def plot_coefficients(coef) -> None:
    """Standardised coefficients: the change in log-odds for one standard
    deviation more of the feature. Positive (orange) = more likely Scum."""
    order = np.argsort(coef)
    fig, ax = plt.subplots(figsize=(7, 4.6))
    colours = [ORANGE if c > 0 else BLUE for c in coef[order]]
    ax.barh([FEATURES[i] for i in order], coef[order], color=colours, height=0.6)
    for y, c in enumerate(coef[order]):
        ax.text(c + (0.02 if c >= 0 else -0.02), y, f"{c:+.2f}", va="center",
                ha="left" if c >= 0 else "right", fontsize=10, color=INK)
    ax.axvline(0, color="#c3c2b7", linewidth=1)
    style(ax, "What pushes P(scum) up (orange) or down (blue)",
          "Coefficient (log-odds per standard deviation)", "")
    lim = np.abs(coef).max() * 1.35
    ax.set_xlim(-lim, lim)
    save(fig, "coefficients.png")


def plot_distribution(p, t1, t2) -> None:
    fig, ax = plt.subplots(figsize=(7, 4.4))
    ax.hist(p, bins=50, color=BLUE, edgecolor=SURFACE, linewidth=0.5)
    for t, name in ((t1, "T1 · highlight"), (t2, "T2 · + explanation")):
        ax.axvline(t, color=INK, linewidth=1.5, linestyle="--")
        ax.text(t, ax.get_ylim()[1] * 0.95, f" {name}\n {t:.2f}", va="top", fontsize=10, color=INK)
    style(ax, "Predicted P(scum) on held-out players", "P(scum)", "Rounds")
    save(fig, "p_distribution.png")


# ---------------------------------------------------------------------------
# 5. Write model.ts
# ---------------------------------------------------------------------------

def ts_list(values) -> str:
    # Full float precision (repr), so TypeScript reproduces sklearn's P exactly.
    return "[" + ", ".join(repr(float(v)) for v in values) + "]"


# Raw-context fields of a CSV row, as RawContext in features.ts expects them.
RAW_FIELDS = ["winrate_20", "scum_count_20", "loss_streak", "rounds_in_session",
              "session_minutes", "hour_of_day", "hand_strength"]


def encode(raw: dict) -> list[float]:
    """Python twin of encode() in features.ts (raw context -> model input)."""
    angle = 2 * math.pi * raw["hour_of_day"] / 24
    x = dict(raw, hour_sin=math.sin(angle), hour_cos=math.cos(angle))
    return [x[f] for f in FEATURES]


def golden_cases(model, rows, test, p_test, k=5) -> list[dict]:
    """A few test rows (spread over the P range) with sklearn's prediction, so
    a TypeScript test can check that score.ts computes the very same P. P is
    recomputed from the raw values (the CSV rounds sin/cos to 5 decimals)."""
    order = np.argsort(p_test)
    picks = [order[int(q * (len(order) - 1))] for q in np.linspace(0, 1, k)]
    cases = []
    for i in picks:
        r = rows[test[i]]
        raw = {f: float(r[f]) for f in RAW_FIELDS}
        p = float(model.predict_proba(np.array([encode(raw)]))[0, 1])
        cases.append({"raw": dict(raw, table_size=4), "p": p})
    return cases


def write_model_ts(mean, scale, coef, intercept, thresholds, base_rate, metrics, n, players, golden) -> None:
    features = ", ".join(f'"{f}"' for f in FEATURES)
    golden_ts = "\n".join(
        "  { raw: { " + ", ".join(f"{k}: {repr(v)}" for k, v in g["raw"].items()) + f" }}, p: {repr(g['p'])} }},"
        for g in golden)
    metrics_ts = ", ".join(f"{k}: {v:.4f}" if isinstance(v, float) else f"{k}: {v}" for k, v in metrics.items())
    MODEL_TS.write_text(f"""// GENERATED by ml/train.py — do not edit by hand; re-run the training instead.
//
// Logistic regression for P(scum): the chance that a player finishes the next
// round in last place, from their context (features.ts). score.ts evaluates
//   P = sigmoid(INTERCEPT + Σ COEF[i] · (x[i] − MEAN[i]) / SCALE[i])
// MEAN/SCALE are the StandardScaler's, COEF are per standard deviation.
// THRESHOLDS = the {PERCENTILES[0]}th and {PERCENTILES[1]}th percentile of P on the test set
// (help level 1 from T1, level 2 from T2). BASE_RATE = share of Scum rounds in
// the training data; score.ts shifts P to 1/n for a table of n. With the
// context switched off everyone gets that base rate, which is below T1: no help.
// Trained on SIMULATED games with deliberately injected effects (simulate.ts).

export const FEATURES = [{features}] as const;
export const MEAN = {ts_list(mean)} as const;
export const SCALE = {ts_list(scale)} as const;
export const COEF = {ts_list(coef)} as const;
export const INTERCEPT = {repr(float(intercept))};
export const THRESHOLDS = [{thresholds[0]:.4f}, {thresholds[1]:.4f}] as const;
export const BASE_RATE = {base_rate:.4f};
export const METRICS = {{ {metrics_ts} }} as const;
export const TRAINED_ON = {{ n: {n}, players: {players}, date: "{date.today().isoformat()}", source: "simulated" }} as const;
/** Test rows with sklearn's predict_proba: score.ts must reproduce these (assist.test.ts). */
export const GOLDEN = [
{golden_ts}
] as const;
""")


def fill_predictions(db: sqlite3.Connection, ids, p) -> None:
    """Store the trained model's prediction for every round in the data model."""
    db.executemany("UPDATE rounds SET p_scum = ? WHERE round_id = ?",
                   [(float(pi), int(i)) for i, pi in zip(ids, p)])
    db.commit()


# ---------------------------------------------------------------------------

def main() -> None:
    rows = load_csv()
    check_hour_encoding(rows)
    db = write_sqlite(rows)
    print(f"{len(rows)} rows from {CSV_PATH.name} -> {DB_PATH.name}")
    describe(db)

    # Only rounds played WITHOUT help. With help on, a weak player's good
    # results would partly be the hints' doing; training on that would teach
    # the model that such players need less help (the feedback loop).
    # On the current simulated data this filter removes nothing (simulate.ts
    # generates everything without help); it is a safeguard for when real,
    # logged rounds — some with help — are ever used for training.
    total = len(rows)
    rows = [r for r in rows if r["help_level"] == "0"]
    print(f"\nhelp_level = 0 filter: kept {len(rows)} of {total} rows")
    X = np.array([[float(r[f]) for f in FEATURES] for r in rows])
    y = np.array([int(r["became_scum"]) for r in rows])
    ids = np.array([int(r["round_id"]) for r in rows])

    train, test = split_by_player(rows)
    n_train_players = len({rows[i]["player_id"] for i in train})
    n_test_players = len({rows[i]["player_id"] for i in test})
    print(f"\nTrain: {len(train)} rows ({n_train_players} players) · "
          f"test: {len(test)} rows ({n_test_players} held-out players)")

    # Standardise, then fit. Standardising matters twice: the default L2
    # penalty treats all coefficients alike (fair only if features share a
    # scale), and standardised coefficients can be compared with each other.
    model = make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000))
    model.fit(X[train], y[train])
    p_test = model.predict_proba(X[test])[:, 1]

    # Comparison: a shallow decision tree on the raw features.
    tree = DecisionTreeClassifier(max_depth=4, min_samples_leaf=50, random_state=SEED)
    tree.fit(X[train], y[train])
    p_tree = tree.predict_proba(X[test])[:, 1]

    base_rate = float(y[train].mean())
    metrics = {
        "auc": float(roc_auc_score(y[test], p_test)),
        "brier": float(brier_score_loss(y[test], p_test)),
        # Brier of always predicting the base rate: the bar to beat.
        "brier_base": float(brier_score_loss(y[test], np.full(len(test), base_rate))),
        "log_loss": float(log_loss(y[test], p_test)),
        "tree_auc": float(roc_auc_score(y[test], p_tree)),
        "tree_brier": float(brier_score_loss(y[test], p_tree)),
        "test_n": int(len(test)),
    }
    t1, t2 = (float(np.percentile(p_test, q)) for q in PERCENTILES)

    scaler: StandardScaler = model.named_steps["standardscaler"]
    logreg: LogisticRegression = model.named_steps["logisticregression"]
    coef = logreg.coef_[0]

    print(f"\nBase rate (train): {base_rate:.4f}")
    print(f"Logistic regression: AUC {metrics['auc']:.4f} · Brier {metrics['brier']:.4f}"
          f" (base-rate Brier {metrics['brier_base']:.4f}) · log loss {metrics['log_loss']:.4f}")
    print(f"Decision tree (d=4): AUC {metrics['tree_auc']:.4f} · Brier {metrics['tree_brier']:.4f}")
    print(f"Thresholds: T1 = P{PERCENTILES[0]} = {t1:.4f} · T2 = P{PERCENTILES[1]} = {t2:.4f}")
    print("\nStandardised coefficients (log-odds per SD; + = more likely Scum):")
    for f, c, m, s in sorted(zip(FEATURES, coef, scaler.mean_, scaler.scale_), key=lambda t: -abs(t[1])):
        print(f"  {f:18s} {c:+.4f}   (mean {m:8.3f}, sd {s:7.3f}, odds ×{math.exp(c):.2f} per SD)")
    print(f"  {'intercept':18s} {logreg.intercept_[0]:+.4f}")

    print("\nAblation (test AUC, adding one context layer at a time):")
    for name, auc in ablation(X, y, train, test):
        print(f"  {name:22s} {auc:.4f}")
    plain, inter = interaction_experiment(X, y, train, test)
    print(f"Hour × win-rate interaction terms (not used): AUC {plain:.4f} → {inter:.4f}")

    plot_roc(y[test], p_test, p_tree, metrics["auc"], metrics["tree_auc"])
    plot_calibration(y[test], p_test, base_rate)
    plot_coefficients(coef)
    plot_distribution(p_test, t1, t2)

    fill_predictions(db, ids, model.predict_proba(X)[:, 1])
    db.close()

    write_model_ts(scaler.mean_, scaler.scale_, coef, float(logreg.intercept_[0]), (t1, t2),
                   base_rate, metrics, len(train), n_train_players, golden_cases(model, rows, test, p_test))
    print(f"\nWrote {MODEL_TS.relative_to(ASSIST.parent.parent.parent)}, {DB_PATH.name} (p_scum filled) and "
          "roc.png, calibration.png, coefficients.png, p_distribution.png in assist/out/")


if __name__ == "__main__":
    main()
