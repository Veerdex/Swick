import { useEffect, useState, type ReactNode } from "react";

// Menus are designed at this width; on larger screens we scale the whole thing
// up (width, buttons, and text together) so it fills the viewport instead of
// sitting tiny in the middle. Phones stay at scale 1.
const BASE_WIDTH = 576; // = max-w-xl
const MAX_SCALE = 1.9;

function computeFit() {
  const avail = (typeof window === "undefined" ? BASE_WIDTH : window.innerWidth) - 48; // main p-6
  const width = Math.min(BASE_WIDTH, avail);
  const scale = Math.min(MAX_SCALE, Math.max(1, avail / width));
  return { width, scale };
}

/** The current menu scale factor (1 on phones, larger on wide screens). */
export function useMenuScale() {
  const [scale, setScale] = useState(() => computeFit().scale);
  useEffect(() => {
    const onResize = () => setScale(computeFit().scale);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return scale;
}

/**
 * Centers a menu and scales it up to fill larger screens. The scaled height is
 * divided back out so it still fits the available area (content taller than
 * that scrolls inside). `className` styles the inner (scaled) flex column.
 *
 * `scaleMultiplier` (default 1) is applied on top of the computed fit scale —
 * pass a value < 1 (e.g. 0.7) to shrink the menu in landscape orientation.
 */
export default function ScaledMenu({
  children,
  className = "",
  scaleMultiplier = 1,
}: {
  children: ReactNode;
  className?: string;
  scaleMultiplier?: number;
}) {
  const [fit, setFit] = useState(computeFit);
  useEffect(() => {
    const onResize = () => setFit(computeFit());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const scale = fit.scale * scaleMultiplier;

  return (
    <div
      className="flex w-full items-start justify-center"
      style={{ height: "calc(100dvh - 3rem)" }}
    >
      <div
        className={`no-scrollbar flex flex-col overflow-y-auto ${className}`}
        style={{
          width: fit.width * scaleMultiplier,
          height: `calc((100dvh - 3rem) / ${scale})`,
          transform: `scale(${scale})`,
          transformOrigin: "top center",
        }}
      >
        {children}
      </div>
    </div>
  );
}
