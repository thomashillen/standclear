#!/usr/bin/env python3
"""Serial native test partitions with exhaustive, fail-closed result accounting."""

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys
import tarfile
import tempfile
from urllib.parse import urlparse


STAGES = ("unit", "ui-0", "ui-1")
TARGETS = ("StandClearTests", "StandClearUITests")
ROOT = Path(__file__).resolve().parents[2]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(path):
    return json.loads(Path(path).read_text())


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def stream_digest(stream):
    value = hashlib.sha256()
    for block in iter(lambda: stream.read(1024 * 1024), b""):
        value.update(block)
    return value.hexdigest()


def identifier(value):
    require(isinstance(value, str), "Non-string test identifier")
    parts = value.removesuffix("()").split("/")
    require(len(parts) == 3 and parts[0] in TARGETS, "Unknown test target/identifier: " + value)
    require(all(re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*", p) for p in parts), "Unsupported test identifier: " + value)
    require(parts[2].startswith("test"), "Non-test method: " + value)
    return "/".join(parts)


def unique_inventory(values):
    canonical = [identifier(v) for v in values]
    require(len(canonical) == len(set(canonical)), "Duplicate inventory cases")
    require(all(any(v.startswith(t + "/") for v in canonical) for t in TARGETS), "Missing test target")
    return sorted(canonical)


def enumeration_cases(document):
    require(isinstance(document, dict) and set(document) == {"errors", "values"}, "Unknown enumeration schema")
    require(document["errors"] == [], "Enumeration reported errors")
    values = document["values"]
    require(isinstance(values, list) and len(values) == 1, "Missing/multiple enumeration configurations")
    plan = values[0]
    require(isinstance(plan, dict) and set(plan) == {"disabledTests", "enabledTests", "testPlan"}
            and plan["testPlan"] == "StandClear", "Unknown enumeration plan schema")
    require(plan["disabledTests"] == [], "Disabled tests in complete inventory")
    require(isinstance(plan["enabledTests"], list), "Invalid enabled test inventory")
    tests = []
    for case in plan["enabledTests"]:
        require(isinstance(case, dict) and set(case) == {"identifier"}, "Unknown enumerated test schema")
        tests.append(case["identifier"])
    return unique_inventory(tests)


def partition(inventory, stage):
    require(stage in STAGES, "Unknown stage")
    unit = [t for t in inventory if t.startswith(TARGETS[0] + "/")]
    ui = [t for t in inventory if t.startswith(TARGETS[1] + "/")]
    selected = unit if stage == "unit" else ui[int(stage[-1])::2]
    require(bool(selected), "Empty test partition")
    return selected


def result_cases(tree):
    require(isinstance(tree, dict) and isinstance(tree.get("testNodes"), list), "Unknown result-tree schema")
    require(bool(tree["testNodes"]), "Empty result tree")
    cases = []
    containers = {"Test Plan", "Unit test bundle", "UI test bundle", "Test Suite"}

    def visit(node):
        require(isinstance(node, dict), "Invalid result node")
        kind = node.get("nodeType")
        if kind == "Runtime Warning":
            require(not node.get("children"), "Unexpected warning children")
            return
        require(node.get("result") == "Passed", "Non-passing result node: " + str(node.get("name")))
        if kind == "Test Case":
            url = urlparse(node.get("nodeIdentifierURL", ""))
            require(url.scheme == "test" and url.netloc == "com.apple.xcode", "Unknown test identity URL")
            parts = url.path.strip("/").split("/")
            require(len(parts) == 4 and parts[0] == "StandClear", "Unknown result test identity")
            case = identifier("/".join(parts[1:]))
            require(node.get("nodeIdentifier") == "/".join(parts[2:]) + "()", "Conflicting result identities")
            cases.append(case)
            for child in node.get("children", []):
                require(child.get("nodeType") == "Runtime Warning", "Repeated/unknown test execution node")
                visit(child)
        else:
            require(kind in containers and isinstance(node.get("children"), list) and node["children"], "Unknown/empty result container")
            for child in node["children"]:
                visit(child)

    for node in tree["testNodes"]:
        visit(node)
    require(cases and len(cases) == len(set(cases)), "Missing or repeated result cases")
    return sorted(cases)


def validate_results(tree, summary, expected):
    actual = result_cases(tree)
    require(actual == sorted(expected), "Actual case identities differ from assigned partition")
    require(summary.get("result") == "Passed", "Summary is not Passed")
    for key in ("failedTests", "skippedTests", "expectedFailures"):
        require(type(summary.get(key)) is int and summary[key] == 0, "Nonzero/missing summary " + key)
    for key in ("passedTests", "totalTestCount"):
        require(type(summary.get(key)) is int and summary[key] == len(expected), "Summary count mismatch: " + key)
    require(summary.get("testFailures") == [], "Missing/nonempty test failures")
    require(all(isinstance(summary.get(k), (int, float)) and math.isfinite(summary[k]) for k in ("startTime", "finishTime")), "Missing/invalid result timestamps")
    require(summary["finishTime"] >= summary["startTime"], "Invalid result time ordering")
    configs = summary.get("devicesAndConfigurations")
    require(isinstance(configs, list) and len(configs) == 1, "Missing or multiple test configurations")
    config = configs[0]
    require(config.get("passedTests") == len(expected) and all(config.get(k) == 0 for k in ("failedTests", "skippedTests", "expectedFailures")), "Configuration counts disagree")
    devices = tree.get("devices")
    require(isinstance(devices, list) and len(devices) == 1 and devices[0] == config.get("device"), "Result device observations disagree")
    return actual


def files_manifest(root, exclude=()):
    result = {}
    for base, directories, files in os.walk(root, followlinks=False):
        for name in sorted(directories + files):
            path = Path(base, name)
            relative = path.relative_to(root).as_posix()
            if relative in exclude:
                continue
            if path.is_symlink():
                result[relative] = "symlink:" + os.readlink(path)
            elif path.is_file():
                with path.open("rb") as stream:
                    result[relative] = "sha256:" + stream_digest(stream)
            else:
                require(path.is_dir(), "Unsupported artifact entry")
    return result


def archive_manifest(path):
    result = {}
    with tarfile.open(path, "r:gz") as archive:
        for entry in archive:
            require(not entry.name.startswith("/") and ".." not in Path(entry.name).parts, "Unsafe archive path")
            if entry.isdir():
                continue
            require(entry.name not in result, "Duplicate product archive entry")
            if entry.issym():
                result[entry.name] = "symlink:" + entry.linkname
            else:
                require(entry.isfile(), "Unsupported product archive entry")
                with archive.extractfile(entry) as stream:
                    result[entry.name] = "sha256:" + stream_digest(stream)
    return result


def command(args, log=None):
    if log is None:
        return subprocess.check_output(args, cwd=ROOT, text=True).strip()
    with Path(log).open("w") as stream:
        result = subprocess.run(args, cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT, check=False)
    require(result.returncode == 0, "Command exited " + str(result.returncode) + "; retained log: " + str(log))


def identity(head):
    require(re.fullmatch(r"[0-9a-f]{40}", head) is not None, "Invalid head SHA")
    require(head == os.environ.get("PR_HEAD_SHA"), "PR head metadata differs from workflow head SHA")
    actual = command(["git", "rev-parse", "HEAD"])
    require(actual == os.environ.get("GITHUB_SHA"), "Checkout differs from workflow source SHA")
    require(not command(["git", "status", "--porcelain", "--untracked-files=no"]), "Tracked checkout is dirty")
    run = os.environ.get("GITHUB_RUN_ID", "")
    attempt = os.environ.get("GITHUB_RUN_ATTEMPT", "")
    require(run.isdigit() and attempt.isdigit() and int(attempt) > 0, "Missing run/attempt identity")
    source_files = {}
    for name in command(["git", "ls-files", "-z"]).split("\0"):
        if name:
            path = ROOT / name
            require(path.is_file() or path.is_symlink(), "Missing tracked source file")
            if path.is_symlink():
                source_files[name] = "symlink:" + os.readlink(path)
            else:
                with path.open("rb") as stream:
                    source_files[name] = "sha256:" + stream_digest(stream)
    require(bool(source_files), "Empty tracked source inventory")
    return {"source": actual, "head": head, "source_files": source_files,
            "run": run, "attempt": attempt,
            "xcode": command(["xcodebuild", "-version"]),
            "sdk": command(["xcrun", "--sdk", "iphonesimulator", "--show-sdk-version"]),
            "sdk_build": command(["xcrun", "--sdk", "iphonesimulator", "--show-sdk-build-version"])}


def simulator_identity(device_id):
    devices = json.loads(command(["xcrun", "simctl", "list", "devices", "available", "-j"]))["devices"]
    matches = [(runtime, d) for runtime, group in devices.items() for d in group if d["udid"] == device_id]
    require(len(matches) == 1, "Simulator identity unavailable/ambiguous")
    runtime_id, device = matches[0]
    runtimes = json.loads(command(["xcrun", "simctl", "list", "runtimes", "-j"]))["runtimes"]
    runtime = [r for r in runtimes if r["identifier"] == runtime_id and r["isAvailable"]]
    require(len(runtime) == 1 and device["isAvailable"], "Unavailable runtime")
    types = json.loads(command(["xcrun", "simctl", "list", "devicetypes", "-j"]))["devicetypes"]
    model = [t["name"] for t in types if t["identifier"] == device["deviceTypeIdentifier"]]
    require(len(model) == 1, "Unknown/ambiguous simulator model")
    return {"model": device["deviceTypeIdentifier"], "runtime": runtime_id,
            "model_name": model[0], "version": runtime[0]["version"], "build": runtime[0]["buildversion"]}


def result_exports(bundle):
    require(bundle.is_dir() and not bundle.is_symlink(), "Invalid/symbolic xcresult directory")
    require((bundle / "Info.plist").is_file() and not (bundle / "Info.plist").is_symlink(), "Incomplete xcresult: missing/invalid Info.plist")
    with (bundle / "Info.plist").open("rb") as stream:
        require(isinstance(plistlib.load(stream), dict), "Invalid xcresult Info.plist")
    tree = json.loads(command(["xcrun", "xcresulttool", "get", "test-results", "tests", "--path", str(bundle)]))
    summary = json.loads(command(["xcrun", "xcresulttool", "get", "test-results", "summary", "--path", str(bundle)]))
    return tree, summary


def retain_products(products, output):
    after = files_manifest(products)
    write_json(output / "products-after.json", after)
    with tarfile.open(output / "products.tar.gz", "w:gz", dereference=False) as archive:
        for path in sorted(products.iterdir()):
            archive.add(path, arcname=path.name)
    require(archive_manifest(output / "products.tar.gz") == after, "Retained binary archive differs")
    return after


def run_stage(args):
    output = Path(args.output).resolve()
    require(not output.exists(), "Output already exists; preserve prior evidence")
    output.mkdir(parents=True)
    receipt = {"schema": 1, "stage": args.stage, "complete": False}
    products, primary_error, validated = None, None, False
    try:
        receipt["identity"] = identity(args.head_sha)
        receipt["simulator"] = simulator_identity(args.simulator)
        derived = Path(tempfile.mkdtemp(prefix="native-gate-" + args.stage + "-"))
        receipt["derived_path"] = str(derived)
        products = derived / "Build/Products"
        base = ["xcodebuild", "-project", "ios/StandClear.xcodeproj", "-scheme", "StandClear",
                "-destination", "platform=iOS Simulator,id=" + args.simulator,
                "-derivedDataPath", str(derived), "-parallel-testing-enabled", "NO"]
        command(base + (["build", "analyze", "build-for-testing"] if args.stage == "unit" else ["build-for-testing"]) + ["CODE_SIGNING_ALLOWED=NO"], output / "build.log")
        command(base + ["test-without-building", "-enumerate-tests", "-test-enumeration-style", "flat",
                        "-test-enumeration-format", "json", "-test-enumeration-output-path", str(output / "enumeration.json"), "CODE_SIGNING_ALLOWED=NO"], output / "enumeration.log")
        inventory = enumeration_cases(read_json(output / "enumeration.json"))
        receipt["inventory"] = inventory
        receipt["selected"] = partition(inventory, args.stage)
        before = files_manifest(products)
        require(before and any(p.endswith(".xctestrun") for p in before), "Missing compiled test products")
        write_json(output / "products-before.json", before)
        test_args = base + ["test-without-building", "-resultBundlePath", str(output / "Tests.xcresult")]
        command(test_args + ["-only-testing:" + t for t in receipt["selected"]] + ["CODE_SIGNING_ALLOWED=NO"], output / "test.log")
        receipt["xcodebuild_exit"] = 0
        tree, summary = result_exports(output / "Tests.xcresult")
        write_json(output / "tests.json", tree)
        write_json(output / "summary.json", summary)
        validate_results(tree, summary, receipt["selected"])
        validate_device(summary, receipt["simulator"])
        require(identity(args.head_sha) == receipt["identity"], "Source/toolchain changed during stage")
        validated = True
    except BaseException as error:
        primary_error = error
        receipt["error"] = str(error)
        raise
    finally:
        capture_error = None
        try:
            if products is not None and products.is_dir():
                after = retain_products(products, output)
                if validated:
                    require(read_json(output / "products-before.json") == after, "Compiled products changed during tests")
                    receipt["complete"] = True
            else:
                require(not validated, "Validated run has no compiled products")
        except Exception as error:
            capture_error = error
            receipt["capture_error"] = str(error)
            receipt["complete"] = False
            print("Native product evidence capture failed: " + str(error), file=sys.stderr)
        try:
            write_json(output / "receipt.json", receipt)
            write_json(output / "files.json", files_manifest(output, exclude=("files.json",)))
        except Exception as error:
            if primary_error is None:
                raise
            print("Native failure receipt capture also failed: " + str(error), file=sys.stderr)
        if capture_error is not None and primary_error is None:
            raise capture_error


def validate_device(summary, simulator):
    device = summary["devicesAndConfigurations"][0]["device"]
    require(device.get("platform") == "iOS Simulator" and device.get("osVersion") == simulator["version"]
            and device.get("osBuildNumber") == simulator["build"] and device.get("architecture") == "arm64"
            and device.get("modelName") == simulator["model_name"], "Result simulator identity differs")


def validate_receipt(receipt, expected_identity):
    require(receipt.get("schema") == 1 and receipt.get("complete") is True, "Incomplete/unknown receipt")
    require(receipt.get("stage") in STAGES, "Unknown stage receipt")
    require(receipt.get("identity") == expected_identity, "Source/run/attempt/toolchain mismatch")
    inventory = unique_inventory(receipt.get("inventory", []))
    require(receipt.get("inventory") == inventory, "Noncanonical inventory")
    require(receipt.get("selected") == partition(inventory, receipt["stage"]), "Partition differs from complete inventory")
    require(receipt.get("xcodebuild_exit") == 0, "Missing/failed xcodebuild exit")
    return inventory


def aggregate(args):
    output = Path(args.output).resolve()
    require(not output.exists(), "Aggregate output already exists")
    output.mkdir(parents=True)
    try:
        aggregate_artifacts(args, output)
    except Exception as error:
        write_json(output / "aggregate.json", {"schema": 1, "result": "Failed", "error": str(error)})
        raise


def aggregate_artifacts(args, output):
    upstream = json.loads(args.upstream_results)
    require(isinstance(upstream, dict) and set(upstream) == {"unit", "ui"}
            and all(isinstance(v, dict) and v.get("result") == "success" for v in upstream.values()), "Upstream jobs did not all succeed")
    expected_identity = identity(args.head_sha)
    require(not Path(args.artifacts).is_symlink(), "Symbolic artifact root")
    root = Path(args.artifacts).resolve()
    directories = sorted(root.iterdir())
    require(len(directories) == len(STAGES) and all(p.is_dir() and not p.is_symlink() for p in directories), "Missing/extra stage artifacts")
    receipts = [p / "receipt.json" for p in directories]
    require(all(p.is_file() and not p.is_symlink() for p in receipts), "Missing stage artifact receipt")
    seen, all_cases, baseline, simulator = set(), [], None, None
    for path in receipts:
        directory = path.parent
        manifest = read_json(directory / "files.json")
        require(manifest and files_manifest(directory, exclude=("files.json",)) == manifest, "Artifact file/hash mismatch")
        receipt = read_json(path)
        inventory = validate_receipt(receipt, expected_identity)
        require(receipt["stage"] not in seen, "Duplicate stage")
        seen.add(receipt["stage"])
        baseline = inventory if baseline is None else baseline
        simulator = receipt["simulator"] if simulator is None else simulator
        require(inventory == baseline and receipt["simulator"] == simulator, "Inventory/simulator differs between stages")
        before = read_json(directory / "products-before.json")
        require(before and before == read_json(directory / "products-after.json") == archive_manifest(directory / "products.tar.gz"), "Binary archive/manifest mismatch")
        require(enumeration_cases(read_json(directory / "enumeration.json")) == inventory, "Raw inventory differs")
        tree, summary = result_exports(directory / "Tests.xcresult")
        require(tree == read_json(directory / "tests.json") and summary == read_json(directory / "summary.json"), "Retained result exports differ from xcresult")
        all_cases += validate_results(tree, summary, receipt["selected"])
        validate_device(summary, simulator)
    require(seen == set(STAGES) and sorted(all_cases) == baseline and len(all_cases) == len(set(all_cases)), "Incomplete/duplicated aggregate coverage")
    write_json(output / "aggregate.json", {"schema": 1, "identity": expected_identity, "stages": sorted(seen), "passed": len(all_cases), "inventory": baseline, "result": "Passed"})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run")
    run.add_argument("--stage", choices=STAGES, required=True)
    run.add_argument("--simulator", required=True)
    gate = commands.add_parser("aggregate")
    gate.add_argument("--artifacts", required=True)
    gate.add_argument("--upstream-results", required=True)
    for subparser in (run, gate):
        subparser.add_argument("--head-sha", required=True)
        subparser.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        (run_stage if args.command == "run" else aggregate)(args)
    except (ValueError, OSError, KeyError, TypeError, subprocess.CalledProcessError, json.JSONDecodeError, plistlib.InvalidFileException, tarfile.TarError) as error:
        print("Native gate failed: " + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
