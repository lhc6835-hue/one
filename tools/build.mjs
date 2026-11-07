// 빌드: src/main.js 를 하나로 묶고 CSS 와 함께 index.html 에 인라인해서 dist/index.html 한 파일로 만든다.
// --serve 를 주면 저장할 때마다 다시 빌드하면서 http://localhost:5173 으로 띄운다.
import * as esbuild from "esbuild";
import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serve = process.argv.includes("--serve");

async function build() {
  const js = await esbuild.build({
    entryPoints: [path.join(root, "src/main.js")],
    bundle: true, format: "iife", minify: !serve, target: "es2020", write: false, legalComments: "eof",
  });
  const css = await readFile(path.join(root, "src/style.css"), "utf8");
  let html = await readFile(path.join(root, "index.html"), "utf8");
  const code = js.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  html = html.replace("<!--STYLE-->", () => `<style>\n${css}</style>`).replace("<!--SCRIPT-->", () => `<script>\n${code}</script>`);
  await mkdir(path.join(root, "dist"), { recursive: true });
  await writeFile(path.join(root, "dist/index.html"), html);
  // 음악 등 정적 파일
  await cp(path.join(root, "public"), path.join(root, "dist"), { recursive: true });
  // claude.ai 아티팩트용: 문서 뼈대는 게시할 때 씌워지므로 doctype/html/head/body 태그를 뺀 판
  const frag = html
    .replace(/<!doctype html>\s*/i, "")
    .replace(/<\/?(html|head|body)[^>]*>\s*/gi, "")
    .replace(/<meta charset[^>]*>\s*/i, "")
    .replace(/<meta name="viewport"[^>]*>\s*/i, "");
  await writeFile(path.join(root, "dist/artifact.html"), frag);
  return html.length;
}

const size = await build();
console.log(`dist/index.html (${(size / 1024).toFixed(0)} KB)`);

if (serve) {
  const { watch } = await import("node:fs");
  let timer;
  watch(path.join(root, "src"), { recursive: true }, () => { clearTimeout(timer); timer = setTimeout(() => build().then(() => console.log("rebuilt")).catch(console.error), 80); });
  watch(path.join(root, "index.html"), () => build().catch(console.error));
  const types = { ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".html": "text/html; charset=utf-8" };
  createServer(async (req, res) => {
    const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const f = path.join(root, "dist", u === "/" ? "index.html" : path.normalize(u).replace(/^([/\\])+/, ""));
    try {
      const body = await readFile(f);
      res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  }).listen(5173, () => console.log("http://localhost:5173"));
}
