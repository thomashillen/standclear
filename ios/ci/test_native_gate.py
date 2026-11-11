"""Pure accounting tests. These never build, launch, or invoke Xcode tools."""

import argparse
import copy
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import native_gate as gate


INVENTORY = ["StandClearTests/LogicTests/testFirst", "StandClearTests/LogicTests/testSecond",
             "StandClearUITests/StandClearUITests/testFirst", "StandClearUITests/StandClearUITests/testSecond"]
IDENTITY = {"source": "a" * 40, "head": "b" * 40, "run": "1", "attempt": "1", "xcode": "Xcode example", "sdk": "26", "sdk_build": "example", "source_files": {"source.swift": "sha256:example"}}
SIMULATOR = {"model": "example-model", "model_name": "iPhone Example", "runtime": "example-runtime", "version": "26", "build": "example"}


def enumeration(inventory=INVENTORY):
    return {"errors": [], "values": [{"testPlan": "StandClear", "disabledTests": [],
                                       "enabledTests": [{"identifier": t + "()"} for t in inventory]}]}


def results(cases):
    device = {"platform": "iOS Simulator", "modelName": "iPhone Example", "osVersion": "26", "osBuildNumber": "example", "architecture": "arm64", "deviceId": "local-device"}
    nodes = []
    for case in cases:
        _, name, method = case.split("/")
        nodes.append({"nodeType": "Test Case", "name": method + "()", "nodeIdentifier": name + "/" + method + "()",
                      "nodeIdentifierURL": "test://com.apple.xcode/StandClear/" + case, "result": "Passed"})
    tree = {"devices": [device], "testNodes": [{"nodeType": "Test Plan", "name": "StandClear", "result": "Passed", "children": nodes}]}
    summary = {"result": "Passed", "passedTests": len(cases), "totalTestCount": len(cases), "failedTests": 0, "skippedTests": 0,
               "expectedFailures": 0, "testFailures": [], "startTime": 1.0, "finishTime": 2.0,
               "devicesAndConfigurations": [{"device": device, "passedTests": len(cases), "failedTests": 0, "skippedTests": 0, "expectedFailures": 0}]}
    return tree, summary


class AccountingTests(unittest.TestCase):
    def test_wrong_pr_head_metadata_rejected_before_reading_checkout(self):
        with patch.dict(gate.os.environ, {"PR_HEAD_SHA": "b" * 40}), patch.object(gate, "command") as command:
            with self.assertRaisesRegex(ValueError, "PR head metadata"):
                gate.identity("c" * 40)
            command.assert_not_called()

    def test_compiled_enumeration_partitions_cover_new_cases_once(self):
        document = enumeration(INVENTORY + ["StandClearUITests/StandClearUITests/testNew"])
        inventory = gate.enumeration_cases(document)
        selected = [case for stage in gate.STAGES for case in gate.partition(inventory, stage)]
        self.assertEqual(sorted(selected), inventory)
        self.assertEqual(len(selected), len(set(selected)))

    def test_disabled_duplicate_unknown_target_and_schema_fail_closed(self):
        bad = []
        document = enumeration()
        document["values"][0]["disabledTests"] = [{"identifier": INVENTORY[0]}]
        bad.append(document)
        bad.append(enumeration(INVENTORY + [INVENTORY[0]]))
        bad.append(enumeration(INVENTORY + ["OtherTests/Tests/testExtra"]))
        document = enumeration()
        document["unexpected"] = []
        bad.append(document)
        document = enumeration()
        document["errors"] = ["partial discovery"]
        bad.append(document)
        for document in bad:
            with self.subTest(document=document), self.assertRaises(ValueError):
                gate.enumeration_cases(document)

    def test_valid_results_and_runtime_warnings(self):
        tree, summary = results(INVENTORY)
        tree["testNodes"][0]["children"][0]["children"] = [{"nodeType": "Runtime Warning", "name": "Native framework warning"}]
        self.assertEqual(gate.validate_results(tree, summary, INVENTORY), INVENTORY)
        gate.validate_device(summary, SIMULATOR)

    def test_missing_duplicate_extra_and_skipped_case_rejected(self):
        for cases in (INVENTORY[:-1], INVENTORY + [INVENTORY[0]], INVENTORY + ["StandClearUITests/StandClearUITests/testUnexpected"]):
            with self.subTest(cases=cases), self.assertRaises(ValueError):
                gate.validate_results(*results(cases), INVENTORY)
        tree, summary = results(INVENTORY)
        tree["testNodes"][0]["children"][0]["result"] = "Skipped"
        with self.assertRaises(ValueError):
            gate.validate_results(tree, summary, INVENTORY)

    def test_repeated_execution_children_and_unknown_nodes_rejected(self):
        for kind in ("Test Case Run", "Unknown New Schema"):
            tree, summary = results(INVENTORY)
            tree["testNodes"][0]["children"][0]["children"] = [{"nodeType": kind, "result": "Passed"}]
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                gate.validate_results(tree, summary, INVENTORY)

    def test_summary_counts_status_configuration_and_time_must_agree(self):
        mutations = [{"passedTests": 99}, {"totalTestCount": 99}, {"skippedTests": 1}, {"failedTests": 1},
                     {"expectedFailures": 1}, {"result": "Failed"}, {"testFailures": [{}]}, {"finishTime": 0},
                     {"finishTime": float("nan")}, {"devicesAndConfigurations": []}]
        for mutation in mutations:
            tree, summary = results(INVENTORY)
            summary.update(mutation)
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                gate.validate_results(tree, summary, INVENTORY)

    def test_conflicting_identity_and_result_device_rejected(self):
        tree, summary = results(INVENTORY)
        tree["testNodes"][0]["children"][0]["nodeIdentifier"] = "Other/testWrong()"
        with self.assertRaises(ValueError):
            gate.validate_results(tree, summary, INVENTORY)
        _, summary = results(INVENTORY)
        summary["devicesAndConfigurations"][0]["device"]["modelName"] = "Different iPhone"
        with self.assertRaises(ValueError):
            gate.validate_device(summary, SIMULATOR)

    def test_missing_xcresult_info_is_not_reconstructed(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(gate, "command") as command:
            with self.assertRaisesRegex(ValueError, "Info.plist"):
                gate.result_exports(Path(directory))
            command.assert_not_called()

    def test_symbolic_result_bundle_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(gate, "command") as command:
            root = Path(directory)
            (root / "original").mkdir()
            (root / "link").symlink_to(root / "original", target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "symbolic xcresult"):
                gate.result_exports(root / "link")
            command.assert_not_called()


class AggregateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.artifacts = self.root / "artifacts"
        for stage in gate.STAGES:
            directory = self.artifacts / stage
            directory.mkdir(parents=True)
            receipt = {"schema": 1, "complete": True, "stage": stage, "identity": copy.deepcopy(IDENTITY),
                       "simulator": SIMULATOR, "inventory": INVENTORY, "selected": gate.partition(INVENTORY, stage), "xcodebuild_exit": 0}
            gate.write_json(directory / "receipt.json", receipt)
            gate.write_json(directory / "enumeration.json", enumeration())
            tree, summary = results(receipt["selected"])
            gate.write_json(directory / "tests.json", tree)
            gate.write_json(directory / "summary.json", summary)
            (directory / "Tests.xcresult").mkdir()
            (directory / "Tests.xcresult/Info.plist").write_bytes(b"retained result fixture")
            data = b"retained own binary"
            with tarfile.open(directory / "products.tar.gz", "w:gz") as archive:
                entry = tarfile.TarInfo("App.app/App")
                entry.size = len(data)
                archive.addfile(entry, io.BytesIO(data))
            manifest = {"App.app/App": "sha256:" + gate.digest(data)}
            gate.write_json(directory / "products-before.json", manifest)
            gate.write_json(directory / "products-after.json", manifest)
            self.rehash(stage)

    def rehash(self, stage):
        directory = self.artifacts / stage
        gate.write_json(directory / "files.json", gate.files_manifest(directory, exclude=("files.json",)))

    def execute(self, upstream=None):
        args = argparse.Namespace(artifacts=str(self.artifacts), output=str(self.root / "aggregate"), head_sha="b" * 40,
                                  upstream_results=json.dumps(upstream or {"unit": {"result": "success", "outputs": {}}, "ui": {"result": "success", "outputs": {}}}))
        def exports(bundle):
            return gate.read_json(bundle.parent / "tests.json"), gate.read_json(bundle.parent / "summary.json")
        with patch.object(gate, "identity", return_value=IDENTITY), patch.object(gate, "result_exports", side_effect=exports):
            gate.aggregate(args)

    def test_complete_three_stage_aggregate_passes(self):
        self.execute()
        self.assertEqual(gate.read_json(self.root / "aggregate/aggregate.json")["passed"], len(INVENTORY))

    def test_missing_stage_rejected(self):
        (self.artifacts / "ui-1/receipt.json").unlink()
        with self.assertRaisesRegex(ValueError, "stage artifact receipt"):
            self.execute()

    def test_extra_artifact_without_receipt_rejected(self):
        (self.artifacts / "unaccounted-artifact").mkdir()
        with self.assertRaisesRegex(ValueError, "stage artifacts"):
            self.execute()

    def test_symbolic_stage_directory_rejected(self):
        original = self.artifacts / "ui-1"
        target = self.root / "other"
        original.rename(target)
        original.symlink_to(target, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "stage artifacts"):
            self.execute()

    def test_duplicate_stage_rejected(self):
        path = self.artifacts / "ui-1/receipt.json"
        receipt = gate.read_json(path)
        receipt["stage"] = "ui-0"
        receipt["selected"] = gate.partition(INVENTORY, "ui-0")
        gate.write_json(path, receipt)
        self.rehash("ui-1")
        with self.assertRaisesRegex(ValueError, "Duplicate stage"):
            self.execute()

    def test_cross_source_or_attempt_receipt_rejected(self):
        for key, value in (("source", "c" * 40), ("attempt", "2")):
            receipt = gate.read_json(self.artifacts / "ui-1/receipt.json")
            receipt["identity"] = dict(IDENTITY, **{key: value})
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "Source/run/attempt/toolchain"):
                gate.validate_receipt(receipt, IDENTITY)

    def test_artifact_tamper_rejected(self):
        (self.artifacts / "ui-1/Tests.xcresult/Info.plist").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "file/hash mismatch"):
            self.execute()

    def test_product_mutation_rejected_even_with_fresh_outer_hashes(self):
        gate.write_json(self.artifacts / "ui-1/products-after.json", {"App.app/App": "sha256:changed"})
        self.rehash("ui-1")
        with self.assertRaisesRegex(ValueError, "Binary archive/manifest"):
            self.execute()

    def test_cancelled_dependency_cannot_pass_aggregate(self):
        with self.assertRaisesRegex(ValueError, "Upstream"):
            self.execute({"unit": {"result": "success"}, "ui": {"result": "cancelled"}})
        self.assertEqual(gate.read_json(self.root / "aggregate/aggregate.json")["result"], "Failed")


class FailedRunEvidenceTests(unittest.TestCase):
    def exercise_failed_test(self, capture_fails=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output, derived = root / "output", root / "derived"
            products = derived / "Build/Products"
            products.mkdir(parents=True)
            (products / "App").write_bytes(b"compiled fixture binary")
            (products / "StandClear.xctestrun").write_bytes(b"compiled fixture test configuration")

            def command(args, log=None):
                Path(log).write_text("retained command log")
                if Path(log).name == "enumeration.log":
                    gate.write_json(output / "enumeration.json", enumeration())
                elif Path(log).name == "test.log":
                    (output / "Tests.xcresult").mkdir()
                    (output / "Tests.xcresult/original-data").write_bytes(b"original interrupted result")
                    raise ValueError("Original xcodebuild test failure: exit65")

            args = argparse.Namespace(stage="unit", simulator="fixture", output=str(output), head_sha="b" * 40)
            original_capture = gate.retain_products
            with patch.object(gate, "identity", return_value=IDENTITY), patch.object(gate, "simulator_identity", return_value=SIMULATOR), \
                    patch.object(gate.tempfile, "mkdtemp", return_value=str(derived)), patch.object(gate, "command", side_effect=command), \
                    patch.object(gate, "retain_products", side_effect=OSError("secondary capture failure") if capture_fails else original_capture) as capture, \
                    patch("sys.stderr", new_callable=io.StringIO):
                with self.assertRaisesRegex(ValueError, "Original xcodebuild test failure: exit65"):
                    gate.run_stage(args)
                capture.assert_called_once()
            receipt = gate.read_json(output / "receipt.json")
            self.assertFalse(receipt["complete"])
            self.assertNotEqual(receipt.get("xcodebuild_exit"), 0)
            self.assertEqual(receipt["error"], "Original xcodebuild test failure: exit65")
            self.assertEqual((output / "Tests.xcresult/original-data").read_bytes(), b"original interrupted result")
            self.assertEqual(gate.read_json(output / "files.json"), gate.files_manifest(output, exclude=("files.json",)))
            if capture_fails:
                self.assertEqual(receipt["capture_error"], "secondary capture failure")
            else:
                self.assertEqual(gate.archive_manifest(output / "products.tar.gz"), gate.read_json(output / "products-before.json"))
                self.assertEqual(gate.read_json(output / "products-before.json"), gate.read_json(output / "products-after.json"))

    def test_failed_test_retains_own_products_and_original_failure(self):
        self.exercise_failed_test()

    def test_secondary_capture_failure_cannot_replace_original_verdict(self):
        self.exercise_failed_test(capture_fails=True)


if __name__ == "__main__":
    unittest.main()
