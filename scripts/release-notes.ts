// Writes the notes of a release from reports/stats.json (scripts/validate.ts): one row per zip
// and what changed since the previous release. The counts of that release are read back from
// the table in its notes; the commits since then come from GitHub. The section ends with a link
// to GitHub's comparison of the two tags; the release is created without GitHub's own notes.
//
// usage: node scripts/release-notes.ts [--previous previous.json] [--commits commits.json]
//                                      [--out reports/release-notes.md]
//   previous.json is `gh release view --json tagName,body`; left out for the first release.
//   commits.json is `gh api repos/OWNER/REPO/compare/PREVIOUS_TAG...HEAD
//     --jq '[.commits[] | {sha, message: .commit.message}]'`, oldest first; optional.
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolveRepo } from "../utils/release.ts";
import type { Stats } from "./validate.ts";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args[i + 1];
};
/** The JSON in the file the option names; `fallback` when the option or the file is missing. */
function readJson<T>(option: string, fallback: T): T {
  const path = arg(option);
  if (!path || !existsSync(path)) return fallback;
  return (JSON.parse(readFileSync(path, "utf-8") || "null") as T | null) ?? fallback;
}

const stats = JSON.parse(readFileSync("reports/stats.json", "utf-8")) as Stats[];
const previous = readJson<{ tagName?: string; body?: string }>("previous", {});
// undefined: the commits could not be listed, which is not the same as there being none
const commits = readJson<{ sha: string; message: string }[] | undefined>("commits", undefined);
const MAX_LISTED_COMMITS = 40;

const count = (n: number) => n.toLocaleString("en");
/** A count next to what it was in the previous release: "114,442 (+38,849)", "70,115 (same)". */
function delta(now: number, was: number | undefined): string {
  if (was === undefined) return `${count(now)} (new)`;
  if (now === was) return `${count(now)} (same)`;
  return `${count(now)} (${now > was ? "+" : "-"}${count(Math.abs(now - was))})`;
}

const lines = [
  `现代汉语规范词典 and 现代汉语词典 for Yomitan, revision ${stats[0]?.revision}.`,
  "",
  "| file | dictionary | entries | terms | size |",
  "|---|---|---:|---:|---:|",
  ...stats.map(
    (s) =>
      `| \`${s.file}\` | ${s.title} | ${count(s.entries)} | ${count(s.terms)} | ${(s.bytes / 1e6).toFixed(1)} MB |`,
  ),
];

if (previous.tagName && previous.body) {
  // Rows of the table above, as written into the previous release: file → entries and terms.
  const number = (text: string) => Number(text.replaceAll(",", ""));
  const before = new Map(
    [
      ...previous.body.matchAll(/^\| `([^`]+)` \|[^|]*\| ([\d,]+) \| ([\d,]+) \|/gm),
    ].map((m) => [m[1]!, { entries: number(m[2]!), terms: number(m[3]!) }]),
  );
  // without merge commits, which only repeat what the merged commits say
  const subjects = commits
    ?.map(({ message }) => message.split("\n")[0]!.trim())
    .filter((subject) => subject && !/^Merge (branch|pull request|remote-tracking) /.test(subject));

  // The same layout as the notes of Baidu-Baike-Yomitan: the counts with their change, then
  // the commits. A part that cannot be worked out is left out.
  const section: string[] = [];
  // a release whose notes were written by hand has no table to compare with
  if (before.size) {
    // entries are what the dictionary defines; terms are the spellings and readings they are
    // found by, which is where a change like added traditional forms shows
    section.push(
      "| file | entries | terms |",
      "|---|---:|---:|",
      ...stats.map((s) => {
        const was = before.get(s.file);
        return `| \`${s.file}\` | ${delta(s.entries, was?.entries)} | ${delta(s.terms, was?.terms)} |`;
      }),
      "",
    );
  }
  if (subjects?.length) {
    const shown = subjects.slice(0, MAX_LISTED_COMMITS);
    section.push(
      `**Code:** ${subjects.length} commit${subjects.length === 1 ? "" : "s"}.`,
      ...shown.map((subject) => `- ${subject}`),
      ...(subjects.length > shown.length ? [`- … and ${subjects.length - shown.length} more`] : []),
    );
  } else if (subjects) {
    section.push("**Code:** no commits; the same code as the previous release.");
  }
  // GitHub's comparison of the two tags. Written here rather than by `gh release create
  // --generate-notes`, which would also list merged pull requests, a second time, and puts its
  // link at the very end of the notes.
  const span = `${previous.tagName}...v${stats[0]?.revision}`;
  if (section.at(-1) === "") section.pop();
  if (section.length) section.push("");
  section.push(
    `**Full Changelog**: [${span}](https://github.com/${resolveRepo()}/compare/${span})`,
  );
  lines.push("", `## Changes since ${previous.tagName}`, "", ...section);
}

lines.push(
  "",
  "**Import:** Yomitan → Settings → Dictionaries → Import → pick a zip. " +
    "**Update:** the zips are self-updating: Yomitan → Settings → Dictionaries → *Check for updates*.",
);

const out = arg("out") ?? "reports/release-notes.md";
writeFileSync(out, lines.join("\n") + "\n");
console.log(`wrote ${out}`);
