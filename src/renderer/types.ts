export type OmenShell = {
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  platform: string;
  getMachineModel?: () => Promise<string>;
};

export type DriverStatus = {
  platform: string;
  supported: boolean;
  sysfsReady: boolean;
  sysfsWritable: boolean;
  fanSysfsReady: boolean;
  fanSysfsWritable: boolean;
  moduleLoaded: boolean;
  message: string;
};

export type NetworkProcessRow = {
  pid: number;
  name: string;
  downKbps: number;
  upKbps: number;
  tcpSockets: number;
};

export type SystemVitals = {
  cpuTempC: number | null;
  gpuTempC: number | null;
  cpuUtilPct: number;
  gpuUtilPct: number | null;
  ramUtilPct: number;
  ramUsedGb: number;
  ramTotalGb: number;
  storageUsedPct: number;
  storageFreeGb: number;
  storageTotalGb: number;
  storageLabel: string;
  storageSubtitle: string;
  netUpMbps: number | null;
  netDownMbps: number | null;
  fanRpm: number | null;
  cpuSpeedGhz: number | null;
  topProcesses: { name: string; cpuPct: number; gpuPct: number; ramMb: number }[];
  networkByProcess: NetworkProcessRow[];
};

export type OmenSystemApi = {
  getMetrics: () => Promise<SystemVitals>;
};

export type OmenDriverApi = {
  getStatus: () => Promise<DriverStatus>;
  copyText: (text: string) => Promise<{ ok: boolean }>;
  openExternal: (url: string) => Promise<{ ok: boolean }>;
  launchInstallHelper: () => Promise<{ ok: boolean; terminal?: string; error?: string }>;
  installDriverOneClick: () => Promise<{
    ok: boolean;
    method?: "pkexec" | "terminal";
    terminal?: string;
    error?: string;
  }>;
  sysfsWrite: (name: string, value: string) => Promise<{ ok: boolean; error?: string }>;
  sysfsRead?: (name: string) => Promise<{ ok: boolean; value?: string; error?: string }>;
};

export type ViewId = "vitals" | "performance" | "undervolt" | "lighting" | "graphics" | "network";

export const NAV_ITEMS: { id: ViewId; label: string }[] = [
  { id: "vitals", label: "System Vitals" },
  { id: "performance", label: "Performance Control" },
  { id: "undervolt", label: "Undervolting" },
  { id: "lighting", label: "Lighting" },
  { id: "graphics", label: "Graphics Switcher" },
  { id: "network", label: "Network Booster" },
];
