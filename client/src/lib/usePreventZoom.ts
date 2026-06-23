import { useEffect } from "react";

/**
 * Block user zoom on desktop: Ctrl+scroll / trackpad pinch (wheel with ctrlKey),
 * Ctrl/Cmd +/-/0 keys, and the Safari pinch gesture. (Mobile pinch is disabled
 * via the viewport meta tag.)
 */
export function usePreventZoom() {
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ["+", "-", "=", "0"].includes(e.key)) {
        e.preventDefault();
      }
    };
    const onGesture = (e: Event) => e.preventDefault();

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    document.addEventListener("gesturestart", onGesture);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("gesturestart", onGesture);
    };
  }, []);
}
