const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const MODES = new Set(["nvidia", "integrated", "hybrid"]);
const REPO_URL = "https://github.com/Askannz/optimus-manager";

function which(bin) {
  const r = spawnSync("which", [bin], { encoding: "utf8" });
  if (r.status !== 0) return null;
  const p = (r.stdout || "").trim();
  return p || null;
}

function scrubOptimusCliNoise(text) {
  // optimus-manager probes init systems with bare `which …`, which pollutes stdout/stderr.
  return String(text || "")
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (/^which:\s+no\s+\S+\s+in\s+/i.test(t)) return false;
      // successful `which systemctl` → "/usr/bin/systemctl"
      if (/^\/\S+\/(systemctl|sv|rc-status|s6-svstat|openrc|service)$/i.test(t)) return false;
      if (/^\/usr\/bin\/systemctl$/i.test(t)) return false;
      return true;
    })
    .join("\n")
    .trim();
}

/** @deprecated use scrubOptimusCliNoise */
function scrubWhichNoise(text) {
  return scrubOptimusCliNoise(text);
}

function pickMeaningfulCliText(...chunks) {
  for (const chunk of chunks) {
    const cleaned = scrubOptimusCliNoise(chunk);
    if (!cleaned) continue;
    const line = cleaned
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !/^\/\S+$/.test(l));
    if (line) return cleaned;
  }
  return "";
}

function run(bin, args, opts = {}) {
  const r = spawnSync(bin, args, {
    encoding: "utf8",
    timeout: opts.timeout ?? 8000,
    env: { ...process.env, ...(opts.env || {}) },
  });
  const stdout = scrubOptimusCliNoise(r.stdout);
  const stderr = scrubOptimusCliNoise(r.stderr);
  return {
    ok: r.status === 0,
    status: r.status,
    stdout,
    stderr,
    error: r.error ? String(r.error.message || r.error) : null,
  };
}

function parseModeToken(raw) {
  const t = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (MODES.has(t)) return t;
  return null;
}

function isHybridOffloadWarning(text) {
  return /Hybrid mode doesn't work:\s*the Nvidia card is unavailable for offloading/i.test(
    String(text || ""),
  );
}

function scrubHybridOffloadWarning(text) {
  return String(text || "")
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (/Hybrid mode doesn't work:\s*the Nvidia card is unavailable for offloading/i.test(t)) {
        return false;
      }
      // Companion line printed by optimus-manager after the offload warning.
      if (/^Log at:\s*\/var\/log\/optimus-manager\/switch\//i.test(t)) return false;
      return true;
    })
    .join("\n")
    .trim();
}

/** nvidia-smi sees the GPU — real userspace driver, not just kernel modules. */
function nvidiaUserspaceReady() {
  const r = run("nvidia-smi", ["-L"], { timeout: 5000 });
  if (r.ok && /GPU\s+\d+:/i.test(r.stdout)) return true;
  return false;
}

/**
 * optimus-manager's offload check is `xrandr --listproviders` looking for NVIDIA-G0.
 * That only works on X11. On Wayland (Xwayland) providers is often 0 even when PRIME
 * offload works fine via __NV_PRIME_RENDER_OFFLOAD.
 */
function hybridOffloadWarningIsBenign({ sessionType, nvidiaOn, nvidiaReady }) {
  if (sessionType === "wayland" && (nvidiaReady || nvidiaOn)) return true;
  return false;
}

function extractModeFromText(text) {
  const cleaned = scrubHybridOffloadWarning(text);
  const lines = String(cleaned || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    // Ignore prose that mentions "hybrid mode" (the false-positive offload warning).
    if (/doesn't work|unavailable for offloading/i.test(line)) continue;
    const m =
      /(?:current\s*mode|current\s*gpu\s*mode|mode for next login|requested\s*mode|gpu\s*mode)\s*[:=]\s*(nvidia|integrated|hybrid|current)/i.exec(
        line,
      ) || /^(nvidia|integrated|hybrid)$/i.exec(line);
    if (m) {
      if (/^current$/i.test(m[1])) continue;
      return parseModeToken(m[1]);
    }
  }
  return parseModeToken(lines[0] || "");
}

function daemonActive() {
  const r = run("systemctl", ["is-active", "optimus-manager.service"]);
  if (r.ok && r.stdout === "active") return true;
  const r2 = run("systemctl", ["is-active", "optimus-manager"]);
  return r2.ok && r2.stdout === "active";
}

function getDisplayManagerName() {
  try {
    const link = "/etc/systemd/system/display-manager.service";
    if (!fs.existsSync(link)) return null;
    const target = fs.realpathSync(link);
    return path.basename(target, ".service") || null;
  } catch {
    return null;
  }
}

/** Arch's gdm-prime package; on Fedora we install /etc/gdm/Prime ourselves. */
function usingPatchedGdm() {
  return fs.existsSync("/etc/gdm/Prime") || fs.existsSync("/etc/gdm3/Prime");
}

function needsGdmPrimeHooks() {
  const dm = getDisplayManagerName();
  if (dm !== "gdm" && dm !== "gdm3") return false;
  return !usingPatchedGdm();
}

function getOptimusStatus() {
  if (process.platform !== "linux") {
    return {
      platform: process.platform,
      installed: false,
      daemonActive: false,
      currentMode: null,
      nextMode: null,
      message: "GPU switching with optimus-manager is only available on Linux.",
      repoUrl: REPO_URL,
    };
  }

  const bin = which("optimus-manager") || which("/usr/local/bin/optimus-manager");
  if (!bin) {
    // setuptools may install under /usr/local/bin which is sometimes missing from Electron PATH
    const local = "/usr/local/bin/optimus-manager";
    if (fs.existsSync(local)) {
      return statusFromBin(local);
    }
    return {
      platform: "linux",
      installed: false,
      daemonActive: false,
      currentMode: null,
      nextMode: null,
      message: "optimus-manager is not installed yet.",
      repoUrl: REPO_URL,
    };
  }

  return statusFromBin(bin);
}

function readLsmod() {
  const r = run("lsmod", []);
  return r.ok ? r.stdout : "";
}

function nvidiaModulesLoaded(lsmodText) {
  const text = lsmodText ?? readLsmod();
  // Match the real proprietary module line ("nvidia  123...") — not only nvidia_*.
  return /(^|\n)nvidia\s+/m.test(text) || /(^|\n)nvidia_modeset\s+/m.test(text);
}

function nouveauLoaded(lsmodText) {
  const text = lsmodText ?? readLsmod();
  return /(^|\n)nouveau\s+/m.test(text);
}

function proprietaryNvidiaPresent() {
  if (fs.existsSync("/proc/driver/nvidia/version")) return true;
  const rpm = run("rpm", ["-q", "akmod-nvidia"]);
  if (rpm.ok) return true;
  const rpm2 = run("rpm", ["-q", "xorg-x11-drv-nvidia"]);
  if (rpm2.ok) return true;
  const rpm3 = run("rpm", ["-q", "kmod-nvidia"]);
  return rpm3.ok;
}

const STATE_FILE = "/var/lib/optimus-manager/tmp/state.json";
const XORG_CONF = "/etc/X11/xorg.conf.d/10-optimus-manager.conf";

function loadOptimusStateFile() {
  try {
    if (!fs.existsSync(STATE_FILE)) return null;
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function inferModeFromXorgConf() {
  try {
    if (!fs.existsSync(XORG_CONF)) return null;
    const text = fs.readFileSync(XORG_CONF, "utf8");
    if (/AllowNVIDIAGPUScreens/i.test(text)) return "hybrid";
    if (/Inactive\s+"nvidia"/i.test(text)) return "hybrid";
    if (/Driver\s+"nvidia"/i.test(text) && /Screen\s+0\s+"nvidia"/i.test(text)) return "nvidia";
    if (/Driver\s+"modesetting"|Driver\s+"intel"|Driver\s+"amdgpu"/i.test(text)) return "integrated";
  } catch {
    /* ignore */
  }
  return null;
}

function interpretModeCommandOutput(stdout, stderr) {
  const raw = `${stdout || ""}\n${stderr || ""}`.trim();
  if (!raw) return { mode: null, setupError: null, hybridOffloadWarning: false };
  const hybridOffloadWarning = isHybridOffloadWarning(raw);
  const text = scrubHybridOffloadWarning(raw);
  if (/GPU setup failed|Xorg pre-start hook failed|Xorg post-start hook/i.test(text)) {
    let setupError = text.split("\n")[0] || text;
    if (/post-start hook did not run/i.test(text)) {
      // Not a driver failure — GNOME Wayland never runs the Xorg post hook.
      setupError =
        "optimus-manager is stuck waiting for an Xorg hook that GNOME Wayland never runs. Tap “Repair GPU state” to finish.";
    } else if (/Failed to unload modules: \['nouveau'\]|modprobe -r nouveau/i.test(text)) {
      setupError =
        "Couldn’t unload nouveau. If NVIDIA is already installed, reboot once; otherwise install proprietary drivers.";
    } else if (/Xorg pre-start hook failed/i.test(text)) {
      setupError = "GPU setup failed during Xorg pre-start. Check the optimus-manager switch log.";
    }
    return { mode: extractModeFromText(text), setupError, hybridOffloadWarning };
  }
  return { mode: extractModeFromText(text), setupError: null, hybridOffloadWarning };
}

function readLastSwitchFailure(opts = {}) {
  const { nvidiaOn = false, nouveauOn = false } = opts;
  const dir = "/var/log/optimus-manager/switch";
  try {
    if (!fs.existsSync(dir)) return null;
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("switch-") && f.endsWith(".log"))
      .sort();
    if (!files.length) return null;
    const latest = path.join(dir, files[files.length - 1]);
    const text = fs.readFileSync(latest, "utf8");

    // Successful pre-start is not a failure — ignore even if older logs failed.
    if (/Xorg pre-start hook completed/i.test(text) && !/ERROR:/i.test(text)) {
      return null;
    }

    if (
      /pre_xorg_start_failed|Xorg pre-start hook failed|KernelSetupError|post-start hook did not run/i.test(
        text,
      )
    ) {
      let reason = "GPU setup failed.";
      const nouveauUnload =
        /Failed to unload modules: \['nouveau'\]|modprobe -r nouveau/i.test(text);
      // Don't keep blaming nouveau if it's gone and NVIDIA is loaded now.
      if (nouveauUnload && nouveauOn && !nvidiaOn) {
        reason =
          "Couldn’t unload nouveau. Install proprietary NVIDIA drivers, then reboot.";
      } else if (nouveauUnload && nvidiaOn && !nouveauOn) {
        return null; // stale — already fixed by driver install + reboot
      } else if (/post-start hook did not run/i.test(text) || /pending_post_xorg_start/i.test(text)) {
        reason =
          "Display hook didn’t finish after the switch. Log out (or reboot), then open Graphics again.";
      } else if (/Xorg pre-start hook failed/i.test(text)) {
        reason = "Xorg pre-start hook failed. See the optimus-manager switch log.";
      }
      return { logPath: latest, reason, snippet: text.slice(-1200) };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function friendlySetupMessage({
  active,
  currentMode,
  nvidiaOk,
  nvidiaOn,
  nouveauOn,
  setupError,
  failure,
  sessionType,
  stuckPendingPost,
  hybridOffloadWarning,
  hybridOffloadBenign,
  nvidiaReady,
  needsGdmPrime,
}) {
  if (!active) return "optimus-manager is installed, but its service is not running.";
  if (!nvidiaOk && nouveauOn) {
    return "Still on nouveau. Install proprietary NVIDIA drivers, then reboot.";
  }
  if (!nvidiaOk && !nvidiaOn) {
    return "NVIDIA kernel modules aren’t loaded yet. If you just installed drivers, reboot.";
  }
  if (nouveauOn && nvidiaOn) {
    return "Both nvidia and nouveau are loaded — reboot to finish cleaning up nouveau.";
  }
  if (needsGdmPrime) {
    return "GDM needs Prime hooks (Fedora has no gdm-prime package). Tap “Install GDM Prime hooks” so mode switching works.";
  }
  if (stuckPendingPost) {
    return "GPU mode is applied, but GNOME Wayland never runs the Xorg finish hook — so optimus-manager stays stuck. Tap “Repair GPU state”.";
  }
  if (setupError) return setupError;
  if (failure) return failure.reason;
  if (hybridOffloadWarning && !hybridOffloadBenign) {
    return "Hybrid offload isn’t visible to X11 (no NVIDIA-G0 provider). Try Performance mode, or log in with GNOME on Xorg.";
  }
  if (!currentMode) {
    if (sessionType === "wayland") {
      return "Mode isn’t reported cleanly on Wayland yet. You can still pick a mode.";
    }
    return "Could not read the current GPU mode.";
  }
  return "Ready";
}

function statusFromBin(bin) {
  const active = daemonActive();
  const printMode = run(bin, ["--print-mode"]);
  const printNext = run(bin, ["--print-next-mode"]);
  const statusDump = run(bin, ["--status"]);
  const fileState = loadOptimusStateFile();

  const modeInfo = interpretModeCommandOutput(printMode.stdout, printMode.stderr);
  const statusInfo = interpretModeCommandOutput(statusDump.stdout, statusDump.stderr);
  let currentMode = modeInfo.mode || statusInfo.mode;
  let nextMode = extractModeFromText(printNext.stdout);

  const stuckPendingPost =
    fileState?.type === "pending_post_xorg_start" ||
    /post-start hook did not run/i.test(`${printMode.stdout}\n${printMode.stderr}`);

  // Prefer real state / xorg.conf over the scary CLI error string.
  if (!currentMode && fileState?.type === "done" && MODES.has(fileState.current_mode)) {
    currentMode = fileState.current_mode;
  }
  if (!currentMode && stuckPendingPost && MODES.has(fileState?.requested_mode)) {
    currentMode = fileState.requested_mode;
  }
  if (!currentMode) currentMode = inferModeFromXorgConf();

  if (!nextMode && fileState?.requested_mode && MODES.has(fileState.requested_mode)) {
    nextMode = fileState.requested_mode;
  }
  if (!nextMode) nextMode = currentMode;

  const lsmodText = readLsmod();
  const nvidiaOn = nvidiaModulesLoaded(lsmodText);
  const nouveauOn = nouveauLoaded(lsmodText);
  const nvidiaPkg = proprietaryNvidiaPresent();
  const nvidiaOk = nvidiaOn || nvidiaPkg;
  const nvidiaReady = nvidiaUserspaceReady();
  const failure = stuckPendingPost ? null : readLastSwitchFailure({ nvidiaOn, nouveauOn });
  const needsNvidiaSetup = !nvidiaOn && (nouveauOn || !nvidiaPkg);
  const sessionType = process.env.XDG_SESSION_TYPE || null;
  const hybridOffloadWarning =
    modeInfo.hybridOffloadWarning ||
    statusInfo.hybridOffloadWarning ||
    isHybridOffloadWarning(`${printMode.stdout}\n${statusDump.stdout}`);
  const hybridOffloadBenign = hybridOffloadWarningIsBenign({
    sessionType,
    nvidiaOn,
    nvidiaReady,
  });
  const needsGdmPrime = needsGdmPrimeHooks();
  const setupError = stuckPendingPost
    ? "optimus-manager is stuck waiting for an Xorg hook that GNOME Wayland never runs. Tap “Repair GPU state”."
    : modeInfo.setupError;

  const message = friendlySetupMessage({
    active,
    currentMode,
    nvidiaOk,
    nvidiaOn,
    nouveauOn,
    setupError,
    failure,
    sessionType,
    stuckPendingPost,
    hybridOffloadWarning,
    hybridOffloadBenign,
    nvidiaReady,
    needsGdmPrime,
  });

  const rawCombined = statusDump.ok ? statusDump.stdout : printMode.stdout || null;
  const rawStatus =
    hybridOffloadBenign && rawCombined
      ? scrubHybridOffloadWarning(rawCombined) || rawCombined
      : rawCombined;

  return {
    platform: "linux",
    installed: true,
    daemonActive: active,
    currentMode,
    nextMode,
    message,
    repoUrl: REPO_URL,
    rawStatus,
    nvidiaDriverOk: nvidiaOk,
    nvidiaModulesLoaded: nvidiaOn,
    nvidiaUserspaceReady: nvidiaReady,
    nouveauLoaded: nouveauOn,
    needsNvidiaSetup,
    needsGdmPrime,
    displayManager: getDisplayManagerName(),
    lastFailure: failure,
    sessionType,
    setupError,
    stuckPendingPost,
    stateType: fileState?.type || null,
    hybridOffloadWarning: Boolean(hybridOffloadWarning),
    hybridOffloadBenign: Boolean(hybridOffloadWarning && hybridOffloadBenign),
  };
}

function explainSwitchFailure(raw, status) {
  let text = scrubOptimusCliNoise(raw);
  if (status?.hybridOffloadBenign || status?.sessionType === "wayland") {
    text = scrubHybridOffloadWarning(text);
  }
  if (!text || /^\/\S+$/.test(text.trim())) {
    if (status?.stuckPendingPost) {
      return "Mode switch needs a state repair on GNOME Wayland. Tap “Repair GPU state”, then try again.";
    }
    return "Switch failed.";
  }
  if (isHybridOffloadWarning(text) && status?.hybridOffloadBenign) {
    return "Hybrid is active. The X11 offload warning on Wayland is a false alarm — NVIDIA is available for apps.";
  }
  if (/Not properly installed:\s*gdm-prime/i.test(text) || status?.needsGdmPrime) {
    return "Fedora’s GDM isn’t Arch’s gdm-prime. Tap “Install GDM Prime hooks”, then try switching again.";
  }
  if (/post-start hook did not run/i.test(text) || status?.stuckPendingPost) {
    return "Mode switch needs a state repair on GNOME Wayland. Tap “Repair GPU state”, then try again if needed.";
  }
  if (status?.nouveauLoaded && !status?.nvidiaModulesLoaded) {
    return "GPU setup failed because nouveau is still in control. Install proprietary NVIDIA drivers, then reboot.";
  }
  if (/Failed to unload modules: \['nouveau'\]|modprobe -r nouveau/i.test(text)) {
    if (status?.nvidiaModulesLoaded) {
      return "Stale nouveau unload error — NVIDIA is already loaded. Repair GPU state, then try again.";
    }
    return "Couldn’t unload nouveau. Install proprietary NVIDIA drivers, then reboot.";
  }
  if (/GPU setup failed|Xorg pre-start hook failed/i.test(text)) {
    return text.split("\n").map((l) => l.trim()).find(Boolean) || "GPU setup failed.";
  }
  return (
    text
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !/^\/\S+$/.test(l)) || "Switch failed."
  );
}

async function repairOptimusState() {
  if (process.platform !== "linux") {
    return { ok: false, error: "Linux only.", repoUrl: REPO_URL };
  }
  let scriptPath;
  try {
    scriptPath = copyScriptToTmp("repair-optimus-state.sh");
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e), repoUrl: REPO_URL };
  }
  const r = await runPkexecScriptAsync(scriptPath, 120000);
  if (!r.ok) {
    return {
      ok: false,
      error: r.error || "Could not repair GPU state.",
      repoUrl: REPO_URL,
      log: [r.stdout, r.stderr].filter(Boolean).join("\n") || null,
      status: getOptimusStatus(),
    };
  }
  return {
    ok: true,
    method: "pkexec",
    repoUrl: REPO_URL,
    log: r.stdout || null,
    status: getOptimusStatus(),
    message: "GPU state repaired. You can switch modes again.",
  };
}

function switchLooksSuccessful(result, mode) {
  const out = `${result.stdout}\n${result.stderr}`;
  if (/Switching to mode\s*:\s*/i.test(out)) return true;
  if (result.ok) return true;
  // Logout can kill the client mid-flight after the daemon already accepted the switch.
  if (/The change will apply on next login/i.test(out)) return true;
  // Wayland: only the X11 offload false-alarm left in CLI output after a hybrid switch.
  const scrubbed = scrubHybridOffloadWarning(scrubOptimusCliNoise(out));
  if (!scrubbed && isHybridOffloadWarning(out)) {
    const state = loadOptimusStateFile();
    if (state?.type === "done" && state.current_mode === mode) return true;
    if (state?.requested_mode === mode) return true;
  }
  const state = loadOptimusStateFile();
  if (state?.requested_mode === mode && /pending_/i.test(state.type || "")) return true;
  if (state?.type === "done" && state.current_mode === mode) return true;
  return false;
}

async function ensureAutoLogoutDisabled() {
  const conf = "/etc/optimus-manager/optimus-manager.conf";
  try {
    if (!fs.existsSync(conf)) return;
    const text = fs.readFileSync(conf, "utf8");
    if (/^auto_logout\s*=\s*no\s*$/m.test(text)) return;
  } catch {
    /* need root to fix */
  }
  // Best-effort via the repair script (also sets auto_logout=no).
  await repairOptimusState();
}

async function switchOptimusMode(mode, { noConfirm = true } = {}) {
  const m = parseModeToken(mode);
  if (!m) return { ok: false, error: "Pick integrated, hybrid, or nvidia." };

  let status = getOptimusStatus();
  if (!status.installed) {
    return { ok: false, error: "Install optimus-manager first.", needsInstall: true };
  }

  if ((m === "nvidia" || m === "hybrid") && status.needsNvidiaSetup) {
    return {
      ok: false,
      error:
        "NVIDIA modules aren’t active yet. Use “Fix NVIDIA setup” if drivers are missing, then reboot.",
      needsNvidiaSetup: true,
      status,
    };
  }

  if (status.needsGdmPrime) {
    return {
      ok: false,
      error:
        "Fedora’s GDM isn’t Arch’s gdm-prime. Tap “Install GDM Prime hooks” first, then switch again.",
      needsGdmPrime: true,
      status,
    };
  }

  // Clear a stuck pending_post before switching, otherwise the client keeps erroring.
  if (status.stuckPendingPost) {
    const repaired = await repairOptimusState();
    if (!repaired.ok) {
      return {
        ok: false,
        error: repaired.error || "Repair the stuck GPU state first.",
        needsStateRepair: true,
        status: repaired.status || status,
      };
    }
    status = repaired.status || getOptimusStatus();
  } else {
    // Avoid optimus-manager’s auto-logout path (noisy + rough on Wayland).
    await ensureAutoLogoutDisabled();
  }

  const bin = which("optimus-manager") || "/usr/local/bin/optimus-manager";
  if (!fs.existsSync(bin) && !which("optimus-manager")) {
    return { ok: false, error: "optimus-manager not found.", needsInstall: true };
  }

  const args = ["--switch", m];
  if (noConfirm) args.push("--no-confirm");

  const r = run(which("optimus-manager") || bin, args, { timeout: 20000 });
  const accepted = switchLooksSuccessful(r, m);

  // On Wayland, pre-start often succeeds and leaves pending_post — finalize it.
  await new Promise((res) => setTimeout(res, 800));
  let after = getOptimusStatus();
  if (after.stuckPendingPost || /post-start hook did not run/i.test(`${r.stdout}\n${r.stderr}`)) {
    const repaired = await repairOptimusState();
    if (repaired.ok) {
      return {
        ok: true,
        mode: m,
        status: repaired.status || getOptimusStatus(),
        repairedState: true,
        message: `Switched to ${m}. Log out once if the desktop still looks wrong.`,
      };
    }
  }

  if (!accepted) {
    const next = getOptimusStatus();
    const cleaned = pickMeaningfulCliText(r.stderr, r.stdout, r.error);
    return {
      ok: false,
      error: explainSwitchFailure(cleaned, next),
      needsNvidiaSetup: next.needsNvidiaSetup,
      needsGdmPrime: next.needsGdmPrime || /Not properly installed:\s*gdm-prime/i.test(cleaned),
      needsStateRepair: next.stuckPendingPost,
      status: next,
    };
  }

  after = getOptimusStatus();
  return {
    ok: true,
    mode: m,
    status: after,
    message: `Switched to ${m}. Log out once if the desktop still looks wrong.`,
  };
}

async function fixOptimusSetup() {
  if (process.platform !== "linux") {
    return { ok: false, error: "Linux only.", repoUrl: REPO_URL };
  }
  let scriptPath;
  try {
    scriptPath = copyScriptToTmp("fix-optimus-setup.sh");
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e), repoUrl: REPO_URL };
  }
  const r = await runPkexecScriptAsync(scriptPath, 900000);
  if (!r.ok) {
    return {
      ok: false,
      error: r.error || "NVIDIA setup failed or the password prompt was cancelled.",
      repoUrl: REPO_URL,
      log: [r.stdout, r.stderr].filter(Boolean).join("\n") || null,
      status: getOptimusStatus(),
    };
  }
  return {
    ok: true,
    method: "pkexec",
    rebootRequired: true,
    repoUrl: REPO_URL,
    log: r.stdout || null,
    status: getOptimusStatus(),
    message: "NVIDIA drivers installed. Reboot, then come back to Graphics.",
  };
}

async function fixGdmPrime() {
  if (process.platform !== "linux") {
    return { ok: false, error: "Linux only.", repoUrl: REPO_URL };
  }
  let scriptPath;
  try {
    scriptPath = copyScriptToTmp("fix-gdm-prime.sh");
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e), repoUrl: REPO_URL };
  }
  const r = await runPkexecScriptAsync(scriptPath, 120000);
  if (!r.ok) {
    return {
      ok: false,
      error: r.error || "Could not install GDM Prime hooks.",
      repoUrl: REPO_URL,
      log: [r.stdout, r.stderr].filter(Boolean).join("\n") || null,
      status: getOptimusStatus(),
    };
  }
  return {
    ok: true,
    method: "pkexec",
    repoUrl: REPO_URL,
    log: r.stdout || null,
    status: getOptimusStatus(),
    message: "GDM Prime hooks installed. You can switch GPU modes now.",
  };
}

function copyScriptToTmp(filename) {
  const scriptsDir = path.join(__dirname, "scripts");
  // Copy the whole scripts folder so installers can call sibling helpers
  // (e.g. install-optimus.sh → fix-gdm-prime.sh) from the same directory.
  const destDir = path.join(os.tmpdir(), "omen-ui-optimus-scripts");
  try {
    fs.mkdirSync(destDir, { recursive: true });
  } catch {
    /* ignore */
  }
  let names = [];
  try {
    names = fs.readdirSync(scriptsDir).filter((n) => n.endsWith(".sh"));
  } catch {
    names = [filename];
  }
  if (!names.includes(filename)) names.push(filename);
  for (const name of names) {
    const src = path.join(scriptsDir, name);
    const dest = path.join(destDir, name);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, dest);
    try {
      fs.chmodSync(dest, 0o755);
    } catch {
      /* ignore */
    }
  }
  const primary = path.join(destDir, filename);
  if (!fs.existsSync(primary)) {
    throw new Error(`Missing helper script: ${filename}`);
  }
  return primary;
}

function pkexecEnv() {
  return {
    ...process.env,
    PATH: `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:${process.env.PATH || ""}`,
    DISPLAY: process.env.DISPLAY || ":0",
    XAUTHORITY: process.env.XAUTHORITY || path.join(os.homedir(), ".Xauthority"),
    WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY,
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
    DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS,
  };
}

function runPkexecScriptAsync(scriptPath, timeoutMs = 600000) {
  return new Promise((resolve) => {
    const pk = which("pkexec");
    if (!pk) {
      resolve({ ok: false, error: "pkexec is required for the password prompt." });
      return;
    }

    const child = spawn(pk, ["bash", scriptPath], {
      env: pkexecEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {}
      finish({ ok: false, error: "Timed out waiting for the install / password prompt." });
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", (e) => {
      finish({ ok: false, error: e && e.message ? e.message : String(e) });
    });
    child.on("close", (code) => {
      if (code === 0) {
        finish({ ok: true, method: "pkexec", stdout: stdout.trim(), stderr: stderr.trim() });
        return;
      }
      const err =
        stderr.trim() ||
        stdout.trim() ||
        (code == null ? "Password prompt cancelled." : `Installer exited with code ${code}.`);
      finish({ ok: false, error: err, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

async function enableOptimusService() {
  if (process.platform !== "linux") return { ok: false, error: "Linux only." };
  try {
    const dest = path.join(os.tmpdir(), "omen-ui-optimus-enable.sh");
    fs.writeFileSync(
      dest,
      `#!/usr/bin/env bash
set -euo pipefail
systemctl daemon-reload
systemctl enable --now optimus-manager.service 2>/dev/null \\
  || systemctl enable --now optimus-manager
`,
      { mode: 0o755 },
    );
    return await runPkexecScriptAsync(dest, 120000);
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

function installWithAurHelper(bin) {
  const r = run(bin, ["-S", "--needed", "--noconfirm", "optimus-manager-git"], {
    timeout: 900000,
  });
  if (r.ok) return { ok: true, method: path.basename(bin) };
  const r2 = run(bin, ["-S", "--needed", "--noconfirm", "optimus-manager"], {
    timeout: 900000,
  });
  if (r2.ok) return { ok: true, method: path.basename(bin) };
  return {
    ok: false,
    error: r2.stderr || r.stderr || r2.stdout || r.stdout || `${bin} install failed.`,
    method: path.basename(bin),
  };
}

async function installOptimusManager() {
  if (process.platform !== "linux") {
    return { ok: false, error: "Linux only.", repoUrl: REPO_URL };
  }

  if (getOptimusStatus().installed) {
    const en = await enableOptimusService();
    if (!en.ok) {
      return {
        ok: false,
        error: en.error || "Installed, but could not enable the service.",
        repoUrl: REPO_URL,
        status: getOptimusStatus(),
      };
    }
    return { ok: true, method: "already-installed", repoUrl: REPO_URL, status: getOptimusStatus() };
  }

  const yay = which("yay");
  const paru = which("paru");
  if (yay || paru) {
    const helper = yay || paru;
    const inst = installWithAurHelper(helper);
    if (!inst.ok) {
      return {
        ...inst,
        repoUrl: REPO_URL,
        suggestedCommand: `${path.basename(helper)} -S optimus-manager-git`,
      };
    }
    const en = await enableOptimusService();
    if (!en.ok) {
      return {
        ok: false,
        error: `Package installed, but enabling the service failed: ${en.error || "unknown"}`,
        repoUrl: REPO_URL,
        status: getOptimusStatus(),
      };
    }
    return { ok: true, method: inst.method, repoUrl: REPO_URL, status: getOptimusStatus() };
  }

  // Fedora / Debian / Arch without AUR helper: pkexec GUI install script (no terminal).
  let scriptPath;
  try {
    scriptPath = copyScriptToTmp("install-optimus.sh");
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e), repoUrl: REPO_URL };
  }

  const r = await runPkexecScriptAsync(scriptPath, 900000);
  if (!r.ok) {
    return {
      ok: false,
      error: r.error || "Install failed or the password prompt was cancelled.",
      repoUrl: REPO_URL,
      log: [r.stdout, r.stderr].filter(Boolean).join("\n") || null,
    };
  }

  const status = getOptimusStatus();
  if (!status.installed) {
    return {
      ok: false,
      error:
        "Installer finished, but optimus-manager still isn’t available. You may need a reboot, or check NVIDIA drivers.",
      repoUrl: REPO_URL,
      log: [r.stdout, r.stderr].filter(Boolean).join("\n") || null,
      status,
    };
  }

  return { ok: true, method: "pkexec", repoUrl: REPO_URL, status, log: r.stdout || null };
}

module.exports = {
  getOptimusStatus,
  switchOptimusMode,
  installOptimusManager,
  enableOptimusService,
  fixOptimusSetup,
  fixGdmPrime,
  repairOptimusState,
  REPO_URL,
};
