// 이 게임 전용으로 만든 pixelfx 이펙트들.
// pixelfx 의 이펙트 규약(docs/AUTHORING.md)을 그대로 따른다: meta + draw(p, t, o) 또는 create(o),
// 로컬 좌표(0,0)가 기준점, 원샷은 duration 에 아무것도 남기지 않음, Math.random 금지(시드 Rng 사용).

import { Particles, Lights, P, Rng, fit, clamp, ease, seg, smooth, at, TAU, WHITE, sparkle, hex, mix } from "../vendor/pixelfx/core/index.js";

const INK = hex("#0b0716");

// ---------------------------------------------------------------------------------------------
// 판정 글자: 크게 꽂혔다가(2배 → 1배 오버슛) 위로 떠오르며 디더로 사라진다
export const judgePop = {
  meta: {
    name: "Judge pop",
    desc: "A judgement word slams in at double size, overshoots, floats up and dithers out, with a soft glow under it.",
    size: [96, 48], origin: [48, 30], duration: 0.62, loop: false, fps: 30,
    options: { palette: ["#1a0c3a", "#3a1a7a", "#6a34c0", "#a070ff", "#d8c4ff", "#ffffff"], text: "PERFECT", seed: 1 },
  },
  draw(p, t, o) {
    const C = fit(o.palette, 6), D = judgePop.meta.duration;
    const inT = seg(t, 0, 0.09);
    const k = t < 0.09 ? 2 - ease.outBack(inT, 2.2) : 1;
    const scale = k > 1.45 ? 2 : 1;
    const y = -ease.outQuart(seg(t, 0.05, D)) * 12 - 4;
    const a = 1 - smooth(0.38, D, t);
    if (a <= 0) return;
    p.glow(0, y + 3, 18, C[3], 0.35 * a);
    if (t < 0.05) p.glow(0, y + 3, 26, WHITE, 0.5);
    const hot = t < 0.05;
    p.text(o.text, 0, y - (scale === 2 ? 7 : 3), (gx, gy) => (hot ? WHITE : at(C, 0.45 + 0.55 * (1 - gy / 7))), {
      font: "big", scale, align: "center", outline: INK, a,
    });
  },
};

// ---------------------------------------------------------------------------------------------
// 탭할 때마다 판정 링에서 퍼지는 물결
export const tapRipple = {
  meta: {
    name: "Tap ripple",
    desc: "A thin ring snaps out from the judgement ring and thins away, white at first, cooling to the theme colour.",
    size: [160, 160], origin: [80, 80], duration: 0.32, loop: false, fps: 30,
    options: { palette: ["#0c1430", "#1f4f94", "#58b4ec", "#d8f4ff", "#ffffff"], r: 40, seed: 1 },
  },
  draw(p, t, o) {
    const C = fit(o.palette, 5), D = tapRipple.meta.duration, u = t / D;
    if (u >= 1) return;
    const r = o.r + ease.outQuart(u) * 14, w = 2.5 - u * 1.6;
    const c = u < 0.15 ? WHITE : at(C, 1 - u * 0.8);
    p.ring(0, 0, r, w, c, 1 - u * u);
    p.glowRing(0, 0, r, 5, C[2], 0.35 * (1 - u));
  },
};

// ---------------------------------------------------------------------------------------------
// 노트를 맞췄을 때 판정 링 위에서 터지는 작은 별가루 (Good 이상 공용, 세기는 power 로)
export function create_noteBurst(o) {
  const C = fit(o.palette, 7), R = new Rng(o.seed ?? 1), power = o.power ?? 1;
  const ps = new Particles({ rng: R, sparks: [C[6], C[5], C[4], C[2]] }), lights = new Lights();
  lights.add(0, 0, 18 + power * 10, C[4], 0.5 * power, 0.25);
  const n = Math.round(6 + power * 12);
  for (let i = 0; i < n; i++) {
    const a = R.range(-1.2, 1.2) + (i % 2 ? Math.PI : 0) * 0.15, sp = R.range(40, 120) * (0.6 + power * 0.5);
    ps.spawn(P.SPARK, 0, 0, Math.cos(a) * sp, Math.sin(a) * sp, R.range(0.15, 0.35));
  }
  let t = 0;
  return {
    update(dt) { t += dt; ps.update(dt); lights.update(dt); },
    draw(p) {
      if (t < 0.08) sparkle(p, 0, 0, (4 + power * 4) * (1 - t / 0.08), C[6], C[4]);
      ps.draw(p);
      lights.draw(p);
    },
  };
}
export const noteBurst = {
  meta: {
    name: "Note burst",
    desc: "A small four-point flare where a note was caught, with a fan of sparks thrown outward.",
    size: [96, 96], origin: [48, 48], duration: 0.6, loop: false, fps: 30,
    options: { palette: ["#041418", "#08303a", "#0c5260", "#18b4b0", "#4ce8d8", "#b4fff0", "#ffffff"], power: 1, seed: 1 },
  },
  create: create_noteBurst,
};

// ---------------------------------------------------------------------------------------------
// 피버 배너: 무지개 FEVER!! 가 속도선과 함께 미끄러져 들어와 꽂히고, 반짝이다 빠져나간다
export const feverBanner = {
  meta: {
    name: "Fever banner",
    desc: "FEVER!! whooshes in on speed lines, slams with a white frame, shimmers through a rainbow and whooshes out.",
    size: [240, 80], origin: [120, 40], duration: 1.9, loop: false, fps: 30,
    options: {
      palette: ["#ff4a5a", "#ff9a2a", "#ffe03c", "#5ad84a", "#3cc8ff", "#7a6cff", "#f53cd1"],
      text: "FEVER!!", seed: 3,
    },
  },
  draw(p, t, o) {
    const C = o.palette.map(hex), D = feverBanner.meta.duration, R = new Rng(o.seed);
    const inU = ease.outExpo(seg(t, 0, 0.22)), outU = ease.inQuart(seg(t, D - 0.3, D));
    const x = (1 - inU) * -150 + outU * 170;
    const a = 1 - seg(t, D - 0.12, D);
    // 속도선
    for (let i = 0; i < 14; i++) {
      const yy = R.range(-22, 22), len = R.range(20, 70), sp = R.range(0.8, 1.4);
      const lx = x - 40 - ((t * 400 * sp + i * 37) % 160);
      if (t < D - 0.1) p.line(lx, yy, lx + len, yy, C[i % C.length], 0.5 * a);
    }
    const slam = t > 0.2 && t < 0.27;
    p.glow(x, 0, 60, slam ? WHITE : C[(Math.floor(t * 12)) % C.length], (slam ? 0.7 : 0.25) * a);
    p.text(o.text, x, -3.5 * (o.scale ?? 4) + Math.sin(t * 20) * (t < 0.6 ? 1 : 0), (gx, gy) =>
      slam ? WHITE : C[Math.floor(gx / 2 + gy / 3 + t * 14) % C.length], { font: "big", scale: o.scale ?? 4, align: "center", outline: INK, a });
  },
};

// ---------------------------------------------------------------------------------------------
// 미스: 코어 가장자리가 금이 가며 붉은 파편이 튀고, 붉은 충격파가 퍼진다
export function create_coreCrack(o) {
  const C = fit(o.palette, 7), R = new Rng(o.seed ?? 1);
  const ps = new Particles({ rng: R, sparks: [C[6], C[5], C[4], C[2]] }), lights = new Lights();
  lights.add(0, 0, o.r * 2.5, C[4], 0.6, 0.3);
  const cracks = [];
  for (let i = 0; i < 5; i++) {
    const a0 = (o.angle0 ?? 0) + R.range(-0.9, 0.9);
    const pts = [[Math.cos(a0) * o.r * 0.4, Math.sin(a0) * o.r * 0.4]];
    let a = a0, rr = o.r * 0.4;
    for (let k = 0; k < 4; k++) {
      rr += R.range(3, 6);
      a += R.range(-0.35, 0.35);
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    cracks.push(pts);
  }
  for (let i = 0; i < 16; i++) {
    const a = (o.angle0 ?? 0) + R.range(-1.4, 1.4), sp = R.range(50, 150);
    ps.spawn(P.SPARK, Math.cos(a) * o.r, Math.sin(a) * o.r, Math.cos(a) * sp, Math.sin(a) * sp, R.range(0.2, 0.45));
  }
  let t = 0;
  return {
    update(dt) { t += dt; ps.update(dt); lights.update(dt); },
    draw(p) {
      const u = t / 0.7;
      if (u < 1) {
        const r = o.r + ease.outQuart(u) * o.r * 2.2;
        p.ring(0, 0, r, 2.5 * (1 - u) + 0.5, u < 0.1 ? WHITE : C[4], 1 - u);
        p.glowRing(0, 0, r, 6, C[3], 0.4 * (1 - u));
      }
      const ca = 1 - seg(t, 0.25, 0.6);
      if (ca > 0) for (const pts of cracks) p.polyline(pts, t < 0.06 ? WHITE : C[5], ca);
      ps.draw(p);
      lights.draw(p);
    },
  };
}
export const coreCrack = {
  meta: {
    name: "Core crack",
    desc: "The core takes a hit: cracks fork out from the side it was hit, red sparks fly and a red shock ring spreads.",
    size: [160, 160], origin: [80, 80], duration: 0.75, loop: false, fps: 30,
    options: { palette: ["#14040a", "#3a0a14", "#6a101c", "#a01824", "#d42a30", "#ff5a50", "#ff9a8a"], r: 16, angle0: 0, seed: 1 },
  },
  create: create_coreCrack,
};

// ---------------------------------------------------------------------------------------------
// 랭크 도장: 결과 화면 배경에서 큰 글자가 쾅 찍히며 링과 광선이 터진다
export const rankStamp = {
  meta: {
    name: "Rank stamp",
    desc: "A rank letter stamps down huge, overshoots, throws a ring and rays, and settles with a slow shimmer.",
    size: [160, 160], origin: [80, 80], duration: 1.4, loop: false, fps: 30,
    options: { palette: PALETTE_GOLD(), text: "S", seed: 1 },
  },
  draw(p, t, o) {
    const C = fit(o.palette, 8), D = rankStamp.meta.duration;
    const u = seg(t, 0, 0.16);
    const scale = Math.max(6, Math.round(15 - ease.outBack(u, 2) * 6));
    const fade = 1 - seg(t, D - 0.2, D);
    if (t > 0.14) {
      const v = seg(t, 0.14, 0.7);
      p.ring(0, 0, 10 + ease.outQuart(v) * 60, 3 * (1 - v) + 0.5, v < 0.1 ? WHITE : C[5], 1 - v);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU + 0.2, r0 = 22 + v * 20, r1 = r0 + 18 * (1 - v);
        p.line(Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * r1, Math.sin(a) * r1, C[6], 1 - v);
      }
    }
    p.glow(0, 0, 50, C[4], 0.45 * fade);
    p.text(o.text, 0, -3.5 * scale, (gx, gy) => (t < 0.18 ? WHITE : at(C, 1 - gy / 9 + 0.25 + 0.15 * Math.sin(t * 6 + gx))), {
      font: "big", scale, align: "center", outline: INK, a: fade,
    });
  },
};
function PALETTE_GOLD() {
  return ["#1e1206", "#4a2c08", "#86520c", "#c48412", "#f0b424", "#ffe066", "#fff6c4", "#ffffff"];
}

// ---------------------------------------------------------------------------------------------
// 건너뛴 행성에서 혜성까지 빛줄기가 뻗어 와 꽂힌다(delay 만큼 기다렸다가). 원점은 건너뛴 행성, (tx, ty) 는 혜성까지의 변위.
export const skipLink = {
  meta: {
    name: "Skip link",
    desc: "After a short delay a bolt of gold light races from a skipped planet to the comet, flares at both ends and fades.",
    size: [200, 200], origin: [100, 100], duration: 1.2, loop: false, fps: 30,
    options: { palette: ["#1e1206", "#86520c", "#c48412", "#f0b424", "#ffe066", "#fff6c4", "#ffffff"], tx: 0, ty: -60, delay: 0, seed: 1 },
  },
  draw(p, t, o) {
    const C = fit(o.palette, 7), u = t - o.delay;
    if (u < 0) { p.glow(0, 0, 10, C[4], 0.25); return; }
    const go = ease.outQuart(clamp(u / 0.22)), fade = 1 - seg(u, 0.25, 0.75);
    if (fade <= 0) return;
    const hx = o.tx * go, hy = o.ty * go, R = new Rng(o.seed);
    // 살짝 지글거리는 번개 같은 선
    let px = 0, py = 0;
    const n = 9;
    for (let i = 1; i <= n; i++) {
      const k = i / n, j = i < n ? R.range(-3, 3) * fade : 0;
      const nx = hx * k - (hy / (Math.hypot(hx, hy) || 1)) * j, ny = hy * k + (hx / (Math.hypot(hx, hy) || 1)) * j;
      p.line(px, py, nx, ny, u < 0.08 ? WHITE : C[5], fade);
      px = nx; py = ny;
    }
    p.glowLine(0, 0, hx, hy, 6, C[4], 0.35 * fade);
    if (u < 0.3) sparkle(p, 0, 0, 6 * (1 - u / 0.3), C[6], C[4]);
    if (go >= 1 && u < 0.45) sparkle(p, hx, hy, 7 * (1 - (u - 0.22) / 0.23), C[6], C[4]);
  },
};

export { mix, clamp };
