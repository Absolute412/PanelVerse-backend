import * as mangadex from "../sources/mangadex.js";
import * as weebcentral from "../sources/weebcentral.js";

import { normalizeTitle, } from "../utils/normalization.js";
import { isAuthorMatch, findBestWeebSeriesId, } from "../utils/matching.js";
import { mergedChapterCache, pageCache, setPageCache, getPageCacheKey, } from "../utils/cache.js";
import { dedupeAndMergeChapters, mergeWithCrossSourceLinks, sortMergedChaptersAscending, } from "../utils/merge.js";
import { getFallbackBridge, } from "../utils/fallback.js";

const DEBUG_MATCHING = true;

const MERGED_CACHE_TTL = 1000 * 60 * 30;
const PAGE_CACHE_TTL = 1000 * 60 * 60;

const isValidPages = (pages) => Array.isArray(pages) && pages.length > 0;

const isStructuredSeries = (chapters = []) => {
    let hits = 0;

    for (const ch of chapters) {
        const t = normalizeTitle(ch.title);

        if (
            /episode\s*\d+/i.test(t) ||
            /part\s*\d+/i.test(t)
        ) {
            hits++;
        }
    }

    return hits >= 3;
};

const toAuthorText = (author) =>
    Array.isArray(author) ? author.join(" ") : String(author || "");

const getCandidateMatchTitle = (candidate) =>
    candidate?.displayTitle || candidate?.title || "";

const buildFallbackQueries = (title = "") => {
    const raw = String(title).trim();
    if (!raw) return [];

    const cleaned = raw
        .replace(/[^\w\s:|/-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const splitParts = cleaned
        .split(/[:|/-]/)
        .map((p) => p.trim())
        .filter(Boolean);

    const words = cleaned.split(" ").filter(Boolean);

    const candidates = [
        raw,
        cleaned,
        ...splitParts,
        words.slice(0, 3).join(" "),
        words[0],
    ];

    return [...new Set(candidates.filter((q) => q && q.length >= 2))];
};

export const searchManga = (query, limit) => {
    return mangadex.searchManga(query, limit);
};

export const getPopularManga = (query, offset) => {
    return mangadex.getPopularManga(query, offset);
};

export const getLatestManga = (limit) => {
    return mangadex.getLatestManga(limit);
};

export const getRecentlyAddedManga = (limit, offset) => {
    return mangadex.getRecentlyAddedManga(limit, offset);
};

export const getManga = (id) => {
    return mangadex.getManga(id);
};

export const getAllChapters = async (id) => {
    const cached = mergedChapterCache.get(id);

    if (cached && (Date.now() - cached.timestamp < MERGED_CACHE_TTL)) {
        if (DEBUG_MATCHING) {
            console.debug(`[CACHE HIT] chapters for ${id}`);
        }
        return cached.data;
    }

    const dexChapters = await mangadex.getAllChapters(id);

    if (isStructuredSeries(dexChapters)) {
        if (DEBUG_MATCHING) {
            console.debug(`[MERGE BLOCKED] Structured series detected`);
        }

        const tagged = dexChapters.map(c => ({
            ...c,
            source: "mangadex"
        }));

        const fallback = tagged.sort(sortMergedChaptersAscending);

        mergedChapterCache.set(id, {
            data: fallback,
            timestamp: Date.now(),
        });

        return fallback;
    }

    const taggedDexChapters = (dexChapters || []).map((c) => ({
        ...c,
        source: "mangadex",
    }));

    try {
        const manga = await mangadex.getManga(id);

        if (!manga?.title) {
            const fallback = dedupeAndMergeChapters(taggedDexChapters);

            mergedChapterCache.set(id, {
                data: fallback,
                timestamp: Date.now(),
            });

            return fallback;
        }

        const wcId = await findBestWeebSeriesId(manga, {
            searchManga: weebcentral.searchManga,
            getSeriesAuthors: weebcentral.getSeriesAuthors,
            buildFallbackQueries,
            toAuthorText,
            getCandidateMatchTitle,
            isAuthorMatch,
            debug: DEBUG_MATCHING,
        });

        if (!wcId) {
            const fallback = dedupeAndMergeChapters(taggedDexChapters);

            mergedChapterCache.set(id, {
                data: fallback,
                timestamp: Date.now(),
            });

            return fallback;
        }

        const wcChapters = await weebcentral.getAllChapters(wcId);
        const taggedWcChapters = (wcChapters || []).map((c) => ({
            ...c,
            source: "weebcentral",
        }));

        const finalChapters = mergeWithCrossSourceLinks(taggedDexChapters, taggedWcChapters);

        mergedChapterCache.set(id, {
            data: finalChapters,
            timestamp: Date.now(),
        });

        return finalChapters;
    } catch (err) {
        console.error("Weebcentral merge failed:", err.message);

        const fallback = dedupeAndMergeChapters(taggedDexChapters);

        mergedChapterCache.set(id, {
            data: fallback,
            timestamp: Date.now(),
        });

        return fallback;
    }
};

export const getChapterPages = async (chapterId, chapterSlug, source = "mangadex") => {
    const cacheKey = getPageCacheKey(chapterId, source);
    const cached = pageCache.get(cacheKey);

    if (cached && (Date.now() - cached.timestamp < PAGE_CACHE_TTL)) {
        if (DEBUG_MATCHING) {
            console.debug(`[CACHE HIT] pages for ${cacheKey}`);
        }
        return cached.data;
    }

    switch (source) {
        case "mangadex": {
            try {
                const pages = await mangadex.getChapterPages(chapterId);

                if (isValidPages(pages)) {
                    setPageCache(cacheKey, pages);
                    return pages;
                }
            } catch (err) {
                console.warn(`MangaDex pages failed for ${chapterId}:`, err.message);
            }

            const fallback = getFallbackBridge("mangadex", chapterId);

            if (fallback?.source === "weebcentral" && fallback?.chapterId) {
                const fallbackKey = getPageCacheKey(fallback.chapterId, fallback.source);

                if (DEBUG_MATCHING) {
                    console.info(`Page fallback: mangadex ${chapterId} -> weebcentral ${fallback.chapterId}`);
                }

                let pages;
                try {
                    pages = await weebcentral.getChapterPages(fallback.chapterId);
                } catch (e) {
                    console.warn("Fallback failed:", e.message);
                    pages = null;
                }

                if (isValidPages(pages)) {
                    setPageCache(cacheKey, pages);
                    setPageCache(fallbackKey, pages);
                    return pages;
                }
            }

            throw new Error("MangaDex pages unavailable and no WeebCentral fallback match found");
        }

        case "weebcentral": {
            try {
                const pages = await weebcentral.getChapterPages(chapterId);

                if (isValidPages(pages)) {
                    setPageCache(cacheKey, pages);
                    return pages;
                }
            } catch (err) {
                console.warn(`WeebCentral pages failed for ${chapterId}:`, err.message);
            }

            const fallback = getFallbackBridge("weebcentral", chapterId);

            if (fallback?.source === "mangadex" && fallback?.chapterId) {
                const fallbackKey = getPageCacheKey(fallback.chapterId, fallback.source);

                if (DEBUG_MATCHING) {
                    console.info(`Page fallback: weebcentral ${chapterId} -> mangadex ${fallback.chapterId}`);
                }

                let pages;
                try {
                    pages = await mangadex.getChapterPages(fallback.chapterId);
                } catch (e) {
                    console.warn("Fallback failed:", e.message);
                }

                if (isValidPages(pages)) {
                    setPageCache(cacheKey, pages);
                    setPageCache(fallbackKey, pages);
                    return pages;
                }
            }

            throw new Error("WeebCentral pages unavailable and no MangaDex fallback match found");
        }

        default:
            throw new Error(`Unknown source: ${source}`);
    }
};
