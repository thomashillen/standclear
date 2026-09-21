# AGENTS.md

This file is the operating guide for coding agents working on StandClear. It applies to the entire repository unless a more specific `AGENTS.md` exists deeper in the tree.

## Product north star

StandClear is a mobile-first NYC subway product whose live map is the hero.

- A first-time visitor should immediately understand that the subway is alive and moving.
- A returning rider who has granted location should get useful nearby arrivals with near-zero friction.
- Prefer simplicity, trustworthiness, and polish over feature count.
- Mobile is the primary design target. Desktop should remain good, but it is secondary.
- Preserve the map-first, single-sheet interaction model unless Thomas explicitly approves a product-direction change.
- Treat realtime freshness honestly. Never present stale or estimated information as live.

## Start every task from current reality

Before choosing or implementing work:

1. Read current `main`.
2. Check open pull requests and issues.
3. Check recent merged PRs/commits that touch the area you plan to change.
4. Read the most recent relevant entries in issue #191 (`chore: autonomous development log`) when historical context is useful. Do not reread the entire long thread by default.
5. Check current CI/deployment health when it is relevant to the task.
6. Read the implementation and tests before changing behavior.

Do not assume an old branch, stale Codex task, or old issue description still matches current `main`.

## Work selection

Prefer one bounded, high-value improvement at a time.

Priority order:

1. Correctness and rider safety/trust.
2. Realtime/GTFS/static-data reliability and stale-data behavior.
3. Mobile usability and accessibility.
4. Performance and resilience.
5. Maintainability and missing regression coverage.
6. Restrained launch polish that does not change the core product model.

Prefer observed or strongly evidenced problems over speculative refactors or novelty. If no worthwhile change is clearly justified, inspect and document rather than manufacturing churn.

## Autonomy boundary

Agents may independently implement and merge changes only when they are small, reversible, well-tested, and do not materially change product direction. Examples include:

- clear bug fixes
- regression tests
- accessibility fixes
- small mobile usability refinements
- reliability/staleness fixes
- narrow performance improvements
- dependency/security maintenance that does not require a major migration
- documentation and developer-experience cleanup

Ask Thomas before implementing:

- a full new feature or substantial feature expansion
- a core UX/product-direction change
- a major architecture or schema migration
- a new paid/external service or recurring cost
- destructive data changes
- auth/security-model changes
- a major framework migration not required to fix a concrete issue
- a choice where multiple reasonable product directions exist and user preference is the deciding factor

When a decision is required, preserve the investigation in GitHub, state the decision clearly, and continue with unrelated safe work when possible.

## Implementation workflow

For code changes:

1. Start from current `main`.
2. Use a focused branch.
3. Keep the diff narrow and reviewable.
4. Add or update regression coverage for behavior changes and bug fixes.
5. Run the relevant targeted tests while iterating.
6. Before declaring the change ready, run the normal repository validation:
   - `npm run lint`
   - `npx tsc --noEmit`
   - `npm test`
   - `npm run build`
7. Open a pull request rather than pushing directly to `main`.
8. In the PR body, summarize the user-visible effect, validation performed, and any known limitations.
9. For a change that is within the autonomous merge boundary, include the exact line `Autonomy: safe` in the PR body. Do not use that marker for changes that require Thomas's decision.

If a cloud environment cannot publish a real GitHub branch/PR, report that delivery blocker. Do not reconstruct large or risky changes through partial file APIs just to bypass the missing publication path.

## Merge rules

Never bypass required checks, force-merge around failures, or weaken CI to make a PR pass.

An autonomous PR marked `Autonomy: safe` may be merged only when all of the following are true:

- GitHub CI for the current head is green.
- The Vercel preview/deployment check for the current head is green when present.
- Native Codex review has completed for the current head.
- No unresolved P0/P1 Codex finding exists.
- Any concrete P2 finding that identifies a correctness, reliability, stale-data, accessibility, or meaningful mobile regression has been resolved or explicitly documented as not applicable.
- The PR still fits the autonomy boundary after review.

If checks or review are pending, leave the PR open for the PR watcher. If a check fails, investigate the actual failure rather than repeatedly rerunning it without evidence of flakiness.

Do not use `npm audit fix --force`, speculative dependency overrides, destructive Git operations, or broad unrelated rewrites.

## Automated GTFS refresh PRs

Treat automated GTFS refresh pull requests as maintenance work.

- Do not merge if required checks are missing, failed, or action-required.
- Inspect generated changes for obvious anomalies.
- Merge only after the normal required checks are green.
- Do not bypass safeguards just because the PR is automated.

## Durable project memory

GitHub is the source of truth.

- Issues represent actionable work or decision points.
- Pull requests contain implementation and validation context.
- Issue #191 is a concise autonomous-development log, not a full transcript.

Append to #191 only for meaningful completed work, important risks, intentional deferrals, delivery blockers, or decisions needed from Thomas. Avoid routine “nothing changed” comments and duplicate history.

## Code Review Rules

### Realtime and stale data

- Verify timestamp units and freshness thresholds before changing realtime behavior.
- Never silently treat stale GTFS-RT data as fresh.
- Preserve deterministic fallback behavior when realtime data is unavailable or too stale.

### Location

- Do not trigger surprise location permission prompts.
- Do not continue presenting location-derived information as current after location access or a location watch becomes invalid.
- Avoid unnecessary continuous high-accuracy location work, especially on UI that is not visible.

### Mobile UX and accessibility

- Mobile is the primary target.
- Keep important tap targets comfortably usable and accessible.
- Preserve keyboard/screen-reader semantics for interactive controls.
- Avoid stacking competing sheets or overlays that obscure the live map.

### Routing and state

- Test route-prefill, swap, clear, and delayed-data-loading behavior when changing trip-planning state.
- Rider edits must not be silently overwritten by replayed presets or stale state.

### Failure states

- Preserve a visible recovery path when essential data fails to load.
- Prefer useful degraded behavior over blank or misleading UI.

## Current validation commands

The repository uses:

- `npm run lint`
- `npx tsc --noEmit`
- `npm test`
- `npm run build`

Use targeted Vitest commands during development when appropriate, but complete the full validation set before an autonomous merge.
