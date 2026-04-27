export type MeterHeat = "green" | "yellow" | "orange" | "red";

export function meterClass(h: MeterHeat): string {
  return `meter--${h}`;
}

export function tempHeatFromC(c: number): MeterHeat {
  if (c < 58) return "green";
  if (c < 72) return "yellow";
  if (c < 86) return "orange";
  return "red";
}

export function tempHeatFromF(f: number): MeterHeat {
  const c = ((f - 32) * 5) / 9;
  return tempHeatFromC(c);
}

export function utilHeat(pct: number): MeterHeat {
  if (pct < 40) return "green";
  if (pct < 65) return "yellow";
  if (pct < 88) return "orange";
  return "red";
}

export function fillHeat(pct: number): MeterHeat {
  return utilHeat(pct);
}

export function formatTempFromC(celsius: number, useCelsius: boolean): string {
  if (useCelsius) return `${Math.round(celsius)}°C`;
  return `${Math.round((celsius * 9) / 5 + 32)}°F`;
}

export function formatTempMaybeC(c: number | null | undefined, useCelsius: boolean): string {
  if (c == null || !Number.isFinite(c)) return "—";
  return formatTempFromC(c, useCelsius);
}

export function tempHeatMaybeC(c: number | null | undefined): MeterHeat {
  if (c == null || !Number.isFinite(c)) return "green";
  return tempHeatFromC(c);
}
