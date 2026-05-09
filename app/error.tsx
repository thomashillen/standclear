"use client";

// Route-level error boundary. Next.js mounts this whenever a child
// route segment throws during render. We log the error through the
// observability shim and offer a Retry that re-renders the segment
// without dropping the rest of the app shell.

import { useEffect } from "react";
import Link from "next/link";
import { captureException } from "@/lib/observability";
import { ISSUES_URL, SITE_NAME } from "@/lib/site";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureException(error, {
      what: "route-level error boundary",
      digest: error.digest,
    });
  }, [error]);

  return (
    <main className="min-h-dvh bg-gray-950 text-white flex items-center justify-center px-6 py-16">
      <div className="max-w-md w-full text-center">
        <div className="text-5xl mb-5" aria-hidden>
          🚇
        </div>
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
          Something derailed.
        </h1>
        <p className="mt-3 text-gray-400 text-[15px] leading-relaxed">
          {SITE_NAME} hit an unexpected error rendering this page. The
          good news is everything else still works — try the page
          again, or head back to the live map.
        </p>
        {error.digest && (
          <p className="mt-3 text-[11px] text-gray-600 tabular-nums">
            Error ID: {error.digest}
          </p>
        )}
        <div className="mt-7 flex flex-col sm:flex-row gap-2.5 justify-center">
          <button
            type="button"
            onClick={reset}
            className="press px-5 py-2.5 rounded-full bg-white text-gray-950 font-semibold text-[14px] hover:bg-gray-100 active:bg-gray-200 transition-colors"
          >
            Try again
          </button>
          <Link
            href="/"
            className="press px-5 py-2.5 rounded-full bg-white/[0.06] text-gray-100 font-semibold text-[14px] hover:bg-white/[0.10] transition-colors"
          >
            Open the map
          </Link>
        </div>
        <p className="mt-7 text-[12px] text-gray-500">
          If this keeps happening,{" "}
          <a
            href={ISSUES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-emerald-300 underline underline-offset-4 hover:text-emerald-200"
          >
            file a bug
          </a>
          .
        </p>
      </div>
    </main>
  );
}
