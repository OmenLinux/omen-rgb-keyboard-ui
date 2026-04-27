import type { OmenShell } from "../types";
import { OmenBrandLogo } from "./OmenBrandLogo";

type Props = { shell?: OmenShell };

export function TitleBar({ shell }: Props) {
  return (
    <header className="titlebar" id="titlebar">
      <div className="titlebar__brand">
        <OmenBrandLogo className="omen-brand-logo" height={26} />
        <span className="titlebar__title">OMEN Gaming Hub</span>
      </div>
      <div className="titlebar__spacer" aria-hidden />
      <div className="titlebar__window-controls no-drag">
        <button type="button" className="win-btn" aria-label="Minimize" onClick={() => shell?.minimize()}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M0 5h10" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
        <button type="button" className="win-btn" aria-label="Maximize" onClick={() => shell?.maximize()}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
        <button type="button" className="win-btn win-btn--close" aria-label="Close" onClick={() => shell?.close()}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </header>
  );
}
