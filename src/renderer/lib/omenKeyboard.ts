type RowConfig = {
  keyWidth?: number;
  keyHeight?: number;
  keyGap?: number;
  startOffset?: number;
  rowTop?: number;
  rowSpacing?: number;
};

type KeyboardConfig = RowConfig & {
  rows?: Record<number, Partial<RowConfig>>;
};

class Key {
  element: HTMLElement;
  row: number;
  width: number;
  height: number;
  gap: number;
  rowConfig: RowConfig;

  constructor(element: HTMLElement, row: number, _index: number, rowConfig: RowConfig) {
    this.element = element;
    this.row = row;
    this.rowConfig = rowConfig;

    const dataWidth = element.getAttribute("data-width");
    const dataHeight = element.getAttribute("data-height");

    if (dataWidth) {
      this.width = parseInt(dataWidth, 10);
    } else if (rowConfig.keyWidth != null) {
      this.width = rowConfig.keyWidth;
    } else if (element.classList.contains("small-key")) {
      this.width = 45;
    } else if (element.classList.contains("wide-key")) {
      this.width = 100;
    } else {
      this.width = 50;
    }

    if (dataHeight) {
      this.height = parseInt(dataHeight, 10);
    } else if (rowConfig.keyHeight != null) {
      this.height = rowConfig.keyHeight;
    } else if (element.classList.contains("small-key")) {
      this.height = 40;
    } else {
      this.height = 50;
    }

    const dataGap = element.getAttribute("data-gap");
    this.gap = dataGap ? parseFloat(dataGap) : rowConfig.keyGap || 10;

    this.element.style.width = `${this.width}px`;
    this.element.style.height = `${this.height}px`;

    const label = element.getAttribute("data-label");
    if (label) {
      this.element.textContent = label;
    }

    const textContent = this.element.textContent?.trim() ?? "";
    if (textContent.length > 5) {
      this.element.classList.add("long-text");
    }
  }

  getTop() {
    return this.rowConfig.rowTop! + (this.row - 1) * this.rowConfig.rowSpacing!;
  }

  getLeft(previousKeys: Key[]) {
    let left = this.rowConfig.startOffset || 35;
    for (let i = 0; i < previousKeys.length; i += 1) {
      left += previousKeys[i].width + previousKeys[i].gap;
    }
    return left;
  }

  position(previousKeys: Key[]) {
    this.element.style.top = `${this.getTop()}px`;
    this.element.style.left = `${this.getLeft(previousKeys)}px`;
  }
}

class Keyboard {
  container: HTMLElement;
  config: KeyboardConfig;
  keys: Key[] = [];
  rows: Record<number, Key[]> = {};
  rowConfigs: Record<number, RowConfig> = {};

  constructor(containerEl: HTMLElement, config: KeyboardConfig) {
    this.container = containerEl;
    this.config = config;
    this.init();
  }

  getRowConfig(row: number): RowConfig {
    if (this.rowConfigs[row]) {
      return this.rowConfigs[row];
    }

    const defaults: RowConfig = {
      keyWidth: this.config.keyWidth || 50,
      keyHeight: this.config.keyHeight || 40,
      keyGap: this.config.keyGap || 10,
      startOffset: this.config.startOffset || 35,
      rowTop: this.config.rowTop || 30,
      rowSpacing: this.config.rowSpacing || 60,
    };

    const rowSpecific = this.config.rows?.[row] || {};
    const merged = { ...defaults, ...rowSpecific };
    this.rowConfigs[row] = merged;
    return merged;
  }

  init() {
    this.setupKeys();
  }

  setupKeys() {
    this.container.querySelectorAll<HTMLElement>("[data-row]").forEach((element) => {
      const row = parseInt(element.getAttribute("data-row") || "0", 10);
      if (!this.rows[row]) {
        this.rows[row] = [];
      }

      const rowConfig = this.getRowConfig(row);
      const keyIndex = this.rows[row].length;
      const key = new Key(element, row, keyIndex, rowConfig);
      this.keys.push(key);
      this.rows[row].push(key);
    });

    this.positionAll();
    this.calculateSize();
  }

  calculateSize() {
    let maxRight = 0;
    let maxBottom = 0;

    this.keys.forEach((key) => {
      const right = parseFloat(key.element.style.left) + key.width;
      const bottom = parseFloat(key.element.style.top) + key.height;
      if (right > maxRight) maxRight = right;
      if (bottom > maxBottom) maxBottom = bottom;
    });

    this.container.style.width = `${maxRight + 20}px`;
    this.container.style.height = `${maxBottom + 20}px`;
  }

  positionAll() {
    Object.keys(this.rows).forEach((rowNum) => {
      const keys = this.rows[Number(rowNum)];
      keys.forEach((key, index) => {
        const previousKeys = keys.slice(0, index);
        key.position(previousKeys);
      });
    });
  }
}

const OMEN_KB_CONFIG: KeyboardConfig = {
  keyWidth: 50,
  keyHeight: 40,
  keyGap: 12,
  rowSpacing: 55,
  startOffset: 35,
  rowTop: 30,
  rows: {
    1: { keyWidth: 48, keyGap: 12.2 },
    2: { keyWidth: 50, keyHeight: 50 },
    3: { keyWidth: 50, keyHeight: 50 },
    4: { keyWidth: 50, keyHeight: 50 },
    5: { keyWidth: 50, keyHeight: 50 },
    6: { keyWidth: 50, keyHeight: 50 },
  },
};

export function scaleOmenKeyboard(): void {
  const root = document.getElementById("lighting-keyboard");
  const scaler = root?.querySelector<HTMLElement>(".omen-lkb-scaler");
  const kbEl = root?.querySelector<HTMLElement>(".omen-keyboard");
  const stage = document.querySelector<HTMLElement>(".keyboard-stage--omen-lkb");
  if (!root || !scaler || !kbEl || !stage) return;

  const keyboardWidth = kbEl.offsetWidth || kbEl.scrollWidth;
  const keyboardHeight = kbEl.offsetHeight || kbEl.scrollHeight;
  if (keyboardWidth === 0 || keyboardHeight === 0) {
    return;
  }

  const pad = 24;
  const availableWidth = Math.max(1, stage.clientWidth - pad);
  const availableHeight = Math.max(1, stage.clientHeight - pad);
  const scaleX = availableWidth / keyboardWidth;
  const scaleY = availableHeight / keyboardHeight;
  const scale = Math.min(scaleX, scaleY, 1);
  scaler.style.transform = `scale(${scale})`;
  scaler.style.transformOrigin = "center center";
}

export function initOmenLightingKeyboard(): () => void {
  const kbEl = document.querySelector<HTMLElement>("#lighting-keyboard .omen-keyboard");
  if (!kbEl) {
    return () => {};
  }

  if (kbEl.dataset.omenKbInit === "1") {
    scaleOmenKeyboard();
    return () => {};
  }

  kbEl.dataset.omenKbInit = "1";
  new Keyboard(kbEl, OMEN_KB_CONFIG);

  const onResize = () => scaleOmenKeyboard();
  const runScale = () => {
    scaleOmenKeyboard();
    setTimeout(scaleOmenKeyboard, 120);
  };
  setTimeout(runScale, 80);
  window.addEventListener("resize", onResize);

  const stage = document.querySelector<HTMLElement>(".keyboard-stage--omen-lkb");
  let ro: ResizeObserver | null = null;
  if (stage && typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => scaleOmenKeyboard());
    ro.observe(stage);
  }

  return () => {
    window.removeEventListener("resize", onResize);
    ro?.disconnect();
    delete kbEl.dataset.omenKbInit;
  };
}
