// 행성 그리기: 종류별로 경도·위도 텍스처(64x32)를 한 번 만들어 두고,
// 매 프레임 구 위의 각 픽셀을 텍스처에서 읽어 자전시키며 빛·그림자를 픽셀 단계로 입힌다.

import { tileFbm, Rng, hex, mix, scale, clamp, TAU, WHITE } from "../vendor/pixelfx/core/index.js";

const TW = 64, TH = 32;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);
const LX = -0.55, LY = -0.62, LZ = 0.56; // 왼쪽 위에서 오는 빛

const ramp = (a) => a.map(hex);
// 종류별 팔레트 후보(어두움 → 밝음)
const PALS = {
  rock: [
    ramp(["#1a0f14", "#3a1c20", "#6a3326", "#a0522d", "#cf7d3c", "#f0b26a", "#ffe1ad"]), // 붉은 사막
    ramp(["#0a1424", "#0f2c4a", "#16507a", "#1f7aa0", "#3aa88a", "#7cd07a", "#d8f6b0"]), // 바다 행성
    ramp(["#140f22", "#261c3c", "#3e2e5e", "#5e4884", "#8a6cae", "#b9a0d6", "#ebdcff"]), // 라일락 암석
  ],
  ice: [ramp(["#0b1630", "#14305c", "#22558c", "#3c86be", "#74b8e4", "#b8e4ff", "#f4fdff"])],
  gas: [
    ramp(["#1e0e08", "#4a2010", "#86421c", "#c47a34", "#e8b066", "#f6dca4", "#fff6e0"]),
    ramp(["#06141e", "#0c2e44", "#14566e", "#208c96", "#46c2b4", "#9ae8d4", "#e4fff6"]),
    ramp(["#1a0820", "#3c1044", "#6c1c6e", "#a8329a", "#e05cb8", "#ff9ed4", "#ffe2f2"]),
  ],
  lava: [ramp(["#0a0608", "#1a0e10", "#2c1614", "#44201a", "#5e2c20", "#7a3a28", "#9a4c34"])],
  tiny: [ramp(["#101014", "#202028", "#34343e", "#4c4c58", "#6e6e7a", "#9a9aa6", "#d0d0da"])],
  sun: [ramp(["#3a1404", "#7a2c06", "#c4500a", "#f08414", "#ffb83a", "#ffe27a", "#fffbe0"])],
};
const ATMO = { rock: "#7cc8ff", ice: "#bfefff", gas: "#ffd2a0", lava: "#ff5a2a", tiny: "#9a9aa6", sun: "#ffd24a" };
const LAVA = ramp(["#6a1004", "#b02808", "#f05a10", "#ff9a2a", "#ffd86a"]);

const cache = new Map();

/** 행성 하나의 텍스처와 색 */
export function planetLook(p) {
  let L = cache.get(p.seed + ":" + p.kind);
  if (L) return L;
  const R = new Rng(p.seed);
  const pals = PALS[p.kind];
  const pal = pals[R.int(0, pals.length - 1)];
  const tex = new Float32Array(TW * TH);
  const glow = new Float32Array(TW * TH);
  const s = R.int(1, 9999);
  const ocean = p.kind === "rock" && pal === PALS.rock[1];
  for (let v = 0; v < TH; v++) {
    const lat = v / TH;
    for (let u = 0; u < TW; u++) {
      const x = (u / TW) * 6, y = lat * 3;
      let h = tileFbm(x, y, 6, 0, s, 4);
      let g = 0;
      if (p.kind === "gas") {
        const band = Math.sin(lat * Math.PI * (7 + (s % 5)) + tileFbm(x * 0.6, y * 2, 3.6, 0, s + 3, 3) * 5);
        h = 0.5 + band * 0.32 + (h - 0.5) * 0.3;
      } else if (p.kind === "lava") {
        const c = Math.abs(tileFbm(x * 1.3, y * 1.3, 7.8, 0, s + 7, 3) - 0.5);
        if (c < 0.045) g = 1 - c / 0.045;
        h = 0.3 + h * 0.6;
      } else if (p.kind === "ice") {
        const c = Math.abs(tileFbm(x * 1.8, y * 1.8, 10.8, 0, s + 9, 2) - 0.5);
        h = 0.55 + (h - 0.5) * 0.5 - (c < 0.02 ? 0.3 : 0);
        if (lat < 0.18 || lat > 0.82) h = Math.max(h, 0.85);
      } else if (ocean) {
        h = h > 0.52 ? 0.62 + (h - 0.52) * 1.3 : 0.18 + h * 0.4;
        if (lat < 0.12 || lat > 0.88) h = 0.92;
      } else if (p.kind === "sun") {
        h = 0.55 + (h - 0.5) * 0.9;
        g = h;
      }
      tex[v * TW + u] = clamp(h);
      glow[v * TW + u] = g;
    }
  }
  // 운석구(암석·위성)
  if (p.kind === "rock" && !ocean || p.kind === "tiny") {
    for (let k = 0; k < 7; k++) {
      const cu = R.range(0, TW), cv = R.range(4, TH - 4), cr = R.range(1.5, 3.6);
      for (let v = Math.floor(cv - cr); v <= cv + cr; v++)
        for (let u = Math.floor(cu - cr); u <= cu + cr; u++) {
          const d = Math.hypot(u - cu, v - cv) / cr;
          if (d > 1 || v < 0 || v >= TH) continue;
          const i = v * TW + ((u % TW) + TW) % TW;
          tex[i] = clamp(tex[i] + (d > 0.7 ? 0.18 : -0.22));
        }
    }
  }
  L = { pal, tex, glow, atmo: hex(ATMO[p.kind]), ringTilt: R.range(0.22, 0.34), ringRot: R.range(-0.5, 0.5), ringPal: pals[R.int(0, pals.length - 1)] };
  cache.set(p.seed + ":" + p.kind, L);
  return L;
}

/** 구 그리기. p.x, p.y 는 월드 좌표, painter 는 프레임 ox/oy 로 월드에 맞춰져 있다. */
export function drawPlanet(painter, p, t, opts = {}) {
  const L = planetLook(p);
  const { pal, tex, glow } = L;
  const r = p.r, cx = Math.round(p.x + (opts.jx || 0)), cy = Math.round(p.y + (opts.jy || 0));
  const rot = t * p.spin;
  const heat = opts.heat || 0; // 용암 행성 폭발 직전 달아오름
  const n = pal.length;

  if (L.ringPal && p.rings) drawRings(painter, p, cx, cy, L, false);

  for (let y = -r; y <= r; y++) {
    const ny = (y + 0.5) / r;
    if (Math.abs(ny) > 1) continue;
    const half = Math.sqrt(1 - ny * ny) * r;
    for (let x = Math.floor(-half); x <= Math.ceil(half); x++) {
      const nx = (x + 0.5) / r, d2 = nx * nx + ny * ny;
      if (d2 > 1) continue;
      const nz = Math.sqrt(1 - d2);
      const lon = Math.atan2(nx, nz) + rot, lat = Math.asin(ny);
      const u = ((Math.floor((lon / TAU) * TW) % TW) + TW) % TW;
      const v = Math.min(TH - 1, Math.max(0, Math.floor((lat / Math.PI + 0.5) * TH)));
      const ti = v * TW + u;
      const sx = cx + x, sy = cy + y;
      const b = nx * LX + ny * LY + nz * LZ + BAYER[((sy & 3) << 2) | (sx & 3)] * 0.16;
      let step = b < -0.05 ? -3 : b < 0.22 ? -2 : b < 0.5 ? -1 : b < 0.82 ? 0 : 1;
      if (p.kind === "sun") step = Math.max(step, 0);
      let idx = Math.round(tex[ti] * (n - 3)) + 1 + step;
      if (d2 > 0.86) idx -= 1; // 가장자리 어둡게
      idx = Math.max(0, Math.min(n - 1, idx));
      let c = pal[idx];
      const g = glow[ti];
      if (p.kind === "lava" && g > 0.2) {
        const lc = LAVA[Math.min(4, Math.floor(g * 4 + heat * 2))];
        c = lc;
        painter.add(sx, sy, lc, 0.25 + heat * 0.6);
      }
      if (heat > 0) c = mix(c, LAVA[3], heat * 0.5);
      painter.put(sx, sy, c);
    }
  }
  // 대기 테두리와 빛
  painter.ring(cx, cy, r + 1, 1, (v, ang) => {
    const lit = Math.cos(ang - Math.atan2(LY, LX));
    return lit > 0.2 ? mix(L.atmo, WHITE, 0.3) : 0;
  }, 0.85);
  painter.glowRing(cx, cy, r, p.kind === "gas" ? 7 : 5, L.atmo, p.kind === "sun" ? 0.6 : 0.22);
  if (p.kind === "sun") painter.glow(cx, cy, r * 3.2, hex("#ffb83a"), 0.55);
  if (p.kind === "lava") painter.glow(cx, cy, r * 2.2, LAVA[2], 0.12 + heat * 0.5);
  if (L.ringPal && p.rings) drawRings(painter, p, cx, cy, L, true);
}

function drawRings(painter, p, cx, cy, L, front) {
  const r0 = p.r * 1.45, r1 = p.r * 1.95, tilt = L.ringTilt, cr = Math.cos(L.ringRot), sr = Math.sin(L.ringRot);
  const rp = L.ringPal;
  const steps = Math.ceil(r1 * 7);
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * TAU, sa = Math.sin(a);
    if (front ? sa < 0 : sa >= 0) continue;
    for (let rr = r0; rr <= r1; rr += 1) {
      const ex = Math.cos(a) * rr, ey = sa * rr * tilt;
      const x = cx + ex * cr - ey * sr, y = cy + ex * sr + ey * cr;
      const band = Math.floor((rr - r0) / 1.6) % 3;
      if (!front && Math.hypot(x - cx, y - cy) < p.r) continue;
      const k = band === 1 ? 4 : band === 0 ? 3 : 5;
      painter.dot(x, y, front ? rp[k] : scale(rp[k], 0.75), band === 2 ? 0.55 : 0.95);
    }
  }
}

/** 소행성: 울퉁불퉁한 작은 바위 */
export function drawRock(painter, r) {
  const R = new Rng(r.seed);
  const n = 7, pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + r.rot, rr = r.r * (0.75 + 0.35 * R.next());
    pts.push([r.x + Math.cos(a) * rr, r.y + Math.sin(a) * rr]);
  }
  const C = PALS.tiny[0];
  painter.poly(pts, (x, y) => {
    const b = ((x - r.x) * LX + (y - r.y) * LY) / r.r;
    return C[Math.max(1, Math.min(6, Math.round(3 + b * 2.2)))];
  });
  painter.glow(r.x, r.y, r.r * 3, hex("#ff5a50"), 0.12);
}
