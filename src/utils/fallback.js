export const chapterFallbackBridge = new Map();
const MAX_BRIDGE_ENTRIES = 20000;

export const setFallbackBridge = (source, chapterId, fallbackSource, fallbackChapterId) => {
    if (!source || !chapterId || !fallbackSource || !fallbackChapterId) return;

    const key = `${source}:${chapterId}`;
    chapterFallbackBridge.set(key, {
        source: fallbackSource,
        chapterId: fallbackChapterId,
    });

    if (chapterFallbackBridge.size > MAX_BRIDGE_ENTRIES) {
        const first = chapterFallbackBridge.keys().next().value;
        chapterFallbackBridge.delete(first);
    }
};

export const getFallbackBridge = (source, chapterId) => {
    if (!source || !chapterId) return null;
    return chapterFallbackBridge.get(`${source}:${chapterId}`) || null;
};
