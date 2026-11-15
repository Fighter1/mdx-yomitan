// Checks the zips in build/ the way Yomitan will when it imports and updates them:
//   - index.json and every term/tag bank against Yomitan's JSON schemas (schemas/)
//   - isUpdatable + indexUrl/downloadUrl point at this repository's latest release, the sidecar
//     index file next to the zip is the zip's own index.json, the revision has the shape Yomitan
//     compares number by number and is the same in every zip
//   - the golden words (data/golden_words.tsv) are there with their readings
//   - every image a definition refers to is in the zip, no U+FFFD (mangled astral characters)
//   - the 拼音 and 注音 editions of a dictionary have the same number of entries and terms
// Writes reports/stats.json (read by scripts/release-notes.ts) and, in GitHub Actions, a job summary.
//
// usage: node scripts/validate.ts [--repo owner/name] [--revision 2026.11.15.7]
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs";
import { isDeepStrictEqual } from "util";
import Ajv, { type ValidateFunction } from "ajv";
import JSZip from "jszip";
import { REVISION_RE, releaseBaseUrl, resolveRepo } from "../utils/release.ts";

const BUILD_DIR = "build";
const STEMS = [
  "guifan-pinyin",
  "guifan-zhuyin",
  "hanyu7-pinyin",
  "hanyu7-zhuyin",
];
const GOLDEN_WORDS_FILE = "data/golden_words.tsv";
const MAX_PROBLEMS_SHOWN = 40;

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args[i + 1];
};
const repo = arg("repo") ?? resolveRepo();
const expectedRevision = arg("revision");
const releaseBase = releaseBaseUrl(repo);

type TermRow = [
  term: string,
  reading: string,
  definitionTags: string | null,
  rules: string,
  score: number,
  glossary: unknown[],
  sequence: number,
  termTags: string,
];

// entries: distinct sequence numbers (one per dictionary entry); terms: rows, which also include
// the rows filed under a variant form and under each reading
export type Stats = {
  file: string;
  title: string;
  revision: string;
  entries: number;
  terms: number;
  images: number;
  bytes: number;
};

const ajv = new Ajv({ strict: false });
const schema = (name: string): ValidateFunction =>
  ajv.compile(
    JSON.parse(readFileSync(`schemas/dictionary-${name}-schema.json`, "utf-8")),
  );
const validators: Record<"index" | "term" | "tag", ValidateFunction> = {
  index: schema("index"),
  term: schema("term-bank-v3"),
  tag: schema("tag-bank-v3"),
};
const schemaErrors = (validate: ValidateFunction): string =>
  (validate.errors ?? [])
    .slice(0, 3)
    .map((e) => `${e.instancePath || "/"} ${e.message}`)
    .join("; ");

/** stem → the `term\treading` pairs that must be present in that zip. */
function readGoldenWords(): Map<string, string[]> {
  const golden = new Map<string, string[]>();
  for (const line of readFileSync(GOLDEN_WORDS_FILE, "utf-8").split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [stem, term, reading] = line.split("\t");
    if (!stem || !term || reading === undefined || !STEMS.includes(stem)) {
      throw new Error(`${GOLDEN_WORDS_FILE}: cannot parse "${line}"`);
    }
    golden.set(stem, [...(golden.get(stem) ?? []), `${term}\t${reading}`]);
  }
  return golden;
}

/** Paths of the images a glossary shows (structured-content `img` nodes and `image` definitions). */
function collectImagePaths(node: unknown, out: Set<string>) {
  if (Array.isArray(node)) {
    for (const child of node) collectImagePaths(child, out);
  } else if (node && typeof node === "object") {
    const { tag, type, path, content } = node as Record<string, unknown>;
    if ((tag === "img" || type === "image") && typeof path === "string") {
      out.add(path);
    }
    collectImagePaths(content, out);
  }
}

const stats: Stats[] = [];
const problems: string[] = [];

async function checkZip(stem: string, goldenWords: string[]) {
  const file = `${stem}.zip`;
  const fail = (message: string) => problems.push(`${file}: ${message}`);
  const zipPath = `${BUILD_DIR}/${file}`;
  const sidecarPath = `${BUILD_DIR}/index-${stem}.json`;
  if (!existsSync(zipPath)) return fail(`not in ${BUILD_DIR}/`);

  const zip = await JSZip.loadAsync(readFileSync(zipPath));
  const names = new Set(
    Object.keys(zip.files).filter((name) => !zip.files[name]!.dir),
  );
  // JSZip's own string decoding has the same chunk-boundary problem as its encoding; take bytes.
  const text = async (name: string) =>
    (await zip.file(name)!.async("nodebuffer")).toString("utf-8");

  // index.json
  if (!names.has("index.json")) return fail("no index.json");
  const index = JSON.parse(await text("index.json")) as Record<string, unknown>;
  if (!validators.index(index)) {
    fail(`index.json: ${schemaErrors(validators.index)}`);
  }
  const revision = String(index.revision ?? "");
  if (!REVISION_RE.test(revision)) {
    fail(
      `revision "${revision}" is not four dot-separated integers, so Yomitan would compare it as text`,
    );
  }
  if (expectedRevision && revision !== expectedRevision) {
    fail(`revision is ${revision}, expected ${expectedRevision}`);
  }
  // What Yomitan's "Check for updates" needs: it fetches indexUrl, compares revisions and, if the
  // published one is newer, downloads downloadUrl.
  if (index.isUpdatable !== true) fail("index.json has no isUpdatable: true");
  if (index.indexUrl !== `${releaseBase}/index-${stem}.json`) {
    fail(
      `indexUrl is ${index.indexUrl}, expected ${releaseBase}/index-${stem}.json`,
    );
  }
  if (index.downloadUrl !== `${releaseBase}/${file}`) {
    fail(`downloadUrl is ${index.downloadUrl}, expected ${releaseBase}/${file}`);
  }
  if (!existsSync(sidecarPath)) {
    fail(`${sidecarPath} (the indexUrl asset) is missing`);
  } else if (
    !isDeepStrictEqual(JSON.parse(readFileSync(sidecarPath, "utf-8")), index)
  ) {
    fail(`${sidecarPath} differs from the zip's index.json`);
  }

  // term and tag banks
  let terms = 0;
  const present = new Set<string>();
  const sequences = new Set<number>();
  const images = new Set<string>();
  for (const name of [...names].sort()) {
    const kind = /^term_bank_\d+\.json$/.test(name)
      ? "term"
      : /^tag_bank_\d+\.json$/.test(name)
        ? "tag"
        : undefined;
    if (!kind) continue;
    const raw = await text(name);
    if (raw.includes("�")) {
      fail(
        `${name} contains U+FFFD (a character was mangled on the way into the zip)`,
      );
    }
    const bank = JSON.parse(raw) as unknown[];
    if (!validators[kind](bank)) {
      fail(`${name}: ${schemaErrors(validators[kind])}`);
      continue;
    }
    if (kind === "term") {
      terms += bank.length;
      for (const row of bank as TermRow[]) {
        present.add(`${row[0]}\t${row[1]}`);
        sequences.add(row[6]);
        collectImagePaths(row[5], images);
      }
    }
  }
  if (!terms) fail("no term entries");
  for (const word of goldenWords) {
    if (!present.has(word)) {
      fail(`golden word missing: ${word.replace("\t", " [")}]`);
    }
  }
  const missing = [...images].filter((image) => !names.has(image));
  if (missing.length) {
    fail(
      `${missing.length} images are referenced but not in the zip, e.g. ${missing.slice(0, 3).join(", ")}`,
    );
  }
  if (!names.has("styles.css")) fail("no styles.css");
  else if ((await text("styles.css")).includes("\r")) {
    fail("styles.css has CRLF line endings");
  }

  stats.push({
    file,
    title: String(index.title ?? ""),
    revision,
    entries: sequences.size,
    terms,
    images: [...names].filter((n) => n.startsWith("img/")).length,
    bytes: statSync(zipPath).size,
  });
  console.log(
    `${file}: ${sequences.size.toLocaleString("en")} entries, ${terms.toLocaleString("en")} terms, ${images.size} images referenced, revision ${revision}`,
  );
}

const golden = readGoldenWords();
for (const stem of STEMS) await checkZip(stem, golden.get(stem) ?? []);

// The 拼音 and 注音 editions of a dictionary are the same rows with different readings.
for (const pinyin of stats.filter((s) => s.file.endsWith("-pinyin.zip"))) {
  const zhuyin = stats.find(
    (s) => s.file === pinyin.file.replace("-pinyin.zip", "-zhuyin.zip"),
  );
  if (
    zhuyin &&
    (zhuyin.entries !== pinyin.entries || zhuyin.terms !== pinyin.terms)
  ) {
    problems.push(
      `${pinyin.file} and ${zhuyin.file} have different entry or term counts`,
    );
  }
}
if (new Set(stats.map((s) => s.revision)).size > 1) {
  problems.push("the zips do not all carry the same revision");
}

mkdirSync("reports", { recursive: true });
writeFileSync("reports/stats.json", JSON.stringify(stats, null, 2) + "\n");

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    `### Dictionaries (${problems.length ? `${problems.length} problems` : "valid"})`,
    "",
    "| file | dictionary | revision | entries | terms | size |",
    "|---|---|---|---:|---:|---:|",
    ...stats.map(
      (s) =>
        `| \`${s.file}\` | ${s.title} | ${s.revision} | ${s.entries.toLocaleString("en")} | ${s.terms.toLocaleString("en")} | ${(s.bytes / 1e6).toFixed(1)} MB |`,
    ),
    "",
    ...problems.slice(0, MAX_PROBLEMS_SHOWN).map((p) => `- ❌ ${p}`),
  ];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
}

if (problems.length) {
  console.error(`\n${problems.length} problems:`);
  for (const p of problems.slice(0, MAX_PROBLEMS_SHOWN)) console.error(`  ${p}`);
  if (problems.length > MAX_PROBLEMS_SHOWN) {
    console.error(`  … and ${problems.length - MAX_PROBLEMS_SHOWN} more`);
  }
  process.exit(1);
}
console.log(`\n${STEMS.length} zips valid; update URLs under ${releaseBase}/`);
