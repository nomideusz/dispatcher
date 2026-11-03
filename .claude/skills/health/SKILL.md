---
name: health
description: Work on Dispatcher template health. Use when the owner says "/health", "check health", "fix health", or asks which template to fix first. For Railway templates in the Dispatcher catalog, not general service health checks.
---

# Health

Health holds search position, and position drives deploys, so this comes first.

1. Run `python3 -I .claude/skills/routine/check.py --only health`. If dispatcherctl says the session expired, ask the owner to run `! ~/go/bin/dispatcherctl login`.
2. Follow the **Health** bullet in `.claude/skills/routine/SKILL.md`, which sets the order, the `fix pushed` rule and when a fix didn't hold. Name the earning template to fix first, or work on the one the owner named.
3. Find the root cause: check its pending upgrades and their changelogs for the symptom, then read logs and memory on a fresh deploy. Railway can show SUCCESS while the app is dead inside the container.
4. Make the fix in `~/dev/railway-templates/<dir>` and canary it. Before pushing, state what you found and what the push changes, and wait for the owner's OK unless the request already said to go ahead: a push to main notifies every deployer.
5. After pushing, record it with `dispatcherctl fixed ID YYYY-MM-DD`.
