/**
 * Central priority order for which surface ESC dismisses first when
 * multiple panels are open at once.
 *
 * The bottom-sheet panels in SubwayMap are mostly mutually exclusive,
 * but a few combinations are legitimate: a station detail can sit
 * under an open SearchSheet (the rider hit Search from a station
 * page), and cinematic follow-mode runs alongside whatever panel was
 * open when the rider tapped a train marker. Codifying the order as a
 * pure helper keeps the keydown effect in SubwayMap small and gives
 * us a node-env regression test against silent reordering.
 *
 * The Radix-managed dialogs (LiveTrainsPopup, MoreSheet's nested
 * AlertsDialog / AboutDialog) intentionally do NOT appear here.
 * Radix dismisses them via a capture-phase document listener that
 * calls event.preventDefault(); SubwayMap's keydown effect then
 * short-circuits on `event.defaultPrevented` so this priority list
 * only runs when no Radix layer claimed the keypress.
 */
export type DismissablePanelState = {
  searchOpen: boolean;
  stationOpen: boolean;
  lineOpen: boolean;
  nearbyOpen: boolean;
  moreOpen: boolean;
  followActive: boolean;
};

export type DismissTarget =
  | "search"
  | "station"
  | "line"
  | "nearby"
  | "more"
  | "follow"
  | null;

export function pickDismissTarget(state: DismissablePanelState): DismissTarget {
  // SearchSheet is the most modal — the rider is mid-typing or
  // mid-route-selection and any other panel underneath is
  // contextually frozen until search dismisses.
  if (state.searchOpen) return "search";
  // StationPanel and LinePanel are leaf detail views — close them
  // before falling back to the default Nearby pane.
  if (state.stationOpen) return "station";
  if (state.lineOpen) return "line";
  // NearbyPanel is the resting first-load surface; closing it
  // returns the rider to the bare map.
  if (state.nearbyOpen) return "nearby";
  // MoreSheet sits on top visually but logically it's the settings
  // surface — only dismissed once nothing more specific is open.
  if (state.moreOpen) return "more";
  // Cinematic follow-mode is the last layer ESC can exit. It runs
  // alongside the map (no panel chrome of its own) so it's the
  // final fallback before ESC is a no-op.
  if (state.followActive) return "follow";
  return null;
}
