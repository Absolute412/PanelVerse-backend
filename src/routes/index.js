import express from "express";
import mangaRoutes from "./mangaRoutes.js"
import imageRoutes from "./image.js"

const router = express.Router();

router.use("/", mangaRoutes);
router.use("/", imageRoutes);

export default router;