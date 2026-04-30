import express from "express";
import fetch from "node-fetch";
import fs from "fs"

const router = express.Router();

const imageCache = new Map();
const IMAGE_TTL = 1000 * 60 * 60 * 24;  // 24 hours

const fallbackBuffer = fs.readFileSync("./public/placeholder.jpg");

// helpers
const guessImageType = (pathname) => {
  const lower = pathname.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
};

const detectImageType = (buf, fallbackType) => {
  if (!buf || buf.length < 12) return fallbackType || null;

  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";

  return fallbackType || null;
};

const fetchWithRetry = async (url, options, retries = 1) => {
  try {
    return await fetch(url, options);
  } catch (err) {
    if (retries > 0) return fetchWithRetry(url, options, retries - 1);
    throw err;
  }
};

// route
router.get("/image", async (req, res) => {
  const { url } = req.query;

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Missing url" });
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: "Invalid url" });
  }

  const ALLOWED_HOSTS = [
    // MangaDex
    "mangadex.org",
    "uploads.mangadex.org",
    "mangadex.network", 

    // MangaFire
    "mangafire.to",
    "static.mangafire.to",
    "img.mangafire.to",

    // Future proof
    "weebcentral.com",
  ];

  const isAllowed = ALLOWED_HOSTS.some(host =>
    parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
  );

  if (!isAllowed) {
    return res.status(403).json({ error: "Host not allowed" });
  }

  /* ----------------------------------
     CHECK CACHE FIRST
  ---------------------------------- */
  const cacheKey = parsed.toString();
  const cached = imageCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < IMAGE_TTL) {
    console.log("CACHE HIT", cacheKey);
    res.setHeader("Content-Type", cached.contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

    return res.status(200).end(cached.buffer);
  }

  let timeout;

  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 10000);

    const referer = parsed.origin;

    const upstream = await fetchWithRetry(parsed.toString(), {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 PanelVerse/1.0",
        "Referer": referer,
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });

    clearTimeout(timeout);

    if (!upstream.ok) {
      const text = await upstream.text();
      console.warn("Image proxy error", upstream.status, text.slice(0, 120));
      return res.status(502).json({ error: "Upstream image fetch failed" });
    }

    const buf = Buffer.from(await upstream.arrayBuffer());

    const upstreamType = upstream.headers.get("content-type");
    const fallbackType = upstreamType?.startsWith("image/")
      ? upstreamType
      : guessImageType(parsed.pathname);

    const contentType = detectImageType(buf, fallbackType);

    if (!contentType) {
      return res.status(502).json({ error: "Invalid image response" });
    }

    /* ----------------------------------
       SAVE TO CACHE
    ---------------------------------- */
    imageCache.set(cacheKey, {
      buffer: buf,
      contentType,
      timestamp: Date.now(),
    });

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

    if (imageCache.size > 500) {
      const firstKey = imageCache.keys().next().value;
      imageCache.delete(firstKey);
    }

    res.status(200).end(buf);
  } catch (err) {
    clearTimeout(timeout);

    console.error(err);
    
    if (!res.headersSent) {
      res.setHeader("Content-Type", "image/jpeg");
      return res.status(200).end(fallbackBuffer);
    }
  }
});

export default router;