#!/usr/bin/env node
// Builds lib/gtfsData.json from MTA static GTFS at data/gtfs/
// Re-run with `npm run build:gtfs` after downloading a fresh data/gtfs_subway.zip.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const GTFS_DIR = path.resolve("data/gtfs");
const OUTPUT = path.resolve("lib/gtfsData.json");

// route_id -> display id shown on map (shuttles all become "S")
const ROUTE_ALIASES = { GS: "S", FS: "S", H: "S", SI: "SI" };
const SHUTTLE_NAMES = { GS: "42 St Shuttle", FS: "Franklin Av Shuttle", H: "Rockaway Park Shuttle" };

// Routes to include (skip express variants like 6X, 7X, FX)
const ROUTES = [
  "1","2","3","4","5","6","7",
  "A","C","E","B","D","F","M","G","J","Z","L","N","Q","R","W",
  "GS","FS","H","SI",
];

function parseCSVLine(line) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function parseCSV(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1)
    .filter(l => l.length > 0)
    .map(line => {
      const v = parseCSVLine(line);
      const o = {};
      headers.forEach((h, i) => o[h] = v[i] ?? "");
      return o;
    });
}

function isLightColor(hex) {
  if (!hex || hex.length < 6) return false;
  const c = parseInt(hex.slice(-6), 16);
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  return (0.299*r + 0.587*g + 0.114*b) > 160;
}

console.log("Reading routes.txt…");
const routesRows = parseCSV(path.join(GTFS_DIR, "routes.txt"));
const routesById = {};
for (const r of routesRows) routesById[r.route_id] = r;

console.log("Reading shapes.txt…");
const shapesRows = parseCSV(path.join(GTFS_DIR, "shapes.txt"));
const shapes = {}; // shape_id -> [[lng,lat], ...]
for (const r of shapesRows) {
  const sid = r.shape_id;
  if (!shapes[sid]) shapes[sid] = [];
  shapes[sid].push([
    parseInt(r.shape_pt_sequence, 10),
    parseFloat(r.shape_pt_lon),
    parseFloat(r.shape_pt_lat),
  ]);
}
for (const sid in shapes) {
  shapes[sid].sort((a, b) => a[0] - b[0]);
  shapes[sid] = shapes[sid].map(([_s, lng, lat]) => [lng, lat]);
}

console.log("Reading trips.txt…");
const tripsRows = parseCSV(path.join(GTFS_DIR, "trips.txt"));

// For each route, count shape usage; pick the longest shape (most points) as
// the "canonical" line geometry, and pick the longest representative trip
// (most stops) for the stop list.
const shapesByRoute = {}; // routeId -> { shapeId: tripIdSample }
for (const t of tripsRows) {
  if (!ROUTES.includes(t.route_id)) continue;
  if (!t.shape_id) continue;
  if (!shapesByRoute[t.route_id]) shapesByRoute[t.route_id] = {};
  shapesByRoute[t.route_id][t.shape_id] = t.trip_id;
}

const repShape = {}; // routeId -> shapeId (longest shape)
for (const routeId of ROUTES) {
  const m = shapesByRoute[routeId];
  if (!m) continue;
  let best = null;
  for (const sid in m) {
    const len = (shapes[sid] || []).length;
    if (!best || len > best.len) best = { sid, len };
  }
  if (best) repShape[routeId] = best.sid;
}

// We'll pick the representative trip after we know which trip covers the most
// stops on the chosen shape. To do that we need stop_times. So for now, gather
// every trip whose shape matches the chosen shape per route — we'll evaluate
// them while streaming stop_times.
const candidateTrips = {}; // tripId -> routeId
for (const t of tripsRows) {
  if (!ROUTES.includes(t.route_id)) continue;
  if (t.shape_id !== repShape[t.route_id]) continue;
  candidateTrips[t.trip_id] = t.route_id;
}
console.log(`  ${Object.keys(candidateTrips).length} candidate trips across ${ROUTES.length} routes`);

console.log("Streaming stop_times.txt…");
const tripStops = {}; // tripId -> [{ stopId, seq }]
const rl = readline.createInterface({
  input: fs.createReadStream(path.join(GTFS_DIR, "stop_times.txt")),
  crlfDelay: Infinity,
});
let firstLine = true;
for await (const line of rl) {
  if (firstLine) { firstLine = false; continue; }
  if (!line) continue;
  // Fast prefix test before full CSV parse
  const firstComma = line.indexOf(",");
  if (firstComma < 0) continue;
  const tripId = line.slice(0, firstComma);
  if (!candidateTrips[tripId]) continue;
  const parts = parseCSVLine(line);
  const stopId = parts[3] || parts[2] ? parts[3] : parts[1]; // safety; spec is [trip,arrival,departure,stop,seq] OR [trip,stop,arrival,departure,seq]
  // Use known column positions: trip_id,stop_id,arrival_time,departure_time,stop_sequence
  const sid = parts[1];
  const seq = parseInt(parts[4], 10);
  if (!tripStops[tripId]) tripStops[tripId] = [];
  tripStops[tripId].push({ stopId: sid, seq });
}
for (const t in tripStops) tripStops[t].sort((a, b) => a.seq - b.seq);

// Now pick the trip with the most stops per route
const repTrip = {}; // routeId -> tripId
for (const tripId in tripStops) {
  const routeId = candidateTrips[tripId];
  const len = tripStops[tripId].length;
  if (!repTrip[routeId] || len > tripStops[repTrip[routeId]].length) {
    repTrip[routeId] = tripId;
  }
}

console.log("Reading stops.txt…");
const stopsRows = parseCSV(path.join(GTFS_DIR, "stops.txt"));
const stops = {}; // stop_id -> { name, lat, lng, parent }
for (const s of stopsRows) {
  stops[s.stop_id] = {
    id: s.stop_id,
    name: s.stop_name,
    lat: parseFloat(s.stop_lat),
    lng: parseFloat(s.stop_lon),
    parent: s.parent_station || s.stop_id,
  };
}

function nearestShapeIdx(shape, lat, lng) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < shape.length; i++) {
    const dx = shape[i][0] - lng;
    const dy = shape[i][1] - lat;
    const d = dx*dx + dy*dy;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

console.log("Building output…");
const lines = {};
for (const routeId of ROUTES) {
  const tripId = repTrip[routeId];
  const shapeId = repShape[routeId];
  if (!tripId || !shapeId) {
    console.warn(`  ⚠ Skipping ${routeId}: no rep trip/shape`);
    continue;
  }
  const shape = shapes[shapeId] || [];
  const stopList = (tripStops[tripId] || []).map(({ stopId }) => {
    const s = stops[stopId];
    if (!s) return null;
    const parentId = s.parent;
    const parent = stops[parentId] || s;
    return {
      id: parentId,
      name: parent.name,
      lat: parent.lat,
      lng: parent.lng,
      shapeIdx: nearestShapeIdx(shape, parent.lat, parent.lng),
    };
  }).filter(Boolean);

  const route = routesById[routeId];
  const color = "#" + (route?.route_color || "808080");
  const displayId = ROUTE_ALIASES[routeId] || routeId;
  const groupKey = routeId;
  lines[groupKey] = {
    id: displayId,
    routeId,
    name: SHUTTLE_NAMES[routeId] || route?.route_long_name || routeId,
    color,
    textColor: isLightColor(color) ? "black" : "white",
    stops: stopList,
    shape,
  };
}

const out = { lines, generatedAt: new Date().toISOString() };
fs.writeFileSync(OUTPUT, JSON.stringify(out));
console.log(`✔ Wrote ${OUTPUT}`);
console.log(`  ${Object.keys(lines).length} lines, ${Object.values(lines).reduce((n, l) => n + l.stops.length, 0)} stops`);
