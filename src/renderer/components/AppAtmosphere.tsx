import type { ViewId } from "../types";
import { BrandMosaic } from "./BrandMosaic";
import { TuxMosaic } from "./TuxMosaic";

type Props = {
  view: ViewId;
};

/** Site-wide wallpaper — Tux flock + OMEN logos, tuned per active view. */
export function AppAtmosphere({ view }: Props) {
  return (
    <div className="app-atmosphere" data-view={view} aria-hidden>
      <TuxMosaic className="tux-mosaic--app" />
      <BrandMosaic className="brand-mosaic--app" />
    </div>
  );
}
