# Security policy

## Supported versions

StandClear ships from `main`. There are no long-lived release branches; security fixes always land on `main` and roll out via the next deploy.

## Reporting a vulnerability

**Please don't open a public GitHub issue for security vulnerabilities.**

Instead, use GitHub's private vulnerability reporting:

> https://github.com/thomashillen/standclear/security/advisories/new

You can expect:

- An acknowledgement within **3 business days**.
- A first-pass assessment within **7 business days**.
- A fix or mitigation timeline communicated by then; in practice most issues are patched and deployed within a week of triage.

Please include enough detail to reproduce: affected URL or code path, steps, expected vs. observed behavior, and any proof-of-concept input. Reports without reproduction steps slow everyone down.

## Scope

In scope:

- The hosted instance at the canonical site URL.
- The codebase in this repository, especially the `/api/*` routes and the client trust boundary (anything that reaches Mapbox or the MTA from the user's browser).
- The published Service Worker (`public/sw.js`) and PWA manifest.

Out of scope:

- Issues that require physical access to a user's device.
- Self-XSS that requires the user to paste attacker-supplied JavaScript into their own DevTools.
- Spam / DoS at upstream (MTA, Mapbox) that this project cannot remedy. Report those upstream.
- Vulnerabilities in third-party services (Vercel, Mapbox, MTA infrastructure) that aren't introduced by this codebase. Please report those to the relevant vendor.

## Hardening notes for self-hosters

If you're running your own instance:

- The Mapbox public token (`NEXT_PUBLIC_MAPBOX_TOKEN`) is **shipped to the client bundle**. URL-restrict it at https://account.mapbox.com/access-tokens/ to your production domain(s) before going live. Rotate quarterly. A leaked token can be billed against your account from arbitrary origins.
- Wire `NEXT_PUBLIC_SENTRY_DSN` (or the equivalent you use) so silent failures aren't actually silent.
- The `/api/health` endpoint is intended to be public — it returns no sensitive information and is safe to expose to uptime probes.
- Service Worker cache keys are versioned via `CACHE_VERSION` in `public/sw.js`; bump it on each release that ships a breaking change to the cached assets so old clients don't get stuck on stale code.

## Recognition

We don't run a paid bug bounty today. If your report leads to a fix and you'd like attribution, we'll credit you in the [changelog](https://standclear.app/changelog) (or keep you anonymous, your call).
