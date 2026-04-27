import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { useDriver } from "../driverContext";
import type { OmenDriverApi } from "../types";
import {
  LIGHTING_ANIMATION_MODES,
  parseSysfsAnimSpeed,
  parseSysfsBrightness,
  sysfsToUiAnimMode,
  type LightingAnimUi,
} from "../lightingDriver";
import { initOmenLightingKeyboard, scaleOmenKeyboard } from "../lib/omenKeyboard";
import { OmenKeyboardInner } from "./OmenKeyboardInner";

const ZONE_CLASSES = ["first-zone", "second-zone", "third-zone", "fourth-zone"] as const;
type ZoneClass = (typeof ZONE_CLASSES)[number];
const ZONE_CLASS_TO_SYSFS: Record<ZoneClass, string> = {
  "first-zone": "zone02",
  "second-zone": "zone01",
  "third-zone": "zone00",
  "fourth-zone": "zone03",
};
const RESTORE_DEFAULT_HEX: Record<ZoneClass, string> = {
  "first-zone": "B91C1C",
  "second-zone": "4C1D6B",
  "third-zone": "1E40AF",
  "fourth-zone": "CA8A04",
};

const BLANK_ZONE_HEX: Record<ZoneClass, string> = {
  "first-zone": "000000",
  "second-zone": "000000",
  "third-zone": "000000",
  "fourth-zone": "000000",
};
const ZONE_CLASS_TO_ATTR: Record<ZoneClass, string> = {
  "first-zone": "left",
  "second-zone": "mid",
  "third-zone": "right",
  "fourth-zone": "wasd",
};
const ATTR_TO_ZONE_CLASS: Record<string, ZoneClass> = {
  left: "first-zone",
  mid: "second-zone",
  right: "third-zone",
  wasd: "fourth-zone",
};

const SWATCHES: { c: string; label: string; none?: boolean }[] = [
  { c: "#e31837", label: "Red" },
  { c: "#f97316", label: "Orange" },
  { c: "#eab308", label: "Yellow" },
  { c: "#22c55e", label: "Green" },
  { c: "#14b8a6", label: "Teal" },
  { c: "#06b6d4", label: "Cyan" },
  { c: "#3b82f6", label: "Blue" },
  { c: "#6366f1", label: "Indigo" },
  { c: "#8b5cf6", label: "Violet" },
  { c: "#a855f7", label: "Purple" },
  { c: "#d946ef", label: "Magenta" },
  { c: "#ec4899", label: "Pink" },
  { c: "#f4f4f5", label: "White" },
  { c: "", label: "Off", none: true },
];

type Props = { isActive: boolean };

function normalizeSysfsHex(raw: string): string | null {
  const h = raw.replace(/^#/, "").trim().toUpperCase();
  return /^[0-9A-F]{6}$/.test(h) ? h : null;
}

function swatchCssToSysfsHex(css: string, none: boolean): string {
  if (none) return "000000";
  const v = css.trim();
  if (!v.startsWith("#")) return "FFFFFF";
  const body = v.slice(1);
  if (body.length === 3 && /^[0-9a-fA-F]{3}$/.test(body)) {
    const a = body[0]! + body[0]!;
    const b = body[1]! + body[1]!;
    const c = body[2]! + body[2]!;
    return (a + b + c).toUpperCase();
  }
  if (body.length === 6 && /^[0-9a-fA-F]{6}$/.test(body)) return body.toUpperCase();
  return "FFFFFF";
}

function applyZonePreviewToDom(zones: Record<ZoneClass, string>) {
  const root = document.getElementById("lighting-keyboard");
  if (!root) return;
  for (const cls of ZONE_CLASSES) {
    const raw = zones[cls].toUpperCase();
    root.querySelectorAll<HTMLElement>(`.omen-keyboard .${cls}`).forEach((h) => {
      h.style.background = "";
      h.style.backgroundColor = "";
      if (raw === "000000") {
        h.style.removeProperty("--kb-zone");
      } else {
        h.style.setProperty("--kb-zone", `#${raw.toLowerCase()}`);
      }
    });
  }
}

async function writeAllZonesToDriver(
  api: OmenDriverApi,
  zones: Record<ZoneClass, string>,
): Promise<string | null> {
  for (const cls of ZONE_CLASSES) {
    const r = await api.sysfsWrite(ZONE_CLASS_TO_SYSFS[cls], zones[cls]);
    if (!r.ok) return r.error ?? "Could not write zone color.";
  }
  return null;
}

async function syncLightingToDriver(
  api: OmenDriverApi,
  mode: LightingAnimUi,
  speed: number,
  brightness: number,
): Promise<string | null> {
  if (mode === "off") {
    const a = await api.sysfsWrite("animation_mode", "static");
    if (!a.ok) return a.error ?? "Could not set mode.";
    const b = await api.sysfsWrite("brightness", "0");
    return b.ok ? null : b.error ?? "Could not set brightness.";
  }
  const br = await api.sysfsWrite("brightness", String(brightness));
  if (!br.ok) return br.error ?? "Could not set brightness.";
  if (mode === "static") {
    const m = await api.sysfsWrite("animation_mode", "static");
    return m.ok ? null : m.error ?? "Could not set mode.";
  }
  const m = await api.sysfsWrite("animation_mode", mode);
  if (!m.ok) return m.error ?? "Could not set animation.";
  const s = await api.sysfsWrite("animation_speed", String(speed));
  return s.ok ? null : s.error ?? "Could not set speed.";
}

export function LightingSection({ isActive }: Props) {
  const { status, refresh } = useDriver();
  const [animMode, setAnimMode] = useState<LightingAnimUi>("static");
  const [animSpeed, setAnimSpeed] = useState(5);
  const [brightness, setBrightness] = useState(100);
  const [level, setLevel] = useState<"basic" | "advanced">("basic");
  const [activeZoneAttr, setActiveZoneAttr] = useState("left");
  const [activeSwatch, setActiveSwatch] = useState(0);
  const [animHint, setAnimHint] = useState<string | null>(null);
  const [zoneColors, setZoneColors] = useState<Record<ZoneClass, string>>(() => ({ ...BLANK_ZONE_HEX }));
  const [keyboardHydrated, setKeyboardHydrated] = useState(false);
  const brightnessBeforeOff = useRef(100);
  const prevAnimForDriver = useRef<LightingAnimUi | null>(null);
  const sysfsPullInFlightRef = useRef(false);
  const zoneColorsRef = useRef(zoneColors);
  zoneColorsRef.current = zoneColors;
  const api = typeof window !== "undefined" ? window.omenDriver : undefined;
  const canWrite = status?.sysfsWritable === true;

  const applyLightingFromSysfs = useCallback(async () => {
    const sysfsRead = api?.sysfsRead;
    if (!sysfsRead || !status?.sysfsReady) {
      setKeyboardHydrated(true);
      return;
    }
    if (sysfsPullInFlightRef.current) return;
    sysfsPullInFlightRef.current = true;
    try {
      const zones: Record<ZoneClass, string> = { ...BLANK_ZONE_HEX };
      for (const cls of ZONE_CLASSES) {
        const r = await sysfsRead(ZONE_CLASS_TO_SYSFS[cls]);
        if (r.ok && r.value) {
          const hex = normalizeSysfsHex(r.value);
          if (hex) zones[cls] = hex;
        }
      }
      const modeR = await sysfsRead("animation_mode");
      const speedR = await sysfsRead("animation_speed");
      const brR = await sysfsRead("brightness");
      const br = parseSysfsBrightness(brR.ok ? brR.value : undefined);
      const speed = parseSysfsAnimSpeed(speedR.ok ? speedR.value : undefined);
      const mode = sysfsToUiAnimMode(modeR.ok ? modeR.value : undefined, br);
      prevAnimForDriver.current = mode;
      startTransition(() => {
        setZoneColors(zones);
        setAnimMode(mode);
        setAnimSpeed(speed);
        if (mode === "off") {
          setBrightness(0);
        } else {
          setBrightness(br);
          if (br > 0) brightnessBeforeOff.current = br;
        }
      });
    } finally {
      sysfsPullInFlightRef.current = false;
      setKeyboardHydrated(true);
    }
  }, [api, status?.sysfsReady]);

  const activeCls: ZoneClass = ATTR_TO_ZONE_CLASS[activeZoneAttr] ?? "first-zone";
  const hexInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = hexInputRef.current;
    if (!el || document.activeElement === el) return;
    el.value = zoneColors[activeCls];
  }, [zoneColors, activeCls]);

  const clearZoneHighlight = useCallback(() => {
    document
      .querySelectorAll(
        "#lighting-keyboard .first-zone.active, #lighting-keyboard .second-zone.active, #lighting-keyboard .third-zone.active, #lighting-keyboard .fourth-zone.active",
      )
      .forEach((el) => el.classList.remove("active"));
  }, []);

  useEffect(() => {
    applyZonePreviewToDom(zoneColors);
  }, [zoneColors]);

  useEffect(() => {
    if (!isActive) return;
    const root = document.getElementById("lighting-keyboard");
    if (!root || root.getAttribute("data-active-zone")) return;
    root.setAttribute("data-active-zone", "left");
    setActiveZoneAttr("left");
    clearZoneHighlight();
    root.querySelectorAll(".omen-keyboard .first-zone").forEach((k) => k.classList.add("active"));
  }, [isActive, clearZoneHighlight]);

  useEffect(() => {
    if (!isActive) {
      setKeyboardHydrated(false);
      return;
    }
    if (!api?.sysfsRead || !status?.sysfsReady) {
      setKeyboardHydrated(true);
      return;
    }
    void applyLightingFromSysfs();
  }, [isActive, status?.sysfsReady, api, applyLightingFromSysfs]);

  useEffect(() => {
    if (!isActive || !api?.sysfsRead || !status?.sysfsReady) return;
    const tick = () => {
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement &&
        el.closest("#view-lighting") &&
        (el.type === "range" || el.type === "color" || el.type === "text")
      ) {
        return;
      }
      void applyLightingFromSysfs();
    };
    const ms = animMode !== "static" && animMode !== "off" ? 200 : 3200;
    const id = window.setInterval(tick, ms);
    return () => window.clearInterval(id);
  }, [isActive, status?.sysfsReady, api, applyLightingFromSysfs, animMode]);

  useEffect(() => {
    if (!keyboardHydrated) return;
    if (!api || !canWrite) {
      prevAnimForDriver.current = animMode;
      return;
    }
    const prev = prevAnimForDriver.current;
    if (animMode === "static" && prev !== null && prev !== "static") {
      void (async () => {
        const err = await writeAllZonesToDriver(api, zoneColorsRef.current);
        if (err) setAnimHint(err);
        else {
          setAnimHint(null);
          void refresh();
          window.setTimeout(() => void applyLightingFromSysfs(), 120);
        }
      })();
    }
    prevAnimForDriver.current = animMode;
  }, [animMode, canWrite, api, refresh, keyboardHydrated, applyLightingFromSysfs]);

  const onKeyAreaClick = useCallback(
    (e: React.MouseEvent) => {
      const t = e.target as HTMLElement;
      const key = t.closest(".omen-keyboard .small-key, .omen-keyboard .key, .omen-keyboard .wide-key");
      if (!key) return;
      const zoneClass = ZONE_CLASSES.find((c) => key.classList.contains(c));
      if (!zoneClass) return;
      const root = document.getElementById("lighting-keyboard");
      if (!root) return;
      const attr = ZONE_CLASS_TO_ATTR[zoneClass];
      root.setAttribute("data-active-zone", attr);
      setActiveZoneAttr(attr);
      clearZoneHighlight();
      document.querySelectorAll(`#lighting-keyboard .omen-keyboard .${zoneClass}`).forEach((k) => k.classList.add("active"));
    },
    [clearZoneHighlight],
  );

  useEffect(() => {
    const cleanup = initOmenLightingKeyboard();
    return cleanup;
  }, []);

  useEffect(() => {
    if (!isActive) return;
    requestAnimationFrame(() => {
      scaleOmenKeyboard();
      setTimeout(scaleOmenKeyboard, 80);
    });
  }, [isActive]);

  useEffect(() => {
    const tab = document.querySelector<HTMLElement>(`.light-anim-tab[data-anim-tab="${animMode}"]`);
    tab?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [animMode]);

  useEffect(() => {
    if (!keyboardHydrated) return;
    if (!api) return;
    if (!canWrite) {
      setAnimHint(null);
      return;
    }
    const t = window.setTimeout(() => {
      void (async () => {
        const err = await syncLightingToDriver(api, animMode, animSpeed, brightness);
        if (err) setAnimHint(err);
        else {
          setAnimHint(null);
          void refresh();
          window.setTimeout(() => void applyLightingFromSysfs(), 100);
        }
      })();
    }, 160);
    return () => clearTimeout(t);
  }, [animMode, animSpeed, brightness, canWrite, api, refresh, keyboardHydrated, applyLightingFromSysfs]);

  const setAnimModeUi = useCallback((next: LightingAnimUi, brightnessOverride?: number) => {
    if (next === "off" && animMode !== "off") {
      brightnessBeforeOff.current = brightness;
    }
    if (animMode === "off" && next !== "off") {
      if (brightnessOverride !== undefined) setBrightness(brightnessOverride);
      else setBrightness(brightnessBeforeOff.current);
    }
    setAnimMode(next);
  }, [animMode, brightness]);

  const applyToKeyboard = useCallback(async () => {
    if (!api || !canWrite) return;
    const err = await syncLightingToDriver(api, animMode, animSpeed, brightness);
    if (err) {
      setAnimHint(err);
      return;
    }
    if (animMode === "static") {
      const zerr = await writeAllZonesToDriver(api, zoneColors);
      if (zerr) {
        setAnimHint(zerr);
        return;
      }
    }
    setAnimHint(null);
    void refresh();
    window.setTimeout(() => void applyLightingFromSysfs(), 120);
  }, [api, canWrite, animMode, animSpeed, brightness, zoneColors, refresh, applyLightingFromSysfs]);

  const discardChanges = useCallback(async () => {
    if (api?.sysfsRead && status?.sysfsReady) {
      await applyLightingFromSysfs();
    } else {
      setZoneColors({ ...BLANK_ZONE_HEX });
    }
    setAnimHint(null);
    void refresh();
  }, [api, status?.sysfsReady, applyLightingFromSysfs, refresh]);

  const restoreDefaults = useCallback(() => {
    const defaults = { ...RESTORE_DEFAULT_HEX };
    setZoneColors(defaults);
    setAnimModeUi("static");
    setAnimSpeed(5);
    setBrightness(100);
    setActiveSwatch(0);
    setActiveZoneAttr("left");
    setAnimHint(null);
    const root = document.getElementById("lighting-keyboard");
    if (root) {
      root.setAttribute("data-active-zone", "left");
      clearZoneHighlight();
      root.querySelectorAll(".omen-keyboard .first-zone").forEach((k) => k.classList.add("active"));
    }
    if (api && canWrite) {
      void (async () => {
        const syncErr = await syncLightingToDriver(api, "static", 5, 100);
        if (syncErr) {
          setAnimHint(syncErr);
          void refresh();
          return;
        }
        const zoneErr = await writeAllZonesToDriver(api, defaults);
        if (zoneErr) setAnimHint(zoneErr);
        void refresh();
        window.setTimeout(() => void applyLightingFromSysfs(), 120);
      })();
    }
  }, [api, canWrite, setAnimModeUi, refresh, clearZoneHighlight, applyLightingFromSysfs]);

  const rgbBanner =
    status &&
    !status.sysfsWritable &&
    (status.supported
      ? status.sysfsReady
        ? "Driver sysfs is present but not writable from this user. Install udev rules from the driver repo (install-udev-rules.sh) or apply colors with sudo in a terminal."
        : "omen-rgb-keyboard not detected. Install it on Linux (see System Vitals → RGB keyboard driver), then return here to apply lighting."
      : "Hardware RGB uses the Linux omen-rgb-keyboard driver. This page is a visual preview on this platform.");

  return (
    <section className={`view${isActive ? " is-active" : ""}`} id="view-lighting" data-view="lighting" role="tabpanel">
      {rgbBanner ? (
        <div className="lighting-driver-banner" role="status">
          {rgbBanner}
        </div>
      ) : null}
      {animHint ? (
        <div className="lighting-anim-hint" role="status">
          {animHint}
        </div>
      ) : null}
      <div className="lighting-anim-card">
        <header className="lighting-anim-card__head">
          <h2 className="lighting-anim-card__title">Animation</h2>
          <p className="lighting-anim-card__sub">
            Zone colors, brightness, speed, and effect are read from sysfs so the preview matches the keyboard. Moving
            effects only run on the hardware — the on-screen keys show the stored zone colors and overall brightness.
          </p>
        </header>
        <div className="light-anim-tabstrip" role="tablist" aria-label="Animation effect">
          <div className="light-anim-tabstrip-scroll">
            <button
              type="button"
              role="tab"
              aria-selected={animMode === "off"}
              data-anim-tab="off"
              className={`light-anim-tab${animMode === "off" ? " is-active" : ""}`}
              onClick={() => setAnimModeUi("off")}
            >
              Off
            </button>
            {LIGHTING_ANIMATION_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={animMode === m.id}
                data-anim-tab={m.id}
                className={`light-anim-tab${animMode === m.id ? " is-active" : ""}`}
                onClick={() => setAnimModeUi(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div className="lighting-anim-tab-panel" role="tabpanel" aria-label="Animation options">
          <div className="lighting-anim-tab-panel__sliders">
            <label className="light-slider-label" htmlFor="light-anim-speed">
              Animation speed
              <span className="light-slider-val">{animSpeed}</span>
            </label>
            <input
              id="light-anim-speed"
              type="range"
              className="light-slider"
              min={1}
              max={10}
              step={1}
              value={animSpeed}
              disabled={animMode === "off" || animMode === "static"}
              onChange={(e) => setAnimSpeed(Number(e.target.value))}
            />
            <label className="light-slider-label" htmlFor="light-brightness">
              Brightness
              <span className="light-slider-val">{animMode === "off" ? 0 : brightness}%</span>
            </label>
            <input
              id="light-brightness"
              type="range"
              className="light-slider"
              min={0}
              max={100}
              step={1}
              value={animMode === "off" ? 0 : brightness}
              disabled={animMode === "off"}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (animMode === "off") {
                  setAnimModeUi("static", v);
                  return;
                }
                setBrightness(v);
              }}
            />
          </div>
          {animMode !== "static" && animMode !== "off" ? (
            <p className="lighting-anim-card__note lighting-anim-tab-panel__note">
              Use <strong>Static</strong> to paint zones with the color swatches below.
            </p>
          ) : null}
        </div>
      </div>
      <div className="keyboard-stage keyboard-stage--omen-lkb">
        <div className="light-kb-chassis light-kb-chassis--omen">
          <div id="lighting-keyboard" className="omen-lkb-root" role="group" aria-label="Keyboard lighting zones">
            <div
              className="omen-lkb-scaler"
              onClick={onKeyAreaClick}
              role="presentation"
              style={
                animMode === "off"
                  ? { filter: "grayscale(1) brightness(0.42)" }
                  : { filter: `brightness(${Math.max(0.14, brightness / 100)})` }
              }
            >
              <div className="omen-keyboard">
                <OmenKeyboardInner />
              </div>
            </div>
          </div>
          <div className="light-color-bar">
            <span className="light-color-bar__label">Color</span>
            <div className="light-swatches" role="list">
              {SWATCHES.map((s, i) => (
                <button
                  key={s.label}
                  type="button"
                  className={`light-swatch${s.none ? " light-swatch--none" : ""}${activeSwatch === i ? " is-active" : ""}`}
                  data-swatch
                  style={s.none ? undefined : { "--c": s.c } as React.CSSProperties}
                  aria-label={s.label}
                  title={s.label}
                  onClick={() => {
                    setActiveSwatch(i);
                    const root = document.getElementById("lighting-keyboard");
                    if (!root) return;
                    const zone = root.getAttribute("data-active-zone");
                    if (zone) setActiveZoneAttr(zone);
                    const cls = zone ? ATTR_TO_ZONE_CLASS[zone] : null;
                    if (!cls) {
                      setAnimHint("Select a keyboard zone first.");
                      return;
                    }
                    const hex = swatchCssToSysfsHex(s.c, Boolean(s.none));
                    setZoneColors((prev) => ({ ...prev, [cls]: hex }));
                    setAnimHint(null);
                    if (canWrite && animMode === "static" && api) {
                      void (async () => {
                        const r = await api.sysfsWrite(ZONE_CLASS_TO_SYSFS[cls], hex);
                        if (!r.ok) setAnimHint(r.error ?? "Could not write zone.");
                        else {
                          void refresh();
                          window.setTimeout(() => void applyLightingFromSysfs(), 100);
                        }
                      })();
                    }
                  }}
                >
                  {s.none ? "/" : null}
                </button>
              ))}
            </div>
            <div className="light-level-toggle" role="group" aria-label="Editor mode">
              <button type="button" className={level === "basic" ? "is-on" : ""} onClick={() => setLevel("basic")}>
                BASIC
              </button>
              <button type="button" className={level === "advanced" ? "is-on" : ""} onClick={() => setLevel("advanced")}>
                ADVANCED
              </button>
            </div>
            {level === "advanced" ? (
              <div className="light-advanced-panel">
                <p className="light-advanced-panel__hint">
                  Use the picker for any RGB value on the highlighted zone (same 6-digit values as sysfs).
                </p>
                <div className="light-advanced-panel__row">
                  <label className="light-advanced-picker">
                    <span className="light-advanced-picker__lbl">Color</span>
                    <input
                      type="color"
                      className="light-advanced-picker__input"
                      value={`#${zoneColors[activeCls].toLowerCase()}`}
                      aria-label={`Color picker for ${activeCls}`}
                      onChange={(e) => {
                        const body = e.target.value.replace("#", "").toUpperCase();
                        if (!/^[0-9A-F]{6}$/.test(body)) return;
                        setZoneColors((prev) => ({ ...prev, [activeCls]: body }));
                        setAnimHint(null);
                        if (canWrite && animMode === "static" && api) {
                          void (async () => {
                            const r = await api.sysfsWrite(ZONE_CLASS_TO_SYSFS[activeCls], body);
                            if (!r.ok) setAnimHint(r.error ?? "Could not write zone.");
                            else {
                              void refresh();
                              window.setTimeout(() => void applyLightingFromSysfs(), 100);
                            }
                          })();
                        }
                      }}
                    />
                  </label>
                  <label className="light-advanced-hex">
                    <span className="light-advanced-hex__lbl">Hex</span>
                    <input
                      ref={hexInputRef}
                      type="text"
                      className="light-advanced-hex__input"
                      spellCheck={false}
                      defaultValue={zoneColors[activeCls]}
                      maxLength={6}
                      aria-label="Six-digit hex RRGGBB for selected zone"
                      onBlur={(e) => {
                        const h = e.target.value.replace(/^#/, "").trim().toUpperCase();
                        if (!/^[0-9A-F]{6}$/.test(h)) {
                          e.target.value = zoneColors[activeCls];
                          return;
                        }
                        setZoneColors((prev) => ({ ...prev, [activeCls]: h }));
                        setAnimHint(null);
                        if (canWrite && animMode === "static" && api) {
                          void (async () => {
                            const r = await api.sysfsWrite(ZONE_CLASS_TO_SYSFS[activeCls], h);
                            if (!r.ok) setAnimHint(r.error ?? "Could not write zone.");
                            else {
                              void refresh();
                              window.setTimeout(() => void applyLightingFromSysfs(), 100);
                            }
                          })();
                        }
                      }}
                    />
                  </label>
                </div>
              </div>
            ) : null}
          </div>
        </div>
        <p className="keyboard-hint">Select a zone to begin.</p>
      </div>
      <footer className="light-footer">
        <button type="button" className="linkish" onClick={() => restoreDefaults()}>
          Restore defaults
        </button>
        <div className="light-footer__btns">
          <button type="button" className="btn-outline" onClick={() => void discardChanges()}>
            Discard changes
          </button>
          <button type="button" className="btn-outline" onClick={() => void applyToKeyboard()} disabled={!api || !canWrite}>
            Apply
          </button>
        </div>
      </footer>
    </section>
  );
}
