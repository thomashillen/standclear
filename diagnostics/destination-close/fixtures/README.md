# Outcome fixture provenance

Source: Stand Clear diagnostic [run 42585565250](https://github.com/thomashillen/standclear/actions/runs/42585565250),
job 129054430881, artifact 13659462570, diagnostic head
`570fc7fac228c090e73a8f2deb3ef8edcd0e5a8a`.

- `passed-case-timeout.log` contains verbatim selected `xcodebuild.log` lines
  486, 539, 1036, 1524, 1549, 1562 and 2237. These are excerpts, not contiguous
  output or a replacement for the raw artifact. Raw log SHA-256:
  `1b21d12d11f030fb807bf63e84469e5116d88a7205134f3765a57b575563db4d`.
- `run-result.json` is the unmodified command record. SHA-256:
  `2263c24d5d98cb41a5a756b0a66483a4df3a7ec617084d15c4d1a63b698caabc`.
- Tests recreate the observed partial bundle shape (Data directory, missing
  Info.plist) without copying the 62 MB artifact. Other edge cases are synthetic
  and are constructed explicitly in `test_driver.py`.
- `destination-visits.json` projects records 9–24 (1-based) of the same
  artifact's `search-state.log` onto timestamp, eventMessage, processID and
  bootUUID, unchanged. Raw source SHA-256:
  `88324d17b3b71163d9ebe95f3aa97f65e7382be86c1e5bf9bac709ebcbb5fee2`.
  This contains the first two destination visits: the
  cancellation visit and the subsequent explicit replacement visit. It is
  deliberately not a native Close action callback. Synthetic missing,
  truncated, overlapping, reordered and same-interval reactivation variants
  are constructed in `test_trace_coverage.py`.

The case passed, but the command timed out and its xcresult was incomplete.
Cleanup was pending at the deadline; that does not prove a persistent hang.
This fixture supplies no production merge-gate evidence.
