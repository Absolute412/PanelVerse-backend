export const normalizeTitle = (value = "") =>
    String(value)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

export const tokenizeTitle = (value = "") =>
    normalizeTitle(value)
        .split(" ")
        .filter(Boolean);

export const normalizeAuthor = (value = "") =>
    String(value)
        .toLowerCase()
        .replace(/\b(author\(s\)|authors?|artists?)\b/g, " ")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

export const parseRomanNumeral = (value = "") => {
    const roman = String(value || "").toUpperCase();
    if (!/^[IVXLCDM]+$/.test(roman)) return null;

    const map = {
        I: 1,
        V: 5,
        X: 10,
        L: 50,
        C: 100,
        D: 500,
        M: 1000,
    };

    let total = 0;
    for (let i = 0; i < roman.length; i++) {
        const current = map[roman[i]];
        const next = map[roman[i + 1]] || 0;
        total += current < next ? -current : current;
    }

    return total > 0 ? total : null;
};

const normalizeStructuredIndex = (rawIndex = "") => {
    const text = String(rawIndex || "").trim();
    if (!text) return null;

    if (/^\d+$/.test(text)) return Number.parseInt(text, 10).toString();

    const romanValue = parseRomanNumeral(text);
    if (romanValue !== null) return romanValue.toString();

    return null;
};

export const extractStructuredSeriesKey = (title = "") => {
    const normalized = normalizeTitle(title);
    if (!normalized) return null;

    const match = normalized.match(/\b(episode|ep|part)\s*([0-9]+|[ivxlcdm]+)\b/i);
    if (!match) return null;

    const marker = match[1].toLowerCase() === "ep" ? "episode" : match[1].toLowerCase();
    const index = normalizeStructuredIndex(match[2]);
    if (!index) return null;

    return `${marker}:${index}`;
};
