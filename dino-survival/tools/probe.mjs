/* 玩法探针：验证核心生存循环真的可用 */
import { boot } from "./harness.mjs";

const { D, game } = boot();
const I = D.Input;
const U = D.util;
const report = [];
const fails = [];

function step(n, opts) {
  opts = opts || {};
  for (let i = 0; i < n; i++) {
    I.stickId = 1;
    I.axis.x = opts.ax || 0; I.axis.y = opts.ay || 0;
    I.btn.act = !!opts.act; I.btn.attack = !!opts.atk; I.btn.sprint = false;
    game.update(1 / 60);
  }
}
function check(name, cond, info) {
  report.push((cond ? "PASS " : "FAIL ") + name + (info ? "  (" + info + ")" : ""));
  if (!cond) fails.push(name);
}

/* 1. 植食：啃食植物应回饱食 */
game.newGame("trike", 20240501, null);
let p = game.player;
let plant = game.world.findPlant(p.x, p.y, 4000, 60);
let spot = game.world.findLand(plant.x + 26, plant.y, p.radius);
p.x = spot.x; p.y = spot.y; p.hunger = 40; p.thirst = 90;
let h0 = p.hunger, e0 = p.exp;
step(90, { act: true });
check("植食进食回饱食", p.hunger > h0 + 5, "hunger " + h0.toFixed(1) + " -> " + p.hunger.toFixed(1));
check("进食获得成长值", p.exp > e0, "exp " + e0.toFixed(1) + " -> " + p.exp.toFixed(1));

/* 2. 喝水 */
const wsp = game.world.findWater(p.x, p.y, 4000);
const land = game.world.findLand(wsp.x + 70, wsp.y, p.radius);
p.x = land.x; p.y = land.y; p.thirst = 20;
const act = game.resolveAct();
let t0 = p.thirst;
step(60, { act: true });
check("水边可饮水", p.thirst > t0 + 8, "act=" + (act ? act.type : "none") + " thirst " + t0.toFixed(1) + " -> " + p.thirst.toFixed(1));

/* 3. 肉食：捕猎 -> 尸体 -> 啃食 -> 升级 */
game.newGame("raptor", 20240502, null);
p = game.player;
p.hunger = 45;
const target = game.spawn("compy", p.x + 34, p.y, { level: 1 });
p.face = 0; p.dirWanted = 0;
let guard = 0;
while (!target.dead && guard++ < 400) {
  // 追上去：朝猎物移动并撕咬（模拟真实追猎）
  const ang = Math.atan2(target.y - p.y, target.x - p.x);
  p.face = ang; p.dirWanted = ang;
  I.stickId = 1; I.axis.x = Math.cos(ang); I.axis.y = Math.sin(ang);
  I.btn.attack = true; I.btn.sprint = true; I.btn.act = false;
  game.update(1 / 60);
}
check("可以咬死小型猎物", target.dead, "attempts " + guard + ", hp " + target.hp.toFixed(1));
check("尸体留下可食用的肉", target.meat > 0, "meat " + target.meat);
const beforeFood = p.hunger, beforeLv = p.level, beforeExp = p.exp;
p.x = target.x + 12; p.y = target.y;
step(120, { act: true });
check("啃食尸体回饱食", p.hunger > beforeFood + 10, "hunger " + beforeFood.toFixed(1) + " -> " + p.hunger.toFixed(1));
check("进食/击杀带来成长", p.level > beforeLv || p.exp > beforeExp + 10, "lv " + beforeLv + "->" + p.level + " exp " + beforeExp.toFixed(1) + "->" + p.exp.toFixed(1));

/* 4. 咆哮驱散弱小生物 */
const weak = game.spawn("compy", p.x + 120, p.y + 40, { level: 1 });
p.stamina = 100; p.roarT = 0;
game.doRoar();
check("咆哮让弱者逃跑", weak.fleeT > 0 && weak.state === "flee", "state " + weak.state + " fleeT " + weak.fleeT.toFixed(1));

/* 4b. 野生掠食者能咬伤玩家（NPC 攻击链路） */
game.newGame("para", 20240509, null);
p = game.player;
game.graceT = 0; p.untargetable = false;    // 关掉开局宽容期，专测战斗链路
const hunter = game.spawn("raptor", p.x + 60, p.y, { level: 4 });
hunter.state = "hunt"; hunter.target = p; hunter.hunger = 30;
const hp0 = p.hp;
step(240, { still: true });
check("野生掠食者会攻击玩家", p.hp < hp0 || p.dead, "hp " + hp0.toFixed(0) + " -> " + p.hp.toFixed(0));
check("幼年减伤生效（240 帧未被秒杀）", !p.dead, "hp " + p.hp.toFixed(0));

/* 4c. 开局宽容期：野生掠食者暂时不把玩家当猎物 */
game.newGame("raptor", 20240510, null);
p = game.player;
const stalker = game.spawn("rex", p.x + 200, p.y, { level: 6 });
stalker.hunger = 20;
step(120, { still: true });
const judged = stalker.judge(p);
check("宽容期内不被当作猎物", judged === "none" && game.graceT > 0, "judge=" + judged + " grace=" + game.graceT.toFixed(1));
game.graceT = 0; p.untargetable = false;
step(30, { still: true });
check("宽容期结束后恢复正常捕食", stalker.judge(p) === "prey", "judge=" + stalker.judge(p));

/* 5. 生态自持：60 秒后 NPC 不应大量饿死 */
game.newGame("para", 20240503, null);
const startCount = game.creatures.length;
const foodBefore = game.world.plants.reduce((a, b) => a + b.food, 0);
step(60 * 60, { still: true });
const alive = game.creatures.filter((c) => !c.dead).length;
const grazed = game.world.plants.reduce((a, b) => a + b.food, 0) < foodBefore;
const avgFood = game.creatures.filter((c) => !c.dead && !c.isPlayer).reduce((a, b) => a + b.hunger, 0) /
  Math.max(1, game.creatures.filter((c) => !c.dead && !c.isPlayer).length);
check("生态种群稳定", alive >= 12, "start " + startCount + " -> alive " + alive);
check("NPC 会吃东西（饱食均值 > 35）", avgFood > 35, "avg " + avgFood.toFixed(1));
check("植物被啃食后会消耗", grazed, "plants changed");

/* 5b. 安全区里静止 60 秒不该无故死亡（持续清除新刷出的肉食者） */
game.newGame("para", 20240505, null);
for (let s = 0; s < 60; s++) {
  game.creatures.forEach((c) => { if (!c.isPlayer && c.def.diet === "carn") c.remove = true; });
  step(60, { still: true });
}
check("无威胁时静止 60 秒仍存活", !game.player.dead,
  "hp " + game.player.hp.toFixed(0) + " food " + game.player.hunger.toFixed(0) + " water " + game.player.thirst.toFixed(0));

/* 6. 尸体会腐烂消失，不会无限堆积 */
game.newGame("rex", 20240506, null);
const corpse = game.spawn("compy", game.player.x + 300, game.player.y, { level: 1 });
corpse.die(null, game);
corpse.decay = 0.4; corpse.meat = 0.1;
step(60);
check("尸体会被回收", corpse.remove === true, "remove=" + corpse.remove);

/* 7. 性能：单帧模拟+渲染耗时 */
game.newGame("rex", 20240504, null);
const t1 = Date.now();
for (let i = 0; i < 600; i++) { I.stickId = 1; I.axis.x = 0.8; I.axis.y = 0.2; game.update(1 / 60); D.Render.draw(game); }
const ms = (Date.now() - t1) / 600;
check("逻辑+绘制调用开销可接受(<8ms/帧, node 假 canvas)", ms < 8, ms.toFixed(2) + " ms/frame, ents " + game.creatures.length);

console.log(report.join("\n"));
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nPROBE OK");
process.exit(0);
