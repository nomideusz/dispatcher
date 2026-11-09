---
name: verdict
description: Check the Dispatcher template verdict backtest and its checkpoints. Use when the owner says "/verdict", "check the verdict", or asks whether a predictor has passed.
---

# Verdict

1. Run `python3 -I .claude/skills/routine/check.py --only verdict`. If dispatcherctl says the session expired, ask the owner to run `! ~/go/bin/dispatcherctl login`. For the full figures, read `~/go/bin/dispatcherctl get /api/analytics/verdicts`.
2. Follow the **Verdict** bullet in `.claude/skills/routine/SKILL.md`, with the design in `docs/designs/day-14-template-verdict.md`. Nothing is decided until a checkpoint is stored.
3. Day 45 was stored on 2026-11-09 with P1 passing, and the Verdict column on Templates follows it (T4, shipped that day). Say whether a newer checkpoint has been stored and how far day 90 is from being judged: not before 2026-12-24. If a predictor fails at a stored checkpoint, record it in the design doc and say which states change: a failed P1 turns every `keep` into `no signal`.
4. Read `keep` as "paid by day 21", frozen at that reading, not as healthy now: Firefox showed `keep` while held at 38% with $0 in 30 days. Use it as a tie-breaker in maintenance and publishing priority (the design's success criterion), never as the only reason to drop a template, and never against an original on kickback alone.
5. Never suggest moving a threshold or the judging moment after seeing the numbers: a predictor sitting near its bar would be decided by the tweak.
