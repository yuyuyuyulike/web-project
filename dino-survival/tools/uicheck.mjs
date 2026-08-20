/* 静态一致性检查：JS 引用的 id/class/文件 是否都存在 */
import fs from "node:fs";
import path from "node:path";

const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("styles.css", "utf8");
const srcFiles = fs.readdirSync("src").filter((f) => f.endsWith(".js"));
const js = srcFiles.map((f) => fs.readFileSync(path.join("src", f), "utf8")).join("\n");

const problems = [];
const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const usedIds = new Set([...js.matchAll(/(?:byId|getElementById)\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]));
for (const id of usedIds) if (!htmlIds.has(id)) problems.push("JS 引用了不存在的 id: #" + id);

// HTML 里声明但从未被 JS/CSS 使用的 id（仅提示）
const unused = [...htmlIds].filter((id) => !usedIds.has(id) && !css.includes("#" + id) && !js.includes('"' + id + '"'));

const usedClasses = new Set([...js.matchAll(/classList\.(?:add|remove|toggle)\(\s*"([^"]+)"/g)].map((m) => m[1]));
for (const c of usedClasses) {
  if (!css.includes("." + c)) problems.push("JS 用到的 class 在 CSS 里没有定义: ." + c);
}
// HTML 里用到的 class 是否有样式
const htmlClasses = new Set();
for (const m of html.matchAll(/class="([^"]+)"/g)) m[1].split(/\s+/).forEach((c) => c && htmlClasses.add(c));
for (const c of htmlClasses) if (!css.includes("." + c)) problems.push("HTML class 无样式: ." + c);

// 引用的文件是否存在
for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const f = m[1];
  if (f.startsWith("http") || f.startsWith("data:") || f.startsWith("#")) continue;
  if (!fs.existsSync(f)) problems.push("index.html 引用了不存在的文件: " + f);
}
// sw.js 缓存清单
const sw = fs.readFileSync("sw.js", "utf8");
for (const m of sw.matchAll(/"\.\/([^"]+)"/g)) {
  if (m[1] && !fs.existsSync(m[1])) problems.push("sw.js 缓存了不存在的文件: " + m[1]);
}
// 手动检查关键交互控件都在
for (const need of ["btn-start", "btn-attack", "btn-act", "btn-nest", "btn-roar", "btn-sprint", "stickzone", "stick", "knob", "minimap", "game"]) {
  if (!htmlIds.has(need)) problems.push("缺少关键元素 #" + need);
}
// viewport / 移动端要点
for (const need of ["user-scalable=no", "viewport-fit=cover", "manifest", "apple-mobile-web-app-capable"]) {
  if (!html.includes(need)) problems.push("index.html 缺少移动端要点: " + need);
}
for (const need of ["touch-action", "env(safe-area-inset", "overscroll-behavior", "-webkit-tap-highlight-color"]) {
  if (!css.includes(need)) problems.push("styles.css 缺少移动端要点: " + need);
}

console.log("html ids: " + htmlIds.size + ", js 引用: " + usedIds.size + ", js class: " + usedClasses.size);
if (unused.length) console.log("（提示）未被引用的 id: " + unused.join(", "));
if (problems.length) { console.log("PROBLEMS:"); problems.forEach((p) => console.log("  - " + p)); process.exit(1); }
console.log("UI WIRING OK");
