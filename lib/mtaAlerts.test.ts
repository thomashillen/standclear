// @vitest-environment node
import { describe, it, expect } from "vitest";
import { severityOf } from "./mtaAlerts";

// `severityOf` is the load-bearing classifier shared by the rider-facing
// alerts panel (severity-tinted badges in StationPanel + LinePanel +
// AlertsButton + /status) and the push-notification dispatch
// (`lib/pushDispatch.ts` filters to `severity === "severe"` before fanning
// out to subscribers). A misclassification either silently drops a
// severe alert from the push fanout or wakes riders up for routine
// chatter — both are trust-eroding in opposite directions, so the
// matrix below pins each branch explicitly.
//
// Two structural invariants the function encodes that are easy to
// regress in:
//   1. Effect-driven results trust the GTFS-RT enum: when MTA tags an
//      alert with NO_SERVICE / SIGNIFICANT_DELAYS / REDUCED_SERVICE /
//      DETOUR / MODIFIED_SERVICE / STOP_MOVED, the header is NOT
//      consulted, even if the header phrasing would scan as a
//      different tier.
//   2. The header scan only runs for non-informative effects
//      (UNKNOWN_EFFECT being the common one — MTA's feed publishes
//      it for the majority of advisories), and severe-phrasing checks
//      run before warning-phrasing checks so an alert that mentions
//      both ("suspended … with delays") lands on severe, not warning.

describe("severityOf — effect-driven branches (header ignored)", () => {
  it("NO_SERVICE → severe regardless of header", () => {
    expect(severityOf("NO_SERVICE", "everything is fine")).toBe("severe");
    expect(severityOf("NO_SERVICE", "")).toBe("severe");
  });

  it("SIGNIFICANT_DELAYS → severe regardless of header", () => {
    expect(severityOf("SIGNIFICANT_DELAYS", "")).toBe("severe");
    expect(severityOf("SIGNIFICANT_DELAYS", "minor inconvenience")).toBe(
      "severe",
    );
  });

  it("REDUCED_SERVICE → warning", () => {
    expect(severityOf("REDUCED_SERVICE", "")).toBe("warning");
  });

  it("DETOUR → warning", () => {
    expect(severityOf("DETOUR", "")).toBe("warning");
  });

  it("MODIFIED_SERVICE → warning", () => {
    expect(severityOf("MODIFIED_SERVICE", "")).toBe("warning");
  });

  it("STOP_MOVED → warning", () => {
    expect(severityOf("STOP_MOVED", "")).toBe("warning");
  });

  it("trusts the enum: DETOUR with a header that scans as severe stays warning", () => {
    // Operator-facing invariant. If MTA picked DETOUR they meant
    // DETOUR; we shouldn't escalate to severe because someone typed
    // "no service" into the headline of a detour advisory.
    expect(severityOf("DETOUR", "F trains have no service at 14 St")).toBe(
      "warning",
    );
    expect(
      severityOf("REDUCED_SERVICE", "Train suspended overnight"),
    ).toBe("warning");
  });

  it("trusts the enum: NO_SERVICE with a benign header stays severe", () => {
    expect(severityOf("NO_SERVICE", "delays")).toBe("severe");
  });
});

describe("severityOf — header-driven severe (effect is UNKNOWN_EFFECT)", () => {
  // MTA's feed mostly publishes effect=UNKNOWN_EFFECT and packs the
  // real state into the header. These cases mirror the real-world
  // headlines we've observed.

  it("'No [F] service tonight' → severe (matches /^no \\[/)", () => {
    expect(severityOf("UNKNOWN_EFFECT", "No [F] service tonight")).toBe(
      "severe",
    );
  });

  it("'[F] no service in both directions' → severe (matches ' no service')", () => {
    expect(
      severityOf("UNKNOWN_EFFECT", "[F] no service in both directions"),
    ).toBe("severe");
  });

  it("'F train suspended' → severe (matches 'suspended')", () => {
    expect(severityOf("UNKNOWN_EFFECT", "F train suspended")).toBe("severe");
  });

  it("'Expect significant delays' → severe (matches 'significant delay')", () => {
    expect(severityOf("UNKNOWN_EFFECT", "Expect significant delays")).toBe(
      "severe",
    );
  });

  it("is case-insensitive — header is lowercased before matching", () => {
    expect(severityOf("UNKNOWN_EFFECT", "F TRAIN SUSPENDED")).toBe("severe");
    expect(severityOf("UNKNOWN_EFFECT", "No [F] SERVICE")).toBe("severe");
  });
});

describe("severityOf — header-driven warning (effect is UNKNOWN_EFFECT)", () => {
  it("'Delays on the F line' → warning", () => {
    expect(severityOf("UNKNOWN_EFFECT", "Delays on the F line")).toBe(
      "warning",
    );
  });

  it("'F trains rerouted via the M' → warning", () => {
    expect(severityOf("UNKNOWN_EFFECT", "F trains rerouted via the M")).toBe(
      "warning",
    );
  });

  it("'F runs express from W 4 St' → warning", () => {
    expect(severityOf("UNKNOWN_EFFECT", "F runs express from W 4 St")).toBe(
      "warning",
    );
  });

  it("'F runs local from 47-50 Sts' → warning", () => {
    expect(severityOf("UNKNOWN_EFFECT", "F runs local from 47-50 Sts")).toBe(
      "warning",
    );
  });

  it("'F trains bypass 14 St' → warning", () => {
    expect(severityOf("UNKNOWN_EFFECT", "F trains bypass 14 St")).toBe(
      "warning",
    );
  });

  it("'F trains skipping 23 St' → warning", () => {
    expect(severityOf("UNKNOWN_EFFECT", "F trains skipping 23 St")).toBe(
      "warning",
    );
  });

  it("'Trains every 20 minutes' → warning (matches 'every ')", () => {
    expect(severityOf("UNKNOWN_EFFECT", "Trains every 20 minutes")).toBe(
      "warning",
    );
  });
});

describe("severityOf — info fallback", () => {
  it("empty header + non-informative effect → info", () => {
    expect(severityOf("UNKNOWN_EFFECT", "")).toBe("info");
    expect(severityOf("OTHER_EFFECT", "")).toBe("info");
    expect(severityOf("NO_EFFECT", "")).toBe("info");
    expect(severityOf("ACCESSIBILITY_ISSUE", "")).toBe("info");
  });

  it("ADDITIONAL_SERVICE (extra trains, not a disruption) falls through to info", () => {
    // GTFS-RT effect 5 — the feed publishes this for tail-end "extra
    // service" advisories that aren't disruptions. The function
    // doesn't early-return on it, so a benign header lands info.
    expect(severityOf("ADDITIONAL_SERVICE", "Extra weekend service")).toBe(
      "info",
    );
  });

  it("benign header with non-informative effect → info", () => {
    expect(
      severityOf("UNKNOWN_EFFECT", "Track maintenance overnight"),
    ).toBe("info");
    expect(severityOf("UNKNOWN_EFFECT", "FYI: schedule update")).toBe("info");
  });

  it("'no service' without leading space or bracket → info (regex + substring guards)", () => {
    // The severe-phrase checks are deliberately narrow:
    //   /^no \[/ requires the bracketed-route prefix MTA actually uses
    //   ' no service' requires the leading space MTA's "[F] no service…"
    //                phrasing produces.
    // A bare 'no service' standalone string matches neither — this
    // pins that intentional narrowness so a future loosening of the
    // checks is visible.
    expect(severityOf("UNKNOWN_EFFECT", "no service")).toBe("info");
  });

  it("an effect string the function doesn't recognize falls through to header scan", () => {
    // Future-proofing: if MTA adds a new GTFS-RT effect enum value
    // we haven't classified yet, the function should still produce a
    // sensible verdict from the header rather than throwing.
    expect(severityOf("BRAND_NEW_EFFECT_2027", "")).toBe("info");
    expect(severityOf("BRAND_NEW_EFFECT_2027", "delays")).toBe("warning");
    expect(severityOf("BRAND_NEW_EFFECT_2027", "suspended")).toBe("severe");
  });
});

describe("severityOf — header-driven priority order", () => {
  it("severe phrasing beats warning phrasing when both are present", () => {
    // 'suspended' (severe) + 'delays' (warning) — severe wins because
    // the severe-block check runs first. A reviewer might be
    // tempted to merge the two blocks; this test trips if that
    // happens and the ordering is lost.
    expect(severityOf("UNKNOWN_EFFECT", "F suspended, expect delays")).toBe(
      "severe",
    );
    expect(
      severityOf(
        "UNKNOWN_EFFECT",
        "Significant delays — trains every 20 minutes",
      ),
    ).toBe("severe");
  });
});
