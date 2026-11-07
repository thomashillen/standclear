#!/usr/bin/env python3
"""Fixed-source, temporary Simulator navigation diagnostic. No production checkout edits."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import time

SOURCE = "13752724401a670216dc7498671a6bc62237a505"
BASE = "24f77a99707447e5d721be0f4ce72728949cd7f0"
EXPECTED_XCODE = "26.6"
EXPECTED_RUNTIME = "26.4.1"
DEVICE_NAME = "iPhone 17 Pro"
BUNDLE = "app.standclear.navdiagnostic"
TESTS = [
    "StandClearUITests/StandClearUITests/testStationRouteBackDoesNotReplayAfterLayoutChanges",
    "StandClearUITests/StandClearUITests/testStationRouteBackOriginalBindingsDiagnostic",
]
EXPORTS = ["navigation-diagnostic-original.json", "navigation-diagnostic-wrapped.json"]
PATCH_PATHS = {
    "ios/StandClear/NavigationDiagnostic.swift", "ios/StandClear/MapShell.swift",
    "ios/StandClear/StationBrowser.swift", "ios/StandClear/DirectionsView.swift",
    "ios/project.yml", "ios/StandClearUITests/StandClearUITests.swift",
    "ios/StandClear.xcodeproj/project.pbxproj",
}


def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def command(args, out, label, timeout=60, cwd=None):
    """Capture only explicit commands, never the environment or credential configuration."""
    save(out / (label + "-command.json"), args)
    result = subprocess.run(args, cwd=cwd, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, timeout=timeout)
    (out / (label + ".log")).write_text(result.stdout)
    if result.returncode:
        raise RuntimeError(f"{label}: exit {result.returncode}; see {label}.log")
    return result.stdout


def sim(args, out, label, timeout=60):
    return command(["xcrun", "simctl", *args], out, label, timeout)


def booted(out, label):
    data = json.loads(sim(["list", "devices", "booted", "-j"], out, label))
    return [d for group in data["devices"].values() for d in group if d["state"] == "Booted"]


def prepare(args, out):
    repo = Path(__file__).resolve().parents[2]
    patch = Path(args.patch).resolve()
    if not re.fullmatch(r"[0-9a-f]{64}", args.patch_sha256):
        raise RuntimeError("Expected patch SHA256 must be pinned before publishing")
    if not patch.is_file() or sha(patch) != args.patch_sha256:
        raise RuntimeError("Standalone patch missing or SHA256 differs from reviewed value")
    patch_text = patch.read_text()
    pairs = re.findall(r"^diff --git a/(\S+) b/(\S+)$", patch_text, re.M)
    if not pairs or any(a != b or b not in PATCH_PATHS for a, b in pairs):
        raise RuntimeError("Patch must contain only the reviewed temporary diagnostic paths")
    metadata = {"preparedUTC": utc(), "sourceCommit": SOURCE, "referenceMain": BASE,
                "patchSHA256": sha(patch), "expectedPatchSHA256": args.patch_sha256,
                "patchPaths": [b for _, b in pairs], "bundleIdentifier": BUNDLE,
                "selectedTests": TESTS, "expectedExports": EXPORTS,
                "diagnosticOnly": True, "productionMergeGate": False}
    save(out / "metadata.json", metadata)
    metadata["checkoutCommit"] = command(["git", "rev-parse", "HEAD"], out, "checkout-head", cwd=repo).strip()
    metadata["sourceTree"] = command(["git", "rev-parse", SOURCE + "^{tree}"], out, "source-tree", cwd=repo).strip()
    metadata["sourceIOSTree"] = command(["git", "rev-parse", SOURCE + ":ios"], out, "source-ios-tree", cwd=repo).strip()
    versions = command(["xcodebuild", "-version"], out, "xcode-version")
    metadata["xcodeVersion"] = versions.strip()
    for label, cmd in [
        ("developer-directory", ["xcode-select", "-p"]),
        ("sdk-version", ["xcrun", "--sdk", "iphonesimulator", "--show-sdk-version"]),
        ("host-version", ["sw_vers"]), ("host-architecture", ["uname", "-m"]),
        ("python-version", [sys.executable, "--version"]),
        ("host-memory-initial", ["vm_stat"]), ("host-load-initial", ["uptime"]),
    ]:
        command(cmd, out, label)
    save(out / "metadata.json", metadata)
    if not re.search(r"^Xcode " + re.escape(EXPECTED_XCODE) + r"$", versions, re.M):
        raise RuntimeError("Selected Xcode differs from CI 26.6; stop rather than silently substitute")
    archive = out / "fixed-source-ios.tar"
    with archive.open("wb") as handle:
        subprocess.run(["git", "archive", "--format=tar", SOURCE, "ios"], cwd=repo,
                       stdout=handle, check=True)
    metadata["sourceArchiveSHA256"] = sha(archive)
    source = out / "source"
    source.mkdir()
    with tarfile.open(archive) as handle:
        for member in handle.getmembers():
            if member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
                raise RuntimeError("Unexpected archive member type")
            if not (source / member.name).resolve().is_relative_to(source.resolve()):
                raise RuntimeError("Unsafe archive path")
        handle.extractall(source)
    command(["git", "apply", "--check", str(patch)], out, "patch-check", cwd=source)
    command(["git", "apply", str(patch)], out, "patch-apply", cwd=source)
    test_text = (source / "ios/StandClearUITests/StandClearUITests.swift").read_text()
    if any("func " + selector.rsplit("/", 1)[1] + "(" not in test_text for selector in TESTS):
        raise RuntimeError("Patched source does not contain both exact test selectors")
    if "--ui-test-navigation-original-bindings" not in test_text:
        raise RuntimeError("Original-binding control launch flag missing from patched tests")
    project = source / "ios/StandClear.xcodeproj/project.pbxproj"
    project_data = json.loads(command(["plutil", "-convert", "json", "-o", "-", str(project)], out, "patched-project"))
    objects = project_data["objects"]
    targets = [v for v in objects.values() if v.get("isa") == "PBXNativeTarget" and v.get("name") == "StandClear"]
    if len(targets) != 1:
        raise RuntimeError("Expected exactly one StandClear application target")
    configs = objects[targets[0]["buildConfigurationList"]]["buildConfigurations"]
    if any(objects[c]["buildSettings"].get("PRODUCT_BUNDLE_IDENTIFIER") != BUNDLE for c in configs):
        raise RuntimeError("Patch must assign the app its separate diagnostic bundle in every configuration")
    metadata["patchedFileSHA256"] = {b: sha(source / b) for _, b in pairs if (source / b).is_file()}
    save(out / "metadata.json", metadata)
    runtimes = json.loads(sim(["list", "runtimes", "-j"], out, "runtimes"))["runtimes"]
    runtime = [r for r in runtimes if r.get("isAvailable") and r.get("version") == EXPECTED_RUNTIME and "iOS" in r.get("name", "")]
    types = json.loads(sim(["list", "devicetypes", "-j"], out, "device-types"))["devicetypes"]
    device = [d for d in types if d.get("name") == DEVICE_NAME]
    if len(runtime) != 1 or len(device) != 1:
        raise RuntimeError("Exact available iOS26.4.1 / iPhone17Pro combination unavailable; no fallback")
    if booted(out, "preexisting-booted"):
        raise RuntimeError("Unexpected booted Simulator exists; do not shut down unrelated devices")
    udid = sim(["create", "Station Back Diagnostic", device[0]["identifier"], runtime[0]["identifier"]], out, "create-simulator").strip()
    save(out / "simulator.json", {"udid": udid, "createdByThisDriver": True,
                                 "runtime": runtime[0], "deviceType": device[0]})
    sim(["boot", udid], out, "boot")
    sim(["bootstatus", udid, "-b"], out, "boot-status", timeout=150)
    if [d["udid"] for d in booted(out, "owned-booted")] != [udid]:
        raise RuntimeError("Expected only the owned Simulator to be booted")
    save(out / "prepared.json", {"complete": True, "utc": utc()})


def run(out):
    if not (out / "prepared.json").is_file():
        raise RuntimeError("Preparation did not complete")
    udid = json.loads((out / "simulator.json").read_text())["udid"]
    if [d["udid"] for d in booted(out, "run-booted")] != [udid]:
        raise RuntimeError("Simulator ownership/count changed; stop")
    cmd = ["xcodebuild", "-project", str(out / "source/ios/StandClear.xcodeproj"),
           "-scheme", "StandClear", "-configuration", "Debug", "-destination", "platform=iOS Simulator,id=" + udid,
           "-derivedDataPath", str(out / "DerivedData"), "-resultBundlePath", str(out / "StationBack.xcresult"),
           "-parallel-testing-enabled", "NO", "-maximum-concurrent-test-simulator-destinations", "1", "-jobs", "2",
           *["-only-testing:" + name for name in TESTS], "test", "CODE_SIGNING_ALLOWED=NO"]
    save(out / "xcodebuild-command.json", cmd)
    started = utc()
    timed_out = False
    with (out / "xcodebuild.log").open("w") as handle:
        process = subprocess.Popen(cmd, stdout=handle, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            code = process.wait(timeout=600)
        except subprocess.TimeoutExpired:
            timed_out = True
            try:
                os.killpg(process.pid, signal.SIGINT)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=30)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait(timeout=10)
            code = 124
    save(out / "run-result.json", {"startedUTC": started, "completedUTC": utc(),
                                   "returnCode": code, "timedOut": timed_out})
    if code:
        raise RuntimeError(f"xcodebuild returned {code}; failures remain failures, no retry")


def collect(out):
    report = {"collectedUTC": utc(), "exports": {}, "errors": [], "notes": []}
    container = None
    save(out / "collection-report.json", report)
    try:
        state = json.loads((out / "simulator.json").read_text()) if (out / "simulator.json").is_file() else {}
    except Exception as error:
        state = {}
        report["errors"].append("Cannot read owned Simulator state: " + str(error))
    udid = state.get("udid") if state.get("createdByThisDriver") else None
    if udid:
        try:
            container = Path(sim(["get_app_container", udid, BUNDLE, "data"], out, "app-container", timeout=15).strip())
        except Exception as error:
            report["errors"].append(str(error))
    for filename in EXPORTS:
        try:
            source = container / "Documents" / filename if container else None
            if source is None or not source.is_file():
                raise RuntimeError("Missing expected RAM export: " + filename)
            target = out / "exports" / filename
            target.parent.mkdir(exist_ok=True)
            shutil.copyfile(source, target)
            report["exports"][filename] = {"status": "raw-preserved", "sha256": sha(target)}
            data = json.loads(target.read_text())
            if not isinstance(data, list) or not data:
                raise RuntimeError("Expected a nonempty event array: " + filename)
            expected_mode = "original" if "original" in filename else "wrapped"
            if data[-1].get("event") != "shell.background.export":
                raise RuntimeError("Missing terminal background export: " + filename)
            if any(e.get("fields", {}).get("bindingMode") != expected_mode for e in data):
                raise RuntimeError("Unexpected binding mode in export: " + filename)
            report["exports"][filename] = {"status": "present", "events": len(data), "sha256": sha(target),
                                           "lastEvent": data[-1].get("event") if isinstance(data[-1], dict) else None}
        except Exception as error:
            report["exports"].setdefault(filename, {}).update({"status": "missing-or-invalid", "error": str(error)})
            report["errors"].append(str(error))
    # Cleanup ONLY the UUID that this driver created. Export attempts precede shutdown/deletion.
    if udid:
        for label, operation in [("shutdown-owned", ["shutdown", udid]), ("delete-owned", ["delete", udid])]:
            try:
                sim(operation, out, label, timeout=10)
            except Exception as error:
                report["errors"].append(str(error))
    try:
        command(["vm_stat"], out, "host-memory-final", timeout=5)
        command(["uptime"], out, "host-load-final", timeout=5)
    except Exception as error:
        report["notes"].append(str(error))
    save(out / "collection-report.json", report)
    if report["errors"]:
        raise RuntimeError("Diagnostic collection incomplete; see collection-report.json")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=["prepare", "run", "collect"])
    parser.add_argument("--output", required=True)
    parser.add_argument("--patch")
    parser.add_argument("--patch-sha256", default="")
    args = parser.parse_args()
    out = Path(args.output).resolve()
    out.mkdir(parents=True, exist_ok=True)
    try:
        if args.phase == "prepare":
            prepare(args, out)
        elif args.phase == "run":
            run(out)
        else:
            collect(out)
    except Exception as error:
        save(out / (args.phase + "-failure.json"), {"utc": utc(), "error": str(error)})
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
