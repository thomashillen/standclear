// MTA stop_times uses directional child platform IDs. Generic GTFS direction_id
// is only a trip grouping flag and is not a compass/operational direction.
export function platformDirection(stopIDs) {
  if (stopIDs.length < 2) throw new Error("Representative trip needs at least two platforms");
  const directions = new Set(stopIDs.map(id => {
    const match = /^[A-Za-z0-9]+([NS])$/.exec(id);
    if (!match) throw new Error(`Missing directional platform suffix: ${id}`);
    return match[1];
  }));
  if (directions.size !== 1) throw new Error("Representative trip has inconsistent platform directions");
  return [...directions][0];
}
