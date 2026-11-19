import assert from "node:assert";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Komiku } from "../src/index.js";
import { jpegSize, pdfFromJpegs, zipStore } from "../src/build.js";
import { downloadsDir } from "../src/open.js";

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x20, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9]);

const json = (body, total = 0, pages = 0) => ({
  ok: true,
  json: async () => body,
  text: async () => JSON.stringify(body),
  headers: { get: (h) => (h.toLowerCase() === "x-wp-total" ? String(total) : h.toLowerCase() === "x-wp-totalpages" ? String(pages) : null) },
});
const html = (body) => ({ ok: true, text: async () => body, json: async () => ({}), headers: { get: () => null } });
const image = (buf) => ({ ok: true, arrayBuffer: async () => buf, text: async () => "", json: async () => ({}), headers: { get: () => null } });

// Single-file builders (offline)
{
  assert.deepEqual(jpegSize(JPG), { width: 32, height: 16 });
  const pdf = pdfFromJpegs([JPG, JPG]);
  assert.equal(pdf.subarray(0, 8).toString(), "%PDF-1.4");
  assert.ok(pdf.includes(Buffer.from("/Count 2")) && pdf.includes(Buffer.from("/DCTDecode")));
  const zip = zipStore([{ name: "001.jpg", data: JPG }]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  assert.ok(zip.includes(Buffer.from("001.jpg")));
}

// Default output folder (offline)
{
  process.env.KOMIKU_DOWNLOAD_DIR = "/tmp/custom-komiku";
  assert.equal(downloadsDir(), "/tmp/custom-komiku");
  delete process.env.KOMIKU_DOWNLOAD_DIR;
  assert.match(downloadsDir(), /Downloads[\\/]Komiku$/);
}

// Constructor + fetch injection (offline)
{
  const mangaRow = { id: 6426, slug: "komik-one-piece-indo", modified: "2026-11-06T02:17:02", tags: [5910],
    title: { rendered: "One Piece" },
    class_list: ["manga", "tag-one-piece", "genre-action", "genre-adventure", "statusmanga-ongoing", "tipe-manga"] };
  const calls = [];
  const api = new Komiku({
    baseUrl: "https://example.test/",
    restUrl: "https://api.example.test/wp-json/wp/v2",
    fetch: async (url) => {
      calls.push(url);
      if (url.includes("/wp/v2/manga")) return json([mangaRow], 1, 1);
      if (url.includes("/wp/v2/posts")) return json([{ id: 604528, slug: "one-piece-chapter-1198", date: "2026-11-06T02:17:18", title: { rendered: "One Piece Chapter 1198" } }], 1217, 13);
      if (url.includes("img.komiku.org")) return image(JPG);
      if (url.includes("/p/ranking/")) return html(`<div class="ls4w rank-panel" id="rank-harian"><article class="ls4"><div class="ls4v"><a href="/manga/a/"><img data-src="https://t/a.jpg"></a><span class="rank-num">1</span></div><div class="ls4j"><h4><a href="/manga/a/" title="A">A</a></h4><span class="ls4s">Aksi · 9 views</span></div></article></div>`);
      if (/\/manga\/komik-one-piece-indo\/$/.test(url)) return html(`<div data-series-cover="https://c/x.jpg"></div><p class="desc" itemprop="description">Sinopsis uji.</p>`);
      if (/\/one-piece-chapter-1198\/$/.test(url)) return html(`<div id="Baca_Komik"><img src="https://img.komiku.org/upload5/a/1/2026-01-01/1.webp" class="klazy ww"></div><script>var chapterData={id:604528,idseries:6426,series:"One Piece",chapter:"1198",jumlahgambar:1,link:"\\/one-piece-chapter-1198\\/",link_series:"\\/manga\\/komik-one-piece-indo\\/",hasNext:false};</script>`);
      return html(`<h2>Baca Komik Terbaru</h2><article class="ls2"><div class="ls2v"><a href="/manga/a/"><img data-src="https://t/a.jpg"></a></div><div class="ls2j"><h3><a href="/manga/a/" title="Baca Manhwa A">A</a></h3><span class="ls2t">Fantasi · 4 menit lalu</span><a href="/a-chapter-9/" class="ls2l">Chapter 9</a></div></article>`);
    },
  });
  assert.equal(api.baseUrl, "https://example.test");
  assert.equal(api.restUrl, "https://api.example.test/wp-json/wp/v2");

  const home = await api.home();
  assert.equal(home.sections.length, 1);
  assert.deepEqual(home.sections[0].items[0], {
    title: "A", slug: "a", url: "https://example.test/manga/a/", image: "https://t/a.jpg",
    chapter: "Chapter 9", meta: "Fantasi · 4 menit lalu", type: null, rank: null,
  });
  assert.equal(home.ranking.harian[0].rank, 1);

  const found = await api.search("one piece");
  assert.ok(calls.some((u) => u.includes("search=one+piece")), "search query built");
  assert.equal(found[0].slug, "komik-one-piece-indo");
  assert.equal(found[0].type, "manga");
  assert.deepEqual(found[0].genres, ["action", "adventure"]);
  assert.equal(found[0].tagId, 5910);

  const m = await api.manga("komik-one-piece-indo");
  assert.equal(m.title, "One Piece");
  assert.equal(m.synopsis, "Sinopsis uji.");
  assert.equal(m.chapterCount, 1217);
  assert.equal(m.poster, "https://c/x.jpg");
  assert.equal(m.chapters[0].number, "1198");

  const list = await api.chapters("komik-one-piece-indo");
  assert.equal(list.total, 1217);
  assert.equal(list.pages, 13);

  const ch = await api.chapter("one-piece-chapter-1198");
  assert.equal(ch.series, "One Piece");
  assert.equal(ch.seriesSlug, "komik-one-piece-indo");
  assert.equal(ch.images.length, 1);
  assert.equal(ch.images[0], "https://img.komiku.org/upload5/a/1/2026-01-01/1.webp");

  const out = join(tmpdir(), `komiku-test-${process.pid}`);
  const dl = await api.download("one-piece-chapter-1198", { format: "pdf", dir: out, out: "ch1198", open: false });
  assert.equal(dl.pages, 1);
  assert.equal(dl.opened, false);
  assert.ok(dl.path.endsWith(".pdf"));
  assert.equal(dl.bytes, pdfFromJpegs([JPG]).length);
  rmSync(out, { recursive: true, force: true });
}

// Live integration (skipped for publish: `--offline`)
if (!process.argv.includes("--offline")) {
  const api = new Komiku();

  const home = await api.home();
  assert.ok(home.sections.length > 0, "home: sections");
  assert.ok((home.ranking.harian || []).length > 0, "home: ranking");

  const results = await api.search("one piece");
  assert.ok(results.length > 0, "search: results");
  assert.match(results[0].url, /\/manga\//, "search: series url");

  const manga = await api.manga("komik-one-piece-indo");
  assert.equal(manga.title, "One Piece", "manga: title");
  assert.ok(manga.chapters.length > 0, "manga: chapters");
  assert.ok(manga.chapterCount > 1000, "manga: chapter count");
  assert.ok(manga.genres.length > 0, "manga: genres");
  assert.ok(manga.synopsis.length > 20, "manga: synopsis");

  const chapter = await api.chapter("ao-ashi-chapter-410");
  assert.ok(chapter.images.length > 0, "chapter: images");
  assert.ok(chapter.images[0].startsWith("http"), "chapter: image url");
} else {
  console.log("offline mode: skipping live checks");
}

console.log("self-check OK");
