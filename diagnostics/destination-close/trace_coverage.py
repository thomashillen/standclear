"""Describe observed search transitions without assigning a native action cause."""
import datetime as dt
import hashlib
import json
import math
import re


MESSAGE = re.compile(
    r"\[SCSearchTrace\] (?P<event>appear|disappear|(?:presented|focused) (?:true|false) -> (?:true|false)); "
    r"destination=(?P<destination>true|false) presented=(?P<presented>true|false) focused=(?P<focused>true|false) "
    r"query=(?P<query>.*?) uptime=(?P<uptime>\d+(?:\.\d+)?)"
)


def summarize_trace(raw):
    report = {"textSHA256": hashlib.sha256(raw.encode()).hexdigest(), "errors": [], "destinationIntervals": [],
              "coverage": "not_observed", "nativeCloseActionDelivery": "not_recorded", "productionMergeGate": False,
              "limitations": ["An appearance interval is not a stable view identity or a verified Close action window.",
                              "Observed state transitions do not establish which native action ran or every coalesced write.",
                              "Later appearances are separate intervals; their activations are not attributed to an earlier Close."]}
    try:
        rows = json.loads(raw)
        if not isinstance(rows, list):
            raise ValueError("Trace must be an array")
        identity, previous, current = None, None, None
        for number, row in enumerate(rows, 1):
            if not isinstance(row, dict) or not isinstance(row.get("eventMessage"), str):
                raise ValueError(f"Row {number}: missing eventMessage")
            match = MESSAGE.fullmatch(row["eventMessage"])
            if not match:
                raise ValueError(f"Row {number}: unrecognized trace record")
            if match["destination"] != "true":
                continue
            stamp = dt.datetime.fromisoformat(row["timestamp"])
            uptime = float(match["uptime"])
            if stamp.tzinfo is None or not math.isfinite(uptime):
                raise ValueError(f"Row {number}: invalid clock evidence")
            process = (row.get("bootUUID"), row.get("processID"))
            if not isinstance(process[0], str) or not process[0] or type(process[1]) is not int or process[1] <= 0:
                raise ValueError(f"Row {number}: missing boot/process identity")
            if identity is not None and identity != process:
                raise ValueError(f"Row {number}: multiple boot/process identities; cannot join intervals")
            if previous and (stamp < previous[0] or uptime < previous[1]):
                raise ValueError(f"Row {number}: out-of-order clock evidence")
            identity, previous = process, (stamp, uptime)
            event = {"row": number, "timestamp": row["timestamp"], "uptime": uptime, "event": match["event"],
                     "presented": match["presented"] == "true", "focused": match["focused"] == "true", "query": match["query"]}
            if " -> " in event["event"]:
                field, old, _, new = event["event"].split()
                if (new == "true") != event[field]:
                    raise ValueError(f"Row {number}: observer/snapshot disagreement; cannot infer sequence")
            if event["event"] == "appear":
                if current is not None:
                    raise ValueError(f"Row {number}: overlapping appearances without view identity")
                current = {"startRow": number, "endRow": None, "events": []}
                report["destinationIntervals"].append(current)
            if current is None:
                # Initial observers run before appear. They establish no transition interval.
                if " -> " in event["event"] and old == new:
                    continue
                raise ValueError(f"Row {number}: transition/disappearance outside an appearance interval")
            current["events"].append(event)
            if event["event"] == "disappear":
                current["endRow"] = number
                current = None
        report["coverage"] = "open_interval" if current else ("bounded_intervals" if report["destinationIntervals"] else "not_observed")
    except (ValueError, KeyError, TypeError) as error:
        report["coverage"] = "ambiguous"
        report["errors"].append(str(error))

    # Do not derive transition conclusions from malformed or mixed evidence.
    if not report["errors"]:
        for interval in report["destinationIntervals"]:
            interval["observedReactivationRows"] = []
            deactivated = False
            activations, deactivations = [], []
            for event in interval["events"]:
                if event["event"] == "presented true -> false":
                    deactivations.append(event["row"])
                    deactivated = True
                elif event["event"] == "presented false -> true":
                    activations.append(event["row"])
                    if deactivated:
                        interval["observedReactivationRows"].append(event["row"])
            interval["observedActivationRows"] = activations
            interval["observedDeactivationRows"] = deactivations
            interval["observationScope"] = ("activation_and_deactivation" if activations and deactivations
                                           else "activation_only" if activations else "deactivation_only" if deactivations
                                           else "no_presentation_transition")
    return report
