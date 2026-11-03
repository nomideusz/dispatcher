---
name: verdict
description: Check the Dispatcher template verdict backtest and its checkpoints. Use when the owner says "/verdict", "check the verdict", or asks whether a predictor has passed.
---

# Verdict

1. Run `python3 -I .claude/skills/routine/check.py --only verdict`. If dispatcherctl says the session expired, ask the owner to run `! ~/go/bin/dispatcherctl login`. For the full figures, read `~/go/bin/dispatcherctl get /api/analytics/verdicts`.
2. Follow the **Verdict** bullet in `.claude/skills/routine/SKILL.md`, with the design in `docs/designs/day-14-template-verdict.md`. Nothing is decided until a checkpoint is stored.
3. Say how far the day-45 group is from being judged. If a predictor passed, tell the owner T4 is unblocked. If one failed, record it in the design doc.
4. Don't recommend dropping a template for slow early earnings while no checkpoint is stored.
