// 화면: World 를 픽셀 프레임에 그리고, World 가 내보내는 일(포획, 발사, 죽음…)을 이펙트와 소리로 바꾼다.

import {
  createFrame, clearFrame, createFx, composite, painterFor, Particles, P, Rng,
  hex, mix, at, fit, clamp, ease, tileFbm, TAU, WHITE, PAL,
} from "../vendor/pixelfx/core/index.js";

import * as critHit from "../vendor/pixelfx/fx/impacts/crit-hit.js";
import * as parry from "../vendor/pixelfx/fx/impacts/parry.js";
import * as collectBurst from "../vendor/pixelfx/fx/pickups/collect-burst.js";
import * as manaBurst from "../vendor/pixelfx/fx/arcane/mana-burst.js";
import * as fireworkBurst from "../vendor/pixelfx/fx/explosions/firework-burst.js";
import * as plasmaExplosion from "../vendor/pixelfx/fx/explosions/plasma-explosion.js";
import * as comboCounter from "../vendor/pixelfx/fx/ui/combo-counter.js";
import * as confetti from "../vendor/pixelfx/fx/ui/confetti.js";
import * as aurora from "../vendor/pixelfx/fx/weather/aurora.js";
import * as shootingStars from "../vendor/pixelfx/fx/weather/shooting-stars.js";
import * as zapHit from "../vendor/pixelfx/fx/lightning/zap-hit.js";
import * as sunburst from "../vendor/pixelfx/fx/holy/sunburst.js";

import { judgePop, tapRipple, noteBurst, feverBanner, skipLink } from "./fx-custom.js";
import { World, orbitR, ZONES, PATH_DT, FLIGHTS, launchState, pathPoint } from "./world.js";
import { drawPlanet, drawRock } from "./planets.js";
import { SKINS } from "./skins.js";

const INK = hex("#0b0716");
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const THEMES = [
  { sky: ["#02040c", "#040918", "#071026", "#0b1834", "#0f2040"], neb: ["#1f5cff", "#18c0c8"], star: "#bcd4ff" },
  { sky: ["#06020c", "#10051a", "#1c0828", "#280b36", "#330d42"], neb: ["#f53cd1", "#6a3cff"], star: "#ffd2f6" },
  { sky: ["#080402", "#140a06", "#22100a", "#30170e", "#3c1c10"], neb: ["#ff7a2a", "#ffc23d"], star: "#ffe6c4" },
  { sky: ["#010106", "#030414", "#060722", "#0b0a30", "#110c3a"], neb: ["#2fd88e", "#9c62e8"], star: "#d8fff0" },
  { sky: ["#070103", "#120306", "#1e050a", "#2a070e", "#360912"], neb: ["#ff2a4a", "#ff9a2a"], star: "#ffd0d0" },
].map((t) => ({ sky: t.sky.map(hex), neb: t.neb.map(hex), star: hex(t.star) }));
const VOID = ["#05010a", "#14031e", "#2a0634", "#4a0a4a", "#7a1258", "#c02a6a", "#ff5a8a", "#ffd0e0"].map(hex);
const RAINBOW = PAL.candy.map(hex);

export class View {
  constructor(canvas, sfx) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.sfx = sfx;
    this.px = document.createElement("canvas");
    this.pxCtx = this.px.getContext("2d");
    this.glowCv = document.createElement("canvas");
    this.glowCtx = this.glowCv.getContext("2d");
    this.blurCv = document.createElement("canvas");
    this.blurCtx = this.blurCv.getContext("2d");
    this.fx = [];
    this.time = 0;
    this.last = performance.now();
    this.shake = 0;
    this.flash = 0;
    this.flashColor = "#ffffff";
    this.slowmo = 0;
    this.freeze = 0;
    this.skin = SKINS[0];
    this.best = 0;
    this.tutorial = false;
    this.listeners = {};
    this.skyAurora = createFx(aurora, { x: 160, y: 180 });
    this.skyStars = createFx(shootingStars, { x: 160, y: 180 });
    this.skyCache = {};
    this.themeK = 0; // 현재 테마(실수: 구역 사이 전환)
    this.resize();
    this.newWorld(Math.floor(Math.random() * 1e9));
  }

  on(n, f) { this.listeners[n] = f; }
  emit(n, ...a) { this.listeners[n]?.(...a); }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cw = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const ch = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    this.canvas.width = cw; this.canvas.height = ch;
    const s = Math.max(1, Math.round(Math.min(cw / 200, ch / 260)));
    this.scale = s;
    const W = Math.ceil(cw / s), H = Math.ceil(ch / s);
    this.W = W; this.H = H;
    for (const c of [this.px, this.glowCv, this.blurCv]) { c.width = W; c.height = H; }
    this.frame = createFrame(W, H);
    this.img = this.pxCtx.createImageData(W, H);
    this.glowImg = this.glowCtx.createImageData(W, H);
    this.bg = new Uint32Array(W * H);
    this.bgKey = -1;
    this.colW = Math.min(W - 24, 210);
    // 성운: 세로로 이어지는 잡음 지도
    this.nebH = H * 2;
    this.neb = new Float32Array(W * this.nebH);
    this.neb2 = new Float32Array(W * this.nebH);
    const py = this.nebH / 70;
    for (let y = 0; y < this.nebH; y++)
      for (let x = 0; x < W; x++) {
        const v = tileFbm(x / 70, y / 70, 0, py, 11, 4);
        this.neb[y * W + x] = Math.max(0, v - 0.5) * 2.2;
        this.neb2[y * W + x] = tileFbm(x / 40, y / 40, 0, this.nebH / 40, 29, 2);
      }
    // 별: 세 겹 시차
    const R = new Rng(5);
    this.stars = [0.08, 0.2, 0.42].map((f, li) => ({
      f, list: Array.from({ length: Math.round((W * H) / [900, 1800, 4200][li]) }, () => ({ x: R.range(0, W), y: R.range(0, H * 2), tw: R.range(0, TAU), b: R.range(0.4, 1) })),
    }));
    const ks = Math.max(W / 320, H / 180), ox = (320 * ks - W) / 2, oy = (180 * ks - H) / 2;
    this.skyMapX = Int32Array.from({ length: W }, (_, x) => Math.min(319, Math.max(0, Math.floor((x + ox) / ks))));
    this.skyMapY = Int32Array.from({ length: H }, (_, y) => Math.min(179, Math.max(0, Math.floor((y + oy) / ks))) * 320);
    if (this.world) this.world.colW = this.colW;
  }

  flight() { return FLIGHTS[this.skin.flight] || FLIGHTS.hook; }

  newWorld(seed) {
    // 레벨은 지금 혜성의 비행 궤도로 "모든 점프가 가능한지" 검증하며 만든다
    this.world = new World(seed, this.colW, this.flight());
    this.fx = [];
    this.parts = new Particles({ rng: new Rng(seed ^ 77), sparks: this.skin.ramp.slice(3).reverse().map(hex) });
    this.camY = this.world.player.y - this.H * 0.62;
    this.dead = false;
    this.deadT = 0;
    this.bestBeaten = false;
    this.displayScore = 0;
  }

  /** 혜성을 바꾼다. 궤도가 달라지므로 플레이 중이 아니면 새 세계(새 검증)로 갈아 끼운다. */
  setSkin(skin, rebuild = true) {
    const changed = skin.flight !== this.skin.flight;
    this.skin = skin;
    if (changed && rebuild) this.newWorld(Math.floor(Math.random() * 1e9));
    else this.parts.sparks = skin.ramp.slice(3).reverse().map(hex);
  }

  spawn(mod, opts) {
    if (this.fx.length > 50) this.fx.shift();
    this.fx.push(createFx(mod, opts));
  }

  /** 부활: 세계에 부활을 요청하고, 성공하면 다시 살아난 화면으로 돌아간다 */
  revive() {
    const ok = this.world.revive();
    if (ok) this.handleEvents();
    return ok;
  }

  tap() {
    if (this.dead) return false;
    const ok = this.world.tap();
    return ok;
  }

  // ---------------------------------------------------------------------------------------
  handleEvents() {
    const w = this.world, S = this.sfx, sk = this.skin;
    for (const e of w.events) {
      switch (e.type) {
        case "launch": {
          S.launch();
          const back = Math.atan2(-e.vy, -e.vx);
          this.spawn(noteBurst, { x: e.x, y: e.y, angle: back, power: 0.5, palette: sk.ramp, seed: w.jumps });
          for (let i = 0; i < 8; i++) {
            const a = back + (Math.random() - 0.5) * 1.2, sp = 40 + Math.random() * 60;
            this.parts.spawn(P.SPARK, e.x, e.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.2 + Math.random() * 0.25);
          }
          break;
        }
        case "capture": {
          const p = e.planet, ro = orbitR(p);
          S.capture(e.grade, e.combo);
          this.spawn(tapRipple, { x: p.x, y: p.y, r: ro, palette: e.grade === "perfect" ? sk.ramp.slice(2) : ["#0c1430", "#1f4f94", "#58b4ec", "#d8f4ff", "#ffffff"] });
          const out = Math.atan2(e.y - p.y, e.x - p.x);
          if (!e.fresh) break;
          if (e.grade === "perfect") {
            this.spawn(collectBurst, { x: e.x, y: e.y, angle: out + Math.PI / 2, palette: sk.ramp.concat(["#ffffff"]).slice(-8), seed: w.jumps });
            this.spawn(noteBurst, { x: e.x, y: e.y, angle: out, power: 1.3, palette: sk.ramp, seed: w.jumps });
            this.freeze = 0.045;
            this.shake = Math.max(this.shake, 1.5);
            this.pop(e.mult > 1 ? `PERFECT +${e.gain}` : "PERFECT", ["#1a0c3a", "#3a1a7a", "#a070ff", "#7cf0ff", "#e0fcff", "#ffffff"], e.x, e.y - 14);
            if (e.combo >= 3 && e.combo % 3 === 0) {
              this.spawn(comboCounter, { x: 0, y: this.camY + 46, count: e.combo, label: "PERFECT", palette: sk.rainbow ? PAL.candy : PAL.neon, seed: e.combo });
              this.spawn(critHit, { x: e.x, y: e.y, angle: out, height: 0, palette: ["#2a1a08", "#6a4410", "#b07a1a", "#e8b030", "#ffe066", "#fff6c4", "#fffbe6", "#ffffff"], seed: e.combo });
              this.flash = 0.35; this.flashColor = "#c8b4ff";
            }
          } else if (e.grade === "great") {
            this.spawn(noteBurst, { x: e.x, y: e.y, angle: out, power: 0.8, palette: sk.ramp, seed: w.jumps });
            this.pop(`GREAT +${e.gain}`, ["#06202a", "#0c4a5a", "#18a0b0", "#4ce8d8", "#b4fff0", "#ffffff"], e.x, e.y - 14);
          } else {
            this.spawn(noteBurst, { x: e.x, y: e.y, angle: out, power: 0.35, palette: sk.ramp, seed: w.jumps });
            this.pop(`+${e.gain}`, ["#101a08", "#2a4410", "#5a8a20", "#a8d84a", "#e0ff9a", "#ffffff"], e.x, e.y - 14);
          }
          if (p.kind === "sun") this.spawn(parry, { x: e.x, y: e.y, angle: out + Math.PI / 2, height: 0, seed: 3 });
          if (!this.bestBeaten && this.best > 0 && w.score > this.best) {
            this.bestBeaten = true;
            S.best();
            this.spawn(confetti, { x: 0, y: this.camY + this.H * 0.55, seed: 4 });
            this.pop("NEW BEST!", PAL.gold, 0, this.camY + 70, 2);
          }
          break;
        }
        case "skip": {
          // 건너뛴 행성마다 차례로: 궤도 물결 + 금빛 폭죽 + 혜성까지 빛줄기, 마지막에 큰 SKIP 표시
          const gold = PAL.gold;
          e.planets.forEach((q, i) => {
            const delay = 0.08 + i * 0.12;
            this.spawn(skipLink, { x: q.x, y: q.y, tx: e.x - q.x, ty: e.y - q.y, delay, seed: i + 3 });
            setTimeout(() => {
              this.spawn(tapRipple, { x: q.x, y: q.y, r: q.r, palette: ["#4a2c08", "#c48412", "#ffe066", "#fff6c4", "#ffffff"] });
              this.spawn(collectBurst, { x: q.x, y: q.y, palette: gold, seed: 20 + i });
              S.bell(523 * Math.pow(2, [0, 4, 7, 12, 16, 19, 24][Math.min(6, i)] / 12), 0, 0.12, 0);
            }, delay * 1000);
          });
          const end = 0.08 + e.planets.length * 0.12 + 0.15;
          setTimeout(() => {
            this.spawn(comboCounter, { x: 0, y: this.camY + 60, count: e.count, label: "SKIP", palette: gold, seed: 40 + e.count });
            this.spawn(critHit, { x: e.x, y: e.y, angle: -Math.PI / 2, height: 0, palette: ["#2a1a08", "#6a4410", "#b07a1a", "#e8b030", "#ffe066", "#fff6c4", "#fffbe6", "#ffffff"], seed: 7 });
            this.pop(`SKIP +${e.gain}`, gold, e.x, e.y - 22);
            this.shake = Math.max(this.shake, 2 + e.count);
            this.flash = 0.45; this.flashColor = "#ffe9a0";
            S.zone();
          }, end * 1000);
          break;
        }
        case "coin":
          S.coin();
          this.spawn(collectBurst, { x: e.x, y: e.y, palette: PAL.gold, seed: 9 });
          break;
        case "closeCall":
          S.close();
          this.pop("CLOSE! +2", ["#1a0420", "#4a0a5c", "#8a1ca8", "#c84cf0", "#f08cff", "#ffffff"], e.x, e.y - 12);
          this.shake = Math.max(this.shake, 2);
          break;
        case "shield":
          S.shield();
          this.spawn(manaBurst, { x: e.x, y: e.y + 20, palette: PAL.holy, seed: 2 });
          this.pop("SHIELD", PAL.holy, e.x, e.y - 14);
          break;
        case "shieldBreak":
          S.shieldBreak();
          this.spawn(zapHit, { x: e.x, y: e.y, palette: PAL.electric, seed: 5 });
          this.spawn(manaBurst, { x: e.x, y: e.y + 20, palette: PAL.holy, seed: 6 });
          this.flash = 0.5; this.flashColor = "#ffe9a0";
          this.shake = Math.max(this.shake, 3);
          this.pop("SAVED!", PAL.holy, e.x, e.y - 16);
          break;
        case "holeCollapse":
          S.boom();
          this.spawn(plasmaExplosion, { x: e.x, y: e.y, palette: ["#05010a", "#1c0a30", "#4a1a8c", "#8a3ce0", "#c48cff", "#f0d8ff", "#ffffff"], seed: 21 });
          this.shake = Math.max(this.shake, 5);
          break;
        case "revive": {
          S.shield();
          this.dead = false;
          this.slowmo = 0;
          this.flash = 0.8; this.flashColor = "#fff2c0";
          this.spawn(manaBurst, { x: e.x, y: e.y + 24, palette: PAL.holy, seed: 8 });
          this.spawn(collectBurst, { x: e.x, y: e.y, palette: PAL.gold, seed: 8 });
          this.pop("REVIVE!", PAL.gold, e.x, e.y - 18);
          break;
        }
        case "planetBoom":
          S.boom();
          this.spawn(plasmaExplosion, { x: e.planet.x, y: e.planet.y, palette: ["#2a0604", "#6a1004", "#b02808", "#f05a10", "#ff9a2a", "#ffd86a", "#ffffff"], accent: ["#2a0a04", "#7a2a08", "#ff7a1a", "#ffd06a", "#fff6d0"], seed: e.planet.id });
          this.shake = Math.max(this.shake, 4);
          break;
        case "zone": {
          S.zone();
          const z = ZONES[e.zone];
          this.spawn(feverBanner, { x: 0, y: this.camY + this.H * 0.3, text: z.en, scale: z.en.length > 9 ? 2 : 3 });
          for (let i = 0; i < 3; i++) this.spawn(fireworkBurst, { x: (i - 1) * this.colW * 0.35, y: this.camY + this.H * (0.25 + 0.08 * i), seed: e.zone * 7 + i, palette: [PAL.neon, PAL.cyber, PAL.holy][i].slice(-7) });
          this.emit("zone", z);
          break;
        }
        case "death": {
          S.death();
          this.dead = true;
          this.deadT = 0;
          this.slowmo = 0.7;
          this.shake = 5;
          this.flash = 0.6; this.flashColor = "#ff5a7a";
          this.spawn(plasmaExplosion, { x: e.x, y: e.y, palette: fit(this.skin.ramp, 7).map((c) => c), seed: 13 });
          this.spawn(critHit, { x: e.x, y: e.y, angle: -Math.PI / 2, height: 0, seed: 2 });
          setTimeout(() => this.emit("death", this.result()), 900);
          break;
        }
      }
    }
    w.events.length = 0;
  }

  pop(text, palette, x, y, scale) {
    this.spawn(judgePop, { x, y, text, palette, scale });
  }

  result() {
    const w = this.world;
    return { score: w.score, jumps: w.jumps, perfects: w.perfects, maxCombo: w.maxCombo, coins: w.coinsGot, reason: w.deathReason, zone: w.zone };
  }

  // ---------------------------------------------------------------------------------------
  tick(now, mode) {
    let dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    let wdt = dt;
    if (this.slowmo > 0) { this.slowmo -= dt; wdt *= 0.25; }
    if (this.freeze > 0) { this.freeze -= dt; wdt = 0; }
    if (mode === "play" || mode === "title") {
      // 타이틀에서도 세계는 돌아간다(공허는 시작 전엔 멈춰 있다)
      this.world.update(wdt);
    }
    if (this.dead) this.deadT += dt;
    this.handleEvents();
    // 파티클: 비행 중 꼬리 불꽃
    const Pl = this.world.player;
    if (Pl.mode === "fly" && Math.random() < 0.8) {
      const a = Math.atan2(-Pl.vy, -Pl.vx) + (Math.random() - 0.5) * 0.8, sp = 20 + Math.random() * 30;
      this.parts.spawn(P.SPARK, Pl.x, Pl.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.15 + Math.random() * 0.2);
    }
    this.parts.update(wdt);
    for (const f of this.fx) f.update(wdt);
    this.fx = this.fx.filter((f) => !f.done());
    // 카메라
    if (!this.dead) {
      const target = Pl.y - this.H * 0.62;
      this.camY += (target - this.camY) * Math.min(1, dt * 3.2);
    }
    const tz = this.world.zone;
    this.themeK += (tz - this.themeK) * Math.min(1, dt * 0.8);
    if (Math.abs(tz - this.themeK) < 0.002) this.themeK = tz;
    this.displayScore += (this.world.score - this.displayScore) * Math.min(1, dt * 12);
    this.render(dt, mode);
  }

  theme() {
    const k = this.themeK, i = Math.floor(k), f = k - i, A = THEMES[i], B = THEMES[Math.min(THEMES.length - 1, i + 1)];
    return { sky: A.sky.map((c, j) => mix(c, B.sky[j], f)), neb: A.neb.map((c, j) => mix(c, B.neb[j], f)), star: mix(A.star, B.star, f), key: Math.round(k * 50) };
  }

  makeSky(th) {
    const { W, H } = this, out = this.bg, ramp = th.sky;
    for (let y = 0; y < H; y++) {
      const v = (y / H) * (ramp.length - 1), i = Math.floor(v), f = v - i;
      for (let x = 0; x < W; x++) out[y * W + x] = f > BAYER[((y & 3) << 2) | (x & 3)] ? ramp[Math.min(ramp.length - 1, i + 1)] : ramp[i];
    }
  }

  render(dt, mode) {
    const { W, H, frame } = this;
    const w = this.world, Pl = w.player;
    const camX = -Math.floor(W / 2), camY = Math.round(this.camY);
    frame.ox = camX; frame.oy = camY;
    clearFrame(frame);
    const th = this.theme();
    if (th.key !== this.bgKey) { this.bgKey = th.key; this.makeSky(th); }
    const T = this.time;

    // ---- 배경(화면 좌표). 화면 좌표 (sx, sy) 는 월드 (sx + camX, sy + camY)
    this.drawNebula(th, camY);
    this.drawStars(th, camY, T);
    const au = Math.min(1, Math.max(0, (this.themeK - 2.6) * 1.5), Math.max(0, (3.7 - this.themeK) * 1.5));
    if (au > 0.02) this.drawSky(this.skyAurora, au * 0.8, "aurora", dt);
    if (mode === "title") this.drawSky(this.skyStars, 0.9, "stars", dt);

    const p = painterFor(frame);
    // ---- 블랙홀
    for (const h of w.holes) this.drawHole(p, h, T);
    // ---- 궤도 점선
    const next = w.planets.filter((q) => !q.visited && !q.dead && q.y < Pl.y + 4).sort((a, b) => b.y - a.y)[0];
    for (const q of w.planets) {
      if (q.dead) continue;
      const ro = orbitR(q), cur = Pl.mode === "orbit" && Pl.planet === q;
      const isNext = q === next;
      const dots = Math.max(12, Math.round(ro * 1.1));
      const spin = cur ? T * q.omega * Pl.dir * 0.5 : T * 0.3;
      const col = cur ? hex(this.skin.ramp[4]) : isNext ? hex("#e0d8ff") : q.visited ? hex("#3a3460") : hex("#8a80c0");
      const a = cur ? 0.95 : isNext ? 0.75 + 0.25 * Math.sin(T * 5) : q.visited ? 0.45 : 0.6;
      for (let i = 0; i < dots; i++) {
        const ang = spin + (i / dots) * TAU;
        p.dot(q.x + Math.cos(ang) * ro, q.y + Math.sin(ang) * ro, col, a);
      }
      if (isNext) p.glowRing(q.x, q.y, ro, 3, col, 0.1 + 0.06 * Math.sin(T * 5));
      // 용암 퓨즈: 남은 시간 호
      if (q.fuse > 0) {
        const u = q.fuse / (q.fuseMax || 2.2);
        p.arc(q.x, q.y, ro + 2, 2, -Math.PI / 2, -Math.PI / 2 + TAU * u, () => (Math.sin(T * 30) > 0 ? hex("#ffd86a") : hex("#ff5a2a")), 1);
      }
    }
    // ---- 코인, 방패
    for (const c of w.coins) {
      if (c.got) continue;
      const bob = Math.sin(T * 3 + c.ph) * 1.5, wdt = Math.abs(Math.cos(T * 4 + c.ph));
      const G = fit(PAL.gold, 8);
      p.ellipse(c.x, c.y + bob, Math.max(1.2, 3.5 * wdt), 3.5, (d) => at(G, 0.95 - d * 0.6));
      p.ellipse(c.x, c.y + bob, Math.max(0.6, 3.5 * wdt), 3.5, (d) => (d > 0.75 ? G[2] : 0));
      p.glow(c.x, c.y + bob, 8, G[5], 0.3);
      if (Math.sin(T * 5 + c.ph) > 0.92) p.light(c.x - 1, c.y + bob - 1, WHITE, 1);
    }
    for (const s of w.shields) {
      if (s.got) continue;
      const H2 = fit(PAL.holy, 8);
      p.ring(s.x, s.y, 6, 1.5, H2[6], 0.9);
      p.circle(s.x, s.y, 3, (d) => at(H2, 0.9 - d * 0.5));
      p.glow(s.x, s.y, 14, H2[5], 0.4 + 0.15 * Math.sin(T * 6));
    }
    // ---- 행성
    for (const q of w.planets) {
      if (q.dead) continue;
      const heat = q.fuse > 0 ? clamp(1 - q.fuse / (q.fuseMax || 2.2)) : 0;
      const j = heat > 0.5 ? (heat - 0.5) * 2 : 0;
      drawPlanet(p, q, T, { heat, jx: j ? (Math.random() - 0.5) * 2 * j : 0, jy: j ? (Math.random() - 0.5) * 2 * j : 0 });
    }
    // 항성은 pixelfx 햇살 이펙트를 겹친다
    for (const q of w.planets) if (q.kind === "sun" && !q.dead) {
      q.sunFx = q.sunFx || createFx(sunburst, { x: q.x, y: q.y, seed: q.id, light: 0.8 });
      q.sunFx.update(dt);
      q.sunFx.draw(frame, "back");
    }
    const p2 = painterFor(frame);
    for (const r of w.rocks) drawRock(p2, r);

    // ---- 플레이어
    if (!this.dead) this.drawPlayer(p2, T, next);
    this.parts.draw(p2);
    // ---- 공허
    this.drawVoid(p2, T, camY);
    // ---- 이펙트
    for (const f of this.fx) f.draw(frame);

    // ---- HUD (화면 좌표: painter 를 카메라만큼 옮겨서 그린다)
    if (mode === "play") this.drawHud(T);

    // ---- 합성 + 후처리
    composite(frame, this.img.data, this.bg);
    this.pxCtx.putImageData(this.img, 0, 0);
    this.post(dt);
  }

  drawNebula(th, camY) {
    const { W, H, frame } = this, L = frame.light, N = this.neb, N2 = this.neb2, NH = this.nebH;
    const off = Math.floor(camY * 0.15);
    const a = th.neb[0], b = th.neb[1];
    const ar = a & 255, ag = (a >>> 8) & 255, ab = (a >>> 16) & 255, br = b & 255, bg = (b >>> 8) & 255, bb = (b >>> 16) & 255;
    for (let y = 0; y < H; y++) {
      const ny = (((y + off) % NH) + NH) % NH, row = ny * W, base = y * W;
      for (let x = 0; x < W; x++) {
        const v = N[row + x];
        if (v <= 0) continue;
        const m = N2[row + x], k = Math.min(0.55, v * 0.5);
        const r = (ar + (br - ar) * m) * k, g = (ag + (bg - ag) * m) * k, bl = (ab + (bb - ab) * m) * k;
        L[base + x] = (255 << 24) | ((bl & 255) << 16) | ((g & 255) << 8) | (r & 255);
      }
    }
  }

  drawStars(th, camY, T) {
    const { W, H, frame } = this, C = frame.color, L = frame.light;
    for (const layer of this.stars) {
      const off = camY * layer.f, span = H * 2;
      for (const s of layer.list) {
        const y = Math.floor((((s.y - off) % span) + span) % span);
        if (y >= H) continue;
        const x = Math.floor(s.x), i = y * W + x;
        const tw = 0.6 + 0.4 * Math.sin(T * 2 + s.tw);
        const c = mix(INK, th.star, s.b * tw * (0.5 + layer.f));
        C[i] = c;
        if (layer.f > 0.3 && s.b > 0.8) {
          L[i] = th.star;
          if (x > 0) C[i - 1] = mix(INK, th.star, 0.35 * tw);
          if (x < W - 1) C[i + 1] = mix(INK, th.star, 0.35 * tw);
        }
      }
    }
  }

  drawSky(fx, k, key, dt) {
    let sf = this.skyCache[key];
    if (!sf) sf = this.skyCache[key] = { frame: createFrame(320, 180), at: -1 };
    fx.update(dt);
    if (this.time - sf.at > 1 / 30) { clearFrame(sf.frame); fx.draw(sf.frame); sf.at = this.time; }
    const { W, H, frame, skyMapX: MX, skyMapY: MY } = this;
    const C = frame.color, L = frame.light, SC = sf.frame.color, SL = sf.frame.light;
    for (let y = 0; y < H; y++) {
      const row = MY[y], base = y * W;
      for (let x = 0; x < W; x++) {
        const si = row + MX[x], i = base + x, c = SC[si];
        if (c >>> 24) { const a = ((c >>> 24) * k * 0.8) | 0; if (a > 8) C[i] = (a << 24) | (c & 0xffffff); }
        const l = SL[si];
        if (l) {
          const d = L[i];
          L[i] = (255 << 24) | (Math.min(255, ((d >>> 16) & 255) + ((l >>> 16) & 255) * k) << 16) | (Math.min(255, ((d >>> 8) & 255) + ((l >>> 8) & 255) * k) << 8) | Math.min(255, (d & 255) + (l & 255) * k);
        }
      }
    }
  }

  drawHole(p, h, T) {
    // 강착원반: 기울어진 타원 고리가 돌고, 가운데는 완전한 검정
    const disk = fit(["#2a0a30", "#6a1a5a", "#c03a6a", "#ff7a4a", "#ffc46a", "#fff0c0"], 6);
    const n = 90;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + T * 1.6;
        const sa = Math.sin(a);
        if (pass === 0 ? sa > 0 : sa <= 0) continue;
        for (let rr = 10; rr <= 18; rr += 1.3) {
          const x = h.x + Math.cos(a) * rr, y = h.y + sa * rr * 0.34;
          const heat = 1 - (rr - 10) / 8;
          const c = disk[Math.min(5, Math.floor(heat * 5 + (Math.sin(a * 3 - T * 4) > 0.6 ? 1 : 0)))];
          p.dot(x, y, c, 0.35 + heat * 0.65);
        }
      }
      if (pass === 0) {
        // 사건의 지평선: 완전한 검정 원 + 얇게 빛나는 광자 고리(위쪽으로 휘어 보이는 원반)
        p.circle(h.x, h.y, h.core + 3, INK);
        p.ring(h.x, h.y, h.core + 4, 1, (v, ang) => (Math.sin(ang) < 0.2 ? disk[5] : disk[4]), 1);
        p.arc(h.x, h.y, h.core + 7, 1, Math.PI * 1.08, Math.PI * 1.92, disk[3], 0.8);
      }
    }
    p.glowRing(h.x, h.y, h.core + 9, 12, disk[3], 0.3);
    p.glowRing(h.x, h.y, h.core + 4, 3, disk[5], 0.5);
    // 지평선 안쪽은 빛도 없다: 빛 버퍼를 비우고, 앞쪽 원반이 가리지 않은 부분은 검게
    const F = this.frame, rr = h.core + 3;
    for (let yy = Math.floor(h.y - rr); yy <= h.y + rr; yy++)
      for (let xx = Math.floor(h.x - rr); xx <= h.x + rr; xx++) {
        if (Math.hypot(xx + 0.5 - h.x, yy + 0.5 - h.y) > rr) continue;
        const sx = xx - F.ox, sy = yy - F.oy;
        if (sx < 0 || sy < 0 || sx >= F.w || sy >= F.h) continue;
        const i = sy * F.w + sx;
        F.light[i] = 0;
        if (yy < h.y + 1) F.color[i] = INK;
      }
    // 영향권 표시: 흐릿한 점선
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * TAU - T * 0.5;
      p.dot(h.x + Math.cos(a) * (h.core + 13), h.y + Math.sin(a) * (h.core + 13), disk[2], 0.35);
    }
  }

  drawPlayer(p, T, next) {
    const w = this.world, Pl = w.player, R = this.skin.ramp.map(hex);
    const rainbow = this.skin.rainbow;
    // 꼬리
    const tr = Pl.trail, n = tr.length / 2;
    for (let i = 1; i < n; i++) {
      const u = i / n;
      const c = rainbow ? RAINBOW[(i + Math.floor(T * 12)) % RAINBOW.length] : at(R, 0.15 + u * 0.75);
      p.line(tr[(i - 1) * 2], tr[(i - 1) * 2 + 1], tr[i * 2], tr[i * 2 + 1], c, u * 0.95);
      if (i % 3 === 0) p.light(tr[i * 2], tr[i * 2 + 1], c, u * 0.35);
    }
    // 조준선: 지금 탭하면 날아갈 곡선 경로(실제 비행과 같은 계산). 끝으로 갈수록 흐려지며 사라진다.
    if (Pl.mode === "orbit") {
      const L = launchState(Pl.planet.x, Pl.planet.y, orbitR(Pl.planet), Pl.theta, Pl.dir, w.prof);
      const tut = this.tutorial && w.jumps < 4;
      const len = tut ? 100 : 70;
      const perPx = 1 / (w.prof.speed * PATH_DT); // 경로 표의 칸 수 / px
      const at = (sArc) => pathPoint(L, Math.min(L.path.length - 1, Math.max(0, Math.round(sArc * perPx))), [0, 0]);
      const fade = (sArc) => Math.pow(Math.max(0, 1 - sArc / len), 1.35);
      // 은은한 빛: 짧은 조각마다 세기를 줄여 가며
      for (let sa = 4; sa < len; sa += 6) {
        const [x0, y0] = at(sa), [x1, y1] = at(sa + 6);
        p.glowLine(x0, y0, x1, y1, 5, R[4], 0.24 * fade(sa));
      }
      // 발사 방향으로 흘러가는 점선(어두운 외곽선 위에 밝은 대시)
      const dash = 4, gap = 3, step = dash + gap, ph = (T * 34) % step;
      const segs = [];
      for (let d = 5 + ph - step; d < len; d += step) {
        const s0 = Math.max(5, d), s1 = Math.min(len, d + dash);
        if (s1 > s0 && fade(s0) > 0.04) segs.push([s0, s1]);
      }
      const piece = (s0, s1, wdt, c, k) => {
        // 대시 하나를 1.5px 마디로 나눠 곡선을 따라 그린다
        let [px, py] = at(s0);
        for (let sa = s0 + 1.5; sa <= s1 + 0.01; sa += 1.5) {
          const [nx, ny] = at(Math.min(sa, s1));
          p.beam(px, py, nx, ny, wdt, c, k);
          px = nx; py = ny;
        }
      };
      // 끝으로 갈수록 가늘어지고(굵기) 옅어진다(디더)
      const wd = (s0) => 0.5 + 0.5 * fade(s0);
      for (const [s0, s1] of segs) piece(s0, s1, 1.8 + 2.8 * wd(s0), INK, 0.7 * fade(s0));
      for (const [s0, s1] of segs) piece(s0, s1, 1 + 1.8 * wd(s0), (u, v) => (v < 0.6 ? WHITE : R[5]), Math.min(1, 1.2 * fade(s0)));
    }
    // 몸
    if (Pl.rescue) p.glow(Pl.x, Pl.y, 22, hex("#ffd84a"), 0.7);
    p.glow(Pl.x, Pl.y, 14, R[4], 0.6);
    p.circle(Pl.x, Pl.y, 2.6, (d) => (d < 0.4 ? WHITE : R[5]));
    p.px(Pl.x, Pl.y, WHITE);
    if (w.shield) {
      p.ring(Pl.x, Pl.y, 7 + Math.sin(T * 8) * 0.6, 1, hex("#ffe066"), 0.8);
      p.glowRing(Pl.x, Pl.y, 7, 3, hex("#ffd84a"), 0.3);
    }
    // 튜토리얼: 다음 행성 화살표
    if (this.tutorial && w.jumps < 4 && next && Pl.mode === "orbit") {
      const ro = orbitR(next), b = Math.sin(T * 6) * 2;
      p.text("HERE", next.x, next.y - ro - 12 + b, hex("#ffffff"), { font: "mini", align: "center", outline: INK });
    }
  }

  drawVoid(p, T, camY) {
    const w = this.world, top = w.voidY, { W, H } = this;
    const sy0 = Math.max(0, Math.floor(top - camY - 6));
    if (sy0 >= H) return;
    const C = this.frame.color, L = this.frame.light, camX = this.frame.ox;
    for (let sy = sy0; sy < H; sy++) {
      const wy = sy + camY, base = sy * W;
      for (let sx = 0; sx < W; sx++) {
        const wx = sx + camX;
        const edge = top + Math.sin(wx * 0.09 + T * 2.2) * 2.5 + Math.sin(wx * 0.23 - T * 3.1) * 1.5;
        const d = wy - edge;
        if (d < 0) continue;
        const nz = tileFbm(wx * 0.05, wy * 0.05 - T * 0.6, 0, 0, 3, 2);
        const k = d < 1.5 ? 7 : d < 3 ? 6 : Math.max(0, Math.min(5, Math.floor(5 - d / 7 + nz * 3)));
        C[base + sx] = VOID[k];
        if (k >= 4) {
          const c = VOID[k], s = (k - 3) * 0.25;
          L[base + sx] = (255 << 24) | ((((c >>> 16) & 255) * s) << 16) | ((((c >>> 8) & 255) * s) << 8) | ((c & 255) * s);
        }
      }
    }
    // 위로 튀는 불티
    if (Math.random() < 0.5) {
      const x = camX + Math.random() * W;
      this.parts.spawn(P.EMBER, x, top, (Math.random() - 0.5) * 10, -20 - Math.random() * 30, 0.6 + Math.random() * 0.6, VOID[6]);
    }
  }

  drawHud(T) {
    const p = painterFor(this.frame);
    p.place(this.frame.ox, this.frame.oy);
    const { W } = this, w = this.world;
    const sc = String(Math.round(this.displayScore));
    p.text(sc, W / 2, 10, (gx, gy) => (gy < 2 ? WHITE : gy < 5 ? hex("#e0d8ff") : hex("#a090e0")), { font: "big", scale: 3, align: "center", outline: INK });
    const mult = 1 + Math.floor(w.combo / 3);
    if (mult > 1) p.text(`x${mult}`, W / 2, 36, (gx) => RAINBOW[Math.floor(gx / 2 + T * 10) % RAINBOW.length], { font: "big", scale: 1, align: "center", outline: INK });
    // 코인
    const G = fit(PAL.gold, 8);
    p.ellipse(10, 12, 3, 3, (d) => at(G, 0.95 - d * 0.6));
    p.text(String(w.coinsGot), 16, 10, G[6], { font: "mini", outline: INK });
    // 구역 이름
    p.text(ZONES[w.zone].en, W - 6, 10, hex("#a8a0d8"), { font: "mini", align: "right", outline: INK });
    // 공허 경고
    const gap = w.voidY - w.player.y;
    if (w.started && gap < 70 && !this.dead) {
      const k = 1 - gap / 70;
      p.text("!", W / 2, this.H - 18, VOID[6], { font: "big", scale: 2, align: "center", outline: INK, a: 0.5 + 0.5 * Math.sin(T * 14) * k });
      this.danger = k;
    } else this.danger = 0;
  }

  post(dt) {
    const ctx = this.ctx, s = this.scale, { W, H, frame } = this;
    this.shake = Math.max(0, this.shake - dt * 12);
    const sx = this.shake > 0.2 ? Math.round((Math.random() * 2 - 1) * this.shake) * s : 0;
    const sy = this.shake > 0.2 ? Math.round((Math.random() * 2 - 1) * this.shake) * s : 0;
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#02030a";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.px, sx, sy, W * s, H * s);
    // 블룸
    const Lb = frame.light, G = this.glowImg.data;
    for (let i = 0, n = W * H; i < n; i++) {
      const l = Lb[i], j = i * 4;
      G[j] = l & 255; G[j + 1] = (l >>> 8) & 255; G[j + 2] = (l >>> 16) & 255; G[j + 3] = 255;
    }
    this.glowCtx.putImageData(this.glowImg, 0, 0);
    const b = this.blurCtx;
    b.globalCompositeOperation = "copy";
    b.filter = "blur(3px)";
    b.drawImage(this.glowCv, 0, 0);
    b.filter = "none";
    ctx.globalCompositeOperation = "lighter";
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(this.blurCv, sx, sy, W * s, H * s);
    ctx.globalAlpha = 0.3;
    ctx.drawImage(this.blurCv, sx - 6 * s, sy - 6 * s, (W + 12) * s, (H + 12) * s);
    // 섬광
    this.flash = Math.max(0, this.flash - dt * 2.5);
    if (this.flash > 0) {
      ctx.globalAlpha = this.flash * 0.4;
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    ctx.globalCompositeOperation = "source-over";
    if (this.danger > 0) {
      const cw = this.canvas.width, ch = this.canvas.height;
      const g = ctx.createLinearGradient(0, ch, 0, ch * 0.55);
      g.addColorStop(0, `rgba(255,40,110,${0.35 * this.danger})`);
      g.addColorStop(1, "rgba(255,40,110,0)");
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cw, ch);
    }
    ctx.globalAlpha = 1;
  }
}
