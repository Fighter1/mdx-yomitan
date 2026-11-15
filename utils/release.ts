import { execFileSync } from "child_process";

// Yomitan compares revisions number by number only when both are dot-separated integers with the
// same number of segments, and falls back to a string comparison otherwise ("….10" < "….9").
// So always emit four: Y.M.D.N, where N is a build number (0 locally, the run number in a release).
export const REVISION_RE = /^\d{4}\.\d{2}\.\d{2}\.\d+$/;

export function checkRevision(revision: string): string {
  if (!REVISION_RE.test(revision)) {
    throw new Error(
      `revision "${revision}" must be four dot-separated integers (e.g. 2026.11.15.7) so Yomitan can compare it numerically`,
    );
  }
  return revision;
}

/**
 * `REVISION` from the environment (set by the release workflow), else today's UTC date + ".0", so
 * a local or CI build never outranks a release of the same day.
 */
export function resolveRevision(): string {
  const fromEnv = process.env.REVISION?.trim();
  if (fromEnv) return checkRevision(fromEnv);
  return `${new Date().toISOString().slice(0, 10).replaceAll("-", ".")}.0`;
}

const DEFAULT_REPO = "Fighter1/mdx-yomitan";
// https://github.com/o/r.git, https://user@github.com/o/r, git@github.com:o/r.git,
// ssh://git@github.com:22/o/r.git, ssh://git@ssh.github.com:443/o/r.git, git://github.com/o/r
const GITHUB_REMOTE =
  /^(?:(?:https?|ssh|git):\/\/)?(?:[^@/]+@)?(?:ssh\.)?github\.com(?::\d+)?[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/i;

export function repoFromRemoteUrl(url: string): string | undefined {
  const m = url.trim().match(GITHUB_REMOTE);
  return m ? `${m[1]}/${m[2]}` : undefined;
}

function originRepo(): string | undefined {
  let url: string;
  try {
    url = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined; // not a git checkout, or no remote called origin
  }
  const repo = repoFromRemoteUrl(url);
  if (!repo) {
    // e.g. an SSH host alias; guessing here would point the zips at somebody else's releases
    throw new Error(
      `cannot tell the GitHub repository from the origin remote "${url.trim()}"; set GITHUB_REPOSITORY=owner/name`,
    );
  }
  return repo;
}

/**
 * "owner/name" of the repository whose latest release Yomitan asks for updates:
 * `GITHUB_REPOSITORY` in GitHub Actions, else whatever the `origin` remote points at, so a fork's
 * zips point at the fork. Outside a git checkout it is this project's own repository.
 */
export function resolveRepo(): string {
  return process.env.GITHUB_REPOSITORY?.trim() || originRepo() || DEFAULT_REPO;
}

/** `releases/latest/download/<asset>` always redirects to that asset of the newest release. */
export function releaseBaseUrl(repo: string): string {
  return `https://github.com/${repo}/releases/latest/download`;
}
