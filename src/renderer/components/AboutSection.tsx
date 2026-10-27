import { useEffect, useState } from "react";
import { useAppVersion } from "../hooks/useAppVersion";
import {
  FALLBACK_PEOPLE,
  fetchCollaborators,
  GITHUB_ORG,
  type GitHubPerson,
} from "../lib/collaborators";

type Props = { isActive: boolean };

type PeopleState =
  | { status: "loading" }
  | { status: "ready"; people: GitHubPerson[]; live: boolean }
  | { status: "error"; people: GitHubPerson[]; message: string };

type LicenseRow = {
  name: string;
  role: string;
  license: string;
  url: string;
};

const LICENSES: LicenseRow[] = [
  {
    name: "OMEN Gaming Hub",
    role: "This application",
    license: "Source — OmenLinux",
    url: "https://github.com/OmenLinux/omen-rgb-keyboard-ui",
  },
  {
    name: "omen-rgb-keyboard",
    role: "Kernel RGB / fan driver",
    license: "GPL-3.0",
    url: "https://github.com/OmenLinux/omen-rgb-keyboard",
  },
  {
    name: "Electron",
    role: "Desktop shell",
    license: "MIT",
    url: "https://www.electronjs.org/",
  },
  {
    name: "Chromium",
    role: "Embedded browser engine",
    license: "BSD-style",
    url: "https://www.chromium.org/",
  },
  {
    name: "React",
    role: "UI library",
    license: "MIT",
    url: "https://react.dev/",
  },
  {
    name: "Vite",
    role: "Bundler / dev server",
    license: "MIT",
    url: "https://vite.dev/",
  },
  {
    name: "Manrope",
    role: "UI typeface",
    license: "OFL-1.1",
    url: "https://fonts.google.com/specimen/Manrope",
  },
  {
    name: "Oxanium",
    role: "Display typeface",
    license: "OFL-1.1",
    url: "https://fonts.google.com/specimen/Oxanium",
  },
  {
    name: "Simple Icons (Linux)",
    role: "Tux path in atmosphere",
    license: "CC0-1.0",
    url: "https://simpleicons.org/",
  },
];

const LINKS = [
  { label: "OmenLinux org", href: `https://github.com/${GITHUB_ORG}` },
  { label: "This app", href: "https://github.com/OmenLinux/omen-rgb-keyboard-ui" },
  { label: "Keyboard driver", href: "https://github.com/OmenLinux/omen-rgb-keyboard" },
  { label: "omen-web", href: "https://github.com/OmenLinux/omen-web" },
];

function openUrl(url: string) {
  const api = window.omenDriver?.openExternal;
  if (api) void api(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

export function AboutSection({ isActive }: Props) {
  const appVersion = useAppVersion();
  const [people, setPeople] = useState<PeopleState>({ status: "loading" });
  const [openLicense, setOpenLicense] = useState<string | null>(null);
  const [updateHint, setUpdateHint] = useState<string | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchCollaborators();
        if (cancelled) return;
        setPeople({ status: "ready", people: list, live: true });
      } catch (err) {
        if (cancelled) return;
        setPeople({
          status: "error",
          people: FALLBACK_PEOPLE,
          message: err instanceof Error ? err.message : "Could not reach GitHub",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isActive]);

  const roster = people.status === "loading" ? [] : people.people;

  return (
    <section
      className={`view about-view${isActive ? " is-active" : ""}`}
      id="view-about"
      data-view="about"
      role="tabpanel"
    >
      <header className="about-hero">
        <p className="about-hero__eyebrow">OmenLinux</p>
        <h1 className="about-hero__title">Credits</h1>
        <p className="about-hero__lead">
          Built because HP will not. Drivers, tools, and this Hub exist so OMEN hardware
          stays usable on Linux — thanks to everyone who showed up.
        </p>
        <div className="about-hero__meta">
          <span className="about-pill">Hub v{appVersion}</span>
          <span className="about-pill">Community firmware &amp; software</span>
        </div>
        <div className="about-update">
          <button
            type="button"
            className="btn-outline btn-outline--sm"
            disabled={updateBusy}
            onClick={() => {
              const api = window.omenUpdater;
              if (!api) {
                setUpdateHint("Updater API unavailable.");
                return;
              }
              setUpdateBusy(true);
              setUpdateHint("Checking for updates…");
              void api.check().then((r) => {
                setUpdateBusy(false);
                if (!r.ok) {
                  if (r.reason === "dev") setUpdateHint("Updates only run in packaged builds.");
                  else if (r.reason === "unpackaged") setUpdateHint("Install the AppImage/NSIS build to receive updates.");
                  else setUpdateHint(r.error ?? "Update check failed.");
                  return;
                }
                if (r.updateInfo?.version && r.updateInfo.version !== appVersion) {
                  setUpdateHint(`Update v${r.updateInfo.version} found — see the banner above.`);
                } else {
                  setUpdateHint(`You're on the latest version (v${appVersion}).`);
                }
              });
            }}
          >
            {updateBusy ? "Checking…" : "Check for updates"}
          </button>
          {updateHint ? <p className="about-update__hint">{updateHint}</p> : null}
        </div>
      </header>

      <div className="about-links">
        {LINKS.map((l) => (
          <button key={l.href} type="button" className="about-link" onClick={() => openUrl(l.href)}>
            <span className="about-link__lbl">{l.label}</span>
            <span className="about-link__go" aria-hidden>
              →
            </span>
          </button>
        ))}
      </div>

      <div className="about-block">
        <div className="about-block__head">
          <h2 className="about-block__title">Contributors</h2>
          <p className="about-block__sub">
            {people.status === "loading"
              ? "Loading from GitHub…"
              : people.status === "error"
                ? `${people.message} — showing known names.`
                : `${roster.length} ${roster.length === 1 ? "person" : "people"} across the org.`}
          </p>
        </div>
        {people.status === "loading" ? (
          <ul className="about-people about-people--skeleton" aria-hidden>
            {Array.from({ length: 4 }, (_, i) => (
              <li key={i} className="about-person about-person--skeleton" />
            ))}
          </ul>
        ) : (
          <ul className="about-people">
            {roster.map((p) => (
              <li key={p.login} className="about-person">
                <button type="button" className="about-person__btn" onClick={() => openUrl(p.htmlUrl)}>
                  <img
                    className="about-person__avatar"
                    src={p.avatarUrl}
                    alt=""
                    width={40}
                    height={40}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                  <span className="about-person__copy">
                    <span className="about-person__name">{p.login}</span>
                    <span className="about-person__meta">
                      {p.isMember ? "Member" : "Contributor"}
                      {p.contributions > 0 ? ` · ${p.contributions} commits` : null}
                      {p.repos.length ? ` · ${p.repos.slice(0, 2).join(", ")}` : null}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="about-block">
        <div className="about-block__head">
          <h2 className="about-block__title">Open source licenses</h2>
          <p className="about-block__sub">Projects this Hub leans on. Tap a row for the project page.</p>
        </div>
        <ul className="about-licenses">
          {LICENSES.map((row) => {
            const open = openLicense === row.name;
            return (
              <li key={row.name} className={`about-license${open ? " is-open" : ""}`}>
                <button
                  type="button"
                  className="about-license__row"
                  aria-expanded={open}
                  onClick={() => setOpenLicense(open ? null : row.name)}
                >
                  <span className="about-license__name">{row.name}</span>
                  <span className="about-license__tag">{row.license}</span>
                </button>
                {open ? (
                  <div className="about-license__body">
                    <p>{row.role}</p>
                    <button type="button" className="btn-outline btn-outline--sm" onClick={() => openUrl(row.url)}>
                      Open project
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      <p className="about-footnote">
        OMEN is a trademark of HP. This project is not affiliated with or endorsed by HP.
      </p>
    </section>
  );
}
