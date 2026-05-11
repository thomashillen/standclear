// Compact "Until Sun 5 AM" / "Ends in 45 min" sub-label for service
// alerts. The MTA alerts feed carries an active_period with start/end
// timestamps that the API already plumbs through as ServiceAlert.startTime
// + endTime (unix seconds), but the UI was rendering nothing — a rider
// reading "No [Q] service" had no idea whether service returns in 30
// minutes or 30 hours.
//
// We render in NYC time because the alerts ARE about NYC subway service
// and a rider in a different device timezone seeing "until 6:30 PM" in
// their local time would misread the actual return time. Apple's
// Transit/Maps pin transit times to the city's tz for the same reason.

const TZ = "America/New_York";

// Cap on how far in the future we'll render a precise label. The API
// filter already guarantees the alert is currently active (start ≤ now
// ≤ end), but MTA sometimes sets sentinel year-2099 end_times to mean
// "indefinite" — formatting those as "Until Jan 1, 2099" adds noise
// instead of signal. 14 days covers the longest realistic weekend GO
// and overnight construction window the rider would budget around.
const FAR_FUTURE_HORIZON_SEC = 14 * 86_400;

export interface FormatAlertWindowInput {
  // ServiceAlert.startTime — unix seconds, or null when the protobuf
  // entity omitted active_period.
  startTime: number | null;
  endTime: number | null;
  // Unix seconds, typically `Date.now() / 1000` at render time.
  now: number;
}

export function formatAlertWindow(input: FormatAlertWindowInput): string | null {
  const { startTime, endTime, now } = input;
  if (!Number.isFinite(now)) return null;

  const startVal =
    startTime !== null && Number.isFinite(startTime) ? startTime : null;
  const endVal =
    endTime !== null && Number.isFinite(endTime) ? endTime : null;

  // Future-scheduled. The API filter only returns active windows, but a
  // slight skew between device and server clocks can briefly land an
  // alert here — surface the start anyway so the rider knows when it
  // begins.
  if (startVal !== null && startVal > now) {
    const point = formatPoint(startVal * 1000, now * 1000);
    return point ? `Starts ${point}` : null;
  }

  if (endVal === null) return null;
  const remaining = endVal - now;
  if (remaining <= 0) return null;
  if (remaining > FAR_FUTURE_HORIZON_SEC) return null;

  // Inside the final hour — surface the countdown verbatim so a rider
  // browsing alerts knows the window is closing.
  if (remaining <= 60 * 60) {
    const mins = Math.max(1, Math.ceil(remaining / 60));
    return `Ends in ${mins} min`;
  }

  const point = formatPoint(endVal * 1000, now * 1000);
  return point ? `Until ${point}` : null;
}

// Render a calendar point as "11 PM" (same day), "Mon 5 AM" (within a
// week), or "May 21" (further out). We compare NYC calendar days, not
// absolute timestamps, so a 1 AM Saturday end-time reads "Sat 1 AM" to
// a rider checking on Friday evening rather than "Tomorrow at 1 AM".
function formatPoint(targetMs: number, nowMs: number): string {
  const dayDelta = nycDaysBetween(nowMs, targetMs);
  const timePart = formatTime(targetMs);

  if (dayDelta <= 0) return timePart;
  if (dayDelta <= 6) return `${formatWeekday(targetMs)} ${timePart}`;
  return formatDate(targetMs);
}

function formatTime(ms: number): string {
  const out = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: TZ,
  }).format(new Date(ms));
  // Drop ":00" on the hour ("11:00 PM" → "11 PM"). Tighter on a small
  // screen and matches Apple's Maps/Weather idiom.
  return out.replace(/:00(\s)/, "$1");
}

function formatWeekday(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: TZ,
  }).format(new Date(ms));
}

function formatDate(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: TZ,
  }).format(new Date(ms));
}

// Whole NYC calendar days from `aMs` to `bMs`. Pulls the locale-formatted
// y/m/d in TZ then computes day delta via UTC noon arithmetic to dodge
// DST jumps.
function nycDaysBetween(aMs: number, bMs: number): number {
  const a = nycDateKey(aMs);
  const b = nycDateKey(bMs);
  const da = Date.UTC(a.y, a.m - 1, a.d);
  const db = Date.UTC(b.y, b.m - 1, b.d);
  return Math.round((db - da) / 86_400_000);
}

function nycDateKey(ms: number): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  let y = 0;
  let m = 0;
  let d = 0;
  for (const p of parts) {
    if (p.type === "year") y = Number(p.value);
    else if (p.type === "month") m = Number(p.value);
    else if (p.type === "day") d = Number(p.value);
  }
  return { y, m, d };
}
