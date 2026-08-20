/* 像素检查：把渲染结果转成 ASCII 轮廓 + 颜色统计，供无图像输入时验证画面 */
import { boot } from "./harness.mjs";
import { createCanvas } from "./raster.mjs";

const { D, game } = boot({ w: 900, h: 520, dpr: 1 });
const I = D.Input;
const SHADES = " .:-=+*#%@";

function asciiAlpha(rgba, w, h, cols, rows) {
  const out = [];
  const cw = w / cols, ch = h / rows;
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < cols; c++) {
      let sum = 0, n = 0;
      for (let y = Math.floor(r * ch); y < Math.floor((r + 1) * ch); y++) {
        for (let x = Math.floor(c * cw); x < Math.floor((c + 1) * cw); x++) {
          sum += rgba[(y * w + x) * 4 + 3] / 255; n++;
        }
      }
      const cov = n ? sum / n : 0;
      line += SHADES[Math.min(9, Math.floor(cov * 9.99))];
    }
    out.push(line.replace(/\s+$/, ""));
  }
  return out;
}

function bbox(rgba, w, h) {
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (rgba[(y * w + x) * 4 + 3] > 24) {
      n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return { x0, y0, x1, y1, n, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/* ---------- 1. 每个可玩物种的轮廓 ---------- */
const problems = [];
for (const key of D.PLAYABLE) {
  const cv = createCanvas(260, 200, 2);
  cv.ctx.save();
  cv.ctx.translate(20, -6);
  D.Render.preview(cv.ctx, key, 220, 220, 2.2);
  cv.ctx.restore();
  const rgba = cv.toRGBA();
  const bb = bbox(rgba, 260, 200);
  const def = D.SPECIES[key];
  console.log("=== " + def.name + " (" + key + ") bbox " + bb.w + "x" + bb.h + " px=" + bb.n + " ratio=" + (bb.w / bb.h).toFixed(2));
  asciiAlpha(rgba, 260, 200, 76, 26).forEach((l) => console.log("   " + l));
  if (bb.n < 1500) problems.push(key + ": 轮廓像素过少 (" + bb.n + ")");
  if (bb.w / bb.h < 1.1 || bb.w / bb.h > 4.2) problems.push(key + ": 侧视比例异常 " + (bb.w / bb.h).toFixed(2));
}

/* ---------- 2. 场景颜色构成 ---------- */
function classify(r, g, b) {
  if (b > r + 20 && b > 60 && g < b + 10) return "W";
  if (r > 180 && g > 165 && b < 170) return "S";
  if (g > r && g > b && g > 70) return (g > 130 ? "G" : "F");
  if (Math.abs(r - g) < 22 && Math.abs(g - b) < 22 && r > 90) return "R";
  return "?";
}

game.newGame("rex", 20240808, null);
game.dayLength = 500; game.tod = 0.45;
for (let i = 0; i < 60 * 12; i++) {
  I.stickId = 1; I.axis.x = Math.cos(i * 0.01) * 0.9; I.axis.y = Math.sin(i * 0.013) * 0.9;
  I.btn.act = true; I.btn.attack = i % 40 < 5;
  game.update(1 / 60);
}
// 屏幕内生物数量统计（生态是否够热闹）
let seen = 0, samples = 0;
for (let s = 0; s < 240; s++) {
  I.stickId = 1; I.axis.x = Math.cos(s * 0.05) * 0.9; I.axis.y = Math.sin(s * 0.04) * 0.9;
  game.update(1 / 60);
  if (s % 12 === 0) {
    samples++;
    seen += game.creatures.filter((c) => !c.isPlayer && game.inView(c.x, c.y, 60)).length;
  }
}
console.log("=== 屏幕内平均生物数: " + (seen / samples).toFixed(2) + " (总数 " + game.creatures.length + ")");
if (seen / samples < 0.8) problems.push("屏幕上几乎看不到生物，生态太稀疏");

const scene = createCanvas(900, 520, 1);
game.ctx = scene.ctx; game.vw = 900; game.vh = 520; game.dpr = 1; game.lightCanvas = null;
game.updateCamera(0.016);
D.Render.draw(game);
const sRGBA = scene.toRGBA();
const hist = {};
for (let i = 0; i < 900 * 520; i++) {
  const k = classify(sRGBA[i * 4], sRGBA[i * 4 + 1], sRGBA[i * 4 + 2]);
  hist[k] = (hist[k] || 0) + 1;
}
const total = 900 * 520;
console.log("=== 白天场景颜色构成");
Object.keys(hist).sort((a, b) => hist[b] - hist[a]).forEach((k) => {
  console.log("   " + k + " " + (hist[k] / total * 100).toFixed(1) + "%");
});
const transparent = hist["?"] ? 0 : 0;
if ((hist.G || 0) + (hist.F || 0) < total * 0.15) problems.push("场景绿色地形过少");

/* 生物是否真的被画出来：与"清空生物"的画面做差 */
const keep = game.creatures.slice();
const scene2 = createCanvas(900, 520, 1);
game.ctx = scene2.ctx;
game.creatures = [game.player];
D.Render.draw(game);
game.creatures = keep;
const s2 = scene2.toRGBA();
let diff = 0;
for (let i = 0; i < total; i++) {
  if (Math.abs(sRGBA[i * 4] - s2[i * 4]) + Math.abs(sRGBA[i * 4 + 1] - s2[i * 4 + 1]) + Math.abs(sRGBA[i * 4 + 2] - s2[i * 4 + 2]) > 30) diff++;
}
console.log("   生物/特效像素差异: " + diff + " px (" + (diff / total * 100).toFixed(2) + "%)");
if (diff < 400) problems.push("画面里几乎看不到其它生物");

/* 玩家自身占屏比例（判断视野缩放是否合理） */
const scene3 = createCanvas(900, 520, 1);
game.ctx = scene3.ctx;
const others = game.creatures.filter((c) => !c.isPlayer);
game.creatures = [game.player];
const before = game.player.x;
D.Render.draw(game);
const s3 = scene3.toRGBA();
game.creatures = [game.player].concat(others);
const scene4 = createCanvas(900, 520, 1);
game.ctx = scene4.ctx;
game.creatures = [];
D.Render.draw(game);
const s4 = scene4.toRGBA();
let pl = 0;
for (let i = 0; i < total; i++) {
  if (Math.abs(s3[i * 4] - s4[i * 4]) + Math.abs(s3[i * 4 + 1] - s4[i * 4 + 1]) + Math.abs(s3[i * 4 + 2] - s4[i * 4 + 2]) > 30) pl++;
}
game.creatures = [game.player].concat(others);
console.log("   玩家占屏: " + (pl / total * 100).toFixed(2) + "% (" + pl + " px)  zoom=" + game.cam.zoom.toFixed(2));
if (pl < 500) problems.push("玩家太小，移动端可能看不清");

/* ---------- 3. 夜晚/雨 是否明显改变画面 ---------- */
game.tod = 0.95; game.updateTime(0.016);
game.weather.rain = 0.9; game.weather.fog = 0;
const night = createCanvas(900, 520, 1);
game.ctx = night.ctx;
game.lightCanvas = null;   // 夜幕靠离屏 canvas，这里只验证雨与暖色调
D.Render.draw(game);
const nRGBA = night.toRGBA();
let bright = 0, nbright = 0;
for (let i = 0; i < total; i++) { bright += sRGBA[i * 4 + 1]; nbright += nRGBA[i * 4 + 1]; }
console.log("=== 雨天/黄昏平均绿通道: 白天 " + (bright / total).toFixed(1) + " -> " + (nbright / total).toFixed(1));

console.log("");
if (problems.length) { console.log("PROBLEMS:"); problems.forEach((p) => console.log("  - " + p)); process.exit(1); }
console.log("VISUAL CHECK OK");
process.exit(0);
