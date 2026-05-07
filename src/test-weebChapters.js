import { getAllChapters } from "./sources/weebcentral.js";

console.log("TEST STARTED🔥");
const run = async () => {
  const seriesId = "01J76XYDGDQERFSK333582BNBZ"; //  frieren

  const chapters = await getAllChapters(seriesId);

  console.log("Chapters:", chapters.length);
  console.log(chapters.slice(0, 5));
};

run();