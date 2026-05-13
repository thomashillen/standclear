import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type React from "react";

import { useSheetDrag } from "./useSheetDrag";

// useSheetDrag is mobile-only — the transform + drag handlers are no-ops
// on desktop. The mq mock keeps the test on the mobile path; restore
// after each test so unrelated suites don't see the stub.
function installMobileMatchMedia(matches: boolean) {
  const originalMatchMedia = window.matchMedia;
  const mq = {
    matches,
    media: "(max-width: 639px)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  window.matchMedia = vi.fn().mockReturnValue(mq) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = originalMatchMedia;
  };
}

// Synthesize the React pointer-event shape the hook reads from. The hook
// only touches `clientY`, `pointerId`, `target.closest`, and
// `currentTarget.setPointerCapture` — no real DOM dispatch needed.
function makePointerEvent(
  clientY: number,
  opts: { tagName?: string; dataNoDrag?: boolean } = {},
): React.PointerEvent<HTMLElement> {
  const target = document.createElement(opts.tagName ?? "div");
  if (opts.dataNoDrag) target.setAttribute("data-no-drag", "");
  document.body.appendChild(target);
  const currentTarget = {
    setPointerCapture: vi.fn(),
  } as unknown as HTMLElement;
  return {
    clientY,
    pointerId: 1,
    target,
    currentTarget,
  } as unknown as React.PointerEvent<HTMLElement>;
}

const baseOpts = {
  halfRestingY: "50dvh",
  open: true,
  onDismiss: () => {},
};

describe("useSheetDrag", () => {
  let restoreMq: () => void;

  beforeEach(() => {
    restoreMq = installMobileMatchMedia(true);
  });

  afterEach(() => {
    restoreMq();
    document.body.innerHTML = "";
  });

  it("starts at half detent with no drag in flight", () => {
    const { result } = renderHook(() => useSheetDrag({ ...baseOpts }));
    expect(result.current.detent).toBe("half");
    expect(result.current.isDragging).toBe(false);
    // Mobile mq match: sheetStyle should encode the resting transform.
    expect(result.current.sheetStyle.transform).toMatch(/translateY/);
  });

  it("drag down past dismissPx from half fires onDismiss", () => {
    const onDismiss = vi.fn();
    const { result } = renderHook(() =>
      useSheetDrag({ ...baseOpts, onDismiss, dismissPx: 120 }),
    );
    act(() => result.current.handlers.onPointerDown(makePointerEvent(100)));
    act(() => result.current.handlers.onPointerMove(makePointerEvent(180)));
    expect(result.current.isDragging).toBe(true);
    act(() => result.current.handlers.onPointerUp(makePointerEvent(230)));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(result.current.isDragging).toBe(false);
    expect(result.current.detent).toBe("half");
  });

  it("drag up past commitPx from half expands to full", () => {
    const onDetentChange = vi.fn();
    const { result } = renderHook(() =>
      useSheetDrag({ ...baseOpts, commitPx: 80, onDetentChange }),
    );
    act(() => result.current.handlers.onPointerDown(makePointerEvent(300)));
    act(() => result.current.handlers.onPointerUp(makePointerEvent(200)));
    expect(result.current.detent).toBe("full");
    expect(onDetentChange).toHaveBeenCalledWith("full");
  });

  it("drag down past commitPx from full collapses to half", () => {
    const { result } = renderHook(() => useSheetDrag({ ...baseOpts }));
    // Expand to full first.
    act(() => result.current.handlers.onPointerDown(makePointerEvent(300)));
    act(() => result.current.handlers.onPointerUp(makePointerEvent(150)));
    expect(result.current.detent).toBe("full");
    // Drag down 100px past commit threshold (default 80).
    act(() => result.current.handlers.onPointerDown(makePointerEvent(100)));
    act(() => result.current.handlers.onPointerUp(makePointerEvent(200)));
    expect(result.current.detent).toBe("half");
  });

  it("dismissOnDrag=false collapses to half instead of firing onDismiss", () => {
    const onDismiss = vi.fn();
    const { result } = renderHook(() =>
      useSheetDrag({
        ...baseOpts,
        onDismiss,
        dismissOnDrag: false,
        dismissPx: 120,
      }),
    );
    act(() => result.current.handlers.onPointerDown(makePointerEvent(100)));
    act(() => result.current.handlers.onPointerUp(makePointerEvent(260)));
    expect(onDismiss).not.toHaveBeenCalled();
    expect(result.current.detent).toBe("half");
  });

  it("short drag below commit threshold leaves detent unchanged", () => {
    const onDetentChange = vi.fn();
    const onDismiss = vi.fn();
    const { result } = renderHook(() =>
      useSheetDrag({
        ...baseOpts,
        onDismiss,
        onDetentChange,
        commitPx: 80,
        dismissPx: 120,
      }),
    );
    act(() => result.current.handlers.onPointerDown(makePointerEvent(100)));
    // Drag up 30px — below the 80px commit threshold.
    act(() => result.current.handlers.onPointerUp(makePointerEvent(70)));
    expect(result.current.detent).toBe("half");
    expect(onDetentChange).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("skips drag init when pointerdown lands on a button", () => {
    const { result } = renderHook(() => useSheetDrag({ ...baseOpts }));
    act(() =>
      result.current.handlers.onPointerDown(makePointerEvent(100, { tagName: "button" })),
    );
    expect(result.current.isDragging).toBe(false);
    // pointerup with no active drag is a silent no-op — detent stays half.
    act(() => result.current.handlers.onPointerUp(makePointerEvent(260)));
    expect(result.current.detent).toBe("half");
  });

  it("respects [data-no-drag] on a non-button drag-zone child", () => {
    const { result } = renderHook(() => useSheetDrag({ ...baseOpts }));
    act(() =>
      result.current.handlers.onPointerDown(makePointerEvent(100, { dataNoDrag: true })),
    );
    expect(result.current.isDragging).toBe(false);
  });

  it("pointerCancel resets in-flight drag state without firing detent change", () => {
    const onDetentChange = vi.fn();
    const onDismiss = vi.fn();
    const { result } = renderHook(() =>
      useSheetDrag({ ...baseOpts, onDismiss, onDetentChange }),
    );
    act(() => result.current.handlers.onPointerDown(makePointerEvent(100)));
    act(() => result.current.handlers.onPointerMove(makePointerEvent(260)));
    expect(result.current.isDragging).toBe(true);
    act(() => result.current.handlers.onPointerCancel(makePointerEvent(260)));
    expect(result.current.isDragging).toBe(false);
    expect(onDetentChange).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(result.current.detent).toBe("half");
  });

  it("closing the sheet (open=false) resets detent + drag state", () => {
    const { result, rerender } = renderHook(
      ({ open }) => useSheetDrag({ ...baseOpts, open }),
      { initialProps: { open: true } },
    );
    // Expand to full.
    act(() => result.current.handlers.onPointerDown(makePointerEvent(300)));
    act(() => result.current.handlers.onPointerUp(makePointerEvent(150)));
    expect(result.current.detent).toBe("full");
    // Re-render with open=false — the close-reset effect should fire.
    rerender({ open: false });
    expect(result.current.detent).toBe("half");
    expect(result.current.isDragging).toBe(false);
  });

  it("onHandleTap with no preceding movement toggles between detents", () => {
    const onDetentChange = vi.fn();
    const { result } = renderHook(() =>
      useSheetDrag({ ...baseOpts, onDetentChange }),
    );
    act(() => result.current.onHandleTap());
    expect(result.current.detent).toBe("full");
    expect(onDetentChange).toHaveBeenLastCalledWith("full");
    act(() => result.current.onHandleTap());
    expect(result.current.detent).toBe("half");
    expect(onDetentChange).toHaveBeenLastCalledWith("half");
  });

  it("onHandleTap after a moved drag swallows the tap once (one-shot guard)", () => {
    const onDetentChange = vi.fn();
    const { result } = renderHook(() =>
      useSheetDrag({ ...baseOpts, onDetentChange }),
    );
    // Move + release without crossing commit — detent stays half but
    // dragMoved goes true, so the synthesized handle click that fires
    // immediately after a drag should be ignored.
    act(() => result.current.handlers.onPointerDown(makePointerEvent(100)));
    act(() => result.current.handlers.onPointerMove(makePointerEvent(120)));
    act(() => result.current.handlers.onPointerUp(makePointerEvent(120)));
    act(() => result.current.onHandleTap());
    expect(result.current.detent).toBe("half");
    expect(onDetentChange).not.toHaveBeenCalled();
    // Next tap after the guard is consumed should toggle normally.
    act(() => result.current.onHandleTap());
    expect(result.current.detent).toBe("full");
  });

  it("emits no transform on the desktop layout (matchMedia.matches=false)", () => {
    restoreMq();
    restoreMq = installMobileMatchMedia(false);
    const { result } = renderHook(() => useSheetDrag({ ...baseOpts }));
    expect(result.current.sheetStyle.transform).toBeUndefined();
    // Drag handlers should no-op too — pointerdown returns early.
    act(() => result.current.handlers.onPointerDown(makePointerEvent(100)));
    expect(result.current.isDragging).toBe(false);
  });
});
