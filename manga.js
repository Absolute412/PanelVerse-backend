import fetch from "node-fetch";  // Node version of fetch

const BASE_URL = "https://api.mangadex.org";
const BACKEND_BASE_URL = (process.env.PUBLIC_BASE_URL || "http://localhost:5000").replace(/\/$/, "");

const proxyImage = (url) =>
  `${BACKEND_BASE_URL}/api/image?url=${encodeURIComponent(url)}`;

/* ----------------------------------
   Helpers
---------------------------------- */
const getEnglishTitle = (manga) => {
  const title = manga.attributes.title;

  // 1. Main English title
  if (title?.en) return title.en;

  // 2. English alt title
  const enAlt = manga.attributes.altTitles?.find(t => t.en);
  if (enAlt) return enAlt.en;

  // 3. Any title from main title object
  const anyTitle = Object.values(title || {})[0];
  if (anyTitle) return anyTitle;

  // 4. Any alt title at all
  const anyAlt = manga.attributes.altTitles?.[0];
  if (anyAlt) return Object.values(anyAlt)[0];

  return "Untitled";
};

const formatManga = (m) => {
  const coverRel = m.relationships.find(r => r.type === "cover_art");
  const authorRel = m.relationships.find(r => r.type === "author");

  const coverFile = coverRel?.attributes?.fileName;
  const coverBase = coverFile
    ? `https://uploads.mangadex.org/covers/${m.id}/${coverFile}`
    : null;

  return {
    id: m.id,

    title:getEnglishTitle(m),

    // 👇 USE THESE
    imageThumb: coverBase ? proxyImage(`${coverBase}.256.jpg`) : "/placeholder.jpg",
    imageMedium: coverBase ? proxyImage(`${coverBase}.512.jpg`) : "/placeholder.jpg",
    imageFull: coverBase ? proxyImage(coverBase) : "/placeholder.jpg",

    author: authorRel?.attributes?.name || "Unknown",

    description: m.attributes.description?.en || "",
    genres: m.attributes.tags.map(t => t.attributes.name.en),

    status: m.attributes.status
      ? m.attributes.status[0].toUpperCase() + m.attributes.status.slice(1)
      : "Unknown",

    year: m.attributes.year || "Unknown",
    updatedAt: m.attributes.updatedAt,
    lastChapter: m.attributes.lastChapter,
  };
};


/* ----------------------------------
   SEARCH MANGA (Browse)
---------------------------------- */
export const searchManga = async (query, limit = 20) => {
  if (!query || query.trim() === "") return [];

  const url = new URL(`${BASE_URL}/manga`);
  url.searchParams.set("title", query);
  url.searchParams.set("limit", limit);
  url.searchParams.append("availableTranslatedLanguage[]", "en");
  url.searchParams.append("includes[]", "cover_art");
  url.searchParams.append("includes[]", "author");
  url.searchParams.set("order[relevance]", "desc");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`MangaDex error ${res.status}`);

  const data = await res.json();
  return data.data.map(formatManga);
};

/* ----------------------------------
   LATEST MANGA (Browse default)
---------------------------------- */
export const getLatestManga = async (limit = 20) => {
  // Step 1: get latest chapters (true "latest releases")
  const cutoff = new Date(Date.now() - 1000 * 60 * 60 * 48);
  const latestByMangaId = new Map();
  let offset = 0;
  const pageSize = 100;
  const maxPages = 5;

  while (latestByMangaId.size < limit && offset / pageSize < maxPages) {
    const chapterUrl = new URL(`${BASE_URL}/chapter`);
    chapterUrl.searchParams.set("limit", pageSize);
    chapterUrl.searchParams.set("offset", offset);
    chapterUrl.searchParams.append("translatedLanguage[]", "en");
    chapterUrl.searchParams.set("order[publishAt]", "desc");

    const chapterRes = await fetch(chapterUrl.toString());
    if (!chapterRes.ok) {
      const text = await chapterRes.text();
      throw new Error(`MangaDex ${chapterRes.status}: ${text}`);
    }

    const chapterData = await chapterRes.json();
    if (!chapterData?.data?.length) break;

    for (const ch of chapterData.data) {
    const publishAt = ch.attributes?.publishAt;
    if (!publishAt) continue;

    const publishDate = new Date(publishAt);

    // MangaDex sometimes sends fake future dates (2037 bug)
    if (publishDate > new Date()) continue;

    if (publishDate < cutoff) continue;

    const mangaRel = ch.relationships?.find((r) => r.type === "manga");
    if (!mangaRel?.id) continue;

    if (!latestByMangaId.has(mangaRel.id)) {
      latestByMangaId.set(mangaRel.id, ch);
      if (latestByMangaId.size >= limit) break;
    }
  }

    offset += pageSize;
  }

  const mangaIds = Array.from(latestByMangaId.keys());
  if (mangaIds.length === 0) return [];

  // Step 2: fetch manga info (covers/author)
  const mangaUrl = new URL(`${BASE_URL}/manga`);
  mangaUrl.searchParams.set("limit", mangaIds.length);
  mangaIds.forEach((id) => mangaUrl.searchParams.append("ids[]", id));
  mangaUrl.searchParams.append("includes[]", "cover_art");
  mangaUrl.searchParams.append("includes[]", "author");

  const mangaRes = await fetch(mangaUrl.toString());
  if (!mangaRes.ok) {
    const text = await mangaRes.text();
    throw new Error(`MangaDex ${mangaRes.status}: ${text}`);
  }

  const mangaData = await mangaRes.json();
  const mangaMap = new Map(mangaData.data.map((m) => [m.id, m]));

  return mangaIds
    .map((id) => {
      const manga = mangaMap.get(id);
      const ch = latestByMangaId.get(id);
      if (!manga || !ch) return null;
      return {
        ...formatManga(manga),
        latestPublishedAt: ch.attributes?.publishAt,
        latestChapter: ch.attributes?.chapter || null,
      };
    })
    .filter(Boolean);
};


/* ----------------------------------
   POPULAR MANGA
---------------------------------- */
export const getPopularManga = async (limit = 20, offset = 0) => {
  const url = new URL(`${BASE_URL}/manga`);

  url.searchParams.set("limit", limit);
  url.searchParams.set("offset", offset);

  url.searchParams.set("hasAvailableChapters", "true");

  // content ratings
  url.searchParams.append("contentRating[]", "safe");
  url.searchParams.append("contentRating[]", "suggestive");
  url.searchParams.append("contentRating[]", "erotica");

  // language
  url.searchParams.append("availableTranslatedLanguage[]", "en");

  // relations
  url.searchParams.append("includes[]", "cover_art");
  url.searchParams.append("includes[]", "author");

  // 🔥 POPULAR SORT
  url.searchParams.set("order[followedCount]", "desc");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Failed to fetch popular manga");

  const data = await res.json();
  return data.data.map(formatManga);
};


/* ----------------------------------
   SINGLE MANGA PAGE
---------------------------------- */
export const getManga = async (mangaId) => {
  const url = new URL(`${BASE_URL}/manga/${mangaId}`);
  url.searchParams.append("includes[]", "cover_art");
  url.searchParams.append("includes[]", "author");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`MangaDex error ${res.status}`);

  const data = await res.json();
  return formatManga(data.data);
};

const formatDate = (iso) => {
  if (!iso) return "Unknown";
  return iso.split("T")[0]; // 2023-09-05
};


/* ----------------------------------
   CHAPTERS
---------------------------------- */
export const getAllChapters = async (mangaId) => {
  let allChapters = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const url = new URL(`${BASE_URL}/chapter`);
    url.searchParams.set("manga", mangaId);
    url.searchParams.set("limit", limit);
    url.searchParams.set("offset", offset);
    url.searchParams.append("translatedLanguage[]", "en");
    url.searchParams.set("order[chapter]", "asc");

    const res = await fetch(url.toString());
    if (!res.ok) break;

    const data = await res.json();
    if (!data.data.length) break;

    allChapters.push(...data.data);
    offset += limit;
  }

  return allChapters.map(ch => ({
    id: ch.id,
    number: ch.attributes.chapter ?? null,
    title: ch.attributes.title || `Chapter ${ch.attributes.chapter ?? "?"}`,
    volume: ch.attributes.volume ?? "N/A",
    pages: ch.attributes.pages ?? 0,
    publishedAt: formatDate(ch.attributes.publishAt),
  }));
};

/* ----------------------------------
   CHAPTER PAGES
---------------------------------- */
export const getChapterPages = async (chapterId) => {
  const res = await fetch(`${BASE_URL}/at-home/server/${chapterId}`);
  if (!res.ok) throw new Error(`MangaDex error ${res.status}`);

  const data = await res.json();
  const { baseUrl, chapter } = data;

  if (!chapter || !chapter.data || chapter.data.length === 0) return [];

  return chapter.data.map((file, index) => ({
    index,
    image: proxyImage(`${baseUrl}/data/${chapter.hash}/${file}`),
  }));
};
