import { useEffect, useRef, useState } from "react";
import { useAppVersion } from "../hooks/useAppVersion";
import { OmenBrandLogo } from "./OmenBrandLogo";

const HOLD_MS = 1600;
const FADE_MS = 380;

type Props = { onComplete: () => void };

export function IntroOverlay({ onComplete }: Props) {
  const appVersion = useAppVersion();
  const [exiting, setExiting] = useState(false);
  const doneRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  const timersRef = useRef<number[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  onCompleteRef.current = onComplete;

  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const finish = () => {
      if (doneRef.current) return;
      doneRef.current = true;
      onCompleteRef.current();
    };

    if (reduced) {
      finish();
      return;
    }

    const t1 = window.setTimeout(() => setExiting(true), HOLD_MS);
    const t2 = window.setTimeout(finish, HOLD_MS + FADE_MS);
    timersRef.current = [t1, t2];
    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, []);

  const dismiss = () => {
    if (doneRef.current) return;
    const reduced =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      doneRef.current = true;
      onCompleteRef.current();
      return;
    }
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    if (exiting) {
      doneRef.current = true;
      onCompleteRef.current();
      return;
    }
    setExiting(true);
    timersRef.current.push(
      window.setTimeout(() => {
        if (doneRef.current) return;
        doneRef.current = true;
        onCompleteRef.current();
      }, FADE_MS),
    );
  };

  return (
    <div
      ref={rootRef}
      className={`intro-screen${exiting ? " intro-screen--out" : ""}`}
      role="presentation"
      onMouseDown={dismiss}
      onKeyDown={(e) => {
        if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          dismiss();
        }
      }}
      tabIndex={-1}
    >
      <div className="intro-screen__bg" aria-hidden />
      <div className="intro-screen__inner">
        <OmenBrandLogo className="omen-brand-logo intro-screen__logo" height={52} />
        <div className="intro-screen__copy">
          <h1 className="intro-screen__title">
            OMEN <span className="intro-screen__title-accent">Control</span>
          </h1>
          <p className="intro-screen__tag">Linux control for OMEN hardware</p>
        </div>
        <p className="intro-screen__version">v{appVersion}</p>
      </div>
    </div>
  );
}
