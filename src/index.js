// Komiku — reverse-engineered client for komiku.org.
// The site is a WordPress install (LiteSpeed). Content is split in two places:
//   * series + chapter lists  -> WordPress REST  (api.komiku.org/wp-json/wp/v2)
//   * chapter page images     -> the chapter HTML (komiku.org/<slug>/)
// A series and its chapters are linked through a post_tag: manga.tags[0] is the
// series tag and the chapters are posts carrying that tag. Endpoint map recovered
// with REA (see evidence/).

import { mkdirSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { decodeToJpeg, pdfFromJpegs, zipStore } from "./build.js";
import { downloadsDir, openPath } from "./open.js";

const DEFAULT_BASE = "https://komiku.org";
const DEFAULT_REST = "https://api.komiku.org/wp-json/wp/v2";
const DEFAULT_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const decode = (s) =>
  String(s ?? "")
    .replace(/&#8217;|&rsquo;/g, "\u2019")
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#8211;/g, "-")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

const slugOf = (value) =>
  decodeURIComponent(
    String(value ?? "")
      .replace(/^https?:\/\/[^/]+/i, "")
      .replace(/^\/+/, "")
      .replace(/^manga\//, "")
      .replace(/[/?#].*$/, "")
  );

// ---- HTML parsers -----------------------------------------------------------

function parseCards(html, base) {
  const out = [];
  for (const m of html.matchAll(/<article class="(ls2|ls4)"[^>]*>([\s\S]*?)<\/article>/g)) {
    const [, kind, body] = m;
    const slug = body.match(/href="\/?((?:manga\/)?[^"#?]+)"/)?.[1];
    const title = body.match(/<h[34]>\s*<a[^>]*>([\s\S]*?)<\/a>\s*<\/h[34]>/)?.[1];
    if (!slug || !title) continue;
    const image = body.match(/data-src="([^"]+)"/)?.[1] ?? null;
    const meta = body.match(/class="ls2t">([^<]*)</)?.[1] ?? body.match(/class="ls4s">([^<]*)</)?.[1];
    const chapter = body.match(/class="(?:ls2l|ls24)"[^>]*>([\s\S]*?)<\/a>/)?.[1];
    const rank = body.match(/class="rank-num">(\d+)</)?.[1];
    out.push({
      title: decode(title),
      slug: slugOf(slug),
      url: `${base}/manga/${slugOf(slug)}/`,
      image,
      chapter: chapter ? decode(chapter) : null,
      meta: meta ? decode(meta) : null,
      type: null,
      rank: rank ? +rank : null,
    });
  }
  return out;
}

function parseHome(html, base) {
  const parts = html.split(/<h2[^>]*>([\s\S]*?)<\/h2>/);
  const sections = [];
  for (let i = 1; i < parts.length; i += 2) {
    const title = decode(parts[i]);
    const items = parseCards(parts[i + 1], base);
    if (title && items.length) sections.push({ title, items });
  }
  return sections;
}

function parseRanking(html, base) {
  const chunks = html.split(/<div class="ls4w rank-panel" id="rank-(\w+)">/);
  const panels = {};
  for (let i = 1; i < chunks.length; i += 2) panels[chunks[i]] = parseCards(chunks[i + 1], base);
  return panels;
}

function parseChapterData(html) {
  const raw = html.match(/var chapterData=(\{[\s\S]*?\});/);
  const data = {};
  if (!raw) return data;
  for (const m of raw[1].matchAll(/(\w+)\s*:\s*(?:"([^"]*)"|(\d+)|(\w+))/g)) {
    data[m[1]] = m[4] !== undefined ? m[4] === "true" : m[3] !== undefined ? +m[3] : m[2].replace(/\\\//g, "/");
  }
  return data;
}

function parseSeries(html) {
  const og = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/)?.[1];
  const cover = html.match(/data-series-cover="([^"]+)"/)?.[1];
  return {
    poster: decode(cover || og || "") || null,
    synopsis: decode(html.match(/itemprop="description">([\s\S]*?)<\/p>/)?.[1]),
  };
}

function parseChapter(html, base) {
  const d = parseChapterData(html);
  const seg = html.slice(html.indexOf('id="Baca_Komik"'));
  const images = [...seg.matchAll(/<img[^>]*class="[^"]*klazy[^"]*"[^>]*>/g)]
    .map((m) => m[0].match(/src="([^"]+)"/)?.[1])
    .filter(Boolean);
  const seriesSlug = slugOf(d.link_series);
  return {
    url: `${base}/${slugOf(d.link)}/`,
    id: d.id ?? null,
    seriesId: d.idseries ?? null,
    series: d.series ?? null,
    seriesSlug,
    seriesUrl: `${base}/manga/${seriesSlug}/`,
    chapter: d.chapter ?? null,
    count: d.jumlahgambar ?? images.length,
    hasNext: d.hasNext === true,
    thumbnail: d.thumbnail ?? null,
    images,
  };
}

const chapterNumber = (title, slug) => {
  const m = /chapter\s+([\d.]+)/i.exec(title) || /chapter-([\d.]+)/i.exec(slug);
  return m ? m[1] : null;
};

const briefFromRest = (m, base) => {
  const cls = m.class_list || [];
  return {
    id: m.id,
    slug: m.slug,
    title: decode(m.title?.rendered),
    url: `${base}/manga/${m.slug}/`,
    type: cls.find((c) => c.startsWith("tipe-"))?.slice(5) ?? null,
    status: cls.find((c) => c.startsWith("statusmanga-"))?.replace("statusmanga-", "") ?? null,
    genres: cls.filter((c) => c.startsWith("genre-")).map((c) => c.slice(6)),
    tagId: m.tags?.[0] ?? null,
    modified: m.modified,
  };
};

/**
 * Client for the komiku.org interface.
 */
export class Komiku {
  constructor(options = {}) {
    if (options && typeof options === "string") options = { baseUrl: options };
    this.baseUrl = (options.baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
    this.restUrl = (options.restUrl || DEFAULT_REST).replace(/\/+$/, "");
    this.userAgent = options.userAgent || DEFAULT_UA;
    this.timeoutMs = options.timeoutMs ?? 20000;
    this.fetch = options.fetch || globalThis.fetch;
    if (typeof this.fetch !== "function") throw new Error("No fetch implementation available");
  }

  async _getHtml(pathOrUrl, accept = "text/html") {
    const url = /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : this.baseUrl + pathOrUrl;
    const res = await this.fetch(url, {
      headers: {
        "User-Agent": this.userAgent,
        Accept: accept,
        "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res;
  }

  async _text(pathOrUrl) {
    return (await this._getHtml(pathOrUrl)).text();
  }

  async _rest(path, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const res = await this._getHtml(`${this.restUrl}/${path}${qs ? "?" + qs : ""}`, "application/json");
    return {
      data: await res.json(),
      total: Number(res.headers?.get?.("x-wp-total") ?? 0),
      pages: Number(res.headers?.get?.("x-wp-totalpages") ?? 0),
    };
  }

  async _taxId(tax, slug) {
    const { data } = await this._rest(tax, { slug, per_page: 1 });
    return data[0]?.id;
  }

  /** Home page sections (`sections`) plus the ranking panels (`ranking`). */
  async home() {
    const [home, rank] = await Promise.all([this._text("/"), this._text("/p/ranking/")]);
    return { sections: parseHome(home, this.baseUrl), ranking: parseRanking(rank, this.baseUrl) };
  }

  /** Search series. `tipe` filters to manga | manhwa | manhua. Returns cards. */
  async search(query, { tipe, page = 1, perPage = 20 } = {}) {
    const params = { search: query, per_page: perPage, page, orderby: "relevance" };
    if (tipe) params.tipe = await this._taxId("tipe", tipe);
    const { data } = await this._rest("manga", params);
    return data.map((m) => briefFromRest(m, this.baseUrl));
  }

  /** Ranking panel. `period` = harian | mingguan | bulanan | total. Returns cards. */
  async ranking(period = "harian") {
    const panels = parseRanking(await this._text("/p/ranking/"), this.baseUrl);
    return panels[period] || panels.harian || [];
  }

  /** Catalog list. `tipe` = manga | manhwa | manhua, `orderby` = modified | date. Returns cards. */
  async listing({ tipe, orderby = "modified", page = 1, perPage = 20 } = {}) {
    const params = { per_page: perPage, page, orderby, order: "desc" };
    if (tipe) params.tipe = await this._taxId("tipe", tipe);
    const { data } = await this._rest("manga", params);
    return data.map((m) => briefFromRest(m, this.baseUrl));
  }

  /** Series detail: metadata + synopsis + the first page of chapters. */
  async manga(slugOrUrl, { page = 1, perPage = 100, withChapters = true } = {}) {
    const slug = slugOf(slugOrUrl);
    const { data } = await this._rest("manga", { slug, per_page: 1 });
    if (!data.length) throw new Error(`series not found: ${slug}`);
    const brief = briefFromRest(data[0], this.baseUrl);
    const extra = parseSeries(await this._text(`/manga/${slug}/`));
    const list = withChapters ? await this.chapters(slug, { page, perPage }) : { total: 0, pages: 0, page, items: [] };
    return { ...brief, ...extra, chapterCount: list.total, chapterPages: list.pages, chapters: list.items };
  }

  /** Paged chapter list for a series (newest first). */
  async chapters(slugOrUrl, { page = 1, perPage = 100 } = {}) {
    const slug = slugOf(slugOrUrl);
    const { data } = await this._rest("manga", { slug, per_page: 1 });
    const tagId = data[0]?.tags?.[0];
    if (!tagId) return { total: 0, pages: 0, page, items: [] };
    const r = await this._rest("posts", { tags: tagId, per_page: perPage, page, orderby: "date", order: "desc" });
    return {
      total: r.total,
      pages: r.pages,
      page,
      items: r.data.map((p) => {
        const title = decode(p.title?.rendered);
        return {
          number: chapterNumber(title, p.slug),
          title,
          slug: p.slug,
          url: `${this.baseUrl}/${p.slug}/`,
          date: p.date,
        };
      }),
    };
  }

  /** Chapter page: ordered image URLs plus series/chapter metadata. */
  async chapter(slugOrUrl) {
    const slug = slugOf(slugOrUrl);
    const html = await this._text(`/${slug}/`);
    if (!/id="Baca_Komik"/.test(html)) throw new Error(`chapter not found: ${slug}`);
    return parseChapter(html, this.baseUrl);
  }

  /** Download a whole chapter as one file into `<Downloads>/Komiku` and open it.
   * `format` = cbz (WebP, zero-dep) | pdf (JPEG). `open` = false to skip launching. */
  async download(slugOrUrl, { format = "cbz", out, dir = downloadsDir(), decoder, open = true, onProgress } = {}) {
    const fmt = format === "pdf" ? "pdf" : "cbz";
    const c = await this.chapter(slugOrUrl);
    if (!c.images.length) throw new Error(`chapter without images: ${slugOrUrl}`);
    const name = (out || `${c.seriesSlug}${c.chapter ? `-ch${c.chapter}` : ""}`).replace(/[^\w.-]+/g, "_");
    const path = resolve(dir, /\.(pdf|cbz)$/i.test(name) ? name : `${name}.${fmt}`);
    const images = [];
    for (let i = 0; i < c.images.length; i++) {
      const res = await this._getHtml(c.images[i], "image/*");
      images.push(Buffer.from(await res.arrayBuffer()));
      onProgress?.(i + 1, c.images.length);
    }
    const data =
      fmt === "pdf"
        ? pdfFromJpegs(images.map((b) => decodeToJpeg(b, decoder)))
        : zipStore(
            images.map((b, i) => ({
              name: `${String(i + 1).padStart(3, "0")}${extname(new URL(c.images[i]).pathname) || ".webp"}`,
              data: b,
            }))
          );
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, data);
    const opened = open ? openPath(path) : false;
    return { path, format: fmt, pages: images.length, bytes: data.length, opened, series: c.series, chapter: c.chapter };
  }
}

export default Komiku;
