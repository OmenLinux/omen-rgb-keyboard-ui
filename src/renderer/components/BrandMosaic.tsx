import type { CSSProperties } from "react";
import hpOmenLogoUrl from "../assets/hp-omen-logo.png";

type Tile = {
  s: number;
  o: number;
  r: number;
};

/** Scattered OMEN wordmarks — pairs with TuxMosaic for Hub-like wallpaper. */
const TILES: Tile[] = [
  { s: 1.35, o: 0.95, r: -8 },
  { s: 1.1, o: 0.88, r: 10 },
  { s: 1.25, o: 0.9, r: -4 },
  { s: 0.95, o: 0.8, r: 14 },
  { s: 1.15, o: 0.85, r: -12 },
  { s: 0.85, o: 0.72, r: 6 },
  { s: 1.05, o: 0.82, r: -16 },
  { s: 0.9, o: 0.75, r: 8 },
  { s: 1.2, o: 0.88, r: -6 },
  { s: 0.78, o: 0.65, r: 18 },
  { s: 1.0, o: 0.78, r: -14 },
  { s: 0.88, o: 0.7, r: 4 },
  { s: 1.08, o: 0.8, r: -10 },
  { s: 0.72, o: 0.58, r: 12 },
  { s: 0.95, o: 0.74, r: -18 },
  { s: 0.82, o: 0.68, r: 7 },
  { s: 1.12, o: 0.84, r: -3 },
  { s: 0.7, o: 0.55, r: 15 },
  { s: 0.92, o: 0.72, r: -9 },
  { s: 0.76, o: 0.6, r: 11 },
];

type Props = {
  className?: string;
};

export function BrandMosaic({ className }: Props) {
  return (
    <div className={`brand-mosaic${className ? ` ${className}` : ""}`} aria-hidden>
      <ul className="brand-mosaic__grid">
        {TILES.map((tile, i) => (
          <li
            key={i}
            className="brand-mosaic__tile"
            style={
              {
                "--s": tile.s,
                "--o": tile.o,
                "--r": `${tile.r}deg`,
                "--d": `${(i % 7) * 0.32}s`,
              } as CSSProperties
            }
          >
            <img src={hpOmenLogoUrl} alt="" draggable={false} />
          </li>
        ))}
      </ul>
    </div>
  );
}
