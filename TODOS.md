# TODOS

## Verdict

### Explain verdict age vs. Published date in the Verdict header hint

**What:** Add one line to the Verdict column's header hint: days count from when Dispatcher first saw the template live, not the Published date.

**Why:** Published shows Railway's createdAt. The verdict counts from the first PUBLISHED snapshot (eng review R2), which can be up to 1.8 days later, so the two dates can disagree with no explanation.

**Context:** From /plan-eng-review on 2026-10-29 (outside-voice finding 7, D13). The Verdict column ships only in PR 2, and only if a stored checkpoint shows a predictor passes. See docs/designs/day-14-template-verdict.md, steps 5 and 8. Start in `web/src/components/templates-table.tsx` where the Verdict column's hint is defined.

**Effort:** S
**Priority:** P3
**Depends on:** Verdict column (PR 2), which needs the build gate to pass
