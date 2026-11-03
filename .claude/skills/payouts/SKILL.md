---
name: payouts
description: Check Dispatcher payouts for failed or missing transfers. Use when the owner says "/payouts", "check payouts", or asks whether withdrawals went through.
---

# Payouts

1. Run `python3 -I .claude/skills/routine/check.py --only payouts`. If dispatcherctl says the session expired, ask the owner to run `! ~/go/bin/dispatcherctl login`.
2. Look for a failed or missing transfer. If auto-withdraw is on, a gap against its schedule counts as missing. If it's off, say so, since no automatic transfer is expected.
3. Report only that, plus the totals if asked (`~/go/bin/dispatcherctl get /api/payouts?days=N` has the history). Don't change withdraw settings or start a withdrawal unless the owner asks.
