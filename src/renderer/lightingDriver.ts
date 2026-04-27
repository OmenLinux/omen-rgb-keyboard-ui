export const LIGHTING_ANIMATION_MODES = [
  { id: "static", label: "Static" },
  { id: "breathing", label: "Breathing" },
  { id: "rainbow", label: "Rainbow" },
  { id: "wave", label: "Wave" },
  { id: "pulse", label: "Pulse" },
  { id: "chase", label: "Chase" },
  { id: "sparkle", label: "Sparkle" },
  { id: "candle", label: "Candle" },
  { id: "aurora", label: "Aurora" },
  { id: "disco", label: "Disco" },
  { id: "gradient", label: "Gradient" },
] as const;

export type LightingAnimationModeId = (typeof LIGHTING_ANIMATION_MODES)[number]["id"];

export type LightingAnimUi = LightingAnimationModeId | "off";

export function isDriverAnimationMode(id: string): id is LightingAnimationModeId {
  return (LIGHTING_ANIMATION_MODES as readonly { id: string }[]).some((m) => m.id === id);
}

export function parseSysfsBrightness(raw: string | undefined): number {
  const n = parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(n)) return 100;
  return Math.min(100, Math.max(0, n));
}

export function parseSysfsAnimSpeed(raw: string | undefined): number {
  const n = parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(n)) return 5;
  return Math.min(10, Math.max(1, n));
}

export function sysfsToUiAnimMode(modeRaw: string | undefined, brightness0to100: number): LightingAnimUi {
  const br = Math.min(100, Math.max(0, Math.round(brightness0to100)));
  if (!Number.isFinite(br) || br === 0) return "off";
  const mode = String(modeRaw ?? "").trim().toLowerCase();
  if (isDriverAnimationMode(mode)) return mode;
  return "static";
}
