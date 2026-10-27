import { useEffect, useState } from "react";
import { APP_VERSION } from "../version";

/** Packaged builds report electron-builder version; fall back to baked constant. */
export function useAppVersion(): string {
  const [version, setVersion] = useState(APP_VERSION);

  useEffect(() => {
    const api = window.omenShell?.getVersion;
    if (!api) return;
    void api()
      .then((v) => {
        if (typeof v === "string" && v.trim()) setVersion(v.trim());
      })
      .catch(() => {});
  }, []);

  return version;
}
