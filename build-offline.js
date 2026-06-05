// Generuje samodzielny plik mpc-converter-offline.html:
// wkleja app.js i templates.js do index.html (zamiast <script src>),
// i usuwa blok linku do pobrania offline (OFFLINE-DL-START..END).
// Uruchom: node build-offline.js
const fs = require("fs");
const path = require("path");
const dir = __dirname;

const safe = (s) => s.replace(/<\/script>/gi, "<\\/script>"); // by nie zamknąć <script>

let html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
const templates = fs.readFileSync(path.join(dir, "templates.js"), "utf8");
const app = fs.readFileSync(path.join(dir, "app.js"), "utf8");

html = html.replace('<script src="templates.js"></script>',
  "<script>\n" + safe(templates) + "\n</script>");
html = html.replace('<script src="app.js"></script>',
  "<script>\n" + safe(app) + "\n</script>");
// usuń link do pobrania offline (w wersji offline jest zbędny)
html = html.replace(/<!--OFFLINE-DL-START-->[\s\S]*?<!--OFFLINE-DL-END-->/, "");

const out = path.join(dir, "mpc-converter-offline.html");
fs.writeFileSync(out, html);
console.log("OK ->", path.basename(out), (html.length / 1024).toFixed(1), "KB",
  "| zewnętrzne <script src>:", (html.match(/<script src=/g) || []).length);
