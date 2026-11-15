// Writes the notes of a release from reports/stats.json (scripts/validate.ts): one row per zip
// and what changed since the previous release (read back from the table in that release's notes).
//
// usage: node scripts/release-notes.ts [--previous previous.json] [--out reports/release-notes.md]
//   previous.json is `gh release view --json tagName,body`; left out for the first release.
import { existsSync, readFileSync, writeFileSync } from "fs";
import type { Stats } from "./validate.ts";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args[i + 1];
};

const stats = JSON.parse(readFileSync("reports/stats.json", "utf-8")) as Stats[];
const previousPath = arg("previous");
const previous =
  previousPath && existsSync(previousPath)
    ? (JSON.parse(readFileSync(previousPath, "utf-8") || "{}") as {
        tagName?: string;
        body?: string;
      })
    : {};

const count = (n: number) => n.toLocaleString("en");

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
  // Rows of the table above, as written into the previous release.
  const before = new Map(
    [...previous.body.matchAll(/^\| `([^`]+)` \|[^|]*\| ([\d,]+) \|/gm)].map(
      (m) => [m[1]!, Number(m[2]!.replaceAll(",", ""))],
    ),
  );
  const changed = stats
    .map((s) => ({ ...s, was: before.get(s.file) }))
    .filter((s) => s.was !== s.entries)
    .map(
      (s) =>
        `- \`${s.file}\`: ${s.was === undefined ? "new" : `${count(s.was)} → ${count(s.entries)} entries (${s.entries > s.was ? "+" : ""}${count(s.entries - s.was)})`}`,
    );
  if (before.size) {
    lines.push("", `## Changes since ${previous.tagName}`, "");
    lines.push(...(changed.length ? changed : ["- Entry counts are unchanged."]));
  }
}

lines.push(
  "",
  "**Import:** Yomitan → Settings → Dictionaries → Import → pick a zip. " +
    "**Update:** the zips are self-updating: Yomitan → Settings → Dictionaries → *Check for updates*.",
);

const out = arg("out") ?? "reports/release-notes.md";
writeFileSync(out, lines.join("\n") + "\n");
console.log(`wrote ${out}`);
