const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("omenShell", {
  minimize: () => ipcRenderer.send("window-minimize"),
  maximize: () => ipcRenderer.send("window-maximize"),
  close: () => ipcRenderer.send("window-close"),
  isMaximized: () => ipcRenderer.invoke("window-is-maximized"),
  platform: process.platform,
  getMachineModel: () => ipcRenderer.invoke("shell-get-machine-model"),
  getVersion: () => ipcRenderer.invoke("app-get-version"),
});

contextBridge.exposeInMainWorld("omenSystem", {
  getMetrics: () => ipcRenderer.invoke("system-get-metrics"),
});

contextBridge.exposeInMainWorld("omenDriver", {
  getStatus: () => ipcRenderer.invoke("driver-get-status"),
  copyText: (text) => ipcRenderer.invoke("driver-copy-text", text),
  openExternal: (url) => ipcRenderer.invoke("driver-open-external", url),
  launchInstallHelper: () => ipcRenderer.invoke("driver-launch-install-helper"),
  installDriverOneClick: () => ipcRenderer.invoke("driver-install-one-click"),
  sysfsWrite: (name, value) => ipcRenderer.invoke("driver-sysfs-write", { name, value }),
  sysfsRead: (name) => ipcRenderer.invoke("driver-sysfs-read", name),
  // GPU switching (optimus-manager)
  optimusGetStatus: () => ipcRenderer.invoke("optimus-get-status"),
  optimusSwitch: (mode) => ipcRenderer.invoke("optimus-switch", mode),
  optimusInstall: () => ipcRenderer.invoke("optimus-install"),
  optimusEnableService: () => ipcRenderer.invoke("optimus-enable-service"),
  optimusFixSetup: () => ipcRenderer.invoke("optimus-fix-setup"),
  optimusFixGdmPrime: () => ipcRenderer.invoke("optimus-fix-gdm-prime"),
  optimusRepairState: () => ipcRenderer.invoke("optimus-repair-state"),
});

contextBridge.exposeInMainWorld("omenOptimus", {
  getStatus: () => ipcRenderer.invoke("optimus-get-status"),
  switchMode: (mode) => ipcRenderer.invoke("optimus-switch", mode),
  install: () => ipcRenderer.invoke("optimus-install"),
  enableService: () => ipcRenderer.invoke("optimus-enable-service"),
  fixSetup: () => ipcRenderer.invoke("optimus-fix-setup"),
  fixGdmPrime: () => ipcRenderer.invoke("optimus-fix-gdm-prime"),
  repairState: () => ipcRenderer.invoke("optimus-repair-state"),
});

contextBridge.exposeInMainWorld("omenUpdater", {
  check: () => ipcRenderer.invoke("updater-check"),
  install: () => ipcRenderer.invoke("updater-install"),
  onEvent: (handler) => {
    const listener = (_event, payload) => {
      if (payload && typeof payload === "object") handler(payload);
    };
    ipcRenderer.on("updater-event", listener);
    return () => ipcRenderer.removeListener("updater-event", listener);
  },
});
