import fs from "fs";

const html = fs.readFileSync(new URL("./gb-week8-homepage.html", import.meta.url), "utf8");

// Simulate empty/partial responses
const loginStub = "<html><body>Sign in</body></html>";
console.log("login stub parse", parseTest(loginStub));

console.log("full html parse", parseTest(html));

function parseTest(html) {
  const combinedRe =
    /<div class="playlist-divider[^"]*"[^>]*data-area="playlist-divider"[^>]*>\s*([\s\S]*?)<\/div>|<div class="content-item[^"]*"[^>]*data-cid="(\d+)"[^>]*>([\s\S]*?)(?=<div class="content-item|<div class="playlist-divider|<\/ds-swiper|<div class="py-4 lg:py-8" id="comments)/gi;
  const byCid = new Map();
  let m;
  while ((m = combinedRe.exec(html)) !== null) {
    if (m[2]) byCid.set(m[2], m[2]);
  }
  const fallback = fallbackParse(html);
  return { combined: byCid.size, fallback: fallback.size };
}

function fallbackParse(html) {
  const byCid = new Map();
  const re = /data-cid="(\d+)"[\s\S]{0,4000}?class="content-item-title[^"]*"[^>]*title="([^"]*)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    byCid.set(m[1], m[2]);
  }
  // program_content style
  const re2 = /data-cid="(\d+)"[^>]*data-permalink="([^"]*)"[\s\S]{0,2000}?data-area="title"[^>]*title="([^"]*)"/g;
  while ((m = re2.exec(html)) !== null) {
    byCid.set(m[1], m[3]);
  }
  return byCid;
}
