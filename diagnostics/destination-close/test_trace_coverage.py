import copy
import json
from pathlib import Path
import unittest

from trace_coverage import summarize_trace


class TraceCoverage(unittest.TestCase):
    def setUp(self):
        self.rows = json.loads(Path(__file__).with_name("fixtures").joinpath("destination-visits.json").read_text())

    def report(self, rows=None):
        return summarize_trace(json.dumps(self.rows if rows is None else rows))

    def test_real_later_visit_is_not_reactivation_of_first_visit(self):
        before = copy.deepcopy(self.rows)
        report = self.report()
        self.assertEqual(report["coverage"], "bounded_intervals")
        self.assertEqual(len(report["destinationIntervals"]), 2)
        for interval in report["destinationIntervals"]:
            self.assertEqual(interval["observationScope"], "activation_and_deactivation")
            self.assertEqual(interval["observedReactivationRows"], [])
            deactivation = next(e for e in interval["events"] if e["event"] == "presented true -> false")
            self.assertFalse(deactivation["focused"])
        self.assertEqual(report["nativeCloseActionDelivery"], "not_recorded")
        self.assertFalse(report["productionMergeGate"])
        self.assertEqual(self.rows, before)

    def test_appearance_only_is_not_dismissal_evidence(self):
        report = self.report(self.rows[:3])
        self.assertEqual(report["coverage"], "open_interval")
        self.assertEqual(report["destinationIntervals"][0]["observationScope"], "no_presentation_transition")

    def test_truncation_after_activation_does_not_claim_dismissal(self):
        report = self.report(self.rows[:6])
        self.assertEqual(report["coverage"], "open_interval")
        self.assertEqual(report["destinationIntervals"][0]["observationScope"], "activation_only")
        self.assertEqual(report["destinationIntervals"][0]["observedDeactivationRows"], [])

    def test_same_interval_reactivation_is_observed_not_assigned_a_cause(self):
        rows = copy.deepcopy(self.rows[:8])
        rows[7]["eventMessage"] = rows[7]["eventMessage"].replace("disappear", "presented false -> true").replace("presented=false", "presented=true")
        report = self.report(rows)
        self.assertEqual(report["coverage"], "open_interval")
        self.assertEqual(report["destinationIntervals"][0]["observedReactivationRows"], [8])
        self.assertEqual(report["nativeCloseActionDelivery"], "not_recorded")

    def test_changed_process_or_boot_never_joins_lifecycles(self):
        for key, value in (("processID", 999), ("bootUUID", "another-boot"), ("processID", None)):
            rows = copy.deepcopy(self.rows)
            rows[11][key] = value
            report = self.report(rows)
            self.assertEqual(report["coverage"], "ambiguous")
            self.assertTrue(report["errors"])
            self.assertNotIn("observationScope", report["destinationIntervals"][0])
            self.assertNotIn("observedReactivationRows", report["destinationIntervals"][0])

    def test_reordered_clocks_are_not_sorted_into_apparent_success(self):
        rows = copy.deepcopy(self.rows)
        rows[4], rows[5] = rows[5], rows[4]
        self.assertEqual(self.report(rows)["coverage"], "ambiguous")

    def test_missing_lifecycle_edges_and_overlaps_are_ambiguous(self):
        for rows in (self.rows[3:], self.rows[:7] + self.rows[10:]):
            self.assertEqual(self.report(rows)["coverage"], "ambiguous")

    def test_callback_snapshot_disagreement_does_not_infer_sequence(self):
        rows = copy.deepcopy(self.rows)
        rows[6]["eventMessage"] = rows[6]["eventMessage"].replace("presented=false", "presented=true")
        self.assertEqual(self.report(rows)["coverage"], "ambiguous")

    def test_malformed_records_are_not_usable_coverage(self):
        for raw in ("bad JSON", "{}", "[{}]", '[{"timestamp":"now","eventMessage":"[SCSearchTrace] destination=true"}]'):
            self.assertEqual(summarize_trace(raw)["coverage"], "ambiguous")
        self.assertEqual(summarize_trace("[]")["coverage"], "not_observed")

    def test_initial_observer_records_are_not_an_appearance(self):
        report = self.report(self.rows[:2])
        self.assertEqual(report["coverage"], "not_observed")
        self.assertEqual(report["destinationIntervals"], [])

    def test_naive_clock_is_not_correlated_with_other_clocks(self):
        rows = copy.deepcopy(self.rows)
        rows[0]["timestamp"] = rows[0]["timestamp"].replace("+0000", "")
        self.assertEqual(self.report(rows)["coverage"], "ambiguous")


if __name__ == "__main__":
    unittest.main()
