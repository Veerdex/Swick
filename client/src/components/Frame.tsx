// A decorative gold frame drawn over the whole viewport. Purely cosmetic, so it
// is pointer-events-none and sits above the content without intercepting clicks.

// Centered on each corner of the inset frame (16px box at the ~12px inset).
const CORNERS = [
  { top: 4, left: 4 },
  { top: 4, right: 4 },
  { bottom: 4, right: 4 },
  { bottom: 4, left: 4 },
];

export default function Frame() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50">
      {/* Double gold line with a dark groove between, plus a soft inner glow. */}
      <div
        className="absolute inset-3 rounded-xl"
        style={{
          boxShadow:
            "inset 0 0 0 3px #f7e98e," + // bright outer edge
            "inset 0 0 0 5px rgba(10,8,4,0.6)," + // dark groove
            "inset 0 0 0 8px #c9a227," + // inner gold band
            "inset 0 0 26px rgba(247,233,142,0.16)", // gold glow
        }}
      />

      {/* Gold diamond ornaments at each corner. */}
      {CORNERS.map((pos, i) => (
        <span
          key={i}
          className="absolute h-4 w-4 rotate-45 rounded-[2px] bg-gradient-to-br from-yellow-100 to-amber-600 shadow ring-1 ring-amber-900/60"
          style={pos}
        />
      ))}
    </div>
  );
}
