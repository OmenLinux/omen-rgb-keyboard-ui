const fs = require("fs");
const path = require("path");

const SYSFS_BASE = "/sys/devices/platform/omen-rgb-keyboard/rgb_zones";
const FAN_SYSFS = path.join(path.dirname(SYSFS_BASE), "fan");

const WRITABLE = new Set([
  "all",
  "brightness",
  "zone00",
  "zone01",
  "zone02",
  "zone03",
  "animation_mode",
  "animation_speed",
]);

const READABLE = new Set([
  "all",
  "brightness",
  "zone00",
  "zone01",
  "zone02",
  "zone03",
  "animation_mode",
  "animation_speed",
]);

const FAN_READABLE = new Set([
  "cpu_fan_rpm",
  "gpu_fan_rpm",
  "max_fan",
  "thermal_profile",
  "fan_curve",
  "fan_curve_enable",
  "fan_temp_zone",
]);

const FAN_WRITABLE = new Set([
  "max_fan",
  "thermal_profile",
  "fan_curve",
  "fan_curve_enable",
  "fan_temp_zone",
]);

function moduleLoaded() {
  try {
    const txt = fs.readFileSync("/proc/modules", "utf8");
    return txt.split("\n").some((line) => line.startsWith("omen_rgb_keyboard "));
  } catch {
    return false;
  }
}

function sysfsDirExists() {
  try {
    fs.accessSync(SYSFS_BASE, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function sysfsWritable() {
  const brightness = path.join(SYSFS_BASE, "brightness");
  try {
    fs.accessSync(brightness, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function fanSysfsPresent() {
  try {
    fs.accessSync(FAN_SYSFS, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function fanSysfsWritable() {
  if (!fanSysfsPresent()) return false;
  for (const p of FAN_WRITABLE) {
    try {
      fs.accessSync(path.join(FAN_SYSFS, p), fs.constants.W_OK);
      return true;
    } catch {}
  }
  return false;
}

function sysfsPath(relName) {
  const target = path.resolve(path.join(SYSFS_BASE, relName));
  const base = path.resolve(SYSFS_BASE);
  if (!target.startsWith(base + path.sep) && target !== base) {
    return null;
  }
  return target;
}

function fanSysfsPath(rel) {
  if (typeof rel !== "string" || !/^[a-z0-9_]+$/i.test(rel)) return null;
  const target = path.resolve(path.join(FAN_SYSFS, rel));
  const base = path.resolve(FAN_SYSFS);
  if (!target.startsWith(base + path.sep) && target !== base) return null;
  return target;
}

function getDriverStatus() {
  const platform = process.platform;
  if (platform !== "linux") {
    return {
      platform,
      supported: false,
      sysfsReady: false,
      sysfsWritable: false,
      fanSysfsReady: false,
      fanSysfsWritable: false,
      moduleLoaded: false,
      message:
        "The OMEN RGB keyboard driver (omen-rgb-keyboard) is Linux-only. Other controls still work here; lighting sync needs Linux with the driver installed.",
    };
  }

  const rgbReady = sysfsDirExists();
  const fanReady = fanSysfsPresent();
  const loaded = moduleLoaded();
  const rgbWritable = rgbReady && sysfsWritable();
  const fanWritable = fanSysfsWritable();

  const rgbOk = !rgbReady || rgbWritable;
  const fanOk = !fanReady || fanWritable;

  let message;
  if (!rgbReady && !fanReady) {
    message =
      "Kernel driver not detected. Install omen-rgb-keyboard from GitHub (OmenLinux/omen-rgb-keyboard); status updates automatically when it is available.";
  } else if (!rgbOk || !fanOk) {
    message =
      "Driver sysfs is present but not writable from this user. Run install-udev-rules.sh from the driver repo or use sudo for writes.";
  } else if (rgbReady && fanReady) {
    message = "RGB and fan sysfs ready.";
  } else if (rgbReady) {
    message = "RGB keyboard driver ready.";
  } else {
    message = "Fan sysfs ready (RGB zones not detected).";
  }

  return {
    platform,
    supported: true,
    sysfsReady: rgbReady,
    sysfsWritable: rgbWritable,
    fanSysfsReady: fanReady,
    fanSysfsWritable: fanWritable,
    moduleLoaded: loaded,
    message,
  };
}

function trySysfsWrite(relName, value) {
  if (typeof relName !== "string" || !relName) {
    return { ok: false, error: "Invalid sysfs target" };
  }

  if (relName.startsWith("fan/")) {
    const rel = relName.slice(4);
    if (!FAN_WRITABLE.has(rel)) {
      return { ok: false, error: "Invalid fan sysfs target" };
    }
    const target = fanSysfsPath(rel);
    if (!target) {
      return { ok: false, error: "Invalid path" };
    }
    try {
      fs.writeFileSync(target, String(value), { encoding: "utf8", flag: "w" });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  }

  if (!WRITABLE.has(relName)) {
    return { ok: false, error: "Invalid sysfs target" };
  }
  const target = sysfsPath(relName);
  if (!target) {
    return { ok: false, error: "Invalid path" };
  }
  try {
    fs.writeFileSync(target, String(value), { encoding: "utf8", flag: "w" });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

function trySysfsRead(relName) {
  if (typeof relName !== "string" || !relName) {
    return { ok: false, error: "Invalid sysfs target" };
  }

  if (relName.startsWith("fan/")) {
    const rel = relName.slice(4);
    if (!FAN_READABLE.has(rel)) {
      return { ok: false, error: "Invalid fan sysfs target" };
    }
    const target = fanSysfsPath(rel);
    if (!target) {
      return { ok: false, error: "Invalid path" };
    }
    try {
      const value = fs.readFileSync(target, { encoding: "utf8" }).trim();
      return { ok: true, value };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  }

  if (!READABLE.has(relName)) {
    return { ok: false, error: "Invalid sysfs target" };
  }
  const target = sysfsPath(relName);
  if (!target) {
    return { ok: false, error: "Invalid path" };
  }
  try {
    const value = fs.readFileSync(target, { encoding: "utf8" }).trim();
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

module.exports = {
  SYSFS_BASE,
  FAN_SYSFS,
  getDriverStatus,
  trySysfsWrite,
  trySysfsRead,
};
