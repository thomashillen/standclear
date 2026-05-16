# Open questions

Items that surfaced during runs but are too large or ambiguous to resolve inline.
The run that logs an item should also leave a note on the PR thread if applicable.

---

<!-- template: YYYY-MM-DD · <description> · (PR #NNN or branch) -->

2026-05-16 · `components/DragHandle.tsx` is the tap-to-collapse grabber that crowns all five bottom sheets (StationPanel, LinePanel, NearbyPanel, SearchSheet, MoreSheet). Its button is `h-7` (28px) — easy to hit horizontally (full-width) but short on the vertical axis a thumb actually misses on a moving train, below the 44px touch minimum (north-star principle #3). It's the single highest-leverage touch-target gap left (one component, five surfaces) but also the riskiest to change blind: the visible pill stays at `items-start pt-1.5` while the button's invisible hit box sits flush above each sheet's header. Two candidate fixes, both needing validation: (a) `min-h-11` pushes header content down ~16px on mobile across five sheets — a visible layout shift that needs a design pass + per-sheet screenshot; (b) keep layout via a negative bottom margin so the 44px hit box overlaps the header's top ~16px — zero shift but risks hijacking taps meant for the sheet title/close affordance, which must be confirmed sheet-by-sheet. Either path needs the Vercel-preview screenshot loop on all five sheets to satisfy "would Apple ship this," which exceeds a safe single autonomous run. Not in scope of PR #158 (FollowCapsule exit) or #160 (MoreSheet/LinePicker/InstallPrompt close buttons) — those are distinct controls. · (branch: none yet)
