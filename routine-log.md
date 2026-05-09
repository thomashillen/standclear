# Routine log

One line per autonomous run: date/time · mode · branch or PR · summary.

---

2026-05-09 12:15 UTC · MODE B · claude/nice-hopper-nQcmG · proxy Mapbox geocoding + walking-directions through /api/geocode + /api/walk so MAPBOX_TOKEN never reaches the browser
2026-05-09 12:25 UTC · MODE A · claude/nice-hopper-nQcmG (PR #38) · add per-IP sliding-window rate limiting to geocode + walk proxy routes; addresses Codex P1 comments on open billing proxy risk
2026-05-09 13:10 UTC · MODE B · claude/keen-goldberg-UK9md · per-station OG cards: build-time PNG per slug with station name + MTA route bullets so a tweeted station link gets a custom card
2026-05-09 13:45 UTC · MODE B · claude/keen-goldberg-tFvbg · per-page OG cards for /about, /pricing, /changelog so each marketing surface gets its own framed social thumbnail
2026-05-09 14:00 UTC · MODE B · claude/per-train-staleness-2026-05-09 · per-train marker fade driven by GTFS-RT VehiclePosition.timestamp so a vehicle that hasn't reported in 90s+ visibly dims even when the snapshot itself is fresh
2026-05-09 14:15 UTC · MODE B · claude/line-landing-pages-2026-05-09 · per-line landing pages at /line/[id] mirroring /station/[slug] — every train (1–7, A/C/E, B/D/F/M, G, J/Z, L, N/Q/R/W, shuttles, SI) has a static SEO surface that links into the live map at ?line=&lt;id&gt;
2026-05-09 16:15 UTC · MODE B · claude/press-page-2026-05-09 · add /press page (boilerplate, quick facts, brand assets, screenshot URLs, contact) + matching OG card; sitemap + changelog + footer link updated
2026-05-09 17:15 UTC · MODE B · claude/respect-reduced-motion-2026-05-09 · drop `essential: true` from cinematic follow-mode easeTo calls (entry tilt, exit unwind, per-tick recenter) so riders with prefers-reduced-motion get tracking without the camera-lean animation, per product principle #3
