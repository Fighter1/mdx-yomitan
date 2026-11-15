// The dictionaries this project builds: two source dictionaries, each in a 拼音 and a 注音
// edition. export.ts builds one zip per stem; scripts/validate.ts expects exactly these.
export const FAMILIES = {
  guifan: {
    title: "现代汉语规范词典",
    attribution: "外语教学与研究出版社 (2010)",
  },
  hanyu7: {
    title: "现代汉语词典",
    attribution: "商务印书馆 (2016)",
  },
} as const;
export type Family = keyof typeof FAMILIES;

export const EDITIONS = { pinyin: "拼音", zhuyin: "注音" } as const;
export type Edition = keyof typeof EDITIONS;

export const stemOf = (family: Family, edition: Edition) =>
  `${family}-${edition}`;
export const titleOf = (family: Family, edition: Edition) =>
  `${FAMILIES[family].title} ${EDITIONS[edition]}`;

/** stem → title, for every zip. */
export const DICTIONARIES: Record<string, string> = Object.fromEntries(
  (Object.keys(FAMILIES) as Family[]).flatMap((family) =>
    (Object.keys(EDITIONS) as Edition[]).map((edition) => [
      stemOf(family, edition),
      titleOf(family, edition),
    ]),
  ),
);
