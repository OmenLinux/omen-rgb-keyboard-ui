import { useEffect, useRef, useState } from "react";
import { OmenBrandLogo } from "./OmenBrandLogo";
import { APP_VERSION } from "../version";

const HOLD_MS = 1780;
const FADE_MS = 420;

type Props = { onComplete: () => void };

export function IntroOverlay({ onComplete }: Props) {
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
      <div className="intro-screen__bg" aria-hidden>
        <div className="intro-screen__bg-grid" />
        <div className="intro-screen__bg-glow intro-screen__bg-glow--a" />
        <div className="intro-screen__bg-glow intro-screen__bg-glow--b" />
        <div className="intro-screen__bg-glow intro-screen__bg-glow--c" />
        <div className="intro-screen__bg-sweep" />
      </div>
      <div className="intro-screen__inner">
        <div className="intro-screen__mark">
          <div className="intro-screen__mark-enter">
            <div className="intro-screen__mark-pulse">
              <OmenBrandLogo className="omen-brand-logo intro-screen__logo" height={76} />
            </div>
          </div>
        </div>
        <h1 className="intro-screen__title">
          <span className="intro-screen__omen">OMEN</span>
          <span className="intro-screen__hub">Gaming Hub</span>
        </h1>
        <p className="intro-screen__version">Version {APP_VERSION}</p>
      </div>
    </div>
  );
}
