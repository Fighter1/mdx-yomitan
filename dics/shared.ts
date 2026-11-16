import { readdirSync, readFileSync } from "fs";
import { splitOnFirst } from "../utils.ts";
import { TermEntry, type Dictionary } from "yomichan-dict-builder";
import type {
  DetailedDefinition,
  StructuredContentNode,
} from "yomichan-dict-builder/dist/types/yomitan/termbank";
import { p2z } from "pinyin-to-zhuyin";
import { traditionalForms } from "./traditional.ts";

export type ParsedTerm = {
  headword: string;
  xmlString: string;
};

export type DictionaryPair = [pinyinDic: Dictionary, zhuyinDic: Dictionary];

export function readTermsFromFile(termsTextFile: string): ParsedTerm[] {
  const content = readFileSync(termsTextFile, "utf-8");
  return Array.from(
    content.matchAll(/.+?(?=<\/>)/gs).map((m) => m[0].replace("</>", "").trim()),
  ).map((termMatch) => {
    const [headword, xmlString] = splitOnFirst(termMatch, "\n").map((l) =>
      l.trim(),
    );
    if (!headword || !xmlString) {
      throw new Error(`Failed to parse term:\n${termMatch}`);
    }
    return {
      headword,
      xmlString,
    };
  });
}

/** Packs every png of `picsFolder` into both editions as `img/<file>`. */
export async function addFiles(
  [pinyinDic, zhuyinDic]: DictionaryPair,
  picsFolder: string,
) {
  await Promise.all(
    readdirSync(picsFolder)
      .filter((file) => file.toLowerCase().endsWith(".png"))
      .flatMap((file) => [
        pinyinDic.addFile(`${picsFolder}/${file}`, `img/${file}`),
        zhuyinDic.addFile(`${picsFolder}/${file}`, `img/${file}`),
      ]),
  );
}

// Glyphs that only exist in the fonts shipped with the MDX; no user can type or scan them.
const PRIVATE_USE = /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/u;

/**
 * Splits a parenthesised list of variant forms ("讀", "輝、⁎煇", "專*耑", "①-④醜") into clean
 * headwords. The variant-type markers (*, ＊, ⁎, ⁑) double as separators; sense numbers and
 * ranges, ※, △ and whitespace are dropped, and so is anything that still looks like markup or
 * needs a private-use glyph. Variants of a single character are single characters, so a run
 * written without a separator ("當噹") is split up.
 */
export function splitVariantForms(text: string, headword: string): string[] {
  const out: string[] = [];
  const add = (form: string) => {
    if (
      form.length > 0 &&
      form !== headword &&
      !/[（）()<>〓]/.test(form) &&
      !PRIVATE_USE.test(form) &&
      !out.includes(form)
    )
      out.push(form);
  };
  const singleCharacter = [...headword].length === 1;
  for (const raw of text.split(/[、，,/／;；*＊⁎⁑]/)) {
    const form = raw.replace(/[\s※△①-⑳㉑-㉟\-－–—]/g, "");
    if (singleCharacter) [...form].forEach(add);
    else add(form);
  }
  return out;
}

/**
 * Cleans the reading of a headword: ɡ (U+0261) is a plain g, the dictionary's `separators`
 * (syllable/word break markers) become single spaces, nothing leads or trails.
 */
export function normalizeReading(raw: string, separators: RegExp): string {
  return raw
    .replaceAll("ɡ", "g")
    .replace(separators, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LATIN_RUN = /[A-Za-z\u00C0-\u024F\u1E00-\u1EFF\u0300-\u036F'’]+/g;
const TONE_MARKS: Record<string, string> = {
  "\u0304": "",
  "\u0301": "ˊ",
  "\u030C": "ˇ",
  "\u0300": "ˋ",
};
// Syllables without a vowel (and ê), which pinyin-to-zhuyin leaves as they are.
const SYLLABIC: Record<string, string> = {
  m: "ㄇ",
  n: "ㄋ",
  ng: "ㄫ",
  hm: "ㄏㄇ",
  hng: "ㄏㄫ",
  ê: "ㄝ",
};
const LEADING_SYLLABIC_NASAL = new RegExp(
  `^((?:ng|[mn])[${Object.keys(TONE_MARKS).join("")}])(.+)$`,
);
const VOWEL = "aeiouüāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ";
// An r between two vowels starts a syllable ("hérú" is hé-rú); pinyin-to-zhuyin takes it for erhua.
const R_INITIAL = new RegExp(`(?<=[${VOWEL}])r(?=[${VOWEL}])`, "g");

function syllabicToZhuyin(token: string): string | undefined {
  const decomposed = token.toLowerCase().normalize("NFD");
  const tone = [...decomposed].find((c) => c in TONE_MARKS);
  const base = decomposed.replace(/[\u0304\u0301\u030C\u0300]/g, "").normalize("NFC");
  const zhuyin = SYLLABIC[base];
  if (!zhuyin) return undefined;
  if (tone !== undefined) return zhuyin + TONE_MARKS[tone];
  // without a tone mark hm and hng are neutral-tone interjections; m, n, ng and ê name the sound
  return base.startsWith("h") ? `˙${zhuyin}` : zhuyin;
}

/**
 * Pinyin to zhuyin, one run of Latin letters at a time. Letters that are part of the headword
 * itself ("AA制", "卡拉OK", "pH值") and all-capital runs stay as they are, and so does anything
 * the converter cannot turn into zhuyin completely.
 */
export function toZhuyin(pinyinReading: string, term = ""): string {
  return pinyinReading
    .replaceAll("ɡ", "g")
    .replace(LATIN_RUN, (token) => {
      if (/^[A-Z]+$/.test(token) || (term && term.includes(token))) return token;
      const syllabic = syllabicToZhuyin(token);
      if (syllabic) return syllabic;
      // a toned m/n/ng in front of another syllable (姆妈)
      const [, nasal, rest] =
        token.normalize("NFD").match(LEADING_SYLLABIC_NASAL) ?? [];
      if (nasal && rest) {
        return syllabicToZhuyin(nasal) + toZhuyin(rest.normalize("NFC"), term);
      }
      // the converter knows the syllable-dividing apostrophe only as the ASCII one
      const zhuyin = p2z(token.replaceAll("’", "'").replace(R_INITIAL, " r"));
      return /[A-Za-z\u00C0-\u024F\u1E00-\u1EFF0-9]/.test(zhuyin) ? token : zhuyin;
    })
    .replaceAll(" ", "");
}

/**
 * A reading shown inside a definition. Both systems are always present in the content (identical
 * in both editions); each edition hides the other one through styles.css using `readingTag`
 * (rendered as `data-sc-reading-tag`). `data` names the two spans for the dictionary's own CSS.
 */
export function readingSpans(
  pinyin: string,
  data: (system: "pinyin" | "zhuyin") => Record<string, string>,
  term = "",
  // what the zhuyin is converted from, when the pinyin is shown in the dictionary's own notation
  normalizedPinyin = pinyin,
): StructuredContentNode[] {
  return [
    {
      tag: "span",
      content: pinyin,
      data: { ...data("pinyin"), readingTag: "pinyin" },
    },
    {
      tag: "span",
      content: toZhuyin(normalizedPinyin, term),
      data: { ...data("zhuyin"), readingTag: "zhuyin" },
    },
  ];
}

/**
 * Text with the pinyin that is written into it ("偻（lóu）㑩", "通常读 wàn") turned into reading
 * spans, so that the zhuyin edition shows zhuyin there as well. Only what is certainly pinyin is
 * touched: syllables with a tone mark, and a single toneless syllable in parentheses right after
 * a character ("哟（yao）"). Letters, foreign words and anything the converter cannot turn into
 * zhuyin stay plain text.
 */
export function annotatePinyin(
  rawText: string,
  data: (system: "pinyin" | "zhuyin") => Record<string, string>,
  term = "",
): StructuredContentNode {
  const text = rawText.replaceAll("ɡ", "g");
  const out: StructuredContentNode[] = [];
  let plainFrom = 0;
  for (const match of text.matchAll(LATIN_RUN)) {
    const token = match[0];
    const [start, end] = [match.index, match.index + token.length];
    const toned = [...token.normalize("NFD")].some((c) => c in TONE_MARKS);
    const neutral =
      !toned &&
      /^[a-zü]{2,}$/.test(token) &&
      text[end] === "）" &&
      /\p{Script=Han}（$/u.test(text.slice(0, start));
    if (!toned && !neutral) continue;
    const zhuyin = toZhuyin(token, term);
    // unchanged: not convertible; a toneless run of several syllables is more likely a foreign word
    if (zhuyin === token || (neutral && !/^˙[^˙]+$/.test(zhuyin))) continue;
    // a capitalised word with toneless syllables is a transliteration ("Pāramitā", "Qurbān"),
    // not a Chinese name
    if (/^\p{Lu}/u.test(token) && zhuyin.includes("˙")) continue;
    out.push(text.slice(plainFrom, start), ...readingSpans(token, data, term));
    plainFrom = end;
  }
  if (out.length === 0) return text;
  out.push(text.slice(plainFrom));
  return out.filter((part) => part !== "");
}

/** A link that looks `headword` up in Yomitan when clicked. */
export function lookupLink(
  headword: string,
  content: StructuredContentNode,
): StructuredContentNode {
  const urlParams = new URLSearchParams({
    query: headword,
    wildcards: "off",
  }).toString();
  return { tag: "a", href: `?${urlParams}`, content };
}

/** The headword an `entry://headword#anchor` link of the MDX points at. */
export function entryLinkTarget(href: string | undefined): string | undefined {
  const target = href?.match(/^entry:\/\/([^#]*)/)?.[1]?.trim();
  return target || undefined;
}

/**
 * Adds one row to each edition for `term`: pinyin reading in the pinyin edition, the derived
 * zhuyin reading in the zhuyin edition, the same definition and sequence number in both.
 * Rows sharing a sequence number (traditional/simplified forms, both editions) describe the same
 * entry, which is what lets consumers group them back together.
 */
export async function addRows(
  [pinyinDic, zhuyinDic]: DictionaryPair,
  term: string,
  pinyinReading: string,
  definition: DetailedDefinition,
  sequence: number,
) {
  await Promise.all([
    pinyinDic.addTerm(
      new TermEntry(term)
        .setReading(pinyinReading)
        .setSequenceNumber(sequence)
        .addDetailedDefinition(definition)
        .build(),
    ),
    zhuyinDic.addTerm(
      new TermEntry(term)
        .setReading(toZhuyin(pinyinReading, term))
        .setSequenceNumber(sequence)
        .addDetailedDefinition(definition)
        .build(),
    ),
  ]);
}

/** One dictionary entry, parsed and waiting for its rows. */
export type Entry = {
  headword: string;
  /** The traditional/variant forms the entry lists, as its source writes them ("輝、⁎煇"). */
  variantText: string;
  reading: string;
  definition: DetailedDefinition;
  sequence: number;
  /** Puts the Taiwan forms the entry does not list itself into its definition. */
  showTraditional: (forms: string[]) => void;
};

/**
 * The rows of every entry of a dictionary: the headword, the forms the entry lists and the
 * traditional forms it lacks (see traditional.ts), all tied to the entry by its sequence number.
 * Returns the terms of each entry, in the order of `entries`.
 *
 * It takes all entries at once because which traditional characters an entry gets depends on
 * what the other entries of the same headword list.
 */
export async function addEntries(
  dics: DictionaryPair,
  entries: Entry[],
): Promise<string[][]> {
  const listed = entries.map((entry) =>
    splitVariantForms(entry.variantText, entry.headword),
  );
  const listedByHeadword = new Map<string, Set<string>>();
  entries.forEach(({ headword }, i) => {
    const forms = listedByHeadword.get(headword) ?? new Set();
    listed[i]!.forEach((form) => forms.add(form));
    listedByHeadword.set(headword, forms);
  });

  const added: string[][] = [];
  for (const [i, entry] of entries.entries()) {
    const traditional = traditionalForms(entry.headword, listed[i], [
      ...listedByHeadword.get(entry.headword)!,
    ]);
    if (traditional.shown.length) entry.showTraditional(traditional.shown);
    const terms = [
      entry.headword,
      ...listed[i]!,
      ...traditional.shown,
      // one that is a headword itself (臺 is 台 in Hong Kong) is found as that already
      ...traditional.lookupOnly.filter((form) => !listedByHeadword.has(form)),
    ];
    for (const term of terms) {
      await addRows(dics, term, entry.reading, entry.definition, entry.sequence);
    }
    added.push(terms);
  }
  return added;
}

/**
 * A headword that has no entry of its own (a sub-headword, a redirect) and the traditional
 * forms of it, when it is a word: the terms that get the rows of the entry it belongs to.
 */
export function withTraditionalForms(headword: string): string[] {
  if ([...headword].length < 2) return [headword];
  const { shown, lookupOnly } = traditionalForms(headword);
  return [headword, ...shown, ...lookupOnly];
}

/**
 * The 繁 badge of an entry: what its source lists (`listed`, already content), followed by the
 * traditional forms added to it.
 */
export function traditionalBadge(
  listed: StructuredContentNode[],
  added: string[],
  data: Record<string, string>,
): StructuredContentNode {
  const content = [...listed];
  if (added.length) {
    const last = content.at(-1);
    const text = added.join("、");
    if (typeof last === "string") content[content.length - 1] = `${last}、${text}`;
    else content.push(content.length ? `、${text}` : text);
  }
  return {
    tag: "span",
    content: content.length === 1 && typeof content[0] === "string" ? content[0] : content,
    lang: "zh-TW",
    data,
  };
}
