import { useCallback, useEffect, useState } from "react";
import type { SystemVitals, ViewId } from "./types";
import { AboutSection } from "./components/AboutSection";
import { LightingSection } from "./components/LightingSection";
import { FanControlSection } from "./components/FanControlSection";
import { GraphicsSection } from "./components/GraphicsSection";
import { useDriver } from "./driverContext";
import { FAN_CHANGED, notifyFanChanged } from "./fanEvents";
import { fillHeat, formatTempMaybeC, meterClass, tempHeatMaybeC, utilHeat } from "./heatScale";

const POWER_TO_THERMAL = {
  eco: "silent",
  balanced: "normal",
  performance: "performance",
} as const;

const THERMAL_TO_POWER: Record<string, "eco" | "balanced" | "performance"> = {
  silent: "eco",
  normal: "balanced",
  performance: "performance",
};

type Props = { activeView: ViewId; onNavigate: (id: ViewId) => void };

const VITALS_FALLBACK: SystemVitals = {
  cpuTempC: null,
  gpuTempC: null,
  cpuUtilPct: 0,
  gpuUtilPct: null,
  ramUtilPct: 0,
  ramUsedGb: 0,
  ramTotalGb: 0,
  storageUsedPct: 0,
  storageFreeGb: 0,
  storageTotalGb: 0,
  storageLabel: "—",
  storageSubtitle: "—",
  netUpMbps: null,
  netDownMbps: null,
  fanRpm: null,
  cpuSpeedGhz: null,
  topProcesses: [],
  networkByProcess: [],
};

function procInitial(name: string): string {
  const t = name.trim();
  if (!t) return "?";
  const ch = t[0];
  return /[a-z]/i.test(ch) ? ch.toUpperCase() : ch;
}

export function Content({ activeView, onNavigate }: Props) {
  const { status } = useDriver();
  const [sys, setSys] = useState<SystemVitals | null>(null);
  const [gfxMode, setGfxMode] = useState<string | null>(null);

  const [tempC, setTempC] = useState(true);
  const [power, setPower] = useState<"eco" | "balanced" | "performance">("balanced");
  const [hubToast, setHubToast] = useState<string | null>(null);

  const toast = useCallback((t: string) => {
    setHubToast(t);
    window.setTimeout(() => setHubToast(null), 2400);
  }, []);

  useEffect(() => {
    const api = typeof window !== "undefined" ? window.omenSystem?.getMetrics : undefined;
    if (!api) return;
    let alive = true;
    const tick = async () => {
      try {
        const next = await api();
        if (alive) setSys(next);
      } catch {
        if (alive) setSys(null);
      }
    };
    void tick();
    const id = window.setInterval(tick, 2000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const m = sys ?? VITALS_FALLBACK;

  const powerSummaryLabel =
    power === "eco" ? "Quiet" : power === "balanced" ? "Balanced" : "Performance";

  const lightingSummary =
    status?.platform !== "linux"
      ? "Preview"
      : status.sysfsReady
        ? status.sysfsWritable
          ? "Ready"
          : "Needs permission"
        : "Not installed";

  useEffect(() => {
    const api = window.omenDriver?.optimusGetStatus ?? window.omenOptimus?.getStatus;
    if (!api) return;
    let alive = true;
    void api().then((s) => {
      if (!alive) return;
      if (!s?.installed) {
        setGfxMode(null);
        return;
      }
      const mode = s.currentMode;
      setGfxMode(
        mode === "nvidia" ? "NVIDIA" : mode === "integrated" ? "Integrated" : mode === "hybrid" ? "Hybrid" : "—",
      );
    });
    return () => {
      alive = false;
    };
  }, [activeView, status?.sysfsReady]);

  useEffect(() => {
    const read = window.omenDriver?.sysfsRead;
    if (!read || status?.fanSysfsReady !== true) return;
    let alive = true;
    const pull = async () => {
      const r = await read("fan/thermal_profile");
      if (!alive || !r.ok || !r.value) return;
      const mapped = THERMAL_TO_POWER[r.value.trim()];
      if (mapped) setPower(mapped);
    };
    void pull();
    window.addEventListener(FAN_CHANGED, pull);
    return () => {
      alive = false;
      window.removeEventListener(FAN_CHANGED, pull);
    };
  }, [status?.fanSysfsReady]);

  const v = (id: ViewId) => activeView === id;

  return (
    <div className="main-scroll">
      <section className={`view${v("vitals") ? " is-active" : ""}`} id="view-vitals" data-view="vitals" role="tabpanel">
        <div className="vitals-toolbar">
          <div className="temp-unit">
            <span className="temp-unit__label" data-temp-side="f">
              °F
            </span>
            <button
              type="button"
              className="toggle-pill"
              aria-pressed={tempC}
              title="Temperature unit"
              onClick={() => {
                setTempC((x) => {
                  const next = !x;
                  toast(next ? "Temperatures shown in °C" : "Temperatures shown in °F");
                  return next;
                });
              }}
            >
              <span className="toggle-pill__knob" />
            </button>
            <span className="temp-unit__label" data-temp-side="c">
              °C
            </span>
          </div>
        </div>

        {hubToast ? <div className="hub-toast">{hubToast}</div> : null}

        <div className="vitals-grid">
          <div className="card ring-card vitals-gpu">
            <div className="ring-card__head">GPU</div>
            <div
              className={`ring ${meterClass(utilHeat(m.gpuUtilPct ?? 0))}`}
              style={{ "--p": m.gpuUtilPct ?? 0 } as React.CSSProperties}
            >
              <svg viewBox="0 0 120 120" className="ring__svg">
                <circle className="ring__track" cx="60" cy="60" r="52" />
                <circle className="ring__prog" cx="60" cy="60" r="52" />
              </svg>
              <div className="ring__label">
                <span className="ring__pct">{m.gpuUtilPct != null ? `${Math.round(m.gpuUtilPct)}%` : "N/A"}</span>
                <span className="ring__sub">GPU Utilization</span>
              </div>
            </div>
            <div className="ring-card__foot">
              <span className={`temp-g ${meterClass(tempHeatMaybeC(m.gpuTempC))}`}>
                {formatTempMaybeC(m.gpuTempC, tempC)}
              </span>{" "}
              GPU Temperature
            </div>
          </div>
          <div className="card ring-card vitals-cpu">
            <div className="ring-card__head">CPU</div>
            <div
              className={`ring ${meterClass(utilHeat(m.cpuUtilPct))}`}
              style={{ "--p": m.cpuUtilPct } as React.CSSProperties}
            >
              <svg viewBox="0 0 120 120" className="ring__svg">
                <circle className="ring__track" cx="60" cy="60" r="52" />
                <circle className="ring__prog" cx="60" cy="60" r="52" />
              </svg>
              <div className="ring__label">
                <span className="ring__pct">{Math.round(m.cpuUtilPct)}%</span>
                <span className="ring__sub">CPU Utilization</span>
              </div>
            </div>
            <div className="ring-card__foot">
              <span className={`temp-g ${meterClass(tempHeatMaybeC(m.cpuTempC))}`}>
                {formatTempMaybeC(m.cpuTempC, tempC)}
              </span>{" "}
              CPU Temperature
            </div>
          </div>
          <div className="card ring-card vitals-ram">
            <div className="ring-card__head">RAM</div>
            <div
              className={`ring ${meterClass(utilHeat(m.ramUtilPct))}`}
              style={{ "--p": m.ramUtilPct } as React.CSSProperties}
            >
              <svg viewBox="0 0 120 120" className="ring__svg">
                <circle className="ring__track" cx="60" cy="60" r="52" />
                <circle className="ring__prog" cx="60" cy="60" r="52" />
              </svg>
              <div className="ring__label">
                <span className="ring__pct">{m.ramUtilPct}%</span>
                <span className="ring__sub">RAM Utilization</span>
              </div>
            </div>
            <div className="ring-card__foot ring-card__foot--plain">
              {m.ramTotalGb > 0 ? `${m.ramUsedGb.toFixed(1)}GB / ${m.ramTotalGb.toFixed(1)}GB` : "—"}
            </div>
          </div>

          <div className="card wide-card vitals-storage">
            <div className="wide-card__title">STORAGE</div>
            <div className="storage-bar">
              <div
                className={`storage-bar__fill ${meterClass(fillHeat(m.storageUsedPct))}`}
                style={{ width: `${m.storageUsedPct}%` }}
              />
            </div>
            <div className="wide-card__sub">{m.storageSubtitle}</div>
          </div>

          <div className="card status-card vitals-settings">
            <div className="wide-card__title">AT A GLANCE</div>
            <ul className="status-list">
              <li>
                <button type="button" className="status-list__row" onClick={() => onNavigate("performance")}>
                  <span className="status-list__lbl">Power</span>
                  <span className="status-list__val">
                    {powerSummaryLabel}
                    <span className="status-list__go" aria-hidden>
                      →
                    </span>
                  </span>
                </button>
              </li>
              <li>
                <button type="button" className="status-list__row" onClick={() => onNavigate("lighting")}>
                  <span className="status-list__lbl">Keyboard</span>
                  <span className="status-list__val">
                    {lightingSummary}
                    <span className="status-list__go" aria-hidden>
                      →
                    </span>
                  </span>
                </button>
              </li>
              <li>
                <button type="button" className="status-list__row" onClick={() => onNavigate("graphics")}>
                  <span className="status-list__lbl">Graphics</span>
                  <span className="status-list__val">
                    {gfxMode ?? "Open"}
                    <span className="status-list__go" aria-hidden>
                      →
                    </span>
                  </span>
                </button>
              </li>
            </ul>
          </div>

          <div className="card net-mini vitals-net">
            <div className="wide-card__title">NETWORK</div>
            <div className="net-mini__vals">
              <div>
                <span className="net-big">{m.netUpMbps != null ? m.netUpMbps.toFixed(1) : "—"}</span>{" "}
                <span className="net-unit">Upload Speed Mbps</span>
              </div>
              <div>
                <span className="net-big">{m.netDownMbps != null ? m.netDownMbps.toFixed(1) : "—"}</span>{" "}
                <span className="net-unit">Download Speed Mbps</span>
              </div>
            </div>
          </div>

          <div className="card processes-card vitals-proc">
            <div className="wide-card__title">TOP PROCESSES</div>
            <table className="proc-table">
              <thead>
                <tr>
                  <th>APPS</th>
                  <th>NAME</th>
                  <th>CPU</th>
                  <th>GPU</th>
                  <th>RAM</th>
                  <th>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {(m.topProcesses.length ? m.topProcesses : [{ name: "—", cpuPct: 0, gpuPct: 0, ramMb: 0 }]).map(
                  (row, idx) => (
                  <tr key={`${row.name}-${idx}`}>
                    <td>
                      <span className="proc-ico">{procInitial(row.name)}</span>
                    </td>
                    <td>{row.name}</td>
                    <td>
                      <span className={`proc-metric ${meterClass(utilHeat(row.cpuPct))}`}>{row.cpuPct.toFixed(1)}</span>
                    </td>
                    <td>
                      <span className={`proc-metric ${meterClass(utilHeat(row.gpuPct))}`}>{row.gpuPct.toFixed(1)}</span>
                    </td>
                    <td>{row.ramMb > 0 ? `${row.ramMb.toFixed(0)} MB` : "—"}</td>
                    <td>
                      <button
                        type="button"
                        className="block-ico"
                        aria-label={`End task ${row.name}`}
                        onClick={() => toast(`End task: ${row.name} (not implemented)`)}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" />
                          <path d="m15 9-6 6M9 9l6 6" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <a href="#" className="proc-tm" onClick={(e) => e.preventDefault()}>
              Open Task Manager
            </a>
          </div>
        </div>
      </section>

      <section className={`view${v("performance") ? " is-active" : ""}`} id="view-performance" data-view="performance" role="tabpanel">
        <div className="panel-head">
          <h2 className="panel-head__title">Power mode</h2>
          <p className="panel-head__lead">Tap one. That’s it.</p>
        </div>
        <div className="power-row">
          <div className="power-cards">
            {(
              [
                {
                  id: "eco" as const,
                  label: "Quiet",
                  blurb: "Cooler & quieter",
                  icon: "leaf",
                },
                {
                  id: "balanced" as const,
                  label: "Balanced",
                  blurb: "Everyday use",
                  icon: "diamond",
                },
                {
                  id: "performance" as const,
                  label: "Performance",
                  blurb: "Max speed",
                  icon: "bars",
                },
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                type="button"
                className={`power-card power-card--${p.id}${power === p.id ? " is-active" : ""}`}
                onClick={() => {
                  setPower(p.id);
                  const write = window.omenDriver?.sysfsWrite;
                  if (!write || status?.fanSysfsWritable !== true) {
                    toast(p.label);
                    return;
                  }
                  void (async () => {
                    const profile = await write("fan/thermal_profile", POWER_TO_THERMAL[p.id]);
                    if (!profile.ok) {
                      toast("Couldn't change power mode.");
                      return;
                    }
                    await write("fan/power_limits", "default");
                    toast(`${p.label} mode`);
                    notifyFanChanged();
                  })();
                }}
              >
                <span className="power-card__ico" aria-hidden>
                  {p.icon === "leaf" && (
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25">
                      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
                      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
                    </svg>
                  )}
                  {p.icon === "diamond" && (
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25">
                      <path d="M12 2 20 12 12 22 4 12 12 2z" />
                    </svg>
                  )}
                  {p.icon === "bars" && (
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25">
                      <path d="M18 20V10M12 20V4M6 20v-6" />
                    </svg>
                  )}
                </span>
                <span className="power-card__label">{p.label}</span>
                <span className="power-card__blurb">{p.blurb}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="panel-head panel-head--spaced">
          <h2 className="panel-head__title">Fans</h2>
          <p className="panel-head__lead">See speeds and temps. Flip a switch if you want more airflow.</p>
        </div>
        <div className="thermal-block" data-thermal="auto">
          <FanControlSection
            onToast={toast}
            embedded
            cpuTempC={m.cpuTempC}
            gpuTempC={m.gpuTempC}
            useCelsius={tempC}
          />
        </div>

        <div className="panel-head">
          <h2 className="panel-head__title">Temperatures</h2>
        </div>
        <div className="temp-strip">
          <div>
            <span className={`temp-g temp-g--lg ${meterClass(tempHeatMaybeC(m.cpuTempC))}`}>
              {formatTempMaybeC(m.cpuTempC, tempC)}
            </span>
            <div className="temp-strip__lbl">CPU Temperature</div>
          </div>
          <div>
            <span className={`temp-g temp-g--lg ${meterClass(tempHeatMaybeC(m.gpuTempC))}`}>
              {formatTempMaybeC(m.gpuTempC, tempC)}
            </span>
            <div className="temp-strip__lbl">GPU Temperature</div>
          </div>
          <div>
            <span className={`temp-strip__val ${meterClass(utilHeat(m.cpuUtilPct))}`}>{Math.round(m.cpuUtilPct)}%</span>
            <div className="temp-strip__lbl">CPU Utilization</div>
          </div>
        </div>
      </section>

      <LightingSection isActive={v("lighting")} />

      {v("graphics") ? <GraphicsSection isActive onToast={toast} /> : null}

      <AboutSection isActive={v("about")} />
    </div>
  );
}
