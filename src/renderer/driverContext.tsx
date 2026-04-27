import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { DriverStatus } from "./types";

type Ctx = {
  status: DriverStatus | null;
  refresh: () => Promise<void>;
};

const DriverContext = createContext<Ctx | null>(null);

export function DriverProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<DriverStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      const api = window.omenDriver;
      if (!api) {
        setStatus(null);
        return;
      }
      const s = await api.getStatus();
      setStatus(s as DriverStatus);
    } catch {
      setStatus(null);
    }
  }, []);

  const value = useMemo(() => ({ status, refresh }), [status, refresh]);

  return <DriverContext.Provider value={value}>{children}</DriverContext.Provider>;
}

export function useDriver() {
  const v = useContext(DriverContext);
  if (!v) throw new Error("useDriver must be used inside DriverProvider");
  return v;
}
