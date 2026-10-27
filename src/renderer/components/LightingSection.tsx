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

function gradientConfigFromZones(zones: Record<ZoneClass, string>): string {
  const ordered = [zones["third-zone"], zones["second-zone"], zones["first-zone"], zones["fourth-zone"]];
  const colors = ordered.filter((c, i) => c !== "000000" && ordered.indexOf(c) === i);
  const cycle = colors.length ? colors : ["E81123", "3EE6C6", "F4F4F5"];
  return `0,1,2,3:${cycle.join(",")}`;
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

/** Driver parse_rgb() rejects a leading '#'; writes must be bare RRGGBB. */
function toSysfsRgb(hex: string): string {
  return hex.replace(/^#/, "").trim().toUpperCase();
}

async function writeAllZonesToDriver(
  api: OmenDriverApi,
  zones: Record<ZoneClass, string>,
): Promise<string | null> {
  for (const cls of ZONE_CLASSES) {
    const r = await api.sysfsWrite(ZONE_CLASS_TO_SYSFS[cls], toSysfsRgb(zones[cls]));
    if (!r.ok) return r.error ?? "Could not write zone color.";
  }
  return null;
}

async function writeZoneToDriver(
  api: OmenDriverApi,
  cls: ZoneClass,
  hex: string,
): Promise<string | null> {
  const r = await api.sysfsWrite(ZONE_CLASS_TO_SYSFS[cls], toSysfsRgb(hex));
  return r.ok ? null : r.error ?? "Could not write zone.";
}

function zonesHaveColor(zones: Record<ZoneClass, string>): boolean {
  return ZONE_CLASSES.some((cls) => zones[cls] !== "000000");
}

async function writeAnimationSpeedOnly(api: OmenDriverApi, speed: number): Promise<string | null> {
  const s = await api.sysfsWrite("animation_speed", String(speed));
  return s.ok ? null : s.error ?? "Could not set speed.";
}

async function writeBrightnessOnly(api: OmenDriverApi, brightness: number): Promise<string | null> {
  const br = await api.sysfsWrite("brightness", String(brightness));
  return br.ok ? null : br.error ?? "Could not set brightness.";
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
  const [brightnessLock, setBrightnessLock] = useState(false);
  const [muteLedOn, setMuteLedOn] = useState(false);
  const brightnessBeforeOff = useRef(100);
  const prevAnimForDriver = useRef<LightingAnimUi | null>(null);
  const driverMirrorRef = useRef<{ mode: LightingAnimUi; speed: number; brightness: number } | null>(null);
  const sysfsPullInFlightRef = useRef(false);
  /** While set, ignore sysfs mode/speed/brightness so a fresh click isn't overwritten by a stale read. */
  const suppressAnimPullUntilRef = useRef(0);
  const animSpeedRef = useRef(animSpeed);
  const brightnessRef = useRef(brightness);
  const zoneColorsRef = useRef(zoneColors);
  animSpeedRef.current = animSpeed;
  brightnessRef.current = brightness;
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
      const holdUi = Date.now() < suppressAnimPullUntilRef.current;
      const lockR = await sysfsRead("brightness_lock");

      if (holdUi) {
        // Don't clobber a color/mode the user just wrote with a stale poll.
        startTransition(() => {
          setBrightnessLock(lockR.ok && String(lockR.value ?? "").trim() === "1");
          setKeyboardHydrated(true);
        });
        return;
      }

      const modeR = await sysfsRead("animation_mode");
      const speedR = await sysfsRead("animation_speed");
      const brR = await sysfsRead("brightness");
      const br = parseSysfsBrightness(brR.ok ? brR.value : undefined);
      const speed = parseSysfsAnimSpeed(speedR.ok ? speedR.value : undefined);
      const mode = sysfsToUiAnimMode(modeR.ok ? modeR.value : undefined, br);
      const effBr = mode === "off" ? 0 : br;

      // Zone show() returns live LED bytes. During effects those are mid-frame
      // (often black) — never treat them as the user's static palette.
      let zones: Record<ZoneClass, string> | null = null;
      if (mode === "static" || mode === "off") {
        zones = { ...BLANK_ZONE_HEX };
        for (const cls of ZONE_CLASSES) {
          const r = await sysfsRead(ZONE_CLASS_TO_SYSFS[cls]);
          if (r.ok && r.value) {
            const hex = normalizeSysfsHex(r.value);
            if (hex) zones[cls] = hex;
          }
        }
      }

      prevAnimForDriver.current = mode;
      driverMirrorRef.current = { mode, speed, brightness: effBr };
      startTransition(() => {
        if (zones) setZoneColors(zones);
        setAnimMode(mode);
        setAnimSpeed(speed);
        setBrightnessLock(lockR.ok && String(lockR.value ?? "").trim() === "1");
        if (mode === "off") {
          setBrightness(0);
        } else {
          setBrightness(br);
          if (br > 0) brightnessBeforeOff.current = br;
        }
        setKeyboardHydrated(true);
      });
    } finally {
      sysfsPullInFlightRef.current = false;
    }
  }, [api, status?.sysfsReady]);

  const activeCls: ZoneClass = ATTR_TO_ZONE_CLASS[activeZoneAttr] ?? "first-zone";

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
    const tab = document.querySelector<HTMLElement>(`.light-effect[data-anim-tab="${animMode}"]`);
    tab?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [animMode]);

  // Debounced speed / brightness only — mode changes apply immediately in setAnimModeUi.
  useEffect(() => {
    if (!keyboardHydrated || !isActive) return;
    if (!api) return;
    if (!canWrite) {
      setAnimHint(null);
      return;
    }
    const effBr = animMode === "off" ? 0 : brightness;
    const mirror = driverMirrorRef.current;
    if (!mirror) return;
    if (mirror.mode !== animMode) return; // mode push owns that write
    if (mirror.speed === animSpeed && mirror.brightness === effBr) return;

    const t = window.setTimeout(() => {
      void (async () => {
        const onlySpeed =
          mirror.brightness === effBr &&
          mirror.speed !== animSpeed &&
          animMode !== "off" &&
          animMode !== "static";
        const onlyBrightness =
          mirror.speed === animSpeed && mirror.brightness !== effBr && animMode !== "off";
        if (!onlySpeed && !onlyBrightness) return;

        suppressAnimPullUntilRef.current = Date.now() + 700;
        const err = onlySpeed
          ? await writeAnimationSpeedOnly(api, animSpeed)
          : await writeBrightnessOnly(api, brightness);
        if (err) setAnimHint(err);
        else {
          setAnimHint(null);
          driverMirrorRef.current = { mode: animMode, speed: animSpeed, brightness: effBr };
        }
      })();
    }, 120);
    return () => clearTimeout(t);
  }, [isActive, animMode, animSpeed, brightness, canWrite, api, keyboardHydrated]);

  const setAnimModeUi = useCallback(
    (next: LightingAnimUi, brightnessOverride?: number) => {
      let nextBrightness = brightnessRef.current;
      if (next === "off" && animMode !== "off") {
        brightnessBeforeOff.current = brightnessRef.current;
        nextBrightness = 0;
      }
      if (animMode === "off" && next !== "off") {
        nextBrightness =
          brightnessOverride !== undefined ? brightnessOverride : brightnessBeforeOff.current;
        setBrightness(nextBrightness);
      } else if (next === "off") {
        setBrightness(0);
      }

      setAnimMode(next);

      if (!api || !canWrite) return;

      // One click → write now. Hold off sysfs pulls so polling can't snap the tab back.
      suppressAnimPullUntilRef.current = Date.now() + 900;
      const speed = animSpeedRef.current;
      const comingFromEffect = animMode !== "static" && animMode !== "off" && next === "static";
      void (async () => {
        const err = await syncLightingToDriver(api, next, speed, nextBrightness);
        if (!err && next === "gradient") {
          const grad = await api.sysfsWrite(
            "gradient_config",
            gradientConfigFromZones(zoneColorsRef.current),
          );
          if (!grad.ok) {
            setAnimHint("Couldn't update the gradient.");
            return;
          }
        }
        // Only re-paint zones when leaving an effect if we still have a real
        // static palette. Never push blacks scraped from mid-animation LEDs.
        if (!err && comingFromEffect && zonesHaveColor(zoneColorsRef.current)) {
          const zoneErr = await writeAllZonesToDriver(api, zoneColorsRef.current);
          if (zoneErr) {
            setAnimHint(zoneErr);
            return;
          }
        }
        if (err) {
          setAnimHint(err);
          return;
        }
        setAnimHint(null);
        driverMirrorRef.current = {
          mode: next,
          speed,
          brightness: next === "off" ? 0 : nextBrightness,
        };
        void refresh();
      })();
    },
    [animMode, api, canWrite, refresh],
  );

  const applyToKeyboard = useCallback(async () => {
    if (!api || !canWrite) return;
    suppressAnimPullUntilRef.current = Date.now() + 900;
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
    if (animMode === "gradient") {
      const grad = await api.sysfsWrite("gradient_config", gradientConfigFromZones(zoneColors));
      if (!grad.ok) {
        setAnimHint("Couldn't update the gradient.");
        return;
      }
    }
    setAnimHint(null);
    driverMirrorRef.current = {
      mode: animMode,
      speed: animSpeed,
      brightness: animMode === "off" ? 0 : brightness,
    };
    void refresh();
  }, [api, canWrite, animMode, animSpeed, brightness, zoneColors, refresh]);

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
        else driverMirrorRef.current = { mode: "static", speed: 5, brightness: 100 };
        void refresh();
        window.setTimeout(() => void applyLightingFromSysfs(), 120);
      })();
    }
  }, [api, canWrite, setAnimModeUi, refresh, clearZoneHighlight, applyLightingFromSysfs]);

  const paintAllZones = useCallback(async () => {
    if (!api || !canWrite) return;
    const hex = toSysfsRgb(zoneColors[activeCls]);
    const br = brightnessRef.current || brightnessBeforeOff.current || 100;
    suppressAnimPullUntilRef.current = Date.now() + 900;
    if (animMode !== "static") setAnimMode("static");
    if (brightnessRef.current <= 0) setBrightness(br);
    if (brightnessRef.current <= 0 || animMode === "off") {
      const b = await writeBrightnessOnly(api, br);
      if (b) {
        setAnimHint(b);
        return;
      }
    }
    const r = await api.sysfsWrite("all", hex);
    if (!r.ok) {
      setAnimHint("Couldn't paint the keyboard.");
      return;
    }
    setZoneColors({
      "first-zone": hex,
      "second-zone": hex,
      "third-zone": hex,
      "fourth-zone": hex,
    });
    setAnimHint(null);
    driverMirrorRef.current = {
      mode: "static",
      speed: animSpeedRef.current,
      brightness: br,
    };
    void refresh();
  }, [api, canWrite, zoneColors, activeCls, animMode, refresh]);

  const toggleMuteLight = useCallback(async () => {
    if (!api || !canWrite) return;
    const next = !muteLedOn;
    const r = await api.sysfsWrite("mute_led", next ? "1" : "0");
    if (!r.ok) {
      setAnimHint("Couldn't change the mute light.");
      return;
    }
    setMuteLedOn(next);
    setAnimHint(null);
  }, [api, canWrite, muteLedOn]);

  const rgbBanner =
    status &&
    !status.sysfsWritable &&
    (status.supported
      ? status.sysfsReady
        ? "Lighting can be previewed here, but this account can't change the keyboard yet."
        : "Install the OmenLinux keyboard driver to control the lights."
      : "This is a preview. Keyboard lights change on a supported laptop.");

  const speedDisabled = animMode === "off" || animMode === "static";
  const brightnessDisabled = animMode === "off";
  const speedPct = ((animSpeed - 1) / 9) * 100;
  const brightnessPct = animMode === "off" ? 0 : brightness;

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
                    // Zone writes force static in the driver — always push color.
                    if (canWrite && api) {
                      if (animMode !== "static") setAnimMode("static");
                      const br = brightnessRef.current || brightnessBeforeOff.current || 100;
                      if (brightnessRef.current <= 0) setBrightness(br);
                      suppressAnimPullUntilRef.current = Date.now() + 900;
                      void (async () => {
                        // Brightness first: zone_set scales the RGB by global_brightness.
                        if (brightnessRef.current <= 0 || animMode === "off") {
                          const b = await writeBrightnessOnly(api, br);
                          if (b) {
                            setAnimHint(b);
                            return;
                          }
                        }
                        const err = await writeZoneToDriver(api, cls, hex);
                        if (err) setAnimHint(err);
                        else {
                          driverMirrorRef.current = {
                            mode: "static",
                            speed: animSpeedRef.current,
                            brightness: br,
                          };
                          void refresh();
                        }
                      })();
                    }
                  }}
                >
                  {s.none ? "/" : null}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn-outline btn-outline--sm"
              disabled={!canWrite}
              onClick={() => void paintAllZones()}
            >
              Paint all keys
            </button>
            <div className="light-level-toggle" role="group" aria-label="Color picker mode">
              <button type="button" className={level === "basic" ? "is-on" : ""} onClick={() => setLevel("basic")}>
                Swatches
              </button>
              <button type="button" className={level === "advanced" ? "is-on" : ""} onClick={() => setLevel("advanced")}>
                Custom
              </button>
            </div>
            {level === "advanced" ? (
              <label className="light-advanced-picker">
                <span className="light-advanced-picker__lbl">Custom</span>
                <input
                  type="color"
                  className="light-advanced-picker__input"
                  value={`#${zoneColors[activeCls].toLowerCase()}`}
                  aria-label="Custom color"
                  onChange={(e) => {
                    const body = e.target.value.replace("#", "").toUpperCase();
                    if (!/^[0-9A-F]{6}$/.test(body)) return;
                    setZoneColors((prev) => ({ ...prev, [activeCls]: body }));
                    setAnimHint(null);
                    if (canWrite && api) {
                      if (animMode !== "static") setAnimMode("static");
                      const br = brightnessRef.current || brightnessBeforeOff.current || 100;
                      if (brightnessRef.current <= 0) setBrightness(br);
                      suppressAnimPullUntilRef.current = Date.now() + 900;
                      void (async () => {
                        if (brightnessRef.current <= 0 || animMode === "off") {
                          const b = await writeBrightnessOnly(api, br);
                          if (b) {
                            setAnimHint(b);
                            return;
                          }
                        }
                        const err = await writeZoneToDriver(api, activeCls, body);
                        if (err) setAnimHint("Couldn't set that color.");
                        else {
                          driverMirrorRef.current = {
                            mode: "static",
                            speed: animSpeedRef.current,
                            brightness: br,
                          };
                          void refresh();
                        }
                      })();
                    }
                  }}
                />
              </label>
            ) : null}
          </div>
        </div>
        <p className="keyboard-hint">Click a zone, then pick a color.</p>
      </div>

      <div className="lighting-anim-card">
        <header className="lighting-anim-card__head">
          <h2 className="lighting-anim-card__title">Effects</h2>
          <p className="lighting-anim-card__sub">Choose a look, then tune brightness and speed. Hit Apply when ready.</p>
        </header>

        <div className="light-effect-bar" role="tablist" aria-label="Animation effect">
          <button
            type="button"
            role="tab"
            aria-selected={animMode === "off"}
            data-anim-tab="off"
            className={`light-effect${animMode === "off" ? " is-active" : ""}`}
            onClick={() => setAnimModeUi("off")}
          >
            <span className="light-effect__preview" aria-hidden>
              <span className="light-effect__beam" />
            </span>
            <span className="light-effect__label">Off</span>
          </button>
          {LIGHTING_ANIMATION_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={animMode === m.id}
              data-anim-tab={m.id}
              className={`light-effect${animMode === m.id ? " is-active" : ""}`}
              onClick={() => setAnimModeUi(m.id)}
            >
              <span className="light-effect__preview" aria-hidden>
                <span className="light-effect__beam" />
                <span className="light-effect__beam light-effect__beam--b" />
                <span className="light-effect__beam light-effect__beam--c" />
              </span>
              <span className="light-effect__label">{m.label}</span>
            </button>
          ))}
        </div>

        <div className="lighting-anim-controls" role="tabpanel" aria-label="Animation options">
          <div className={`light-meter${speedDisabled ? " is-disabled" : ""}`}>
            <div className="light-meter__head">
              <label className="light-meter__label" htmlFor="light-anim-speed">
                Speed
              </label>
              <span className="light-meter__value">{animSpeed}</span>
            </div>
            <div className="light-meter__track">
              <div className="light-meter__fill" style={{ width: `${speedPct}%` }} aria-hidden />
              <input
                id="light-anim-speed"
                type="range"
                className="light-meter__input"
                min={1}
                max={10}
                step={1}
                value={animSpeed}
                disabled={speedDisabled}
                onChange={(e) => setAnimSpeed(Number(e.target.value))}
              />
            </div>
            <div className="light-meter__ends" aria-hidden>
              <span>Slow</span>
              <span>Fast</span>
            </div>
          </div>

          <div className={`light-meter${brightnessDisabled ? " is-disabled" : ""}`}>
            <div className="light-meter__head">
              <label className="light-meter__label" htmlFor="light-brightness">
                Brightness
              </label>
              <span className="light-meter__value">{brightnessPct}%</span>
            </div>
            <div className="light-meter__track">
              <div className="light-meter__fill" style={{ width: `${brightnessPct}%` }} aria-hidden />
              <input
                id="light-brightness"
                type="range"
                className="light-meter__input"
                min={0}
                max={100}
                step={1}
                value={brightnessPct}
                disabled={brightnessDisabled}
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
            <div className="light-meter__ends" aria-hidden>
              <span>Dim</span>
              <span>Max</span>
            </div>
          </div>

          <div className="light-toggles">
            <div className="light-lock-row">
              <div className="light-lock-row__copy">
                <span className="light-lock-row__title">Mute light</span>
                <span className="light-lock-row__sub">Hardware mute LED</span>
              </div>
              <button
                type="button"
                className="switch"
                aria-pressed={muteLedOn}
                aria-label="Mute light"
                disabled={!canWrite}
                onClick={() => void toggleMuteLight()}
              >
                <span className="switch__knob" />
              </button>
            </div>
            <div className="light-lock-row">
              <div className="light-lock-row__copy">
                <span className="light-lock-row__title">Keep brightness on idle</span>
                <span className="light-lock-row__sub">Don’t dim when idle</span>
              </div>
              <button
                type="button"
                className="switch"
                aria-pressed={brightnessLock}
                aria-label="Brightness lock"
                disabled={!canWrite}
                onClick={() => {
                  const next = !brightnessLock;
                  setBrightnessLock(next);
                  if (!api || !canWrite) return;
                  void (async () => {
                    const r = await api.sysfsWrite("brightness_lock", next ? "1" : "0");
                    if (!r.ok) {
                      setBrightnessLock(!next);
                      setAnimHint(r.error ?? "Could not set brightness lock.");
                      return;
                    }
                    setAnimHint(null);
                    window.setTimeout(() => void applyLightingFromSysfs(), 150);
                  })();
                }}
              >
                <span className="switch__knob" />
              </button>
            </div>
          </div>

          {animMode === "gradient" ? (
            <p className="lighting-anim-card__note">Gradient uses the colors already on the keyboard.</p>
          ) : null}
        </div>
      </div>

      <footer className="light-footer">
        <button type="button" className="linkish" onClick={() => restoreDefaults()}>
          Reset lights
        </button>
        <div className="light-footer__btns">
          <button type="button" className="btn-outline" onClick={() => void discardChanges()}>
            Undo
          </button>
          <button type="button" className="btn-primary" onClick={() => void applyToKeyboard()} disabled={!api || !canWrite}>
            Apply to keyboard
          </button>
        </div>
      </footer>
    </section>
  );
}
