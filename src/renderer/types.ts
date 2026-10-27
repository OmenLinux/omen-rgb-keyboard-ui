export type OmenShell = {
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  platform: string;
  getMachineModel?: () => Promise<string>;
  getVersion?: () => Promise<string>;
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

export type OptimusMode = "nvidia" | "integrated" | "hybrid";

export type OptimusStatus = {
  platform: string;
  installed: boolean;
  daemonActive: boolean;
  currentMode: OptimusMode | null;
  nextMode: OptimusMode | null;
  message: string;
  repoUrl: string;
  rawStatus?: string | null;
  nvidiaDriverOk?: boolean;
  nvidiaModulesLoaded?: boolean;
  nvidiaUserspaceReady?: boolean;
  nouveauLoaded?: boolean;
  needsNvidiaSetup?: boolean;
  needsGdmPrime?: boolean;
  displayManager?: string | null;
  stuckPendingPost?: boolean;
  stateType?: string | null;
  sessionType?: string | null;
  setupError?: string | null;
  hybridOffloadWarning?: boolean;
  hybridOffloadBenign?: boolean;
  lastFailure?: { logPath: string; reason: string; snippet?: string } | null;
};

export type OmenOptimusApi = {
  getStatus: () => Promise<OptimusStatus>;
  switchMode: (
    mode: OptimusMode | string,
  ) => Promise<{
    ok: boolean;
    error?: string;
    mode?: OptimusMode;
    status?: OptimusStatus;
    needsInstall?: boolean;
    needsNvidiaSetup?: boolean;
    needsGdmPrime?: boolean;
    needsStateRepair?: boolean;
    repairedState?: boolean;
    message?: string;
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
  optimusGetStatus?: () => Promise<OptimusStatus>;
  optimusSwitch?: OmenOptimusApi["switchMode"];
  optimusInstall?: OmenOptimusApi["install"];
  optimusEnableService?: OmenOptimusApi["enableService"];
  optimusFixSetup?: OmenOptimusApi["fixSetup"];
  optimusFixGdmPrime?: OmenOptimusApi["fixGdmPrime"];
  optimusRepairState?: OmenOptimusApi["repairState"];
};

export type UpdaterEvent =
  | { type: "checking" }
  | { type: "available"; version: string; releaseName?: string | null }
  | { type: "not-available"; version: string }
  | { type: "progress"; percent: number; transferred: number; total: number }
  | { type: "downloaded"; version: string }
  | { type: "error"; message: string };

export type OmenUpdaterApi = {
  check: () => Promise<{
    ok: boolean;
    reason?: string;
    error?: string;
    version?: string;
    updateInfo?: { version: string } | null;
  }>;
  install: () => Promise<{ ok: boolean; reason?: string }>;
  onEvent: (handler: (ev: UpdaterEvent) => void) => () => void;
};

export type ViewId = "vitals" | "performance" | "lighting" | "graphics" | "about";

export const NAV_ITEMS: { id: ViewId; label: string }[] = [
  { id: "vitals", label: "Home" },
  { id: "performance", label: "Performance" },
  { id: "lighting", label: "Lighting" },
  { id: "graphics", label: "Graphics" },
  { id: "about", label: "Credits" },
];
