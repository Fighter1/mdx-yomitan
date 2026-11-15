# mdx-yomitan

Yomitan dictionaries built from two MDX dictionaries, each in a 拼音 and a 注音 edition:

| dictionary | 拼音 | 注音 |
|---|---|---|
| 现代汉语规范词典 (第2版) | [guifan-pinyin.zip](https://github.com/Fighter1/mdx-yomitan/releases/latest/download/guifan-pinyin.zip) | [guifan-zhuyin.zip](https://github.com/Fighter1/mdx-yomitan/releases/latest/download/guifan-zhuyin.zip) |
| 现代汉语词典 (第7版) | [hanyu7-pinyin.zip](https://github.com/Fighter1/mdx-yomitan/releases/latest/download/hanyu7-pinyin.zip) | [hanyu7-zhuyin.zip](https://github.com/Fighter1/mdx-yomitan/releases/latest/download/hanyu7-zhuyin.zip) |

Import a zip in Yomitan → Settings → Dictionaries → Import. The zips are self-updating: *Check for updates* on the same page offers the newest release.

## Build

Needs Node 22.18 or newer (the workflows use the version in `.nvmrc`).

```bash
npm ci
npm run build
npm run validate
```

`npm run build` writes the four zips and their `index-*.json` files to `build/`. `npm run validate` checks them against Yomitan's schemas (`schemas/`, copied from the [Yomitan repository](https://github.com/yomidevs/yomitan/tree/master/ext/data/schemas)), checks the update URLs, that the golden words in `data/golden_words.tsv` are present with their readings, and that every referenced image is in the zip.

Two environment variables change what is stamped into each `index.json`:

| variable | default | meaning |
|---|---|---|
| `REVISION` | UTC date + `.0`, e.g. `2026.11.15.0` | the dictionary revision; four dot-separated integers, which Yomitan compares number by number |
| `GITHUB_REPOSITORY` | the `origin` remote | the repository whose latest release Yomitan asks for updates (GitHub Actions sets it) |

## Release

Run the **Build and release** workflow from the Actions tab. It builds, validates and publishes the zips as the latest release, tagged `v<revision>`, where the revision is the UTC date plus the run number. Nothing is released on a push; pushes and pull requests only run **Build and check**.

## Source

I think the mdx is from [here (guifan)](https://forum.freemdict.com/t/topic/21206) and [here (hanyu7)](https://forum.freemdict.com/t/topic/12102)
