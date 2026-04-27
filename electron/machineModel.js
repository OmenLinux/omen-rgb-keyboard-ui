const fs = require("fs");
const os = require("os");
const path = require("path");

const DMI_DIR = "/sys/class/dmi/id";

const MODEL_LAST_RESORT = "This PC";

function readDmiFile(name) {
  try {
    const raw = fs.readFileSync(path.join(DMI_DIR, name), "utf8");
    return raw.trim().replace(/\s+/g, " ");
  } catch {
    return "";
  }
}

function isJunkHardwareStyleLabel(s) {
  const t = s.trim();
  if (!t || t.length < 3) return true;
  const noSpace = !/\s/.test(t);
  if (noSpace) {
    if (/^\d+-[0-9a-f]+$/i.test(t) && t.length <= 16) return true;
    if (/^\d{3}[A-Z]_[A-Z0-9]+$/i.test(t)) return true;
  }
  return false;
}

function stripOemInternalFamilyPrefix(s) {
  return s.replace(/^\d{3}[A-Z]_[A-Z0-9]+\s+/i, "").trim();
}

function formatMachineModelForDisplay(raw) {
  let s = stripOemInternalFamilyPrefix(raw.replace(/\s+/g, " ").trim());
  s = s.replace(/^(hewlett[- ]?packard|hp|hpe)\s+/i, "");
  s = s.replace(/\s+by\s+(hewlett[- ]?packard|hp|hpe)\b/gi, "");
  s = s.replace(/\btranscend\b/gi, "");
  s = s.replace(/\bgaming\s+laptop\b/gi, "");
  s = s.replace(/\bnotebook\s+pc\b/gi, "");
  s = s.replace(/\blaptop\s+pc\b/gi, "");
  s = s.replace(/\b(\d{2})-[a-z]{1,2}\d(?:x{3,}|xxx|0{4,}|[x0]{3,})\b/gi, "$1");
  s = s.replace(/\s{2,}/g, " ").trim();
  s = s.replace(/\s+(laptop|notebook)\s*$/i, "");
  s = s.replace(/\s{2,}/g, " ").trim();
  if (!s) s = raw.replace(/\s+/g, " ").trim();
  const max = 44;
  if (s.length > max) {
    const cut = s.slice(0, max - 1);
    const sp = cut.lastIndexOf(" ");
    s = (sp > 18 ? cut.slice(0, sp) : cut).trim() + "…";
  }
  return s;
}

function enrichBareOmenLabel(formatted, product, family, version, sku) {
  const t = formatted.trim();
  if (!/^omen$/i.test(t)) return formatted;
  const blob = [product, family, version, sku].filter(Boolean).join(" ");
  const fromSku = blob.match(/\b(\d{2})-[a-z]{1,3}\d/i);
  if (fromSku) return `OMEN ${fromSku[1]}`;
  const inch = blob.match(/\b(1[0-7])\s*(?:inch|in)\b/i);
  if (inch) return `OMEN ${inch[1]}"`;
  const afterOmen = blob.match(/\bOMEN\s+(\d{2})\b/i);
  if (afterOmen) return `OMEN ${afterOmen[1]}`;
  return formatted;
}

function isBareOmenLabel(s) {
  return /^omen$/i.test(s.trim());
}

function getLinuxDmiMachineModel() {
  if (process.platform !== "linux") {
    return null;
  }
  const vendor = readDmiFile("sys_vendor");
  const product = readDmiFile("product_name");
  const family = readDmiFile("product_family");
  const version = readDmiFile("product_version");
  const sku = readDmiFile("product_sku");
  const board = readDmiFile("board_name");

  const candidates = [];
  if (product && !isJunkHardwareStyleLabel(product)) candidates.push(product);
  if (family && !isJunkHardwareStyleLabel(family)) candidates.push(family);
  if (version && !isJunkHardwareStyleLabel(version)) {
    candidates.push(vendor ? `${vendor} ${version}`.trim() : version);
  }
  if (vendor && board && !isJunkHardwareStyleLabel(board)) {
    candidates.push(`${vendor} ${board}`.trim());
  } else if (board && !isJunkHardwareStyleLabel(board)) {
    candidates.push(board);
  }
  if (vendor && !candidates.length) candidates.push(vendor);

  const seen = new Set();
  const ordered = [];
  for (const c of candidates.sort((a, b) => b.length - a.length)) {
    if (seen.has(c)) continue;
    seen.add(c);
    ordered.push(c);
  }

  let best = null;
  for (const raw of ordered) {
    const out = enrichBareOmenLabel(formatMachineModelForDisplay(raw), product, family, version, sku);
    if (!isBareOmenLabel(out)) return out;
    if (best == null) best = out;
  }
  if (best != null && isBareOmenLabel(best) && product && family && `${product} ${family}`.length > product.length + 4) {
    const merged = `${product} ${family}`;
    const retry = enrichBareOmenLabel(formatMachineModelForDisplay(merged), product, family, version, sku);
    if (!isBareOmenLabel(retry)) return retry;
  }
  return best;
}

function getMachineModelLabel() {
  const fromDmi = getLinuxDmiMachineModel();
  if (fromDmi) return fromDmi;
  const host = (() => {
    try {
      return os.hostname().trim();
    } catch {
      return "";
    }
  })();
  if (host && host !== "localhost") return host;
  return MODEL_LAST_RESORT;
}

module.exports = { getMachineModelLabel, MODEL_LAST_RESORT };
