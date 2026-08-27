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
  MessageSquare,
  ExternalLink,
} from "lucide-react";
import { GithubIcon } from "@/components/marketing/GithubIcon";
import {
  FEEDBACK_URL,
  GITHUB_URL,
  VERSION_LABEL,
} from "@/lib/site";
import { stationNameByStopId } from "@/lib/stopsIndex";
import { useLines } from "@/lib/subwayData";
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
import { DragHandle } from "./DragHandle";
import { NotificationsRow } from "./NotificationsRow";
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
  lines: ReturnType<typeof useLines>,
): string | null {
  if (!ep) return null;
  if (ep.kind === "address") return ep.name;
  return stationNameByStopId(lines, ep.stopId) ?? "Pinned station";
}

export default function MoreSheet({ open, onClose, onSetHome, onSetWork }: Props) {
  const data = useAlerts();
  const lines = useLines();
  const { home, work, setAnchor } = useCommute();
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [tiltGated, setTiltGated] = useState(false);
  const [tiltGranted, setTiltGranted] = useState(false);
  const [tiltDenied, setTiltDenied] = useState(false);
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

  const homeLabel = endpointLabel(home, lines);
  const workLabel = endpointLabel(work, lines);
  const { sheetStyle, handlers, contentHandlers, onHandleTap, isDragging } = useSheetDrag({
    halfRestingY: "0px",
    open,
    onDismiss: onClose,
  });

  return (
    <>
      {open && (
      <div
        role="region"
        aria-label="More"
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
        <DragHandle onTap={onHandleTap} ariaLabel="Drag to dismiss" />

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
            className="press text-white opacity-85 hover:opacity-100 w-11 h-11 -mr-1 flex items-center justify-center rounded-full bg-white/[0.08] hover:bg-white/[0.12] touch-manipulation"
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
          <section>
            <h3 className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              System
            </h3>
            <button
              type="button"
              onClick={() => {
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

          <NotificationsRow />

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
                onClear={home ? () => setAnchor("home", null) : undefined}
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
                onClear={work ? () => setAnchor("work", null) : undefined}
              />
              <p className="px-3 pt-1 text-[11px] text-gray-500 leading-snug">
                Pin an address — the planner uses every nearby station
                as a candidate so your route stays fastest from
                whichever direction you&apos;re coming from.
              </p>
            </div>
          </section>

          {tiltGated && (
            <section>
              <h3 className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                Personalize
              </h3>
              <button
                type="button"
                disabled={tiltGranted}
                onClick={async () => {
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

          <section>
            <h3 className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              About
            </h3>
            <div className="space-y-1.5">
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
              <a
                href={FEEDBACK_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="press w-full flex items-center gap-3 px-3 py-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] touch-manipulation"
              >
                <span className="flex items-center justify-center w-9 h-9 rounded-full bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/30 flex-shrink-0">
                  <MessageSquare className="w-4 h-4" />
                </span>
                <span className="flex-1 min-w-0 text-left">
                  <span className="block text-[14px] font-semibold text-gray-100">
                    Send feedback
                  </span>
                  <span className="block text-[12px] text-gray-400 truncate">
                    Bugs, feature requests, kind words
                  </span>
                </span>
                <ExternalLink className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
              </a>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="press w-full flex items-center gap-3 px-3 py-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] touch-manipulation"
              >
                <span className="flex items-center justify-center w-9 h-9 rounded-full bg-white/[0.08] text-gray-300 flex-shrink-0">
                  <GithubIcon className="w-[15px] h-[15px]" />
                </span>
                <span className="flex-1 min-w-0 text-left">
                  <span className="block text-[14px] font-semibold text-gray-100">
                    View source on GitHub
                  </span>
                  <span className="block text-[12px] text-gray-400 truncate">
                    Source-available · open issues + PRs welcome
                  </span>
                </span>
                <ExternalLink className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
              </a>
            </div>
          </section>
        </div>
      </div>
      )}

      <AlertsDialog open={alertsOpen} onOpenChange={setAlertsOpen} />
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    </>
  );
}

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

          <p className="pt-2 text-center text-[11px] text-gray-500 tabular-nums border-t border-white/[0.06]">
            {VERSION_LABEL} · build
          </p>
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
