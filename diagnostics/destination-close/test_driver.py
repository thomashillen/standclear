import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import driver


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
            self.assertEqual(json.loads((out / "collection-report.json").read_text())["trace"], "raw-preserved")

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
