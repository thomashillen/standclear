import SubwayMap from "@/components/SubwayMap";

export default function Home() {
  // h-dvh (100dvh) tracks the *visible* viewport on iOS Safari as the
  // URL bar shows/hides. Tailwind's h-screen compiles to 100vh, which
  // is the LARGE viewport (URL-bar-collapsed) — using it here meant
  // the wrapper rendered ~80px taller than what was actually visible
  // on first load, hiding the bottom of the bottom-sheet panels under
  // Safari's toolbar.
  return (
    <div className="h-dvh w-screen overflow-hidden">
      <SubwayMap />
    </div>
  );
}
