export const FAN_CHANGED = "omen-fan-changed";

export function notifyFanChanged() {
  window.dispatchEvent(new Event(FAN_CHANGED));
}
