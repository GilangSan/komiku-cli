# komiku

Reverse-engineered Node client for **komiku.org** (manga / manhwa / manhua).
Exposes the site as a small promise-based API and a CLI + TUI. Zero runtime
dependencies (Node's built-in `fetch`).

The site is WordPress (LiteSpeed), so content lives in two places:

- **Series + chapter lists** — the WordPress REST API
  (`https://api.komiku.org/wp-json/wp/v2`): `manga` is the series post type and
  `post` is a chapter.
- **Chapter page images** — only in the chapter HTML (`komiku.org/<slug>/`),
  `#Baca_Komik img.klazy`; the page also carries `var chapterData`.

A series and its chapters are linked through a **post_tag**: `manga.tags[0]` is
the series tag and every chapter is a `post` carrying that tag
(`tags/<id>.count` = chapter count). The request map was recovered with REA
(see `evidence/`).

## Install

```bash
npm install komiku
```

## Library

```js
import { Komiku } from "komiku";

const komiku = new Komiku();

const { sections, ranking } = await komiku.home();
const results = await komiku.search("one piece");           // { tipe: "manhwa" } to filter
const manga = await komiku.manga("komik-one-piece-indo");    // slug or full URL
const chapter = await komiku.chapter(manga.chapters[0].slug);

console.log(manga.chapters.length);
console.log(chapter.images);  // ["https://img.komiku.org/upload5/.../1.webp", ...]

// One file instead of N links (saved to <Downloads>/Komiku, then opened):
await komiku.download(manga.chapters[0].slug, { format: "pdf" }); // → Downloads/Komiku/komik-one-piece-indo-ch1198.pdf
await komiku.download(manga.chapters[0].slug, { format: "cbz" }); // zip of WebP pages, no decoder needed
```

### Methods

| Method | Source | Returns |
| --- | --- | --- |
| `home()` | `GET /` + `GET /p/ranking/` | `{ sections, ranking }` |
| `search(query, opts)` | `GET /wp/v2/manga?search=` | `SeriesCard[]` |
| `ranking(period)` | `GET /p/ranking/` | `Card[]` (`harian` \| `mingguan` \| `bulanan` \| `total`) |
| `listing(opts)` | `GET /wp/v2/manga?tipe=&orderby=` | `SeriesCard[]` |
| `manga(slugOrUrl, opts)` | `GET /wp/v2/manga?slug=` + `/manga/{slug}/` | `Manga` (metadata, synopsis, chapters) |
| `chapters(slugOrUrl, opts)` | `GET /wp/v2/posts?tags=` | `{ total, pages, page, items }` |
| `chapter(slugOrUrl)` | `GET /{chapter-slug}/` | `ChapterDetail` (ordered image URLs) |
| `download(slugOrUrl, opts)` | chapter + images | `DownloadResult` (one `pdf` or `cbz` file) |

`opts` for `search`/`listing`: `{ tipe: "manga"|"manhwa"|"manhua", page, perPage, orderby }`.
`opts` for `manga`/`chapters`: `{ page, perPage }`.
`opts` for `download`: `{ format: "pdf"|"cbz", out, dir, decoder, open, onProgress }`.

### Download format & location

The site serves **WebP**, which PDF cannot embed. So:

- **`cbz`** (default) — a store-only zip of the WebP pages. Zero extra
  dependencies; open it in any comic reader.
- **`pdf`** — each page is converted to JPEG and embedded into one PDF. Requires
  an image decoder on `PATH`: `magick`/`convert` (ImageMagick) or `ffmpeg`;
  `KOMIKU_IMAGE_DECODER` forces one. Without a decoder, use `cbz`.

Downloads go to `<Downloads>/Komiku` (`%USERPROFILE%\Downloads\Komiku` on
Windows, `~/Downloads/Komiku` elsewhere; override with `KOMIKU_DOWNLOAD_DIR` or
`dir`). After a successful download the file is opened with the OS handler
(`open: false` or `--no-open` disables that).

### Options

```js
new Komiku({
  baseUrl: "https://komiku.org",                  // override mirror
  restUrl: "https://api.komiku.org/wp-json/wp/v2",// REST base
  timeoutMs: 20000,                               // per-request timeout
  userAgent: "...",                               // override UA
  fetch: customFetch,                             // inject a fetch (testing)
});
```

Every method throws on a non-2xx response.

## CLI

```bash
npx komiku home
npx komiku search "one piece" --tipe manhwa
npx komiku rank --period mingguan
npx komiku listing --tipe manhua --orderby date
npx komiku manga komik-one-piece-indo
npx komiku chapters ao-ashi --page 2
npx komiku chapter ao-ashi-chapter-410
npx komiku download ao-ashi-chapter-410              # PDF ke <Downloads>/Komiku lalu dibuka
npx komiku download ao-ashi-chapter-410 --cbz --out ao410
npx komiku download ao-ashi-chapter-410 --pdf --dir ./unduhan --no-open
```

Add `--json` for machine-readable output (auto when piped). `KOMIKU_BASE` and
`KOMIKU_REST` override the two origins.

## TUI

Interactive terminal UI (zero extra dependencies):

```bash
npx komiku tui
```

Browse Beranda, search, Peringkat and the Perpustakaan, drill into series
detail and chapters. On a chapter you get the download actions and navigation;
the image list lives on its own screen. A finished download is opened
automatically.

| Key | Action |
| --- | --- |
| `↑`/`↓` or `k`/`j` | move |
| `Enter` | open |
| `Esc` / `←` / `h` | back |
| `g` / `G` | top / bottom |
| `r` | reload |
| `s` | new search (in results) |
| `d` / `c` | download chapter as PDF / CBZ (on a chapter) |
| `l` | daftar gambar (on a chapter) |
| `o` / `u` | open in browser / copy URL (on a link) |
| `q` | quit |

## Development

```bash
npm test
```

The self-check covers the constructor/fetch injection offline and runs live
integration assertions against the site. `npm test` hits the network; for the
offline subset (CI without network) run `node test/selfcheck.js --offline`.

## Publishing

This package is published to npm as [`komiku`](https://www.npmjs.com/package/komiku)
and hosted on GitHub at
[GilangSan/komiku-cli](https://github.com/GilangSan/komiku-cli).

### Pre-publish checklist

1. **Bump the version** following [semver](https://semver.org/):
   ```bash
   npm version patch   # 1.0.0 -> 1.0.1  (bug fix)
   npm version minor   # 1.0.0 -> 1.1.0  (new feature, backwards compatible)
   npm version major   # 1.0.0 -> 2.0.0  (breaking change)
   ```
   `npm version` also creates a git commit and tag automatically.

2. **Run the offline self-check** (this is the same gate `npm publish` runs via
   `prepublishOnly`):
   ```bash
   node test/selfcheck.js --offline
   ```

3. **Preview the tarball** you're about to publish. This shows exactly which
   files ship (the `files` field in `package.json` limits it to `src`, `bin`,
   `README.md`, and `LICENSE`):
   ```bash
   npm pack --dry-run
   ```

### Publish to npm

```bash
# 1. Log in (once per machine). Creates a token in ~/.npmrc.
npm login

# 2. Confirm you're authenticated.
npm whoami

# 3. Publish. The prepublishOnly script re-runs the offline self-check first,
#    and the tarball is built from the `files` allowlist.
npm publish --access public
```

`--access public` is required for scoped packages (`@user/name`); for the
unscoped name `komiku` it is the default but passing it explicitly is harmless.

### Verify the published package

```bash
npm view komiku version          # the version now live on the registry
npm view komiku dist.tarball     # the tarball URL
npm pack komiku@<new-version>    # download what consumers will get
```

### After publishing

Push the version commit and tag that `npm version` created:

```bash
git push origin main --follow-tags
```

Then create a GitHub release from the tag:

```bash
gh release create v<new-version> --generate-notes
```

### Common issues

- **`E403` / `E401` Unauthorized** — you are not logged in or lack publish
  rights to the name. Run `npm login` and confirm with `npm whoami`.
- **`E409` version exists** — you tried to republish an existing version. Bump
  with `npm version` and publish again.
- **`prepublishOnly` failed** — the offline self-check caught a regression;
  fix it before publishing (see the error output).
- **Stray files in the tarball** — check the `files` field in `package.json`
  and re-run `npm pack --dry-run`.

## Notes

- Only `komiku.org` and `api.komiku.org` are contacted. Page images are served
  from `img.komiku.org` and returned as-is.
- Site restructuring can break the regex parsers; `npm test` is the smoke check.

## License

MIT
