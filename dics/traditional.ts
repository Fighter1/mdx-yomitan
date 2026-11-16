// Traditional forms of the headwords, so that a lookup from traditional text finds the entries.
// The dictionaries list the traditional and variant forms of single characters, in the standard
// of the mainland (说（説）, 线（綫、*線）), and none for words. OpenCC supplies the rest.
import { OpenCC } from "opencc";

const converter = (config: string) => {
  const opencc = new OpenCC(`${config}.json`);
  return (text: string) => opencc.convertSync(text);
};

// Simplified to the traditional characters of Taiwan: 里面 → 裡面, 为 → 為, 群众 → 群眾. This is
// the form an entry shows. Words are converted as words (头发 → 頭髮, 发现 → 發現), but keep
// their wording: s2twp, which also swaps vocabulary (软件 → 軟體), would turn a headword into a
// different word.
const toTaiwan = converter("s2tw");
// The other two standards a traditional text may be written in: Hong Kong's (里面 → 裏面,
// 群众 → 羣眾) and OpenCC's own, which a text converted with its default settings has
// (为 → 爲, 群众 → 羣衆). These are only looked up, not shown.
const toHongKong = converter("s2hk");
const toOpenccStandard = converter("s2t");

// Regional and Japanese forms of a traditional character, as OpenCC's own standard writes it:
// the way to tell that 說 is the 説 an entry lists, and 產 its 産.
const fromRegional = ["tw2t", "hk2t", "jp2t"].map(converter);
const standardForm = (form: string) =>
  fromRegional.reduce((text, convert) => convert(text), form);

export type TraditionalForms = {
  /** The form Taiwan uses: what the entry shows in its 繁 badge. */
  shown: string[];
  /** The forms of Hong Kong and of OpenCC's standard: lookup rows only. */
  lookupOnly: string[];
};

/**
 * The traditional forms of `headword` that `listed` (the forms its entry lists itself) lacks.
 *
 * A word is converted together with the variant spellings its entry lists (一股脑儿（一古脑儿）).
 *
 * A character can stand for several traditional ones, each with an entry of its own: 后¹ is the
 * 后 of 皇后, 后²（後） the one of 后面. So a form that another entry of the same character lists
 * (`listedByOthers`) and this one does not is left to that entry. What remains are the forms no
 * entry lists: 争 → 爭, 内 → 內, and the Taiwan form of a listed one, 说（説） → 說.
 */
export function traditionalForms(
  headword: string,
  listed: string[] = [],
  listedByOthers: string[] = [],
): TraditionalForms {
  const isWord = [...headword].length > 1;
  const own = new Set(listed.map(standardForm));
  const others = new Set(listedByOthers.map(standardForm));
  const belongsToAnotherEntry = (form: string) =>
    !isWord && others.has(standardForm(form)) && !own.has(standardForm(form));

  const known = new Set([headword, ...listed]);
  const convertWith = (convert: (text: string) => string) => {
    const forms: string[] = [];
    for (const source of isWord ? [headword, ...listed] : [headword]) {
      const form = convert(source);
      if (known.has(form) || belongsToAnotherEntry(form)) continue;
      known.add(form);
      forms.push(form);
    }
    return forms;
  };
  const shown = convertWith(toTaiwan);
  return {
    shown,
    lookupOnly: [...convertWith(toHongKong), ...convertWith(toOpenccStandard)],
  };
}
