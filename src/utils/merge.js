import { normalizeTitle } from "./normalization.js";
import { setFallbackBridge } from "./fallback.js";

const normalizeChapterNumber = (value) => {
    const parsed = Number.parseFloat(value);
    if (Number.isNaN(parsed)) return null;
    return parsed.toString();
};

const getChapterDedupeKey = (chapter) => {
    const numberKey = normalizeChapterNumber(chapter?.number);
    if (numberKey) return `n:${numberKey}`;

    const normalizedChapterTitle = normalizeTitle(chapter?.title)
        .replace(/^chapter\s+/i, "")
        .trim();

    if (normalizedChapterTitle) return `t:${normalizedChapterTitle}`;

    return `id:${chapter?.id || ""}`;
};

const getPublishedTimestamp = (chapter) => {
    const ts = Date.parse(chapter?.publishedAt || "");
    return Number.isNaN(ts) ? 0 : ts;
};

const sourcePriority = (source) => {
    if (source === "mangadex") return 2;
    if (source === "weebcentral") return 1;
    return 0;
};

export const pickBetterChapter = (current, incoming) => {
    if (!current) return incoming;

    const currentSourcePriority = sourcePriority(current.source);
    const incomingSourcePriority = sourcePriority(incoming.source);
    if (incomingSourcePriority !== currentSourcePriority) {
        return incomingSourcePriority > currentSourcePriority ? incoming : current;
    }

    const currentPublished = getPublishedTimestamp(current);
    const incomingPublished = getPublishedTimestamp(incoming);
    if (incomingPublished !== currentPublished) {
        return incomingPublished > currentPublished ? incoming : current;
    }

    const currentPages = Number(current?.pages) || 0;
    const incomingPages = Number(incoming?.pages) || 0;
    if (incomingPages !== currentPages) {
        return incomingPages > currentPages ? incoming : current;
    }

    const currentTitleLength = String(current?.title || "").trim().length;
    const incomingTitleLength = String(incoming?.title || "").trim().length;
    if (incomingTitleLength !== currentTitleLength) {
        return incomingTitleLength > currentTitleLength ? incoming : current;
    }

    return current;
};

export const sortMergedChaptersAscending = (a, b) => {
    const na = Number.parseFloat(a?.number);
    const nb = Number.parseFloat(b?.number);
    const aHasNumber = !Number.isNaN(na);
    const bHasNumber = !Number.isNaN(nb);

    if (aHasNumber && bHasNumber && na !== nb) return na - nb;
    if (aHasNumber && !bHasNumber) return -1;
    if (!aHasNumber && bHasNumber) return 1;

    const ta = getPublishedTimestamp(a);
    const tb = getPublishedTimestamp(b);
    if (ta !== tb) return ta - tb;

    return String(a?.title || "").localeCompare(String(b?.title || ""));
};

export const dedupeAndMergeChapters = (chapters = []) => {
    const map = new Map();

    for (const chapter of chapters) {
        const key = getChapterDedupeKey(chapter);
        const existing = map.get(key);
        map.set(key, pickBetterChapter(existing, chapter));
    }

    return [...map.values()].sort(sortMergedChaptersAscending);
};

export const mergeWithCrossSourceLinks = (dexChapters = [], wcChapters = []) => {
    const dexByKey = new Map();
    const wcByKey = new Map();

    for (const chapter of dexChapters) {
        const key = getChapterDedupeKey(chapter);
        if (!dexByKey.has(key)) dexByKey.set(key, chapter);
    }

    for (const chapter of wcChapters) {
        const key = getChapterDedupeKey(chapter);
        if (!wcByKey.has(key)) wcByKey.set(key, chapter);
    }

    for (const [key, dexChapter] of dexByKey.entries()) {
        const wcChapter = wcByKey.get(key);
        if (!wcChapter?.id || !dexChapter?.id) continue;

        setFallbackBridge("mangadex", dexChapter.id, "weebcentral", wcChapter.id);
        setFallbackBridge("weebcentral", wcChapter.id, "mangadex", dexChapter.id);
    }

    const merged = dedupeAndMergeChapters([
        ...dexChapters,
        ...wcChapters,
    ]);

    return merged.map((chapter) => {
        const key = getChapterDedupeKey(chapter);
        const dexChapter = dexByKey.get(key);
        const wcChapter = wcByKey.get(key);

        if (chapter?.source === "mangadex" && wcChapter?.id) {
            return {
                ...chapter,
                fallbackSource: "weebcentral",
                fallbackChapterId: wcChapter.id,
            };
        }

        if (chapter?.source === "weebcentral" && dexChapter?.id) {
            return {
                ...chapter,
                fallbackSource: "mangadex",
                fallbackChapterId: dexChapter.id,
            };
        }

        return chapter;
    });
};
