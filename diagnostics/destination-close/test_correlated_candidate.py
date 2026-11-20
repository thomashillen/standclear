import hashlib
import json
from pathlib import Path
import unittest

import correlated_candidate as candidate


class CorrelatedCandidate(unittest.TestCase):
    def marker(self, event, uptime, session="11111111-2222-3333-4444-555555555555"):
        return f"[SCSearchCommand] session={session} event={event} uptime={uptime} wall={1000 + uptime}"

    def log(self, events):
        return "\n".join(self.marker(e, n) for n, e in enumerate(events))

    def test_tap_return_is_not_native_delivery_or_view_identity(self):
        report = candidate.parse_commands(self.log(candidate.BRANCHES[0]))
        self.assertEqual(report["status"], "tap_returned")
        self.assertEqual(report["nativeCloseActionDelivery"], "not_recorded")
        self.assertEqual(report["viewIdentity"], "not_recorded")
        self.assertEqual(report["clockDomainValidation"], "pending_native_validation")

    def test_absent_branch_is_not_tap_execution(self):
        self.assertEqual(candidate.parse_commands(self.log(candidate.BRANCHES[1]))["status"], "close_absent")

    def test_truncated_tap_is_not_return_or_action_failure(self):
        for prefix in (candidate.BRANCHES[0][:1], candidate.BRANCHES[0][:2], candidate.BRANCHES[0][:3]):
            self.assertEqual(candidate.parse_commands(self.log(prefix))["status"], "incomplete")
        self.assertEqual(candidate.parse_commands("")["status"], "not_observed")

    def test_duplicate_or_mixed_branches_and_sessions_are_ambiguous(self):
        for events in (candidate.BRANCHES[0] * 2, candidate.BRANCHES[0][1:],
                       ("close.exists.begin", "close.absent", "close.tap.begin")):
            self.assertEqual(candidate.parse_commands(self.log(events))["status"], "ambiguous")
        log = self.log(candidate.BRANCHES[0])
        log = log.replace("session=11111111", "session=22222222", 1)
        self.assertEqual(candidate.parse_commands(log)["status"], "ambiguous")

    def test_invalid_or_reordered_clocks_and_malformed_markers_are_ambiguous(self):
        log = self.log(candidate.BRANCHES[0])
        for modified in (log.replace("uptime=2", "uptime=1e999"), log.replace("uptime=2", "uptime=0"),
                         log.replace("uptime=2", "uptime=1..2"), log.replace("uptime=2", "uptime=-1"),
                         log.replace("wall=1002", "wall=999"), log + "\n[SCSearchCommand] broken"):
            self.assertEqual(candidate.parse_commands(modified)["status"], "ambiguous")

    def test_original_source_hash_guard_and_unique_anchors(self):
        with self.assertRaises(ValueError):
            candidate.instrument("not the original app", "not the original test")
        for text in ("missing", "anchor anchor"):
            with self.assertRaises(ValueError):
                candidate.replace_once(text, "anchor", "new")

    def test_candidate_patch_matches_manifest_and_selected_workflow(self):
        folder = Path(__file__).parent
        manifest = json.loads((folder / "correlated-candidate.json").read_text())
        self.assertEqual(hashlib.sha256((folder / "correlated-candidate.patch").read_bytes()).hexdigest(), manifest["patchSHA256"])
        self.assertEqual(manifest["originalSHA256"], {candidate.APP_PATH: candidate.SOURCE_SHA, candidate.TEST_PATH: candidate.TEST_SHA})
        workflow = folder.parents[1] / ".github/workflows/destination-close-diagnostic.yml"
        self.assertIn("--patch diagnostics/destination-close/correlated-candidate.patch", workflow.read_text())
        self.assertIn(manifest["patchSHA256"], workflow.read_text())
        self.assertIn("--correlated", workflow.read_text())


if __name__ == "__main__":
    unittest.main()
