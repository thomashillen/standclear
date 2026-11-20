#!/usr/bin/env python3
"""One exact-toolchain search Close trace; never changes the production checkout."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import signal
import shutil
import subprocess
import sys
import tarfile
import time
from xml.parsers.expat import ExpatError

from trace_coverage import summarize_trace
from correlated_candidate import restore_original
from correlated_trace import correlate, normalize_app_trace

SOURCE = "e874c7f9cd1c5bc1bb2e6e6e185e806408a0493f"
TEST = "StandClearUITests/StandClearUITests/testPlaceDestinationEditingExpanded"
TEST_PATH = "ios/StandClearUITests/StandClearUITests.swift"
TEST_SHA = "5d11a8e7fe84640e7f3670a112aabaa61b0cad6b9558550f493500ac745456bf"
SOURCE_PATH = "ios/StandClear/PlacePreview.swift"
SOURCE_SHA = "239157a0c88bb3c2fc8932218f095947e59e46d1477923fa0aade9f1db1b9039"
EXPECTED_XCODE = "Xcode 26.6\nBuild version 17F113"
CORRELATED_PATCH_SHA = "1fd076b38335fae9125536736a1c11ec8a8f40bbb7386b3cee129ea732315d1b"
CORRELATED_APP_SHA = "104161080e9f3492bd192238dc61f16e1cdb10a56facc53a5a63d034bb9c2183"
CORRELATED_TEST_SHA = "ddb0ad3f793a73340ed17813924915f468a52e41868c8d34a0b9679a0d452e11"


def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def command(args, out, label, timeout=45, cwd=None):
    """Preserve partial command output even when a command fails or times out."""
    save(out / (label + "-command.json"), args)
    with (out / (label + ".log")).open("w") as handle, (out / (label + "-stderr.log")).open("w") as errors:
        result = subprocess.run(args, cwd=cwd, stdout=handle, stderr=errors,
                                text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f"{label}: exit {result.returncode}; see {label}.log")
    return (out / (label + ".log")).read_text()


def sim(args, out, label, timeout=45):
    return command(["xcrun", "simctl", *args], out, label, timeout)


def select_runtime(data):
    matches = [r for r in data["runtimes"] if r.get("isAvailable")
               and r.get("version") == "26.4.1" and r.get("buildversion") == "23E254a"
               and "iOS" in r.get("name", "")]
    if len(matches) != 1:
        raise RuntimeError("Exact iOS 26.4.1 (23E254a) runtime unavailable; no fallback")
    return matches[0]


def extract_archive(archive, source):
    source.mkdir()
    with tarfile.open(archive) as handle:
        for member in handle.getmembers():
            if member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
                raise RuntimeError("Unexpected source archive member type")
            if not (source / member.name).resolve().is_relative_to(source.resolve()):
                raise RuntimeError("Unsafe source archive path")
        handle.extractall(source)


def validate_patched_source(source, before, correlated):
    after = {str(p.relative_to(source)): sha(p) for p in source.rglob("*") if p.is_file()}
    changed = {p for p in before.keys() | after.keys() if before.get(p) != after.get(p)}
    expected = {SOURCE_PATH, TEST_PATH} if correlated else {SOURCE_PATH}
    if changed != expected:
        raise RuntimeError("Unexpected diagnostic source changes")
    if correlated:
        if after[SOURCE_PATH] != CORRELATED_APP_SHA or after[TEST_PATH] != CORRELATED_TEST_SHA:
            raise RuntimeError("Correlated candidate source hashes differ from reviewed version")
        original = restore_original((source / SOURCE_PATH).read_text(), (source / TEST_PATH).read_text())
        if [hashlib.sha256(text.encode()).hexdigest() for text in original] != [SOURCE_SHA, TEST_SHA]:
            raise RuntimeError("Removing diagnostic additions did not restore original source/test bytes")
    elif after[TEST_PATH] != TEST_SHA:
        raise RuntimeError("Baseline test must remain byte-identical")
    return sorted(changed)


def prepare(args, out):
    repo = Path(__file__).resolve().parents[2]
    patch = Path(args.patch).resolve()
    if not re.fullmatch(r"[0-9a-f]{64}", args.patch_sha256 or "") or sha(patch) != args.patch_sha256:
        raise RuntimeError("Diagnostic patch does not match pinned SHA-256")
    if args.correlated and args.patch_sha256 != CORRELATED_PATCH_SHA:
        raise RuntimeError("Correlated mode requires the exact reviewed candidate patch")
    metadata = {"preparedUTC": utc(), "sourceCommit": SOURCE, "test": TEST,
                "patchSHA256": sha(patch), "diagnosticOnly": True,
                "productionMergeGate": False, "expectedXcode": EXPECTED_XCODE,
                "correlated": args.correlated}
    save(out / "metadata.json", metadata)
    metadata["checkoutCommit"] = command(["git", "rev-parse", "HEAD"], out, "checkout-head", cwd=repo).strip()
    metadata["xcodeVersion"] = command(["xcodebuild", "-version"], out, "xcode-version").strip()
    save(out / "metadata.json", metadata)
    if metadata["xcodeVersion"] != EXPECTED_XCODE:
        raise RuntimeError("Selected Xcode differs from 26.6 (17F113); no substitution")
    for label, cmd in [
        ("developer-directory", ["xcode-select", "-p"]),
        ("sdk-version", ["xcrun", "--sdk", "iphonesimulator", "--show-sdk-version"]),
        ("host-version", ["sw_vers"]), ("host-architecture", ["uname", "-m"]),
    ]:
        command(cmd, out, label)
    archive = out / "fixed-source-ios.tar"
    with archive.open("wb") as handle:
        subprocess.run(["git", "archive", "--format=tar", SOURCE, "ios"], cwd=repo,
                       stdout=handle, check=True, timeout=30)
    metadata["archiveSHA256"] = sha(archive)
    source = out / "source"
    extract_archive(archive, source)
    if sha(source / SOURCE_PATH) != SOURCE_SHA or sha(source / TEST_PATH) != TEST_SHA:
        raise RuntimeError("Archived source/test hashes differ from diagnosed head")
    for path in (SOURCE_PATH, TEST_PATH):
        target = out / "baseline" / path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / path, target)
    shutil.copyfile(Path(__file__).with_name("apply-diagnostic.patch"), out / "baseline/apply-diagnostic.patch")
    shutil.copyfile(patch, out / "selected-diagnostic.patch")
    before = {str(p.relative_to(source)): sha(p) for p in source.rglob("*") if p.is_file()}
    command(["git", "apply", "--check", str(patch)], out, "patch-check", cwd=source)
    command(["git", "apply", str(patch)], out, "patch-apply", cwd=source)
    metadata["changedPaths"] = validate_patched_source(source, before, args.correlated)
    metadata["testSHA256"] = sha(source / TEST_PATH)
    metadata["patchedSourceSHA256"] = sha(source / SOURCE_PATH)
    save(out / "metadata.json", metadata)
    runtime = select_runtime(json.loads(sim(["list", "runtimes", "-j"], out, "runtimes")))
    types = json.loads(sim(["list", "devicetypes", "-j"], out, "device-types"))["devicetypes"]
    devices = [d for d in types if d.get("name") == "iPhone 17 Pro"]
    if len(devices) != 1:
        raise RuntimeError("Exact iPhone 17 Pro device type unavailable")
    udid = sim(["create", "Destination Close Diagnostic", devices[0]["identifier"], runtime["identifier"]],
               out, "create-simulator").strip()
    if not re.fullmatch(r"[0-9A-Fa-f-]{36}", udid):
        raise RuntimeError("Simulator creation did not return one UUID")
    save(out / "simulator.json", {"udid": udid, "createdByThisDriver": True,
                                 "runtime": runtime, "deviceType": devices[0]})
    sim(["bootstatus", udid, "-b"], out, "boot-status", timeout=150)
    save(out / "prepared.json", {"complete": True, "utc": utc()})


def owned_simulator(out):
    path = out / "simulator.json"
    if not path.is_file():
        return None
    data = json.loads(path.read_text())
    if data.get("createdByThisDriver") is not True or not re.fullmatch(r"[0-9A-Fa-f-]{36}", data.get("udid", "")):
        raise RuntimeError("Invalid owned Simulator record; will not act on another device")
    return data["udid"]


def execution_budget(out, now=None):
    started = json.loads((out / "job-budget.json").read_text())["startedMonotonic"]
    elapsed = (time.monotonic() if now is None else now) - started
    if elapsed < 0 or elapsed >= 660:
        raise RuntimeError("Diagnostic execution budget exhausted or invalid; reserve evidence collection")
    return min(600, 660 - elapsed)


def run(out):
    if not (out / "prepared.json").is_file():
        raise RuntimeError("Preparation did not complete")
    udid = owned_simulator(out)
    if not udid:
        raise RuntimeError("Owned Simulator missing")
    allowed_seconds = execution_budget(out)
    cmd = ["xcodebuild", "-project", str(out / "source/ios/StandClear.xcodeproj"),
           "-scheme", "StandClear", "-destination", "platform=iOS Simulator,id=" + udid,
           "-derivedDataPath", str(out / "DerivedData"), "-resultBundlePath", str(out / "DestinationClose.xcresult"),
           "-parallel-testing-enabled", "NO", "-only-testing:" + TEST,
           "build", "analyze", "test", "CODE_SIGNING_ALLOWED=NO"]
    save(out / "xcodebuild-command.json", cmd)
    started = utc()
    timed_out = False
    with (out / "xcodebuild.log").open("w") as handle:
        process = subprocess.Popen(cmd, stdout=handle, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            code = process.wait(timeout=allowed_seconds)
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
                                   "returnCode": code, "timedOut": timed_out,
                                   "allowedSeconds": allowed_seconds})
    if code:
        raise RuntimeError(f"xcodebuild returned {code}; no retry or ignored failure")


def validate_trace(raw):
    rows = json.loads(raw)
    if not isinstance(rows, list) or not rows:
        raise RuntimeError("Expected a nonempty search trace")
    if any(not isinstance(row, dict) or not row.get("timestamp")
           or not row.get("eventMessage", "").startswith("[SCSearchTrace]") for row in rows):
        raise RuntimeError("Malformed search-state log records")
    if not any("destination=true" in row["eventMessage"] for row in rows):
        raise RuntimeError("Destination picker trace absent; test may not have reached it")
    return len(rows)


def classify_test_case(log):
    target, suite, method = TEST.split("/")
    prefix = f"Test Case '-[{target}.{suite} {method}]' "
    pattern = re.compile(re.escape(prefix) + r"(?:(started)\.|(passed|failed|skipped) \((\d+(?:\.\d+)?) seconds\)\.)")
    events = []
    for line_number, line in enumerate(log.splitlines(), 1):
        if not line.startswith(prefix):
            continue
        match = pattern.fullmatch(line)
        event = {"line": line_number, "status": "unrecognized"}
        if match:
            event["status"] = match[1] or match[2]
            if match[3]:
                event["durationSeconds"] = float(match[3])
        events.append(event)
    status = "not_observed"
    if events:
        status = "incomplete"
        if len(events) == 2 and events[0]["status"] == "started" and events[1]["status"] in {"passed", "failed", "skipped"}:
            status = events[1]["status"]
        elif len(events) >= 2 or any(event["status"] == "unrecognized" for event in events):
            status = "ambiguous"
    return {"identifier": TEST, "status": status, "events": events,
            "failureObserved": any(event["status"] == "failed" for event in events)}


def classify_outcome(out):
    """Offline evidence description, never a substitute for process/check results."""
    report = {"diagnosticOnly": True, "productionMergeGate": False, "warnings": [], "evidenceSHA256": {}}
    log = ""
    try:
        path = out / "xcodebuild.log"
        log = path.read_text()
        report["evidenceSHA256"][path.name] = sha(path)
    except (OSError, UnicodeError) as error:
        report["warnings"].append("Cannot read test stdout: " + str(error))
    report["testCase"] = classify_test_case(log)
    report["animationNotificationWarnings"] = log.count("App animations complete notification not received")
    report["command"] = {"status": "not_recorded", "returnCode": None, "timedOut": None}
    try:
        path = out / "run-result.json"
        raw = path.read_text()
        report["evidenceSHA256"][path.name] = sha(path)
        record = json.loads(raw)
        if not isinstance(record, dict) or type(record.get("returnCode")) is not int or type(record.get("timedOut")) is not bool:
            raise ValueError("Expected integer returnCode and Boolean timedOut")
        code, timed_out = record["returnCode"], record["timedOut"]
        report["command"] = {"status": "timed_out" if timed_out else ("succeeded" if code == 0 else "failed"),
                             "returnCode": code, "timedOut": timed_out}
        if timed_out and code == 0:
            report["warnings"].append("Timeout is recorded with zero return code; do not treat this as command success")
    except (OSError, UnicodeError, ValueError) as error:
        if path.exists():
            report["command"]["status"] = "invalid_record"
        report["warnings"].append("Cannot validate command result: " + str(error))
    bundle = out / "DestinationClose.xcresult"
    info = bundle / "Info.plist"
    state = "missing" if not bundle.is_dir() else "incomplete"
    if info.is_file():
        try:
            data = plistlib.loads(info.read_bytes())
            if not isinstance(data, dict):
                raise ValueError("Result bundle metadata is not a dictionary")
            if (bundle / "Data").is_dir():
                state = "metadata_present"
        except (OSError, ValueError, plistlib.InvalidFileException, ExpatError) as error:
            state = "invalid_metadata"
            report["warnings"].append("Cannot read result bundle metadata: " + str(error))
    report["xcresult"] = {"state": state, "directoryPresent": bundle.is_dir(),
                          "infoPlistPresent": info.is_file(), "dataDirectoryPresent": (bundle / "Data").is_dir(),
                          "readerValidated": False}
    report["limitations"] = ["Case status describes exact matching stdout events only, not the full suite or workflow.",
                              "Metadata presence alone does not establish a valid/finalized xcresult.",
                              "Pending cleanup at a deadline does not establish a persistent hang."]
    return report


def collect(out):
    report = {"collectedUTC": utc(), "errors": [], "trace": "missing"}
    save(out / "collection-report.json", report)
    udid = None
    correlated = False
    try:
        metadata = out / "metadata.json"
        correlated = json.loads(metadata.read_text()).get("correlated") is True if metadata.is_file() else False
        udid = owned_simulator(out)
        if not udid:
            raise RuntimeError("No owned Simulator was created")
        # Write raw bytes first. Parse/validation failure must not discard evidence.
        prefix = "[SCSearchTraceV2]" if correlated else "[SCSearchTrace]"
        raw = command(["xcrun", "simctl", "spawn", udid, "log", "show", "--last", "30m",
                       "--predicate", f'eventMessage BEGINSWITH "{prefix}"', "--style", "json"],
                      out, "search-state", timeout=30)
        report["trace"] = "raw-preserved"
        report["traceSHA256"] = sha(out / "search-state.log")
        normalized = normalize_app_trace(raw)[0] if correlated else None
        report["events"] = validate_trace(json.dumps(normalized) if correlated else raw)
        report["trace"] = "validated"
    except Exception as error:
        report["errors"].append(str(error))
    finally:
        # Only shut down the device this driver created, after exporting its trace.
        # The ephemeral hosted runner owns disposal; no user devices are deleted.
        if udid:
            try:
                sim(["shutdown", udid], out, "shutdown-owned", timeout=15)
            except Exception as error:
                report["errors"].append(str(error))
        if (out / "search-state.log").is_file():
            try:
                raw = (out / "search-state.log").read_text()
                if correlated:
                    log = (out / "xcodebuild.log").read_text() if (out / "xcodebuild.log").is_file() else ""
                    correlation = correlate(raw, log)
                    save(out / "correlation-report.json", correlation)
                    report["correlationReport"] = "correlation-report.json"
                    if not correlation["markerTransportQualified"] or correlation["clockOrdering"] != "consistent_observed_order":
                        report["errors"].append("Correlated marker qualification incomplete; see correlation-report.json")
                    coverage = correlation.get("coverage", {"coverage": "ambiguous", "errors": correlation["errors"]})
                else:
                    coverage = summarize_trace(raw)
                save(out / "trace-coverage.json", coverage)
                report["traceCoverageReport"] = "trace-coverage.json"
                report["traceCoverage"] = coverage["coverage"]
            except Exception as error:
                report["errors"].append("Trace coverage reporting failed: " + str(error))
        try:
            outcome = classify_outcome(out)
            save(out / "outcome-report.json", outcome)
            report["outcomeReport"] = "outcome-report.json"
            report["xcresult"] = outcome["xcresult"]
        except Exception as error:
            report["errors"].append("Outcome reporting failed: " + str(error))
        save(out / "collection-report.json", report)
    if report["errors"]:
        raise RuntimeError("Evidence collection incomplete; see collection-report.json")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=["prepare", "run", "collect"])
    parser.add_argument("--output", required=True)
    parser.add_argument("--patch")
    parser.add_argument("--patch-sha256")
    parser.add_argument("--correlated", action="store_true")
    args = parser.parse_args()
    out = Path(args.output).resolve()
    out.mkdir(parents=True, exist_ok=True)
    try:
        if args.stage == "prepare":
            prepare(args, out)
        elif args.stage == "run":
            run(out)
        else:
            collect(out)
    except Exception as error:
        save(out / (args.stage + "-error.json"), {"utc": utc(), "error": str(error)})
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
