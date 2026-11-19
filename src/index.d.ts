/** A card as listed on the home page or a ranking panel. */
export interface Card {
  title: string;
  slug: string;
  url: string;
  image: string | null;
  /** Latest chapter label, e.g. "Chapter 410". */
  chapter: string | null;
  /** Genre · views/time line, as shown by the theme. */
  meta: string | null;
  type: string | null;
  rank: number | null;
}

/** A series card from the search / catalog endpoints (extra REST fields). */
export interface SeriesCard extends Card {
  id: number;
  status: string | null;
  genres: string[];
  tagId: number | null;
  modified: string;
}

export interface HomeSection {
  title: string;
  items: Card[];
}

export interface ChapterListItem {
  /** Parsed chapter number, e.g. "410", or null. */
  number: string | null;
  title: string;
  slug: string;
  url: string;
  date: string;
}

export interface Manga extends SeriesCard {
  poster: string | null;
  synopsis: string;
  chapterCount: number;
  chapterPages: number;
  chapters: ChapterListItem[];
}

export interface ChapterDetail {
  url: string;
  id: number | null;
  seriesId: number | null;
  series: string | null;
  seriesSlug: string;
  seriesUrl: string;
  chapter: string | null;
  count: number;
  hasNext: boolean;
  thumbnail: string | null;
  images: string[];
}

export interface HomeResult {
  sections: HomeSection[];
  /** Keyed by period: harian | mingguan | bulanan | total. */
  ranking: Record<string, Card[]>;
}

export interface DownloadResult {
  path: string;
  format: "pdf" | "cbz";
  pages: number;
  bytes: number;
  /** Whether the file was launched with the OS handler. */
  opened: boolean;
  series: string;
  chapter: string;
}

export interface KomikuOptions {
  /** Defaults to https://komiku.org */
  baseUrl?: string;
  /** Defaults to https://api.komiku.org/wp-json/wp/v2 */
  restUrl?: string;
  userAgent?: string;
  /** Request timeout in milliseconds. Default 20000. */
  timeoutMs?: number;
  /** Custom fetch implementation (for testing or runtimes without global fetch). */
  fetch?: typeof fetch;
}

export class Komiku {
  constructor(options?: KomikuOptions | string);
  baseUrl: string;
  restUrl: string;
  home(): Promise<HomeResult>;
  search(query: string, options?: { tipe?: string; page?: number; perPage?: number }): Promise<SeriesCard[]>;
  ranking(period?: "harian" | "mingguan" | "bulanan" | "total" | string): Promise<Card[]>;
  listing(options?: { tipe?: string; orderby?: "modified" | "date" | string; page?: number; perPage?: number }): Promise<SeriesCard[]>;
  manga(slugOrUrl: string, options?: { page?: number; perPage?: number; withChapters?: boolean }): Promise<Manga>;
  chapters(slugOrUrl: string, options?: { page?: number; perPage?: number }): Promise<{ total: number; pages: number; page: number; items: ChapterListItem[] }>;
  chapter(slugOrUrl: string): Promise<ChapterDetail>;
  /** Save a whole chapter as one file into `<Downloads>/Komiku` and open it.
   * `pdf` embeds JPEG pages (needs an image decoder for the site's WebP);
   * `cbz` is a zero-dependency zip of the WebP pages. */
  download(slugOrUrl: string, options?: {
    format?: "pdf" | "cbz";
    out?: string;
    dir?: string;
    decoder?: unknown;
    open?: boolean;
    onProgress?: (done: number, total: number) => void;
  }): Promise<DownloadResult>;
}

export default Komiku;
