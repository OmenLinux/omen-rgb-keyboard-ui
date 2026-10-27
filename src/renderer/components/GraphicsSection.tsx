import { useCallback, useEffect, useState } from "react";
import type { OptimusMode, OptimusStatus } from "../types";

type Props = {
  isActive: boolean;
  onToast?: (msg: string) => void;
};

const MODE_CARDS: {
  id: OptimusMode;
  title: string;
  blurb: string;
  detail: string;
}[] = [
  {
    id: "integrated",
    title: "Battery",
    blurb: "iGPU only",
    detail: "Best battery life. NVIDIA stays off.",
  },
  {
    id: "hybrid",
    title: "Hybrid",
    blurb: "iGPU + NVIDIA on demand",
    detail: "Desktop on iGPU. Games can use NVIDIA.",
  },
  {
    id: "nvidia",
    title: "Performance",
    blurb: "NVIDIA GPU",
    detail: "Full NVIDIA power. Uses more battery.",
  },
];

function modeLabel(mode: OptimusMode | null | undefined): string {
  if (mode === "integrated") return "Battery (iGPU)";
  if (mode === "hybrid") return "Hybrid";
  if (mode === "nvidia") return "Performance (NVIDIA)";
  return "Unknown";
}

type OptimusBridge = {
  getStatus: () => Promise<OptimusStatus>;
  switchMode: (mode: OptimusMode | string) => Promise<{
    ok: boolean;
    error?: string;
    mode?: OptimusMode;
    status?: OptimusStatus;
    needsInstall?: boolean;
  }>;
  install: () => Promise<{
    ok: boolean;
    method?: string;
    error?: string;
    repoUrl?: string;
    suggestedCommand?: string | null;
    status?: OptimusStatus;
    log?: string | null;
  }>;
  enableService: () => Promise<{ ok: boolean; method?: string; error?: string }>;
  fixSetup: () => Promise<{
    ok: boolean;
    method?: string;
    error?: string;
    repoUrl?: string;
    log?: string | null;
    status?: OptimusStatus;
    rebootRequired?: boolean;
    message?: string;
  }>;
  fixGdmPrime: () => Promise<{
    ok: boolean;
    method?: string;
    error?: string;
    repoUrl?: string;
    log?: string | null;
    status?: OptimusStatus;
    message?: string;
  }>;
  repairState: () => Promise<{
    ok: boolean;
    method?: string;
    error?: string;
    repoUrl?: string;
    log?: string | null;
    status?: OptimusStatus;
    message?: string;
  }>;
};

function missingApi(name: string) {
  return async () => ({
    ok: false as const,
    error: `Restart OMEN Control to load ${name}.`,
  });
}

function resolveOptimusBridge(): OptimusBridge | null {
  if (typeof window === "undefined") return null;
  if (window.omenOptimus?.getStatus && typeof window.omenOptimus.repairState === "function") {
    return {
      ...window.omenOptimus,
      fixSetup: window.omenOptimus.fixSetup || missingApi("NVIDIA setup"),
      fixGdmPrime: window.omenOptimus.fixGdmPrime || missingApi("GDM Prime hooks"),
      repairState: window.omenOptimus.repairState,
    };
  }
  const d = window.omenDriver;
  if (d?.optimusGetStatus && d.optimusSwitch && d.optimusInstall && d.optimusEnableService) {
    return {
      getStatus: () => d.optimusGetStatus!(),
      switchMode: (mode) => d.optimusSwitch!(mode),
      install: () => d.optimusInstall!(),
      enableService: () => d.optimusEnableService!(),
      fixSetup: d.optimusFixSetup ? () => d.optimusFixSetup!() : missingApi("NVIDIA setup"),
      fixGdmPrime: d.optimusFixGdmPrime
        ? () => d.optimusFixGdmPrime!()
        : missingApi("GDM Prime hooks"),
      repairState: d.optimusRepairState
        ? () => d.optimusRepairState!()
        : missingApi("GPU state repair"),
    };
  }
  if (window.omenOptimus?.getStatus) {
    return {
      ...window.omenOptimus,
      fixSetup: window.omenOptimus.fixSetup || missingApi("NVIDIA setup"),
      fixGdmPrime: window.omenOptimus.fixGdmPrime || missingApi("GDM Prime hooks"),
      repairState: window.omenOptimus.repairState || missingApi("GPU state repair"),
    };
  }
  return null;
}

export function GraphicsSection({ isActive, onToast }: Props) {
  const [api, setApi] = useState<OptimusBridge | null>(() => resolveOptimusBridge());
  const [status, setStatus] = useState<OptimusStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmMode, setConfirmMode] = useState<OptimusMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installLog, setInstallLog] = useState<string | null>(null);

  const inElectron = typeof window !== "undefined" && !!(window.omenShell || window.omenDriver);
  const platform = typeof window !== "undefined" ? window.omenShell?.platform : undefined;

  const toast = useCallback(
    (msg: string) => {
      onToast?.(msg);
    },
    [onToast],
  );

  useEffect(() => {
    setApi(resolveOptimusBridge());
  }, [isActive]);

  const refresh = useCallback(async () => {
    const bridge = resolveOptimusBridge();
    setApi(bridge);
    if (!bridge) {
      setStatus(null);
      return;
    }
    try {
      const next = await bridge.getStatus();
      setStatus(next);
    } catch (e) {
      // Keep a previous install error visible; only set if we have nothing.
      setError((prev) => prev || (e instanceof Error ? e.message : String(e)));
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;
    void refresh();
    const id = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(id);
  }, [isActive, refresh]);

  const onInstall = async () => {
    const bridge = resolveOptimusBridge();
    if (!bridge) return;
    setBusy(true);
    setError(null);
    setInstallLog(null);
    toast("Password prompt coming up — install runs in the background.");
    try {
      const r = await bridge.install();
      if (r.log) setInstallLog(r.log);
      if (!r.ok) {
        const hint = r.suggestedCommand ? `\n\nTry: ${r.suggestedCommand}` : "";
        setError((r.error ?? "Install failed.") + hint);
        toast("Install didn’t finish.");
      } else {
        setError(null);
        toast("optimus-manager is ready.");
        if (r.status) setStatus(r.status);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toast("Install didn’t finish.");
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const onEnableService = async () => {
    const bridge = resolveOptimusBridge();
    if (!bridge) return;
    setBusy(true);
    try {
      const r = await bridge.enableService();
      if (!r.ok) {
        setError(r.error ?? "Could not enable service.");
        toast("Couldn't enable the service.");
      } else {
        toast("Approve the password prompt to start optimus-manager.");
        window.setTimeout(() => void refresh(), 2000);
      }
    } finally {
      setBusy(false);
    }
  };

  const onFixNvidia = async () => {
    const bridge = resolveOptimusBridge();
    if (!bridge) return;
    setBusy(true);
    setError(null);
    setInstallLog(null);
    toast("Installing NVIDIA drivers… approve the password prompt.");
    try {
      const r = await bridge.fixSetup();
      if (r.log) setInstallLog(r.log);
      if (!r.ok) {
        setError(r.error ?? "NVIDIA setup failed.");
        toast("NVIDIA setup didn’t finish.");
      } else {
        setError(null);
        toast(r.message ?? "Reboot now, then open Graphics again.");
        if (r.status) setStatus(r.status);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toast("NVIDIA setup didn’t finish.");
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const onRepairState = async () => {
    const bridge = resolveOptimusBridge();
    if (!bridge) return;
    setBusy(true);
    setError(null);
    setInstallLog(null);
    toast("Repairing GPU state… approve the password prompt.");
    try {
      const r = await bridge.repairState();
      if (r.log) setInstallLog(r.log);
      if (!r.ok) {
        setError(r.error ?? "Could not repair GPU state.");
        toast("Repair didn’t finish.");
      } else {
        setError(null);
        toast(r.message ?? "GPU state repaired.");
        if (r.status) setStatus(r.status);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toast("Repair didn’t finish.");
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const onFixGdmPrime = async () => {
    const bridge = resolveOptimusBridge();
    if (!bridge) return;
    setBusy(true);
    setError(null);
    setInstallLog(null);
    toast("Installing GDM Prime hooks… approve the password prompt.");
    try {
      const r = await bridge.fixGdmPrime();
      if (r.log) setInstallLog(r.log);
      if (!r.ok) {
        setError(r.error ?? "Could not install GDM Prime hooks.");
        toast("GDM Prime install didn’t finish.");
      } else {
        setError(null);
        toast(r.message ?? "GDM Prime hooks installed.");
        if (r.status) setStatus(r.status);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toast("GDM Prime install didn’t finish.");
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const requestSwitch = (mode: OptimusMode) => {
    if (!status?.installed || busy) return;
    if (status.currentMode === mode) {
      toast(`Already on ${modeLabel(mode)}`);
      return;
    }
    setConfirmMode(mode);
  };

  const confirmSwitch = async () => {
    const bridge = resolveOptimusBridge();
    if (!bridge || !confirmMode) return;
    const mode = confirmMode;
    setConfirmMode(null);
    setBusy(true);
    setError(null);
    try {
      const r = await bridge.switchMode(mode);
      if (!r.ok) {
        setError(r.error ?? "Switch failed.");
        toast("Couldn't switch GPU mode.");
        if (r.status) setStatus(r.status);
        return;
      }
      if (r.status) setStatus(r.status);
      toast(`Switching to ${modeLabel(mode)} — you may be logged out.`);
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  if (!isActive) return null;

  const installed = status?.installed === true;
  const activeMode = status?.currentMode ?? null;

  let bridgeBanner: string | null = null;
  if (!api) {
    if (inElectron) {
      bridgeBanner = "GPU switching just landed — fully quit OMEN Control and open it again to load it.";
    } else if (platform && platform !== "linux") {
      bridgeBanner = "GPU switching with optimus-manager only works on Linux.";
    } else {
      bridgeBanner = "Open Graphics from the OMEN Control desktop app (not the browser preview).";
    }
  }

  return (
    <section className="view is-active gfx-view" id="view-graphics" data-view="graphics" role="tabpanel">
      <div className="panel-head">
        <h2 className="panel-head__title">Graphics</h2>
        <p className="panel-head__lead">Switch between Battery, Hybrid, and Performance GPU modes.</p>
      </div>

      {bridgeBanner ? (
        <div className="gfx-banner gfx-banner--warn" role="status">
          {bridgeBanner}
        </div>
      ) : null}

      {error ? (
        <div className="gfx-banner gfx-banner--warn" role="alert">
          <div className="gfx-banner__text">{error}</div>
          {installLog ? <pre className="gfx-install-log">{installLog}</pre> : null}
        </div>
      ) : null}

      {status && !installed ? (
        <div className="gfx-install">
          <h3 className="gfx-install__title">Install optimus-manager</h3>
          <p className="gfx-install__body">
            OMEN Control uses{" "}
            <strong>optimus-manager</strong> to switch between Battery (iGPU), Hybrid, and NVIDIA.
            Tap install, enter your password when asked — no terminal.
          </p>
          <div className="gfx-install__actions">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void onInstall()}>
              {busy ? "Installing… enter password if asked" : "Install optimus-manager"}
            </button>
            <button
              type="button"
              className="btn-outline"
              onClick={() => void window.omenDriver?.openExternal(status.repoUrl)}
            >
              Open GitHub
            </button>
            <button type="button" className="linkish" disabled={busy} onClick={() => void refresh()}>
              I already installed it — refresh
            </button>
          </div>
          {busy ? (
            <p className="gfx-install__busy" role="status">
              Working… a system password dialog should appear. This can take a few minutes on first install.
            </p>
          ) : null}
        </div>
      ) : null}

      {installed && status && !status.daemonActive ? (
        <div className="gfx-banner gfx-banner--warn" role="status">
          <div>
            <strong>Service not running.</strong> Enable it so mode switching works.
          </div>
          <button type="button" className="btn-outline btn-outline--sm" disabled={busy} onClick={() => void onEnableService()}>
            Enable service
          </button>
        </div>
      ) : null}

      {installed && status?.needsNvidiaSetup ? (
        <div className="gfx-install" role="status">
          <h3 className="gfx-install__title">NVIDIA drivers needed</h3>
          <p className="gfx-install__body">
            {status.message ||
              "You’re still on nouveau (open-source). Performance / Hybrid need the proprietary NVIDIA driver, then a reboot."}
          </p>
          <div className="gfx-install__actions">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void onFixNvidia()}>
              {busy ? "Fixing… enter password if asked" : "Fix NVIDIA setup"}
            </button>
            <button type="button" className="linkish" disabled={busy} onClick={() => void refresh()}>
              I rebooted — refresh
            </button>
          </div>
          {busy ? (
            <p className="gfx-install__busy" role="status">
              Installing akmod-nvidia from RPM Fusion. After it finishes, reboot before switching modes.
            </p>
          ) : null}
        </div>
      ) : null}

      {installed && status?.stuckPendingPost ? (
        <div className="gfx-install" role="status">
          <h3 className="gfx-install__title">Repair GPU state</h3>
          <p className="gfx-install__body">
            GNOME Wayland never runs optimus-manager’s Xorg finish hook, so it keeps saying the hook
            failed even after a reboot. Your GPU config is probably fine — this just clears the stuck
            state{status.currentMode ? ` (mode: ${status.currentMode})` : ""}.
          </p>
          <div className="gfx-install__actions">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void onRepairState()}>
              {busy ? "Repairing…" : "Repair GPU state"}
            </button>
          </div>
        </div>
      ) : null}

      {installed && !status?.needsNvidiaSetup && status?.needsGdmPrime ? (
        <div className="gfx-install" role="status">
          <h3 className="gfx-install__title">GDM Prime hooks needed</h3>
          <p className="gfx-install__body">
            optimus-manager expects Arch’s <strong>gdm-prime</strong> package. Fedora doesn’t ship it,
            so mode switches stop with “Not properly installed: gdm-prime”. This installs the same
            <code> /etc/gdm/Prime </code> hooks locally — no terminal.
          </p>
          <div className="gfx-install__actions">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void onFixGdmPrime()}>
              {busy ? "Installing… enter password if asked" : "Install GDM Prime hooks"}
            </button>
          </div>
        </div>
      ) : null}

      {installed &&
      !status?.needsNvidiaSetup &&
      !status?.needsGdmPrime &&
      !status?.stuckPendingPost &&
      status?.hybridOffloadBenign &&
      status?.currentMode === "hybrid" ? (
        <div className="gfx-banner gfx-banner--ok" role="status">
          <div className="gfx-banner__text">
            Hybrid is working. optimus-manager’s “NVIDIA unavailable for offloading” line is an X11
            check — it always fails on GNOME Wayland even when the GPU is fine
            {status.nvidiaUserspaceReady ? " (nvidia-smi sees your RTX)." : "."} Right-click a game →
            Launch with Dedicated GPU, or run with{" "}
            <code>__NV_PRIME_RENDER_OFFLOAD=1 __GLX_VENDOR_LIBRARY_NAME=nvidia</code>.
          </div>
        </div>
      ) : null}

      {installed &&
      !status?.needsNvidiaSetup &&
      !status?.needsGdmPrime &&
      !status?.stuckPendingPost &&
      !status?.hybridOffloadBenign &&
      (status?.setupError || (status?.message && status.message !== "Ready")) ? (
        <div className="gfx-banner gfx-banner--warn" role="status">
          <div className="gfx-banner__text">
            {status?.setupError || status?.message}
            {status?.nvidiaModulesLoaded ? "\n\nNVIDIA kernel modules are loaded." : null}
          </div>
        </div>
      ) : null}

      {installed ? (
        <>
          <div className="gfx-status" aria-live="polite">
            <span className="gfx-status__lbl">Current mode</span>
            <span className="gfx-status__val">
              {activeMode ? modeLabel(activeMode) : status?.needsNvidiaSetup ? "Needs NVIDIA setup" : "Unknown"}
            </span>
            {status?.nextMode && status.nextMode !== status.currentMode ? (
              <span className="gfx-status__next">Next login: {modeLabel(status.nextMode)}</span>
            ) : null}
          </div>

          <div className="gfx-modes" role="group" aria-label="GPU mode">
            {MODE_CARDS.map((card) => {
              const selected = activeMode === card.id;
              const blocked =
                busy ||
                !status?.daemonActive ||
                status?.needsGdmPrime === true ||
                (status?.needsNvidiaSetup === true && card.id !== "integrated");
              return (
                <button
                  key={card.id}
                  type="button"
                  className={`gfx-mode gfx-mode--${card.id}${selected ? " is-active" : ""}`}
                  disabled={blocked}
                  aria-pressed={selected}
                  onClick={() => requestSwitch(card.id)}
                >
                  <span className="gfx-mode__title">{card.title}</span>
                  <span className="gfx-mode__blurb">{card.blurb}</span>
                  <span className="gfx-mode__detail">{card.detail}</span>
                  {selected ? <span className="gfx-mode__badge">Active</span> : null}
                </button>
              );
            })}
          </div>

          <p className="gfx-footnote">
            Switching usually logs you out and closes open apps. Save your work first.
            {status?.sessionType === "wayland"
              ? " You’re on Wayland — hybrid offload is automatic; ignore optimus-manager’s X11 provider warning."
              : null}
          </p>
        </>
      ) : null}

      {confirmMode ? (
        <div
          className="gfx-confirm-backdrop"
          role="presentation"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setConfirmMode(null);
          }}
        >
          <div className="gfx-confirm" role="dialog" aria-modal="true" aria-labelledby="gfx-confirm-title">
            <h3 id="gfx-confirm-title" className="gfx-confirm__title">
              Switch to {modeLabel(confirmMode)}?
            </h3>
            <p className="gfx-confirm__body">
              optimus-manager will change the GPU mode. Your session may log out and open apps will close.
            </p>
            <div className="gfx-confirm__actions">
              <button type="button" className="btn-outline" onClick={() => setConfirmMode(null)}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={() => void confirmSwitch()}>
                Switch GPU
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
