import {
  addEntries,
  addRows,
  entryLinkTarget,
  lookupLink,
  normalizeReading,
  readingSpans,
  traditionalBadge,
  withTraditionalForms,
  type DictionaryPair,
  type Entry,
  type ParsedTerm,
} from "../shared.ts";
import { existsSync, readFileSync } from "fs";
import { load, type CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import type {
  DetailedDefinition,
  StructuredContentNode,
} from "yomichan-dict-builder/dist/types/yomitan/termbank";
import { ElementType } from "domelementtype";

type TableElements = "table" | "tbody" | "thead" | "tfoot" | "tr" | "td" | "th";

// "·" marks a neutral tone, "//" a place where a word can be split, "-" and "’" syllable breaks
const READING_SEPARATORS = /[-·’]|\/\//g;

// shown the way the dictionary writes it; only the conversion needs the separators resolved
const inlineReading = (pinyin: string, term: string) =>
  readingSpans(
    pinyin,
    (system) => ({ hanyu7: system }),
    term,
    normalizeReading(pinyin, READING_SEPARATORS),
  );

/**
 * `<hw>` holds the headword and, in parentheses, its traditional/variant forms:
 * `谁（誰）`, `丑<sup>2</sup>（<sup>①-④</sup>醜）`, `一股脑<small>儿</small>（一古脑<small>儿</small>）`.
 * The headword becomes the `simp` badge and what is inside the parentheses the `trad` badge,
 * which comes first: traditional on the left, the headword to its right.
 */
function headwordBadges(children: StructuredContentNode[]): StructuredContentNode[] {
  const simp = (content: StructuredContentNode) =>
    ({
      tag: "span",
      content,
      data: { hanyu7: "simp" },
    }) satisfies StructuredContentNode;
  const open = children.findIndex(
    (c) => typeof c === "string" && c.includes("（"),
  );
  if (open < 0) return [simp(children)];

  const [before, after] = splitOnFirst(children[open] as string, "（");
  const headword = [...children.slice(0, open), before].filter((c) => c !== "");
  const variants = [after, ...children.slice(open + 1)];
  // the closing parenthesis is in the last piece of text
  const close = variants.findLastIndex(
    (c) => typeof c === "string" && c.includes("）"),
  );
  if (close >= 0) {
    variants[close] = (variants[close] as string).replace(/）[^）]*$/, "");
  }
  const single = (content: StructuredContentNode[]) =>
    content.length === 1 && typeof content[0] === "string" ? content[0] : content;
  return [
    traditionalBadge(variants.filter((c) => c !== ""), [], TRAD),
    simp(single(headword)),
  ];
}
const TRAD = { hanyu7: "trad" };

/** An `<hw>` as content, and the badges the source gives it. */
type Headword = {
  node: { content: StructuredContentNode[] };
  simp: StructuredContentNode;
  /** What its `trad` badge holds; undefined when the source lists no other form. */
  listed: StructuredContentNode[] | undefined;
};

function headwordOf(node: Headword["node"]): Headword {
  // [trad, simp], or just [simp]
  const simp = node.content.at(-1)!;
  const trad = node.content.length > 1 ? node.content[0] : undefined;
  const listed =
    typeof trad === "object" && "content" in trad ? [trad.content ?? ""].flat() : undefined;
  return { node, simp, listed };
}

/**
 * Makes the `trad` badge of an `<hw>` show `forms` after the forms the source lists; without
 * either there is no such badge.
 */
function setBadges(hw: Headword, forms: string[]) {
  hw.node.content =
    hw.listed || forms.length
      ? [traditionalBadge(hw.listed ?? [], forms, TRAD), hw.simp]
      : [hw.simp];
}

function splitOnFirst(text: string, separator: string): [string, string] {
  const i = text.indexOf(separator);
  return [text.slice(0, i), text.slice(i + separator.length)];
}

type Context = {
  $: CheerioAPI;
  term: string;
  onReading: (s: string) => void;
  onVariantForms: (s: string) => void;
  onHeadword: (hw: Headword["node"]) => void;
  onGlyph: (file: string) => void;
};

// What an element passes on to everything inside it.
type Inherited = {
  // inside a table or a paragraph of the front matter
  prose: boolean;
  // the font the original stylesheet sets this text in, and how much larger than the body text
  glyphFont: "hei" | "song";
  glyphScale: number;
};
const TOP_LEVEL: Inherited = { prose: false, glyphFont: "song", glyphScale: 1 };

// Characters only the fonts shipped with the MDX have (variant characters, formulas, symbols)
// cannot be shown as text. data/mdx-7/glyphs holds a picture of each, rendered from
// data/mdx-7/hei_xdhy.ttf and song.ttf at GLYPH_EM pixels per em: glyph-<font>-<code point>.png.
const PRIVATE_USE = /(\p{Co})/u;
const GLYPH_DIR = "data/mdx-7/glyphs";
const GLYPH_EM = 128;
const glyphHeights = new Map<string, number>();

function glyphImage(
  ctx: Context,
  character: string,
  { glyphFont, glyphScale }: Inherited,
): StructuredContentNode {
  const code = character.codePointAt(0)!.toString(16).toUpperCase();
  // song.ttf lacks a glyph that hei_xdhy.ttf has
  const file = [glyphFont, "hei"]
    .map((font) => `glyph-${font}-${code}.png`)
    .find((name) => existsSync(`${GLYPH_DIR}/${name}`));
  if (!file) {
    throw new Error(
      `${ctx.term}: U+${code} needs a picture in ${GLYPH_DIR}; render it from the fonts in data/mdx-7 at ${GLYPH_EM}px per em`,
    );
  }
  if (!glyphHeights.has(file)) {
    // the height in pixels is in the PNG header
    const pixels = readFileSync(`${GLYPH_DIR}/${file}`).readUInt32BE(20);
    glyphHeights.set(file, pixels / GLYPH_EM);
  }
  ctx.onGlyph(file);
  return {
    tag: "img",
    path: `img/${file}`,
    collapsed: false,
    collapsible: false,
    height: Math.round(glyphHeights.get(file)! * glyphScale * 100) / 100,
    sizeUnits: "em",
    verticalAlign: "text-bottom",
  };
}

function traverse(
  ctx: Context,
  node: AnyNode,
  inherited: Inherited,
): StructuredContentNode {
  const { $, term } = ctx;
  switch (node.type) {
    case ElementType.Text: {
      // "～" stands for the headword, except in tables ("0～50") and in the front matter
      const text = inherited.prose
        ? node.data.trim()
        : node.data.trim().replaceAll("～", term);
      if (!PRIVATE_USE.test(text)) return text;
      return text
        .split(PRIVATE_USE)
        .filter((part) => part !== "")
        .map((part) =>
          PRIVATE_USE.test(part) ? glyphImage(ctx, part, inherited) : part,
        );
    }
    case ElementType.Tag: {
      const cheerioEl = $(node);
      // the reading of the entry itself, next to the headword
      if (node.tagName === "pinyin" && cheerioEl.parent().is("hwg")) {
        ctx.onReading(cheerioEl.text());
        return "";
      }
      const contents = cheerioEl.contents();
      const passedOn: Inherited = {
        prose:
          inherited.prose || node.tagName === "p" || node.tagName === "table",
        glyphFont:
          node.tagName === "hw" || node.tagName === "num"
            ? "hei"
            : inherited.glyphFont,
        glyphScale:
          node.tagName === "math2"
            ? 2
            : node.tagName === "math3"
              ? 3
              : inherited.glyphScale,
      };
      const def = {
        tag: "span" as "span" | TableElements,
        content: contents
          .map((_, el) => traverse(ctx, el, passedOn))
          .toArray()
          .filter((c) => c !== ""),
        data: {
          hanyu7: node.tagName,
          ...node.attribs,
        } as Record<string, string>,
      } satisfies StructuredContentNode;
      switch (node.tagName) {
        case "pinyin":
          return inlineReading(cheerioEl.text(), term);
        case "table":
        case "tbody":
        case "thead":
        case "tfoot":
        case "tr":
        case "td":
        case "th": {
          def.tag = node.tagName;
          if (node.tagName !== "td" && node.tagName !== "th") return def;
          const rowSpan = Number(node.attribs["rowspan"]);
          const colSpan = Number(node.attribs["colspan"]);
          return {
            ...def,
            tag: node.tagName,
            rowSpan: isNaN(rowSpan) ? undefined : rowSpan,
            colSpan: isNaN(colSpan) ? undefined : colSpan,
          };
        }
        case "a":
          return lookupLink(
            entryLinkTarget(node.attribs["href"]) ?? cheerioEl.text(),
            def.content,
          );
        case "hw": {
          // every traditional/variant form in the parentheses, markers included ("輝、*煇"),
          // becomes an extra lookup row
          const hwParen = cheerioEl.text().match(/（(.+?)）/)?.at(1);
          if (hwParen) ctx.onVariantForms(hwParen);
          def.content = headwordBadges(def.content);
          ctx.onHeadword(def);
          return def;
        }
        case "img":
          return {
            tag: "details",
            style: { cursor: "pointer" },
            content: [
              { tag: "summary", content: `图片` },
              {
                tag: "img",
                path: `img/${node.attribs["src"]}`,
                collapsed: false,
                collapsible: false,
                background: false,
              },
            ],
          };
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
        `${term}: unexpected node of type ${node.type} in the source`,
      );
  }
}

/**
 * The reading next to a headword, without its note about another reading:
 * "shéi 又 shuí", "dǐ（旧又读zhǐ）", "cóng（⑤⑥⑦旧读zòng）", "bāi·hua（口语里多读bāi·huai）".
 */
function splitReadingNote(raw: string) {
  const note =
    raw.match(/^(.*?)\s*（([^\p{Script=Latin}·/]*)(.*?)）\s*$/u) ??
    raw.match(/^(.*?)\s*(又)\s*(.+)$/);
  return note
    ? {
        reading: note[1]!,
        noteLabel: note[2]!.trim(),
        noteReading: note[3]!.trim(),
      }
    : { reading: raw };
}

export async function processHanyu7(terms: ParsedTerm[], dics: DictionaryPair) {
  let i = 0;
  // One sequence number per <entry> (a reading of a headword), shared by the simplified and
  // traditional rows and by both editions.
  let sequence = 0;
  // MDX key → its entries, and every (term, sequence) that has a row; for the redirects below
  const entriesOf = new Map<string, Entry[]>();
  const rows = new Set<string>();
  const links = new Map<string, string>();
  // the glyph pictures the entries show; only these go into the zips
  const glyphs = new Set<string>();

  // every entry, in the order of the source; their rows are added once all are known
  const allEntries: Entry[] = [];
  const addEntry = (
    headword: string,
    variantText: string,
    reading: string,
    content: StructuredContentNode[],
    hw?: Headword,
  ) => {
    const definition = {
      type: "structured-content",
      content: {
        tag: "span",
        content,
        data: { hanyu7: "definitions-parent" },
        lang: "zh-CN",
      },
    } satisfies DetailedDefinition;
    const entry: Entry = {
      headword,
      variantText,
      reading,
      definition,
      sequence: ++sequence,
      showTraditional: (forms) => hw && setBadges(hw, forms),
    };
    entriesOf.set(headword, [...(entriesOf.get(headword) ?? []), entry]);
    allEntries.push(entry);
  };

  for (const term of terms) {
    const linkMatch = term.xmlString.match(/^@@@LINK=(.+)$/m);
    if (linkMatch) {
      // a few keys carry the variant marker itself ("哶*")
      links.set(term.headword.replaceAll("*", ""), linkMatch[1]!.trim());
      continue;
    }
    const $ = load(term.xmlString);
    let rawReading = "";
    let variantForms: string[] = [];
    let hw: Headword | undefined;
    const ctx: Context = {
      $,
      term: term.headword,
      onReading: (r) => (rawReading = r),
      onVariantForms: (forms) => variantForms.push(forms),
      onHeadword: (node) => (hw ??= headwordOf(node)),
      onGlyph: (file) => glyphs.add(file),
    };
    const entryEls = $("entry").toArray();
    // the appendix tables are pages without any <entry>: one image each
    if (entryEls.length === 0) {
      const content = $("body")
        .contents()
        .toArray()
        .map((el) => traverse(ctx, el, TOP_LEVEL))
        .filter((n) => n !== "");
      addEntry(term.headword, "", "", content);
    }
    for (const entryEl of entryEls) {
      rawReading = "";
      variantForms = [];
      hw = undefined;
      const entryContents = $(entryEl)
        .contents()
        .toArray()
        .map((el) => traverse(ctx, el, TOP_LEVEL))
        .filter((n) => n !== "");
      const { reading, noteLabel, noteReading } = splitReadingNote(rawReading);
      if (noteLabel || noteReading) {
        entryContents.splice(1, 0, {
          tag: "span",
          content: [
            `(${noteLabel}${noteLabel && noteReading ? " " : ""}`,
            // a note can be words only: "dā（发音短促）"
            ...(noteReading ? inlineReading(noteReading, term.headword) : []),
            ")",
          ],
          data: { hanyu7: "reading-note" },
        });
      }
      addEntry(
        term.headword,
        variantForms.join("、"),
        normalizeReading(reading, READING_SEPARATORS),
        entryContents,
        hw,
      );
    }
    if (++i % 10000 === 0) {
      console.log(`Processed ${i} terms.`);
    }
  }

  const added = await addEntries(dics, allEntries);
  allEntries.forEach((entry, n) => {
    for (const term of added[n]!) rows.add(`${term}\t${entry.sequence}`);
  });

  // @@@LINK keys redirect to another entry. Most are variant forms that already have their
  // rows; the rest (other spellings such as 二噁英 → 二𫫇英) get the rows of what they point to,
  // and so do their traditional forms.
  let linked = 0;
  for (const [headword, firstTarget] of links) {
    let target = firstTarget;
    for (let hops = 0; links.has(target) && hops < 5; hops++) {
      target = links.get(target)!;
    }
    const entries = entriesOf.get(target);
    if (!entries) {
      throw new Error(`${headword} redirects to ${target}, which has no entry`);
    }
    if (entries.some((e) => rows.has(`${headword}\t${e.sequence}`))) continue;
    for (const entry of entries) {
      for (const term of withTraditionalForms(headword)) {
        const row = `${term}\t${entry.sequence}`;
        if (rows.has(row)) continue;
        rows.add(row);
        await addRows(dics, term, entry.reading, entry.definition, entry.sequence);
      }
    }
    linked++;
  }
  console.log(`Processed ${linked} linked terms.`);

  for (const file of glyphs) {
    await Promise.all(
      dics.map((dic) => dic.addFile(`${GLYPH_DIR}/${file}`, `img/${file}`)),
    );
  }
}
