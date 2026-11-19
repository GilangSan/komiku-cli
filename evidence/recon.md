# Recon notes — komiku.org

Recovered by fetching the site's HTML/CSS/JS and probing the WordPress REST API
directly (the REA browser tools need a CDP browser, which was not installed here,
so target pages were fetched over HTTP and parsed as data).

## Stack

- **WordPress** + custom theme (`/asset/css/style5.5.css`, `/asset/js/memberv1.5.js`).
- **LiteSpeed** page cache (`x-litespeed-cache: hit`), fronted by **Cloudflare**.
- Theme uses **htmx** (`/asset/js/htmx.js`) for infinite scroll fragments.
- Content is split: lists/metadata in **WP REST**, chapter images only in HTML.

## Content endpoints

| Purpose | Request | Selector / note |
| --- | --- | --- |
| Series list | `GET api.komiku.org/wp-json/wp/v2/manga` | filters `search`,`tipe`,`genre`,`statusmanga`,`tags`; `orderby=date\|modified` |
| Series by slug | `.../wp/v2/manga?slug={slug}` | `tags[0]` = series tag id |
| Chapter list | `.../wp/v2/posts?tags={tagId}&orderby=date&order=desc` | one `post` per chapter |
| Chapter count | `.../wp/v2/tags/{tagId}` → `count` | |
| Term ids | `.../wp/v2/tipe\|genre\|statusmanga?slug=` | `tipe`: manga=42, manhwa=48 |
| Home page | `GET komiku.org/` | `article.ls2` update cards; `<h2>` sections |
| Ranking | `GET komiku.org/p/ranking/` | `div.ls4w.rank-panel#rank-{harian\|mingguan\|bulanan\|total}` → `article.ls4` |
| Chapter page | `GET komiku.org/{chapter-slug}/` | `#Baca_Komik img.klazy`; `var chapterData={...}` |

Notes on REST records:

- `manga.class_list` already carries the term slugs (`tipe-manhwa`,
  `genre-action`, `statusmanga-ongoing`), so term names need no extra lookup.
- Chapter `content.rendered` is **empty**; the images are rendered into the
  chapter HTML by the theme. `chapterData` gives `id`, `idseries`, `series`,
  `chapter`, `jumlahgambar`, `link`, `link_series`, `hasNext`.

## Other endpoints found (not used by this client)

- `api.komiku.org/manga/?tipe=manhwa` — htmx HTML fragment for the grid.
- `api.komiku.org/?s={q}&post_type=manga` — htmx HTML fragment for search results.
- `plus.komiku.org/api/mobile/v1.0/*` — mobile app API (auth, comments,
  bookmarks; preview at `/preview/series|chapter`). Needs headers
  `x-package-name: id.komiku.plus`, `x-version-code: 5`.
- `analytics.komiku.org/api/active/?format=html` — live counter fragment.

## Reproduce

```bash
curl -s 'https://api.komiku.org/wp-json/wp/v2/manga?slug=komik-one-piece-indo'
curl -s 'https://api.komiku.org/wp-json/wp/v2/posts?tags=5910&per_page=3&orderby=date&order=desc'
curl -s 'https://komiku.org/ao-ashi-chapter-410/' | grep -o 'img.komiku.org[^"]*'
```

## Caveats

- Regex parsers in `src/index.js` track this markup; a theme change can break them.
- Page images are **WebP only** (`img.komiku.org/upload5/{series}/{ch}/{date}/{n}.webp`);
  no `.jpg`/`.png` variant exists (`?format=jpg` still returns WebP). PDF output
  therefore decodes to JPEG via ImageMagick/ffmpeg; CBZ keeps WebP untouched.
- The series↔chapter link is a `post_tag`; a series without `tags[0]` yields no
  chapter list.
- The mobile API is undocumented and only covers comments/bookmarks, not pages.
