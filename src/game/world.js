// 궤도 점프: 게임 규칙과 물리. 화면·소리와 분리돼 있어서 Node 에서도 돌릴 수 있다(봇 검증용).
//
// 좌표: 픽셀 단위, x 오른쪽, y 아래쪽. 위로 올라갈수록 y 가 작아진다(높이 = -y).
// 플레이어는 행성 궤도를 돌다가(orbit) 탭하면 접선 방향으로 직선 비행(fly)하고,
// 다른 행성의 궤도 반경 안에 들어오면 그 궤도에 붙잡힌다. 블랙홀만 비행 경로를 휜다.

import { Rng } from "../vendor/pixelfx/core/math.js";

export const SPEED = 235; // 발사 속도(px/s)
export const STEP = 1 / 240; // 물리 고정 스텝
const TAU = Math.PI * 2;

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
  constructor(seed = 1, width = 200) {
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
    const N = hole ? 180 : 720;
    let worst = Infinity;
    for (const dir of [1, -1]) {
      const hit = new Uint8Array(N);
      for (let i = 0; i < N; i++) {
        const th = (i / N) * TAU;
        const x = a.baseX + Math.cos(th) * ro, y = a.y + Math.sin(th) * ro;
        const tx = -Math.sin(th) * dir, ty = Math.cos(th) * dir;
        if (hole) hit[i] = this.simulateHits(x, y, tx * SPEED, ty * SPEED, b, hole, a) ? 1 : 0;
        else {
          // 블랙홀이 없으면 직선이므로 계산으로 끝낸다
          const dx = b.baseX - x, dy = b.y - y, along = dx * tx + dy * ty, perp = Math.abs(dx * ty - dy * tx);
          hit[i] = along > 0 && perp < rb - 1.5 ? 1 : 0;
        }
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

  simulateHits(x, y, vx, vy, b, hole, from) {
    const rb = orbitR(b), dt = 1 / 90;
    const maxSteps = Math.ceil(((Math.hypot(b.baseX - x, b.y - y) + 60) / SPEED) * 90);
    for (let s = 0; s < maxSteps; s++) {
      if (hole) {
        const dx = hole.x - x, dy = hole.y - y, d2 = dx * dx + dy * dy, d = Math.sqrt(d2);
        if (d < hole.core + 2) return false;
        if (d < hole.reach) { const a = hole.pull / Math.max(60, d2); vx += (dx / d) * a * dt; vy += (dy / d) * a * dt; }
        const sp = Math.hypot(vx, vy); vx *= SPEED / sp; vy *= SPEED / sp;
      }
      x += vx * dt; y += vy * dt;
      if (Math.hypot(x - b.baseX, y - b.y) < rb - 1) return true;
      if (s > 20 && Math.hypot(x - from.baseX, y - from.y) < orbitR(from) - 1) return false;
      if (Math.abs(x) > this.colW / 2 + 50) return false;
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
    const th = P.theta, s = SPEED;
    P.vx = -Math.sin(th) * P.dir * s;
    P.vy = Math.cos(th) * P.dir * s;
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
    } else if (P.mode === "fly") {
      P.flyT += dt;
      for (const h of this.holes) {
        const dx = h.x - P.x, dy = h.y - P.y, d2 = dx * dx + dy * dy, d = Math.sqrt(d2);
        if (d < h.reach) {
          const a = h.pull / Math.max(60, d2);
          P.vx += (dx / d) * a * dt; P.vy += (dy / d) * a * dt;
          if (d < h.core + 1.5) { this.kill("hole"); return; }
          if (d < h.core + 13 && !h.passed) { h.passed = true; h.close = true; }
        } else if (h.close) {
          h.close = false;
          this.score += 2;
          this.emit("closeCall", { x: P.x, y: P.y });
        }
      }
      // 속도는 일정하게 유지(블랙홀은 방향만 휜다)
      const sp = Math.hypot(P.vx, P.vy), want = SPEED;
      P.vx *= want / sp; P.vy *= want / sp;
      P.x += P.vx * dt; P.y += P.vy * dt;
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
        if (this.shield) { this.shield = false; r.x = 1e6; this.emit("shieldBreak", { x: P.x, y: P.y }); }
        else { this.kill("rock"); return; }
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
      const z = zoneAt(this.score);
      if (z !== this.zone) { this.zone = z; this.emit("zone", { zone: z }); }
      this.emit("capture", { planet: p, grade, gain, mult, combo: this.combo, x: P.x, y: P.y, fresh });
    } else this.emit("capture", { planet: p, grade, gain: 0, mult: 1, combo: this.combo, x: P.x, y: P.y, fresh });
  }

  kill(reason) {
    const P = this.player;
    if (P.mode === "dead") return;
    if (this.shield && (reason === "void" || reason === "boom")) {
      // 방패가 한 번 살려 준다: 공허·폭발이면 위로 튕겨 올려 가장 가까운 위쪽 행성으로 날린다
      this.shield = false;
      const target = this.planets.find((p) => !p.dead && p.y < P.y - 20 && !p.visited) || this.planets[this.planets.length - 1];
      const dx = target.x - P.x, dy = target.y - P.y, L = Math.hypot(dx, dy);
      P.vx = (dx / L) * SPEED; P.vy = (dy / L) * SPEED;
      P.mode = "fly"; P.flyT = 0; P.from = P.planet;
      if (reason === "void") this.voidY = Math.max(this.voidY, P.y + 60);
      this.emit("shieldBreak", { x: P.x, y: P.y });
      return;
    }
    P.mode = "dead";
    this.deathReason = reason;
    this.emit("death", { reason, x: P.x, y: P.y });
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
