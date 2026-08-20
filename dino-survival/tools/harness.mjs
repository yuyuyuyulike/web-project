/* 共享无头测试底座：假 DOM/Canvas + 加载真实脚本 */
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";

export function makeCtx() {
  const grad = { addColorStop() {} };
  return {
    fillStyle: "", strokeStyle: "", lineWidth: 1, lineCap: "butt", lineJoin: "miter",
    globalAlpha: 1, font: "", textAlign: "left", globalCompositeOperation: "source-over",
    setTransform() {}, resetTransform() {}, clearRect() {}, fillRect() {}, strokeRect() {},
    save() {}, restore() {}, translate() {}, scale() {}, rotate() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {},
    bezierCurveTo() {}, arc() {}, ellipse() {}, rect() {},
    fill() {}, stroke() {}, clip() {}, fillText() {}, strokeText() {},
    measureText() { return { width: 10 }; },
    createLinearGradient() { return grad; }, createRadialGradient() { return grad; },
    createPattern() { return null; }, drawImage() {}, putImageData() {},
    getImageData() { return { data: new Uint8ClampedArray(4) }; }, setLineDash() {}
  };
}

let elCount = 0;
export function makeEl(tag, id) {
  const classes = new Set();
  const listeners = {};
  const el = {
    tagName: (tag || "div").toUpperCase(),
    id: id || ("el" + (++elCount)),
    children: [], parentNode: null, style: {}, dataset: {}, attrs: {},
    textContent: "", innerHTML: "", width: 300, height: 150,
    clientWidth: 90, clientHeight: 46,
    classList: {
      add(c) { classes.add(c); }, remove(c) { classes.delete(c); },
      toggle(c) { classes.has(c) ? classes.delete(c) : classes.add(c); },
      contains(c) { return classes.has(c); }
    },
    addEventListener(t, f) { (listeners[t] || (listeners[t] = [])).push(f); },
    removeEventListener() {},
    dispatch(t, ev) { (listeners[t] || []).forEach((f) => f.call(el, ev || {})); },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; },
    querySelector(sel) { return this.children.find((c) => (sel + "").includes("canvas") ? c.tagName === "CANVAS" : true) || null; },
    querySelectorAll() { return []; },
    getContext() { return makeCtx(); },
    getBoundingClientRect() { return { left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600 }; },
    setPointerCapture() {}, releasePointerCapture() {},
    focus() {}, blur() {}, click() { this.dispatch("click", { preventDefault() {} }); }
  };
  return el;
}

export function boot(opts) {
  opts = opts || {};
  const root = opts.root || process.cwd();
  const FILES = ["util.js", "audio.js", "species.js", "magic.js", "world.js", "creature.js", "render.js", "input.js", "game.js", "main.js"];
  const store = {};
  const localStorage = {
    getItem(k) { return store[k] === undefined ? null : store[k]; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
    clear() { for (const k in store) delete store[k]; }
  };
  const idCache = new Map();
  const rafQueue = [];
  const document = {
    readyState: "complete", hidden: false, fullscreenElement: null,
    documentElement: makeEl("html"), body: makeEl("body"),
    getElementById(id) {
      if (!idCache.has(id)) {
        const tag = id === "game" || id === "minimap" ? "canvas" : (id.indexOf("btn") === 0 ? "button" : "div");
        idCache.set(id, makeEl(tag, id));
      }
      return idCache.get(id);
    },
    createElement(tag) { return makeEl(tag); },
    querySelectorAll() { return []; }, querySelector() { return null; },
    addEventListener() {}, removeEventListener() {}
  };
  const win = {
    innerWidth: opts.w || 412, innerHeight: opts.h || 892, devicePixelRatio: opts.dpr || 2.625,
    document, localStorage,
    navigator: { maxTouchPoints: 5, vibrate() { return true; }, userAgent: "node" },
    location: { protocol: "file:", href: "file:///index.html" },
    addEventListener() {}, removeEventListener() {},
    requestAnimationFrame(cb) { rafQueue.push(cb); return rafQueue.length; },
    cancelAnimationFrame() {},
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms || 0, 1)),
    clearTimeout, performance: { now: () => Date.now() },
    Math, JSON, Date, isNaN, parseInt, parseFloat, Object, Array, Map, Set,
    Uint8Array, Float32Array, Uint8ClampedArray, Error, console
  };
  win.window = win; win.self = win; win.globalThis = win;
  const sandbox = vm.createContext(win);
  for (const f of FILES) {
    const code = fs.readFileSync(path.join(root, "src", f), "utf8");
    vm.runInContext(code, sandbox, { filename: f });
  }
  return { D: win.DINO, game: win.DINO.game, win, rafQueue, store, makeCtx, idCache };
}
