# mdx-yomitan

Yomitan dictionaries built from two MDX dictionaries, each in a 拼音 and a 注音 edition:

| dictionary | 拼音 | 注音 |
|---|---|---|
| 现代汉语规范词典 (第2版) | [guifan-pinyin.zip](https://github.com/Fighter1/mdx-yomitan/releases/latest/download/guifan-pinyin.zip) | [guifan-zhuyin.zip](https://github.com/Fighter1/mdx-yomitan/releases/latest/download/guifan-zhuyin.zip) |
| 现代汉语词典 (第7版) | [hanyu7-pinyin.zip](https://github.com/Fighter1/mdx-yomitan/releases/latest/download/hanyu7-pinyin.zip) | [hanyu7-zhuyin.zip](https://github.com/Fighter1/mdx-yomitan/releases/latest/download/hanyu7-zhuyin.zip) |

Import a zip in Yomitan → Settings → Dictionaries → Import. The zips are self-updating: *Check for updates* on the same page offers the newest release.

A copy installed from an older build, whose revision looks like `2026/02/12.1`, is not offered these updates: Yomitan cannot compare that format with the current `2026.11.15.7`. Import the new zip once by hand.

The two editions of a dictionary have the same entries. They differ in the reading Yomitan shows and searches by, and in which system the readings inside the definitions are written in.

Entries can be looked up from traditional text as well. Each entry shows its headword in a blue box and, when it has other forms, those in a red one:

- the traditional and variant forms the dictionary lists with a headword: those of single characters (说（説）, 里（裏、裡）) and the other spellings of some words (一股脑儿（一古脑儿）);
- the form Taiwan uses, converted with [OpenCC](https://github.com/BYVoid/OpenCC) (`s2tw`), where the dictionary does not list it: every word (现代 → 現代, 头发 → 頭髮) and characters such as 说 → 說, 内 → 內, 着 → 著. Only characters are converted, not vocabulary: 软件 is 軟件, not 軟體.

The spellings of Hong Kong (`s2hk`: 里面 → 裏面, 群众 → 羣眾) and of OpenCC's default conversion (`s2t`: 为 → 爲, 群众 → 羣衆) find the entries as well. The box shows such a spelling only to whoever looks it up: a lookup of 裏面 has 裡面、裏面 in it, a lookup of 里面 or 裡面 just 裡面. A word that is defined inside the entry of a character (哈达 under 哈) is found by its traditional forms too; the box of that entry is the character's.

A character with several entries keeps them apart: 後 finds the 后 of 后面, not the one of 皇后, because the dictionary lists 後 with the first only. Two limits:

- a form that no entry of a character lists goes to all of them, so 別 also finds the 别 read biè, whose own form is 彆;
- the conversion of a word is OpenCC's choice, and can be wrong where a simplified character stands for several traditional ones.

## Build

Needs Node 22.18 or newer, except 23.0 to 23.5 (the workflows use the version in `.nvmrc`).

```bash
npm ci
npm run typecheck
npm run build
npm run validate
```

`npm run build` writes the four zips and their `index-*.json` files to `build/`. `opencc` is a native module that installs a prebuilt binary; `allowScripts` in `package.json` records that its install script may run.

`npm run validate` checks the zips in `build/`:

- every file against Yomitan's schemas (`schemas/`, copied from the [Yomitan repository](https://github.com/yomidevs/yomitan/tree/master/ext/data/schemas));
- the title, the update URLs and the revision, which has to be the same in all four;
- that the golden words in `data/golden_words.tsv` are present with their readings, and the rows it rules out (lines starting with `!`) are not;
- that headwords and readings are clean: pinyin editions hold pinyin, zhuyin editions zhuyin;
- that the images in a zip are exactly the ones its entries show;
- that the two editions of a dictionary have the same number of entries.

It takes `--repo owner/name` and `--revision 2026.11.15.7` to check against something other than the defaults, and writes `reports/stats.json`. `npm run release-notes` turns that into `reports/release-notes.md`.

Two environment variables change what is stamped into each `index.json`:

| variable | default | meaning |
|---|---|---|
| `REVISION` | UTC date + `.0`, e.g. `2026.11.15.0` | the dictionary revision; four dot-separated integers, which Yomitan compares number by number |
| `GITHUB_REPOSITORY` | the `origin` remote; outside a git checkout, `Fighter1/mdx-yomitan` | the repository whose latest release Yomitan asks for updates (GitHub Actions sets it) |

If `origin` is not recognisable as a GitHub repository (an SSH host alias, for example), the build stops and asks for `GITHUB_REPOSITORY`.

## Release

Run the **Build and release** workflow from the Actions tab, on the default branch. It builds, validates and publishes the zips as the latest release, tagged `v<revision>`, where the revision is the UTC date plus the run number. A revision given by hand has to be greater than the latest release's, or Yomitan would not offer it as an update. With *publish* turned off the workflow only builds, and keeps the zips as a workflow artifact.

Nothing is released on a push; pushes and pull requests only run **Build and check**, which also keeps its zips as an artifact. Dependabot opens pull requests for npm packages and GitHub Actions once a week.

## Layout

| path | what it is |
|---|---|
| `export.ts` | the build: creates the four zips and runs the two parsers |
| `dics/catalog.ts` | titles and attributions of the dictionaries |
| `dics/guifan/`, `dics/hanyu7/` | one parser per source dictionary |
| `dics/shared.ts` | what the parsers share: variant forms, readings, pinyin to zhuyin, rows |
| `dics/traditional.ts` | the traditional forms added to the headwords (OpenCC) |
| `styles-guifan.css`, `styles-hanyu7.css` | the stylesheet of each dictionary |
| `styles-pinyin-diff.css`, `styles-zhuyin-diff.css` | appended per edition: hide the other reading system |
| `scripts/` | validation and release notes |
| `utils/release.ts` | revision and update URLs |
| `data/` | the MDX sources, their images, the golden words |

## Source

I think the mdx is from [here (guifan)](https://forum.freemdict.com/t/topic/21206) and [here (hanyu7)](https://forum.freemdict.com/t/topic/12102)

现代汉语词典 uses 52 private-use characters (variant characters, formulas, symbols) that only its own fonts have. `data/mdx-7/glyphs` holds a picture of each, drawn from `data/mdx-7/hei_xdhy.ttf` and `song.ttf` at 128 pixels per em and named `glyph-<font>-<code point>.png`; the build shows these in place of the characters and stops if a character has no picture.
