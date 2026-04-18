export interface Stop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  shapeIdx: number;
}

export interface SubwayLine {
  id: string;          // Display id ("1", "A", "S", "SI")
  routeId: string;     // GTFS route_id ("1", "A", "GS", "FS", "H", "SI")
  name: string;
  color: string;
  textColor: "white" | "black";
  stops: Stop[];
  shape: [number, number][]; // [lng, lat] coordinates following actual track
}

// IMPORTANT: do not change to `import gtfsData from "./gtfsData.json"`.
//
// With a static JSON import + `resolveJsonModule`, TypeScript walks the 439KB
// JSON and infers a literal type for every line, stop, and shape coordinate.
// That type then propagates through every module that transitively imports
// this file, ballooning tsserver memory into multiple GB and freezing the
// editor on every keystroke (this combination of TS 6 + Next 16 + the new
// react-hooks v7 plugin previously caused a 65GB memory blow-up).
//
// `require()` returns `any` — TS skips the JSON literal inference entirely.
// Webpack and Turbopack both transform this into a normal bundled import at
// build time, so runtime behavior is unchanged.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gtfsData = require("./gtfsData.json") as { lines: Record<string, SubwayLine> };

export const LINES: Record<string, SubwayLine> = gtfsData.lines;

// Order matches the official MTA "Lines" panel: numbered (IRT), 8 Av (ACE),
// 6 Av (BDFM), Crosstown (G), Nassau (JZ), Canarsie (L), Broadway (NQRW),
// Shuttles, Staten Island.
export const LINE_GROUPS: { label: string; lines: string[] }[] = [
  { label: "IRT", lines: ["1", "2", "3", "4", "5", "6", "7"] },
  { label: "IND", lines: ["A", "C", "E", "B", "D", "F", "M", "G"] },
  { label: "BMT", lines: ["J", "Z", "L", "N", "Q", "R", "W"] },
  { label: "S",   lines: ["GS", "FS", "H"] },
  { label: "SI",  lines: ["SI"] },
];
