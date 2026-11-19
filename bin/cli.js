#!/usr/bin/env node
import { Komiku } from "../src/index.js";

const [cmd, ...args] = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const json = args.includes("--json") || !process.stdout.isTTY;
const flag = (name, def) => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : def;
};
const api = new Komiku({
  baseUrl: process.env.KOMIKU_BASE || undefined,
  restUrl: process.env.KOMIKU_REST || undefined,
});

const usage = `komiku <command> [args] [--json]

  home                       update terbaru + peringkat
  search <query> [--tipe t]  cari komik (tipe: manga|manhwa|manhua)
  rank [--period p]          peringkat (harian|mingguan|bulanan|total)
  listing [--tipe t] [--orderby o]
                             katalog (orderby: modified|date)
  manga <slug|url>           detail komik + daftar chapter
  chapters <slug|url> [--page n]
                             daftar chapter
  chapter <slug|url>         isi chapter (URL gambar)
  download <slug|url> [--pdf|--cbz] [--out f] [--dir d] [--no-open]
                             unduh chapter jadi satu file (default: <Downloads>/Komiku)
  tui                        antarmuka terminal interaktif

env: KOMIKU_BASE (default https://komiku.org)
     KOMIKU_REST (default https://api.komiku.org/wp-json/wp/v2)`;

const out = (data, human) => console.log(json ? JSON.stringify(data, null, 2) : human(data));
const cardLine = (c) => `  ${c.title}${c.chapter ? `  [${c.chapter}]` : ""}\n      ${c.url}`;
const cards = (rows) => rows.map(cardLine).join("\n") || "  (no results)";

try {
  if (!cmd || ["help", "--help", "-h"].includes(cmd)) {
    console.log(usage);
  } else if (cmd === "tui") {
    const { runTui } = await import("../src/tui.js");
    await runTui(api);
  } else if (cmd === "home") {
    const d = await api.home();
    out(
      d,
      (d) =>
        `SECTIONS\n` +
        d.sections.map((s) => `  ${s.title} (${s.items.length})`).join("\n") +
        `\n\nPERINGKAT HARIAN\n` +
        (d.ranking.harian || []).map(cardLine).join("\n")
    );
  } else if (cmd === "search") {
    out(await api.search(positional.join(" "), { tipe: flag("tipe") }), cards);
  } else if (cmd === "rank") {
    out(await api.ranking(flag("period", "harian")), cards);
  } else if (cmd === "listing") {
    out(await api.listing({ tipe: flag("tipe"), orderby: flag("orderby", "modified") }), cards);
  } else if (cmd === "manga") {
    const d = await api.manga(positional[0]);
    out(
      d,
      (d) =>
        `${d.title}\n` +
        `  type: ${d.type} | status: ${d.status} | chapters: ${d.chapterCount}\n` +
        `  genres: ${d.genres.join(", ")}\n\n` +
        `${d.synopsis}\n\n` +
        d.chapters.slice(0, 10).map((c) => `  ${c.title}  ${c.date.slice(0, 10)}  ${c.url}`).join("\n") +
        (d.chapters.length > 10 ? `\n  ... ${d.chapterCount - 10} more` : "")
    );
  } else if (cmd === "chapters") {
    const d = await api.chapters(positional[0], { page: Number(flag("page", 1)) });
    out(
      d,
      (d) =>
        `CHAPTERS (${d.total}, halaman ${d.page}/${d.pages})\n` +
        d.items.map((c) => `  ${c.title}  ${c.date.slice(0, 10)}  ${c.url}`).join("\n")
    );
  } else if (cmd === "download") {
    const format = (args.includes("--pdf") && "pdf") || (args.includes("--cbz") && "cbz") || flag("format", "pdf");
    const onProgress = json ? undefined : (i, n) => process.stderr.write(`\r  mengunduh ${i}/${n}`);
    const d = await api.download(positional[0], {
      format,
      out: flag("out"),
      dir: flag("dir"),
      open: !args.includes("--no-open"),
      onProgress,
    });
    if (onProgress) process.stderr.write("\n");
    out(d, (d) => `${d.path}\n  ${d.format} · ${d.pages} halaman · ${(d.bytes / 1048576).toFixed(1)} MB${d.opened ? " · dibuka" : ""}`);
  } else if (cmd === "chapter") {
    const d = await api.chapter(positional[0]);
    out(
      d,
      (d) =>
        `${d.series} — Chapter ${d.chapter}\n` +
        `  series: ${d.seriesUrl}\n  ${d.images.length} gambar\n\n` +
        d.images.map((u, i) => `  ${String(i + 1).padStart(3)}  ${u}`).join("\n")
    );
  } else {
    console.error(`Unknown command: ${cmd}\n\n${usage}`);
    process.exit(2);
  }
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exit(1);
}
