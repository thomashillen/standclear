# Train motion on Apple Maps

A moving car shows an estimated position along its reported subway segment. A usable vehicle timestamp, matching trip, route, direction, next stop and future ETA are required for interpolation. Trains stop at the predicted platform. Unknown, parked, incompatible or implausible observations stay at the existing discrete estimate. Missing or failed feeds and expired snapshots use the live map’s existing visibility rules.

The engine indexes track distances when static data changes, keeps one trajectory per current trip, and samples along the polyline. A small compatible correction blends over at most four seconds. Larger discontinuities replace the trajectory. Camera pan, heading, zoom and the selected route are independent of these updates.

Only the visible, active Apple map samples moving cars, at most four times per second. With Reduce Motion or no eligible movement the map samples discretely for age and expiry. Leaving the map or resigning the active scene clears motion history. A fresh cached observation can appear discretely on reentry until the next generation. The Mapbox fallback and web client retain their own rendering behavior.

Dense-map pan and zoom, battery use and fold transitions still need device measurements. Different reported trains may be eligible to move at different times even on the same line.

Reported `6X`, `7X`, and `FX` trains use their exact static route geometry when available, otherwise the existing `6`, `7`, or `F` geometry. A fallback moving segment requires both reported stops to be present; unsupported branches do not gain an invented path. The car retains its reported express ID and announces express service. Motion still requires the exact reported trip, route, direction, next stop and ETA, so a base-route prediction cannot animate an express report. Unknown route suffixes and separate shuttles are not merged. This geometry fallback does not establish an express stopping pattern or change trip-planning boarding choices.
