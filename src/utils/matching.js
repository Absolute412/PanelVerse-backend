import {
    normalizeTitle,
    tokenizeTitle,
    normalizeAuthor,
    extractStructuredSeriesKey,
} from "./normalization.js";

const tokenizeAuthor = (value = "") =>
    normalizeAuthor(value)
        .split(" ")
        .filter(Boolean)
        .filter((word) => word.length > 1);

export const isAuthorMatch = (dexAuthor, wcAuthorOrList) => {
    const dexNorm = normalizeAuthor(dexAuthor);
    const wcNorm = normalizeAuthor(wcAuthorOrList);
    if (!dexNorm || !wcNorm) return false;

    if (dexNorm === wcNorm || dexNorm.includes(wcNorm) || wcNorm.includes(dexNorm)) {
        return true;
    }

    const dexWords = tokenizeAuthor(dexNorm);
    const wcWords = tokenizeAuthor(wcNorm);
    if (!dexWords.length || !wcWords.length) return false;    
    const wcSet = new Set(wcWords);
    const common = dexWords.filter((w) => wcSet.has(w));

    if (dexWords.length <= 3) return dexWords.every((w) => wcSet.has(w));

    return common.length / dexWords.length >= 0.6;
};

const COLOR_VARIANT_WORDS = new Set(["color", "colored", "colour", "coloured"]);
const BENIGN_EDITION_WORDS = new Set([
    "official", "digital", "comic", "comics",
    "edition", "remaster", "remastered", "full", "version",
]);

const getCoreSeriesWords = (title = "") =>
    tokenizeTitle(title).filter(
        (word) => !COLOR_VARIANT_WORDS.has(word) && !BENIGN_EDITION_WORDS.has(word)
    );

const getVariantType = (title = "") => {
    const t = normalizeTitle(title);

    if (/\b(colou?r(ed)?)\b/.test(t)) return "colored";
    return "normal";
};

export const isLikelySameSeries = (dexTitle, wcTitle) => {
    const dexVariant = getVariantType(dexTitle);
    const wcVariant = getVariantType(wcTitle);

    if (dexVariant !== wcVariant) return false;

    const d = normalizeTitle(dexTitle);
    const w = normalizeTitle(wcTitle);
    if (!d || !w) return false;
    if (d === w) return true;

    const dexStructuredKey = extractStructuredSeriesKey(dexTitle);
    const wcStructuredKey = extractStructuredSeriesKey(wcTitle);
    if (dexStructuredKey || wcStructuredKey) {
        if (!dexStructuredKey || !wcStructuredKey) return false;
        if (dexStructuredKey !== wcStructuredKey) return false;
    }

    const dWords = tokenizeTitle(dexTitle);
    const wWords = tokenizeTitle(wcTitle);
    const dSet = new Set(dWords);
    const wSet = new Set(wWords);
    const common = dWords.filter((word) => wSet.has(word));
    const overlapRatio = common.length / Math.max(dWords.length, wWords.length);

    if (common.length === 0) return false;

    const suspiciousKeywords = new Set([
        "one", "oneshot", "shot", "special", "extra", "side", "story", "gaiden",
        "spinoff", "spin", "off", "hen", "pilot", "prologue", "epilogue",
    ]);

    const dexExtras = dWords.filter((word) => !wSet.has(word));
    const wcExtras = wWords.filter((word) => !dSet.has(word));

    const hasSuspiciousExtra = [...dexExtras, ...wcExtras].some((word) =>
        suspiciousKeywords.has(word)
    );
    if (hasSuspiciousExtra) return false;

    const allDexWordsInWc = dWords.every((word) => wSet.has(word));
    const allWcWordsInDex = wWords.every((word) => dSet.has(word));

    if (allWcWordsInDex && dexExtras.length > 0) {
        const hasSignificantDexExtra = dexExtras.some((word) => !BENIGN_EDITION_WORDS.has(word));
        if (hasSignificantDexExtra) return false;
    }

    if (allDexWordsInWc && wcExtras.length > 0) {
        const hasSignificantWcExtra = wcExtras.some((word) => !BENIGN_EDITION_WORDS.has(word));
        if (hasSignificantWcExtra && overlapRatio < 0.85) return false;
    }

    if (overlapRatio >= 0.8) return true;
    if (allDexWordsInWc) return true;

    const dexCore = getCoreSeriesWords(dexTitle);
    const wcCore = getCoreSeriesWords(wcTitle);
    if (dexCore.length && wcCore.length) {
        const wcCoreSet = new Set(wcCore);
        const dexCoreSet = new Set(dexCore);
        const coreCommon = dexCore.filter((word) => wcCoreSet.has(word));
        const coreOverlap = coreCommon.length / Math.max(dexCore.length, wcCore.length);
        const allDexCoreInWc = dexCore.every((word) => wcCoreSet.has(word));
        const allWcCoreInDex = wcCore.every((word) => dexCoreSet.has(word));

        if (coreOverlap >= 0.8 || allDexCoreInWc || allWcCoreInDex) return true;
    }

    return false;
};

export const scoreWeebMatch = (queryTitle, candidateTitle) => {
    const q = normalizeTitle(queryTitle);
    const c = normalizeTitle(candidateTitle);
    if (!q || !c) return 0;

    if (q === c) return 100;

    let score = 0;
    if (c.includes(q)) score += 70;
    if (q.includes(c)) score += 50;

    const qWords = q.split(" ").filter(Boolean);
    const cWords = new Set(c.split(" ").filter(Boolean));
    const commonWords = qWords.filter((w) => cWords.has(w));
    score += commonWords.length * 8;

    const queryVariant = getVariantType(queryTitle);
    const candidateVariant = getVariantType(candidateTitle);
    if (queryVariant === candidateVariant) score += 30;
    else score -= 30;

    if (commonWords.length === 0) return 0;
    return score;
};

export const rankWeebMatches = (queryTitle, results = []) =>
    results
        .map((result) => ({
            result,
            score: scoreWeebMatch(queryTitle, result?.title),
        }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score);

export const findBestWeebSeriesId = async (manga, deps) => {
    const {
        searchManga,
        getSeriesAuthors,
        buildFallbackQueries,
        toAuthorText,
        getCandidateMatchTitle,
        debug = false,
    } = deps;

    const mangaTitle = manga?.title || "";
    const dexAuthor = toAuthorText(manga?.author);
    const queryVariants = buildFallbackQueries(mangaTitle);
    const deduped = new Map();

    for (const query of queryVariants) {
        const matches = await searchManga(query);
        for (const match of matches) {
            if (!match?.id || deduped.has(match.id)) continue;
            deduped.set(match.id, match);
        }
    }

    const results = [...deduped.values()];
    if (!results.length) return null;

    const rankedMatches = rankWeebMatches(mangaTitle, results);
    const targetVariant = getVariantType(mangaTitle);
    const strictCandidates = [];

    for (const { result } of rankedMatches) {
        const candidateTitleForMatch = getCandidateMatchTitle(result);
        if (!isLikelySameSeries(mangaTitle, candidateTitleForMatch)) continue;
        strictCandidates.push(result);
    }

    if (!strictCandidates.length) {
        if (debug) console.debug(`[WC MATCH] "${mangaTitle}" - no strict title candidate`);
        return null;
    }

    const normalizedTitle = normalizeTitle(mangaTitle);
    const exactTitleCandidates = strictCandidates.filter(
        (candidate) => normalizeTitle(candidate?.title) === normalizedTitle
    );

    if (exactTitleCandidates.length > 1) {
        const candidatesWithAuthors = [];

        for (const candidate of exactTitleCandidates.slice(0, 6)) {
            const authorParts = [];
            if (candidate?.author) authorParts.push(candidate.author);

            try {
                const seriesAuthors = await getSeriesAuthors(candidate.id);
                if (seriesAuthors?.length) authorParts.push(seriesAuthors.join(" "));
            } catch {
            }

            const candidateAuthorText = authorParts.join(" ").trim();
            const authorMatched = dexAuthor
                ? isAuthorMatch(dexAuthor, candidateAuthorText)
                : false;
            const variantType = getVariantType(getCandidateMatchTitle(candidate));

            candidatesWithAuthors.push({
                candidate,
                authorMatched,
                variantType,
            });
        }

        const variantAligned = candidatesWithAuthors.filter(
            (entry) => entry.variantType === targetVariant
        );

        if (variantAligned.length === 1) {
            if (debug) {
                console.debug(
                    `[WC MATCH] "${mangaTitle}" - exact-title disambiguated by variant -> ${variantAligned[0].candidate.id}`
                );
            }
            return variantAligned[0].candidate.id;
        }

        const authorConfirmed = candidatesWithAuthors.filter((entry) => entry.authorMatched);
        if (authorConfirmed.length === 1) {
            if (debug) {
                console.debug(
                    `[WC MATCH] "${mangaTitle}" - exact-title disambiguated by author -> ${authorConfirmed[0].candidate.id}`
                );
            }
            return authorConfirmed[0].candidate.id;
        }

        const variantAndAuthorConfirmed = authorConfirmed.filter(
            (entry) => entry.variantType === targetVariant
        );
        if (variantAndAuthorConfirmed.length === 1) {
            if (debug) {
                console.debug(
                    `[WC MATCH] "${mangaTitle}" - exact-title disambiguated by author+variant -> ${variantAndAuthorConfirmed[0].candidate.id}`
                );
            }
            return variantAndAuthorConfirmed[0].candidate.id;
        }

        if (debug) {
            console.debug(
                `[WC MATCH] "${mangaTitle}" - ambiguous exact-title candidates (${exactTitleCandidates.length}), skipping unsafe merge`
            );
        }
        return null;
    }

    const sameVariantCandidate = strictCandidates.find(
        (result) => getVariantType(getCandidateMatchTitle(result)) === targetVariant
    );
    if (sameVariantCandidate) return sameVariantCandidate.id;

    return strictCandidates[0]?.id || null;
};
