import { useEffect, useState } from "react";
import type { ViewId } from "../types";
import { NAV_ITEMS } from "../types";
import { APP_VERSION, DEVICE_MODEL_LAST_RESORT } from "../version";

type Props = {
  activeView: ViewId;
  onSelect: (id: ViewId) => void;
};

function isGenericModelLabel(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  if (t === DEVICE_MODEL_LAST_RESORT) return true;
  if (t === "localhost") return true;
  return false;
}

function preferMachineLabel(a: string | undefined, b: string | undefined): string {
  const ta = (a ?? "").trim();
  const tb = (b ?? "").trim();
  if (isGenericModelLabel(ta)) return isGenericModelLabel(tb) ? ta || tb || DEVICE_MODEL_LAST_RESORT : tb;
  if (isGenericModelLabel(tb)) return ta;
  return ta.length >= tb.length ? ta : tb;
}

export function Sidebar({ activeView, onSelect }: Props) {
  const [deviceName, setDeviceName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const finish = (label: string) => {
      if (!cancelled) setDeviceName(label);
    };

    const promises: Promise<string | undefined>[] = [];

    const shellApi = typeof window !== "undefined" ? window.omenShell?.getMachineModel : undefined;
    if (shellApi) {
      promises.push(shellApi().catch(() => undefined));
    }

    if (import.meta.env.DEV) {
      promises.push(
        fetch("/__omen_dev/machine-model")
          .then((r) => (r.ok ? r.json() : null))
          .then((j: unknown) => {
            if (j && typeof j === "object" && j !== null && "model" in j) {
              const m = (j as { model: unknown }).model;
              return typeof m === "string" ? m : undefined;
            }
            return undefined;
          })
          .catch(() => undefined),
      );
    }

    if (promises.length === 0) {
      finish(DEVICE_MODEL_LAST_RESORT);
      return () => {
        cancelled = true;
      };
    }

    void Promise.all(promises).then((parts) => {
      let merged: string | undefined;
      for (const p of parts) {
        if (p === undefined) continue;
        const t = p.trim();
        if (!t) continue;
        merged = merged === undefined ? t : preferMachineLabel(merged, t);
      }
      finish((merged ?? "").trim() || DEVICE_MODEL_LAST_RESORT);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <aside className="sidebar">
      <div className="sidebar-device">
        <div className="device-sidebar__head">
          <p className="device-sidebar__device-name">{deviceName ?? "…"}</p>
        </div>
        <nav className="device-list" aria-label={`${deviceName ?? "System"} controls`}>
          {NAV_ITEMS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`device-link${activeView === id ? " is-active" : ""}`}
              data-view={id}
              onClick={() => onSelect(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>
      <div className="sidebar__footer">
        <a href="#" className="sidebar-foot-link" onClick={(e) => e.preventDefault()}>
          Help & feedback
        </a>
        <div className="sidebar__meta">
          <span className="sidebar__ver">{APP_VERSION}</span>
        </div>
      </div>
    </aside>
  );
}
