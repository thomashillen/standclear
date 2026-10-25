// Reduces the four-axis live-feed state of `SubwayMap` (online,
// has-data, feed-degraded, snapshot-stale) into one ordinal name +
// a screen-reader announcement string. The original chain was
// inlined 5×: aria-label, title, dot color, dot glow, text content.
// Funneling it through one derivation guarantees the parallel
// `role="status"` live region added in PR #94's spirit (announce
// state transitions, not just on-focus labels) reads the same state
// the visual chrome reflects.
//
// Offline wins, followed by confirmed feed degradation even on cold
// boot. Repeated failures must not look like a connection still pending.
// Degraded continues to outrank a stale retained snapshot.
//
// "Connecting" applies only on cold boot before the first poll lands;
// once any data has arrived, even a subsequently-stale snapshot is
// classified as stale (not connecting) so the rider doesn't see the
// state flip backwards on a long-stalled feed.
export type LiveFeedState =
  | "offline"
  | "connecting"
  | "degraded"
  | "stale"
  | "live";

export function deriveLiveFeedState(
  online: boolean,
  hasData: boolean,
  feedDegraded: boolean,
  stale: boolean,
): LiveFeedState {
  if (!online) return "offline";
  if (feedDegraded) return "degraded";
  if (!hasData) return "connecting";
  if (stale) return "stale";
  return "live";
}

// Phrased for screen-reader voice — full sentence so the announcement
// doesn't sound like a label fragment. Train count is deliberately
// omitted: the count changes on every 8 s successful poll, and
// repeating "12 trains live · 13 trains live · 12 trains live" each
// tick would drown the rider. The aria-label on the pill button still
// carries the count for on-focus reads.
export function liveFeedAnnouncement(state: LiveFeedState): string {
  switch (state) {
    case "offline":
      return "Offline. Showing last-known data.";
    case "connecting":
      return "Connecting to live feed.";
    case "degraded":
      return "Live feed degraded.";
    case "stale":
      return "Live feed stale.";
    case "live":
      return "Live feed connected.";
  }
}
