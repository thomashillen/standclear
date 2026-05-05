"use client";

import { useEffect, useState } from "react";
import {
  Bell,
  BellRing,
  Home,
  Briefcase,
  ChevronRight,
  Info,
  X,
  Train,
  MapPin,
  Footprints,
  Compass,
  Sparkles,
  MoreHorizontal,
  Wand2,
} from "lucide-react";
import { useAlerts } from "@/lib/useAlerts";
import { useCommute } from "@/lib/useFavorites";
import { useSheetDrag } from "@/lib/useSheetDrag";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertsDialog } from "./AlertsButton";
import {
  isGlassTiltGated,
  isGlassTiltGranted,
  requestGlassTiltPermission,
} from "./GlassTilt";

// ─── MoreSheet ───────────────────────────────────────────────────────
// Secondary-actions menu reachable from a "More" button in the floating
// header. Surfaces:
//
//   • Service alerts (with severity-tinted icon + count badge)
//   • Home / Work commute anchors (current value, tap to edit, X to
//     clear that anchor specifically)
//   • About StandClear
//
// Rendered as a bottom-sheet panel — same chrome (ios-glass material,
// drag handle, drag-to-dismiss, X close button, mobile-bottom /
// desktop-side layout) as NearbyPanel / StationPanel / LinePanel /
// SearchSheet so the system reads as one design language. Settings and
// nav share the same panel grammar; only the contents differ.

interface Props {
  open: boolean;
  onClose: () => void;
  /** Open the SearchSheet so the rider can pick a Home address.
   *  SearchSheet's existing per-row Home icon does the actual pinning;
   *  we just route the rider there. */
  onSetHome: () => void;
  /** Same idea for Work. */
  onSetWork: () => void;
}

function endpointLabel(
  ep: ReturnType<typeof useCommute>["home"] | ReturnType<typeof useCommute>["work"],
): string | null {
  if (!ep) return null;
  if (ep.kind === "address") return ep.name;
  // Station endpoints store the stopId, not a friendly name. Without
  // looking up the station index here we can show "Pinned station" as
  // a placeholder; when the rider opens SearchSheet they'll see the
  // actual station name on the row.
  return "Pinned station";
}

export default function MoreSheet({ open, onClose, onSetHome, onSetWork }: Props) {
  const data = useAlerts();
  const { home, work, setAnchor } = useCommute();
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  // Reactive-glass-on-tilt opt-in. Mirrors the localStorage flag the
  // `<GlassTilt />` provider reads at startup; we mirror it here so
  // the row's enabled state updates live after the permission prompt
  // resolves. `tiltGated` is true on iOS Safari (the only platform
  // that hides the toggle behind a user gesture); on every other
  // platform the orientation listener attaches automatically and the
  // row would just confuse riders, so we omit it.
  const [tiltGated, setTiltGated] = useState(false);
  const [tiltGranted, setTiltGranted] = useState(false);
  const [tiltDenied, setTiltDenied] = useState(false);
  // Re-read the GlassTilt module's localStorage flag every time the
  // sheet opens — the rider may have granted/denied permission in the
  // dialog since last open. setState-in-effect is the documented
  // "subscribe to external system" pattern here.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setTiltGated(isGlassTiltGated());
    setTiltGranted(isGlassTiltGranted());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  const totalAlerts = data?.alerts.length ?? 0;
  const hasSevere = (data?.alerts ?? []).some((a) => a.severity === "severe");
  const hasWarning = (data?.alerts ?? []).some((a) => a.severity === "warning");
  const tone: "severe" | "warning" | "info" | null = hasSevere
    ? "severe"
    : hasWarning
      ? "warning"
      : totalAlerts > 0
        ? "info"
        : null;

  const homeLabel = endpointLabel(home);
  const workLabel = endpointLabel(work);

  // Drag-to-dismiss only — no half/full detents (the menu is short
  // enough that a fixed full-height sheet works). Both rests sit at
  // 0px so the tap-to-toggle is a visual no-op while drag-down past
  // the dismiss threshold still fires onClose.
  const { sheetStyle, handlers, contentHandlers, onHandleTap, isDragging } = useSheetDrag({
    halfRestingY: "0px",
    open,
    onDismiss: onClose,
  });

  // Note: don't early-return null when !open. AlertsDialog and
  // AboutDialog render as siblings of the panel below, and the
  // "Service alerts" / "About" rows close MoreSheet *and* open the
  // sibling dialog in the same handler. If we returned null on close,
  // those dialogs would unmount before they could mount-with-open=true,
  // which would manifest as "tapping the alerts row does nothing."
  // The panel div itself is gated by `open &&` instead.

  return (
    <>
      {open && (
      <div
        className="
          absolute z-20 overflow-hidden flex flex-col
          inset-x-0 bottom-0 top-[var(--panel-top-rest)] rounded-t-[28px] border-t border-white/[0.08]
          sm:inset-auto sm:right-3 sm:top-[var(--panel-top-rest)] sm:bottom-3 sm:w-[340px] sm:h-auto sm:rounded-[22px] sm:border sm:border-white/[0.08]
          ios-glass ios-glass--sheet
          shadow-[0_20px_60px_-10px_rgba(0,0,0,0.6)]
          pb-[env(safe-area-inset-bottom)]
        "
        style={sheetStyle}
        data-glass-active={isDragging || undefined}
      >
        <button
          type="button"
          className="sm:hidden flex items-start justify-center h-7 pt-1.5 flex-shrink-0 touch-none w-full"
          onClick={onHandleTap}
          aria-label="Drag to dismiss"
        >
          <div className="w-9 h-[5px] rounded-full bg-white/25" />
        </button>

        <div
          className="flex items-center justify-between px-4 pt-1.5 pb-2.5 flex-shrink-0 sm:cursor-auto cursor-grab active:cursor-grabbing touch-none sm:pt-4 sm:pb-3"
          onPointerDown={handlers.onPointerDown}
          onPointerMove={handlers.onPointerMove}
          onPointerUp={handlers.onPointerUp}
          onPointerCancel={handlers.onPointerCancel}
        >
          <div className="flex items-center gap-2 text-white">
            <MoreHorizontal className="w-[17px] h-[17px]" />
            <span className="font-black text-[16px] tracking-tight">More</span>
          </div>
          <button
            onClick={onClose}
            className="press text-white opacity-85 hover:opacity-100 w-9 h-9 -mr-1 flex items-center justify-center rounded-full bg-white/[0.08] hover:bg-white/[0.12] touch-manipulation"
            aria-label="Close panel"
          >
            <X className="w-[16px] h-[16px]" strokeWidth={2.5} />
          </button>
        </div>

        <div
          className="flex-1 overflow-y-auto ios-scroll px-3 pb-4 space-y-4"
          onTouchStart={contentHandlers.onTouchStart}
          onTouchMove={contentHandlers.onTouchMove}
          onTouchEnd={contentHandlers.onTouchEnd}
          onTouchCancel={contentHandlers.onTouchCancel}
        >
          {/* ─── Service alerts ─── */}
          <section>
            <h3 className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              System
            </h3>
            <button
              type="button"
              onClick={() => {
                // Close the More menu first, then open the alerts
                // dialog. The brief gap (one render frame) avoids
                // shadcn's overlay double-stacking.
                onClose();
                setAlertsOpen(true);
              }}
              className="press w-full flex items-center gap-3 px-3 py-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] touch-manipulation"
            >
              <span
                className={`flex items-center justify-center w-9 h-9 rounded-full flex-shrink-0 ${
                  tone === "severe"
                    ? "bg-rose-500/20 text-rose-200 ring-1 ring-rose-500/40"
                    : tone === "warning"
                      ? "bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/40"
                      : tone === "info"
                        ? "bg-sky-500/15 text-sky-200 ring-1 ring-sky-500/30"
                        : "bg-white/[0.08] text-gray-300"
                }`}
              >
                {hasSevere ? (
                  <BellRing className="w-4 h-4" />
                ) : (
                  <Bell className="w-4 h-4" />
                )}
              </span>
              <span className="flex-1 min-w-0 text-left">
                <span className="block text-[14px] font-semibold text-gray-100">
                  Service alerts
                </span>
                <span
                  className={`block text-[11px] truncate ${
                    tone === "severe"
                      ? "text-rose-300"
                      : tone === "warning"
                        ? "text-amber-300"
                        : "text-gray-400"
                  }`}
                >
                  {!data
                    ? "Loading…"
                    : totalAlerts === 0
                      ? "All clear across the system"
                      : `${totalAlerts} active alert${
                          totalAlerts === 1 ? "" : "s"
                        }`}
                </span>
              </span>
              <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
            </button>
          </section>

          {/* ─── Commute anchors ─── */}
          <section>
            <h3 className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Commute
            </h3>
            <div className="space-y-1.5">
              <AnchorRow
                icon={<Home className="w-4 h-4" />}
                label="Home"
                value={homeLabel}
                emptyHint="Add home address"
                accent="emerald"
                onTap={() => {
                  onClose();
                  onSetHome();
                }}
                onClear={
                  home ? () => setAnchor("home", null) : undefined
                }
              />
              <AnchorRow
                icon={<Briefcase className="w-4 h-4" />}
                label="Work"
                value={workLabel}
                emptyHint="Add work address"
                accent="sky"
                onTap={() => {
                  onClose();
                  onSetWork();
                }}
                onClear={
                  work ? () => setAnchor("work", null) : undefined
                }
              />
              <p className="px-3 pt-1 text-[11px] text-gray-500 leading-snug">
                Pin an address — the planner uses every nearby station
                as a candidate so your route stays fastest from
                whichever direction you&apos;re coming from.
              </p>
            </div>
          </section>

          {/* ─── Personalize ─── */}
          {/* Surfaces only on iOS, where DeviceOrientation is gated
              behind a one-time permission prompt. On every other
              platform the tilt highlight already works without a
              user gesture, so the row would be a confusing no-op. */}
          {tiltGated && (
            <section>
              <h3 className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                Personalize
              </h3>
              <button
                type="button"
                disabled={tiltGranted}
                onClick={async () => {
                  // Must run synchronously inside the click handler
                  // for iOS to honor the permission prompt — no
                  // `await` before the first `requestPermission()`
                  // call. The promise resolves later, but the gesture
                  // chain has already been preserved.
                  const result = await requestGlassTiltPermission();
                  if (result === "granted") {
                    setTiltGranted(true);
                    setTiltDenied(false);
                  } else if (result === "denied") {
                    setTiltDenied(true);
                  }
                }}
                className={`press w-full flex items-center gap-3 px-3 py-3 rounded-2xl touch-manipulation ${
                  tiltGranted
                    ? "bg-emerald-500/[0.10] ring-1 ring-emerald-400/[0.20] cursor-default"
                    : "bg-white/[0.04] hover:bg-white/[0.08]"
                }`}
              >
                <span
                  className={`flex items-center justify-center w-9 h-9 rounded-full flex-shrink-0 ${
                    tiltGranted
                      ? "bg-emerald-400/20 text-emerald-200 ring-1 ring-emerald-400/30"
                      : "bg-white/[0.08] text-gray-300"
                  }`}
                >
                  <Wand2 className="w-4 h-4" />
                </span>
                <span className="flex-1 min-w-0 text-left">
                  <span className="block text-[14px] font-semibold text-gray-100">
                    Reactive glass on tilt
                  </span>
                  <span className="block text-[12px] text-gray-400 truncate">
                    {tiltGranted
                      ? "Enabled — glass highlights track your phone's pose"
                      : tiltDenied
                        ? "Permission denied. Enable in Settings → Safari → Motion & Orientation Access"
                        : "Make panels and pills shimmer as you tilt your phone"}
                  </span>
                </span>
                {tiltGranted ? (
                  <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-300 flex-shrink-0">
                    On
                  </span>
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
                )}
              </button>
            </section>
          )}

          {/* ─── About ─── */}
          <section>
            <h3 className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              About
            </h3>
            <button
              type="button"
              onClick={() => {
                onClose();
                setAboutOpen(true);
              }}
              className="press w-full flex items-center gap-3 px-3 py-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] touch-manipulation"
            >
              <span className="flex items-center justify-center w-9 h-9 rounded-full bg-white/[0.08] text-gray-300 flex-shrink-0">
                <Info className="w-4 h-4" />
              </span>
              <span className="flex-1 min-w-0 text-left">
                <span className="block text-[14px] font-semibold text-gray-100">
                  About StandClear
                </span>
                <span className="block text-[12px] text-gray-400 truncate">
                  What this app does, where the data comes from
                </span>
              </span>
              <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
            </button>
          </section>
        </div>
      </div>
      )}

      <AlertsDialog open={alertsOpen} onOpenChange={setAlertsOpen} />
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    </>
  );
}

// ─── AboutDialog ─────────────────────────────────────────────────────
// Project info + feature highlights + data attribution. Opened from
// MoreSheet's About row. Lives in MoreSheet (not its own file) since
// it's a one-screen sibling and the content is closely tied to the
// More menu's hierarchy. Kept as a Radix Dialog (vs the bottom-sheet
// pattern MoreSheet now uses) — content is read-only and doesn't need
// a drag-to-dismiss gesture; a centered modal with the auto-X close
// is the simpler match for "tap row → see info → dismiss."
function AboutDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="ios-glass ios-glass--modal border-white/[0.08] text-white rounded-t-[28px] sm:rounded-[22px] max-h-[85dvh] sm:max-h-[80dvh] overflow-hidden flex flex-col pb-[env(safe-area-inset-bottom)] sm:pb-6 shadow-[0_20px_60px_-10px_rgba(0,0,0,0.6)]">
        <DialogHeader className="flex-shrink-0 text-left pr-12">
          <DialogTitle className="text-white text-xl font-black tracking-tight flex items-center gap-2">
            <span className="text-[26px]" aria-hidden>
              🚇
            </span>
            StandClear
          </DialogTitle>
          <DialogDescription className="text-gray-400 text-left">
            Live, real-time NYC subway in your pocket.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto ios-scroll -mx-2 px-2 mt-2 space-y-4">
          <section>
            <p className="text-[13px] text-gray-300 leading-relaxed">
              StandClear is a real-time view of the NYC subway,
              streaming train positions, arrivals, and service alerts
              straight from the MTA. Plan a trip, see exactly when the
              next train arrives, and watch the system breathe.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 px-1">
              What you can do
            </h3>
            <FeatureRow
              icon={<Train className="w-4 h-4" />}
              title="Watch the system live"
              body="Every train, animated on the map. Headlights and direction at a glance."
              tint="emerald"
            />
            <FeatureRow
              icon={<MapPin className="w-4 h-4" />}
              title="Tap any station"
              body="Live arrivals on every platform. The next 4 trains in each direction with seconds-precise countdowns."
              tint="sky"
            />
            <FeatureRow
              icon={<Compass className="w-4 h-4" />}
              title="Plan a trip"
              body="From an address, a station, a coffee shop — to anywhere else in NYC. Multi-route ranking by total time."
              tint="amber"
            />
            <FeatureRow
              icon={<Footprints className="w-4 h-4" />}
              title="See the walk"
              body="Walking lines from your start to the platform and from the platform to your destination."
              tint="violet"
            />
            <FeatureRow
              icon={<Sparkles className="w-4 h-4" />}
              title="Pin Home & Work"
              body="One tap to your daily commute, with the right route surfaced based on where you are right now."
              tint="rose"
            />
            <FeatureRow
              icon={<Bell className="w-4 h-4" />}
              title="Service alerts"
              body="Severity-tinted MTA alerts with affected lines surfaced as route bullets you can scan in seconds."
              tint="amber"
            />
          </section>

          <section className="space-y-1.5">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 px-1">
              Data sources
            </h3>
            <div className="px-3 py-2.5 rounded-xl bg-white/[0.04] text-[12px] text-gray-300 leading-relaxed space-y-1">
              <p>
                <span className="font-semibold text-gray-100">Trains &amp; arrivals:</span>{" "}
                MTA GTFS-Realtime feeds, refreshed every few seconds.
              </p>
              <p>
                <span className="font-semibold text-gray-100">Service alerts:</span>{" "}
                MTA GTFS-RT alerts feed.
              </p>
              <p>
                <span className="font-semibold text-gray-100">Maps &amp; addresses:</span>{" "}
                Mapbox tiles + Geocoding API.
              </p>
              <p>
                <span className="font-semibold text-gray-100">Station network:</span>{" "}
                MTA GTFS static (subway stops, shapes, transfers).
              </p>
            </div>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 px-1">
              Acknowledgements
            </h3>
            <div className="px-3 py-2.5 rounded-xl bg-white/[0.04] text-[12px] text-gray-300 leading-relaxed">
              <p>
                Built with Next.js 16, React 19, TypeScript, Mapbox-GL,
                and Tailwind v4. Designed in the iOS-26 visual idiom —
                Liquid Glass, continuous corners, spring transitions.
              </p>
              <p className="mt-2 text-gray-500 text-[11px]">
                MTA, the M logo, route bullets, and station names are
                trademarks of the New York Metropolitan Transportation
                Authority. StandClear is unaffiliated and uses
                publicly published transit data.
              </p>
            </div>
          </section>

          <section className="px-1 text-center">
            <span className="text-[11px] text-gray-500 tabular-nums">
              v0.9 · MVP build
            </span>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FeatureRow({
  icon,
  title,
  body,
  tint,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  tint: "emerald" | "sky" | "amber" | "violet" | "rose";
}) {
  const tintClass = {
    emerald: "bg-emerald-500/15 text-emerald-200 ring-emerald-500/30",
    sky: "bg-sky-500/15 text-sky-200 ring-sky-500/30",
    amber: "bg-amber-500/15 text-amber-200 ring-amber-500/30",
    violet: "bg-violet-500/15 text-violet-200 ring-violet-500/30",
    rose: "bg-rose-500/15 text-rose-200 ring-rose-500/30",
  }[tint];
  return (
    <div className="flex items-start gap-3 px-3 py-2.5 rounded-xl bg-white/[0.04]">
      <span
        className={`flex items-center justify-center w-9 h-9 rounded-full ring-1 flex-shrink-0 ${tintClass}`}
      >
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-gray-100">{title}</p>
        <p className="text-[11.5px] text-gray-400 leading-snug mt-0.5">
          {body}
        </p>
      </div>
    </div>
  );
}

function AnchorRow({
  icon,
  label,
  value,
  emptyHint,
  accent,
  onTap,
  onClear,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  emptyHint: string;
  accent: "emerald" | "sky";
  onTap: () => void;
  /** Optional remove handler. When provided AND `value` is set, the
   *  row renders a small X button that clears just this anchor (the
   *  whole-row tap still routes the rider to SearchSheet to re-set
   *  it). Lets the rider drop one anchor without nuking both — Clear
   *  Commute as a single button conflated those. */
  onClear?: () => void;
}) {
  const isSet = value !== null;
  const accentBg =
    accent === "emerald"
      ? "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/30"
      : "bg-sky-500/15 text-sky-200 ring-1 ring-sky-500/30";
  return (
    <div className="relative flex items-stretch w-full rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] touch-manipulation overflow-hidden">
      <button
        type="button"
        onClick={onTap}
        className="press flex-1 flex items-center gap-3 px-3 py-3 text-left min-w-0"
      >
        <span
          className={`flex items-center justify-center w-9 h-9 rounded-full flex-shrink-0 ${accentBg}`}
        >
          {icon}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[14px] font-semibold text-gray-100">
            {label}
          </span>
          <span
            className={`block text-[12px] truncate ${
              isSet ? "text-gray-300" : "text-gray-500"
            }`}
          >
            {value ?? emptyHint}
          </span>
        </span>
        {!isSet && (
          <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
        )}
      </button>
      {isSet && onClear && (
        <button
          type="button"
          onClick={(e) => {
            // Don't fall through to the row's onTap — clearing and
            // immediately re-opening the search to set the same
            // anchor would surprise the rider.
            e.stopPropagation();
            onClear();
          }}
          aria-label={`Remove ${label}`}
          className="press flex items-center justify-center w-11 mr-1 my-1 rounded-xl text-gray-400 hover:text-rose-300 hover:bg-rose-500/10 flex-shrink-0 touch-manipulation"
        >
          <X className="w-4 h-4" strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
