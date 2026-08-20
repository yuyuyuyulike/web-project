/* 把真实渲染代码画进 PNG，用于人工视觉检查 */
import { boot } from "./harness.mjs";
import { createCanvas } from "./raster.mjs";
import fs from "node:fs";

fs.mkdirSync("tools/shots", { recursive: true });
const { D, game } = boot({ w: 900, h: 520, dpr: 1 });
const I = D.Input;

function sim(seconds, opts) {
  opts = opts || {};
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) {
    I.stickId = 1;
    I.axis.x = opts.still ? 0 : Math.cos(i * 0.01) * 0.9;
    I.axis.y = opts.still ? 0 : Math.sin(i * 0.013) * 0.9;
    I.btn.act = true; I.btn.attack = i % 40 < 5; I.btn.sprint = false;
    game.update(1 / 60);
  }
}

/* 1. 四个可玩物种的大图 */
const cv = createCanvas(880, 240, 2);
const sheetCtx = cv.ctx;
for (let i = 0; i < D.PLAYABLE.length; i++) {
  sheetCtx.save();
  sheetCtx.translate(110 + i * 220, 30);
  D.Render.preview(sheetCtx, D.PLAYABLE[i], 200, 200, 1.4 + i);
  sheetCtx.restore();
}
cv.save("tools/shots/species.png");

/* 2. 白天场景 */
game.newGame("rex", 20240808, null);
game.dayLength = 400;
game.tod = 0.45;
sim(14);
const scene = createCanvas(900, 520, 2);
game.ctx = scene.ctx; game.vw = 900; game.vh = 520; game.dpr = 1;
game.lightCanvas = null;
game.updateCamera(0.016);
D.Render.draw(game);
scene.save("tools/shots/scene-day.png");

/* 3. 黄昏 + 雨 + 战斗 */
game.tod = 0.76;
game.updateTime(0.016);
game.weather.type = "rain"; game.weather.tr = 0.9; game.weather.rain = 0.9; game.weather.wind = 0.6;
const p = game.player;
for (let i = 0; i < 3; i++) {
  const a = i * 2.1;
  const c = game.spawn("raptor", p.x + Math.cos(a) * 90, p.y + Math.sin(a) * 90, { level: 3 });
  if (c) { c.state = "fight"; c.target = p; }
}
game.fx.blood(p.x + 30, p.y - 10, 20, 14);
game.fx.text(p.x, p.y - 60, "38", "#ffce54");
sim(1.2, { still: true });
game.updateCamera(0.016);
D.Render.draw(game);
scene.save("tools/shots/scene-dusk-rain.png");

/* 4. 巢 + 蛋 + 幼崽 + 火 */
game.newGame("trike", 20240809, null);
game.dayLength = 400; game.tod = 0.42;
const p2 = game.player;
p2.hunger = 100; p2.thirst = 100;
game.nestAction();
p2.hunger = 100; game.nestAction();
p2.hunger = 100; game.nestAction();
game.fires.push({ x: p2.x + 160, y: p2.y + 40, r: 70, t: 8, dmgT: 0 });
game.meteors.push({ x: p2.x - 150, y: p2.y + 60, t: 1.2, dur: 1.9, r: 90 });
sim(3, { still: true });
game.updateCamera(0.016);
D.Render.draw(game);
scene.save("tools/shots/scene-nest.png");

/* 5. 人类营地 + 吐息 */
game.newGame("rex", 90210, null);
game.dayLength = 500; game.tod = 0.42;
const vv = game.world.villages[0];
const p3 = game.player;
const lp = game.world.findLand(vv.x + 170, vv.y + 110, p3.radius);
p3.x = lp.x; p3.y = lp.y;
game.graceT = 0; p3.untargetable = false;
sim(13, { still: true });
p3.face = Math.atan2(vv.y - p3.y, vv.x - p3.x);
p3.mana = p3.manaMax; p3.breathCd = 0;
D.Magic.cast(game, p3);
game.cam.x = (p3.x + vv.x) / 2; game.cam.y = (p3.y + vv.y) / 2;
game.updateCamera(0.016);
game.ctx = scene.ctx;
D.Render.draw(game);
scene.save("tools/shots/scene-village-fire.png");

/* 6. 夜晚 + 符文圈 + 幽影 */
game.tod = 0.93; game.updateTime(0.016);
const rn = game.world.runes[0];
const rl = game.world.findLand(rn.x, rn.y, p3.radius);
p3.x = rl.x; p3.y = rl.y;
game.spawn("wraith", p3.x + 130, p3.y - 60, { level: 4 });
sim(1, { still: true });
game.cam.x = p3.x; game.cam.y = p3.y;
game.updateCamera(0.016);
const nightCv = createCanvas(900, 520, 2);
const lightCv = createCanvas(900, 520, 2);
game.ctx = nightCv.ctx;
game.lightCanvas = { width: 1800, height: 1040, getContext: () => lightCv.ctx, __raster: lightCv.__raster };
D.Render.draw(game);
nightCv.save("tools/shots/scene-night-rune.png");

console.log("shots written:", fs.readdirSync("tools/shots").join(", "));
