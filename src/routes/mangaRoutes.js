import express from "express";
import * as mangaApi from "../services/mangaService.js"

const router = express.Router();

// Search
router.get("/search", async (req, res) => {
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

// Popular
router.get("/popular", async (req, res) => {
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

// Latest
router.get("/latest", async (req, res) => {
  const limit = parseInt(req.query.limit) || 20;

  try {
    const mangas = await mangaApi.getLatestManga(limit);
    res.json(mangas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch latest manga" });
  }
});

// Recently Added
router.get("/recently-added", async (req, res) => {
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

// Manga Details
router.get("/manga/:id", async (req, res) => {
  try {
    const manga = await mangaApi.getManga(req.params.id);
    res.json(manga);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch manga" });
  }
});

// Chapters
router.get("/manga/:id/chapters", async (req, res) => {
  try {
    const chapters = await mangaApi.getAllChapters(req.params.id);
    res.json(chapters);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch chapters" });
  }
});

// Chapter Pages
router.get("/chapter/:id/pages", async (req, res) => {
  try {
    const pages = await mangaApi.getChapterPages(
      req.params.id,
      req.query.slug,
      req.query.source
    );

    return res.json(pages);
  } catch (err) {
    console.error("🔥 FULL ERROR:", err); // 👈 important

    return res.status(500).json({
      error: "Failed to fetch chapter pages",
      detail: err.message, // 👈 show real reason
    });
  }
});

export default router;