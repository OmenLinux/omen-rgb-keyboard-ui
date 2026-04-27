const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

/** @typedef {{ idle: number, total: number }} CpuSnap */
/** @type {CpuSnap | null} */
let lastCpuSnap = null;
/** @type {{ rx: number, tx: number, t: number } | null} */
let lastNetSnap = null;

/** @type {Map<string, { rx: number, tx: number }> | null} */
let lastSsConnBytes = null;
/** @type {number} */
let lastSsConnT = 0;

function readTextSafe(p) {
  try {
    return fs.readFileSync(p, "utf8").trim();
  } catch {
    return null;
  }
}

function parseIntSafe(s, radix = 10) {
  const n = parseInt(String(s), radix);
  return Number.isFinite(n) ? n : null;
}

function augmentPath(p) {
  const base = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/sbin:/usr/bin:/bin";
  if (!p || !String(p).trim()) return base;
  const s = String(p);
  if (s.includes("/usr/bin") || s.includes("/usr/sbin")) return s;
  return `${base}:${s}`;
}

function runSsSync(ssArgs) {
  const env = { ...process.env, PATH: augmentPath(process.env.PATH) };
  const candidates = ["/usr/sbin/ss", "/usr/bin/ss", "ss"];
  let last = { stdout: "", status: -1 };
  for (const cmd of candidates) {
    if (cmd !== "ss") {
      try {
        if (!fs.existsSync(cmd)) continue;
      } catch {
        continue;
      }
    }
    const r = spawnSync(cmd, ssArgs, {
      encoding: "utf8",
      timeout: 3500,
      maxBuffer: 4 * 1024 * 1024,
      env,
    });
    last = r;
    if (r.error) continue;
    if (r.stdout && r.stdout.trim().length > 0) return r;
  }
  return last;
}

function cpuUsagePctFromProc() {
  if (process.platform !== "linux") {
    const load = os.loadavg()[0];
    const cores = os.cpus().length || 1;
    return Math.min(100, Math.round((load / cores) * 100));
  }
  const line = readTextSafe("/proc/stat")?.split("\n")[0];
  if (!line || !line.startsWith("cpu ")) return 0;
  const nums = line
    .trim()
    .split(/\s+/)
    .slice(1)
    .map((x) => parseInt(x, 10));
  if (nums.length < 4 || nums.some((n) => !Number.isFinite(n))) return 0;
  const idle = nums[3] + (nums[4] || 0);
  const total = nums.reduce((a, b) => a + b, 0);
  if (!lastCpuSnap) {
    lastCpuSnap = { idle, total };
    return 0;
  }
  const didle = idle - lastCpuSnap.idle;
  const dtotal = total - lastCpuSnap.total;
  lastCpuSnap = { idle, total };
  if (dtotal <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round(100 * (1 - didle / dtotal))));
}

function memInfo() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const ramUtilPct = total > 0 ? Math.min(100, Math.round((100 * used) / total)) : 0;
  return {
    ramUtilPct,
    ramUsedGb: used / 1024 ** 3,
    ramTotalGb: total / 1024 ** 3,
  };
}

function diskInfo() {
  const mount = process.platform === "win32" ? "C:\\" : "/";
  try {
    const s = fs.statfsSync(mount);
    const total = Number(s.blocks) * Number(s.bsize);
    const free = Number(s.bfree) * Number(s.bsize);
    if (!Number.isFinite(total) || total <= 0) throw new Error("bad statfs");
    const used = total - free;
    const storageUsedPct = Math.min(100, Math.max(0, Math.round((100 * used) / total)));
    return {
      storageUsedPct,
      storageFreeGb: free / 1024 ** 3,
      storageTotalGb: total / 1024 ** 3,
      storageLabel: process.platform === "win32" ? "C:" : "/",
    };
  } catch {
    return {
      storageUsedPct: 0,
      storageFreeGb: 0,
      storageTotalGb: 0,
      storageLabel: "—",
    };
  }
}

function storageSubtitle() {
  if (process.platform === "win32") {
    const r = spawnSync("wmic", ["logicaldisk", "where", "DeviceID='C:'", "get", "FreeSpace,Size", "/value"], {
      encoding: "utf8",
      timeout: 5000,
    });
    if (r.status !== 0 || !r.stdout) return "C: —";
    const free = r.stdout.match(/FreeSpace=(\d+)/)?.[1];
    const size = r.stdout.match(/Size=(\d+)/)?.[1];
    if (!free || !size) return "C: —";
    const f = Number(free) / 1024 ** 3;
    const t = Number(size) / 1024 ** 3;
    return `C: ${f.toFixed(1)} GB free of ${t.toFixed(1)} GB`;
  }
  const r = spawnSync("df", ["-h", "--output=avail,size,target", "/"], { encoding: "utf8", timeout: 3000 });
  if (r.status !== 0 || !r.stdout) return `${diskInfo().storageLabel} —`;
  const lines = r.stdout.trim().split("\n");
  const row = lines[1]?.trim().split(/\s+/);
  if (!row || row.length < 3) return `${diskInfo().storageLabel} —`;
  const [avail, size, target] = row;
  return `${target} ${avail} free of ${size}`;
}

function netRatesMbps() {
  if (process.platform !== "linux") return { netUpMbps: null, netDownMbps: null };
  let rx = 0;
  let tx = 0;
  try {
    const ifaces = fs.readdirSync("/sys/class/net");
    for (const iface of ifaces) {
      if (iface === "lo") continue;
      const rxp = `/sys/class/net/${iface}/statistics/rx_bytes`;
      const txp = `/sys/class/net/${iface}/statistics/tx_bytes`;
      const rv = parseIntSafe(readTextSafe(rxp));
      const tv = parseIntSafe(readTextSafe(txp));
      if (rv != null) rx += rv;
      if (tv != null) tx += tv;
    }
  } catch {
    return { netUpMbps: null, netDownMbps: null };
  }
  const now = Date.now();
  if (!lastNetSnap) {
    lastNetSnap = { rx, tx, t: now };
    return { netUpMbps: 0, netDownMbps: 0 };
  }
  const dt = (now - lastNetSnap.t) / 1000;
  const drx = rx - lastNetSnap.rx;
  const dtx = tx - lastNetSnap.tx;
  lastNetSnap = { rx, tx, t: now };
  if (dt <= 0) return { netUpMbps: 0, netDownMbps: 0 };
  const downMbps = (drx * 8) / dt / 1e6;
  const upMbps = (dtx * 8) / dt / 1e6;
  return {
    netDownMbps: Math.max(0, downMbps),
    netUpMbps: Math.max(0, upMbps),
  };
}

function nvidiaGpu() {
  try {
    const r = spawnSync(
      "nvidia-smi",
      ["--query-gpu=temperature.gpu,utilization.gpu", "--format=csv,noheader,nounits"],
      { encoding: "utf8", timeout: 2500 },
    );
    if (r.error || r.status !== 0 || !r.stdout) return null;
    const parts = r.stdout
      .trim()
      .split("\n")[0]
      .split(/[\s,]+/)
      .filter(Boolean);
    const temp = parseFloat(parts[0]);
    const util = parseFloat(parts[1]);
    return {
      gpuTempC: Number.isFinite(temp) ? temp : null,
      gpuUtilPct: Number.isFinite(util) ? util : null,
    };
  } catch {
    return null;
  }
}

function amdgpuGpuTempC() {
  try {
    const drms = fs.readdirSync("/sys/class/drm").filter((x) => /^card\d+$/.test(x));
    for (const card of drms) {
      const hwmonDir = path.join("/sys/class/drm", card, "device", "hwmon");
      if (!fs.existsSync(hwmonDir)) continue;
      for (const h of fs.readdirSync(hwmonDir)) {
        const name = readTextSafe(path.join(hwmonDir, h, "name"));
        if (name !== "amdgpu" && name !== "radeon") continue;
        const milli = parseIntSafe(readTextSafe(path.join(hwmonDir, h, "temp1_input")));
        if (milli != null) return milli / 1000;
      }
    }
  } catch {}
  return null;
}

function cpuTempFromHwmon() {
  const temps = [];
  try {
    const base = "/sys/class/hwmon";
    if (!fs.existsSync(base)) return null;
    for (const h of fs.readdirSync(base)) {
      const dir = path.join(base, h);
      if (!fs.statSync(dir).isDirectory()) continue;
      const name = readTextSafe(path.join(dir, "name")) || "";
      if (!/coretemp|k10temp|zenpower/i.test(name)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!/^temp\d+_input$/.test(f)) continue;
        const milli = parseIntSafe(readTextSafe(path.join(dir, f)));
        if (milli == null) continue;
        const c = milli / 1000;
        if (c > 0 && c < 125) temps.push(c);
      }
    }
  } catch {
    return null;
  }
  if (temps.length === 0) return null;
  return Math.round(Math.max(...temps));
}

function cpuTempThermalZonesC() {
  const temps = [];
  try {
    const tz = "/sys/class/thermal";
    if (!fs.existsSync(tz)) return null;
    for (const name of fs.readdirSync(tz)) {
      if (!/^thermal_zone\d+$/.test(name)) continue;
      const tpath = path.join(tz, name, "temp");
      const milli = parseIntSafe(readTextSafe(tpath));
      if (milli == null) continue;
      const c = milli / 1000;
      if (c > 0 && c < 120) temps.push(c);
    }
  } catch {
    return null;
  }
  if (temps.length === 0) return null;
  return Math.round(Math.max(...temps));
}

function fanRpmFromHwmon() {
  const rpms = [];
  try {
    const base = "/sys/class/hwmon";
    if (!fs.existsSync(base)) return null;
    for (const h of fs.readdirSync(base)) {
      const dir = path.join(base, h);
      if (!fs.statSync(dir).isDirectory()) continue;
      const name = readTextSafe(path.join(dir, "name")) || "";
      if (!/thinkpad|nct677|nct67|ite86|asus|dell|acpi|ec|fan|amdgpu|nouveau/i.test(name)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!/^fan\d+_input$/.test(f)) continue;
        const rpm = parseIntSafe(readTextSafe(path.join(dir, f)));
        if (rpm != null && rpm > 0) rpms.push(rpm);
      }
    }
  } catch {
    return null;
  }
  if (rpms.length === 0) return null;
  return Math.round(rpms.reduce((a, b) => a + b, 0) / rpms.length);
}

function cpuCurrentFreqGhz() {
  if (process.platform !== "linux") {
    const cpus = os.cpus();
    const m = cpus[0]?.speed;
    return m != null && m > 0 ? m / 1000 : null;
  }
  const mhzs = [];
  try {
    const cpus = fs.readdirSync("/sys/devices/system/cpu").filter((x) => /^cpu\d+$/.test(x));
    for (const c of cpus) {
      const p = `/sys/devices/system/cpu/${c}/cpufreq/scaling_cur_freq`;
      const khz = parseIntSafe(readTextSafe(p));
      if (khz != null && khz > 0) mhzs.push(khz / 1000);
    }
  } catch {}
  if (mhzs.length > 0) {
    const avg = mhzs.reduce((a, b) => a + b, 0) / mhzs.length;
    return Math.round((avg / 1000) * 100) / 100;
  }
  const line = readTextSafe("/proc/cpuinfo");
  const m = line?.match(/cpu MHz\s*:\s*([\d.]+)/i);
  if (m) {
    const mhz = parseFloat(m[1]);
    if (Number.isFinite(mhz)) return Math.round((mhz / 1000) * 100) / 100;
  }
  return null;
}

function parseSsEstablishedTcpBytes(ssOut) {
  const lines = ssOut.split("\n");
  /** @type {{ key: string, pid: number, name: string, rx: number, tx: number }[]} */
  const out = [];
  let i = 0;
  if (lines[0]?.trimStart().startsWith("Recv-Q")) i = 1;
  const userRe = /users:\(\("([^"]*)",pid=(\d+),fd=(\d+)\)\)/;
  while (i < lines.length) {
    const sockLine = lines[i];
    if (!sockLine?.trim()) {
      i += 1;
      continue;
    }
    if (sockLine.startsWith("\t")) {
      i += 1;
      continue;
    }
    const infoLine = lines[i + 1];
    if (!infoLine?.startsWith("\t")) {
      i += 1;
      continue;
    }
    const um = sockLine.match(userRe);
    const txM = infoLine.match(/bytes_sent:(\d+)/);
    const rxM = infoLine.match(/bytes_received:(\d+)/);
    if (!um || !txM || !rxM) {
      i += 2;
      continue;
    }
    const pid = parseInt(um[2], 10);
    const fd = parseInt(um[3], 10);
    const tx = parseInt(txM[1], 10);
    const rx = parseInt(rxM[1], 10);
    if (!Number.isFinite(pid) || !Number.isFinite(fd) || !Number.isFinite(tx) || !Number.isFinite(rx)) {
      i += 2;
      continue;
    }
    out.push({
      key: `${pid}:${fd}`,
      pid,
      name: um[1],
      rx,
      tx,
    });
    i += 2;
  }
  return out;
}

function parseSsTanpEstablishedUsers(stdout) {
  /** @type {Map<number, { name: string; socks: number }>} */
  const m = new Map();
  if (!stdout) return m;
  const userRe = /users:\(\("([^"]*)",pid=(\d+),fd=\d+\)\)/;
  for (const line of stdout.split("\n")) {
    const um = line.match(userRe);
    if (!um) continue;
    const pid = parseInt(um[2], 10);
    if (!Number.isFinite(pid)) continue;
    const name = um[1];
    const o = m.get(pid) || { name, socks: 0 };
    o.socks += 1;
    o.name = name;
    m.set(pid, o);
  }
  return m;
}

function networkRowsFromAgg(byPid) {
  return [...byPid.entries()]
    .map(([pid, v]) => ({
      pid,
      name: v.name.slice(0, 56),
      downKbps: Math.round(v.downKbps * 10) / 10,
      upKbps: Math.round(v.upKbps * 10) / 10,
      tcpSockets: v.tcpSockets,
    }))
    .sort((a, b) => b.downKbps + b.upKbps - (a.downKbps + a.upKbps))
    .slice(0, 24);
}

function networkByProcessRates() {
  if (process.platform !== "linux") return [];

  const rTi = runSsSync(["-H", "-tiapn", "state", "established"]);
  let parsed = parseSsEstablishedTcpBytes(rTi.stdout || "");

  if (parsed.length === 0) {
    const rTan = runSsSync(["-H", "-tanp", "state", "established"]);
    const fb = parseSsTanpEstablishedUsers(rTan.stdout || "");
    /** @type {Map<number, { name: string; downKbps: number; upKbps: number; tcpSockets: number }>} */
    const byPid = new Map();
    for (const [pid, v] of fb) {
      byPid.set(pid, { name: v.name, downKbps: 0, upKbps: 0, tcpSockets: v.socks });
    }
    return networkRowsFromAgg(byPid);
  }

  const now = Date.now();
  const dt = lastSsConnBytes && lastSsConnT > 0 ? (now - lastSsConnT) / 1000 : 0;
  const prev = lastSsConnBytes;

  /** @type {Map<string, { rx: number, tx: number }>} */
  const cur = new Map();
  for (const row of parsed) {
    cur.set(row.key, { rx: row.rx, tx: row.tx });
  }

  /** @type {Map<number, { name: string; downKbps: number; upKbps: number; tcpSockets: number }>} */
  const byPid = new Map();
  for (const row of parsed) {
    let drx = 0;
    let dtx = 0;
    if (prev && dt > 0) {
      const p = prev.get(row.key);
      if (p) {
        drx = row.rx - p.rx;
        dtx = row.tx - p.tx;
        if (drx < 0 || dtx < 0) {
          drx = 0;
          dtx = 0;
        }
      }
    }
    const kbDown = dt > 0 ? (drx * 8) / dt / 1000 : 0;
    const kbUp = dt > 0 ? (dtx * 8) / dt / 1000 : 0;
    const agg = byPid.get(row.pid) || { name: row.name, downKbps: 0, upKbps: 0, tcpSockets: 0 };
    agg.tcpSockets += 1;
    agg.downKbps += kbDown;
    agg.upKbps += kbUp;
    agg.name = row.name;
    byPid.set(row.pid, agg);
  }

  lastSsConnBytes = cur;
  lastSsConnT = now;

  return networkRowsFromAgg(byPid);
}

function topProcesses() {
  if (process.platform !== "linux") {
    return [];
  }
  const r = spawnSync("ps", ["-eo", "pcpu,rss,comm", "--no-headers", "--sort=-pcpu"], {
    encoding: "utf8",
    timeout: 4000,
    maxBuffer: 1024 * 1024,
  });
  if (r.error || r.status !== 0 || !r.stdout) return [];
  const lines = r.stdout.trim().split("\n").filter(Boolean);
  const rows = [];
  for (const line of lines) {
    const m = line.trim().match(/^(\S+)\s+(\S+)\s+(.+)$/);
    if (!m) continue;
    const cpuPct = parseFloat(m[1]);
    const rssKb = parseInt(m[2], 10);
    const comm = m[3].trim();
    if (!Number.isFinite(cpuPct) || !Number.isFinite(rssKb)) continue;
    rows.push({
      name: comm.slice(0, 48),
      cpuPct,
      gpuPct: 0,
      ramMb: rssKb / 1024,
    });
    if (rows.length >= 8) break;
  }
  return rows;
}

function getSystemMetrics() {
  const nv = nvidiaGpu();
  const gpuFromDriver = nv?.gpuTempC ?? null;
  const gpuUtil = nv?.gpuUtilPct ?? null;
  const gpuTempC = gpuFromDriver ?? amdgpuGpuTempC();

  let cpuTempC = cpuTempFromHwmon();
  if (cpuTempC == null) cpuTempC = cpuTempThermalZonesC();

  const fanRpm = fanRpmFromHwmon();
  const cpuSpeedGhz = cpuCurrentFreqGhz();
  const { ramUtilPct, ramUsedGb, ramTotalGb } = memInfo();
  const disk = diskInfo();
  const net = netRatesMbps();
  const cpuUtilPct = cpuUsagePctFromProc();

  return {
    cpuTempC,
    gpuTempC,
    cpuUtilPct,
    gpuUtilPct: gpuUtil,
    ramUtilPct,
    ramUsedGb: Math.round(ramUsedGb * 10) / 10,
    ramTotalGb: Math.round(ramTotalGb * 10) / 10,
    storageUsedPct: disk.storageUsedPct,
    storageFreeGb: Math.round(disk.storageFreeGb * 10) / 10,
    storageTotalGb: Math.round(disk.storageTotalGb * 10) / 10,
    storageLabel: disk.storageLabel,
    storageSubtitle: storageSubtitle(),
    netUpMbps: net.netUpMbps != null ? Math.round(net.netUpMbps * 10) / 10 : null,
    netDownMbps: net.netDownMbps != null ? Math.round(net.netDownMbps * 10) / 10 : null,
    fanRpm,
    cpuSpeedGhz,
    topProcesses: topProcesses(),
    networkByProcess: networkByProcessRates(),
  };
}

module.exports = { getSystemMetrics };
