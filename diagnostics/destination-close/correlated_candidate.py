"""Offline-only candidate generation. This is deliberately not wired into driver.py."""
import difflib
import hashlib
import math
import re


SOURCE_SHA = "239157a0c88bb3c2fc8932218f095947e59e46d1477923fa0aade9f1db1b9039"
TEST_SHA = "5d11a8e7fe84640e7f3670a112aabaa61b0cad6b9558550f493500ac745456bf"
APP_PATH = "ios/StandClear/PlacePreview.swift"
TEST_PATH = "ios/StandClearUITests/StandClearUITests.swift"

APP_HELPER = '''    private func traceSearchState(_ event: String) {
        let session = ProcessInfo.processInfo.environment["SC_SEARCH_TRACE_SESSION"] ?? "unassigned"
        NSLog("[SCSearchTraceV2] session=%@ %@; destination=%@ presented=%@ focused=%@ query=%@ uptime=%.6f wall=%.6f",
              session, event, String(destination), String(searchPresented), String(searchFocused), query,
              ProcessInfo.processInfo.systemUptime, Date().timeIntervalSince1970)
    }

'''
OBSERVERS = '''        .onChange(of: searchPresented, initial: true) { (old: Bool, new: Bool) in
            traceSearchState("presented \\(old) -> \\(new)")
        }
        .onChange(of: searchFocused, initial: true) { (old: Bool, new: Bool) in
            traceSearchState("focused \\(old) -> \\(new)")
        }
        .onAppear { traceSearchState("appear") }
        .onDisappear { traceSearchState("disappear") }
'''
TEST_HELPER = '''        // Correlation token only; this is not a SwiftUI view identity.
        let traceSession = UUID().uuidString
        func traceCloseCommand(_ event: String) {
            let uptime = ProcessInfo.processInfo.systemUptime
            let wall = Date().timeIntervalSince1970
            print("[SCSearchCommand] session=\\(traceSession) event=\\(event) uptime=\\(uptime) wall=\\(wall)")
        }
'''
METHOD_START = "    private func checkPlaceDestinationEditing(expanded: Bool, largeType: Bool) {\n"
METHOD_END = "\n    @MainActor\n    func testMuseumTransferShowsBothServicesAndInterchangeOnMainMap()"
CLOSE_ORIGINAL = '''        if closeSearch.exists {
            closeSearch.tap()
        }
'''
CLOSE_INSTRUMENTED = '''        traceCloseCommand("close.exists.begin")
        if closeSearch.exists {
            traceCloseCommand("close.tap.begin")
            closeSearch.tap()
            traceCloseCommand("close.tap.return")
        } else {
            traceCloseCommand("close.absent")
        }
'''


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError("Candidate source anchor missing or duplicated")
    return text.replace(old, new, 1)


def instrument(app, tests):
    """Original bytes are SHA guarded; removing only these additions restores them."""
    for value, expected in ((app, SOURCE_SHA), (tests, TEST_SHA)):
        if hashlib.sha256(value.encode()).hexdigest() != expected:
            raise ValueError("Candidate requires the exact original diagnosed source")
    anchor = "        choose(origin)\n    }\n\n"
    app = replace_once(app, anchor, anchor + APP_HELPER)
    anchor = "        .searchFocused($searchFocused)\n"
    app = replace_once(app, anchor, anchor + OBSERVERS)
    before, rest = tests.split(METHOD_START, 1)
    method, after = rest.split(METHOD_END, 1)
    method = TEST_HELPER + method
    anchor = '        app.launchArguments = ["--ui-test-fixture", "--ui-test-noguchi"]\n'
    method = replace_once(method, anchor, anchor + '        app.launchEnvironment["SC_SEARCH_TRACE_SESSION"] = traceSession\n')
    method = replace_once(method, CLOSE_ORIGINAL, CLOSE_INSTRUMENTED)
    anchor = '        XCTAssertTrue(back.waitForExistence(timeout: 5))\n'
    method = replace_once(method, anchor, '        traceCloseCommand("back.assertion.begin")\n' + anchor)
    return app, before + METHOD_START + method + METHOD_END + after


def restore_original(app, tests):
    app = replace_once(app, APP_HELPER, "")
    app = replace_once(app, OBSERVERS, "")
    tests = replace_once(tests, TEST_HELPER, "")
    tests = replace_once(tests, '        app.launchEnvironment["SC_SEARCH_TRACE_SESSION"] = traceSession\n', "")
    tests = replace_once(tests, CLOSE_INSTRUMENTED, CLOSE_ORIGINAL)
    tests = replace_once(tests, '        traceCloseCommand("back.assertion.begin")\n', "")
    return app, tests


def make_patch(app, tests):
    changed = instrument(app, tests)
    if restore_original(*changed) != (app, tests):
        raise ValueError("Candidate changed original behavior-bearing source bytes")
    patch = ""
    for path, original, updated in zip((APP_PATH, TEST_PATH), (app, tests), changed):
        patch += "".join(difflib.unified_diff(original.splitlines(True), updated.splitlines(True),
                                            fromfile="a/" + path, tofile="b/" + path))
    # Empty context lines need no trailing whitespace; git apply accepts both forms.
    return patch.replace("\n \n", "\n\n"), changed


UUID = r"[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}"
NUMBER = r"[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?"
COMMAND = re.compile(rf"\[SCSearchCommand\] session=({UUID}) event=([a-z.]+) uptime=({NUMBER}) wall=({NUMBER})")
BRANCHES = [("close.exists.begin", "close.tap.begin", "close.tap.return", "back.assertion.begin"),
            ("close.exists.begin", "close.absent", "back.assertion.begin")]


def parse_commands(log):
    """Parse only test-command evidence; never infer native action delivery."""
    report = {"status": "not_observed", "events": [], "errors": [], "nativeCloseActionDelivery": "not_recorded",
              "viewIdentity": "not_recorded", "clockDomainValidation": "pending_native_validation"}
    for number, line in enumerate(log.splitlines(), 1):
        if "[SCSearchCommand]" not in line:
            continue
        match = COMMAND.fullmatch(line)
        if not match:
            report["errors"].append(f"Line {number}: malformed command marker")
            continue
        session, event, uptime, wall = match.groups()
        clocks = (float(uptime), float(wall))
        if not all(math.isfinite(v) and v >= 0 for v in clocks):
            report["errors"].append(f"Line {number}: invalid clocks")
            continue
        report["events"].append({"line": number, "session": session, "event": event, "uptime": clocks[0], "wall": clocks[1]})
    events = report["events"]
    if len({e["session"] for e in events}) > 1:
        report["errors"].append("Multiple sessions; do not join commands")
    if any(b[clock] < a[clock] for a, b in zip(events, events[1:]) for clock in ("uptime", "wall")):
        report["errors"].append("Clock order changed; do not correlate")
    sequence = tuple(e["event"] for e in events)
    if sequence and not any(branch[:len(sequence)] == sequence for branch in BRANCHES):
        report["errors"].append("Unexpected, duplicated or reordered command sequence")
    if report["errors"]:
        report["status"] = "ambiguous"
    elif sequence:
        report["status"] = ("tap_returned" if sequence == BRANCHES[0] else "close_absent" if sequence == BRANCHES[1]
                            else "incomplete")
    return report
