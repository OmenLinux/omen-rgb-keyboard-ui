import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useDriver } from "../driverContext";
import { FAN_CHANGED, notifyFanChanged } from "../fanEvents";
import { formatTempMaybeC, meterClass, tempHeatMaybeC } from "../heatScale";

const FAN = (name: string) => `fan/${name}`;

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

function driverRpmMissing(s: string): boolean {
  const t = (s || "").trim();
  if (!t || t === "—") return true;
  const lo = t.toLowerCase();
  if (lo === "n/a" || lo === "na" || lo === "unknown") return true;
  return false;
}

function parseRpm(driverRaw: string): number | null {
  const d = (driverRaw || "").trim();
  if (driverRpmMissing(d)) return null;
  const n = Number(d);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Map RPM to one full spin duration in seconds. Higher RPM → faster. */
function rpmToSpinSeconds(rpm: number | null, maxFan: boolean): number | null {
  if (rpm == null) return null;
  if (rpm <= 0) return null;
  const effective = maxFan ? Math.max(rpm, 4800) : rpm;
  const capped = Math.min(7000, Math.max(400, effective));
  // ~2.8s at idle, ~0.18s near max — readable but still lively
  return 2.8 - ((capped - 400) / (7000 - 400)) * (2.8 - 0.18);
}

function formatRpm(rpm: number | null): string {
  if (rpm == null) return "—";
  return rpm.toLocaleString("en-US");
}

const FAN_BLADES = 11;

function IntakeFan({
  tone,
  spinning,
}: {
  tone: "cpu" | "gpu";
  spinning: boolean;
}) {
  return (
    <div className={`chassis-fan chassis-fan--${tone}${spinning ? " is-spinning" : ""}`}>
      <div className={`chassis-fan__rotor${spinning ? "" : " is-stopped"}`}>
        {Array.from({ length: FAN_BLADES }, (_, i) => (
          <span
            key={i}
            className="chassis-fan__blade"
            style={{ transform: `rotate(${(360 / FAN_BLADES) * i}deg)` }}
          />
        ))}
        <span className="chassis-fan__hub" />
      </div>
    </div>
  );
}

type ChassisUndersideProps = {
  cpuRaw: string;
  gpuRaw: string;
  maxFan: boolean;
  cpuTempC: number | null;
  gpuTempC: number | null;
  useCelsius: boolean;
};

function ChassisUnderside({
  cpuRaw,
  gpuRaw,
  maxFan,
  cpuTempC,
  gpuTempC,
  useCelsius,
}: ChassisUndersideProps) {
  const cpuRpm = parseRpm(cpuRaw);
  const gpuRpm = parseRpm(gpuRaw);
  const cpuSpin = rpmToSpinSeconds(cpuRpm, maxFan);
  const gpuSpin = rpmToSpinSeconds(gpuRpm, maxFan);
  const bars = [1, 2, 3, 4];

  return (
    <div
      className={`chassis${maxFan ? " is-boost" : ""}`}
      style={
        {
          "--cpu-spin": cpuSpin != null ? `${cpuSpin.toFixed(3)}s` : "0s",
          "--gpu-spin": gpuSpin != null ? `${gpuSpin.toFixed(3)}s` : "0s",
        } as CSSProperties
      }
    >
      <div className="chassis__shell">
        <div className="chassis__decor" aria-hidden>
          <div className="chassis__foot chassis__foot--top" />
          <div className="chassis__screws chassis__screws--top">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="chassis__screw" />
            ))}
          </div>

          <div className="chassis__grille">
            <div className="chassis__fans">
              <IntakeFan tone="cpu" spinning={cpuSpin != null} />
              <IntakeFan tone="gpu" spinning={gpuSpin != null} />
            </div>
            <div className="chassis__mesh" />
            <div className="chassis__slats" />
            <div className="chassis__bars">
              {bars.map((b) => (
                <span key={b} className="chassis__bar" />
              ))}
            </div>
          </div>
        </div>

        <div className="chassis__plate">
          <div className={`chassis__readout chassis__readout--cpu${cpuSpin != null ? " is-live" : ""}`}>
            <div className="chassis__readout-head">
              <span className="chassis__readout-label">CPU</span>
              <span className={`chassis__readout-temp ${meterClass(tempHeatMaybeC(cpuTempC))}`}>
                {formatTempMaybeC(cpuTempC, useCelsius)}
              </span>
            </div>
            <div className="chassis__readout-rpm">
              <span className="chassis__readout-value">{formatRpm(cpuRpm)}</span>
              <span className="chassis__readout-unit">RPM</span>
            </div>
          </div>
          <span className="chassis__brand" aria-hidden>
            OMEN
          </span>
          <div className={`chassis__readout chassis__readout--gpu${gpuSpin != null ? " is-live" : ""}`}>
            <div className="chassis__readout-head">
              <span className="chassis__readout-label">GPU</span>
              <span className={`chassis__readout-temp ${meterClass(tempHeatMaybeC(gpuTempC))}`}>
                {formatTempMaybeC(gpuTempC, useCelsius)}
              </span>
            </div>
            <div className="chassis__readout-rpm">
              <span className="chassis__readout-value">{formatRpm(gpuRpm)}</span>
              <span className="chassis__readout-unit">RPM</span>
            </div>
          </div>
        </div>

        <div className="chassis__decor" aria-hidden>
          <div className="chassis__screws chassis__screws--bottom">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="chassis__screw" />
            ))}
          </div>
          <div className="chassis__foot chassis__foot--bottom" />
        </div>
      </div>
    </div>
  );
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
          <p className="fan-curve-modal__sub">Drag points on the chart. Left = cooler, right = hotter, up = faster.</p>
        </div>

        <div className="fan-curve-modal__chart">
          <svg ref={svgRef} className="fan-curve-modal__svg" viewBox={`0 0 ${VB_W} ${VB_H}`}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(232, 17, 35, 0.32)" />
                <stop offset="100%" stopColor="rgba(232, 17, 35, 0.02)" />
              </linearGradient>
              <pattern id={`${gradId}-grid`} width="40" height="28" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 28" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
              </pattern>
            </defs>
            <rect x={PAD_L} y={PAD_T} width={PLOT_W} height={PLOT_H} fill="#0a0a0c" stroke="rgba(255,255,255,0.12)" />
            <rect x={PAD_L} y={PAD_T} width={PLOT_W} height={PLOT_H} fill={`url(#${gradId}-grid)`} />
            {[25, 50, 75].map((pct) => (
              <line
                key={pct}
                x1={PAD_L}
                y1={pctToY(pct)}
                x2={PAD_L + PLOT_W}
                y2={pctToY(pct)}
                stroke="rgba(255,255,255,0.06)"
                strokeDasharray="3 4"
              />
            ))}
            <text x={PAD_L - 8} y={PAD_T + 4} fill="#8b8b93" fontSize="9" textAnchor="end">
              100%
            </text>
            <text x={PAD_L - 8} y={PAD_T + PLOT_H} fill="#8b8b93" fontSize="9" textAnchor="end">
              0%
            </text>
            <text x={PAD_L} y={PAD_T + PLOT_H + 22} fill="#8b8b93" fontSize="9">
              {T_AXIS_LO}°C
            </text>
            <text x={PAD_L + PLOT_W} y={PAD_T + PLOT_H + 22} fill="#8b8b93" fontSize="9" textAnchor="end">
              {T_AXIS_HI}°C
            </text>
            {curvePoints.length >= 2 ? <polygon fill={`url(#${gradId})`} stroke="none" points={fillPts} /> : null}
            {curvePoints.length >= 2 ? (
              <polyline fill="none" stroke="#e81123" strokeWidth="2" strokeLinejoin="miter" points={linePts} />
            ) : null}
            {curvePoints.map((p, i) => (
              <g key={i}>
                <circle
                  cx={tempToX(p.temp)}
                  cy={pctToY(p.pct)}
                  r={canDriveFan ? 7 : 5}
                  fill={canDriveFan ? "#e81123" : "#444"}
                  stroke="#fff"
                  strokeWidth="1.5"
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
              </g>
            ))}
          </svg>
        </div>

        <div className="fan-curve-modal__legend" role="table" aria-label="Curve points">
          <div className="fan-curve-modal__legend-head" role="row">
            <span role="columnheader">#</span>
            <span role="columnheader">Temp</span>
            <span role="columnheader">Fan</span>
            <span role="columnheader" />
          </div>
          {[...curvePoints]
            .map((p, i) => ({ p, i }))
            .sort((a, b) => a.p.temp - b.p.temp)
            .map(({ p, i }, row) => (
              <div key={i} className="fan-curve-modal__legend-row" role="row">
                <span className="fan-curve-modal__legend-idx" role="cell">
                  {row + 1}
                </span>
                <span className="fan-curve-modal__legend-val" role="cell">
                  {Math.round(p.temp)} °C
                </span>
                <span className="fan-curve-modal__legend-val" role="cell">
                  {Math.round(p.pct)}%
                </span>
                <button
                  type="button"
                  className="fan-curve-modal__legend-remove"
                  disabled={!canDriveFan || curvePoints.length <= 2}
                  onClick={() => setCurvePoints((prev) => (prev.length <= 2 ? prev : prev.filter((_, j) => j !== i)))}
                >
                  Remove
                </button>
              </div>
            ))}
        </div>

        <div className="fan-curve-modal__actions">
          <button
            type="button"
            className="btn-outline btn-outline--sm"
            disabled={!canDriveFan || curvePoints.length >= 8}
            onClick={() =>
              setCurvePoints((prev) => {
                if (prev.length >= 8) return prev;
                const midT = Math.round((T_AXIS_LO + T_AXIS_HI) / 2);
                const midP = Math.round(prev.reduce((s, q) => s + q.pct, 0) / prev.length);
                return [...prev, { temp: midT, pct: clamp(midP, 5, 95) }];
              })
            }
          >
            Add point
          </button>
          <div className="fan-curve-modal__actions-right">
            <button type="button" className="btn-outline btn-outline--sm" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="btn-outline btn-outline--sm" onClick={onDone}>
              Done
            </button>
            <button type="button" className="fan-curve-modal__apply" disabled={!canDriveFan} onClick={onApply}>
              Apply
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
  cpuTempC?: number | null;
  gpuTempC?: number | null;
  useCelsius?: boolean;
};

export function FanControlSection({
  onToast,
  embedded,
  cpuTempC = null,
  gpuTempC = null,
  useCelsius = true,
}: Props) {
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
  const [curveEnable, setCurveEnable] = useState(false);
  const [curvePoints, setCurvePoints] = useState<CurvePoint[]>(() => [...DEFAULT_CURVE]);
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
    const ce = await r("fan_curve_enable");
    if (ce !== null) setCurveEnable(ce === "1");
    const fc = await r("fan_curve");
    if (fc != null) setCurvePoints(parseCurveStringToPoints(fc));
  }, [sysfsRead, fanReady, pullRpmsOnly]);

  useEffect(() => {
    if (!fanReady || !sysfsRead) return;
    void pullFull();
    const onChange = () => void pullFull();
    window.addEventListener(FAN_CHANGED, onChange);
    return () => window.removeEventListener(FAN_CHANGED, onChange);
  }, [fanReady, sysfsRead, pullFull]);

  useEffect(() => {
    if (!fanReady) return;
    const id = window.setInterval(() => void pullRpmsOnly(), 2500);
    return () => window.clearInterval(id);
  }, [fanReady, pullRpmsOnly]);

  const writeFan = useCallback(
    async (name: string, value: string, okMsg?: string): Promise<boolean> => {
      if (!sysfsWrite) {
        toast("Fans aren't available right now.");
        return false;
      }
      try {
        const res = await sysfsWrite(FAN(name), value);
        if (res && res.ok === true) {
          if (name === "max_fan") setMaxFan(value === "1");
          if (name === "fan_curve_enable") setCurveEnable(value === "1");
          if (okMsg) toast(okMsg);
          notifyFanChanged();
          void pullFull();
          return true;
        } else {
          const err = res && typeof res.error === "string" ? res.error : "Write failed";
          const low = err.toLowerCase();
          if (low.includes("eacces") || low.includes("eperm") || low.includes("permission denied")) {
            toast("Can't change the fans from this account.");
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

  const onToggleMaxFan = () => {
    const turningOn = !maxFan;
    void writeFan("max_fan", turningOn ? "1" : "0", turningOn ? "Boost fans on" : "Boost fans off");
  };

  const onToggleCurve = () => {
    void writeFan(
      "fan_curve_enable",
      curveEnable ? "0" : "1",
      curveEnable ? "Back to automatic fans" : "Custom fan speed on",
    );
  };

  const onRestoreEc = () => {
    void writeFan("fan_curve", "default", "Fans set to automatic");
  };

  const onApplyCurve = useCallback(() => {
    const body = serializeCurvePoints(curvePoints);
    const parsed = parseFanCurve(body);
    if (!parsed.ok) {
      toast(parsed.error);
      return;
    }
    void writeFan("fan_curve", body, "Fan curve saved");
    curveSnapRef.current = null;
    setCurveModalOpen(false);
  }, [curvePoints, toast, writeFan]);

  if (embedded && (!status?.supported || !fanReady)) {
    return null;
  }

  if (!status?.supported) {
    return (
      <div className="uv-panel fan-driver-fallback">
        <h3 className="panel-head__title" style={{ marginBottom: 8 }}>
          Fans
        </h3>
        <p className="muted">Fan controls show up on a supported OMEN laptop.</p>
      </div>
    );
  }

  if (!fanReady) {
    return (
      <div className="uv-panel fan-driver-fallback">
        <h3 className="panel-head__title" style={{ marginBottom: 8 }}>
          Fans
        </h3>
        <p className="muted">Fan controls aren't available on this computer.</p>
      </div>
    );
  }

  const driverBody = (
    <>
      {!embedded ? (
        <div className="panel-head panel-head--spaced">
          <h2 className="panel-head__title">
            Fans
            {!fanWritable ? (
              <span className="fan-driver-badge fan-driver-badge--ro">read-only</span>
            ) : (
              <span className="fan-driver-badge fan-driver-badge--ok">ready</span>
            )}
          </h2>
        </div>
      ) : null}

      <div className={embedded ? "thermal-block__driver" : "thermal-block thermal-block--driver"} data-thermal="auto">
        {fanReady && !fanWritable ? (
          <p className="fan-ctrl-card__hint fan-ctrl-card__hint--warn">Fans can be viewed, but this user can't change them yet.</p>
        ) : null}

        <ChassisUnderside
          cpuRaw={cpuRpm}
          gpuRaw={gpuRpm}
          maxFan={maxFan}
          cpuTempC={cpuTempC}
          gpuTempC={gpuTempC}
          useCelsius={useCelsius}
        />

        <div className="fan-easy-list">
          <div className="fan-easy-row">
            <div className="fan-easy-copy">
              <span className="fan-easy-title">Boost fans</span>
              <span className="fan-easy-sub">Keep both fans at full speed</span>
            </div>
            <button
              type="button"
              className="switch"
              aria-pressed={maxFan}
              aria-label="Boost fans"
              disabled={!canDriveFan}
              onClick={() => onToggleMaxFan()}
            >
              <span className="switch__knob" />
            </button>
          </div>

          <div className="fan-easy-row">
            <div className="fan-easy-copy">
              <span className="fan-easy-title">Custom fan speed</span>
              <span className="fan-easy-sub">Use your own temperature curve</span>
            </div>
            <button
              type="button"
              className="switch"
              aria-pressed={curveEnable}
              aria-label="Custom fan speed"
              disabled={!canDriveFan}
              onClick={() => onToggleCurve()}
            >
              <span className="switch__knob" />
            </button>
          </div>

          {curveEnable ? (
            <div className="fan-curve-inline">
              <button type="button" className="fan-curve-inline__open" disabled={!canDriveFan} onClick={openCurveModal}>
                Edit curve
              </button>
              <button type="button" className="linkish" disabled={!canDriveFan} onClick={onRestoreEc}>
                Reset to automatic
              </button>
            </div>
          ) : null}
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
