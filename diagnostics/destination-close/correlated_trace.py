"""Offline comparison of command markers and app observations, never handler proof."""
import hashlib
import json
import math
import re

from correlated_candidate import NUMBER, UUID, parse_commands
from trace_coverage import MESSAGE, summarize_trace


APP_RECORD = re.compile(rf"\[SCSearchTraceV2\] session=({UUID}) (.*) uptime=({NUMBER}) wall=({NUMBER})")


def normalize_app_trace(raw):
    rows = json.loads(raw)
    if not isinstance(rows, list) or not rows:
        raise ValueError("Expected nonempty V2 app trace")
    normalized, observations = [], []
    for number, row in enumerate(rows, 1):
        match = APP_RECORD.fullmatch(row.get("eventMessage", "")) if isinstance(row, dict) else None
        if not match:
            raise ValueError(f"Row {number}: malformed V2 app trace")
        session, body, uptime_text, wall_text = match.groups()
        uptime, wall = float(uptime_text), float(wall_text)
        if not all(math.isfinite(v) and v >= 0 for v in (uptime, wall)):
            raise ValueError(f"Row {number}: invalid app clocks")
        message = f"[SCSearchTrace] {body} uptime={uptime_text}"
        parsed = MESSAGE.fullmatch(message)
        if not parsed:
            raise ValueError(f"Row {number}: unrecognized app observation")
        normalized.append(dict(row, eventMessage=message))
        observations.append({"row": number, "session": session, "uptime": uptime, "wall": wall,
                             "destination": parsed["destination"] == "true", "event": parsed["event"],
                             "presented": parsed["presented"] == "true", "focused": parsed["focused"] == "true"})
    return normalized, observations


def correlate(raw, command_log):
    commands = parse_commands(command_log)
    report = {"commands": commands, "markerTransportQualified": False, "clockOrdering": "unassessed",
              "nativeCloseActionDelivery": "not_recorded", "viewIdentity": "not_recorded",
              "productionMergeGate": False, "errors": [], "observations": [],
              "inputTextSHA256": {"appTrace": hashlib.sha256(raw.encode()).hexdigest(),
                                  "commandLog": hashlib.sha256(command_log.encode()).hexdigest()},
              "limitations": ["Tap return is command completion, not proof of native handler entry.",
                              "Clock-order agreement is observational, not proof of causation or every binding write.",
                              "A test-session token and appearance interval do not identify a stable SwiftUI view."]}
    try:
        normalized, observations = normalize_app_trace(raw)
        coverage = summarize_trace(json.dumps(normalized))
        report["coverage"] = coverage
        report["observations"] = observations
        if coverage["errors"]:
            raise ValueError("App lifecycle evidence is ambiguous: " + "; ".join(coverage["errors"]))
        if not any(row["destination"] for row in observations):
            raise ValueError("Destination observations absent")
        if commands["status"] != "tap_returned":
            raise ValueError("Close tap boundary sequence not complete: " + commands["status"])
        session = commands["events"][0]["session"]
        if {row["session"] for row in observations} != {session}:
            raise ValueError("App/command sessions do not match")
        if any(b[clock] < a[clock] for a, b in zip(observations, observations[1:]) for clock in ("uptime", "wall")):
            raise ValueError("App clock order changed")
        report["markerTransportQualified"] = True
        boundaries = commands["events"][1:]  # Tap begin, tap return, next Back assertion begin.
        positions = ("before_close_command", "during_close_command", "after_return_before_back", "after_back_boundary")
        conflicts = []
        for row in observations:
            def position(clock):
                if any(row[clock] == edge[clock] for edge in boundaries):
                    return "at_boundary"
                return positions[sum(row[clock] > edge[clock] for edge in boundaries)]
            wall_position, uptime_position = position("wall"), position("uptime")
            row["temporalPosition"] = wall_position if wall_position == uptime_position else "ambiguous_clock_order"
            if "at_boundary" in (wall_position, uptime_position) or wall_position != uptime_position:
                conflicts.append(row["row"])
        report["clockOrdering"] = "ambiguous" if conflicts else "consistent_observed_order"
        report["ambiguousClockRows"] = conflicts
        offsets = [e["wall"] - e["uptime"] for e in observations + commands["events"]]
        report["wallMinusUptimeRangeSeconds"] = [min(offsets), max(offsets)]
        report["destinationCloseWindowRows"] = [r["row"] for r in observations if r["destination"] and
                                                r["temporalPosition"] in ("during_close_command", "after_return_before_back")]
    except (ValueError, KeyError, TypeError) as error:
        report["errors"].append(str(error))
    return report
