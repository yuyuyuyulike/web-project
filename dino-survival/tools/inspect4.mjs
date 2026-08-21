/* 视觉检查 4：翼龙/蝠龙形态 + 地穴画面 + 瞄准圈 */
import { boot } from "./harness.mjs";
import { createCanvas } from "./raster.mjs";

const { D, game } = boot({ w: 900, h: 520, dpr: 1 });
const I = D.Input, U = D.util;
const SHADES = " .:-=+*#%@";
const problems = [];

function ascii(rgba, w, h, cols, rows) {
  const out = [], cw = w / cols, ch = h / rows;
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < cols; c++) {
      let sum = 0, n = 0;
      for (let y = Math.floor(r * ch); y < Math.floor((r + 1) * ch); y++)
        for (let x = Math.floor(c * cw); x < Math.floor((c + 1) * cw); x++) { sum += rgba[(y * w + x) * 4 + 3] / 255; n++; }
      line += SHADES[Math.min(9, Math.floor((n ? sum / n : 0) * 9.99))];
    }
    out.push(line.replace(/\s+$/, ""));
  }
  return out;
}
function bbox(rgba, w, h) {
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (rgba[(y * w + x) * 4 + 3] > 24) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return { w: x1 - x0 + 1, h: y1 - y0 + 1, n };
}

/* ---------- 翼龙 / 蝠龙（俯视展翼） ---------- */
for (const sp of ["ptero", "bat"]) {
  const cv = createCanvas(220, 180, 2);
  const R = 30;
  const fake = {
    def: D.SPECIES[sp], radius: R, scale: R / D.SPECIES[sp].size, face: 0, phase: 1.1,
    speedNow: 120, speed: 200, dead: false, hurtT: 0, atkAnim: 0, eatT: 0, roarT: 0,
    decay: 0, id: 5, hp: 60, maxHp: 60, burn: 0, chill: 0, stun: 0, shield: 0, bless: null, alt: 0
  };
  cv.ctx.save();
  cv.ctx.translate(110, 90);
  D.Render.dinoFlyer ? D.Render.dinoFlyer(cv.ctx, fake, 1.2) : D.Render.flyer(cv.ctx, fake, 1.2);
  cv.ctx.restore();
  const px = cv.toRGBA(), bb = bbox(px, 220, 180);
  console.log("=== " + D.SPECIES[sp].name + "（俯视）bbox " + bb.w + "x" + bb.h + " px=" + bb.n);
  ascii(px, 220, 180, 58, 20).forEach((l) => console.log("   " + l));
  if (bb.n < 600) problems.push(sp + " 画得太少 px=" + bb.n);
  if (bb.h < bb.w * 0.5) problems.push(sp + " 翼展应当明显（上下张开）" + bb.w + "x" + bb.h);
}

/* ---------- 地穴画面 ---------- */
game.newGame("trike", 314159, null);
const p = game.player;
game.enterCave(game.world.caves[0]);
for (let i = 0; i < 60 * 6; i++) { I.stickId = 1; I.axis.x = 0; I.axis.y = 0; game.update(1 / 60); }
game.cam.x = p.x; game.cam.y = p.y;
game.updateCamera(0.016);
const cv2 = createCanvas(900, 520, 1);
const lc = createCanvas(900, 520, 1);
game.ctx = cv2.ctx; game.vw = 900; game.vh = 520; game.dpr = 1;
game.lightCanvas = { width: 900, height: 520, getContext: () => lc.ctx, __raster: lc.__raster };
D.Render.draw(game);
const px2 = cv2.toRGBA();
let lum = 0, center = 0, corner = 0, lava = 0, glow = 0;
const tot = 900 * 520;
for (let y = 0; y < 520; y++) {
  for (let x = 0; x < 900; x++) {
    const i = (y * 900 + x) * 4;
    const R2 = px2[i], G2 = px2[i + 1], B2 = px2[i + 2];
    const l = (R2 + G2 + B2) / 3;
    lum += l;
    const dx = x - 450, dy = y - 260;
    if (dx * dx + dy * dy < 100 * 100) center += l;
    if (x < 100 && y < 100) corner += l;
    if (R2 > 150 && G2 > 60 && G2 < 170 && B2 < 90) lava++;
    if (G2 > 140 && B2 > 120 && R2 < 160) glow++;
  }
}
console.log("=== 地穴画面 全屏亮度 " + (lum / tot).toFixed(1) +
  " | 玩家周围 " + (center / (Math.PI * 100 * 100)).toFixed(1) +
  " vs 角落 " + (corner / 10000).toFixed(1) +
  " | 岩浆像素 " + lava + " 蘑菇/水晶冷光 " + glow);
if (lum / tot > 90) problems.push("地穴不够暗（应当很黑）");
if (center / (Math.PI * 100 * 100) < corner / 10000 * 1.4) problems.push("地穴里玩家周围没有照明");

/* ---------- 瞄准圈 ---------- */
game.exitCave();
game.graceT = 0;
const prey = game.spawn("compy", p.x + 34, p.y + 6, { level: 1 });
prey.throttle = 0;
for (let i = 0; i < 3; i++) { I.stickId = 1; I.axis.x = 0; I.axis.y = 0; game.update(1 / 60); }
const withAim = createCanvas(900, 520, 1);
game.ctx = withAim.ctx; game.lightCanvas = null;
game.cam.x = p.x; game.cam.y = p.y; game.updateCamera(0.016);
D.Render.draw(game);
const a1 = withAim.toRGBA();
const savedAim = game.aimTarget;
game.aimTarget = null;
const noAim = createCanvas(900, 520, 1);
game.ctx = noAim.ctx;
D.Render.draw(game);
const a2 = noAim.toRGBA();
let ringPx = 0;
for (let i = 0; i < tot; i++) {
  if (Math.abs(a1[i * 4] - a2[i * 4]) + Math.abs(a1[i * 4 + 1] - a2[i * 4 + 1]) + Math.abs(a1[i * 4 + 2] - a2[i * 4 + 2]) > 40) ringPx++;
}
console.log("=== 瞄准目标=" + (savedAim ? savedAim.def.name : "none") + " 瞄准圈像素 " + ringPx);
if (!savedAim) problems.push("附近有猎物却没有瞄准目标");
if (ringPx < 60) problems.push("瞄准圈几乎看不见 px=" + ringPx);

console.log("");
if (problems.length) { console.log("PROBLEMS:"); problems.forEach((x) => console.log("  - " + x)); process.exit(1); }
console.log("VISUAL4 OK");
process.exit(0);
