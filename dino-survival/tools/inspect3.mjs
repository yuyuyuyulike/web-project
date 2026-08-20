/* 视觉检查 3：人类 / 图腾 / 吐息 / 魔法地物 */
import { boot } from "./harness.mjs";
import { createCanvas } from "./raster.mjs";

const { D, game } = boot({ w: 900, h: 520, dpr: 1 });
const I = D.Input;
const U = D.util;
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
function fake(spKey, R, extra) {
  const o = {
    def: D.SPECIES[spKey], radius: R, scale: R / D.SPECIES[spKey].size, face: 0.25, phase: 2.2,
    speedNow: 40, speed: 150, dead: false, hurtT: 0, atkAnim: 0, eatT: 0, roarT: 0, decay: 0,
    id: 3, hp: 70, maxHp: 100, burn: 0, chill: 0, stun: 0, shield: 0, bless: null, breathT: 0
  };
  for (const k in (extra || {})) o[k] = extra[k];
  return o;
}

/* ---------- 人类四种角色 + 图腾 ---------- */
for (const role of ["hunter", "spearman", "shaman", "chief"]) {
  const cv = createCanvas(200, 170, 2);
  cv.ctx.save();
  cv.ctx.translate(100, 150);
  D.Render.human(cv.ctx, fake(role, 26), 1.4);
  cv.ctx.restore();
  const px = cv.toRGBA(), bb = bbox(px, 200, 170);
  console.log("=== " + D.SPECIES[role].name + " bbox " + bb.w + "x" + bb.h + " px=" + bb.n);
  ascii(px, 200, 170, 54, 20).forEach((l) => console.log("   " + l));
  if (bb.n < 700) problems.push(role + " 轮廓像素过少 " + bb.n);
  if (bb.h < bb.w) problems.push(role + " 人形应当比宽更高 " + bb.w + "x" + bb.h);
}
{
  const cv = createCanvas(200, 190, 2);
  cv.ctx.save();
  cv.ctx.translate(100, 170);
  D.Render.totem(cv.ctx, fake("totem", 26, { hp: 300, maxHp: 340 }), 1.4);
  cv.ctx.restore();
  const px = cv.toRGBA(), bb = bbox(px, 200, 190);
  console.log("=== 部落图腾 bbox " + bb.w + "x" + bb.h + " px=" + bb.n);
  ascii(px, 200, 190, 54, 22).forEach((l) => console.log("   " + l));
  if (bb.h < bb.w * 1.5) problems.push("图腾柱应当是竖长的 " + bb.w + "x" + bb.h);
}

/* ---------- 魔法地物 ---------- */
for (const kind of ["crystal", "rune", "campfire", "tent"]) {
  const cv = createCanvas(180, 150, 2);
  const p = { kind: kind, x: 90, y: 110, r: kind === "rune" ? 60 : 26, seed: 3, food: 100, max: 100, cd: 0 };
  D.Render.prop(cv.ctx, p, 1.5, 1);
  const px = cv.toRGBA(), bb = bbox(px, 180, 150);
  console.log("=== 道具 " + kind + " bbox " + bb.w + "x" + bb.h + " px=" + bb.n);
  if (bb.n < 200) problems.push("道具 " + kind + " 几乎没画出来 px=" + bb.n);
}

/* ---------- 吐息方向与覆盖 ---------- */
function castAndMeasure(sp) {
  game.newGame(sp, 4242, null);
  const p = game.player;
  game.dayLength = 500; game.tod = 0.45;
  for (let i = 0; i < 20; i++) game.update(1 / 60);
  p.face = 0; p.dirWanted = 0; p.mana = p.manaMax; p.breathCd = 0;
  game.cam.x = p.x; game.cam.y = p.y;
  game.updateCamera(0.016);
  const before = createCanvas(900, 520, 1);
  game.ctx = before.ctx; game.vw = 900; game.vh = 520; game.dpr = 1; game.lightCanvas = null;
  D.Render.draw(game);
  const b0 = before.toRGBA();
  D.Magic.cast(game, p);
  game.flash = 0;                     // 排除全屏闪光，只测吐息本身的几何
  const after = createCanvas(900, 520, 1);
  game.ctx = after.ctx;
  D.Render.draw(game);
  const a0 = after.toRGBA();
  let n = 0, sx = 0, sy = 0;
  for (let y = 0; y < 520; y++) for (let x = 0; x < 900; x++) {
    const i = (y * 900 + x) * 4;
    const d = Math.abs(a0[i] - b0[i]) + Math.abs(a0[i + 1] - b0[i + 1]) + Math.abs(a0[i + 2] - b0[i + 2]);
    if (d > 60) { n++; sx += x; sy += y; }
  }
  const px = ((p.x - game.cam.x) * game.cam.zoom + 450);
  return { n: n, cx: n ? sx / n : 0, dx: n ? sx / n - px : 0 };
}
for (const sp of D.PLAYABLE) {
  const m = castAndMeasure(sp);
  const B = D.Magic.BREATHS[D.SPECIES[sp].breath];
  const dirOk = B.kind === "ring" ? Math.abs(m.dx) < 90 : m.dx > 10;
  console.log("=== " + D.SPECIES[sp].name + " " + B.name + " 改变像素 " + m.n + " 质心偏移 " + m.dx.toFixed(0) + "px");
  if (m.n < 900) problems.push(B.name + " 画面几乎没有变化 " + m.n);
  if (!dirOk) problems.push(B.name + " 特效方向不对 dx=" + m.dx.toFixed(0));
}

/* ---------- 营地画面 ---------- */
game.newGame("rex", 90210, null);
game.dayLength = 500; game.tod = 0.45;
const w0 = game.world, v = w0.villages[0];
const p2 = game.player;
const land = w0.findLand(v.x + 150, v.y + 90, p2.radius);
p2.x = land.x; p2.y = land.y;
game.graceT = 0;
for (let i = 0; i < 60 * 12; i++) game.update(1 / 60);
game.cam.x = v.x; game.cam.y = v.y;
game.updateCamera(0.016);
const vc = createCanvas(900, 520, 1);
game.ctx = vc.ctx; game.lightCanvas = null;
D.Render.draw(game);
const vp = vc.toRGBA();
let tan = 0, fire = 0, tot = 900 * 520;
for (let i = 0; i < tot; i++) {
  const R = vp[i * 4], G = vp[i * 4 + 1], B2 = vp[i * 4 + 2];
  if (R > 140 && G > 100 && G < 175 && B2 < 120) tan++;
  if (R > 220 && G > 130 && G < 215 && B2 < 110) fire++;
}
const humans = game.creatures.filter((c) => c.def.kind === "human" && !c.dead).length;
console.log("=== 营地画面：帐篷/图腾色像素 " + (tan / tot * 100).toFixed(2) + "% 火光像素 " + (fire / tot * 100).toFixed(2) + "% 在场人类 " + humans);
if (tan / tot < 0.004) problems.push("营地结构在画面上几乎看不见");
if (fire / tot < 0.0004) problems.push("篝火看不见");

console.log("");
if (problems.length) { console.log("PROBLEMS:"); problems.forEach((p) => console.log("  - " + p)); process.exit(1); }
console.log("VISUAL3 OK");
process.exit(0);
