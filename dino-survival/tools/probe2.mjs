/* 探针 2：卡位修复 + 吐息 + 人类部落 + 魔法 */
import { boot } from "./harness.mjs";

const { D, game } = boot();
const I = D.Input;
const U = D.util;
const M = D.Magic;
const report = [];
const fails = [];
function check(name, cond, info) {
  report.push((cond ? "PASS " : "FAIL ") + name + (info ? "  (" + info + ")" : ""));
  if (!cond) fails.push(name);
}
function step(n, opts) {
  opts = opts || {};
  for (let i = 0; i < n; i++) {
    I.stickId = 1;
    I.axis.x = opts.ax || 0; I.axis.y = opts.ay || 0;
    I.btn.act = !!opts.act; I.btn.attack = !!opts.atk; I.btn.sprint = false; I.btn.breath = !!opts.br;
    game.update(1 / 60);
  }
}

/* ================= 1. 卡位（用户反馈的 bug） ================= */
game.newGame("raptor", 31415, null);
let w = game.world;
let p = game.player;

// 1a. 直接把生物塞进石头里，应当自己滑出来
let rockPos = null;
for (let i = 0; i < w.map.length && !rockPos; i++) {
  if (w.map[i] === D.T.ROCK) {
    const cx = (i % w.cols) * w.tile + w.tile / 2, cy = Math.floor(i / w.cols) * w.tile + w.tile / 2;
    if (w.findLand(cx, cy, 24)) rockPos = { x: cx, y: cy };
  }
}
const victim = game.spawn("compy", p.x + 300, p.y, { level: 1 });
victim.x = rockPos.x; victim.y = rockPos.y;
const stuckBefore = !w.canWalk(victim.x, victim.y, victim.radius * 0.78);
step(6);
check("被塞进石头里能自救脱出", stuckBefore && w.canWalk(victim.x, victim.y, victim.radius * 0.78),
  "before stuck=" + stuckBefore + " after ok=" + w.canWalk(victim.x, victim.y, victim.radius * 0.78));

// 1b. 复现"墙角吃尸体升级后被卡死"
const rSmall = D.SPECIES.raptor.size * D.stageScale(1) * 0.78;
const rBig = D.SPECIES.raptor.size * D.stageScale(10) * 0.78;
let tight = null;
outer:
for (let i = 0; i < w.map.length; i++) {
  if (w.map[i] !== D.T.ROCK && w.map[i] !== D.T.DEEP) continue;
  const tx = i % w.cols, ty = Math.floor(i / w.cols);
  const bx = tx * w.tile + w.tile / 2, by = ty * w.tile + w.tile / 2;
  const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  for (let k = 0; k < 4; k++) {
    for (let off = 6; off <= 26; off += 2) {
      const x = bx + dirs[k][0] * (w.tile / 2 + off);
      const y = by + dirs[k][1] * (w.tile / 2 + off);
      if (w.canWalk(x, y, rSmall) && !w.canWalk(x, y, rBig)) { tight = { x: x, y: y }; break outer; }
    }
  }
}
if (tight) {
  p.x = tight.x; p.y = tight.y;
  p.level = 10; p.applyLevel(true);              // 长大 -> 原地变非法
  const trappedBefore = !w.canWalk(p.x, p.y, p.radius * 0.78);
  const x0 = p.x, y0 = p.y;
  step(90, { ax: 0.9, ay: 0.4 });
  const moved = U.dist(x0, y0, p.x, p.y);
  check("墙角升级变大后不会被永久卡死", trappedBefore && moved > 40,
    "trapped=" + trappedBefore + " moved=" + moved.toFixed(1) + "px");
} else check("墙角升级变大后不会被永久卡死", false, "没找到狭窄地形用于复现");

// 1c. 尸体在够不到的地方时，食腐者会放弃而不是顶着墙推
game.newGame("trike", 2718, null);
w = game.world; p = game.player;
let deep = null;
for (let i = 0; i < w.map.length && !deep; i++) {
  if (w.map[i] === D.T.DEEP) {
    const cx = (i % w.cols) * w.tile + w.tile / 2, cy = Math.floor(i / w.cols) * w.tile + w.tile / 2;
    const land = w.findLand(cx, cy, 22);
    if (land && U.dist(land.x, land.y, cx, cy) > 40) deep = { x: cx, y: cy, land };
  }
}
const corpse = game.spawn("compy", deep.land.x, deep.land.y, { level: 1 });
corpse.x = deep.x; corpse.y = deep.y;
corpse.die(null, game);
const scav = game.spawn("raptor", deep.land.x, deep.land.y, { level: 3 });
scav.hunger = 30;
step(60 * 7);
check("够不到的尸体会被放弃", scav.state !== "scavenge" || scav.speedNow > 5,
  "state=" + scav.state + " stuckT=" + scav.stuckT.toFixed(2));

/* ================= 2. 元素吐息 ================= */
const breathExpect = { raptor: "bolt", para: "frost", trike: "quake", rex: "fire" };
for (const sp of D.PLAYABLE) {
  game.newGame(sp, 8080 + sp.length, null);
  p = game.player;
  p.mana = p.manaMax; p.breathCd = 0;
  const t = game.spawn("stego", p.x + 80, p.y, { level: 4 });
  step(1);
  p.face = Math.atan2(t.y - p.y, t.x - p.x);
  const hp0 = t.hp, mana0 = p.mana;
  const okCast = M.cast(game, p);
  const B = M.BREATHS[breathExpect[sp]];
  const eff = B.key === "fire" ? (t.burn > 0) : B.key === "frost" ? (t.chill > 0) : (t.stun > 0);
  check("吐息 " + B.name + " 命中并生效", okCast && t.hp < hp0 && eff && p.mana < mana0,
    "dmg=" + (hp0 - t.hp).toFixed(1) + " burn=" + t.burn.toFixed(1) + " chill=" + t.chill.toFixed(1) +
    " stun=" + t.stun.toFixed(2) + " mana=" + p.mana.toFixed(0));
  check("吐息进入冷却", p.breathCd > 0, "cd=" + p.breathCd.toFixed(2));
  if (B.key === "fire") check("烈焰会点燃地面", game.fires.length > 0, "fires=" + game.fires.length);
  if (B.key === "quake") check("大地震荡会击退", Math.abs(t.kx) + Math.abs(t.ky) > 50, "knock=" + Math.abs(t.kx).toFixed(0));
}
// 霜息灭火
game.newGame("para", 606, null);
p = game.player;
p.mana = p.manaMax; p.breathCd = 0;
game.fires.push({ x: p.x + 90, y: p.y, r: 50, t: 6, dmgT: 0 });
p.face = 0;
M.cast(game, p);
check("霜冻吐息能灭火", game.fires.length === 0, "fires=" + game.fires.length);
// 燃烧会持续掉血
game.newGame("rex", 707, null);
p = game.player;
const burnTarget = game.spawn("stego", p.x + 60, p.y, { level: 4 });
M.applyBurn(burnTarget, 4, 10, game);
const bhp = burnTarget.hp;
step(120);
check("燃烧状态持续造成伤害", burnTarget.hp < bhp - 8, "hp " + bhp.toFixed(0) + " -> " + burnTarget.hp.toFixed(0));

/* ================= 3. 人类部落 ================= */
game.newGame("rex", 90210, null);
w = game.world; p = game.player;
check("世界生成 3 座部落营地", w.villages.length === 3, "villages=" + w.villages.length);
check("营地有帐篷与篝火", w.props.filter((x) => x.kind === "tent").length >= 6 && w.props.filter((x) => x.kind === "campfire").length === 3,
  "tents=" + w.props.filter((x) => x.kind === "tent").length);
check("魔力水晶与符文圈就位", w.crystals.length >= 8 && w.runes.length >= 3,
  "crystals=" + w.crystals.length + " runes=" + w.runes.length);
check("营地范围内没有树", w.props.filter((x) => x.kind === "tree" && w.inVillage(x.x, x.y, 0)).length === 0);

const v = w.villages[0];
const near = w.findLand(v.x + 260, v.y, p.radius);
p.x = near.x; p.y = near.y;
game.graceT = 0; p.untargetable = false;
step(60 * 14);
const humans = game.creatures.filter((c) => c.def.kind === "human" && !c.dead);
const totem = game.creatures.filter((c) => c.def.kind === "struct" && !c.dead);
check("营地会派出部落成员", humans.length >= 2, "humans=" + humans.length);
check("营地中央有图腾柱", totem.length >= 1, "totems=" + totem.length);
check("人类会向恐龙投射长矛", game.stats && (game.projectiles.length > 0 || game.player.hp < game.player.maxHp),
  "proj=" + game.projectiles.length + " hp=" + p.hp.toFixed(0) + "/" + p.maxHp);

// 长矛真的能打中玩家
game.projectiles.length = 0;
const hunter = game.spawn("hunter", p.x + 150, p.y, { level: 4 });
hunter.state = "hunt"; hunter.target = p; hunter.rangedCd = 0;
const php = p.hp;
step(240);
check("长矛能命中并造成伤害", p.hp < php, "hp " + php.toFixed(0) + " -> " + p.hp.toFixed(0));

// 图腾被摧毁 -> 遗物 + 酋长
const tt = totem[0];
const relicsBefore = M.relicCount(p);
tt.damage(99999, p, game);
const vRuined = tt.village ? tt.village.ruined : false;
check("摧毁图腾会让营地停止派兵", vRuined === true, "ruined=" + vRuined);
check("摧毁图腾掉落遗物", M.relicCount(p) > relicsBefore, "relics " + relicsBefore + " -> " + M.relicCount(p));
check("图腾被毁后酋长现身", game.creatures.some((c) => c.sp === "chief" && !c.dead));

// 人类是第三方阵营：会攻击野生恐龙
game.newGame("trike", 4321, null);
p = game.player;
game.graceT = 0;
const wildC = game.spawn("compy", p.x + 500, p.y, { level: 2 });
const h2 = game.spawn("hunter", p.x + 560, p.y, { level: 4 });
h2.rangedCd = 0;
const wildHp = wildC.hp;
step(300);
check("人类会围猎野生恐龙（第三方阵营）", wildC.hp < wildHp || wildC.dead,
  "compy hp " + wildHp.toFixed(0) + " -> " + wildC.hp.toFixed(0));

/* ================= 4. 魔法：水晶 / 符文 / 遗物 ================= */
game.newGame("raptor", 5150, null);
w = game.world; p = game.player;
const cr = w.crystals[0];
const cland = w.findLand(cr.x + 40, cr.y + 20, p.radius);
p.x = cland.x; p.y = cland.y;
const regenNear = M.manaRegen(game, p);
p.x = 200; p.y = 200;
const regenFar = M.manaRegen(game, p);
check("水晶旁魔力回复大幅提升", regenNear > regenFar * 3, "near=" + regenNear.toFixed(1) + " far=" + regenFar.toFixed(1));

const rune = w.runes[0];
const rland = w.findLand(rune.x, rune.y, p.radius);
p.x = rland.x; p.y = rland.y;
const act = game.resolveAct();
check("站在符文圈里可以祈祷", act && act.type === "rune", "act=" + (act ? act.type : "none"));
game.performAct(act, 1 / 60);
check("祈祷获得祝福并进入冷却", !!p.bless && rune.cd > 0, "bless=" + (p.bless ? p.bless.name : "none") + " cd=" + rune.cd);

p.relics = {};
p.applyLevel(true);
const hpNoRelic = p.maxHp, dmgMul0 = game.playerDamageMul();
p.relics = { dragonsoul: 1, stoneskin: 1 };
p.applyLevel(true);
check("遗物·龙魂 提升最大生命与魔力上限", p.maxHp > hpNoRelic * 1.2 && p.manaMax > 100,
  "hp " + hpNoRelic + " -> " + p.maxHp + " manaMax=" + p.manaMax);
check("遗物·石肤 降低受伤", game.playerDamageMul() < dmgMul0 * 0.85,
  dmgMul0.toFixed(2) + " -> " + game.playerDamageMul().toFixed(2));

/* ================= 5. 幽影龙 / 龙王 ================= */
game.newGame("rex", 1024, null);
p = game.player;
game.tod = 0.95; game.updateTime(0.016);
game.popT = 0;
step(240);
const wraiths = game.creatures.filter((c) => c.sp === "wraith" && !c.dead);
check("夜里会出现幽影龙", wraiths.length > 0, "wraiths=" + wraiths.length + " night=" + game.night.toFixed(2));
if (wraiths.length) {
  const wr = wraiths[0];
  wr.target = p; wr.state = "hunt"; wr.blinkCd = 0;
  wr.x = p.x + 300; wr.y = p.y + 300;
  const wx = wr.x, wy = wr.y;
  step(4);
  check("幽影龙会瞬移", U.dist(wx, wy, wr.x, wr.y) > 100, "moved " + U.dist(wx, wy, wr.x, wr.y).toFixed(0) + "px");
}

game.day = 6;
game.event = null; game.nextEventT = 0;
game.startEvent();
let tries = 0;
while (game.event !== "dragonlord" && tries++ < 40) { game.endEvent(); game.nextEventT = 0; game.startEvent(); }
const boss = game.creatures.filter((c) => c.def.boss && !c.dead);
check("可触发龙王降临事件", game.event === "dragonlord" && boss.length === 1, "event=" + game.event + " boss=" + boss.length);
if (boss.length) {
  const b = boss[0];
  b.target = p; b.state = "hunt";
  const firesBefore = game.fires.length;
  step(180);
  check("熔岩暴龙留下火痕", game.fires.length > firesBefore, "fires " + firesBefore + " -> " + game.fires.length);
  const relics0 = M.relicCount(p);
  b.damage(999999, p, game);
  check("击杀龙王掉落遗物与成就", M.relicCount(p) > relics0 || game.ach.dragonlord === 1,
    "relics " + relics0 + " -> " + M.relicCount(p) + " ach=" + !!game.ach.dragonlord);
}

/* ================= 6. 稳定性 ================= */
game.newGame("rex", 777001, null);
game.dayLength = 40;
step(60 * 60, { act: true, atk: true, br: true });
check("混战 60 秒不崩、实体数受控", game.creatures.length < 120 && !isNaN(game.player.x),
  "ents=" + game.creatures.length + " proj=" + game.projectiles.length + " fx=" + game.fx.list.length);

console.log(report.join("\n"));
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nPROBE2 OK");
process.exit(0);
