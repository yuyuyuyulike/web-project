/* 纯 JS 软件光栅化 Canvas2D 子集 + PNG 编码：用于无浏览器的视觉检查 */
import zlib from "node:zlib";
import fs from "node:fs";

/* ---------- 颜色 ---------- */
function parseColor(s) {
  if (!s) return [0, 0, 0, 1];
  if (typeof s === "object") return null; // gradient
  s = String(s).trim();
  if (s[0] === "#") {
    let h = s.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(",").map((v) => parseFloat(v));
    return [p[0] | 0, p[1] | 0, p[2] | 0, p.length > 3 ? p[3] : 1];
  }
  const named = { white: [255, 255, 255, 1], black: [0, 0, 0, 1], red: [255, 0, 0, 1] };
  return named[s] || [255, 0, 255, 1];
}

/* ---------- 矩阵 ---------- */
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

/* ---------- 主体 ---------- */
export function createCanvas(w, h, ss) {
  ss = ss || 2;
  const W = Math.round(w * ss), H = Math.round(h * ss);
  const fb = new Float32Array(W * H * 4); // premultiplied-ish straight RGBA 0..255 / a 0..1

  const base = [ss, 0, 0, ss, 0, 0];
  let st = { m: base.slice(), fill: "#000", stroke: "#000", lw: 1, alpha: 1, cap: "butt", join: "miter", gco: "source-over" };
  const stack = [];
  let subs = [];   // 当前路径：[{pts:[[x,y]...], closed:bool}]
  let cur = null;

  function px(x, y, col, a) {
    if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
    const i = (y * W + x) * 4;
    if (st.gco === "destination-out") { fb[i + 3] = fb[i + 3] * (1 - a); return; }
    const sa = a;
    const da = fb[i + 3];
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    fb[i] = (col[0] * sa + fb[i] * da * (1 - sa)) / oa;
    fb[i + 1] = (col[1] * sa + fb[i + 1] * da * (1 - sa)) / oa;
    fb[i + 2] = (col[2] * sa + fb[i + 2] * da * (1 - sa)) / oa;
    fb[i + 3] = oa;
  }

  function shader(style, alpha) {
    if (style && typeof style === "object" && style.__grad) {
      const g = style;
      const stops = g.stops.slice().sort((a, b) => a.o - b.o);
      if (!stops.length) return () => [255, 0, 255, alpha];
      return (x, y) => {
        let t;
        if (g.type === "linear") {
          const dx = g.x1 - g.x0, dy = g.y1 - g.y0;
          const len2 = dx * dx + dy * dy || 1;
          t = ((x - g.x0) * dx + (y - g.y0) * dy) / len2;
        } else {
          const dx = x - g.x1, dy = y - g.y1;
          t = Math.sqrt(dx * dx + dy * dy) / (g.r1 || 1);
        }
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        let a = stops[0], b = stops[stops.length - 1];
        for (let i = 0; i < stops.length - 1; i++) {
          if (t >= stops[i].o && t <= stops[i + 1].o) { a = stops[i]; b = stops[i + 1]; break; }
        }
        const span = (b.o - a.o) || 1;
        const k = (t - a.o) / span;
        const ca = a.c, cb = b.c;
        return [
          ca[0] + (cb[0] - ca[0]) * k,
          ca[1] + (cb[1] - ca[1]) * k,
          ca[2] + (cb[2] - ca[2]) * k,
          (ca[3] + (cb[3] - ca[3]) * k) * alpha
        ];
      };
    }
    const c = parseColor(style);
    return () => [c[0], c[1], c[2], c[3] * alpha];
  }

  // 非零环绕扫描线填充
  function fillPolys(polys, style, alpha) {
    const sh = shader(style, alpha);
    const edges = [];
    let minY = 1e9, maxY = -1e9;
    for (const p of polys) {
      const pts = p;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if (a[1] === b[1]) continue;
        edges.push([a[0], a[1], b[0], b[1]]);
        minY = Math.min(minY, a[1], b[1]);
        maxY = Math.max(maxY, a[1], b[1]);
      }
    }
    if (!edges.length) return;
    const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(H - 1, Math.ceil(maxY));
    const xs = [];
    for (let y = y0; y <= y1; y++) {
      const sy = y + 0.5;
      xs.length = 0;
      for (const e of edges) {
        const [ax, ay, bx, by] = e;
        if ((sy >= ay && sy < by) || (sy >= by && sy < ay)) {
          const t = (sy - ay) / (by - ay);
          xs.push([ax + (bx - ax) * t, by > ay ? 1 : -1]);
        }
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a[0] - b[0]);
      let wind = 0;
      for (let i = 0; i < xs.length - 1; i++) {
        wind += xs[i][1];
        if (wind === 0) continue;
        const sx = Math.max(0, Math.ceil(xs[i][0] - 0.5));
        const ex = Math.min(W - 1, Math.floor(xs[i + 1][0] - 0.5));
        for (let x = sx; x <= ex; x++) {
          const c = sh(x + 0.5, sy);
          px(x, y, c, c[3]);
        }
      }
    }
  }

  function circlePoly(cx, cy, r, n) {
    const pts = [];
    n = n || Math.max(8, Math.min(40, Math.round(r * 1.6)));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return pts;
  }

  function strokePath(style, alpha) {
    const wpx = Math.max(0.7, st.lw * scaleOf(st.m));
    const hw = wpx / 2;
    for (const sp of subs) {
      const pts = sp.pts;
      if (pts.length < 2) {
        if (pts.length === 1 && st.cap === "round") fillPolys([circlePoly(pts[0][0], pts[0][1], hw)], style, alpha);
        continue;
      }
      const seq = sp.closed ? pts.concat([pts[0]]) : pts;
      for (let i = 0; i < seq.length - 1; i++) {
        const a = seq[i], b = seq[i + 1];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const l = Math.hypot(dx, dy);
        if (l < 1e-6) continue;
        const nx = -dy / l * hw, ny = dx / l * hw;
        fillPolys([[[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]]], style, alpha);
        if (i > 0 || st.cap === "round") fillPolys([circlePoly(a[0], a[1], hw)], style, alpha);
      }
      if (st.cap === "round") {
        const last = seq[seq.length - 1];
        fillPolys([circlePoly(last[0], last[1], hw)], style, alpha);
      }
    }
  }

  function ensure() { if (!cur) { cur = { pts: [], closed: false }; subs.push(cur); } return cur; }
  function pt(x, y) { const p = apply(st.m, x, y); ensure().pts.push(p); }

  const ctx = {
    canvas: { width: W, height: H },
    get fillStyle() { return st.fill; }, set fillStyle(v) { st.fill = v; },
    get strokeStyle() { return st.stroke; }, set strokeStyle(v) { st.stroke = v; },
    get lineWidth() { return st.lw; }, set lineWidth(v) { st.lw = v; },
    get globalAlpha() { return st.alpha; }, set globalAlpha(v) { st.alpha = v; },
    get lineCap() { return st.cap; }, set lineCap(v) { st.cap = v; },
    get lineJoin() { return st.join; }, set lineJoin(v) { st.join = v; },
    font: "", textAlign: "left",
    get globalCompositeOperation() { return st.gco; }, set globalCompositeOperation(v) { st.gco = v; },
    save() { stack.push({ m: st.m.slice(), fill: st.fill, stroke: st.stroke, lw: st.lw, alpha: st.alpha, cap: st.cap, join: st.join, gco: st.gco }); },
    restore() { const s = stack.pop(); if (s) st = s; },
    setTransform(a, b, c, d, e, f) { st.m = [a * ss, b * ss, c * ss, d * ss, e * ss, f * ss]; },
    resetTransform() { st.m = base.slice(); },
    transform(a, b, c, d, e, f) { st.m = mul(st.m, [a, b, c, d, e, f]); },
    translate(x, y) { st.m = mul(st.m, [1, 0, 0, 1, x, y]); },
    scale(x, y) { st.m = mul(st.m, [x, 0, 0, y, 0, 0]); },
    rotate(r) { const c = Math.cos(r), s2 = Math.sin(r); st.m = mul(st.m, [c, s2, -s2, c, 0, 0]); },
    beginPath() { subs = []; cur = null; },
    closePath() { if (cur) cur.closed = true; },
    moveTo(x, y) { cur = { pts: [], closed: false }; subs.push(cur); pt(x, y); },
    lineTo(x, y) { pt(x, y); },
    quadraticCurveTo(cx, cy, x, y) {
      const p0 = ensure().pts[ensure().pts.length - 1] || apply(st.m, cx, cy);
      const c1 = apply(st.m, cx, cy), p1 = apply(st.m, x, y);
      for (let i = 1; i <= 14; i++) {
        const t = i / 14, u = 1 - t;
        ensure().pts.push([u * u * p0[0] + 2 * u * t * c1[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c1[1] + t * t * p1[1]]);
      }
    },
    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
      const p0 = ensure().pts[ensure().pts.length - 1] || apply(st.m, c1x, c1y);
      const a = apply(st.m, c1x, c1y), b = apply(st.m, c2x, c2y), p1 = apply(st.m, x, y);
      for (let i = 1; i <= 18; i++) {
        const t = i / 18, u = 1 - t;
        ensure().pts.push([
          u * u * u * p0[0] + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t * t * t * p1[0],
          u * u * u * p0[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t * t * t * p1[1]
        ]);
      }
    },
    arc(x, y, r, a0, a1, ccw) {
      let span = a1 - a0;
      if (!ccw && span < 0) span += Math.PI * 2;
      if (ccw && span > 0) span -= Math.PI * 2;
      const n = Math.max(6, Math.ceil(Math.abs(span) * 14));
      for (let i = 0; i <= n; i++) {
        const a = a0 + span * (i / n);
        pt(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
    },
    ellipse(x, y, rx, ry, rot, a0, a1, ccw) {
      let span = a1 - a0;
      if (!ccw && span < 0) span += Math.PI * 2;
      if (ccw && span > 0) span -= Math.PI * 2;
      const n = Math.max(10, Math.ceil(Math.abs(span) * 16));
      const cr = Math.cos(rot || 0), sr = Math.sin(rot || 0);
      for (let i = 0; i <= n; i++) {
        const a = a0 + span * (i / n);
        const ex = Math.cos(a) * rx, ey = Math.sin(a) * ry;
        pt(x + ex * cr - ey * sr, y + ex * sr + ey * cr);
      }
    },
    rect(x, y, w2, h2) { ctx.moveTo(x, y); ctx.lineTo(x + w2, y); ctx.lineTo(x + w2, y + h2); ctx.lineTo(x, y + h2); ctx.closePath(); },
    fill() { fillPolys(subs.map((s) => s.pts).filter((p) => p.length > 2), st.fill, st.alpha); },
    stroke() { strokePath(st.stroke, st.alpha); },
    clip() {},
    fillRect(x, y, w2, h2) {
      const p = [apply(st.m, x, y), apply(st.m, x + w2, y), apply(st.m, x + w2, y + h2), apply(st.m, x, y + h2)];
      fillPolys([p], st.fill, st.alpha);
    },
    strokeRect() {},
    clearRect(x, y, w2, h2) {
      const p0 = apply(st.m, x, y), p1 = apply(st.m, x + w2, y + h2);
      const xa = Math.max(0, Math.floor(Math.min(p0[0], p1[0]))), xb = Math.min(W - 1, Math.ceil(Math.max(p0[0], p1[0])));
      const ya = Math.max(0, Math.floor(Math.min(p0[1], p1[1]))), yb = Math.min(H - 1, Math.ceil(Math.max(p0[1], p1[1])));
      for (let yy = ya; yy <= yb; yy++) for (let xx = xa; xx <= xb; xx++) {
        const i = (yy * W + xx) * 4;
        fb[i] = fb[i + 1] = fb[i + 2] = fb[i + 3] = 0;
      }
    },
    fillText() {}, strokeText() {}, measureText() { return { width: 10 }; },
    setLineDash() {},
    __raster: null,
    createLinearGradient(x0, y0, x1, y1) {
      const a = apply(st.m, x0, y0), b = apply(st.m, x1, y1);
      const g = { __grad: 1, type: "linear", x0: a[0], y0: a[1], x1: b[0], y1: b[1], stops: [] };
      g.addColorStop = (o, c) => { g.stops.push({ o: o, c: parseColor(c) }); };
      return g;
    },
    createRadialGradient(x0, y0, r0, x1, y1, r1) {
      const b = apply(st.m, x1, y1);
      const g = { __grad: 1, type: "radial", x1: b[0], y1: b[1], r1: r1 * scaleOf(st.m), stops: [] };
      g.addColorStop = (o, c) => { g.stops.push({ o: o, c: parseColor(c) }); };
      return g;
    },
    createPattern() { return null; },
    drawImage(src) {
      const r = src && (src.__raster || (src.canvas && src.canvas.__raster));
      if (!r) return;
      const n = Math.min(fb.length, r.fb.length);
      for (let i = 0; i < n; i += 4) {
        const sa = r.fb[i + 3];
        if (sa <= 0) continue;
        const y = Math.floor((i / 4) / W), x = (i / 4) % W;
        px(x, y, [r.fb[i], r.fb[i + 1], r.fb[i + 2]], sa);
      }
    },
    putImageData() {},
    getImageData() { return { data: new Uint8ClampedArray(4) }; }
  };

  function toRGBA() {
    const out = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let dy = 0; dy < ss; dy++) {
          for (let dx = 0; dx < ss; dx++) {
            const i = ((y * ss + dy) * W + (x * ss + dx)) * 4;
            r += fb[i]; g += fb[i + 1]; b += fb[i + 2]; a += fb[i + 3];
          }
        }
        const n = ss * ss, o = (y * w + x) * 4;
        out[o] = Math.min(255, r / n); out[o + 1] = Math.min(255, g / n);
        out[o + 2] = Math.min(255, b / n); out[o + 3] = Math.min(255, (a / n) * 255);
      }
    }
    return out;
  }

  const rasterInfo = { fb: fb, W: W, H: H, ss: ss };
  ctx.__raster = rasterInfo;
  ctx.canvas.__raster = rasterInfo;
  return { ctx: ctx, width: w, height: h, __raster: rasterInfo, toRGBA: toRGBA, save: (p) => writePNG(p, w, h, toRGBA()) };
}

/* ---------- PNG ---------- */
let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
export function writePNG(file, w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
  fs.writeFileSync(file, png);
  return file;
}
