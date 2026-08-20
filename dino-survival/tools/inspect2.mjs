/* 地形分布 + 岸边画面 + 夜幕 检查 */
import { boot } from "./harness.mjs";
import { createCanvas } from "./raster.mjs";

const { D, game } = boot({ w: 900, h: 520, dpr: 1 });
const problems = [];
const names = ["深水", "浅水", "沙滩", "草地", "森林", "岩石"];

console.log("=== 地形分布（5 个随机种子）");
for (const seed of [11, 777, 20240808, 999331, 5]) {
  const w = new D.World(seed);
  const c = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < w.map.length; i++) c[w.map[i]]++;
  const tot = w.map.length;
  const line = c.map((v, i) => names[i] + " " + (v / tot * 100).toFixed(1) + "%").join("  ");
  const plants = w.plants.length, trees = w.props.filter((p) => p.kind === "tree").length;
  console.log("  seed " + seed + ": " + line + "  | 可食植物 " + plants + " 树 " + trees);
  const water = (c[0] + c[1]) / tot, forest = c[4] / tot, grass = c[3] / tot;
  if (water < 0.04) problems.push("seed " + seed + " 水域过少 " + (water * 100).toFixed(1) + "%");
  if (forest < 0.05) problems.push("seed " + seed + " 森林过少 " + (forest * 100).toFixed(1) + "%");
  if (grass < 0.2) problems.push("seed " + seed + " 草地过少");
  if (plants < 400) problems.push("seed " + seed + " 可食植物过少 " + plants);
}

/* 岸边画面：把地形类别打成字符图 */
function classMap(rgba, w, h, cols, rows) {
  const out = [];
  const cw = w / cols, ch = h / rows;
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c2 = 0; c2 < cols; c2++) {
      const x = Math.floor((c2 + 0.5) * cw), y = Math.floor((r + 0.5) * ch);
      const i = (y * w + x) * 4;
      const R = rgba[i], G = rgba[i + 1], B = rgba[i + 2];
      let ch2 = "?";
      if (B > R + 25 && B > 70) ch2 = (B > 150 ? "~" : "≈");
      else if (R > 175 && G > 160 && B < 175) ch2 = ".";
      else if (G > R && G > B) ch2 = (G > 135 ? "\"" : "T");
      else if (Math.abs(R - G) < 24 && Math.abs(G - B) < 24 && R > 85) ch2 = "^";
      else ch2 = "#";
      line += ch2;
    }
    out.push(line);
  }
  return out;
}

game.newGame("rex", 20240808, null);
game.dayLength = 500; game.tod = 0.45;
const w0 = game.world;
const wat = w0.findWater(w0.w / 2, w0.h / 2, 4000);
const land = w0.findLand(wat.x + 90, wat.y + 40, game.player.radius);
game.player.x = land.x; game.player.y = land.y;
game.cam.x = land.x; game.cam.y = land.y;
for (let i = 0; i < 30; i++) game.update(1 / 60);
game.updateCamera(0.016);

const day = createCanvas(900, 520, 1);
game.ctx = day.ctx; game.vw = 900; game.vh = 520; game.dpr = 1; game.lightCanvas = null;
D.Render.draw(game);
const dayPix = day.toRGBA();
console.log("=== 岸边画面（~ 深水 ≈ 浅水 . 沙 \" 草 T 林 ^ 岩 # 其它）");
classMap(dayPix, 900, 520, 88, 24).forEach((l) => console.log("  " + l));

/* 夜幕：带离屏光照 canvas */
game.tod = 0.93; game.updateTime(0.016);
const night = createCanvas(900, 520, 1);
const lc = createCanvas(900, 520, 1);
game.ctx = night.ctx;
game.lightCanvas = { width: 900, height: 520, getContext: () => lc.ctx, __raster: lc.__raster };
D.Render.draw(game);
const nPix = night.toRGBA();
let dayLum = 0, nightLum = 0, centerLum = 0, cornerLum = 0, n = 0;
for (let y = 0; y < 520; y++) {
  for (let x = 0; x < 900; x++) {
    const i = (y * 900 + x) * 4;
    const l1 = (dayPix[i] + dayPix[i + 1] + dayPix[i + 2]) / 3;
    const l2 = (nPix[i] + nPix[i + 1] + nPix[i + 2]) / 3;
    dayLum += l1; nightLum += l2; n++;
    const dx = x - 450, dy = y - 260;
    if (dx * dx + dy * dy < 90 * 90) centerLum += l2;
    if (x < 90 && y < 90) cornerLum += l2;
  }
}
const cA = Math.PI * 90 * 90, kA = 90 * 90;
console.log("=== 夜晚亮度  全屏 " + (dayLum / n).toFixed(1) + " -> " + (nightLum / n).toFixed(1) +
  " | 玩家周围 " + (centerLum / cA).toFixed(1) + " vs 角落 " + (cornerLum / kA).toFixed(1) + " | darkness=" + game.darkness.toFixed(2));
if (nightLum / n > dayLum / n * 0.75) problems.push("夜晚没有明显变暗");
if (centerLum / cA < cornerLum / kA * 1.25) problems.push("夜晚玩家周围没有视野光圈");

console.log("");
if (problems.length) { console.log("PROBLEMS:"); problems.forEach((p) => console.log("  - " + p)); process.exit(1); }
console.log("TERRAIN/NIGHT CHECK OK");
process.exit(0);
