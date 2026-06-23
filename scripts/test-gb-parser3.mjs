import fs from "fs";

const html = fs.readFileSync(new URL("./gb-week8-homepage.html", import.meta.url), "utf8");
const buf = new TextEncoder().encode(html);
const decoded = new TextDecoder("utf-8").decode(buf);

console.log("arrayBuffer decode length", decoded.length);
console.log("data-cid count", (decoded.match(/data-cid="/g) || []).length);
