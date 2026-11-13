// 궤도 점프: 게임 규칙과 물리. 화면·소리와 분리돼 있어서 Node 에서도 돌릴 수 있다(봇 검증용).
//
// 좌표: 픽셀 단위, x 오른쪽, y 아래쪽. 위로 올라갈수록 y 가 작아진다(높이 = -y).
// 플레이어는 행성 궤도를 돌다가(orbit) 탭하면 접선 방향으로 튀어 나가고(fly),
// 다른 행성의 궤도 반경 안에 들어오면 그 궤도에 붙잡힌다.
// 비행 경로는 혜성마다 다른 곡선이다(FLIGHTS: 안쪽 곡선, 직진, 뱀, S자…). 블랙홀도 경로를 휜다.
// 레벨 생성기는 지금 고른 혜성의 궤도로 "모든 점프가 가능한지"를 검증한다.
// 조준선·레벨 검증·봇 모두 advance() 하나로 계산하므로 보이는 선과 실제 비행이 정확히 같다.

import { Rng } from "../vendor/pixelfx/core/math.js";

export const SPEED = 235; // 기본 발사 속도(px/s)
export const STEP = 1 / 240; // 물리 고정 스텝
const TAU = Math.PI * 2;

// 비행 궤도(혜성마다 다르다). 진행 방향이 도는 속도(rad/s):
//   rate(t) = side · ( w0·e^(-t/tau) + amp·sin(2π·freq·t + phase)·e^(-t/wtau) )
// side +1 이면 궤도 도는 쪽(행성 쪽, 안쪽)으로, -1 이면 바깥쪽으로 휜다. speed 는 비행 속도.
export const FLIGHTS = {
  hook: { name: "안쪽 곡선", w0: 3.4, tau: 0.3, speed: 235, side: 1 },
  straight: { name: "직진", w0: 0, tau: 1, speed: 250, side: 1 },
  outward: { name: "바깥 곡선", w0: 3.4, tau: 0.3, speed: 235, side: -1 },
  arc: { name: "큰 호", w0: 1.5, tau: 0.9, speed: 225, side: 1 },
  snap: { name: "갈고리", w0: 7.5, tau: 0.12, speed: 240, side: 1 },
  snake: { name: "뱀", w0: 0, tau: 1, amp: 5.5, freq: 2.4, phase: 0, wtau: 0.9, speed: 230, side: 1 },
  drift: { name: "바깥 호", w0: 1.6, tau: 0.8, speed: 225, side: -1 },
  scurve: { name: "S자", w0: 0, tau: 1, amp: 4.2, freq: 1.25, phase: 0, wtau: 1.2, speed: 235, side: 1 },
  slow: { name: "느린 곡선", w0: 2.6, tau: 0.35, speed: 185, side: 1 },
  rocket: { name: "급행", w0: 2.2, tau: 0.25, speed: 300, side: 1 },
  orbit: { name: "공전", w0: 1.15, tau: 1e9, speed: 220, side: 1 },
  zigzag: { name: "지그재그", w0: 0, tau: 1, amp: 7, freq: 3.4, phase: Math.PI / 2, wtau: 0.7, speed: 235, side: -1 },
};
for (const [id, f] of Object.entries(FLIGHTS)) f.id = id;
export const DEFAULT_FLIGHT = FLIGHTS.hook;

function turnRate(f, t) {
  let r = f.w0 ? f.w0 * Math.exp(-t / f.tau) : 0;
  if (f.amp) r += f.amp * Math.sin(TAU * f.freq * t + f.phase) * Math.exp(-t / f.wtau);
  return r * f.side;
}

/**
 * 비행 상태 o = { x, y, vx, vy, t, curve, prof } 를 dt 만큼 진행한다.
 * curve 는 궤도 회전 방향(+1/-1), 0 이면 직선. prof 는 FLIGHTS 의 궤도. 블랙홀에 삼켜지면 그 블랙홀을 돌려준다.
 */
export function advance(o, dt, holes) {
  const f = o.prof || DEFAULT_FLIGHT;
  if (o.curve) {
    const a = turnRate(f, o.t) * o.curve * dt, c = Math.cos(a), s = Math.sin(a);
    const vx = o.vx * c - o.vy * s;
    o.vy = o.vx * s + o.vy * c;
    o.vx = vx;
  }
  let swallowed = null;
  if (holes) for (const h of holes) {
    const dx = h.x - o.x, dy = h.y - o.y, d2 = dx * dx + dy * dy, d = Math.sqrt(d2);
    if (d < h.reach) {
      const a = h.pull / Math.max(60, d2);
      o.vx += (dx / d) * a * dt; o.vy += (dy / d) * a * dt;
      if (d < h.core + 1.5) swallowed = h;
    }
  }
  const sp = Math.hypot(o.vx, o.vy);
  o.vx *= f.speed / sp; o.vy *= f.speed / sp;
  o.x += o.vx * dt; o.y += o.vy * dt;
  o.t += dt;
  return swallowed;
}

// 블랙홀이 없을 때의 경로 모양은 발사 지점·방향·궤도 종류에만 달렸으므로 궤도마다 한 번 계산해 둔다.
// path[k] = [접선 방향 거리, 휘는 쪽 거리] (curve=+1, k 스텝 = 게임 물리와 같은 1/240 초 간격)
export const PATH_DT = STEP;
export function flightPath(f = DEFAULT_FLIGHT) {
  if (f._path) return f._path;
  const o = { x: 0, y: 0, vx: f.speed, vy: 0, t: 0, curve: 1, prof: f }, out = [[0, 0]];
  for (let k = 0; k < 840; k++) { advance(o, PATH_DT, null); out.push([o.x, o.y]); }
  return (f._path = out);
}
/** 궤도 위 각도 theta, 회전 방향 dir 에서 쏘았을 때의 발사 상태 */
export function launchState(cx, cy, ro, theta, dir, f = DEFAULT_FLIGHT) {
  const x = cx + Math.cos(theta) * ro, y = cy + Math.sin(theta) * ro;
  const tx = -Math.sin(theta) * dir, ty = Math.cos(theta) * dir;
  return { x, y, vx: tx * f.speed, vy: ty * f.speed, t: 0, curve: dir, prof: f, path: flightPath(f), tx, ty };
}
/** 경로 표의 k 번째 점을 실제 좌표로 */
export function pathPoint(L, k, out = [0, 0]) {
  const [a, n] = L.path[k], c = L.curve;
  out[0] = L.x + a * L.tx + n * c * -L.ty;
  out[1] = L.y + a * L.ty + n * c * L.tx;
  return out;
}

// 행성 종류
export const KINDS = {
  rock: { name: "암석", rMin: 11, rMax: 15, alt: [11, 14], omega: [1.9, 2.3], score: 1 },
  ice: { name: "얼음", rMin: 9, rMax: 12, alt: [10, 12], omega: [2.5, 3.0], score: 1 },
  gas: { name: "가스", rMin: 17, rMax: 22, alt: [12, 15], omega: [1.4, 1.7], score: 1 },
  lava: { name: "용암", rMin: 10, rMax: 13, alt: [10, 13], omega: [2.2, 2.6], score: 2, fuse: 2.2 },
  sun: { name: "항성", rMin: 13, rMax: 15, alt: [14, 16], omega: [2.6, 3.0], score: 3 },
  tiny: { name: "위성", rMin: 6, rMax: 7, alt: [9, 10], omega: [3.0, 3.5], score: 2 },
};

// 구역: 점수에 따라 배경 테마와 등장 요소가 바뀐다
export const ZONES = [
  { at: 0, id: "low", name: "저궤도", en: "LOW ORBIT" },
  { at: 15, id: "nebula", name: "성운", en: "NEBULA" },
  { at: 35, id: "belt", name: "소행성대", en: "ASTEROID BELT" },
  { at: 60, id: "deep", name: "심우주", en: "DEEP SPACE" },
  { at: 100, id: "singularity", name: "특이점", en: "SINGULARITY" },
];
export const zoneAt = (score) => {
  let z = 0;
  for (let i = 0; i < ZONES.length; i++) if (score >= ZONES[i].at) z = i;
  return z;
};

export const DEATH = {
  lost: "우주 미아가 됐어요",
  void: "공허에 삼켜졌어요",
  rock: "소행성에 부딪혔어요",
  boom: "행성이 폭발했어요",
  hole: "블랙홀에 빨려 들어갔어요",
};

const orbitR = (p) => p.r + p.alt;

export class World {
  constructor(seed = 1, width = 200, flight = DEFAULT_FLIGHT) {
    this.prof = flight;
    this.seed = seed >>> 0 || 1;
    this.R = new Rng(this.seed);
    this.colW = width; // 행성이 놓이는 가운데 기둥의 폭
    this.t = 0;
    this.planets = [];
    this.holes = [];
    this.rocks = [];
    this.coins = [];
    this.shields = [];
    this.events = []; // 렌더러·소리가 가져가는 일 목록
    this.score = 0;
    this.jumps = 0;
    this.perfects = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.coinsGot = 0;
    this.shield = false;
    this.genIndex = 0;
    this.started = false;

    const first = this.makePlanet("rock", 0, 0);
    first.r = 14; first.alt = 13; first.omega = 1.7;
    first.visited = true;
    this.planets.push(first);
    this.player = { mode: "orbit", planet: first, theta: Math.PI * 0.5, dir: 1, x: 0, y: 0, vx: 0, vy: 0, flyT: 0, from: null, trail: [] };
    this.placeOnOrbit();
    this.voidY = 140; // 공허(아래에서 올라오는 벽)의 윗면
    this.zone = 0;
    while (this.topY() > -600) this.generateNext();
  }

  topY() { return this.planets.length ? this.planets[this.planets.length - 1].y : 0; }

  makePlanet(kind, x, y) {
    const K = KINDS[kind], R = this.R;
    return {
      id: this.genIndex++, kind, x, y, baseX: x,
      r: Math.round(R.range(K.rMin, K.rMax)), alt: Math.round(R.range(K.alt[0], K.alt[1])),
      omega: R.range(K.omega[0], K.omega[1]),
      move: 0, moveF: 0, moveP: 0,
      seed: R.int(1, 1e6), spin: R.range(0.15, 0.5) * R.sign(),
      visited: false, fuse: 0, dead: false, deadAt: 0, rings: kind === "gas" && R.chance(0.6),
    };
  }

  // ---------------------------------------------------------------------------------------
  // 레벨 생성: 다음 행성을 위쪽에 놓되, 실제 비행 시뮬레이션으로 "잡히는 발사 각도 구간"이 충분한지 확인한다
  difficulty(n) {
    const d = Math.min(1, n / 100);
    return {
      gapMin: 70 + d * 22, gapMax: 96 + d * 34,
      window: n < 8 ? 0.42 - n * 0.015 : 0.27 - d * 0.15, // 발사 가능 시간창(초)의 최소. 처음 몇 개는 넉넉하게
      kinds: n < 4 ? ["rock"] : n < 10 ? ["rock", "rock", "ice", "gas"] : n < 20 ? ["rock", "ice", "gas", "lava", "tiny"] : ["rock", "ice", "gas", "lava", "lava", "tiny", "tiny", "sun"],
      moveChance: n < 12 ? 0 : Math.min(0.45, 0.12 + (n - 12) * 0.006),
      holeChance: n < 30 ? 0 : Math.min(0.35, 0.1 + (n - 30) * 0.004),
      rockChance: n < 22 ? 0 : Math.min(0.6, 0.2 + (n - 22) * 0.006),
    };
  }

  generateNext() {
    const prev = this.planets[this.planets.length - 1];
    const n = (this.made = (this.made || 1) + 1) - 1; // 지금까지 만든 행성 수(정리돼도 줄지 않음)
    const D = this.difficulty(n);
    const R = this.R;
    const half = this.colW / 2;
    let best = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      const kind = n % 23 === 22 ? "sun" : D.kinds[R.int(0, D.kinds.length - 1)];
      const gap = R.range(D.gapMin, D.gapMax);
      const p = this.makePlanet(kind, 0, 0);
      const ro = orbitR(p);
      const maxX = half - ro + 4;
      const x = Math.max(-maxX, Math.min(maxX, prev.baseX + R.range(-1, 1) * this.colW * 0.75));
      p.x = p.baseX = x;
      p.y = prev.y - gap;
      // 두 궤도가 겹치지 않게
      if (Math.hypot(p.x - prev.baseX, p.y - prev.y) < orbitR(prev) + ro + 18) continue;
      const hole = R.chance(D.holeChance) ? this.makeHole(prev, p) : null;
      const w = this.launchWindow(prev, p, hole);
      if (w >= D.window) { best = { p, hole }; break; }
      if (!best || w > best.w) best = { p, hole, w };
    }
    let { p, hole } = best;
    if ((best.w ?? 1) < D.window * 0.6) hole = null; // 너무 빡빡하면 블랙홀은 빼 준다
    if (R.chance(D.moveChance) && p.kind !== "sun") {
      p.move = R.range(10, 22);
      p.moveF = R.range(0.5, 0.9);
      p.moveP = R.range(0, TAU);
      const ro = orbitR(p);
      const lim = half - ro + 4;
      p.baseX = Math.max(-lim + p.move, Math.min(lim - p.move, p.baseX));
    }
    this.planets.push(p);
    if (hole) this.holes.push(hole);
    // 코인: 두 행성 사이 직선 근처에 2~4개
    const nc = R.int(1, 3) + (p.kind === "sun" ? 3 : 0);
    for (let i = 0; i < nc; i++) {
      const u = (i + 1) / (nc + 1);
      const off = R.range(-14, 14);
      const dx = p.baseX - prev.baseX, dy = p.y - prev.y, L = Math.hypot(dx, dy) || 1;
      this.coins.push({ x: prev.baseX + dx * u + (-dy / L) * off, y: prev.y + dy * u + (dx / L) * off, got: false, ph: R.range(0, TAU) });
    }
    // 방패: 가끔
    if (n > 8 && R.chance(0.06)) this.shields.push({ x: (prev.baseX + p.baseX) / 2 + R.range(-20, 20), y: (prev.y + p.y) / 2, got: false });
    // 소행성: 화면을 가로질러 천천히 떠다닌다
    if (R.chance(D.rockChance)) {
      const y = (prev.y + p.y) / 2 + R.range(-12, 12);
      const dir = R.sign();
      this.rocks.push({ x: -dir * (half + 40), y, vx: dir * R.range(14, 30), r: R.int(3, 5), rot: R.range(0, TAU), spin: R.range(-2, 2), seed: R.int(1, 1e6), span: half + 60 });
    }
  }

  makeHole(a, b) {
    const R = this.R;
    // 두 행성 사이 경로 옆에 둔다
    const mx = (a.baseX + b.baseX) / 2, my = (a.y + b.y) / 2;
    const dx = b.baseX - a.baseX, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
    const side = R.sign(), off = R.range(26, 40);
    const x = Math.max(-this.colW / 2 + 10, Math.min(this.colW / 2 - 10, mx + (-dy / L) * off * side));
    return { x, y: my + (dx / L) * off * side, core: 4, pull: R.range(5500, 8000), reach: 60, seed: R.int(1, 1e6), passed: false };
  }

  /** a 궤도에서 발사해 b 에 잡히는 시간창(초), 두 회전 방향 중 나쁜 쪽 기준 */
  launchWindow(a, b, hole) {
    const ro = orbitR(a), rb = orbitR(b);
    const N = hole ? 180 : 360;
    let worst = Infinity;
    for (const dir of [1, -1]) {
      const hit = new Uint8Array(N);
      for (let i = 0; i < N; i++) {
        const th = (i / N) * TAU;
        const L = launchState(a.baseX, a.y, ro, th, dir, this.prof);
        hit[i] = hole ? (this.simulateHits(L, b, hole, a) ? 1 : 0) : this.pathHits(L, b, a) ? 1 : 0;
      }
      let run = 0, bestRun = 0;
      for (let k = 0; k < N * 2; k++) {
        if (hit[k % N]) { run++; bestRun = Math.max(bestRun, run); } else run = 0;
      }
      bestRun = Math.min(bestRun, N);
      worst = Math.min(worst, ((bestRun / N) * TAU) / a.omega);
    }
    return worst;
  }

  /** 미리 계산한 곡선 경로로 b 의 궤도에 닿는지(블랙홀 없음) */
  pathHits(L, b, from) {
    const rb = orbitR(b) - 1.5, rf = orbitR(from) - 1, D = Math.hypot(b.baseX - L.x, b.y - L.y) + rb + 10;
    const pt = [0, 0];
    const path = L.path, sp = L.prof.speed;
    for (let k = 4; k < path.length; k += 4) {
      if (k * PATH_DT * sp > D * 1.7 + 30) return false; // 곡선이라 직선거리보다 길게 본다
      pathPoint(L, k, pt);
      if (Math.hypot(pt[0] - b.baseX, pt[1] - b.y) < rb) return true;
      if (k > 80 && Math.hypot(pt[0] - from.baseX, pt[1] - from.y) < rf) return false;
      if (Math.abs(pt[0]) > this.colW / 2 + 50) return false;
    }
    return false;
  }

  /** 블랙홀까지 넣어 실제로 비행시켜 본다 */
  simulateHits(L, b, hole, from) {
    const rb = orbitR(b), dt = STEP; // 실제 게임과 같은 간격(블랙홀 근처는 간격이 다르면 궤적이 갈라진다)
    const o = { x: L.x, y: L.y, vx: L.vx, vy: L.vy, t: 0, curve: L.curve, prof: L.prof };
    const maxSteps = Math.ceil(((Math.hypot(b.baseX - o.x, b.y - o.y) * 1.7 + 70) / L.prof.speed) / dt);
    const hs = hole ? [hole] : null;
    for (let s = 0; s < maxSteps; s++) {
      if (advance(o, dt, hs)) return false;
      if (hole && Math.hypot(hole.x - o.x, hole.y - o.y) < hole.core + 2) return false;
      if (Math.hypot(o.x - b.baseX, o.y - b.y) < rb - 1) return true;
      if (s > 50 && Math.hypot(o.x - from.baseX, o.y - from.y) < orbitR(from) - 1) return false;
      if (Math.abs(o.x) > this.colW / 2 + 50) return false;
    }
    return false;
  }

  // ---------------------------------------------------------------------------------------
  emit(type, data = {}) { this.events.push({ type, ...data }); }

  placeOnOrbit() {
    const P = this.player, p = P.planet, ro = orbitR(p);
    P.x = p.x + Math.cos(P.theta) * ro;
    P.y = p.y + Math.sin(P.theta) * ro;
  }

  /** 탭 */
  tap() {
    const P = this.player;
    if (P.mode !== "orbit") return false;
    this.started = true;
    const L = launchState(P.planet.x, P.planet.y, orbitR(P.planet), P.theta, P.dir, this.prof);
    P.vx = L.vx; P.vy = L.vy; P.curve = L.curve;
    P.from = P.planet;
    P.mode = "fly";
    P.flyT = 0;
    this.jumps++;
    this.emit("launch", { x: P.x, y: P.y, vx: P.vx, vy: P.vy, planet: P.from });
    return true;
  }

  update(dt) {
    let acc = dt;
    while (acc > 1e-9) {
      const h = Math.min(STEP, acc);
      this.step(h);
      acc -= h;
    }
    while (this.topY() > this.player.y - 700) this.generateNext();
    this.cull();
  }

  step(dt) {
    this.t += dt;
    const P = this.player;
    for (const p of this.planets) if (p.move) p.x = p.baseX + Math.sin(this.t * p.moveF * TAU * 0.25 + p.moveP) * p.move;
    for (const r of this.rocks) {
      r.x += r.vx * dt; r.rot += r.spin * dt;
      if (Math.abs(r.x) > r.span) r.x = -Math.sign(r.vx) * r.span;
    }
    // 공허: 시작 후 올라온다. 너무 멀어지면 따라잡는 속도가 붙는다.
    if (this.started && P.mode !== "dead") {
      const base = Math.min(24, 7 + this.score * 0.16);
      const gap = this.voidY - P.y;
      const catchUp = gap > 210 ? (gap - 210) * 0.6 : 0;
      this.voidY -= (base + catchUp) * dt;
    }
    // 용암 행성 퓨즈
    for (const p of this.planets) {
      if (p.fuse > 0 && !p.dead) {
        p.fuse -= dt;
        if (p.fuse <= 0) {
          p.dead = true; p.deadAt = this.t;
          this.emit("planetBoom", { planet: p });
          if (P.mode === "orbit" && P.planet === p) this.kill("boom");
        }
      }
    }
    if (P.mode === "orbit") {
      P.theta += P.planet.omega * P.dir * dt;
      this.placeOnOrbit();
      if (P.y > this.voidY - 2) this.kill("void");
    } else if (P.mode === "fly" && P.rescue) {
      this.stepRescue(dt);
    } else if (P.mode === "fly") {
      const o = { x: P.x, y: P.y, vx: P.vx, vy: P.vy, t: P.flyT, curve: P.curve || 0, prof: this.prof };
      const gone = advance(o, dt, this.holes);
      P.x = o.x; P.y = o.y; P.vx = o.vx; P.vy = o.vy; P.flyT = o.t;
      if (gone) { this.kill("hole", gone); return; }
      for (const h of this.holes) {
        const d = Math.hypot(h.x - P.x, h.y - P.y);
        if (d < h.core + 13 && !h.passed) { h.passed = true; h.close = true; }
        else if (h.close && d > h.reach) {
          h.close = false;
          this.score += 2;
          this.emit("closeCall", { x: P.x, y: P.y });
        }
      }
      // 포획
      for (const p of this.planets) {
        if (p.dead) continue;
        const ro = orbitR(p), dx = P.x - p.x, dy = P.y - p.y, d = Math.hypot(dx, dy);
        if (d > ro) continue;
        if (p === P.from && P.flyT < 0.6) continue;
        this.capture(p, dx, dy);
        return;
      }
      // 코인·방패
      for (const c of this.coins) if (!c.got && Math.hypot(c.x - P.x, c.y - P.y) < 7) {
        c.got = true; this.coinsGot++; this.emit("coin", { x: c.x, y: c.y });
      }
      for (const s of this.shields) if (!s.got && Math.hypot(s.x - P.x, s.y - P.y) < 9) {
        s.got = true; this.shield = true; this.emit("shield", { x: s.x, y: s.y });
      }
      for (const r of this.rocks) if (Math.hypot(r.x - P.x, r.y - P.y) < r.r + 2) {
        if (this.shield) r.x = 1e6; // 방패가 소행성도 부순다
        this.kill("rock");
        return;
      }
      if (P.y > this.voidY) { this.kill("void"); return; }
      if (Math.abs(P.x) > this.colW / 2 + 70 || P.flyT > 3.2) { this.kill("lost"); return; }
    }
    if (P.mode !== "dead") {
      P.trail.push(P.x, P.y);
      if (P.trail.length > 64) P.trail.splice(0, 2);
    }
  }

  capture(p, dx, dy) {
    const P = this.player, ro = orbitR(p);
    const rescued = !!P.rescue;
    P.rescue = null;
    // 궤적 직선이 행성 중심에서 얼마나 떨어져 지나가는지: 가장자리를 스칠수록 PERFECT
    const sp = Math.hypot(P.vx, P.vy);
    const perp = Math.abs(dx * P.vy - dy * P.vx) / sp;
    const q = perp / ro;
    const grade = q >= 0.7 ? "perfect" : q >= 0.38 ? "great" : "good";
    P.theta = Math.atan2(dy, dx);
    P.dir = -Math.sin(P.theta) * P.vx + Math.cos(P.theta) * P.vy >= 0 ? 1 : -1;
    P.planet = p;
    P.mode = "orbit";
    this.placeOnOrbit();
    const fresh = !p.visited;
    p.visited = true;
    if (fresh) {
      if (grade === "perfect") { this.combo++; this.perfects++; } else this.combo = 0;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      const mult = 1 + Math.floor(this.combo / 3);
      const gain = KINDS[p.kind].score * mult + (grade === "perfect" ? 1 : 0);
      this.score += gain;
      if (p.kind === "lava") p.fuse = p.fuseMax = Math.max(KINDS.lava.fuse, (TAU / p.omega) * 1.3);
      // 건너뛰기: 출발 행성과 이번 행성 사이 높이에 있던, 아직 안 들른 행성들도 점수로 친다(방패 구조 비행은 제외)
      const from = P.from;
      if (from && from !== p && !rescued) {
        const lo = Math.min(from.y, p.y), hi = Math.max(from.y, p.y);
        const skipped = this.planets.filter((q) => q !== p && !q.visited && !q.dead && q.y > lo + 1 && q.y < hi - 1).sort((a, b) => b.y - a.y);
        if (skipped.length) {
          let skipGain = 0;
          for (const q of skipped) { q.visited = true; skipGain += KINDS[q.kind].score * mult + 1; }
          this.score += skipGain;
          this.skips = (this.skips || 0) + skipped.length;
          this.emit("skip", { planets: skipped.map((q) => ({ x: q.x, y: q.y, r: orbitR(q) })), count: skipped.length, gain: skipGain, x: P.x, y: P.y });
        }
      }
      const z = zoneAt(this.score);
      if (z !== this.zone) { this.zone = z; this.emit("zone", { zone: z }); }
      this.emit("capture", { planet: p, grade, gain, mult, combo: this.combo, x: P.x, y: P.y, fresh });
    } else this.emit("capture", { planet: p, grade, gain: 0, mult: 1, combo: this.combo, x: P.x, y: P.y, fresh });
  }

  /** 목숨을 잃을 상황. 금빛 방패가 있으면 어떤 이유든 한 번 구조한다. */
  kill(reason, hole = null) {
    const P = this.player;
    if (P.mode === "dead" || P.rescue) return;
    if (this.shield) { this.rescue(reason, hole); return; }
    P.mode = "dead";
    this.deathReason = reason;
    this.emit("death", { reason, x: P.x, y: P.y });
  }

  /** 지금 위치에서 가장 가까운 안전한 행성(터지지 않고, 공허보다 충분히 위) */
  safePlanet(x, y, margin = 90) {
    let best = null, bd = Infinity;
    for (const p of this.planets) {
      if (p.dead || p.fuse > 0 || p.y > this.voidY - margin) continue;
      const d = Math.hypot(p.x - x, p.y - y) + (p.visited ? 25 : 0) + (p.y > y ? 40 : 0); // 위쪽·새 행성을 조금 더 선호
      if (d < bd) { bd = d; best = p; }
    }
    return best || this.planets.filter((p) => !p.dead).sort((a, b) => a.y - b.y)[0];
  }

  /**
   * 방패 구조: 방패가 깨지면서 가장 가까운 안전한 행성으로 곧장 유도 비행한다.
   * 유도 비행 중에는 공허·블랙홀·소행성·화면 이탈에 걸리지 않는다. 블랙홀에서 구조되면 그 블랙홀은 무너진다.
   */
  rescue(reason, hole) {
    const P = this.player;
    this.shield = false;
    if (reason === "hole" && hole) {
      this.holes = this.holes.filter((h) => h !== hole);
      this.emit("holeCollapse", { x: hole.x, y: hole.y });
    }
    if (P.mode === "orbit") P.from = P.planet;
    P.mode = "fly";
    P.flyT = 0;
    P.curve = 0;
    P.rescue = this.safePlanet(P.x, P.y);
    this.voidY = Math.max(this.voidY, P.y + 70, P.rescue.y + 150);
    this.emit("shieldBreak", { x: P.x, y: P.y, reason });
  }

  /** 유도 비행 한 스텝: 목표 행성 궤도에 닿으면 붙잡힌다 */
  stepRescue(dt) {
    const P = this.player, p = P.rescue;
    if (p.dead) P.rescue = this.safePlanet(P.x, P.y);
    const q = P.rescue, dx = q.x - P.x, dy = q.y - P.y, d = Math.hypot(dx, dy) || 1;
    const sp = this.prof.speed * 1.6;
    // 부드럽게 방향을 틀며 날아간다
    const k = Math.min(1, dt * 10);
    P.vx += ((dx / d) * sp - P.vx) * k;
    P.vy += ((dy / d) * sp - P.vy) * k;
    P.x += P.vx * dt; P.y += P.vy * dt;
    P.flyT += dt;
    this.voidY = Math.max(this.voidY, P.y + 40);
    if (d <= orbitR(q) || P.flyT > 2.5) {
      if (d > orbitR(q)) { P.x = q.x; P.y = q.y - orbitR(q); }
      this.capture(q, P.x - q.x, P.y - q.y);
    }
  }

  /**
   * 부활: 죽은 자리에서 가장 가까운 안전한 행성 궤도에 다시 선다.
   * 공허를 아래로 밀어내고, 근처 블랙홀·소행성을 치우고, 보호용 금빛 방패를 하나 준다.
   */
  revive() {
    const P = this.player;
    if (P.mode !== "dead") return false;
    const dx = P.x, dy = P.y;
    const p = this.safePlanet(dx, dy, 140);
    if (p.fuse > 0) p.fuse = 0;
    this.holes = this.holes.filter((h) => Math.hypot(h.x - p.x, h.y - p.y) > 110);
    for (const r of this.rocks) if (Math.abs(r.y - p.y) < 70) r.x = -Math.sign(r.vx || 1) * r.span;
    P.planet = p;
    P.mode = "orbit";
    P.theta = -Math.PI / 2;
    P.dir = Math.random() < 0.5 ? 1 : -1;
    P.from = null;
    P.rescue = null;
    P.trail = [];
    this.placeOnOrbit();
    p.visited = true;
    this.voidY = Math.max(this.voidY, p.y + 220);
    this.shield = true;
    this.combo = 0;
    this.deathReason = null;
    this.revives = (this.revives || 0) + 1;
    this.emit("revive", { x: P.x, y: P.y, planet: p });
    return true;
  }

  cull() {
    const lim = this.voidY + 260;
    this.planets = this.planets.filter((p) => p.y < lim || p === this.player.planet);
    this.coins = this.coins.filter((c) => c.y < lim && !(c.got && c.y > this.player.y + 300));
    this.holes = this.holes.filter((h) => h.y < lim);
    this.rocks = this.rocks.filter((r) => r.y < lim);
    this.shields = this.shields.filter((s) => s.y < lim);
  }
}

export { orbitR };
