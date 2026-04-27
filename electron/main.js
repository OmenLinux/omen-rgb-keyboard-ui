const { app, BrowserWindow, ipcMain, nativeTheme, clipboard, shell } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const driver = require("./driver");
const { getMachineModelLabel } = require("./machineModel");
const { getSystemMetrics } = require("./systemMetrics");

function copyInstallScriptToTmp(filename) {
  const bundled = path.join(__dirname, "scripts", filename);
  const dest =
    filename === "install-helper.sh"
      ? path.join(os.tmpdir(), "omen-ui-install-helper.sh")
      : path.join(os.tmpdir(), "omen-ui-install-automation.sh");
  fs.copyFileSync(bundled, dest);
  try {
    fs.chmodSync(dest, 0o755);
  } catch {}
  return dest;
}

function launchInstallHelperTerminal() {
  if (process.platform !== "linux") {
    return { ok: false, error: "Installer helper is only for Linux." };
  }
  let scriptPath;
  try {
    scriptPath = copyInstallScriptToTmp("install-helper.sh");
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    return { ok: false, error: msg };
  }
  const sh = `exec bash ${JSON.stringify(scriptPath)}`;

  const attempts = [
    ["gnome-terminal", ["--wait", "--", "bash", "-lc", sh]],
    ["konsole", ["-e", "bash", "-lc", sh]],
    ["xfce4-terminal", ["-e", "bash", "-lc", sh]],
    ["x-terminal-emulator", ["-e", "bash", "-lc", sh]],
    ["xterm", ["-e", "bash", "-lc", sh]],
  ];

  for (const [bin, args] of attempts) {
    const child = spawn(bin, args, { detached: true, stdio: "ignore" });
    if (child.error) continue;
    child.unref();
    return { ok: true, terminal: bin };
  }
  return { ok: false, error: "No supported terminal emulator found in PATH." };
}

const isDev = process.env.NODE_ENV === "development";

let mainWindow;

function createWindow() {
  nativeTheme.themeSource = "dark";

  mainWindow = new BrowserWindow({
    title: "OMEN Gaming Hub",
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#0c0c0c",
    frame: false,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  if (isDev) {
    mainWindow.loadURL("http://127.0.0.1:5173/");
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "renderer", "index.html"));
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.on("window-minimize", () => {
  mainWindow?.minimize();
});

ipcMain.on("window-maximize", () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on("window-close", () => {
  mainWindow?.close();
});

ipcMain.handle("window-is-maximized", () => {
  return mainWindow?.isMaximized() ?? false;
});

ipcMain.handle("shell-get-machine-model", () => {
  try {
    return getMachineModelLabel();
  } catch {
    try {
      const h = os.hostname().trim();
      if (h && h !== "localhost") return h;
    } catch {}
    return "This PC";
  }
});

ipcMain.handle("driver-get-status", () => driver.getDriverStatus());

ipcMain.handle("system-get-metrics", () => getSystemMetrics());

ipcMain.handle("driver-copy-text", (_e, text) => {
  if (typeof text !== "string") return { ok: false };
  clipboard.writeText(text);
  return { ok: true };
});

ipcMain.handle("driver-open-external", async (_e, url) => {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return { ok: false };
  await shell.openExternal(url);
  return { ok: true };
});

ipcMain.handle("driver-sysfs-write", (_e, payload) => {
  if (!payload || typeof payload.name !== "string") return { ok: false, error: "Bad payload" };
  return driver.trySysfsWrite(payload.name, payload.value ?? "");
});

ipcMain.handle("driver-sysfs-read", (_e, name) => {
  if (typeof name !== "string") return { ok: false, error: "Bad name" };
  return driver.trySysfsRead(name);
});

ipcMain.handle("driver-launch-install-helper", () => launchInstallHelperTerminal());

ipcMain.handle("driver-install-one-click", () => {
  if (process.platform !== "linux") {
    return { ok: false, error: "Linux only." };
  }
  let automationPath;
  try {
    automationPath = copyInstallScriptToTmp("install-automation.sh");
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    return { ok: false, error: msg };
  }

  const whichPk = spawnSync("which", ["pkexec"], { encoding: "utf8" });
  if (whichPk.status === 0 && whichPk.stdout.trim()) {
    const child = spawn("pkexec", ["bash", automationPath], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    });
    if (child.pid) {
      child.unref();
      return { ok: true, method: "pkexec" };
    }
  }

  const t = launchInstallHelperTerminal();
  if (t.ok) {
    return { ok: true, method: "terminal", terminal: t.terminal };
  }
  return {
    ok: false,
    error: t.error ?? "Could not start installer (no pkexec and no supported terminal).",
  };
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
