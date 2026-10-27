import { useEffect, useState } from "react";
import type { UpdaterEvent } from "../types";

type Phase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; version: string }
  | { kind: "progress"; version?: string; percent: number }
  | { kind: "ready"; version: string }
  | { kind: "error"; message: string };

export function UpdateBanner() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const api = window.omenUpdater;
    if (!api?.onEvent) return;
    return api.onEvent((ev: UpdaterEvent) => {
      setDismissed(false);
      if (ev.type === "checking") setPhase({ kind: "checking" });
      else if (ev.type === "available") setPhase({ kind: "available", version: ev.version });
      else if (ev.type === "progress") {
        setPhase((prev) => ({
          kind: "progress",
          percent: ev.percent,
          version: prev.kind === "available" || prev.kind === "progress" ? prev.version : undefined,
        }));
      } else if (ev.type === "downloaded") setPhase({ kind: "ready", version: ev.version });
      else if (ev.type === "error") setPhase({ kind: "error", message: ev.message });
      else if (ev.type === "not-available") setPhase({ kind: "idle" });
    });
  }, []);

  if (dismissed || phase.kind === "idle" || phase.kind === "checking") return null;

  const restart = () => {
    void window.omenUpdater?.install();
  };

  return (
    <div className="update-banner" role="status">
      <div className="update-banner__copy">
        {phase.kind === "available" ? (
          <p>
            Update <strong>v{phase.version}</strong> is available — downloading…
          </p>
        ) : null}
        {phase.kind === "progress" ? (
          <p>
            Downloading update{phase.version ? ` v${phase.version}` : ""}…
            <span className="update-banner__pct">{Math.round(phase.percent)}%</span>
          </p>
        ) : null}
        {phase.kind === "ready" ? (
          <p>
            Update <strong>v{phase.version}</strong> is ready. Restart to install.
          </p>
        ) : null}
        {phase.kind === "error" ? <p>Update check failed: {phase.message}</p> : null}
        {phase.kind === "progress" ? (
          <div className="update-banner__track" aria-hidden>
            <div className="update-banner__fill" style={{ width: `${Math.min(100, phase.percent)}%` }} />
          </div>
        ) : null}
      </div>
      <div className="update-banner__actions">
        {phase.kind === "ready" ? (
          <button type="button" className="btn-primary update-banner__btn" onClick={restart}>
            Restart &amp; update
          </button>
        ) : null}
        <button type="button" className="btn-ghost update-banner__btn" onClick={() => setDismissed(true)}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
