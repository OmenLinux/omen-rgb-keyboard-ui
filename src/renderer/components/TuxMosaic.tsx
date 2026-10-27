import type { CSSProperties } from "react";
import { LINUX_ICON_PATH } from "../assets/linuxPath";

type Tile = {
  c: string;
  s: number;
  o: number;
  r: number;
};

/** A flock of Tuxes — classic yellow plus OMEN red/white accents. */
const TILES: Tile[] = [
  { c: "#FCC624", s: 1.45, o: 1, r: -10 },
  { c: "#E81123", s: 1.2, o: 0.95, r: 8 },
  { c: "#F4F4F5", s: 1.1, o: 0.88, r: -4 },
  { c: "#FF6B75", s: 1.15, o: 0.9, r: 12 },
  { c: "#FCC624", s: 1.0, o: 0.85, r: 6 },
  { c: "#FF3B4B", s: 1.25, o: 0.92, r: -14 },
  { c: "#FBBF24", s: 0.95, o: 0.8, r: 16 },
  { c: "#E8E8EC", s: 1.05, o: 0.75, r: -8 },
  { c: "#C41E3A", s: 1.0, o: 0.82, r: 4 },
  { c: "#FCC624", s: 1.3, o: 0.95, r: -18 },
  { c: "#C41E3A", s: 0.9, o: 0.78, r: 10 },
  { c: "#FFE566", s: 1.1, o: 0.88, r: -6 },
  { c: "#FFFFFF", s: 0.85, o: 0.7, r: 14 },
  { c: "#E81123", s: 1.05, o: 0.85, r: -12 },
  { c: "#FCC624", s: 0.8, o: 0.72, r: 20 },
  { c: "#D4D4D8", s: 0.88, o: 0.74, r: -16 },
  { c: "#FF6B75", s: 0.95, o: 0.8, r: 7 },
  { c: "#FCD34D", s: 1.15, o: 0.9, r: -9 },
  { c: "#D4D4D8", s: 0.78, o: 0.65, r: 18 },
  { c: "#FCC624", s: 0.72, o: 0.6, r: -20 },
  { c: "#E81123", s: 0.75, o: 0.62, r: 11 },
  { c: "#FFE566", s: 0.7, o: 0.58, r: -7 },
  { c: "#FFE566", s: 0.82, o: 0.68, r: 15 },
  { c: "#FFFFFF", s: 0.68, o: 0.55, r: -13 },
  { c: "#FCC624", s: 0.9, o: 0.76, r: 3 },
  { c: "#FF3B4B", s: 0.7, o: 0.6, r: -17 },
  { c: "#FBBF24", s: 0.75, o: 0.64, r: 9 },
  { c: "#A1A1AA", s: 0.72, o: 0.58, r: -5 },
  { c: "#FCC624", s: 1.0, o: 0.82, r: 22 },
  { c: "#E81123", s: 0.85, o: 0.7, r: -11 },
  { c: "#F4F4F5", s: 0.7, o: 0.55, r: 6 },
  { c: "#FCC624", s: 0.65, o: 0.5, r: -19 },
];

function Tux({ color, size }: { color: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden>
      <path d={LINUX_ICON_PATH} />
    </svg>
  );
}

type Props = {
  className?: string;
};

export function TuxMosaic({ className }: Props) {
  return (
    <div className={`tux-mosaic${className ? ` ${className}` : ""}`} aria-hidden>
      <div className="tux-mosaic__glow" />
      <ul className="tux-mosaic__grid">
        {TILES.map((tile, i) => (
          <li
            key={i}
            className="tux-mosaic__tile"
            style={
              {
                "--s": tile.s,
                "--o": tile.o,
                "--r": `${tile.r}deg`,
                "--d": `${(i % 8) * 0.28}s`,
              } as CSSProperties
            }
          >
            <Tux color={tile.c} size={56} />
          </li>
        ))}
      </ul>
      <div className="tux-mosaic__veil" />
    </div>
  );
}
