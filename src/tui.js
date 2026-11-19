// Zero-dependency interactive TUI for the komiku client.
// Raw-mode stdin + ANSI alternate screen; every screen pulls from the library.

import { openPath } from "./open.js";

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  rev: "\x1b[7m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  green: "\x1b[32m",
};

const pad = (s, w) => (s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length));
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const truncate = (s, w) => (stripAnsi(s).length <= w ? s : stripAnsi(s).slice(0, w));

class Tui {
  constructor(api) {
    this.api = api;
    this.stack = [];
    this.cursor = 0;
    this.offset = 0;
    this.mode = "list";
    this.input = "";
    this.status = "";
    this.loadSeq = 0;
    this._onKey = this._onKey.bind(this);
    this._onResize = () => this.render();
  }

  async start() {
    if (!process.stdin.isTTY) {
      console.error("error: TUI butuh terminal interaktif (TTY)");
      process.exit(1);
    }
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdout.write("\x1b[?1049h\x1b[?25l");
    process.on("SIGINT", () => this.quit());
    process.on("exit", () => {
      try {
        process.stdin.setRawMode(false);
      } catch {}
      process.stdout.write("\x1b[?25h\x1b[?1049l");
    });
    process.stdout.on("resize", this._onResize);
    process.stdin.on("data", this._onKey);
    await this.push(rootScreen(this));
  }

  quit() {
    process.stdout.write("\x1b[?25h\x1b[?1049l");
    try {
      process.stdin.setRawMode(false);
    } catch {}
    process.stdin.pause();
    process.exit(0);
  }

  top() {
    return this.stack[this.stack.length - 1];
  }

  async push(screen) {
    this.stack.push(screen);
    this.cursor = 0;
    this.offset = 0;
    this.status = "";
    this.render();
    await this._load(screen);
  }

  async _load(screen) {
    const seq = ++this.loadSeq;
    screen.loading = true;
    this.status = "";
    this.render();
    try {
      await screen.load?.(screen);
    } catch (e) {
      screen.error = e.message;
    }
    if (seq !== this.loadSeq || this.top() !== screen) return;
    screen.loading = false;
    this.status = "";
    this.render();
  }

  async refresh() {
    const s = this.top();
    if (!s.load) return this.render();
    s.items = [];
    s.info = [];
    s.error = null;
    await this._load(s);
  }

  async back() {
    if (this.stack.length <= 1) return this.quit();
    this.stack.pop();
    this.cursor = 0;
    this.offset = 0;
    await this._load(this.top());
  }

  move(delta) {
    const s = this.top();
    const n = (s.items || []).length;
    if (!n) return;
    this.cursor = (this.cursor + delta + n) % n;
    this.render();
  }

  select() {
    const s = this.top();
    const item = (s.items || [])[this.cursor];
    if (!item?.action) return this.render();
    Promise.resolve()
      .then(() => item.action())
      .catch((e) => {
        this.status = C.red + "error: " + e.message + C.reset;
        this.render();
      });
  }

  openUrl(title, url) {
    const copy = () => {
      process.stdout.write(`\x1b]52;c;${Buffer.from(url).toString("base64")}\x07`);
      this.status = C.green + "URL disalin" + C.reset;
      this.render();
    };
    const open = () => {
      this.status = openPath(url) ? C.green + "dibuka di browser" + C.reset : C.red + "gagal membuka browser" + C.reset;
      this.render();
    };
    this.push({
      title: "Tautan",
      info: [C.bold + title + C.reset, "", C.cyan + url + C.reset, ""],
      items: [
        { text: "Buka di browser", sub: "o", action: open },
        { text: "Salin URL", sub: "u", action: copy },
      ],
      load: null,
      onKey: (k) => {
        if (k === "o") open();
        else if (k === "u") copy();
        else this.render();
      },
    });
  }

  _onKey(data) {
    const s = this.top();
    if (this.mode === "input") return this._onInput(data);

    if (data === "\u0003" || data === "q") return this.quit();
    if (data === "\u001b[A" || data === "k") return this.move(-1);
    if (data === "\u001b[B" || data === "j") return this.move(1);
    if (data === "\u001b" || data === "\u001b[D" || data === "\u007f" || data === "h") return this.back();
    if (data === "\r" || data === "\n") return this.select();
    if (data === "r") return this.refresh();
    if (data === "g") {
      this.cursor = 0;
      return this.render();
    }
    if (data === "G") {
      this.cursor = Math.max(0, (s?.items || []).length - 1);
      return this.render();
    }
    if (s?.onKey) return s.onKey(data);
    this.render();
  }

  _onInput(data) {
    if (data === "\u0003") return this.quit();
    if (data === "\u001b") {
      this.mode = "list";
      this.input = "";
      return this.render();
    }
    if (data === "\r" || data === "\n") {
      const q = this.input.trim();
      this.mode = "list";
      if (q) this.top().submit?.(q);
      return;
    }
    if (data === "\u007f") this.input = this.input.slice(0, -1);
    else if (data >= " " && data !== "\u007f") this.input += data;
    this.render();
  }

  render() {
    const s = this.top();
    if (!s) return;
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;
    const w = cols - 1;

    const lines = [];
    lines.push(C.bold + C.cyan + " komiku" + C.reset + C.dim + "  │  " + C.reset + C.bold + s.title + C.reset);
    lines.push(C.dim + " " + this.stack.map((x) => x.title).join(" › ") + C.reset);

    for (const raw of s.info || []) lines.push(" " + raw);

    const footer = [];
    if (this.mode === "input") {
      footer.push(" " + C.yellow + "cari: " + C.reset + this.input + "\u2588");
      footer.push(C.dim + " Enter=cari · Esc=batal" + C.reset);
    } else {
      if (s.error) footer.push(" " + C.red + s.error + C.reset);
      else footer.push(" " + (this.status || ""));
      footer.push(C.dim + " ↑/↓ pilih · Enter buka · Esc/← kembali · r muat ulang · q keluar" + C.reset);
    }

    const listH = Math.max(1, rows - lines.length - footer.length);
    const items = s.items || [];
    if (this.cursor < this.offset) this.offset = this.cursor;
    if (this.cursor >= this.offset + listH) this.offset = this.cursor - listH + 1;
    this.offset = Math.max(0, Math.min(this.offset, Math.max(0, items.length - listH)));

    const listLines = [];
    if (!items.length) listLines.push(" " + C.dim + (s.loading ? "memuat..." : "(kosong)") + C.reset);
    for (let i = this.offset; i < Math.min(items.length, this.offset + listH); i++) {
      const it = items[i];
      const sel = i === this.cursor;
      const mark = sel ? C.cyan + "❯ " + C.reset : "  ";
      const text = it.text + (it.sub ? C.dim + "  · " + it.sub + C.reset : "");
      listLines.push(sel ? C.rev + pad(stripAnsi(mark) + stripAnsi(text), w) + C.reset : mark + text);
    }

    let screen = [...lines, ...listLines];
    const room = rows - footer.length;
    if (screen.length > room) screen = screen.slice(0, Math.max(lines.length, room));
    while (screen.length < room) screen.push("");
    screen.push(...footer);
    screen = screen.slice(0, rows);

    process.stdout.write(
      "\x1b[?25l\x1b[H" +
        screen.map((l) => truncate(l, w) + "\x1b[K").join("\n") +
        "\x1b[J"
    );
  }
}

// --------------------------------------------------------------------------
// Screens
// --------------------------------------------------------------------------

function cardItems(tui, list, go) {
  return list.map((c) => ({ text: c.title, sub: c.chapter || c.meta || c.type || undefined, action: () => go(c) }));
}

function rootScreen(tui) {
  return {
    title: "Menu",
    info: ["", C.dim + " Klien komiku.org — pilih sumber data" + C.reset],
    load: (s) => {
      s.items = [
        { text: "Beranda", sub: "update terbaru + peringkat", action: async () => tui.push(homeScreen(tui)) },
        { text: "Cari komik...", sub: "tekan Enter lalu ketik", action: () => enterSearch(tui) },
        { text: "Peringkat", sub: "harian · mingguan · bulanan · total", action: async () => tui.push(rankScreen(tui)) },
        { text: "Perpustakaan", sub: "manga · manhwa · manhua", action: async () => tui.push(libraryScreen(tui)) },
      ];
    },
  };
}

function enterSearch(tui) {
  tui.mode = "input";
  tui.input = "";
  tui.top().submit = (q) => tui.push(searchScreen(tui, q));
  tui.render();
}

const goManga = (tui) => (c) => tui.push(mangaScreen(tui, c.slug));

function searchScreen(tui, query) {
  return {
    title: `Cari: ${query}`,
    info: [],
    load: async (s) => {
      const cards = await tui.api.search(query);
      s.info = ["", C.dim + ` ${cards.length} hasil` + C.reset];
      s.items = cardItems(tui, cards, goManga(tui));
    },
    onKey: (k) => {
      if (k === "s") enterSearch(tui);
      else tui.render();
    },
  };
}

function homeScreen(tui) {
  return {
    title: "Beranda",
    info: [],
    load: async (s) => {
      const d = await tui.api.home();
      const top = (d.ranking.harian || []).slice(0, 5).map((c) => c.title);
      s.info = [
        "",
        C.dim + ` Peringkat: ${top.join(" · ") || "-"}` + C.reset,
        C.dim + ` Section: ${d.sections.map((x) => x.title).join(" · ")}` + C.reset,
        "",
      ];
      const latest = d.sections.find((x) => /terbaru|update/i.test(x.title)) || d.sections[0];
      s.items = cardItems(tui, latest?.items || [], goManga(tui));
    },
  };
}

function rankScreen(tui) {
  return {
    title: "Peringkat",
    info: [],
    load: (s) => {
      s.items = ["harian", "mingguan", "bulanan", "total"].map((period) => ({
        text: period,
        action: async () => {
          const cards = await tui.api.ranking(period);
          tui.push({ title: `Peringkat ${period}`, info: ["", C.dim + ` ${cards.length} judul` + C.reset], items: cardItems(tui, cards, goManga(tui)), load: null });
        },
      }));
    },
  };
}

function libraryScreen(tui) {
  return {
    title: "Perpustakaan",
    info: [],
    load: (s) => {
      s.items = ["manga", "manhwa", "manhua"].map((tipe) => ({
        text: tipe,
        action: async () => {
          const cards = await tui.api.listing({ tipe });
          tui.push({ title: `Perpustakaan: ${tipe}`, info: ["", C.dim + ` ${cards.length} judul` + C.reset], items: cardItems(tui, cards, goManga(tui)), load: null });
        },
      }));
    },
  };
}

function mangaScreen(tui, slugOrUrl) {
  return {
    title: "Detail Komik",
    info: [],
    load: async (s) => {
      const m = await tui.api.manga(slugOrUrl);
      s.title = m.title;
      s.info = [
        "",
        ` ${C.bold}${m.title}${C.reset}`,
        C.dim + ` ${[m.status, m.type].filter(Boolean).join(" · ")}` + C.reset,
        C.dim + ` ${m.genres.join(", ")}` + C.reset,
        C.dim + ` ${m.chapterCount} chapter` + C.reset,
        "",
      ];
      s.items = m.chapters
        .slice()
        .reverse()
        .map((ch) => ({ text: ch.title, sub: ch.date?.slice(0, 10), action: () => tui.push(chapterScreen(tui, ch.slug)) }));
    },
  };
}

function chapterScreen(tui, slugOrUrl) {
  const save = async (format) => {
    try {
      const d = await tui.api.download(slugOrUrl, {
        format,
        onProgress: (i, n) => {
          tui.status = C.yellow + `mengunduh ${format} ${i}/${n}` + C.reset;
          tui.render();
        },
      });
      tui.status = C.green + `tersimpan: ${d.path}${d.opened ? " (dibuka)" : ""}` + C.reset;
    } catch (e) {
      tui.status = C.red + "error: " + e.message + C.reset;
    }
    tui.render();
  };
  return {
    title: "Chapter",
    info: [],
    load: async (s) => {
      const c = await tui.api.chapter(slugOrUrl);
      s.title = `${c.series} — Ch.${c.chapter}`;
      s.info = ["", ` ${C.bold}${c.series} — Chapter ${c.chapter}${C.reset}`, C.dim + ` ${c.images.length} gambar` + C.reset, ""];
      const items = [
        { text: "⬇ Unduh PDF (satu file)", sub: "d", action: () => save("pdf") },
        { text: "⬇ Unduh CBZ", sub: "c", action: () => save("cbz") },
        { text: "🖼  Daftar gambar", sub: "l", action: () => tui.push(imagesScreen(tui, slugOrUrl)) },
      ];
      try {
        const wanted = String(slugOrUrl).replace(/^https?:\/\/[^/]+\//, "").replace(/^\/+|\/+$/g, "");
        const list = (await tui.api.chapters(c.seriesSlug, { perPage: 100 })).items;
        const i = list.findIndex((x) => x.slug === wanted);
        if (i >= 0) {
          if (list[i - 1]) items.push({ text: "Chapter berikutnya →", sub: list[i - 1].number ?? undefined, action: () => tui.push(chapterScreen(tui, list[i - 1].slug)) });
          if (list[i + 1]) items.push({ text: "← Chapter sebelumnya", sub: list[i + 1].number ?? undefined, action: () => tui.push(chapterScreen(tui, list[i + 1].slug)) });
        }
      } catch {}
      items.push({ text: "Semua chapter", action: () => tui.push(mangaScreen(tui, c.seriesSlug)) });
      s.items = items;
    },
    onKey: (k) => {
      if (k === "d") save("pdf");
      else if (k === "c") save("cbz");
      else if (k === "l") tui.push(imagesScreen(tui, slugOrUrl));
      else tui.render();
    },
  };
}

function imagesScreen(tui, slugOrUrl) {
  return {
    title: "Daftar Gambar",
    info: [],
    load: async (s) => {
      const c = await tui.api.chapter(slugOrUrl);
      s.title = `Gambar · ${c.series} Ch.${c.chapter}`;
      s.info = ["", C.dim + ` ${c.images.length} gambar` + C.reset, ""];
      s.items = c.images.map((url, i) => ({
        text: `Gambar ${i + 1}`,
        sub: url.replace(/^https?:\/\/[^/]+\//, ""),
        action: () => tui.openUrl(`${c.series} Ch.${c.chapter} #${i + 1}`, url),
      }));
    },
  };
}

export async function runTui(api) {
  const tui = new Tui(api);
  await tui.start();
}
