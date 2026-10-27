export const GITHUB_ORG = "OmenLinux";
export const GITHUB_API = "https://api.github.com";

export type GitHubPerson = {
  login: string;
  avatarUrl: string;
  htmlUrl: string;
  contributions: number;
  repos: string[];
  isMember: boolean;
};

type GhUser = {
  login: string;
  avatar_url: string;
  html_url: string;
  type?: string;
};

type GhContributor = GhUser & {
  contributions: number;
};

type GhRepo = {
  name: string;
  fork: boolean;
  archived: boolean;
};

const SKIP_LOGINS = new Set([
  "dependabot[bot]",
  "dependabot",
  "github-actions[bot]",
  "github-actions",
  "renovate[bot]",
  "renovate",
]);

/** Offline / rate-limit fallback so Credits never looks empty. */
export const FALLBACK_PEOPLE: GitHubPerson[] = [
  {
    login: "alessandromrc",
    avatarUrl: "https://github.com/alessandromrc.png",
    htmlUrl: "https://github.com/alessandromrc",
    contributions: 0,
    repos: ["omen-rgb-keyboard", "omen-rgb-keyboard-ui"],
    isMember: true,
  },
];

async function ghJson<T>(path: string): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function isHuman(login: string, type?: string): boolean {
  if (SKIP_LOGINS.has(login)) return false;
  if (login.endsWith("[bot]")) return false;
  if (type && type !== "User") return false;
  return true;
}

function upsert(
  byLogin: Map<string, GitHubPerson>,
  user: GhUser,
  extras: { contributions?: number; repo?: string; isMember?: boolean },
) {
  if (!isHuman(user.login, user.type)) return;
  const prev = byLogin.get(user.login);
  if (prev) {
    prev.contributions += extras.contributions ?? 0;
    if (extras.repo && !prev.repos.includes(extras.repo)) prev.repos.push(extras.repo);
    if (extras.isMember) prev.isMember = true;
    return;
  }
  byLogin.set(user.login, {
    login: user.login,
    avatarUrl: user.avatar_url,
    htmlUrl: user.html_url,
    contributions: extras.contributions ?? 0,
    repos: extras.repo ? [extras.repo] : [],
    isMember: Boolean(extras.isMember),
  });
}

/** Aggregate public org members + contributors across OmenLinux repos. */
export async function fetchCollaborators(): Promise<GitHubPerson[]> {
  const byLogin = new Map<string, GitHubPerson>();

  // /members requires auth and 404s anonymously — use public_members.
  const [membersSettled, reposSettled] = await Promise.allSettled([
    ghJson<GhUser[]>(`/orgs/${GITHUB_ORG}/public_members?per_page=100`),
    ghJson<GhRepo[]>(`/orgs/${GITHUB_ORG}/repos?per_page=100&type=public&sort=updated`),
  ]);

  if (membersSettled.status === "fulfilled") {
    for (const m of membersSettled.value) {
      upsert(byLogin, m, { isMember: true });
    }
  }

  const repos =
    reposSettled.status === "fulfilled"
      ? reposSettled.value.filter((r) => !r.fork && !r.archived).slice(0, 24)
      : [];

  if (reposSettled.status === "rejected" && membersSettled.status === "rejected") {
    throw new Error("Could not reach GitHub");
  }

  await Promise.all(
    repos.map(async (repo) => {
      try {
        const people = await ghJson<GhContributor[]>(
          `/repos/${GITHUB_ORG}/${repo.name}/contributors?per_page=100`,
        );
        for (const c of people) {
          upsert(byLogin, c, { contributions: c.contributions, repo: repo.name });
        }
      } catch {
        /* skip repo on rate limit / private */
      }
    }),
  );

  const list = [...byLogin.values()].sort((a, b) => {
    if (a.isMember !== b.isMember) return a.isMember ? -1 : 1;
    return b.contributions - a.contributions || a.login.localeCompare(b.login);
  });

  return list.length ? list : FALLBACK_PEOPLE;
}
