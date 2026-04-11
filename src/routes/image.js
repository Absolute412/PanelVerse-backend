import express from "express";
import fetch from "node-fetch";

const router = express.Router();

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

  const isMangaDex =
    parsed.hostname === "mangadex.org" ||
    parsed.hostname.endsWith(".mangadex.org") ||
    parsed.hostname.endsWith(".mangadex.network");

  if (!isMangaDex) {
    return res.status(403).json({ error: "Host not allowed" });
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 PanelVerse/1.0",
        "Referer": "https://mangadex.org/",
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });

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

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.status(200).end(buf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch image" });
  }
});

export default router;