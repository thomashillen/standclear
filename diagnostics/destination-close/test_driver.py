import io
import json
from pathlib import Path
import plistlib
import signal
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import driver


FIXTURES = Path(__file__).with_name("fixtures")
CASE = "Test Case '-[StandClearUITests.StandClearUITests testPlaceDestinationEditingExpanded]' "


class OutcomeReporting(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.out = Path(self.temp.name)
        for name in ("passed-case-timeout.log", "run-result.json"):
            dest = "xcodebuild.log" if name.endswith(".log") else name
            (self.out / dest).write_bytes((FIXTURES / name).read_bytes())

    def test_hosted_case_pass_does_not_clear_command_timeout_or_incomplete_bundle(self):
        (self.out / "DestinationClose.xcresult/Data").mkdir(parents=True)
        before = {p.name: p.read_bytes() for p in self.out.iterdir() if p.is_file()}
        result = driver.classify_outcome(self.out)
        self.assertEqual(result["testCase"]["status"], "passed")
        self.assertEqual(result["testCase"]["events"][1]["durationSeconds"], 237.489)
        self.assertEqual(result["command"], {"status": "timed_out", "returnCode": 124, "timedOut": True})
        self.assertEqual(result["xcresult"]["state"], "incomplete")
        self.assertFalse(result["xcresult"]["infoPlistPresent"])
        self.assertFalse(result["xcresult"]["readerValidated"])
        self.assertFalse(result["productionMergeGate"])
        self.assertEqual(result["animationNotificationWarnings"], 0)
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.out.iterdir() if p.is_file()})
        for name in before:
            self.assertEqual(result["evidenceSHA256"][name], driver.sha(self.out / name))

    def test_no_case_execution_in_build_failure(self):
        (self.out / "xcodebuild.log").write_text("error: unable to type-check\n** BUILD FAILED **\n")
        driver.save(self.out / "run-result.json", {"returnCode": 65, "timedOut": False})
        result = driver.classify_outcome(self.out)
        self.assertEqual(result["testCase"]["status"], "not_observed")
        self.assertEqual(result["command"]["status"], "failed")
        self.assertEqual(result["command"]["returnCode"], 65)
        self.assertEqual(result["xcresult"]["state"], "missing")

    def test_only_one_exact_case_completion_is_classified(self):
        for status in ("passed", "failed", "skipped"):
            with self.subTest(status=status):
                log = CASE + "started.\n" + CASE + status + " (1.250 seconds).\n"
                result = driver.classify_test_case(log)
                self.assertEqual(result["status"], status)
                self.assertEqual(result["failureObserved"], status == "failed")
        self.assertEqual(driver.classify_test_case(CASE.replace("Expanded", "Compact") + "passed (1.0 seconds).\n")["status"], "not_observed")

    def test_partial_repeated_or_unrecognized_case_events_are_not_a_pass(self):
        start, passed = CASE + "started.\n", CASE + "passed (1.0 seconds).\n"
        for log, status in (
            (start, "incomplete"), (passed, "incomplete"),
            (passed + start, "ambiguous"), (start + start, "ambiguous"),
            (start + passed + start + passed, "ambiguous"),
            (start + CASE + "passed (invalid seconds).\n", "ambiguous"),
            (CASE + "unknown.\n", "ambiguous"),
        ):
            with self.subTest(log=log):
                self.assertEqual(driver.classify_test_case(log)["status"], status)
        result = driver.classify_test_case(start + CASE + "failed (2.0 seconds).\n" + start + passed)
        self.assertEqual(result["status"], "ambiguous")
        self.assertTrue(result["failureObserved"])

    def test_missing_or_invalid_command_record_never_infers_success_from_case(self):
        path = self.out / "run-result.json"
        path.unlink()
        self.assertEqual(driver.classify_outcome(self.out)["command"]["status"], "not_recorded")
        for raw in ("bad JSON", "[]", "{}", '{"returnCode": false, "timedOut": false}',
                    '{"returnCode": 0, "timedOut": "false"}'):
            with self.subTest(raw=raw):
                path.write_text(raw)
                result = driver.classify_outcome(self.out)
                self.assertEqual(result["command"]["status"], "invalid_record")
                self.assertEqual(result["testCase"]["status"], "passed")
                self.assertTrue(result["warnings"])

    def test_command_success_does_not_imply_test_execution_or_gate_success(self):
        (self.out / "xcodebuild.log").unlink()
        driver.save(self.out / "run-result.json", {"returnCode": 0, "timedOut": False})
        result = driver.classify_outcome(self.out)
        self.assertEqual(result["command"]["status"], "succeeded")
        self.assertEqual(result["testCase"]["status"], "not_observed")
        self.assertFalse(result["productionMergeGate"])

    def test_timeout_takes_precedence_over_conflicting_zero_exit(self):
        driver.save(self.out / "run-result.json", {"returnCode": 0, "timedOut": True})
        result = driver.classify_outcome(self.out)
        self.assertEqual(result["command"]["status"], "timed_out")
        self.assertEqual(result["command"]["returnCode"], 0)
        self.assertTrue(result["warnings"])

    def test_metadata_presence_is_not_reader_validation(self):
        bundle = self.out / "DestinationClose.xcresult"
        bundle.mkdir()
        info = bundle / "Info.plist"
        info.write_bytes(plistlib.dumps({"version": 1}))
        self.assertEqual(driver.classify_outcome(self.out)["xcresult"]["state"], "incomplete")
        (bundle / "Data").mkdir()
        result = driver.classify_outcome(self.out)
        self.assertEqual(result["xcresult"]["state"], "metadata_present")
        self.assertFalse(result["xcresult"]["readerValidated"])
        self.assertFalse(result["productionMergeGate"])
        for raw in (b"bad plist", b"<?xml version='1.0'?><plist><dict>", plistlib.dumps([])):
            info.write_bytes(raw)
            self.assertEqual(driver.classify_outcome(self.out)["xcresult"]["state"], "invalid_metadata")

    def test_animation_warning_count_is_observational(self):
        with (self.out / "xcodebuild.log").open("a") as log:
            log.write("App animations complete notification not received\n" * 5)
        result = driver.classify_outcome(self.out)
        self.assertEqual(result["animationNotificationWarnings"], 5)
        self.assertEqual(result["testCase"]["status"], "passed")
        self.assertEqual(result["command"]["status"], "timed_out")

    def test_run_keeps_nonzero_outcome_even_when_case_stdout_passes(self):
        driver.save(self.out / "prepared.json", {"complete": True})
        udid = "11111111-2222-3333-4444-555555555555"
        driver.save(self.out / "simulator.json", {"udid": udid, "createdByThisDriver": True})
        for timeout in (False, True):
            with self.subTest(timeout=timeout), patch.object(driver, "execution_budget", return_value=1), \
                    patch.object(driver.subprocess, "Popen") as popen, patch.object(driver.os, "killpg") as kill:
                def launch(*args, **kwargs):
                    kwargs["stdout"].write((FIXTURES / "passed-case-timeout.log").read_text())
                    return popen.return_value
                popen.side_effect = launch
                popen.return_value.pid = 42
                popen.return_value.wait.side_effect = [subprocess.TimeoutExpired("xcodebuild", 1), -2] if timeout else [65]
                with self.assertRaises(RuntimeError):
                    driver.run(self.out)
                result = driver.classify_outcome(self.out)
                self.assertEqual(result["testCase"]["status"], "passed")
                self.assertEqual(result["command"]["returnCode"], 124 if timeout else 65)
                self.assertEqual(result["command"]["status"], "timed_out" if timeout else "failed")
                if timeout:
                    kill.assert_called_once_with(42, signal.SIGINT)
                else:
                    kill.assert_not_called()


class DiagnosticSafeguards(unittest.TestCase):
    def test_execution_budget_reserves_collection_and_upload(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp)
            driver.save(out / "job-budget.json", {"startedMonotonic": 1000})
            self.assertEqual(driver.execution_budget(out, now=1000), 600)
            self.assertEqual(driver.execution_budget(out, now=1120), 540)
            self.assertEqual(driver.execution_budget(out, now=1650), 10)
            for now in (999, 1660, 1800):
                with self.assertRaises(RuntimeError):
                    driver.execution_budget(out, now=now)

    def test_runtime_requires_exact_build(self):
        item = {"isAvailable": True, "version": "26.4.1", "buildversion": "23E254a", "name": "iOS 26.4"}
        self.assertEqual(driver.select_runtime({"runtimes": [item]}), item)
        for change in ({"buildversion": "wrong"}, {"version": "27.2"}, {"isAvailable": False}):
            with self.assertRaises(RuntimeError):
                driver.select_runtime({"runtimes": [dict(item, **change)]})
        with self.assertRaises(RuntimeError):
            driver.select_runtime({"runtimes": [item, item]})

    def test_trace_requires_destination_records(self):
        row = {"timestamp": "2026-11-09T07:53:08Z", "eventMessage": "[SCSearchTrace] presented true -> false; destination=true focused=false query="}
        self.assertEqual(driver.validate_trace(json.dumps([row])), 1)
        for raw in ("not JSON", "[]", "{}", '[{}]', json.dumps([dict(row, eventMessage="unrelated")])):
            with self.assertRaises((ValueError, RuntimeError)):
                driver.validate_trace(raw)

    def test_command_keeps_stderr_separate_from_json(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp)
            value = driver.command([sys.executable, "-c", 'import sys; print("[]"); print("warning", file=sys.stderr)'], out, "probe")
            self.assertEqual(json.loads(value), [])
            self.assertIn("warning", (out / "probe-stderr.log").read_text())

    def test_timeout_keeps_partial_output(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp)
            with self.assertRaises(subprocess.TimeoutExpired):
                driver.command([sys.executable, "-c", 'import time; print("partial", flush=True); time.sleep(5)'], out, "probe", timeout=0.5)
            self.assertIn("partial", (out / "probe.log").read_text())

    def test_collection_keeps_malformed_trace_and_only_shuts_owned_device(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp)
            udid = "11111111-2222-3333-4444-555555555555"
            driver.save(out / "simulator.json", {"udid": udid, "createdByThisDriver": True})

            def fake_command(args, output, label, **kwargs):
                (output / (label + ".log")).write_text("malformed raw evidence")
                return "malformed raw evidence"

            with patch.object(driver, "command", side_effect=fake_command), patch.object(driver, "sim") as sim:
                with self.assertRaises(RuntimeError):
                    driver.collect(out)
                sim.assert_called_once_with(["shutdown", udid], out, "shutdown-owned", timeout=15)
            self.assertEqual((out / "search-state.log").read_text(), "malformed raw evidence")
            report = json.loads((out / "collection-report.json").read_text())
            self.assertEqual(report["trace"], "raw-preserved")
            self.assertEqual(report["outcomeReport"], "outcome-report.json")
            self.assertEqual(report["traceCoverage"], "ambiguous")
            self.assertEqual(report["traceCoverageReport"], "trace-coverage.json")
            self.assertFalse(json.loads((out / "outcome-report.json").read_text())["productionMergeGate"])

    def test_invalid_ownership_never_targets_simulator(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp)
            driver.save(out / "simulator.json", {"udid": "11111111-2222-3333-4444-555555555555", "createdByThisDriver": False})
            with patch.object(driver, "sim") as sim, patch.object(driver, "command") as command:
                with self.assertRaises(RuntimeError):
                    driver.collect(out)
                sim.assert_not_called()
                command.assert_not_called()

    def test_unsafe_archive_path_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp)
            archive = out / "bad.tar"
            with tarfile.open(archive, "w") as handle:
                item = tarfile.TarInfo("../escaped")
                item.size = 4
                handle.addfile(item, io.BytesIO(b"oops"))
            with self.assertRaises(RuntimeError):
                driver.extract_archive(archive, out / "source")
            self.assertFalse((out / "escaped").exists())


if __name__ == "__main__":
    unittest.main()
