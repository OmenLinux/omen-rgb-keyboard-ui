import { useCallback, useEffect, useMemo, useState } from "react";
import type { SystemVitals, ViewId } from "./types";
import { LightingSection } from "./components/LightingSection";
import { FanControlSection } from "./components/FanControlSection";
import { fillHeat, formatTempMaybeC, meterClass, tempHeatMaybeC, utilHeat } from "./heatScale";

type Props = { activeView: ViewId };

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

function padSeries(series: number[], minLen: number): number[] {
  if (series.length >= minLen) return series;
  if (series.length === 0) return Array.from({ length: minLen }, () => 0);
  const first = series[0];
  return [...Array.from({ length: minLen - series.length }, () => first), ...series];
}

function polylinePoints(vals: number[], yMin: number, yMax: number, w = 640, h = 220): string {
  const v = padSeries(vals, Math.max(2, vals.length));
  const lo = yMax > yMin ? yMin : Math.min(...v);
  const hi = yMax > yMin ? yMax : Math.max(...v, lo + 1e-6);
  const span = hi - lo || 1;
  return v
    .map((p, i) => {
      const x = v.length === 1 ? w / 2 : (i / (v.length - 1)) * w;
      const t = (p - lo) / span;
      const y = h - 8 - Math.min(1, Math.max(0, t)) * (h - 16);
      return `${Math.round(x)},${Math.round(y)}`;
    })
    .join(" ");
}

function procInitial(name: string): string {
  const t = name.trim();
  if (!t) return "?";
  const ch = t[0];
  return /[a-z]/i.test(ch) ? ch.toUpperCase() : ch;
}

function formatKbps(kbps: number): string {
  if (!Number.isFinite(kbps) || kbps <= 0) return "0 kbps";
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(2)} Mbps`;
  if (kbps < 0.1) return "<0.1 kbps";
  return `${kbps.toFixed(1)} kbps`;
}

export function Content({ activeView }: Props) {
  const [sys, setSys] = useState<SystemVitals | null>(null);
  const [cpuHist, setCpuHist] = useState<number[]>([]);
  const [gpuHist, setGpuHist] = useState<number[]>([]);
  const [freqHist, setFreqHist] = useState<number[]>([]);

  const [modeChip, setModeChip] = useState(0);
  const [tempC, setTempC] = useState(true);
  const [power, setPower] = useState<"eco" | "balanced" | "performance">("balanced");
  const [nbMode, setNbMode] = useState<"off" | "auto" | "custom">("off");
  const [uvOn, setUvOn] = useState(false);
  const [netBoost, setNetBoost] = useState(false);
  const [nbQuery, setNbQuery] = useState("");
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

  useEffect(() => {
    if (!sys) return;
    if (sys.cpuTempC != null) setCpuHist((h) => [...h.slice(-47), sys.cpuTempC as number]);
    if (sys.gpuTempC != null) setGpuHist((h) => [...h.slice(-47), sys.gpuTempC as number]);
    if (sys.cpuSpeedGhz != null) setFreqHist((h) => [...h.slice(-47), sys.cpuSpeedGhz as number]);
  }, [sys]);

  const m = sys ?? VITALS_FALLBACK;

  const chartCpuPts = useMemo(
    () => (cpuHist.length ? polylinePoints(cpuHist, 35, 100) : "0,110 640,110"),
    [cpuHist],
  );
  const chartGpuPts = useMemo(
    () => (gpuHist.length ? polylinePoints(gpuHist, 35, 100) : "0,110 640,110"),
    [gpuHist],
  );
  const chartFreqPts = useMemo(
    () => (freqHist.length ? polylinePoints(freqHist, 0.4, 5.2) : "0,110 640,110"),
    [freqHist],
  );

  const avgCpuTempStr =
    cpuHist.length > 0
      ? `${Math.round(cpuHist.reduce((a, b) => a + b, 0) / cpuHist.length)}°C`
      : "N/A";
  const avgCpuFreqStr =
    freqHist.length > 0
      ? `${(freqHist.reduce((a, b) => a + b, 0) / freqHist.length).toFixed(2)} GHz`
      : "N/A";

  const netTotalMbps =
    m.netDownMbps != null && m.netUpMbps != null ? m.netDownMbps + m.netUpMbps : null;

  const netProcs = m.networkByProcess ?? [];
  const filteredNetProcs = useMemo(() => {
    const q = nbQuery.trim().toLowerCase();
    if (!q) return netProcs;
    return netProcs.filter((r) => r.name.toLowerCase().includes(q) || String(r.pid).includes(q));
  }, [netProcs, nbQuery]);

  const nbRingCirc = 2 * Math.PI * 88;
  const nbRingDash =
    netTotalMbps != null && netTotalMbps > 0
      ? Math.min(nbRingCirc * 0.92, 16 + (netTotalMbps / 250) * nbRingCirc * 0.85)
      : 12;

  const powerSummaryLabel =
    power === "eco" ? "ECO" : power === "balanced" ? "Balanced" : "Performance";

  const v = (id: ViewId) => activeView === id;

  return (
    <div className="main-scroll">
      <section className={`view${v("vitals") ? " is-active" : ""}`} id="view-vitals" data-view="vitals" role="tabpanel">
        <div className="vitals-toolbar">
          <div className="vitals-modes">
            {[0, 1, 2].map((i) => (
              <button
                key={i}
                type="button"
                className={`mode-chip${modeChip === i ? " is-active" : ""}`}
                aria-label={i === 0 ? "Dashboard mode" : i === 1 ? "Fan mode" : "Info"}
                onClick={() => {
                  setModeChip(i);
                  toast(i === 0 ? "Dashboard layout" : i === 1 ? "Fan view" : "Info mode");
                }}
              >
                {i === 0 && (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 6v6l4 2" />
                  </svg>
                )}
                {i === 1 && (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
                {i === 2 && (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 16v-4M12 8h.01" />
                  </svg>
                )}
              </button>
            ))}
          </div>
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

          <div className="card settings-card vitals-settings">
            <h2 className="panel-head__title settings-card__heading">Your settings</h2>
            <div className="settings-row">
              <div className="setting-tile setting-tile--orange">
                <span className="setting-tile__lbl">Performance Control</span>
                <span className="setting-tile__val">{powerSummaryLabel}</span>
              </div>
              <div className="setting-tile setting-tile--pink">
                <span className="setting-tile__lbl">Undervolting</span>
                <span className="setting-tile__val">{uvOn ? "On" : "Off"}</span>
              </div>
              <div className="settings-volt">Core Voltage Offset 0.000V</div>
            </div>
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
            <div className="net-mini__toggle">
              <span>Network Booster</span>
              <button
                type="button"
                className="tag tag--orange tag--btn"
                onClick={() => {
                  setNetBoost((x) => {
                    const next = !x;
                    toast(next ? "Network Booster on" : "Network Booster off");
                    return next;
                  });
                }}
              >
                {netBoost ? "ON" : "OFF"}
              </button>
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
          <h2 className="panel-head__title">
            Power Mode{" "}
            <button type="button" className="info-dot" aria-label="Info">
              i
            </button>
          </h2>
          <button type="button" className="linkish" onClick={() => toast("Auto Power Mode settings")}>
            Auto Power Mode Settings
          </button>
        </div>
        <div className="power-row">
          <div className="power-cards">
            {(
              [
                { id: "eco" as const, label: "ECO", icon: "leaf" },
                { id: "balanced" as const, label: "Balanced", icon: "diamond" },
                { id: "performance" as const, label: "Performance", icon: "bars" },
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                type="button"
                className={`power-card power-card--${p.id}${power === p.id ? " is-active" : ""}`}
                onClick={() => {
                  setPower(p.id);
                  toast(`Power mode: ${p.label}`);
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
                <span>{p.label}</span>
              </button>
            ))}
          </div>
          <div className="power-brand">
            <span className="power-brand__mark" />
            <span className="power-brand__txt">
              Optimized with <strong>OMEN Dynamic Power</strong>
            </span>
          </div>
        </div>

        <div className="panel-head panel-head--spaced">
          <h2 className="panel-head__title">
            Thermal Control{" "}
            <button type="button" className="info-dot" aria-label="Info">
              i
            </button>
          </h2>
        </div>
        <div className="thermal-block" data-thermal="auto">
          <FanControlSection onToast={toast} embedded />
        </div>

        <div className="panel-head">
          <h2 className="panel-head__title">System Temperature</h2>
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

      <section className={`view${v("undervolt") ? " is-active" : ""}`} id="view-undervolt" data-view="undervolt" role="tabpanel">
        <div className="uv-head">
          <h2 className="uv-title">Undervolting</h2>
          <button type="button" className="linkish">
            What is Undervolting?
          </button>
        </div>
        <div className="uv-panel">
          <div className="uv-row">
            <span className="uv-offon">
              <span className="muted">Off</span>{" "}
              <button
                type="button"
                className="switch"
                aria-pressed={uvOn}
                onClick={() => setUvOn((x) => !x)}
              >
                <span className="switch__knob" />
              </button>{" "}
              <span className="muted">On</span>
            </span>
            <div className="uv-preset">
              <button type="button" className="icon-sq" aria-label="Previous">
                ‹
              </button>
              <span>Default</span>
              <button type="button" className="icon-sq" aria-label="Next">
                ›
              </button>
            </div>
          </div>
          <div className={`uv-slider-wrap${uvOn ? "" : " is-disabled"}`}>
            <label className="uv-slider-label">Core Voltage Offset</label>
            <div className="uv-slider-track">
              <div className="uv-slider-fill" style={{ width: "0%" }} />
              <div className="uv-slider-thumb" style={{ left: "0%" }} />
            </div>
            <div className="uv-slider-ticks">
              <span>0v</span>
              <span>-0.2v</span>
            </div>
          </div>
          <div className="uv-actions">
            <button type="button" className="btn-ghost" disabled>
              CANCEL
            </button>
            <button type="button" className="btn-ghost" disabled>
              APPLY
            </button>
          </div>
        </div>

        <div className="panel-head panel-head--spaced">
          <h2 className="panel-head__title">Voltage / Temperature Status</h2>
          <button type="button" className="mini-dd">
            1 min ▾
          </button>
        </div>
        <div className="chart-card">
          <svg className="chart-svg" viewBox="0 0 640 220" preserveAspectRatio="none">
            <defs>
              <linearGradient id="grid" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2a2a2a" />
                <stop offset="100%" stopColor="#1a1a1a" />
              </linearGradient>
            </defs>
            <rect width="640" height="220" fill="url(#grid)" />
            <g stroke="#333" strokeWidth="1">
              <path d="M0 44H640M0 88H640M0 132H640M0 176H640" />
            </g>
            <polyline className="chart-line chart-line--purple" points={chartCpuPts} />
            <polyline className="chart-line chart-line--blue" points={chartFreqPts} />
            <polyline className="chart-line chart-line--red" points={chartGpuPts} />
          </svg>
          <div className="chart-legend">
            <div>
              <span className="sq sq--purple" /> CPU Temp{" "}
              <strong className={`temp-g ${meterClass(tempHeatMaybeC(m.cpuTempC))}`}>
                {formatTempMaybeC(m.cpuTempC, tempC)}
              </strong>
            </div>
            <div>
              <span className="sq sq--blue" /> CPU Speed{" "}
              <strong>{m.cpuSpeedGhz != null ? `${m.cpuSpeedGhz} GHz` : "—"}</strong>
            </div>
            <div>
              <span className="sq sq--red" /> CPU Voltage <strong>N/A</strong>
            </div>
          </div>
        </div>

        <div className="panel-head">
          <h2 className="panel-head__title">Test Result</h2>
        </div>
        <div className="test-card">
          <button type="button" className="btn-ghost" onClick={() => toast("Undervolt test not wired to hardware")}>
            Run test
          </button>
          <table className="test-table">
            <tbody>
              {[
                ["Core Voltage Offset", "N/A"],
                ["Avg. CPU Temp", avgCpuTempStr],
                ["Avg. CPU Freq", avgCpuFreqStr],
                ["Avg. Core Voltage", "N/A"],
              ].map(([a, b]) => (
                <tr key={a}>
                  <td>{a}</td>
                  <td>{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="uv-warn">Altering the CPU core voltage may cause system instability. Please use at your own risk!</p>
      </section>

      <LightingSection isActive={v("lighting")} />

      <section className={`view view--center${v("graphics") ? " is-active" : ""}`} id="view-graphics" data-view="graphics" role="tabpanel">
        <h2 className="gfx-title">Select a GPU mode</h2>
        <button type="button" className="gfx-card">
          <span className="gfx-card__ico">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
            </svg>
          </span>
          <span>Advanced Optimus</span>
        </button>
        <p className="gfx-desc">Use NVIDIA Advanced Optimus technology for optimized graphics modes.</p>
        <button type="button" className="gfx-cta">
          OPEN NVIDIA ADVANCED OPTIMUS
        </button>
      </section>

      <section className={`view${v("network") ? " is-active" : ""}`} id="view-network" data-view="network" role="tabpanel">
        <div className="nb-head">
          <div className="nb-mode">
            <span className="nb-mode__lbl">Mode</span>
            <div className="seg-3 seg-3--light" role="group" aria-label="Network booster mode">
              {(["off", "auto", "custom"] as const).map((m) => (
                <button key={m} type="button" className={nbMode === m ? "is-on" : ""} onClick={() => setNbMode(m)}>
                  {m.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <p className="nb-desc">
            Live totals from all interfaces; per-app rates use Linux TCP counters on established connections that
            report an owning process (same source as{" "}
            <code className="nb-code">ss -tiapn</code>).
          </p>
          <div className="nb-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="search"
              placeholder="Filter by app or PID"
              aria-label="Filter applications"
              value={nbQuery}
              onChange={(e) => setNbQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="nb-grid">
          <div className="nb-gauge-card">
            <div className="wide-card__title">Total Bandwidth Usage</div>
            <div className="nb-gauge">
              <svg viewBox="0 0 200 200">
                <circle cx="100" cy="100" r="88" fill="none" stroke="#2a2a2a" strokeWidth="10" />
                <circle
                  cx="100"
                  cy="100"
                  r="88"
                  fill="none"
                  stroke="url(#omenRingGrad)"
                  strokeWidth="10"
                  strokeDasharray={`${nbRingDash} ${nbRingCirc}`}
                  strokeLinecap="round"
                  transform="rotate(-90 100 100)"
                />
              </svg>
              <div className="nb-gauge__txt">
                {netTotalMbps != null ? netTotalMbps.toFixed(2) : "—"}{" "}
                <small>Mbps</small>
              </div>
            </div>
            {m.netDownMbps != null && m.netUpMbps != null ? (
              <p className="nb-gauge-sub">
                <span className="nb-gauge-sub__down">↓ {m.netDownMbps.toFixed(2)} Mbps</span>
                <span className="nb-gauge-sub__sep"> · </span>
                <span className="nb-gauge-sub__up">↑ {m.netUpMbps.toFixed(2)} Mbps</span>
              </p>
            ) : (
              <p className="nb-gauge-sub nb-gauge-sub--muted">Interface rates unavailable in this environment.</p>
            )}
          </div>
          <div className="nb-table-card">
            <table className="nb-table">
              <thead>
                <tr>
                  <th>
                    Application <span className="sort">▼</span>
                  </th>
                  <th>PID</th>
                  <th>TCP</th>
                  <th>
                    Download <span className="sort">▼</span>
                  </th>
                  <th>
                    Upload <span className="sort">▼</span>
                  </th>
                  <th>Priority</th>
                  <th>Block</th>
                </tr>
              </thead>
              <tbody>
                {filteredNetProcs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="nb-table-empty">
                      {(() => {
                        const plat = typeof window !== "undefined" ? window.omenShell?.platform : "";
                        if (plat !== "linux") {
                          return "Per-process TCP throughput is collected on Linux (from kernel socket byte counters).";
                        }
                        if (nbQuery.trim() !== "" && netProcs.length > 0) {
                          return "No processes match your filter.";
                        }
                        return "No TCP sockets with a visible process owner were found (try running the app from a normal session, or install iproute2). Rates update every 2 seconds once connections appear.";
                      })()}
                    </td>
                  </tr>
                ) : (
                  filteredNetProcs.map((row, idx) => (
                    <tr key={`${row.pid}-${idx}-${row.name}`}>
                      <td>
                        <span className="proc-ico">{procInitial(row.name)}</span> {row.name}
                      </td>
                      <td>{row.pid}</td>
                      <td>{row.tcpSockets}</td>
                      <td>{formatKbps(row.downKbps)}</td>
                      <td>{formatKbps(row.upKbps)}</td>
                      <td>—</td>
                      <td>—</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
