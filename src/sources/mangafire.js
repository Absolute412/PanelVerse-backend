const fetch = globalThis.fetch.bind(globalThis);
import * as cheerio from "cheerio"

const BASE = "https://mangafire.to";

// VRF extractor
const extractVrf = (html) => {
    const scripts = html.match(/<script[\s\S]*?<\/script>/g) || [];

    for (const script of scripts) {
        const match = script.match(/vrf\s*[:=]\s*["']([^"']+)["']/i);
        if (match) return match[1];
    }

    return null;
};

export const searchManga = async (query) => {
    const res = await fetch(`${BASE}/filter?keyword=${encodeURIComponent(query)}`);
    const html = await res.text();

    const $ = cheerio.load(html);
    const results = [];

    $(".item").each((_, el) => {
        const link = $(el).find("a").attr("href");
        const title = $(el).find(".name").text().trim();

        if (link && title) {
            const slug = link.split("/manga/")[1]?.split(".")[0];

            results.push({
                title,
                slug,
            });
        }
    });

    return results;
};

export const getAllChapters = async (slug) => {
    const res = await fetch(`${BASE}/manga/${slug}`);
    const html = await res.text();

    const $ = cheerio.load(html);
    const chapters = [];

    $(".chapter-list a").each((_, el) => {
        const link = $(el).attr("href");
        const text = $(el).text().trim();

        if (link) {
            const idMatch = link.match(/chapter-(\d+)/);
            const chapterId = idMatch ? idMatch[1] : null;

            const numberMatch = text.match(/Chapter\s*([\d.]+)/i);
            const number = numberMatch ? parseFloat(numberMatch[1]) : null;

            if (chapterId) {
                chapters.push({
                    id: chapterId,
                    slug: link.split("?")[0],
                    number,
                    title: text,
                    source: "mangafire",
                });
            }
        }
    });

    return chapters.reverse();
};

export const getChapterPages = async (chapterId, chapterSlug) => {
    const url = `${BASE}/ajax/read/chapter/${chapterId}`;

    const res = await fetch(url, {
        headers: {
            "X-Requested-With": "XMLHttpRequest",
            "Referer": `${BASE}/read/${chapterSlug}`,
            "Accept": "application/json",
        },
    });

    const data = await res.json();

    if (!data?.result?.images) {
        console.log("FAILED RESPONSE:", data);
        return [];
    }

    return data.result.images.map((img, i) => ({
        index: i,
        image: img[0],
    }));
};
