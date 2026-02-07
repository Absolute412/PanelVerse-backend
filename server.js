import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import * as mangaApi from "./manga.js";

const app = express();
const PORT = process.env.PORT || 5000;

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

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

app.get("/api/image", async (req, res) => {
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
    parsed.hostname.endsWith(".mangadex.org");

  if (!isMangaDex) {
    return res.status(403).json({ error: "Host not allowed" });
  }

  try {
    const upstream = await fetch(parsed.toString());
    if (!upstream.ok) {
      return res.status(upstream.status).send(await upstream.text());
    }

    res.setHeader("Content-Type", upstream.headers.get("content-type") || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    upstream.body.pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch image" });
  }
});

app.get("/api/search", async (req, res) => {
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

// Routes
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
