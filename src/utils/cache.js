export const mergedChapterCache = new Map();

export const pageCache = new Map();
const MAX_PAGE_CACHE = 500;

export const getPageCacheKey = (chapterId, source) => `${source}:${chapterId}`;

export const setPageCache = (key, data) => {
    pageCache.set(key, {
        data,
        timestamp: Date.now(),
    });

    if (pageCache.size > MAX_PAGE_CACHE) {
        const firstKey = pageCache.keys().next().value;
        pageCache.delete(firstKey);
    }
};
