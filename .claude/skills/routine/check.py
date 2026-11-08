#!/usr/bin/env python3
"""Routine check: live figures from dispatcherctl, compared with the last run.

Prints one report and saves the figures to last.json beside this file, so the
next run (days or weeks later) can say what moved. --dry-run skips the save.
--only SECTION prints one section in more detail and never saves.
"""
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
LAST = os.path.join(HERE, "last.json")
CTL = os.environ.get("DISPATCHERCTL") or os.path.expanduser("~/go/bin/dispatcherctl")
HEALTH_FLOOR = 70  # the checklist's "under 70%" line
FIX_FIRST = 10  # earning templates under the floor before publishing pauses
PLUMBING = {"Storage", "Starters", "Queues"}  # databases, boilerplates and queues: not apps we build
SECTIONS = ("health", "catalog", "upgrades", "search", "candidates", "verdict", "payouts")
VOID = {"FAILED", "CANCELLED", "CANCELED", "REJECTED"}  # withdrawals where no money moved
UPGRADE_EVERY = 7  # days between upgrade pushes before the section is due
TIERS = ("exact name/slug", "name starts with it", "name has the words", "slug/description only")


def tier(query, name, code):
    """Railway's text tier for one result (docs/research/railway-search-ranking.md):
    0 name or slug is the query, 1 name starts with it, 2 name has every word,
    3 only the slug or description matches."""
    q = query.lower().strip()
    n = (name or "").lower()
    if n == q or n.split(" | ")[0] == q or (code or "") == q.replace(" ", "-"):
        return 0
    if n.startswith(q):
        return 1
    words = n.replace("|", " ").replace("-", " ").split()
    if all(any(w.startswith(x) for w in words) for x in q.split()):
        return 2
    return 3


def band(t):
    """The health band search sorts by within a tier: exactly 100 > 70-99 >
    unscored > under 70. Railway's public score is empty for a template with
    no active projects; the timeline keeps the last score it saw, so those
    count as unscored here whatever it says."""
    h = t.get("health")
    if not t.get("activeProjects") or h is None:
        return "unscored"
    if h >= 100:
        return "100"
    return f"{h:.0f} (70-99 band)" if h >= 70 else f"{h:.0f} (under 70: below unscored)"


def get(*args):
    out = subprocess.run([CTL, "--compact", *args], capture_output=True, text=True, timeout=120)
    if out.returncode != 0:
        sys.exit(f"dispatcherctl {' '.join(args)} failed: {out.stderr.strip()}")
    return json.loads(out.stdout)


def figures(timeline, upgrades, search, candidates, verdicts):
    ts = timeline["templates"]
    by_template = {}
    for u in upgrades:
        if u.get("behind") in ("patch", "minor") or u.get("major"):
            by_template.setdefault(u["templateId"], []).append(u)
    low = sorted(
        (t for t in ts if t.get("health") is not None and t["health"] < HEALTH_FLOOR and (t.get("running") or 0) > 0),
        key=lambda t: (-(t.get("earnedCents") or 0), t["health"]),
    )
    own = [k for k in search["keywords"] if k["source"] == "ours"]
    upgraded = sorted({u["templateId"]: u.get("upgradedOn") or "" for u in upgrades}.values(), reverse=True)
    week_ago = (datetime.now(timezone.utc) - timedelta(days=UPGRADE_EVERY)).date().isoformat()
    d45 = verdicts["provisional"][0]
    d90 = verdicts["provisional"][1] if len(verdicts["provisional"]) > 1 else {"n": 0}
    return {
        "at": datetime.now(timezone.utc).isoformat(timespec="minutes"),
        "templates": len(ts),
        "ids": sorted(t["templateId"] for t in ts),
        "earned30dCents": sum(t.get("earnedCents") or 0 for t in ts),
        "low": [
            {
                "name": t["name"],
                "health": round(t["health"]),
                "earnedCents": t.get("earnedCents") or 0,
                "fixedOn": t.get("fixedOn") or "",
                "upgrades": sorted({u.get("behind") or "" for u in by_template.get(t["templateId"], [])} - {""})
                + (["major"] if any(u.get("major") for u in by_template.get(t["templateId"], [])) else []),
            }
            for t in low
        ],
        "lowEarning": sum(1 for t in low if (t.get("earnedCents") or 0) > 0),
        "behind": {b: sum(1 for u in upgrades if u.get("behind") == b) for b in ("patch", "minor", "floating")},
        "majors": sum(1 for u in upgrades if u.get("major")),
        "lastUpgradeOn": upgraded[0] if upgraded else "",
        "upgradedLastOn": sum(1 for d in upgraded if upgraded and d == upgraded[0] and d),
        "upgradedWeek": sum(1 for d in upgraded if d and d >= week_ago),
        "noKind": [t["name"] for t in ts if not t["kind"]],
        "noOrigin": [t["name"] for t in ts if not t.get("origin")],
        "ownKeywords": len(own),
        "ownTop": sum(1 for k in own if k["best"] == 1),
        "ownMissing": [k["query"] for k in own if k["best"] is None],
        "ownDropped": [
            f"{k['query']} #{k['prevBest'] or '-'}→#{k['best'] or 'out'}"
            for k in own
            if k["searchedBefore"] and (k["best"] or 21) > (k["prevBest"] or 21)
        ],
        "gaps": sum(1 for k in search["keywords"] if k["demand"] > 0 and (k["best"] is None or k["best"] > 3)),
        "shortlist": sum(1 for g in candidates["groups"] if g.get("status") == "shortlist"),
        "verdict": {
            "checkpoint": verdicts["checkpoint"] and {
                "horizon": verdicts["checkpoint"]["horizon"],
                "p1": verdicts["checkpoint"]["p1"]["result"],
                "p2": verdicts["checkpoint"]["p2"]["result"],
            },
            "d45n": d45["n"],
            "d45positives": d45["positives"],
            "d45p1True": d45["p1"]["trueN"],
            "d90n": d90["n"],
        },
    }


def delta(now, before, key):
    if before is None or key not in before:
        return ""
    d = now[key] - before[key]
    return f" ({'+' if d > 0 else ''}{d})" if d else " (=)"


def show_health(f, last, detail=False):
    print(f"HEALTH: {len(f['low'])} live templates under {HEALTH_FLOOR}%, {f['lowEarning']} of them earning" + delta(
        {"n": f["lowEarning"]}, last and {"n": last["lowEarning"]}, "n"))
    if f["lowEarning"] > FIX_FIRST:
        print(f"  over {FIX_FIRST} earning: fix before you publish")
    for t in f["low"] if detail else f["low"][:10]:
        up = f"  upgrades pending: {', '.join(t['upgrades'])}" if t["upgrades"] else ""
        fixed = f"  fix pushed {t['fixedOn']}" if t.get("fixedOn") else ""
        print(f"  {t['health']:>3}%  ${t['earnedCents'] / 100:>7.2f}/30d  {t['name']}{fixed}{up}")
    if last:
        was = {t["name"] for t in last["low"]}
        fixed = sorted(was - {t["name"] for t in f["low"]})
        new = [t["name"] for t in f["low"] if t["name"] not in was]
        if fixed:
            print(f"  recovered since last: {', '.join(fixed)}")
        if new:
            print(f"  new since last: {', '.join(new)}")


def show_catalog(f, last):
    added = len(set(f["ids"]) - set(last["ids"])) if last else None
    print(f"CATALOG: {f['templates']} live" + (f", {added} new since last" if added is not None else "")
          + f"; earned 30d ${f['earned30dCents'] / 100:,.2f}" + delta(
        {"c": f["earned30dCents"] // 100}, last and {"c": last["earned30dCents"] // 100}, "c"))
    if f["noKind"]:
        print(f"  no kind: {', '.join(f['noKind'])}")
    if f["noOrigin"]:
        print(f"  no origin ({len(f['noOrigin'])}): {', '.join(f['noOrigin'][:12])}{' …' if len(f['noOrigin']) > 12 else ''}")


def show_upgrades(f):
    b = f["behind"]
    print(f"UPGRADES: {b['patch']} patch, {b['minor']} minor, {b['floating']} floating, {f['majors']} with a newer major")
    last = f.get("lastUpgradeOn")
    if not last:
        print("  no upgrade recorded: due (record pushes with dispatcherctl upgraded ID YYYY-MM-DD)")
        return
    age = (datetime.now(timezone.utc).date() - datetime.fromisoformat(last).date()).days
    print(f"  last upgrade {last} ({age} days ago, {f['upgradedLastOn']} templates); {f['upgradedWeek']} upgraded in {UPGRADE_EVERY} days; "
          + ("due" if age >= UPGRADE_EVERY else f"next due {(datetime.fromisoformat(last) + timedelta(days=UPGRADE_EVERY)).date()}"))


def show_search(f, last):
    print(f"SEARCH: #1 on {f['ownTop']} of {f['ownKeywords']} own keywords" + delta(f, last, "ownTop")
          + f"; {f['gaps']} gaps; shortlist {f['shortlist']}")
    if f["ownDropped"]:
        print(f"  dropped this week: {', '.join(f['ownDropped'])}")
    if f["ownMissing"]:
        print(f"  missing: {', '.join(f['ownMissing'])}")


def show_verdict(f):
    v = f["verdict"]
    cp = v["checkpoint"]
    print("VERDICT: " + (f"checkpoint day {cp['horizon']}: P1 {cp['p1']}, P2 {cp['p2']}" if cp else "no checkpoint yet")
          + f"; day 45 n={v['d45n']}, rose={v['d45positives']}, P1 true={v['d45p1True']} (needs 5); day 90 n={v['d90n']}")
    if cp and "pass" in (cp["p1"], cp["p2"]):
        print("  a predictor passed: T4 (Verdict column) is unblocked")


def show_proposals():
    # The owner's proposals inbox; live only, nothing to compare with last time.
    out = subprocess.run([CTL, "--compact", "proposals"], capture_output=True, text=True, timeout=120)
    if out.returncode == 0:
        new = [p for p in json.loads(out.stdout)["proposals"] if not p["status"]]
        print(f"PROPOSALS: {len(new)} waiting for an answer")
        for p in new:
            print(f"  {p['url']}" + (f"  ({p['note']})" if p["note"] else ""))


def upgrade_queue(upgrades, n=15):
    """The queue per template, in the server's order: urgent, then behind by earnings."""
    by = {}
    for u in upgrades:
        if u.get("urgent") or u.get("behind") in ("patch", "minor", "floating") or u.get("major"):
            by.setdefault(u["templateId"], []).append(u)
    # Same as the page: what earned nothing waits behind one line, unless urgent.
    lead = [g for g in by.values() if g[0].get("urgent") or (g[0].get("earningsLast30Days") or 0) > 0]
    print(f"  queue: {len(lead)} templates to work, {len(by) - len(lead)} more earned nothing")
    for g in lead[:n]:
        u = g[0]
        print(f"  {u['name']}  ${u.get('earningsLast30Days') or 0:.2f}/30d  {u.get('runningInstances') or 0} running"
              + (f"  URGENT: {u['urgent']}" if u.get("urgent") else ""))
        for x in g:
            to = x.get("latest") or "?"
            print(f"    {x['service']}: {x['image']}:{x['tag']} -> {to} ({x.get('behind') or 'current'})"
                  + (f", major {x['major']}" if x.get("major") else ""))
    if len(lead) > n:
        print(f"  … {len(lead) - n} more")


def search_why(search, timeline, n=12):
    """For each own keyword where ours isn't #1, why: our tier and health
    band against the templates above it. Tier beats band, band beats running
    deploys, so the first line that differs is the reason."""
    ts = {t["templateId"]: t for t in timeline["templates"]}
    rows = []
    for k in search["keywords"]:
        if k["source"] != "ours" or k["best"] == 1:
            continue
        mine = next((r for r in k["top"] if r["ours"]), None)
        if mine is None:
            rows.append((k["demand"], f"    {k['query']}: none of ours in the top {k['results']} (check the name and slug match it)"))
            continue
        t = ts.get(mine["templateId"], {})
        ours = tier(k["query"], mine["name"], mine["code"])
        above = [r for r in k["top"] if r["position"] < mine["position"]]
        better = [r for r in above if tier(k["query"], r["name"], r["code"]) < ours]
        if better:
            why = f"{len(better)} above have a better tier ({TIERS[tier(k['query'], better[0]['name'], better[0]['code'])]}: {better[0]['name']})"
        else:
            why = f"same tier as the {len(above)} above: health band, then running deploys"
        rows.append((k["demand"], f"    {k['query']} #{mine['position']}  demand {k['demand']:,}: ours {TIERS[ours]}, health {band(t)},"
                     f" {t.get('activeProjects') or 0} active; {why}"))
    rows.sort(key=lambda r: -r[0])
    print(f"  own keywords not at #1 ({len(rows)}), biggest first; tier > health band > running deploys:")
    for _, line in rows[:n]:
        print(line)
    if len(rows) > n:
        print(f"    … {len(rows) - n} more")
    unscored = [t for t in timeline["templates"] if not t.get("activeProjects") or t.get("health") is None]
    print(f"  {len(unscored)} of our {len(timeline['templates'])} templates are unscored (no active projects):"
          " they sort under every 70+ listing in their tier")


def search_detail(search, n=10):
    added = [k for k in search["keywords"] if k["source"] == "manual"]
    fell = [
        f"{k['query']} #{k['prevBest'] or '-'}→#{k['best'] or 'out'}"
        for k in added
        if k["searchedBefore"] and (k["best"] or 21) > (k["prevBest"] or 21)
    ]
    print(f"  added by hand: {len(added)}, {sum(1 for k in added if k['best'] == 1)} at #1")
    if fell:
        print(f"  added by hand, dropped this week: {', '.join(fell)}")
    gaps = sorted(
        (k for k in search["keywords"] if k["demand"] > 0 and (k["best"] is None or k["best"] > 3) and k["category"] not in PLUMBING),
        key=lambda k: -k["demand"],
    )
    print("  biggest gaps (not top 3, no databases or starters; demand counts big templates more than once):")
    for k in gaps[:n]:
        first = k["top"][0]["name"] if k["top"] else "-"
        print(f"    {k['query']}  demand {k['demand']:,}  we rank {'#' + str(k['best']) if k['best'] else 'none'}  first: {first}")


def candidates_detail(candidates, n=15):
    groups = candidates["groups"]
    short = [g for g in groups if g.get("status") == "shortlist"]
    print(f"CANDIDATES: {len(short)} on the shortlist, market read {candidates['fetchedAt'][:10]}")
    for g in short:
        print(f"  shortlist: {g['key']}  {g['recent']:,} in 90d" + (f"  ({g['note']})" if g.get("note") else ""))
    # Same as the page's Market view with its default filters on.
    market = sorted(
        (g for g in groups if not g.get("status") and g["category"] not in PLUMBING and not g["ours"] and not g.get("similar")),
        key=lambda g: -g["recent"],
    )
    print("  most deployed that we don't publish:")
    for g in market[:n]:
        l = g.get("leader") or {}
        print(f"    {g['key']}  {g['category']}  {g['recent']:,} in 90d  {g['rivals']} rivals"
              f"  leader {l.get('name', '-')} by {l.get('creator') or 'unknown'}, health {l.get('health', '-')}")
    behind = sorted(
        (g for g in groups if g["ours"] and g["ourRecent"] * 2 < g["recent"] + g["similarRecent"]),
        key=lambda g: -(g["recent"] + g["similarRecent"]),
    )
    print("  ours, but others take most of the deploys (a listing to fix is cheaper than a build):")
    for g in behind[:5]:
        print(f"    {g['key']}  we get {g['ourRecent']:,} of {g['recent'] + g['similarRecent']:,} in 90d")


def show_payouts(days=14):
    """Real transfers only: the history's accruals are kickbacks reaching the balance."""
    settings = get("withdraw-settings")
    accounts = get("withdraw-accounts")
    hist = get("get", f"/api/payouts?days={days}")
    rows = [p for p in hist["payouts"] if p["kind"] != "accrual"]
    print(f"PAYOUTS: auto-withdraw {'on, ' + settings['schedule'] if settings['enabled'] else 'OFF'}"
          f"; balance ${accounts['availableBalance'] / 100:,.2f}, minimum ${accounts['minimumBalance'] / 100:,.2f}")
    t = hist["totals"]
    print(f"  last payout {(t.get('lastPayoutAt') or 'never')[:10]}; pending ${t['pendingCents'] / 100:,.2f} in {t['pendingCount']}")
    print(f"  transfers in {days} days: {len(rows)}")
    for p in rows:
        flag = "  FAILED, no money moved" if p["status"] in VOID else ""
        print(f"    {p['createdAt'][:10]}  ${p['amountCents'] / 100:,.2f}  {p['kind']}  {p['status']}  {p.get('destination') or ''}{flag}")


def only(section, f, last, data):
    if section == "health":
        show_health(f, last, detail=True)
    elif section == "catalog":
        show_catalog(f, last)
    elif section == "upgrades":
        show_upgrades(f)
        upgrade_queue(data["upgrades"])
    elif section == "search":
        show_search(f, last)
        search_why(data["search"], data["timeline"])
        search_detail(data["search"])
    elif section == "candidates":
        candidates_detail(data["candidates"])
        print()
        show_proposals()
    elif section == "verdict":
        show_verdict(f)
    elif section == "payouts":
        show_payouts()


def report(f, last):
    print(f"Routine check {f['at']}" + (f", last check {last['at']}" if last else ", first check"))
    print()
    show_health(f, last)
    print()
    show_catalog(f, last)
    print()
    show_upgrades(f)
    print()
    show_search(f, last)
    print()
    show_verdict(f)
    print()
    show_proposals()


def main():
    section = None
    if "--only" in sys.argv:
        at = sys.argv.index("--only") + 1
        section = sys.argv[at] if at < len(sys.argv) else ""
        if section not in SECTIONS:
            sys.exit(f"--only takes one of: {', '.join(SECTIONS)}")
    last = None
    try:
        with open(LAST) as fh:
            last = json.load(fh)
    except (OSError, ValueError):
        pass
    data = {
        "timeline": get("get", "/api/analytics/timeline"),
        "upgrades": get("upgrades"),
        "search": get("get", "/api/search"),
        "candidates": get("get", "/api/candidates"),
        "verdicts": get("get", "/api/analytics/verdicts"),
    }
    f = figures(data["timeline"], data["upgrades"], data["search"], data["candidates"], data["verdicts"])
    if section:
        # One section compares with the last full check and leaves it in place,
        # so the next routine still reports everything that moved since then.
        only(section, f, last, data)
        return
    report(f, last)
    if "--dry-run" not in sys.argv:
        with open(LAST, "w") as fh:
            json.dump(f, fh)


if __name__ == "__main__":
    main()
