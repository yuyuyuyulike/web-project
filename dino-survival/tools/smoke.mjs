/* 无头冒烟测试：跑真实游戏逻辑与渲染代码 */
import { boot, makeCtx } from "./harness.mjs";

const { D, game, rafQueue } = boot();
const errors = [];
function run(label, fn) {
  try { fn(); return true; }
  catch (e) { errors.push(label + ": " + (e && e.stack ? e.stack.split("\n").slice(0, 4).join(" | ") : e)); return false; }
}

console.log("modules:", Object.keys(D).join(","));
if (!game) { console.log("FATAL: boot did not create DINO.game"); process.exit(1); }

run("raf-drain", () => { for (let i = 0; i < 6 && rafQueue.length; i++) rafQueue.shift()(16 * (i + 1)); });
run("preview", () => { const c = makeCtx(); for (const k of D.PLAYABLE) D.Render.preview(c, k, 90, 46, 1.2); });

const I = D.Input;
let frames = 0;
function simulate(seconds, opts) {
  opts = opts || {};
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) {
    I.stickId = 1;
    const t = (frames + i) * 0.016;
    I.axis.x = Math.cos(t * 0.7) * (opts.still ? 0 : 0.9);
    I.axis.y = Math.sin(t * 0.53) * (opts.still ? 0 : 0.9);
    I.btn.attack = !opts.still && (i % 37 < 6);
    I.btn.sprint = !opts.still && (i % 90 < 25);
    I.btn.act = true;
    if (i % 240 === 0) I.press("roar");
    game.update(1 / 60);
    D.Render.draw(game);
  }
  frames += n;
}

const results = [];
for (const sp of D.PLAYABLE) {
  if (!run("newGame(" + sp + ")", () => game.newGame(sp, 424242 + sp.length, null))) continue;
  game.dayLength = 26;
  run("sim(" + sp + ")", () => simulate(22));
  const p = game.player;
  results.push(sp + " lv" + p.level + " hp" + Math.round(p.hp) + " food" + Math.round(p.hunger) +
    " day" + game.day + " ents" + game.creatures.length + " pos(" + Math.round(p.x) + "," + Math.round(p.y) + ")");
  if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.hp)) errors.push(sp + ": NaN in player state");
}

run("events", () => {
  game.day = 6;
  for (const ev of ["meteor", "bloodmoon", "stampede", "migration"]) {
    game.event = null; game.nextEventT = 0; game.tod = 0.9; game.updateTime(0.016);
    game.event = ev; game.eventT = 6; game.meteorT = 0.1;
    if (ev === "bloodmoon") game.predBuff = 1.4;
    simulate(7);
    game.endEvent();
  }
});
run("storm+fog", () => {
  game.weather.type = "storm"; game.weather.tr = 1; game.weather.tf = 0.2; game.weather.strikeT = 0.1;
  simulate(6);
  game.weather.type = "fog"; game.weather.tf = 0.9; game.weather.tr = 0;
  simulate(3);
});
run("nest+egg+sleep", () => {
  const p = game.player;
  p.hunger = 100; p.thirst = 100;
  game.tod = 0.5; game.updateTime(0.016);
  game.nestAction();
  if (!game.nest) throw new Error("nest not built");
  p.hunger = 100;
  game.nestAction();
  if (!game.eggs.length) throw new Error("egg not laid");
  game.eggs.forEach((e) => { e.t = 0.05; });
  simulate(1.2, { still: true });
  if (!game.allies.length) throw new Error("egg did not hatch");
  game.creatures = game.creatures.filter((c) => c.isPlayer || c.ally || c.def.diet === "herb");
  game.tod = 0.9; game.updateTime(0.016);
  p.x = game.nest.x; p.y = game.nest.y;
  game.nestAction();
  if (!game.sleeping) throw new Error("sleep did not start");
  simulate(6, { still: true });
});
run("save/load", () => {
  game.save();
  const s = game.readSave();
  if (!s) throw new Error("no save written");
  game.newGame(s.sp, s.seed, s);
  if (game.player.level !== s.level) throw new Error("level not restored");
  simulate(4);
});
run("pause/hud/quality", () => {
  game.pauseGame(); game.resumeGame();
  game.updateHud(true); game.drawMinimap(); game.applyTouchVisibility();
  game.settings.zoom = "far"; game.resize();
  game.settings.quality = "low"; game.quality = 0; game.resize();
  simulate(3);
});
run("death", () => {
  game.player.damage(999999, null, game);
  if (game.state !== "over") throw new Error("gameOver not reached, state=" + game.state);
  D.Render.draw(game);
});
run("restart-after-death", () => { game.newGame("trike", 999, null); simulate(4); });

console.log("--- results ---");
results.forEach((r) => console.log("  " + r));
console.log("frames simulated:", frames);
if (errors.length) {
  console.log("ERRORS (" + errors.length + "):");
  errors.forEach((e) => console.log("  " + e));
  process.exit(1);
}
console.log("SMOKE OK");
process.exit(0);
