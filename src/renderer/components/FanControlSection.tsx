import { useCallback, useEffect, useId, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useDriver } from "../driverContext";

const FAN = (name: string) => `fan/${name}`;

const THERMAL_PRESETS = ["silent", "normal", "performance"] as const;
type ThermalPreset = (typeof THERMAL_PRESETS)[number];

const PROFILE_THERMAL: Record<ThermalPreset, "max" | "auto" | "manual"> = {
  performance: "max",
  normal: "auto",
  silent: "manual",
};

const COMMON_THERMAL_ZONES = ["x86_pkg_temp", "acpitz", "k10temp", "pch_cannonlake"] as const;

const DEFAULT_CURVE: { temp: number; pct: number }[] = [
  { temp: 35, pct: 22 },
  { temp: 55, pct: 48 },
  { temp: 85, pct: 88 },
];

type CurvePoint = { temp: number; pct: number };

const T_AXIS_LO = 20;
const T_AXIS_HI = 110;

const VB_W = 360;
const VB_H = 200;
const PAD_L = 48;
const PAD_R = 20;
const PAD_T = 22;
const PAD_B = 40;
const PLOT_W = VB_W - PAD_L - PAD_R;
const PLOT_H = VB_H - PAD_T - PAD_B;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function parseCurveStringToPoints(s: string | null): CurvePoint[] {
  if (s == null) return [...DEFAULT_CURVE];
  const t = s.trim();
  if (!t || t.startsWith("(")) return [...DEFAULT_CURVE];
  const parts = t.split(/\s+/);
  const out: CurvePoint[] = [];
  for (const p of parts) {
    const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(p);
    if (!m) continue;
    const temp = Number(m[1]);
    const pct = Number(m[2]);
    if (!Number.isFinite(temp) || !Number.isFinite(pct)) continue;
    out.push({ temp, pct });
  }
  return out.length >= 2 ? out : [...DEFAULT_CURVE];
}

function serializeCurvePoints(pts: CurvePoint[]): string {
  return pts.map((p) => `${Math.round(p.temp)}:${Math.round(p.pct)}`).join(" ");
}

function parseFanCurve(s: string): { ok: true } | { ok: false; error: string } {
  const trimmed = s.trim();
  if (!trimmed) return { ok: false, error: "Curve cannot be empty." };
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2 || parts.length > 8) {
    return { ok: false, error: "Use 2–8 pairs: temperature °C and fan %." };
  }
  for (const p of parts) {
    const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(p);
    if (!m) return { ok: false, error: "Each step needs a temperature and fan percent." };
    const temp = Number(m[1]);
    const pct = Number(m[2]);
    if (!Number.isFinite(temp) || !Number.isFinite(pct)) {
      return { ok: false, error: "Invalid numbers in curve." };
    }
    if (pct < 0 || pct > 100) return { ok: false, error: "Fan percent must be 0–100." };
    if (temp < 0 || temp > 150) return { ok: false, error: "Temperature must be 0–150 °C." };
  }
  return { ok: true };
}

function tempToX(t: number) {
  const tc = clamp(t, T_AXIS_LO, T_AXIS_HI);
  return PAD_L + ((tc - T_AXIS_LO) / (T_AXIS_HI - T_AXIS_LO)) * PLOT_W;
}

function pctToY(p: number) {
  const pc = clamp(p, 0, 100);
  return PAD_T + (1 - pc / 100) * PLOT_H;
}

function xyToModel(x: number, y: number): CurvePoint {
  const temp = Math.round(T_AXIS_LO + ((x - PAD_L) / PLOT_W) * (T_AXIS_HI - T_AXIS_LO));
  const pct = Math.round((1 - (y - PAD_T) / PLOT_H) * 100);
  return { temp: clamp(temp, 0, 150), pct: clamp(pct, 0, 100) };
}

function polylineFixedAxis(pts: CurvePoint[]): string {
  const sorted = [...pts].sort((a, b) => a.temp - b.temp);
  return sorted.map((p) => `${tempToX(p.temp).toFixed(1)},${pctToY(p.pct).toFixed(1)}`).join(" ");
}

function isThermalPresetString(s: string): s is ThermalPreset {
  return (THERMAL_PRESETS as readonly string[]).includes(s.trim());
}

function isDriverEcUnmapped(s: string): boolean {
  const t = s.trim().toLowerCase();
  return t === "unknown";
}

function isDriverEcReadError(s: string): boolean {
  return s.trim().toLowerCase().startsWith("unknown (ec_read");
}

function driverRpmMissing(s: string): boolean {
  const t = (s || "").trim();
  if (!t || t === "—") return true;
  const lo = t.toLowerCase();
  if (lo === "n/a" || lo === "na" || lo === "unknown") return true;
  return false;
}

function rpmLine(driverRaw: string): string {
  const d = (driverRaw || "").trim();
  if (!driverRpmMissing(d)) {
    if (/^\d+$/.test(d)) return `${d} RPM`;
    return d;
  }
  return "—";
}

function normalizeZoneFromDriver(raw: string | null): { mode: "auto" | "preset" | "custom"; preset?: string; custom?: string } {
  if (raw == null) return { mode: "auto" };
  const z = raw.trim();
  if (!z || z.toLowerCase() === "(auto)") return { mode: "auto" };
  if ((COMMON_THERMAL_ZONES as readonly string[]).includes(z)) return { mode: "preset", preset: z };
  return { mode: "custom", custom: z };
}

function curveSummary(pts: CurvePoint[]): string {
  const s = [...pts].sort((a, b) => a.temp - b.temp);
  return s.map((p) => `${Math.round(p.temp)}°/${Math.round(p.pct)}%`).join(" → ");
}

function clientToSvg(svg: SVGSVGElement, clientX: number, clientY: number) {
  const p = svg.createSVGPoint();
  p.x = clientX;
  p.y = clientY;
  const m = svg.getScreenCTM();
  if (!m) return { x: 0, y: 0 };
  return p.matrixTransform(m.inverse());
}

type FanCurveModalProps = {
  open: boolean;
  titleId: string;
  curvePoints: CurvePoint[];
  setCurvePoints: Dispatch<SetStateAction<CurvePoint[]>>;
  canDriveFan: boolean;
  gradId: string;
  onCancel: () => void;
  onDone: () => void;
  onApply: () => void;
};

function FanCurveModal({
  open,
  titleId,
  curvePoints,
  setCurvePoints,
  canDriveFan,
  gradId,
  onCancel,
  onDone,
  onApply,
}: FanCurveModalProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragIx = useRef<number>(-1);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onCancel]);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGCircleElement>) => {
      const i = dragIx.current;
      if (i < 0 || !svgRef.current) return;
      const { x, y } = clientToSvg(svgRef.current, e.clientX, e.clientY);
      const m = xyToModel(x, y);
      setCurvePoints((prev) => {
        const next = [...prev];
        if (!next[i]) return prev;
        next[i] = { temp: m.temp, pct: m.pct };
        return next;
      });
    },
    [setCurvePoints],
  );

  const endDrag = useCallback(() => {
    dragIx.current = -1;
    setCurvePoints((prev) => [...prev].sort((a, b) => a.temp - b.temp));
  }, [setCurvePoints]);

  if (!open) return null;

  const linePts = polylineFixedAxis(curvePoints);
  const fillPts = curvePoints.length >= 2 ? `${PAD_L},${PAD_T + PLOT_H} ${linePts} ${PAD_L + PLOT_W},${PAD_T + PLOT_H}` : "";

  return (
    <div
      className="fan-curve-modal-backdrop"
      role="presentation"
      onPointerDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        className="fan-curve-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="fan-curve-modal__head">
          <h3 id={titleId} className="fan-curve-modal__title">
            Fan curve
          </h3>
          <p className="fan-curve-modal__sub muted">Drag points. Temperature (horizontal), fan % (vertical). Driver allows 2–8 points.</p>
        </div>

        <svg ref={svgRef} className="fan-curve-modal__svg" viewBox={`0 0 ${VB_W} ${VB_H}`}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(45, 212, 191, 0.28)" />
              <stop offset="100%" stopColor="rgba(45, 212, 191, 0.03)" />
            </linearGradient>
          </defs>
          <rect x={PAD_L} y={PAD_T} width={PLOT_W} height={PLOT_H} rx="6" fill="rgba(0,0,0,0.35)" stroke="rgba(255,255,255,0.08)" />
          <text x={PAD_L} y={PAD_T - 6} fill="#9ca3af" fontSize="10">
            100% fan
          </text>
          <text x={PAD_L} y={PAD_T + PLOT_H + 22} fill="#9ca3af" fontSize="10">
            {T_AXIS_LO}°C
          </text>
          <text x={PAD_L + PLOT_W - 36} y={PAD_T + PLOT_H + 22} fill="#9ca3af" fontSize="10" textAnchor="end">
            {T_AXIS_HI}°C
          </text>
          <line x1={PAD_L} y1={PAD_T + PLOT_H} x2={PAD_L + PLOT_W} y2={PAD_T + PLOT_H} stroke="rgba(255,255,255,0.12)" />
          <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + PLOT_H} stroke="rgba(255,255,255,0.12)" />
          {curvePoints.length >= 2 ? <polygon fill={`url(#${gradId})`} stroke="none" points={fillPts} /> : null}
          {curvePoints.length >= 2 ? (
            <polyline fill="none" stroke="#5eead4" strokeWidth="2.5" strokeLinejoin="round" points={linePts} />
          ) : null}
          {curvePoints.map((p, i) => (
            <circle
              key={i}
              cx={tempToX(p.temp)}
              cy={pctToY(p.pct)}
              r={canDriveFan ? 9 : 7}
              fill={canDriveFan ? "#0f766e" : "#444"}
              stroke="#99f6e4"
              strokeWidth="2"
              style={{ cursor: canDriveFan ? "grab" : "default", touchAction: "none" }}
              onPointerDown={(e) => {
                if (!canDriveFan) return;
                e.stopPropagation();
                dragIx.current = i;
                (e.currentTarget as SVGCircleElement).setPointerCapture(e.pointerId);
              }}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            />
          ))}
        </svg>

        <ul className="fan-curve-modal__legend" aria-label="Curve points">
          {[...curvePoints]
            .map((p, i) => ({ p, i }))
            .sort((a, b) => a.p.temp - b.p.temp)
            .map(({ p, i }) => (
              <li key={i} className="fan-curve-modal__legend-row">
                <span className="fan-curve-modal__legend-val">
                  {Math.round(p.temp)} °C · {Math.round(p.pct)}%
                </span>
                <button
                  type="button"
                  className="fan-curve-modal__legend-remove"
                  disabled={!canDriveFan || curvePoints.length <= 2}
                  onClick={() => setCurvePoints((prev) => (prev.length <= 2 ? prev : prev.filter((_, j) => j !== i)))}
                >
                  Remove
                </button>
              </li>
            ))}
        </ul>

        <div className="fan-curve-modal__actions">
          <button type="button" className="linkish" disabled={!canDriveFan || curvePoints.length >= 8} onClick={() => setCurvePoints((prev) => {
              if (prev.length >= 8) return prev;
              const midT = Math.round((T_AXIS_LO + T_AXIS_HI) / 2);
              const midP = Math.round(prev.reduce((s, q) => s + q.pct, 0) / prev.length);
              return [...prev, { temp: midT, pct: clamp(midP, 5, 95) }];
            })}
          >
            Add point
          </button>
          <div className="fan-curve-modal__actions-right">
            <button type="button" className="linkish" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="linkish" onClick={onDone}>
              Done
            </button>
            <button type="button" className="fan-curve-modal__apply" disabled={!canDriveFan} onClick={onApply}>
              Apply to driver
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type Props = {
  onToast?: (msg: string) => void;
  embedded?: boolean;
};

export function FanControlSection({ onToast, embedded }: Props) {
  const { status } = useDriver();
  const api = typeof window !== "undefined" ? window.omenDriver : undefined;
  const sysfsRead = api?.sysfsRead;
  const sysfsWrite = api?.sysfsWrite;

  const fanReady = status?.supported === true && status.fanSysfsReady === true;
  const fanWritable = status?.fanSysfsWritable === true;
  const canDriveFan = !!sysfsWrite && fanWritable;

  const [cpuRpm, setCpuRpm] = useState("—");
  const [gpuRpm, setGpuRpm] = useState("—");
  const [maxFan, setMaxFan] = useState(false);
  const [thermalRead, setThermalRead] = useState("");
  const [lastAppliedThermalPreset, setLastAppliedThermalPreset] = useState<ThermalPreset | null>(null);
  const [curveEnable, setCurveEnable] = useState(false);
  const [curvePoints, setCurvePoints] = useState<CurvePoint[]>(() => [...DEFAULT_CURVE]);
  const [zoneState, setZoneState] = useState<{ mode: "auto" | "preset" | "custom"; preset?: string; custom: string }>({
    mode: "auto",
    custom: "",
  });
  const [curveModalOpen, setCurveModalOpen] = useState(false);
  const curveSnapRef = useRef<CurvePoint[] | null>(null);
  const modalTitleId = useId();
  const gradId = useId().replace(/:/g, "");

  const toast = useCallback(
    (msg: string) => {
      onToast?.(msg);
    },
    [onToast],
  );

  const openCurveModal = useCallback(() => {
    curveSnapRef.current = curvePoints.map((p) => ({ ...p }));
    setCurveModalOpen(true);
  }, [curvePoints]);

  const cancelCurveModal = useCallback(() => {
    if (curveSnapRef.current) setCurvePoints(curveSnapRef.current.map((p) => ({ ...p })));
    curveSnapRef.current = null;
    setCurveModalOpen(false);
  }, []);

  const doneCurveModal = useCallback(() => {
    curveSnapRef.current = null;
    setCurveModalOpen(false);
  }, []);

  const pullRpmsOnly = useCallback(async () => {
    if (!sysfsRead || !fanReady) return;
    const r = async (n: string) => {
      const x = await sysfsRead(FAN(n));
      return x.ok && x.value != null ? x.value.trim() : null;
    };
    const cpu = await r("cpu_fan_rpm");
    setCpuRpm(cpu && cpu.length ? cpu : "—");
    const gpu = await r("gpu_fan_rpm");
    setGpuRpm(gpu && gpu.length ? gpu : "—");
  }, [sysfsRead, fanReady]);

  const pullFull = useCallback(async () => {
    if (!sysfsRead || !fanReady) return;
    const r = async (n: string) => {
      const x = await sysfsRead(FAN(n));
      return x.ok && x.value != null ? x.value.trim() : null;
    };
    await pullRpmsOnly();
    const mf = await r("max_fan");
    if (mf !== null) setMaxFan(mf === "1");
    const tp = await r("thermal_profile");
    if (tp !== null) {
      setThermalRead(tp);
      if (isThermalPresetString(tp)) setLastAppliedThermalPreset(null);
    }
    const ce = await r("fan_curve_enable");
    if (ce !== null) setCurveEnable(ce === "1");
    const fc = await r("fan_curve");
    if (fc != null) setCurvePoints(parseCurveStringToPoints(fc));
    const fz = await r("fan_temp_zone");
    if (fz != null) {
      const n = normalizeZoneFromDriver(fz);
      if (n.mode === "auto") setZoneState({ mode: "auto", custom: "" });
      else if (n.mode === "preset" && n.preset) setZoneState({ mode: "preset", preset: n.preset, custom: "" });
      else setZoneState({ mode: "custom", custom: n.custom ?? "" });
    }
  }, [sysfsRead, fanReady, pullRpmsOnly]);

  useEffect(() => {
    if (!fanReady || !sysfsRead) return;
    void pullFull();
  }, [fanReady, sysfsRead, pullFull]);

  useEffect(() => {
    if (!fanReady) return;
    const id = window.setInterval(() => void pullRpmsOnly(), 2500);
    return () => window.clearInterval(id);
  }, [fanReady, pullRpmsOnly]);

  const writeFan = useCallback(
    async (name: string, value: string, okMsg?: string): Promise<boolean> => {
      if (!sysfsWrite) {
        toast("Driver API unavailable.");
        return false;
      }
      try {
        const res = await sysfsWrite(FAN(name), value);
        if (res && res.ok === true) {
          if (name === "max_fan") setMaxFan(value === "1");
          if (name === "fan_curve_enable") setCurveEnable(value === "1");
          if (name === "thermal_profile") {
            const v = value.trim();
            if (isThermalPresetString(v)) setLastAppliedThermalPreset(v);
          }
          if (okMsg) toast(okMsg);
          void pullFull();
          return true;
        } else {
          const err = res && typeof res.error === "string" ? res.error : "Write failed";
          const low = err.toLowerCase();
          if (low.includes("eacces") || low.includes("eperm") || low.includes("permission denied")) {
            toast(
              "Permission denied on fan sysfs. Install the driver udev rules (they chmod g+w on fan/*), then: sudo udevadm control --reload-rules && sudo udevadm trigger — or chmod the fan files for group input.",
            );
          } else {
            toast(err);
          }
          return false;
        }
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e));
        return false;
      }
    },
    [sysfsWrite, toast, pullFull],
  );

  const ensureCurveWorkerForThermalWrites = useCallback(async () => {
    if (curveEnable) return true;
    return writeFan("fan_curve_enable", "1");
  }, [curveEnable, writeFan]);

  const onSetProfile = (p: ThermalPreset) => {
    void (async () => {
      if (!(await ensureCurveWorkerForThermalWrites())) return;
      void writeFan("thermal_profile", p, `Thermal profile: ${p}`);
    })();
  };

  const onToggleMaxFan = () => {
    void (async () => {
      const turningOn = !maxFan;
      if (turningOn && !(await ensureCurveWorkerForThermalWrites())) return;
      void writeFan("max_fan", turningOn ? "1" : "0", turningOn ? "Max fan: on" : "Max fan: off");
    })();
  };

  const onToggleCurve = () => {
    void writeFan("fan_curve_enable", curveEnable ? "0" : "1", curveEnable ? "Fan curve: off" : "Fan curve: on");
  };

  const onApplyCurve = useCallback(() => {
    const body = serializeCurvePoints(curvePoints);
    const parsed = parseFanCurve(body);
    if (!parsed.ok) {
      toast(parsed.error);
      return;
    }
    void writeFan("fan_curve", body, "Fan curve updated");
    curveSnapRef.current = null;
    setCurveModalOpen(false);
  }, [curvePoints, toast, writeFan]);

  const onSelectZonePreset = (z: string) => {
    void writeFan("fan_temp_zone", z, `Thermal zone: ${z}`);
  };

  const onApplyCustomZone = () => {
    const z = zoneState.custom.trim();
    if (!z) {
      toast("Enter a thermal zone name (e.g. from /sys/class/thermal/thermal_zone*/type).");
      return;
    }
    void writeFan("fan_temp_zone", z, "Thermal zone set");
  };

  if (embedded && (!status?.supported || !fanReady)) {
    return null;
  }

  if (!status?.supported) {
    return (
      <div className="uv-panel fan-driver-fallback">
        <h3 className="panel-head__title" style={{ marginBottom: 8 }}>
          OMEN driver fans
        </h3>
        <p className="muted">Fan sysfs is available on Linux with the omen-rgb-keyboard driver.</p>
      </div>
    );
  }

  if (!fanReady) {
    return (
      <div className="uv-panel fan-driver-fallback">
        <h3 className="panel-head__title" style={{ marginBottom: 8 }}>
          OMEN driver fans
        </h3>
        <p className="muted">
          No fan sysfs at <code className="fan-ctrl-card__code">/sys/devices/platform/omen-rgb-keyboard/fan/</code>. Use a
          driver/kernel build that exposes fan files, with <code className="fan-ctrl-card__code">CONFIG_THERMAL</code> for
          the temperature zone.
        </p>
      </div>
    );
  }

  const presetForHighlight: ThermalPreset | null = isThermalPresetString(thermalRead)
    ? thermalRead
    : lastAppliedThermalPreset;
  const profileActive = (p: ThermalPreset) => presetForHighlight === p;

  const cpuRpmDisp = rpmLine(cpuRpm);
  const gpuRpmDisp = rpmLine(gpuRpm);

  const driverBody = (
    <>
      {!embedded ? (
        <div className="panel-head panel-head--spaced">
          <h2 className="panel-head__title">
            OMEN driver fans
            {!fanWritable ? (
              <span className="fan-driver-badge fan-driver-badge--ro">read-only</span>
            ) : (
              <span className="fan-driver-badge fan-driver-badge--ok">ready</span>
            )}
          </h2>
        </div>
      ) : null}

      <div className={embedded ? "thermal-block__driver" : "thermal-block thermal-block--driver"} data-thermal="auto">
        {!embedded ? (
          <p className="fan-driver-lead muted">
            Sysfs <code className="fan-ctrl-card__code">omen-rgb-keyboard/fan</code>. Presets and Max enable the curve
            worker first when required; use the switch to turn it off.
          </p>
        ) : null}
        {fanReady && !fanWritable ? (
          <p className="fan-ctrl-card__hint fan-ctrl-card__hint--warn">
            Fan files need group write (udev <code className="fan-ctrl-card__code">chmod g+w</code> on fan/*). Then{" "}
            <code className="fan-ctrl-card__code">sudo udevadm control --reload-rules {'&&'} sudo udevadm trigger</code>.
          </p>
        ) : null}

        <div className="fan-readout fan-readout--driver">
          <div>
            <div className="fan-readout__rpm">{cpuRpmDisp}</div>
            <div className="fan-readout__lbl">CPU</div>
          </div>
          <div>
            <div className="fan-readout__rpm">{gpuRpmDisp}</div>
            <div className="fan-readout__lbl">GPU</div>
          </div>
        </div>

        <div className="seg-3 seg-3--thermal seg-3--thermal-4" role="group" aria-label="Fan boost and thermal mode">
          <button
            type="button"
            className={maxFan ? "is-on is-on--fanmax" : ""}
            disabled={!canDriveFan}
            title="Full fan speed (sysfs max_fan)"
            onClick={() => onToggleMaxFan()}
          >
            Max
          </button>
          {THERMAL_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={profileActive(p) ? `is-on is-on--${PROFILE_THERMAL[p]}` : ""}
              disabled={!canDriveFan}
              onClick={() => onSetProfile(p)}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
        {isDriverEcUnmapped(thermalRead) ? (
          <p className="muted fan-ec-note fan-ec-note--compact">EC profile read not mapped; presets still apply.</p>
        ) : isDriverEcReadError(thermalRead) ? (
          <p className="fan-ctrl-card__ec fan-ec-note--compact">
            EC: <code className="fan-ctrl-card__code">{thermalRead}</code>
          </p>
        ) : thermalRead && !isThermalPresetString(thermalRead) ? (
          <p className="fan-ctrl-card__ec fan-ec-note--compact">
            EC: <code className="fan-ctrl-card__code">{thermalRead}</code>
          </p>
        ) : null}

        <div className="perf-subhead">{embedded ? "Zone" : "Thermal zone"}</div>
        {!embedded ? (
          <p className="fan-zone-lead muted">Linux thermal zone type for the curve, or Auto.</p>
        ) : null}
        <div className="fan-zone-chips" role="group" aria-label="Thermal zone">
          <button
            type="button"
            className={`fan-zone-chip${zoneState.mode === "auto" ? " is-active" : ""}`}
            disabled={!canDriveFan || zoneState.mode === "auto"}
            title="Driver default zone selection when sysfs shows auto."
            onClick={() => toast("To use driver defaults again, reload the module; empty zone write is not supported.")}
          >
            Auto
          </button>
          {COMMON_THERMAL_ZONES.map((z) => (
            <button
              key={z}
              type="button"
              className={`fan-zone-chip${zoneState.mode === "preset" && zoneState.preset === z ? " is-active" : ""}`}
              disabled={!canDriveFan}
              onClick={() => onSelectZonePreset(z)}
            >
              {z.replace(/_/g, " ")}
            </button>
          ))}
          <button
            type="button"
            className={`fan-zone-chip${zoneState.mode === "custom" ? " is-active" : ""}`}
            disabled={!canDriveFan}
            onClick={() => setZoneState((s) => ({ ...s, mode: "custom" }))}
          >
            Custom…
          </button>
        </div>
        {zoneState.mode === "custom" ? (
          <div className="fan-zone-custom">
            <input
              type="text"
              className="fan-curve-num fan-zone-custom__input"
              value={zoneState.custom}
              onChange={(e) => setZoneState((s) => ({ ...s, mode: "custom", custom: e.target.value }))}
              disabled={!canDriveFan}
              placeholder="thermal_zone type string"
              spellCheck={false}
            />
            <button type="button" className="linkish" disabled={!canDriveFan} onClick={() => onApplyCustomZone()}>
              Apply zone
            </button>
          </div>
        ) : null}

        <div className="fan-curve-worker-row">
          <span className="fan-curve-worker-label">Curve</span>
          <button
            type="button"
            className="switch"
            aria-pressed={curveEnable}
            aria-label="Fan curve worker"
            disabled={!canDriveFan}
            onClick={() => onToggleCurve()}
          >
            <span className="switch__knob" />
          </button>
        </div>

        <div className="fan-curve-inline">
          <p className="fan-curve-inline__summary muted" title={curveSummary(curvePoints)}>
            {curvePoints.length} steps: {curveSummary(curvePoints)}
          </p>
          <button type="button" className="fan-curve-inline__open" disabled={!canDriveFan} onClick={openCurveModal}>
            Edit curve graph…
          </button>
        </div>
      </div>

      <FanCurveModal
        open={curveModalOpen}
        titleId={modalTitleId}
        curvePoints={curvePoints}
        setCurvePoints={setCurvePoints}
        canDriveFan={canDriveFan}
        gradId={gradId}
        onCancel={cancelCurveModal}
        onDone={doneCurveModal}
        onApply={onApplyCurve}
      />
    </>
  );

  if (embedded) {
    return <div className="thermal-block__driver-wrap">{driverBody}</div>;
  }

  return <>{driverBody}</>;
}
