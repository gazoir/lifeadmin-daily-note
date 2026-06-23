import re
import statistics as stats
from datetime import datetime
from pathlib import Path

text = Path(
    r"C:\Users\User\Documents\Obsidian\🏠 LifeAdmin\Z_Personal admin\Domestic God\🩺 Health\Weight_Data.md"
).read_text(encoding="utf-8")
lines = [l.strip() for l in text.splitlines() if re.match(r"^\d{4}-\d{2}-\d{2}", l.strip())]

entries = []
for line in lines:
    m = re.match(
        r"^(\d{4}-\d{2}-\d{2})\s*-\s*([\d.]+)\s*-\s*([\d.%-]+|[-])\s*(?:-\s*)?(.*)$",
        line,
        re.I,
    )
    if not m:
        print("SKIP", line)
        continue
    d, w, bf, src = m.groups()
    bf_val = None if bf in ("-", "") else float(bf.replace("%", ""))
    src = (src or "unknown").strip().lower()
    if "arboleaf" in src or src == "":
        device = "arboleaf"
    elif "inbody" in src:
        device = "inbody"
    elif "boditrax" in src:
        device = "boditrax"
    else:
        device = src
    entries.append(
        {
            "date": datetime.strptime(d, "%Y-%m-%d"),
            "w": float(w),
            "bf": bf_val,
            "device": device,
        }
    )

user_pair = {
    "date": datetime(2026, 6, 19),
    "arb": (79.95, 14.3),
    "gym": (80.0, 10.7),
    "device": "inbody",
}

gym = [e for e in entries if e["device"] in ("inbody", "boditrax") and e["bf"] is not None]
arb = [e for e in entries if e["device"] == "arboleaf" and e["bf"] is not None]

print("Gym readings:", len(gym))
for e in gym:
    print(" ", e["date"].date(), e["w"], e["bf"], e["device"])

pairs = []
for g in gym:
    best = None
    best_dt = None
    for a in arb:
        dt = abs((g["date"] - a["date"]).days)
        if best is None or dt < best_dt:
            best, best_dt = a, dt
    if best:
        pairs.append(
            {
                "gym_date": g["date"].date(),
                "arb_date": best["date"].date(),
                "days_apart": best_dt,
                "gym_w": g["w"],
                "arb_w": best["w"],
                "gym_bf": g["bf"],
                "arb_bf": best["bf"],
                "device": g["device"],
                "dw": g["w"] - best["w"],
                "dbf": g["bf"] - best["bf"],
            }
        )

pairs.append(
    {
        "gym_date": user_pair["date"].date(),
        "arb_date": user_pair["date"].date(),
        "days_apart": 0,
        "gym_w": user_pair["gym"][0],
        "arb_w": user_pair["arb"][0],
        "gym_bf": user_pair["gym"][1],
        "arb_bf": user_pair["arb"][1],
        "device": user_pair["device"],
        "dw": user_pair["gym"][0] - user_pair["arb"][0],
        "dbf": user_pair["gym"][1] - user_pair["arb"][1],
        "same_session": True,
    }
)

print("\nAll gym vs nearest-arboleaf pairs:")
for p in sorted(pairs, key=lambda x: x["days_apart"]):
    flag = " *** SAME SESSION" if p.get("same_session") else ""
    print(
        f"  gym {p['gym_date']} ({p['device']}) vs arb {p['arb_date']} ({p['days_apart']}d): "
        f"dW={p['dw']:+.2f}kg dBF={p['dbf']:+.1f}%{flag}"
    )


def linreg(xs, ys):
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    num = sum((xs[i] - mx) * (ys[i] - my) for i in range(n))
    den = sum((xs[i] - mx) ** 2 for i in range(n))
    a = num / den if den else 0
    b = my - a * mx
    return a, b


for label, subset in [
    ("All pairs", pairs),
    ("<=2 days apart", [p for p in pairs if p["days_apart"] <= 2 or p.get("same_session")]),
    ("<=1 day apart", [p for p in pairs if p["days_apart"] <= 1 or p.get("same_session")]),
    ("|dW|<=0.5 kg", [p for p in pairs if abs(p["dw"]) <= 0.5]),
    ("|dW|<=1.0 kg", [p for p in pairs if abs(p["dw"]) <= 1.0]),
]:
    if not subset:
        continue
    dw = [p["dw"] for p in subset]
    dbf = [p["dbf"] for p in subset]
    print(f"\n=== {label} (n={len(subset)}) ===")
    print(f"  Weight offset gym-arb: mean={stats.mean(dw):+.3f} median={stats.median(dw):+.3f} kg")
    print(f"  BF offset gym-arb:     mean={stats.mean(dbf):+.2f} median={stats.median(dbf):+.2f} %")

    bf_pairs = [(p["arb_bf"], p["gym_bf"]) for p in subset]
    xs = [x for x, _ in bf_pairs]
    ys = [y for _, y in bf_pairs]
    a, b = linreg(xs, ys)
    b_off = stats.mean([y - x for x, y in bf_pairs])
    print(f"  BF linear: gym_bf = {a:.4f} * arb_bf + {b:+.3f}")
    print(f"  BF offset: gym_bf = arb_bf + ({b_off:+.2f})")
    for p in subset:
        pred_off = p["arb_bf"] + b_off
        pred_lin = a * p["arb_bf"] + b
        print(
            f"    arb {p['arb_w']}/{p['arb_bf']}% -> offset {pred_off:.1f}% lin {pred_lin:.1f}% "
            f"(gym {p['gym_bf']}%, W err off {p['arb_w']+stats.mean(dw):.2f} vs {p['gym_w']})"
        )

print("\n=== RECOMMENDED (same-session + |dW|<=1kg) ===")
rec = [p for p in pairs if p.get("same_session") or (p["days_apart"] <= 1 and abs(p["dw"]) <= 1.0)]
if not rec:
    rec = [p for p in pairs if abs(p["dw"]) <= 1.0]
w_off = stats.mean([p["dw"] for p in rec])
bf_off = stats.mean([p["dbf"] for p in rec])
print(f"  calibrated_weight_kg = arb_weight_kg + ({w_off:+.2f})")
print(f"  calibrated_bf_pct    = arb_bf_pct + ({bf_off:+.2f})")
print(f"\n  Validate today's Arboleaf 79.95 / 14.3%:")
print(f"    -> {79.95 + w_off:.2f} kg, {14.3 + bf_off:.1f}%")
