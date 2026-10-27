const { app } = require("electron");
const { autoUpdater } = require("electron-updater");

/**
 * GitHub Releases auto-update.
 * Works for packaged AppImage (Linux) and NSIS (Windows).
 * Skipped in Vite/dev and unpackaged runs.
 */
function setupAutoUpdater({ isDev, send }) {
  const stub = (reason) => ({
    check: async () => ({ ok: false, reason }),
    install: () => ({ ok: false, reason }),
  });

  if (isDev) return stub("dev");
  if (!app.isPackaged) return stub("unpackaged");

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  // Prefer the GitHub release channel from electron-builder publish config.
  autoUpdater.forceDevUpdateConfig = false;

  const push = (payload) => {
    try {
      send(payload);
    } catch {
      /* window gone */
    }
  };

  autoUpdater.on("checking-for-update", () => {
    push({ type: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    push({
      type: "available",
      version: info.version,
      releaseName: info.releaseName ?? null,
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    push({ type: "not-available", version: info.version });
  });

  autoUpdater.on("download-progress", (p) => {
    push({
      type: "progress",
      percent: Math.round(p.percent * 10) / 10,
      transferred: p.transferred,
      total: p.total,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    push({ type: "downloaded", version: info.version });
  });

  autoUpdater.on("error", (err) => {
    push({
      type: "error",
      message: err && err.message ? err.message : String(err),
    });
  });

  // Quiet check after the window is up.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      push({
        type: "error",
        message: err && err.message ? err.message : String(err),
      });
    });
  }, 5000);

  return {
    check: async () => {
      try {
        const result = await autoUpdater.checkForUpdates();
        return {
          ok: true,
          version: app.getVersion(),
          updateInfo: result?.updateInfo ? { version: result.updateInfo.version } : null,
        };
      } catch (e) {
        return { ok: false, error: e && e.message ? e.message : String(e) };
      }
    },
    install: () => {
      setImmediate(() => {
        autoUpdater.quitAndInstall(false, true);
      });
      return { ok: true };
    },
  };
}

module.exports = { setupAutoUpdater };
