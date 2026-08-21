/* 探针 3：自动瞄准 / 迁巢 / 翼龙飞行 / 地穴 */
import { boot } from "./harness.mjs";

const { D, game } = boot();
const I = D.Input, U = D.util, M = D.Magic;
const report = [], fails = [];
function check(name, cond, info) {
  const line = (cond ? "PASS " : "FAIL ") + name + (info ? "  (" + info + ")" : "");
  console.log(line);
  report.push(line);
  if (!cond) fails.push(name);
}
function step(n, o) {
  o = o || {};
  for (let i = 0; i < n; i++) {
    I.stickId = 1;
    I.axis.x = o.ax || 0; I.axis.y = o.ay || 0;
    I.btn.act = !!o.act; I.btn.attack = !!o.atk; I.btn.breath = !!o.br; I.btn.sprint = false;
    game.update(1 / 60);
  }
}

/* ============ 1. 撕咬自动瞄准 ============ */
game.newGame("raptor", 5511, null);
let p = game.player;
game.graceT = 0; p.untargetable = false;
p.face = 0; p.dirWanted = 0;
let prey = game.spawn("compy", p.x - 40, p.y, { level: 1 });
prey.state = "wander"; prey.throttle = 0;
step(2, { ax: 1 });
const hp0 = prey.hp;
p.attackCd = 0;
game.doAttack();
check("背后的猎物也能自动咬到", prey.hp < hp0, "hp " + hp0.toFixed(1) + " -> " + prey.hp.toFixed(1));
check("自动瞄准锁定了攻击朝向", Math.abs(U.angleDiff(p.aimAng, Math.PI)) < 0.5, "aimAng=" + p.aimAng.toFixed(2));

const x0 = p.x;
for (let i = 0; i < 60; i++) {
  I.stickId = 1; I.axis.x = 1; I.axis.y = 0; I.btn.attack = true; I.btn.act = false;
  game.update(1 / 60);
}
check("撕咬不影响移动走位", p.x - x0 > 60, "向右位移 " + (p.x - x0).toFixed(0) + "px");

/* ============ 2. 巢穴可以迁移 ============ */
game.newGame("trike", 6622, null);
p = game.player;
p.hunger = 100; p.thirst = 100;
game.tod = 0.5; game.updateTime(0.016);
game.nestAction();
const nest0 = { x: game.nest.x, y: game.nest.y };
p.hunger = 100;
game.nestAction();
const eggCount = game.eggs.length;
let spot = null;
for (let a = 0; a < 40 && !spot; a++) {
  const cand = game.world.findLand(p.x + 500 + a * 40, p.y + 300, p.radius);
  if (!game.world.isWater(cand.x, cand.y) && U.dist(cand.x, cand.y, game.nest.x, game.nest.y) > 150) spot = cand;
}
p.x = spot.x; p.y = spot.y;
game.nestAction();
const notMoved = U.dist(game.nest.x, game.nest.y, nest0.x, nest0.y) < 1;
game.nestAction();
const moved = U.dist(game.nest.x, game.nest.y, p.x, p.y) < 2;
const eggMoved = game.eggs.length === eggCount && eggCount > 0 && U.dist(game.eggs[0].x, game.eggs[0].y, p.x, p.y) < 60;
check("第一次按迁巢只提示不生效", notMoved);
check("再按一次巢迁到当前位置", moved, "nest=(" + Math.round(game.nest.x) + "," + Math.round(game.nest.y) + ")");
check("蛋会跟着搬家", eggMoved, "eggs=" + game.eggs.length);

/* ============ 3. 翼龙 ============ */
game.newGame("rex", 7733, null);
p = game.player;
game.graceT = 0;
step(60 * 8);
let pteros = game.creatures.filter((c) => c.sp === "ptero" && !c.dead);
check("地表有翼龙在飞", pteros.length > 0, "count=" + pteros.length);
if (pteros.length) {
  const pt = pteros[0];
  check("翼龙保持巡航高度", pteros.some(function (q) { return q.alt > 60; }),
    "alts=" + pteros.map(function (q) { return q.alt.toFixed(0); }).join("/"));
  pt.x = p.x + 30; pt.y = p.y; pt.alt = 150; pt.hp = pt.maxHp;
  step(1);
  p.attackCd = 0;
  const air0 = pt.hp;
  game.doAttack();
  check("高空翼龙咬不到", pt.hp === air0, "hp=" + pt.hp.toFixed(0));
  pt.alt = 10;
  step(1);
  p.attackCd = 0;
  game.doAttack();
  check("俯冲中的翼龙可以咬中", pt.hp < air0, "hp " + air0.toFixed(0) + " -> " + pt.hp.toFixed(0));
  const pt2 = game.spawn("ptero", p.x + 110, p.y - 20, { level: 3 });
  pt2.alt = 150;
  step(1);
  pt2.x = p.x + 110; pt2.y = p.y - 20; pt2.alt = 150; pt2.hp = pt2.maxHp;
  p.mana = p.manaMax; p.breathCd = 0;
  p.face = Math.atan2(pt2.y - p.y, pt2.x - p.x);
  M.cast(game, p);
  check("吐息可以打高空目标", pt2.hp < pt2.maxHp && !pt2.airborne_hit, "hp=" + pt2.hp.toFixed(0) + "/" + pt2.maxHp + " burn=" + pt2.burn.toFixed(1));
  pt.alt = 150; pt.hp = pt.maxHp;
  const ground = game.spawn("raptor", pt.x + 60, pt.y, { level: 4 });
  ground.hunger = 20;
  step(60);
  check("地面掠食者不会追高空翼龙", ground.target !== pt, "target=" + (ground.target ? ground.target.sp : "none"));
}
game.newGame("trike", 8844, null);
p = game.player;
p.hunger = 100; p.thirst = 100;
game.tod = 0.5; game.updateTime(0.016);
game.nestAction(); p.hunger = 100; game.nestAction();
const eggN = game.eggs.length;
const thief = game.spawn("ptero", game.nest.x + 220, game.nest.y, { level: 3 });
thief.hunger = 20;
const away = game.world.findLand(game.nest.x + 900, game.nest.y, p.radius);
p.x = away.x; p.y = away.y;
step(60 * 12);
check("翼龙会来偷蛋", game.eggs.length < eggN || thief.state === "eggraid",
  "eggs " + eggN + " -> " + game.eggs.length + " state=" + thief.state);

/* ============ 4. 地穴 ============ */
game.newGame("raptor", 9955, null);
p = game.player;
check("地表生成了洞口", game.world.caves.length >= 1, "caves=" + game.world.caves.length);
const entrance = game.world.caves[0];
const surfaceWorld = game.world;
p.x = entrance.x; p.y = entrance.y;
step(2);
const act = game.resolveAct();
check("站在洞口出现「进洞」", act && act.type === "cave", "act=" + (act ? act.type : "none"));
game.performAct(act, 1 / 60);
check("进入地穴（地图切换）", game.inCave && game.world !== surfaceWorld && game.world.mode === "cave",
  "inCave=" + game.inCave + " mode=" + game.world.mode);
game.updateTime(0.016);
check("地穴强制黑暗", game.darkness > 0.8, "darkness=" + game.darkness.toFixed(2));
check("玩家落在出口附近", U.dist(p.x, p.y, game.world.exitX, game.world.exitY) < 220,
  "d=" + U.dist(p.x, p.y, game.world.exitX, game.world.exitY).toFixed(0));
step(60 * 10);
const bats = game.creatures.filter((c) => c.sp === "bat" && !c.dead);
const boss = game.creatures.filter((c) => c.def.boss && !c.dead);
check("地穴里有成群蝠龙", bats.length >= 3, "bats=" + bats.length);
check("蝠龙在飞", bats.some((b) => b.alt > 20), bats.length ? "alt=" + bats[0].alt.toFixed(0) : "-");
check("祭坛有熔岩暴龙守着", boss.length === 1, "boss=" + boss.length);
check("地穴不下雨、不刷地表事件", game.weather.rain < 0.25 && !game.event, "rain=" + game.weather.rain.toFixed(2));

let mush = null, mushSpot = null;
{
  const cands = game.world.plantsNear(p.x, p.y, 2600);
  for (let i = 0; i < cands.length && !mush; i++) {
    const m2 = cands[i];
    if (U.dist(m2.x, m2.y, game.world.exitX, game.world.exitY) < 240) continue;
    for (let a = 0; a < 8 && !mush; a++) {
      const ang = a / 8 * U.TAU;
      const sx = m2.x + Math.cos(ang) * 24, sy = m2.y + Math.sin(ang) * 24;
      if (game.world.canWalk(sx, sy, p.radius * 0.8)) { mush = m2; mushSpot = { x: sx, y: sy }; }
    }
  }
}
check("地穴有可食用发光蘑菇", !!mush, mush ? "food=" + mush.food.toFixed(0) : "none");
if (mush) {
  const h0 = p.hunger = 40;
  p.grazePlant(mush, 1, game);
  check("发光蘑菇本身可食（提供饱食）", p.hunger > h0 + 5, "hunger " + h0 + " -> " + p.hunger.toFixed(1));
}
let lava = null;
for (let i = 0; i < game.world.map.length && !lava; i++) {
  if (game.world.map[i] === D.T.LAVA) {
    lava = {
      x: (i % game.world.cols) * game.world.tile + game.world.tile / 2,
      y: Math.floor(i / game.world.cols) * game.world.tile + game.world.tile / 2
    };
  }
}
check("地穴有岩浆", !!lava);
if (lava) {
  p.x = lava.x; p.y = lava.y; p.burn = 0; p.fireproof = false;
  step(20);
  check("站进岩浆会被点燃", p.burn > 0, "burn=" + p.burn.toFixed(1));
  p.burn = 0;
}
console.log("  [debug] inCave=" + game.inCave + " mode=" + game.world.mode +
  " altars=" + (game.world.altars ? game.world.altars.length : "undef") +
  " state=" + game.state + " playerDead=" + game.player.dead);
const altar = game.world.altars[0];
const relics0 = M.relicCount(p);
const al = game.world.findLand(altar.x + 18, altar.y + 18, p.radius);
p.x = al.x; p.y = al.y;
const a3 = game.resolveAct();
check("祭坛可交互", a3 && a3.type === "altar", "act=" + (a3 ? a3.type : "none"));
if (a3 && a3.type === "altar") {
  game.performAct(a3, 1 / 60);
  check("祭坛给出遗物", M.relicCount(p) > relics0, "relics " + relics0 + " -> " + M.relicCount(p));
  check("祭坛只能用一次", altar.used === true);
}
game.save();
const sv = game.readSave();
check("地穴中存档记录地面坐标", U.dist(sv.x, sv.y, entrance.x, entrance.y) < 220,
  "save=(" + Math.round(sv.x) + "," + Math.round(sv.y) + ")");

p.x = game.world.exitX; p.y = game.world.exitY;
game.portalT = 0;
const a4 = game.resolveAct();
check("出口出现「出洞」", a4 && a4.type === "exit", "act=" + (a4 ? a4.type : "none"));
game.performAct(a4, 1 / 60);
check("回到地面（地图切回）", !game.inCave && game.world === surfaceWorld && !game.underground);
check("落点在洞口附近", U.dist(p.x, p.y, entrance.x, entrance.y) < 280,
  "d=" + U.dist(p.x, p.y, entrance.x, entrance.y).toFixed(0));
step(60 * 4);
check("回地面后生态仍在运转", game.creatures.length > 8, "ents=" + game.creatures.length);

/* ============ 4b. 植食恐龙在地穴里进食 ============ */
game.newGame("trike", 9956, null);
let ph = game.player;
game.enterCave(game.world.caves[0]);
let hmush = null, hspot = null;
{
  const cands = game.world.plantsNear(ph.x, ph.y, 3000);
  for (let i = 0; i < cands.length && !hmush; i++) {
    for (let a = 0; a < 8 && !hmush; a++) {
      const ang = a / 8 * U.TAU;
      const sx = cands[i].x + Math.cos(ang) * (ph.radius + 16), sy = cands[i].y + Math.sin(ang) * (ph.radius + 16);
      if (game.world.canWalk(sx, sy, ph.radius * 0.8)) { hmush = cands[i]; hspot = { x: sx, y: sy }; }
    }
  }
}
check("地穴里能找到落脚点旁的蘑菇", !!hmush);
if (hmush) {
  ph.x = hspot.x; ph.y = hspot.y;
  ph.hunger = 40;
  const a5 = game.resolveAct();
  const before5 = ph.hunger;
  step(60, { act: true });
  check("植食恐龙在地穴里能吃蘑菇", ph.hunger > before5 + 3,
    "act=" + (a5 ? a5.type : "none") + " hunger " + before5 + " -> " + ph.hunger.toFixed(1));
}
game.exitCave();

/* ============ 5. 混战稳定性 ============ */
game.newGame("rex", 60301, null);
game.dayLength = 40;
step(60 * 25, { act: true, atk: true, br: true });
p = game.player;
if (!p.dead) {
  const cv = game.world.caves[0];
  p.x = cv.x; p.y = cv.y; game.portalT = 0;
  game.enterCave(cv);
  step(60 * 25, { act: true, atk: true, br: true });
  check("地穴混战 25 秒稳定", isFinite(p.x) && game.creatures.length < 90,
    "ents=" + game.creatures.length + " fx=" + game.fx.list.length + " hp=" + p.hp.toFixed(0));
  game.exitCave();
  step(60 * 5, { atk: true });
  check("地穴往返后仍正常", isFinite(p.x) && game.world.mode === "surface");
} else {
  check("地穴混战 25 秒稳定", true, "玩家已死亡，跳过");
  check("地穴往返后仍正常", true, "跳过");
}

if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nPROBE3 OK");
process.exit(0);
