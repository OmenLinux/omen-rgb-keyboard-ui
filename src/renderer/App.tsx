import { useCallback, useEffect, useRef, useState } from "react";
import type { ViewId } from "./types";
import { Content } from "./Content";
import { DriverWelcomeCard, readDriverSetupSkipped, writeDriverSetupSkipped } from "./components/DriverWelcomeCard";
import { useDriver } from "./driverContext";
import { IntroOverlay } from "./components/IntroOverlay";
import { MainTabs } from "./components/MainTabs";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { APP_VERSION } from "./version";

export function App() {
  const [activeView, setActiveView] = useState<ViewId>("vitals");
  const [showIntro, setShowIntro] = useState(true);
  const [driverSetupOpen, setDriverSetupOpen] = useState(false);
  const driverPromptedRef = useRef(false);
  const endIntro = useCallback(() => setShowIntro(false), []);
  const { status, refresh } = useDriver();
  const shell = typeof window !== "undefined" ? window.omenShell : undefined;

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (showIntro) return;
    void refresh();
  }, [showIntro, refresh]);

  useEffect(() => {
    if (showIntro || readDriverSetupSkipped() || driverPromptedRef.current) return;

    if (!status) {
      if (typeof window !== "undefined" && !window.omenDriver) {
        driverPromptedRef.current = true;
        setDriverSetupOpen(true);
      }
      return;
    }

    const driverUsable = status.platform === "linux" && status.sysfsReady;
    if (!driverUsable) {
      driverPromptedRef.current = true;
      setDriverSetupOpen(true);
    }
  }, [showIntro, status]);

  return (
    <>
      {showIntro ? <IntroOverlay onComplete={endIntro} /> : null}
      <svg width={0} height={0} className="svg-defs" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="omenRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#a78bfa" />
            <stop offset="100%" stopColor="#e879a6" />
          </linearGradient>
        </defs>
      </svg>
      {driverSetupOpen ? (
        <DriverWelcomeCard
          onDismiss={() => {
            setDriverSetupOpen(false);
            void refresh();
          }}
          onDismissForever={() => {
            writeDriverSetupSkipped();
            setDriverSetupOpen(false);
            void refresh();
          }}
        />
      ) : null}
      <div className="app" id="app">
        <TitleBar shell={shell} />
        <div className="body">
          <Sidebar activeView={activeView} onSelect={setActiveView} />
          <main className="main" id="main" data-active-view={activeView}>
            <MainTabs activeView={activeView} onSelect={setActiveView} />
            <Content activeView={activeView} />
            <footer className="main-footer">
              <span className="main-footer__ver">{APP_VERSION}</span>
            </footer>
          </main>
        </div>
      </div>
    </>
  );
}
