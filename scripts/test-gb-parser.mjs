import fs from "fs";

const html = fs.readFileSync(new URL("./gb-week8-homepage.html", import.meta.url), "utf8");
const ctx = { collectionSlug: "collection-weekly-training-plan-week-8" };

console.log("html length", html.length);
console.log("data-cid count", (html.match(/data-cid="/g) || []).length);
console.log("content-item count", (html.match(/class="content-item/g) || []).length);
console.log("playlist-divider count", (html.match(/playlist-divider/g) || []).length);

// current regex
const combinedRe =
  /<div class="playlist-divider[^"]*"[^>]*data-area="playlist-divider"[^>]*>\s*([\s\S]*?)<\/div>|<div class="content-item[^"]*"[^>]*data-cid="(\d+)"[^>]*>([\s\S]*?)(?=<div class="content-item|<div class="playlist-divider|<\/ds-swiper|<div class="py-4 lg:py-8" id="comments)/gi;

let n = 0;
let m;
while ((m = combinedRe.exec(html)) !== null) {
  if (m[2]) n++;
}
console.log("current regex videos", n);

// sample first content-item line
const idx = html.indexOf('data-cid="');
console.log("first data-cid snippet:", html.slice(idx - 80, idx + 120));

// test relaxed cid + title extraction
const itemRe = /data-cid="(\d+)"[\s\S]*?class="content-item-title[^"]*"[^>]*title="([^"]*)"/g;
const byCid = new Map();
while ((m = itemRe.exec(html)) !== null) {
  byCid.set(m[1], m[2]);
}
console.log("relaxed title regex", byCid.size);
