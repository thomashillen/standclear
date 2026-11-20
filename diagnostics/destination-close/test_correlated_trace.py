import copy
import datetime as dt
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import driver
from correlated_trace import correlate, normalize_app_trace


SESSION = "11111111-2222-3333-4444-555555555555"


def row(event, uptime, presented=False, focused=False):
    wall = 1000 + uptime
    return {"timestamp": dt.datetime.fromtimestamp(wall, dt.timezone.utc).isoformat(), "processID": 1, "bootUUID": "boot",
            "eventMessage": f"[SCSearchTraceV2] session={SESSION} {event}; destination=true presented={str(presented).lower()} focused={str(focused).lower()} query= uptime={uptime} wall={wall}"}


def markers():
    return "\n".join(f"[SCSearchCommand] session={SESSION} event={event} uptime={t} wall={1000 + t}"
                     for event, t in (("close.exists.begin", 2.0), ("close.tap.begin", 3.0),
                                      ("close.tap.return", 4.5), ("back.assertion.begin", 5.5)))


class CorrelatedTrace(unittest.TestCase):
    def setUp(self):
        self.rows = [row("appear", 1.0), row("presented false -> true", 1.5, True),
                     row("presented true -> false", 4.0), row("disappear", 6.0)]

    def test_consistent_markers_and_observations_remain_noncausal(self):
        original = copy.deepcopy(self.rows)
        report = correlate(json.dumps(self.rows), markers())
        self.assertTrue(report["markerTransportQualified"])
        self.assertEqual(report["clockOrdering"], "consistent_observed_order")
        self.assertEqual(report["destinationCloseWindowRows"], [3])
        self.assertEqual(report["nativeCloseActionDelivery"], "not_recorded")
        self.assertEqual(report["viewIdentity"], "not_recorded")
        self.assertFalse(report["productionMergeGate"])
        self.assertEqual(self.rows, original)

    def test_clock_conflict_and_exact_boundary_are_explicit(self):
        for wall in (1007.0, 1004.5):
            rows = copy.deepcopy(self.rows)
            rows[2]["eventMessage"] = rows[2]["eventMessage"].replace("wall=1004.0", f"wall={wall}")
            # Keep app wall order valid so this probes inter-stream ordering.
            rows[3]["eventMessage"] = rows[3]["eventMessage"].replace("wall=1006.0", "wall=1009.0")
            report = correlate(json.dumps(rows), markers())
            self.assertEqual(report["clockOrdering"], "ambiguous")
            self.assertEqual(report["ambiguousClockRows"], [3])
            self.assertNotIn(3, report["destinationCloseWindowRows"])

    def test_missing_malformed_or_truncated_data_never_qualifies(self):
        for raw in ("bad JSON", "[]", "{}", "[{}]", json.dumps([dict(self.rows[0], eventMessage=1)])):
            self.assertFalse(correlate(raw, markers())["markerTransportQualified"])
        for log in ("", markers().splitlines()[0], markers().replace("close.tap.return", "unknown")):
            self.assertFalse(correlate(json.dumps(self.rows), log)["markerTransportQualified"])

    def test_mixed_sessions_or_processes_are_not_correlated(self):
        rows = copy.deepcopy(self.rows)
        rows[2]["eventMessage"] = rows[2]["eventMessage"].replace(SESSION, "99999999-2222-3333-4444-555555555555")
        self.assertFalse(correlate(json.dumps(rows), markers())["markerTransportQualified"])
        rows = copy.deepcopy(self.rows)
        rows[2]["processID"] = 2
        self.assertFalse(correlate(json.dumps(rows), markers())["markerTransportQualified"])

    def test_later_reopen_is_outside_close_command_window(self):
        rows = self.rows + [row("appear", 7.0), row("presented false -> true", 8.0, True), row("disappear", 9.0, True)]
        report = correlate(json.dumps(rows), markers())
        self.assertEqual(report["destinationCloseWindowRows"], [3])
        self.assertEqual(report["observations"][5]["temporalPosition"], "after_back_boundary")
        self.assertEqual(report["coverage"]["destinationIntervals"][1]["observedReactivationRows"], [])

    def test_no_state_transition_is_not_reclassified_as_native_failure(self):
        rows = [row("appear", 1.0, True), row("disappear", 6.0, True)]
        report = correlate(json.dumps(rows), markers())
        self.assertTrue(report["markerTransportQualified"])
        self.assertEqual(report["destinationCloseWindowRows"], [])
        self.assertEqual(report["nativeCloseActionDelivery"], "not_recorded")

    def test_nonfinite_and_reordered_app_clocks_fail_closed(self):
        rows = copy.deepcopy(self.rows)
        rows[2]["eventMessage"] = rows[2]["eventMessage"].replace("wall=1004.0", "wall=1e999")
        with self.assertRaises(ValueError):
            normalize_app_trace(json.dumps(rows))
        rows = [self.rows[0], self.rows[2], self.rows[1], self.rows[3]]
        self.assertFalse(correlate(json.dumps(rows), markers())["markerTransportQualified"])

    def test_collector_preserves_raw_and_timeout_outcome_on_both_qualification_results(self):
        for raw, valid in ((json.dumps(self.rows), True), ("invalid trace", False)):
            with self.subTest(valid=valid), tempfile.TemporaryDirectory() as temp:
                out = Path(temp)
                driver.save(out / "metadata.json", {"correlated": True})
                driver.save(out / "simulator.json", {"createdByThisDriver": True, "udid": SESSION})
                driver.save(out / "run-result.json", {"returnCode": 124, "timedOut": True})
                (out / "xcodebuild.log").write_text(markers())
                def fake_command(args, output, label, **kwargs):
                    self.assertIn('eventMessage BEGINSWITH "[SCSearchTraceV2]"', args)
                    (output / (label + ".log")).write_text(raw)
                    return raw
                with patch.object(driver, "command", side_effect=fake_command), patch.object(driver, "sim") as sim:
                    if valid:
                        driver.collect(out)
                    else:
                        with self.assertRaises(RuntimeError):
                            driver.collect(out)
                    sim.assert_called_once_with(["shutdown", SESSION], out, "shutdown-owned", timeout=15)
                self.assertEqual((out / "search-state.log").read_text(), raw)
                self.assertEqual(json.loads((out / "correlation-report.json").read_text())["markerTransportQualified"], valid)
                self.assertEqual(json.loads((out / "outcome-report.json").read_text())["command"]["returnCode"], 124)

    def test_source_guard_rejects_extra_files_and_wrong_candidate_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp)
            for path in (driver.SOURCE_PATH, driver.TEST_PATH):
                file = source / path; file.parent.mkdir(parents=True, exist_ok=True); file.write_text("candidate")
            before = {driver.SOURCE_PATH: "original-app", driver.TEST_PATH: "original-test"}
            with self.assertRaises(RuntimeError):
                driver.validate_patched_source(source, before, True)
            (source / "unexpected").write_text("extra")
            with self.assertRaisesRegex(RuntimeError, "Unexpected"):
                driver.validate_patched_source(source, before, True)


if __name__ == "__main__":
    unittest.main()
