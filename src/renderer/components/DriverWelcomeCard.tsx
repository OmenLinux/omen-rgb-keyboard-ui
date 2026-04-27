import { useCallback, useEffect, useState } from "react";
import { useDriver } from "../driverContext";

const REPO = "https://github.com/OmenLinux/omen-rgb-keyboard";
const DOCS = "https://github.com/OmenLinux/omen-rgb-keyboard#installation";

const SKIP_STORAGE_KEY = "omen.driverSetup.skip";

type Props = {
  onDismiss: () => void;
  onDismissForever: () => void;
};

export function DriverWelcomeCard({ onDismiss, onDismissForever }: Props) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { status, refresh } = useDriver();
  const api = typeof window !== "undefined" ? window.omenDriver : undefined;
  const linux = typeof window !== "undefined" && window.omenShell?.platform === "linux";

  useEffect(() => {
    if (status?.platform === "linux" && status.sysfsReady) {
      onDismiss();
    }
  }, [status, onDismiss]);

  useEffect(() => {
    if (!linux) return;
    void refresh();
    const id = window.setInterval(() => void refresh(), 3500);
    return () => clearInterval(id);
  }, [linux, refresh]);

  useEffect(() => {
    if (!linux) return;
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [linux, refresh]);

  const install = useCallback(async () => {
    if (!api || !linux) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await api.installDriverOneClick();
      if (r?.ok) {
        void refresh();
        if (r.method === "pkexec") {
          setNote("Enter your password in the policy prompt. This window will close when the driver is detected.");
        } else if (r.method === "terminal") {
          setNote("A terminal opened with the installer — follow the prompts. This window will close when the driver is detected.");
        } else {
          setNote("When the installer finishes, this window will close once the driver is detected.");
        }
      } else {
        setNote(r?.error ?? "Could not start the installer.");
      }
    } finally {
      setBusy(false);
    }
  }, [api, linux, refresh]);

  const openRepo = useCallback(() => {
    void api?.openExternal(REPO);
  }, [api]);

  const openDocs = useCallback(() => {
    void api?.openExternal(DOCS);
  }, [api]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <div
      className="driver-welcome-pop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="driver-welcome-title"
    >
      <button
        type="button"
        className="driver-welcome-pop__backdrop"
        onClick={onDismiss}
        aria-label="Close setup"
      />
      <div className="driver-welcome-pop__card">
        <div className="driver-welcome__copy">
          <p className="driver-welcome__eyebrow">Welcome</p>
          <h2 id="driver-welcome-title" className="driver-welcome__title">
            Finish keyboard RGB setup
          </h2>
          <p className="driver-welcome__lead">
            OMEN Gaming Hub uses the open-source{" "}
            <button type="button" className="linkish" onClick={openRepo}>
              omen-rgb-keyboard
            </button>{" "}
            driver on Linux. One install enables lighting, animations, and mute LED sync for supported OMEN laptops.
          </p>
          <ul className="driver-welcome__list">
            <li>Installs DKMS, udev rules, and services from the official repo.</li>
            <li>Secure Boot may require MOK signing on some distros — see troubleshooting in the repo.</li>
            <li>After install, Lighting picks up the driver automatically once it is active.</li>
          </ul>
          {linux ? null : (
            <p className="driver-welcome__warn">
              Automated install runs on Linux only. On this system you can still use the rest of the app; use Linux for RGB
              control.
            </p>
          )}
          {note ? <p className="driver-welcome__note">{note}</p> : null}
        </div>
        <div className="driver-welcome__cta">
          {linux ? (
            <button
              type="button"
              className="driver-welcome__install"
              onClick={() => void install()}
              disabled={busy}
            >
              {busy ? "Starting…" : "Install keyboard driver"}
            </button>
          ) : null}
          <div className="driver-welcome__links">
            <button type="button" className="linkish" onClick={openDocs}>
              Installation docs
            </button>
            <span className="driver-welcome__dot" aria-hidden />
            <button type="button" className="linkish" onClick={onDismiss}>
              Not now
            </button>
            <span className="driver-welcome__dot" aria-hidden />
            <button type="button" className="linkish" onClick={onDismissForever}>
              Don&apos;t show again
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function readDriverSetupSkipped() {
  try {
    return localStorage.getItem(SKIP_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeDriverSetupSkipped() {
  try {
    localStorage.setItem(SKIP_STORAGE_KEY, "1");
  } catch {}
}
