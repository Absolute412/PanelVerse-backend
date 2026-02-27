import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import * as mangaApi from "./manga.js";

const app = express();
const PORT = process.env.PORT || 5000;

// Comma-separated allowlist, e.g. "https://app.com,https://staging.app.com".
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// CORS origin checker:
// - always allow non-browser/SSR requests (no Origin header)
// - allow localhost, explicit allowlist, and Vercel preview domains
const allowLocalOrigins = (origin, callback) => {
  if (!origin) return callback(null, true);

  try {
    const { hostname, origin: fullOrigin } = new URL(origin);
    const isLocal = hostname === "localhost" || hostname === "127.0.0.1";
    const isAllowed = allowedOrigins.includes(fullOrigin);
    const isVercelPreview = hostname.endsWith(".vercel.app");

    if (isLocal || isAllowed || isVercelPreview) {
      return callback(null, true);
    }
  } catch {
    // fall through
  }

  return callback(new Error("Not allowed by CORS"));
};

app.use(cors({
  origin: allowLocalOrigins,
  credentials: true,
}));
app.use(express.json());

// Fallback type from file extension if upstream omits/has wrong content-type.
const guessImageType = (pathname) => {
  const lower = pathname.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
};

const detectImageType = (buf, fallbackType) => {
  // Verify magic bytes so we only serve real images from proxy endpoint.
  if (!buf || buf.length < 12) return fallbackType || null;

  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";

  return fallbackType || null;
};

app.get("/api/image", async (req, res) => {
  // Image proxy endpoint used by frontend cover/page URLs.
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

  const isMangaDex =
    parsed.hostname === "mangadex.org" ||
    parsed.hostname.endsWith(".mangadex.org") ||
    parsed.hostname.endsWith(".mangadex.network");

  if (!isMangaDex) {
    return res.status(403).json({ error: "Host not allowed" });
  }

  try {
    // Use browser-like headers; some upstreams block bare server fetches.
    const upstream = await fetch(parsed.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PanelVerse/1.0",
        "Referer": "https://mangadex.org/",
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });
    if (!upstream.ok) {
      const text = await upstream.text();
      console.warn("Image proxy upstream error", upstream.status, parsed.toString(), text.slice(0, 120));
      return res.status(502).json({ error: "Upstream image fetch failed" });
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    const upstreamType = upstream.headers.get("content-type");
    const fallbackType = upstreamType && upstreamType.startsWith("image/")
      ? upstreamType
      : guessImageType(parsed.pathname);
    const contentType = detectImageType(buf, fallbackType);

    if (!contentType) {
      console.warn("Image proxy non-image response", parsed.toString(), upstreamType);
      return res.status(502).json({ error: "Invalid image response" });
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.status(200).end(buf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch image" });
  }
});

app.get("/api/search", async (req, res) => {
  // Search endpoint for navbar and browse page.
  const query = req.query.query || "";
  const limit = parseInt(req.query.limit) || 20;

  try {
    const mangas = await mangaApi.searchManga(query, limit);
    res.json(mangas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to search manga" });
  }
});

// Manga listing/detail routes.
app.get("/api/popular", async (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const offset = parseInt(req.query.offset) || 0;
  try {
    const mangas = await mangaApi.getPopularManga(limit, offset);
    res.json(mangas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch popular manga" });
  }
});

app.get("/api/latest", async (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  try {
    const mangas = await mangaApi.getLatestManga(limit);
    res.json(mangas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch latest manga" });
  }
});

app.get("/api/recently-added", async (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const offset = parseInt(req.query.offset) || 0;
  try {
    const mangas = await mangaApi.getRecentlyAddedManga(limit, offset);
    res.json(mangas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch recently added manga" });
  }
});

app.get("/api/manga/:id", async (req, res) => {
  try {
    const manga = await mangaApi.getManga(req.params.id);
    res.json(manga);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch manga" });
  }
});

app.get("/api/manga/:id/chapters", async (req, res) => {
  try {
    const chapters = await mangaApi.getAllChapters(req.params.id);
    res.json(chapters);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch chapters" });
  }
});

app.get("/api/chapter/:id/pages", async (req, res) => {
  try {
    const pages = await mangaApi.getChapterPages(req.params.id);
    res.json(pages);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch chapter pages" });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
