"use client";

import { useEffect, useState } from "react";
import { isOnline, subscribeOnline, useOnline } from "@/lib/useOnline";

// Client-side polling status panel. Hits /api/health every 15s and
// renders a per-check pill plus an overall rollup. Plain client
// component — no need for the larger useTrains-style external store.
//
// Mirrors the pause-on-hidden + pause-on-offline pattern useTrains
// and useAlerts already use: a backgrounded tab or an airplane-mode
// device shouldn't burn battery firing into the void every 15s, and
// the page is useless data-wise when the rider can't reach the
// origin anyway. Resume on visibilitychange or `online` event fires
// an immediate tick so the rider sees fresh data the moment they
// come back.

type Status = "ok" | "degraded" | "down";

interface CheckResult {
  status: Status;
  latencyMs?: number;
  detail?: string;
}

interface HealthResponse {
  status: Status;
  version: string;
  uptimeMs: number;
  timestamp: number;
  checks: {
    mta: CheckResult;
    static: CheckResult;
    runtime: CheckResult;
  };
}

const POLL_MS = 15_000;

const STATUS_COPY: Record<Status, { label: string; tone: string }> = {
  ok: {
    label: "Operational",
    tone: "bg-emerald-500/15 text-emerald-200 ring-emerald-500/30",
  },
  degraded: {
    label: "Degraded",
    tone: "bg-amber-500/15 text-amber-200 ring-amber-500/30",
  },
  down: {
    label: "Down",
    tone: "bg-rose-500/15 text-rose-200 ring-rose-500/30",
  },
};

const CHECK_LABELS: Record<keyof HealthResponse["checks"], string> = {
  mta: "MTA feed",
  static: "Static data",
  runtime: "Runtime",
};

export default function StatusPanel() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  // `online` drives the rendered "Offline" badge; the poller itself
  // reads the module-level `isOnline()` so its lifecycle doesn't
  // depend on this hook re-rendering.
  const online = useOnline();

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (!isOnline()) return;
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        // /api/health returns 503 on critical failures but the body
        // is still well-formed JSON, so don't treat 5xx as a hard
        // error — read the body and surface it.
        const body = (await res.json()) as HealthResponse;
        if (!cancelled) {
          setData(body);
          setLoadedAt(Date.now());
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    const start = () => {
      if (intervalId) return;
      if (typeof document !== "undefined" && document.hidden) return;
      if (!isOnline()) return;
      tick();
      intervalId = setInterval(tick, POLL_MS);
    };

    const stop = () => {
      if (!intervalId) return;
      clearInterval(intervalId);
      intervalId = null;
    };

    start();

    const onVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.hidden) stop();
      else start();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    const unsubOnline = subscribeOnline(() => {
      if (isOnline()) start();
      else stop();
    });

    return () => {
      cancelled = true;
      stop();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
      unsubOnline();
    };
  }, []);

  if (error && !data) {
    return (
      <div className="not-prose mt-2 mb-6 px-4 py-4 rounded-xl bg-rose-500/10 ring-1 ring-rose-500/30 text-rose-200 text-[14px]">
        Failed to reach the health endpoint: {error}
      </div>
    );
  }

  if (!data) {
    // Cold-start offline: the poller pauses while !isOnline(), so the
    // placeholder would otherwise spin forever. Surface the real
    // reason instead of pretending we're checking.
    if (!online) {
      return (
        <div className="not-prose mt-2 mb-6 px-4 py-4 rounded-xl bg-white/[0.04] text-gray-300 text-[14px]">
          Offline — health checks paused. They&rsquo;ll resume the moment
          your device reconnects.
        </div>
      );
    }
    return (
      <div className="not-prose mt-2 mb-6 px-4 py-4 rounded-xl bg-white/[0.04] text-gray-400 text-[14px] animate-pulse">
        Checking systems…
      </div>
    );
  }

  const overall = STATUS_COPY[data.status];

  return (
    <div className="not-prose mt-2 mb-8 space-y-4">
      <div
        className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 rounded-2xl ring-1 ${overall.tone}`}
      >
        <div className="flex items-center gap-3">
          <span className="relative flex w-2.5 h-2.5">
            <span className="absolute inset-0 rounded-full bg-current opacity-90" />
            {data.status === "ok" && (
              <span className="absolute inset-0 rounded-full bg-current opacity-50 animate-ping" />
            )}
          </span>
          <div>
            <div className="text-[15px] font-bold tracking-tight">
              {data.status === "ok"
                ? "All systems operational"
                : data.status === "degraded"
                  ? "Some systems are degraded"
                  : "Major outage in progress"}
            </div>
            <div className="text-[12px] opacity-80">{overall.label}</div>
          </div>
        </div>
        <div className="text-[11.5px] text-gray-400 tabular-nums sm:text-right">
          v{data.version} ·{" "}
          {!online
            ? "Offline · paused"
            : loadedAt
              ? new Date(loadedAt).toLocaleTimeString()
              : "—"}
        </div>
      </div>

      <ul className="space-y-2">
        {(Object.keys(data.checks) as (keyof HealthResponse["checks"])[]).map(
          (key) => {
            const check = data.checks[key];
            const meta = STATUS_COPY[check.status];
            return (
              <li
                key={key}
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.04]"
              >
                <span
                  className={`flex-shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full ring-1 ${meta.tone}`}
                  aria-hidden
                >
                  <span className="w-2 h-2 rounded-full bg-current" />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-semibold text-gray-100">
                    {CHECK_LABELS[key]}
                  </div>
                  {check.detail && (
                    <div className="text-[11.5px] text-gray-500 truncate">
                      {check.detail}
                    </div>
                  )}
                </div>
                <div className="flex-shrink-0 flex items-center gap-2">
                  {typeof check.latencyMs === "number" && (
                    <span className="text-[11px] text-gray-500 tabular-nums">
                      {check.latencyMs} ms
                    </span>
                  )}
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ring-1 ${meta.tone}`}
                  >
                    {meta.label}
                  </span>
                </div>
              </li>
            );
          },
        )}
      </ul>
    </div>
  );
}
