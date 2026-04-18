import gtfsData from "./gtfsData.json";

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

export const LINES: Record<string, SubwayLine> = gtfsData.lines as unknown as Record<string, SubwayLine>;

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
