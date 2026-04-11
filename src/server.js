import express from "express";
import cors from "cors";
import routes from "./routes/index.js";

const app = express();
const PORT = process.env.PORT || 5000;

// CORS setup
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
  } catch {}

  return callback(new Error("Not allowed by CORS"));
};

app.use(cors({
  origin: allowLocalOrigins,
  credentials: true,
}));

app.use(express.json());

// Mount all API routes
app.use("/api", routes);

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});