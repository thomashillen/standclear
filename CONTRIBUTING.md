# Contributing to StandClear

Thanks for considering a contribution. StandClear is open source under MIT, and the project welcomes issues, ideas, and pull requests from anyone.

This guide is the short version of "how do I make a change without surprising the maintainers."

## Philosophy

Read [CLAUDE.md](./CLAUDE.md) first — it documents the load-bearing decisions in the codebase (the GTFS bundling pitfall, the dedup invariants, the iOS Safari edge cases) and is the canonical source of architectural context. The dense in-code comments are also load-bearing — they encode incidents, not just what the code does. Treat them as documentation.

When in doubt, prefer:

- **Editing existing files** over creating new ones.
- **Concrete code changes** over speculative abstractions.
- **One focused PR** over a sprawling refactor.
- **Keeping the same UX patterns** (bottom-sheet panels, drag-to-dismiss, glass tints, mutual exclusion between panels) over inventing new ones.

## Local setup

```bash
git clone https://github.com/thomashillen/standclear.git
cd standclear
npm install
cp .env.example .env.local       # then fill in NEXT_PUBLIC_MAPBOX_TOKEN
npm run dev
```

A free Mapbox token is enough for development. The MTA GTFS-Realtime feeds are public and require no key.

## What to work on

- **Issues labeled `good first issue`** are sized for a first PR.
- **`bug` and `feedback` labels** are real user reports — fixing one is high-leverage.
- **Anything in the `pro` label** is in [the Pricing page roadmap](https://standclear.app/pricing) (push alerts, leave-at-X reminders, cross-device sync). These need design discussion first — open an issue with your approach.

If you've got an idea that isn't on the issue tracker, open an issue describing it before you code so we can confirm fit.

## Workflow

1. **Fork + branch.** Branch names like `feat/xxx`, `fix/xxx`, `chore/xxx`.
2. **Make the change.** Keep it focused — bug fix, feature, or refactor; not all three.
3. **Run the checks locally:**
   ```bash
   npm run lint
   npm run test
   npx tsc --noEmit
   npm run build         # NEXT_PUBLIC_MAPBOX_TOKEN must be set, even a fake one
   ```
4. **Open the PR.** The template will ask for a summary, screenshot/clip if it's a UI change, and a test plan.
5. **CI runs.** Lint + typecheck + test + build all run on every push. Green is mandatory before review.

## Code style

- TypeScript strict, no `any` unless commented-around (see existing escape hatches for examples).
- Tailwind utility classes; iOS-glass conventions live in `globals.css` (`.ios-glass`, `.ios-glass--sheet`, `.ios-glass--header`).
- Prefer module-scope singletons for cross-component state when they outlive React (see `useTrains`, `subwayData`, `useFavorites`). Don't replace these with React Context without thinking through cold-boot and cross-tab behavior.
- Tests live next to the file they cover (`foo.ts` ↔ `foo.test.ts`). Pure-logic + Node-only tests opt into the Node Vitest environment via a `// @vitest-environment node` directive at the top of the file.
- Comments document **why**, not what. The code says what. The comment says why.

## Touching the API surface

- `app/api/trains/route.ts` has a load-bearing `tripStopCache` that survives across requests. Don't replace it with per-request state.
- `app/api/alerts/route.ts` and `app/api/health/route.ts` are simpler — health is the operational probe; keep its checks fast and timeout-bounded.
- Mind upstream rate limits. The MTA's free GTFS-RT feeds are generous but not infinite, and Mapbox's geocoding has a real free-tier ceiling.

## Touching the marketing surface

- Brand strings + URLs live in `lib/site.ts`. Add to that file rather than hardcoding.
- Marketing routes (`/about`, `/privacy`, `/terms`, `/changelog`, `/pricing`, `/status`) all wrap `<MarketingShell>`. Use it.
- Per-station SEO pages are generated from the GTFS index — see `app/station/[slug]/page.tsx` and `lib/stations.server.ts`.

## Reporting security issues

Don't open a public issue for security vulnerabilities. See [SECURITY.md](./SECURITY.md) for the disclosure path.

## Questions

Open a discussion or an issue. Issues without a clear bug or feature are fine — labeled `question`.
