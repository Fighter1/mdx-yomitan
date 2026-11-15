import {
  addEntryRows,
  addRows,
  annotatePinyin,
  entryLinkTarget,
  lookupLink,
  normalizeReading,
  readingSpans,
  type DictionaryPair,
  type ParsedTerm,
} from "../shared.ts";
import * as cheerio from "cheerio";
import type {
  DetailedDefinition,
  StructuredContentNode,
} from "yomichan-dict-builder/dist/types/yomitan/termbank";
import { ElementType } from "domelementtype";
import type { AnyNode, Element, Text } from "domhandler";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createHash } from "crypto";

// Empty elements the original stylesheet hangs its indentation on; the enclosing dd/dt carries
// the same name as its class, which is what styles-guifan.css uses.
const EMPTY_MARKERS = new Set([
  "x-ext",
  "x-ext1",
  "x-sblt",
  "x-sbl0t",
  "x-sbl2t",
  "x-sbl3t",
]);
// Not shown by the original either: the "○" bullet and a copyright line.
const HIDDEN = new Set(["script", "x-sbl0", "x-sblc"]);
// Stands in for a glyph image while a header is read as text.
const GLYPH_IMAGE = "〓";
// What a list of traditional/variant forms may consist of, once sense numbers are taken out.
const VARIANT_LIST = /^[\p{Script=Han}〓*＊、，;；—–\-\s]+$/u;
const READING_SEPARATORS = /-|\/\//g;

const isText = (node: AnyNode | undefined): node is Text =>
  node?.type === ElementType.Text;
const isTag = (node: AnyNode | undefined, ...names: string[]): node is Element =>
  node?.type === ElementType.Tag && names.includes(node.tagName);
const isBlank = (node: AnyNode) => isText(node) && node.data.trim() === "";

/** The glyph images are inline base64 pngs; each distinct one goes into both zips once. */
function glyphImages(dics: DictionaryPair) {
  const dir = mkdtempSync(join(tmpdir(), "guifan-img-"));
  const added = new Set<string>();
  return {
    async add(src: string): Promise<string> {
      const hash = createHash("sha256").update(src).digest("hex");
      const zipPath = `img/${hash}.png`;
      if (!added.has(hash)) {
        added.add(hash);
        const file = join(dir, `${hash}.png`);
        writeFileSync(
          file,
          Buffer.from(src.replace(/^data:\w+\/\w+;base64,/, ""), "base64"),
        );
        await Promise.all(dics.map((dic) => dic.addFile(file, zipPath)));
      }
      return zipPath;
    },
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}

type Context = {
  $: cheerio.CheerioAPI;
  headword: string;
  images: ReturnType<typeof glyphImages>;
};

const readingData = (system: "pinyin" | "zhuyin") => ({
  guifan: `reading-${system}`,
});
const inlineReading = (pinyin: string, headword: string) =>
  readingSpans(pinyin, readingData, headword);
// a link to another reading of the same entry has that reading as its text: "另见 qiú", "另见 le"
const ONLY_LATIN = /^[\p{Script=Latin}\p{M}'’ ]+$/u;

async function traverse(
  ctx: Context,
  node: AnyNode,
): Promise<StructuredContentNode> {
  switch (node.type) {
    case ElementType.Text:
      // the source writes pinyin into its text ("专长（cháng）", "通常读 wàn")
      return annotatePinyin(node.data.trim(), readingData, ctx.headword);
    case ElementType.Tag: {
      if (HIDDEN.has(node.tagName)) return "";
      const cheerioEl = ctx.$(node);
      const contents = await traverseAll(ctx, cheerioEl.contents().toArray());
      if (EMPTY_MARKERS.has(node.tagName) && contents.length === 0) return "";
      const def = {
        tag: "span",
        content: contents,
        data: {
          guifan: node.tagName,
          class: node.attribs["class"],
        } as Record<string, string>,
      } satisfies StructuredContentNode;
      switch (node.tagName) {
        case "x-hw":
        case "x-hws":
          def.data.guifan = "simp";
          return def;
        // the reading of a sub-headword or of a word inside a definition; the section's own
        // reading never gets here (see processGuifan)
        case "x-pr":
          return {
            ...def,
            content: inlineReading(cheerioEl.text().trim(), ctx.headword),
          };
        case "a": {
          if (contents.length === 0) return "";
          const href = node.attribs["href"];
          const text = cheerioEl.text().trim();
          // "#qiú" jumps to another reading section of this same entry
          if (href?.startsWith("#")) {
            return lookupLink(
              ctx.headword,
              ONLY_LATIN.test(text)
                ? inlineReading(text, ctx.headword)
                : contents,
            );
          }
          return lookupLink(entryLinkTarget(href) ?? text, contents);
        }
        case "img": {
          const src = node.attribs["src"];
          if (!src) return "";
          return {
            tag: "img",
            path: await ctx.images.add(src),
            collapsed: false,
            collapsible: false,
            height: 1.2,
            sizeUnits: "em",
          };
        }
        case "x-hwp":
          return ["←", def];
        case "br":
          return "\n";
        default:
          return def;
      }
    }
    case ElementType.Script:
      return "";
    default:
      throw new Error(
        `${ctx.headword}: unexpected node of type ${node.type} in the source`,
      );
  }
}

async function traverseAll(
  ctx: Context,
  nodes: AnyNode[],
): Promise<StructuredContentNode[]> {
  const out: StructuredContentNode[] = [];
  for (const node of nodes) {
    const content = await traverse(ctx, node);
    if (content !== "") out.push(content);
  }
  return out;
}

/** "yōu，又读yāo" / "dàhuáng（旧读dàihuáng）": the reading, and the note that follows it. */
function splitReadingNote(raw: string) {
  const note = raw.match(/^(.*?)[，,]?\s*[（(]?((?:又|旧)读)\s*(.+?)[）)]?\s*$/);
  return note
    ? { reading: note[1]!, noteLabel: note[2]!, noteReading: note[3]!.trim() }
    : { reading: raw };
}

/**
 * The list of traditional/variant forms that may follow the reading: `（專*耑）`,
 * `（<x-sn>①</x-sn>—<x-sn>③</x-sn>醜）`, `（畝*<img>*畮）`, once (苏¹) after a `<br>`.
 * Only a parenthesis made of nothing but characters and their markers counts; a definition that
 * happens to start with a parenthesis does not.
 */
function findVariantList(nodes: AnyNode[], start: number) {
  let cursor = start;
  const lineBreak = isTag(nodes[cursor], "br") ? [nodes[cursor++]!] : [];
  const run: AnyNode[] = [];
  while (isText(nodes[cursor]) || isTag(nodes[cursor], "x-sn", "img")) {
    run.push(nodes[cursor++]!);
  }
  const text = run
    .map((n) => (isText(n) ? n.data : isTag(n, "img") ? GLYPH_IMAGE : ""))
    .join("")
    .trim();
  const [, forms, trailing] = text.match(/^（([^（）]*)）(.*)$/s) ?? [];
  if (forms === undefined || !VARIANT_LIST.test(forms)) return undefined;
  // text after the closing parenthesis belongs to the definition; it can only be kept apart
  // when the whole list is one text node
  if (trailing && run.length > 1) return undefined;
  return { forms, run, lineBreak, trailing: trailing ?? "", end: cursor };
}

export async function processGuifan(terms: ParsedTerm[], dics: DictionaryPair) {
  const images = glyphImages(dics);
  let i = 0;
  // One sequence number per dictionary entry (a reading section of a headword), shared by the
  // simplified and traditional rows and by both editions.
  let sequence = 0;
  // <x-hwp> sub-headwords ("哈达" inside 哈): the section that defines each and its reading.
  // The @@@LINK entries of the MDX redirect to them.
  const subHeadwords = new Map<
    string,
    { definition: DetailedDefinition; reading: string }
  >();
  const links = new Map<string, string>();
  for (const term of terms) {
    const linkMatch = term.xmlString.match(/^@@@LINK=(.+)$/m);
    if (linkMatch) {
      links.set(term.headword, linkMatch[1]!.trim());
      continue;
    }
    // An <hr> starts the next reading section. Some sit inside an element the source never
    // closes, so the markup is split rather than the parsed tree.
    for (const sectionHtml of term.xmlString.split(/<hr\s*\/?>/)) {
      const $ = cheerio.load(sectionHtml, null, false);
      const ctx: Context = { $, headword: term.headword, images };
      const root: cheerio.Cheerio<AnyNode> = $(".HYGF2").length ? $(".HYGF2").first() : $.root();
      let nodes = root
        .contents()
        .toArray()
        .filter((n) => !isBlank(n) && !isTag(n, "link"));
      // one section (饹 le) has its header inside the first <dt>
      const first = nodes[0];
      if (isTag(first, "dt") && $(first).children("x-hw, x-hws").length) {
        nodes = [
          ...$(first)
            .contents()
            .toArray()
            .filter((n) => !isBlank(n)),
          ...nodes.slice(1),
        ];
      }

      // header: the headword, its reading, then possibly the variant forms
      const firstBlock = nodes.findIndex((n) => isTag(n, "dt", "dd", "br"));
      const readingIndex = nodes.findIndex((n) => isTag(n, "x-pr"));
      const hasReading =
        readingIndex >= 0 && (firstBlock < 0 || readingIndex < firstBlock);
      const head = hasReading ? nodes.slice(0, readingIndex) : [];
      const { reading, noteLabel, noteReading } = splitReadingNote(
        hasReading ? $(nodes[readingIndex]!).text() : "",
      );
      const variants = hasReading
        ? findVariantList(nodes, readingIndex + 1)
        : undefined;

      const content = await traverseAll(ctx, head);
      if (variants) {
        const shown = await traverseAll(ctx, variants.run);
        // the parentheses themselves are not shown
        const last = shown.length - 1;
        if (typeof shown[0] === "string") {
          shown[0] = shown[0].replace(/^（/, "");
        }
        if (typeof shown[last] === "string") {
          shown[last] = shown[last].replace(/）[^）]*$/, "");
        }
        const visible = shown.filter((c) => c !== "");
        content.push({
          tag: "span",
          content:
            visible.length === 1 && typeof visible[0] === "string"
              ? visible[0]
              : visible,
          data: { guifan: "trad" },
          lang: "zh-TW",
        });
      }
      if (noteLabel) {
        content.push({
          tag: "span",
          content: [
            `（${noteLabel}`,
            ...inlineReading(noteReading, term.headword),
            "）",
          ],
          data: { guifan: "reading-note" },
        });
      }
      if (variants) {
        content.push(...(await traverseAll(ctx, variants.lineBreak)));
        if (variants.trailing.trim()) content.push(variants.trailing.trim());
      }
      content.push(
        ...(await traverseAll(
          ctx,
          nodes.slice(
            variants ? variants.end : hasReading ? readingIndex + 1 : 0,
          ),
        )),
      );

      const definition = {
        type: "structured-content",
        content: {
          tag: "span",
          content,
          data: { guifan: "definitions-parent" },
          lang: "zh-CN",
        },
      } satisfies DetailedDefinition;

      $("x-hwp").each((_, el) => {
        let next = el.next ?? undefined;
        while (next && isBlank(next)) next = next.next ?? undefined;
        const subHeadword = $(el).text().trim();
        if (!subHeadwords.has(subHeadword)) {
          subHeadwords.set(subHeadword, {
            definition,
            reading: isTag(next, "x-pr")
              ? normalizeReading($(next).text(), READING_SEPARATORS)
              : "",
          });
        }
      });

      // When the key's own character is drawn as an image, a longer header is a word that
      // contains it ("懊" + image under the key 𢙐 is 懊𢙐), not the key itself.
      let headword = term.headword;
      if (!head.some((n) => isTag(n, "x-hw", "x-hws"))) {
        const glyphs = head
          .map((n) => (isTag(n, "img") ? GLYPH_IMAGE : $(n).text().trim()))
          .join("");
        if (
          [...term.headword].length === 1 &&
          [...glyphs].length > 1 &&
          glyphs.split(GLYPH_IMAGE).length === 2
        ) {
          headword = glyphs.replace(GLYPH_IMAGE, term.headword);
        }
      }

      await addEntryRows(
        dics,
        headword,
        variants?.forms ?? "",
        normalizeReading(reading, READING_SEPARATORS),
        definition,
        ++sequence,
      );
    }
    if (++i % 10000 === 0) {
      console.log(`Processed ${i} terms.`);
    }
  }

  // linked (@@@LINK) headwords are separate entries that reuse the section of the character
  // they are defined under
  for (const [headword, target] of links) {
    const subHeadword = subHeadwords.get(headword);
    if (!subHeadword) {
      throw new Error(
        `${headword} redirects to ${target}, but no section defines it as a sub-headword`,
      );
    }
    await addRows(
      dics,
      headword,
      subHeadword.reading,
      subHeadword.definition,
      ++sequence,
    );
  }
  console.log(`Processed ${links.size} linked terms.`);
  images.dispose();
}
