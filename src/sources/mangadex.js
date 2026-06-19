const BASE_URL = "https://api.mangadex.org";
const fetch = globalThis.fetch.bind(globalThis);

const PUBLIC_BASE_URL =
  (process.env.PUBLIC_BASE_URL || "http://localhost:5000").replace(/\/$/, "");

const proxyImage = (url) =>
  `${PUBLIC_BASE_URL}/api/image?url=${encodeURIComponent(url)}`;

/* ----------------------------------
   SIMPLE GLOBAL THROTTLE
---------------------------------- */
let lastRequestTime = 0;
const MIN_INTERVAL = 1000; // 1000ms between ALL requests

const throttle = async () => {
  const now = Date.now();
  const diff = now - lastRequestTime;

  if (diff < MIN_INTERVAL) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL - diff));
  }

  lastRequestTime = Date.now();
};

const chapterCache = new Map();
const CACHE_TTL = 1000 * 60 * 60;   // 1 hour

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/* ----------------------------------
   FETCH (SAFE + NO RETRY STORM)
---------------------------------- */
const fetchWithRetry = async (url, retries = 5) => {
  for (let i = 0; i <= retries; i++) {
    try {
      await throttle();

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "PanelVerse/1.0",
          "Accept": "application/json",
        },
      });

      clearTimeout(timeout);

      // success
      if (res.ok) return res;

      // dont retry client errors
      if (res.status < 500) {
        return res;
      }

      // retry server errors (503, 500)
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      const isLast = i === retries;

      // if last attempt - throw
      if (isLast) throw err;

      // exponential backoff
      const wait = 1000 * Math.pow(2, i);
      await delay(wait);
    }
  }
};

/* ----------------------------------
   HELPERS
---------------------------------- */
const getEnglishTitle = (manga) => {
  const title = manga?.attributes?.title || {};
  const altTitles = manga?.attributes?.altTitles || [];

  const englishAlts = altTitles
    .map((t) => t?.en)
    .filter(Boolean)
    .map((s) => s.trim());

    // Prefer English title first
    if (englishAlts.length) return englishAlts[0];

  if (title.en) return title.en;

  return Object.values(title)[0] || "Untitled";
};

const cleanDescription = (text) => {
  if (!text) return "";

  let cleaned = text;

  // Remove footer only if it's clearly a separator block
  if (cleaned.includes('\n---')) {
    cleaned = cleaned.split('\n---')[0];
  }

  // Remove markdown links but keep text
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Remove raw URLs AND empty lines they leave behind
  cleaned = cleaned.replace(/https?:\/\/[^\s]+/g, '');

  // Remove markdown styling
  cleaned = cleaned
    .replace(/[*_>#]/g, '')   // basic markdown chars
    .replace(/`{1,3}/g, '');

  // Remove obvious link sections (more strict)
  cleaned = cleaned.split('\n').filter(line => {
    const l = line.toLowerCase().trim();

    return !(
      l.startsWith('links') ||
      l.startsWith('official') ||
      l.startsWith('read on') ||
      l === '___'
    );
  }).join('\n');

  // Normalize spacing
  cleaned = cleaned
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return cleaned;
};

const formatManga = (m) => {
  const relationships = m?.relationships || [];

  const coverRel = relationships.find((r) => r.type === "cover_art");
  const authorRel = relationships.find((r) => r.type === "author");

  const coverFile = coverRel?.attributes?.fileName;

  const coverBase = coverFile
    ? `https://uploads.mangadex.org/covers/${m.id}/${coverFile}`
    : null;

  return {
    id: m.id,
    title: getEnglishTitle(m),

    imageThumb: coverBase ? proxyImage(coverBase) : "/placeholder.jpg",

    imageMedium: coverBase ? proxyImage(coverBase) : "/placeholder.jpg",

    imageFull: coverBase
      ? proxyImage(coverBase)
      : "/placeholder.jpg",

    author: authorRel?.attributes?.name || "Unknown",
    description: cleanDescription(m?.attributes?.description?.en),
    genres:
      m?.attributes?.tags
        ?.map((t) => t?.attributes?.name?.en)
        .filter(Boolean) || [],

    status: m?.attributes?.status
      ? m.attributes.status[0].toUpperCase() +
        m.attributes.status.slice(1)
      : "Unknown",

    year: m?.attributes?.year || "Unknown",
    updatedAt: m?.attributes?.updatedAt,
    lastChapter: m?.attributes?.lastChapter,
  };
};

/* ----------------------------------
   SEARCH
---------------------------------- */
export const searchManga = async (query, limit = 20, offset = 0) => {
  if (!query?.trim()) return [];

  const url = new URL(`${BASE_URL}/manga`);
  url.searchParams.set("title", query);
  url.searchParams.set("limit", limit);
  url.searchParams.set("offset", offset);

  url.searchParams.append("availableTranslatedLanguage[]", "en");
  url.searchParams.append("includes[]", "cover_art");
  url.searchParams.append("includes[]", "author");

  const res = await fetchWithRetry(url.toString());
  const data = await res.json();

  return data?.data?.map(formatManga) || [];
};

/* ----------------------------------
   POPULAR
---------------------------------- */
export const getPopularManga = async (limit = 20, offset = 0) => {
  const url = new URL(`${BASE_URL}/manga`);

  url.searchParams.set("limit", limit);
  url.searchParams.set("offset", offset);
  url.searchParams.set("hasAvailableChapters", "true");

  url.searchParams.append("contentRating[]", "safe");
  url.searchParams.append("availableTranslatedLanguage[]", "en");
  url.searchParams.append("includes[]", "cover_art");
  url.searchParams.append("includes[]", "author");

  url.searchParams.set("order[followedCount]", "desc");

  const res = await fetchWithRetry(url.toString());
  const data = await res.json();

  return data?.data?.map(formatManga) || [];
};

/* ----------------------------------
   RECENTLY ADDED
---------------------------------- */
export const getRecentlyAddedManga = async (limit = 20, offset = 0) => {
  const url = new URL(`${BASE_URL}/manga`);

  url.searchParams.set("limit", limit);
  url.searchParams.set("offset", offset);
  url.searchParams.set("hasAvailableChapters", "true");

  url.searchParams.append("contentRating[]", "safe");
  url.searchParams.append("availableTranslatedLanguage[]", "en");
  url.searchParams.append("includes[]", "cover_art");
  url.searchParams.append("includes[]", "author");

  url.searchParams.set("order[createdAt]", "desc");

  const res = await fetchWithRetry(url.toString());
  const data = await res.json();

  return data?.data?.map(formatManga) || [];
};

/* ----------------------------------
   LATEST MANGA (SAFE VERSION)
---------------------------------- */
export const getLatestManga = async (limit = 20) => {
  const url = new URL(`${BASE_URL}/manga`);

  url.searchParams.set("limit", limit);
  url.searchParams.set("hasAvailableChapters", "true");

  url.searchParams.append("contentRating[]", "safe");
  url.searchParams.append("availableTranslatedLanguage[]", "en");
  url.searchParams.append("includes[]", "cover_art");
  url.searchParams.append("includes[]", "author");

  url.searchParams.set("order[updatedAt]", "desc");

  const res = await fetchWithRetry(url.toString());
  const data = await res.json();

  return data?.data?.map(formatManga) || [];
};

/* ----------------------------------
   SINGLE MANGA
---------------------------------- */
export const getManga = async (mangaId) => {
  const url = new URL(`${BASE_URL}/manga/${mangaId}`);
  url.searchParams.append("includes[]", "cover_art");
  url.searchParams.append("includes[]", "author");

  const res = await fetchWithRetry(url.toString());
  const data = await res.json();

  return formatManga(data.data);
};

const formatDate = (iso) => {
  if (!iso) return "Unknown";
  // Keep a compact yyyy-mm-dd string for chapter rows.
  return iso.split("T")[0]; // 2023-09-05
};

/* ----------------------------------
   CHAPTERS
---------------------------------- */
export const getAllChapters = async (mangaId) => {
  const cached = chapterCache.get(mangaId);

  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    return cached.data;
  }

  // MangaDex chapter list is paginated; collect all pages in batches of 50.
  let allChapters = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const url = new URL(`${BASE_URL}/chapter`);
    url.searchParams.set("manga", mangaId);
    url.searchParams.set("limit", limit);
    url.searchParams.set("offset", offset);
    url.searchParams.append("translatedLanguage[]", "en");
    url.searchParams.set("order[chapter]", "asc");

    const res = await fetchWithRetry(url.toString());
    if (!res.ok) {
      console.warn("Chapter fetch failed:", res.status);
      break;
    }

    const data = await res.json();
    if (!data.data.length) break;

    allChapters.push(...data.data);
    offset += limit;
  }

  const result = allChapters.map(ch => ({
    id: ch.id,
    number: ch.attributes.chapter ?? null,
    title: ch.attributes.title || "",
    volume: ch.attributes.volume ?? "N/A",
    pages: ch.attributes.pages ?? 0,
    publishedAt: formatDate(ch.attributes.publishAt),

    source: "mangadex",
  }));

  chapterCache.set(mangaId, {
    data: result,
    timestamp: Date.now(),
  });
  return result;
};

/* ----------------------------------
   CHAPTER PAGES
---------------------------------- */
export const getChapterPages = async (chapterId) => {
  // At-home endpoint returns `baseUrl` + chapter hash + file names for page URLs.
  const res = await fetchWithRetry(`${BASE_URL}/at-home/server/${chapterId}`);
  if (!res.ok) throw new Error(`MangaDex error ${res.status}`);

  const data = await res.json();
  const { baseUrl, chapter } = data;

  if (!chapter || !chapter.data || chapter.data.length === 0) return [];

  return chapter.data.map((file, index) => ({
    index,
    image: proxyImage(`${baseUrl}/data/${chapter.hash}/${file}`),
  }));
};
