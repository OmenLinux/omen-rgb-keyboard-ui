const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("omenShell", {
  minimize: () => ipcRenderer.send("window-minimize"),
  maximize: () => ipcRenderer.send("window-maximize"),
  close: () => ipcRenderer.send("window-close"),
  isMaximized: () => ipcRenderer.invoke("window-is-maximized"),
  platform: process.platform,
  getMachineModel: () => ipcRenderer.invoke("shell-get-machine-model"),
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
});
