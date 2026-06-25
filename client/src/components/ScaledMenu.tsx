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

/**
 * Centers a menu and scales it up to fill larger screens. The scaled height is
 * divided back out so it still fits the available area (content taller than
 * that scrolls inside). `className` styles the inner (scaled) flex column.
 */
export default function ScaledMenu({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const [fit, setFit] = useState(computeFit);
  useEffect(() => {
    const onResize = () => setFit(computeFit());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div
      className="flex w-full items-start justify-center"
      style={{ height: "calc(100dvh - 3rem)" }}
    >
      <div
        className={`no-scrollbar flex flex-col overflow-y-auto ${className}`}
        style={{
          width: fit.width,
          height: `calc((100dvh - 3rem) / ${fit.scale})`,
          transform: `scale(${fit.scale})`,
          transformOrigin: "top center",
        }}
      >
        {children}
      </div>
    </div>
  );
}
