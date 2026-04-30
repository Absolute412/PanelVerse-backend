import { getChapterPages } from "./sources/weebcentral.js";
console.log("🚀 TEST FILE STARTED");
const run = async () => {
  try {
    const chapterId = "01KPR9NRQ8SW0X750RFKVPJKVM";

    const pages = await getChapterPages(chapterId);

    console.log("Pages found:", pages.length);
    console.log(pages.slice(0, 5)); // show first 5

  } catch (err) {
    console.error("❌ Error:", err.message);
  }
};

run();