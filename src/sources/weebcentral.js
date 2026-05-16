import fetch from "node-fetch";
import * as cheerio from "cheerio";

const BASE = "https://weebcentral.com";
const DEFAULT_HEADERS = {
  "User-Agent": "PanelVerse/1.0",
};

// Shared HTML fetch helper so all source calls use a consistent user-agent.
const fetchHTML = async (url, extraHeaders = {}) => {
  const res = await fetch(url, {
    headers: {
      ...DEFAULT_HEADERS,
      ...extraHeaders,
    },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
};

const isWeebErrorPage = (html = "") => {
  // WeebCentral can return branded 400/404 pages with status 200, so detect by content.
  const lowered = String(html).toLowerCase();
  return (
    lowered.includes('href="https://weebcentral.com/404"') ||
    lowered.includes('href="https://weebcentral.com/400"') ||
    lowered.includes("<title>404") ||
    lowered.includes("<title>400")
  );
};

const parseChapterNumber = (text = "") => {
  const raw = String(text || "").trim();
  if (!raw) return null;

  // Match common patterns: "Chapter 12", "Ch. 12.5", "Ep 7", "#10"
  const labeled =
    raw.match(/\bchapter\s*[:#-]?\s*([\d.]+)/i) ||
    raw.match(/\bch(?:apter)?\.?\s*[:#-]?\s*([\d.]+)/i) ||
    raw.match(/\bep(?:isode)?\.?\s*[:#-]?\s*([\d.]+)/i) ||
    raw.match(/#\s*([\d.]+)/);
  if (labeled) return labeled[1];

  // Fallback: first numeric token in title.
  const anyNumber = raw.match(/(\d+(?:\.\d+)?)/);
  return anyNumber ? anyNumber[1] : null;
};

const normalizeTitle = (value = "") =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const parseTitleAndAuthor = (rawTitle = "") => {
  const text = String(rawTitle || "").trim();
  if (!text) return { title: "", author: "" };

  // Some WeebCentral cards render as "Title (AUTHOR NAME)". Capture that author hint.
  const parentheticalMatch = text.match(/^(.*?)\s*\(([^()]{2,80})\)\s*$/);
  if (!parentheticalMatch) {
    return { title: text, author: "" };
  }

  const parsedTitle = parentheticalMatch[1].trim();
  const parsedAuthor = parentheticalMatch[2].trim();
  const normalizedParen = normalizeTitle(parsedAuthor);
  const looksLikeEditionTag =
    /\b(colou?r(ed)?|color|official|digital|edition|version|remaster(ed)?|comic|comics|volume|vol|season|part)\b/i.test(
      normalizedParen
    );

  if (!parsedTitle) return { title: text, author: "" };
  // Preserve edition markers in title (e.g. "(Color)") so variant matching can work.
  if (looksLikeEditionTag) {
    return { title: text, author: "" };
  }

  return { title: parsedTitle, author: parsedAuthor };
};

const extractSearchCardTitle = (raw = "") => {
  const text = String(raw || "");
  const lineParts = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  // Card text often includes badges like "Official" before the real title.
  if (lineParts.length > 1) {
    return lineParts[lineParts.length - 1];
  }

  return text.replace(/\s+/g, " ").trim();
};

const splitAuthorCandidates = (value = "") =>
  String(value)
    .replace(/\b(author\(s\)|authors?)\b/gi, " ")
    .split(/,|\/|;|&|\band\b/gi)
    .map((part) => part.trim())
    .filter(Boolean);

const parseAuthorsFromSeriesHtml = (html = "") => {
  const $ = cheerio.load(html);
  const authors = new Set();

  // Prefer creator links if present.
  $("a[href*='author'], a[href*='creator']").each((_, el) => {
    const text = $(el).text().trim();
    for (const name of splitAuthorCandidates(text)) {
      if (normalizeTitle(name)) authors.add(name);
    }
  });

  // Fallback to raw metadata labels like "Author(s): LEE Gyuntak, Noh Miyoung".
  if (authors.size === 0) {
    const bodyText = $("body").text().replace(/\s+/g, " ").trim();
    const match =
      bodyText.match(/Author\(s\)\s*:\s*(.+?)(?:\s{2,}|Status\s*:|Type\s*:|Genre\s*:|Year\s*:|$)/i) ||
      bodyText.match(/Authors?\s*:\s*(.+?)(?:\s{2,}|Status\s*:|Type\s*:|Genre\s*:|Year\s*:|$)/i);

    if (match?.[1]) {
      for (const name of splitAuthorCandidates(match[1])) {
        if (normalizeTitle(name)) authors.add(name);
      }
    }
  }

  return [...authors];
};

const formatDate = (iso) => {
  if (!iso) return "Unknown";
  return iso.split("T")[0]; // 2023-09-05
};

const parseChaptersFromHtml = (html = "") => {
  const $ = cheerio.load(html);
  const seen = new Set();
  const chapters = [];

  // Chapter links are embedded as anchors that contain "/chapters/<id>".
  $('a[href*="/chapters/"]').each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    const idMatch = href.match(/\/chapters\/([A-Za-z0-9]+)/);
    const chapterId = idMatch?.[1];
    if (!chapterId || seen.has(chapterId)) return;
    seen.add(chapterId);

    const timeEl = $(el).find("time");
    const publishedAt = formatDate(timeEl.attr("datetime") || timeEl.text().trim() || "Unknown");

    const rawText = $(el).text();
    // Strip noisy fragments (last-read labels, inline style text, embedded timestamps).
    const cleanText = rawText
      .replace(/Last Read/gi, "")
      .replace(/\.st0\s*\{[^}]+\}/gi, "")
      .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "")
      .replace(/\s+/g, " ")
      .trim();

    const number = parseChapterNumber(cleanText);

    chapters.push({
      id: chapterId,
      number,
      title: cleanText || `Chapter ${number || "?"}`,
      volume: "N/A",
      pages: 0,
      publishedAt,
    });
  });

  // Reader expects ascending chapter order (oldest -> newest).
  chapters.sort((a, b) => {
    const na = Number.parseFloat(a.number);
    const nb = Number.parseFloat(b.number);
    const aNaN = Number.isNaN(na);
    const bNaN = Number.isNaN(nb);
    if (aNaN && bNaN) return 0;
    if (aNaN) return 1;
    if (bNaN) return -1;
    return na - nb;
  });

  return chapters;
};

export const searchManga = async (query) => {
  const searchUrl =
    `${BASE}/search/data?text=${encodeURIComponent(query)}` +
    "&display_mode=Full%20Display";

  const html = await fetchHTML(searchUrl, {
    Referer: `${BASE}/search?text=${encodeURIComponent(query)}`,
  });

  const $ = cheerio.load(html);
  const results = [];
  const seenIds = new Set();
  const normalizedQuery = normalizeTitle(query);

  // Search payload includes duplicate series cards; de-duplicate by series id.
  $("a[href*='/series/']").each((_, el) => {
    const href = $(el).attr("href");
    const rawTitle = $(el).text().trim();
    const cardTitle = extractSearchCardTitle(rawTitle);

    if (!href || !cardTitle) return;

    const match = href.match(/\/series\/([A-Za-z0-9-]+)(?:\/|$)/);
    const id = match?.[1];

    if (!id || id === "random" || seenIds.has(id)) return;

    const parsed = parseTitleAndAuthor(cardTitle);
    const normalizedTitle = normalizeTitle(parsed.title);
    if (!normalizedTitle) return;

    // Keep strict matches first, but allow partial word matches for forgiving search.
    if (normalizedQuery && !normalizedTitle.includes(normalizedQuery)) {
      const queryWords = normalizedQuery.split(" ").filter(Boolean);
      const hasAnyWord = queryWords.some(
        (word) => word.length > 2 && normalizedTitle.includes(word)
      );
      if (!hasAnyWord) return;
    }

    if (id) {
      seenIds.add(id);
      results.push({
        id,
        title: parsed.title,
        author: parsed.author,
        displayTitle: cardTitle,
      });
    }
  });

  return results;
};

export const getAllChapters = async (seriesId) => {
  const seriesUrl = `${BASE}/series/${seriesId}`;
  const fullListUrl = `${seriesUrl}/full-chapter-list`;

  try {
    // Prefer full chapter list endpoint because it usually has complete pagination.
    const fullHtml = await fetchHTML(fullListUrl, { Referer: seriesUrl });
    if (!isWeebErrorPage(fullHtml)) {
      const fullList = parseChaptersFromHtml(fullHtml);
      if (fullList.length > 0) return fullList;
    }
  } catch {
    // fallback below
  }

  const html = await fetchHTML(seriesUrl);
  if (isWeebErrorPage(html)) return [];
  // Fallback parser on the main series page if the full list is unavailable.
  return parseChaptersFromHtml(html);
};

export const getSeriesAuthors = async (seriesId) => {
  const seriesUrl = `${BASE}/series/${seriesId}`;
  const html = await fetchHTML(seriesUrl);
  if (isWeebErrorPage(html)) return [];
  return parseAuthorsFromSeriesHtml(html);
};

export const getChapterPages = async (chapterId) => {
  const chapterUrl = `${BASE}/chapters/${chapterId}`;
  const chapterHtml = await fetchHTML(chapterUrl);

  if (isWeebErrorPage(chapterHtml)) {
    throw new Error(`WeebCentral chapter not found: ${chapterId}`);
  }

  // WeebCentral loads reader images from a secondary HTMX endpoint.
  const imagesUrl =
    `${BASE}/chapters/${chapterId}/images` +
    "?is_prev=False&current_page=1&reading_style=long_strip";

  const imagesHtml = await fetchHTML(imagesUrl, { Referer: chapterUrl });
  if (isWeebErrorPage(imagesHtml)) {
    throw new Error(`WeebCentral image payload failed for chapter: ${chapterId}`);
  }

  const $ = cheerio.load(imagesHtml);
  const seen = new Set();
  const pages = [];

  // Images can be in src or lazy-loaded data-src attributes.
  $("img").each((_, el) => {
    const src = ($(el).attr("src") || $(el).attr("data-src") || "").trim();
    if (!src || !src.startsWith("http")) return;
    if (seen.has(src)) return;
    seen.add(src);

    pages.push({ image: src });
  });

  // Sort by URL with numeric collation to keep 1,2,3...10 order stable.
  pages.sort((a, b) => a.image.localeCompare(b.image, undefined, { numeric: true }));

  return pages.map((page, index) => ({
    index,
    image: page.image,
  }));
};
