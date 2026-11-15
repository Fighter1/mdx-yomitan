import {
  addFiles,
  readTermsFromFile,
  type DictionaryPair,
} from "./dics/shared.ts";
import {
  EDITIONS,
  FAMILIES,
  stemOf,
  titleOf,
  type Edition,
  type Family,
} from "./dics/catalog.ts";
import { Dictionary, DictionaryIndex } from "yomichan-dict-builder";
import { processGuifan } from "./dics/guifan/guifan.ts";
import { processHanyu7 } from "./dics/hanyu7/hanyu7.ts";
import { mergeCssFiles } from "./utils/css.ts";
import {
  releaseBaseUrl,
  resolveRepo,
  resolveRevision,
} from "./utils/release.ts";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// JSZip re-encodes string inputs to UTF-8 in 16 KiB chunks, so a surrogate pair (an astral CJK
// character) that straddles a chunk boundary turns into two U+FFFD characters. Hand it bytes.
// saveJsonToZip is private to the library: fail loudly if a release renames it, rather than
// quietly going back to mangled characters.
if (typeof (Dictionary.prototype as any).saveJsonToZip !== "function") {
  throw new Error(
    "yomichan-dict-builder no longer has Dictionary.saveJsonToZip; the UTF-8 fix in export.ts needs updating",
  );
}
(Dictionary.prototype as any).saveJsonToZip = async function (
  fileName: string,
  data: unknown,
) {
  this.zip.file(fileName, Buffer.from(JSON.stringify(data), "utf8"));
};

const OUT_DIR = "build";
const revision = resolveRevision();
const releaseBase = releaseBaseUrl(resolveRepo());
console.log(`revision ${revision}, update URLs under ${releaseBase}`);

// styles.css of each zip is put together here; nothing generated is written into the source tree
const tmp = mkdtempSync(join(tmpdir(), "mdx-yomitan-"));

/** The 拼音 and 注音 zips of one dictionary, with index.json and styles.css in place. */
async function createEditions(family: Family): Promise<DictionaryPair> {
  const create = async (edition: Edition) => {
    const stem = stemOf(family, edition);
    const dic = new Dictionary({ fileName: `${stem}.zip` });
    const index = new DictionaryIndex()
      .setTitle(titleOf(family, edition))
      .setRevision(revision)
      .setAuthor("shadow")
      .setSequenced(true)
      .setAttribution(FAMILIES[family].attribution)
      .setDescription("A monolingual dictionary of Simplified Mandarin Chinese.")
      .setIsUpdatable(true)
      .setIndexUrl(`${releaseBase}/index-${stem}.json`)
      .setDownloadUrl(`${releaseBase}/${stem}.zip`)
      .setSourceLanguage("zh")
      .setTargetLanguage("zh");
    await dic.setIndex(index.build(), OUT_DIR, `index-${stem}.json`);

    // the content carries both reading systems; the edition's stylesheet hides the other one
    const css = join(tmp, `${stem}.css`);
    writeFileSync(
      css,
      mergeCssFiles([`styles-${family}.css`, `styles-${edition}-diff.css`]),
    );
    await dic.addFile(css, "styles.css");
    return dic;
  };
  return [await create("pinyin"), await create("zhuyin")];
}

const guifan = await createEditions("guifan");
const hanyu7 = await createEditions("hanyu7");

await processGuifan(
  readTermsFromFile(
    `data/mdx-guifan-2/mdx/【现代汉语规范词典(第2版)】.mdx.txt`,
  ),
  guifan,
);
await addFiles(hanyu7, "data/mdx-7/mdd");
await processHanyu7(readTermsFromFile(`data/mdx-7/mdx/现汉7.mdx.txt`), hanyu7);

for (const [family, dics] of [
  ["guifan", guifan],
  ["hanyu7", hanyu7],
] as const) {
  for (const [i, edition] of (Object.keys(EDITIONS) as Edition[]).entries()) {
    await dics[i]!.export(OUT_DIR);
    console.log(`Exported ${titleOf(family, edition)}`);
  }
}
rmSync(tmp, { recursive: true, force: true });
