// 무대: 픽셀 프레임 하나에 배경 · 판정 링 · 코어 · 노트 · 이펙트 · HUD 를 그리고,
// 재생 중에는 오디오 시계에 맞춰 노트를 움직이고 판정한다.

import {
  createFrame, clearFrame, createFx, composite, painterFor,
  RAMP, PAL, hex, mix, at, fit, scale as scaleColor, clamp, ease, TAU, WHITE, Rng,
} from "../vendor/pixelfx/core/index.js";

import * as critHit from "../vendor/pixelfx/fx/impacts/crit-hit.js";
import * as hitSpark from "../vendor/pixelfx/fx/impacts/hit-spark.js";
import * as parry from "../vendor/pixelfx/fx/impacts/parry.js";
import * as collectBurst from "../vendor/pixelfx/fx/pickups/collect-burst.js";
import * as manaBurst from "../vendor/pixelfx/fx/arcane/mana-burst.js";
import * as fireworkBurst from "../vendor/pixelfx/fx/explosions/firework-burst.js";
import * as plasmaExplosion from "../vendor/pixelfx/fx/explosions/plasma-explosion.js";
import * as comboCounter from "../vendor/pixelfx/fx/ui/combo-counter.js";
import * as countdown from "../vendor/pixelfx/fx/ui/countdown.js";
import * as confetti from "../vendor/pixelfx/fx/ui/confetti.js";
import * as aurora from "../vendor/pixelfx/fx/weather/aurora.js";
import * as shootingStars from "../vendor/pixelfx/fx/weather/shooting-stars.js";
import * as zapHit from "../vendor/pixelfx/fx/lightning/zap-hit.js";

import { judgePop, tapRipple, noteBurst, feverBanner, coreCrack } from "./fx-custom.js";

export const JUDGE = { perfect: 0.045, great: 0.09, good: 0.135 };
const WEIGHT = { perfect: 1, great: 0.7, good: 0.4, miss: 0 };

const INK = hex("#0b0716");
const NOTE_RAMPS = {
  beat: RAMP.cyber,
  half: RAMP.neon,
  quarter: fit(["#0f1a08", "#1f4410", "#3a7a18", "#6cc02a", "#b4f04a", "#e8ff9a", "#ffffff"], 8),
  gold: RAMP.gold,
};
const RING = fit(["#120a2a", "#2a1460", "#5a2ab0", "#8c5cf0", "#c8a8ff", "#f0e6ff", "#ffffff"], 7);
const CORE = fit(["#0a0620", "#1c0e4a", "#3a1a8a", "#6a2cc8", "#a050f0", "#e090ff", "#ffe0ff", "#ffffff"], 8);
const CORE_HURT = RAMP.blood;
const RAINBOW = PAL.candy.map(hex);
const HPCOL = [hex("#ff3a4a"), hex("#ffb02a"), hex("#ffe03c"), hex("#5ad84a")];

// 배경 그라디언트(위 → 아래), 평상시와 피버
const SKY = ["#05040e", "#080618", "#0d0924", "#140c33", "#1d0f42", "#280f4c"].map(hex);
const SKY_FEVER = ["#06020e", "#0f041e", "#1c0630", "#2c0842", "#3e0a50", "#560c5a"].map(hex);
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

export class Stage {
  constructor(canvas, audio) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.audio = audio; // { ctx, analyser, master }
    this.px = document.createElement("canvas");
    this.pxCtx = this.px.getContext("2d");
    this.glowCv = document.createElement("canvas");
    this.glowCtx = this.glowCv.getContext("2d");
    this.blurCv = document.createElement("canvas");
    this.blurCtx = this.blurCv.getContext("2d");
    this.settings = { offset: 0, speed: 1, hitSound: true, volume: 0.9, noFail: false, bloom: true };
    this.mode = "idle"; // idle | play | paused | result | failed
    this.fx = [];
    this.bgFx = [];
    this.stars = [];
    this.polys = [];
    this.shake = 0;
    this.flash = 0;
    this.redFlash = 0;
    this.time = 0;
    this.lastNow = performance.now();
    this.spectrum = new Uint8Array(audio.analyser.frequencyBinCount);
    this.skyAurora = createFx(aurora, { x: 160, y: 180 });
    this.skyStars = createFx(shootingStars, { x: 160, y: 180 });
    this.auroraMix = 0;
    this.listeners = {};
    this.resize();
  }

  on(name, fn) { this.listeners[name] = fn; }
  emit(name, ...args) { this.listeners[name]?.(...args); }

  // ------------------------------------------------------------------------------------------
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cw = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const ch = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    this.canvas.width = cw;
    this.canvas.height = ch;
    // 짧은 변이 약 250 픽셀이 되도록 정수배 확대
    const s = Math.max(1, Math.round(Math.min(cw, ch) / 250));
    this.scale = s;
    const W = Math.ceil(cw / s), H = Math.ceil(ch / s);
    this.W = W; this.H = H;
    this.px.width = W; this.px.height = H;
    this.glowCv.width = W; this.glowCv.height = H;
    this.blurCv.width = W; this.blurCv.height = H;
    this.frame = createFrame(W, H);
    this.img = this.pxCtx.createImageData(W, H);
    this.glowImg = this.glowCtx.createImageData(W, H);
    this.cx = Math.floor(W / 2);
    this.playCy = Math.floor(H / 2) + (H > W ? 0 : 6);
    this.idleCy = Math.round(H * (H > W ? 0.42 : 0.45));
    this.Rbase = Math.round(Math.min(W, H) * 0.2);
    this.layoutK = this.mode === "idle" ? 0 : 1;
    this.applyLayout();
    this.spawnR = Math.hypot(W, H) / 2 + 12;
    this.bgNormal = this.makeSky(SKY);
    this.bgFever = this.makeSky(SKY_FEVER);
    // 320x180 하늘 이펙트를 화면에 '꽉 차게(cover)' 늘리는 좌표표
    const ks = Math.max(W / 320, H / 180), ox = (320 * ks - W) / 2, oy = (180 * ks - H) / 2;
    this.skyMapX = Int32Array.from({ length: W }, (_, x) => Math.min(319, Math.max(0, Math.floor((x + ox) / ks))));
    this.skyMapY = Int32Array.from({ length: H }, (_, y) => Math.min(179, Math.max(0, Math.floor((y + oy) / ks))) * 320);
    if (!this.stars.length) {
      const R = new Rng(7);
      for (let i = 0; i < 170; i++) this.stars.push({ a: R.range(0, TAU), d: R.range(2, 1), z: R.range(0.2, 1), tw: R.range(0, TAU) });
    }
    for (const s of this.stars) s.d = Math.random() * this.spawnR;
  }

  // 대기 화면에서는 코어를 조금 위로, 작게 둔다(타이틀 UI 와 겹치지 않게). 플레이 중엔 정중앙.
  applyLayout() {
    const k = this.layoutK;
    this.cy = Math.round(this.idleCy + (this.playCy - this.idleCy) * k);
    this.R = Math.round(this.Rbase * (0.78 + 0.22 * k));
    this.Rc = Math.round(this.R * 0.5);
  }

  makeSky(ramp) {
    const { W, H } = this, out = new Uint32Array(W * H);
    for (let y = 0; y < H; y++) {
      const v = (y / H) * (ramp.length - 1);
      const i = Math.floor(v), f = v - i;
      for (let x = 0; x < W; x++) {
        const c = f > BAYER[((y & 3) << 2) | (x & 3)] ? ramp[Math.min(ramp.length - 1, i + 1)] : ramp[i];
        out[y * W + x] = c;
      }
    }
    // 가운데가 약간 밝은 비네트
    const cx = W / 2, cy = H / 2, md = Math.hypot(cx, cy);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const d = Math.hypot(x - cx, y - cy) / md, k = 1.25 - d * 0.6;
        out[y * W + x] = scaleColor(out[y * W + x], k);
      }
    return out;
  }

  // ------------------------------------------------------------------------------------------
  // 재생 준비
  load(song, analysis, chart) {
    this.song = song;
    this.analysis = analysis;
    this.chart = chart;
    this.notes = chart.notes.map((n) => ({ ...n, judged: null, hitAt: 0 }));
    this.approach = chart.approach / this.settings.speed;
    this.reset();
  }

  reset() {
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.hp = 100;
    this.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    this.offsets = [];
    this.weightSum = 0;
    this.judgedCount = 0;
    this.nextNote = 0;
    this.nextBeat = 0;
    this.feverOn = false;
    this.feverIdx = 0;
    this.countdownShown = false;
    this.fx = [];
    this.polys = [];
    for (const n of this.notes) { n.judged = null; n.hitAt = 0; }
  }

  start() {
    const { ctx } = this.audio;
    this.stopSource();
    this.reset();
    const first = this.notes.length ? this.notes[0].t : 1;
    this.leadIn = Math.max(3.3, this.approach + 0.8 - first);
    const src = ctx.createBufferSource();
    src.buffer = this.song.buffer;
    src.connect(this.audio.music);
    this.audio.music.gain.cancelScheduledValues(ctx.currentTime);
    this.audio.music.gain.setValueAtTime(1, ctx.currentTime);
    this.startCtx = ctx.currentTime + this.leadIn;
    src.start(this.startCtx);
    src.onended = () => { if (this.source === src && this.mode === "play") this.finish(); };
    this.source = src;
    this.clockOffset = null;
    this.mode = "play";
    this.endAt = Math.min(this.song.buffer.duration, (this.notes.at(-1)?.t ?? 0) + 6);
  }

  stopSource() {
    if (this.source) {
      try { this.source.onended = null; this.source.stop(); } catch {}
      this.source.disconnect();
      this.source = null;
    }
  }

  pause() {
    if (this.mode !== "play") return;
    this.mode = "paused";
    this.pausedSong = this.songTime();
    this.audio.ctx.suspend();
  }

  async resume() {
    if (this.mode !== "paused") return;
    await this.audio.ctx.resume();
    this.clockOffset = null;
    this.mode = "play";
  }

  quit() {
    this.stopSource();
    this.mode = "idle";
    this.fx = [];
    if (this.audio.ctx.state === "suspended") this.audio.ctx.resume();
  }

  // ------------------------------------------------------------------------------------------
  // 시계: 지금 스피커에서 나오고 있는 곡 위치(초). 오디오 출력 지연을 반영한다.
  rawSongTime(perfMs) {
    const ctx = this.audio.ctx;
    let ct;
    const ts = ctx.getOutputTimestamp ? ctx.getOutputTimestamp() : null;
    if (ts && ts.performanceTime > 0 && ts.contextTime > 0) ct = ts.contextTime + (perfMs - ts.performanceTime) / 1000;
    else ct = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0) + (perfMs - performance.now()) / 1000;
    return ct - this.startCtx;
  }
  updateClock(perfMs) {
    const raw = this.rawSongTime(perfMs) - perfMs / 1000;
    if (this.clockOffset === null || Math.abs(raw - this.clockOffset) > 0.04) this.clockOffset = raw;
    else this.clockOffset += (raw - this.clockOffset) * 0.06;
  }
  songTime(perfMs = performance.now()) {
    if (this.mode === "paused") return this.pausedSong;
    if (this.clockOffset === null) this.updateClock(perfMs);
    return perfMs / 1000 + this.clockOffset - this.settings.offset / 1000;
  }

  // ------------------------------------------------------------------------------------------
  // 입력
  tap(perfMs) {
    if (this.mode !== "play") return;
    const t = this.songTime(perfMs);
    this.spawn(tapRipple, { x: this.cx, y: this.cy, r: this.R, palette: PAL.ice });
    this.ringFlash = 1;
    // 아직 판정 안 된 노트 중 창 안에 들어온 가장 이른 것
    let best = null;
    for (let i = this.nextNote; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.t - t > JUDGE.good) break;
      if (n.judged) continue;
      if (t - n.t > JUDGE.good) continue;
      best = n;
      break;
    }
    if (!best) return;
    const dt = t - best.t, a = Math.abs(dt);
    const j = a <= JUDGE.perfect ? "perfect" : a <= JUDGE.great ? "great" : "good";
    this.offsets.push(dt);
    this.judge(best, j);
    if (this.settings.hitSound) this.hitSound(j, best.gold);
  }

  hitSound(j, gold) {
    const { ctx, sfx } = this.audio;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "triangle";
    const f = gold ? 1760 : j === "perfect" ? 1320 : j === "great" ? 1100 : 880;
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.5, t + 0.07);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.22 * this.settings.volume, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
    o.connect(g).connect(sfx);
    o.start(t);
    o.stop(t + 0.1);
  }

  judge(n, j) {
    n.judged = j;
    n.hitAt = this.time;
    this.counts[j]++;
    this.judgedCount++;
    const N = Math.max(1, this.notes.length);
    const hx = this.cx + Math.cos(n.angle) * this.R, hy = this.cy + Math.sin(n.angle) * this.R;
    const out = n.angle; // 바깥쪽을 향하는 각도
    const up = n.angle + Math.PI / 2; // 로컬 위쪽이 바깥을 향하도록
    if (j === "miss") {
      this.combo = 0;
      if (!this.settings.noFail || this.hp > 1) this.hp = Math.max(this.settings.noFail ? 1 : 0, this.hp - this.chart.hpLoss);
      this.spawn(coreCrack, { x: this.cx, y: this.cy, r: this.Rc, angle0: n.angle, seed: n.id + 1 });
      this.spawn(zapHit, { x: this.cx + Math.cos(n.angle) * this.Rc, y: this.cy + Math.sin(n.angle) * this.Rc, angle: n.angle + Math.PI, palette: PAL.blood, seed: n.id });
      this.pop("MISS", PAL.blood, this.cx + Math.cos(n.angle) * (this.Rc + 14), this.cy + Math.sin(n.angle) * (this.Rc + 14));
      this.shake = Math.max(this.shake, 3);
      this.redFlash = 1;
      this.coreHurt = 1;
      if (this.hp <= 0 && !this.settings.noFail) this.fail();
      return;
    }
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const w = WEIGHT[j];
    this.weightSum += w;
    this.score = Math.round((900000 * this.weightSum) / N + (100000 * this.maxCombo) / N);
    const regen = (j === "perfect" ? 1.6 : j === "great" ? 0.9 : 0.2) * (this.feverOn ? 2 : 1);
    this.hp = Math.min(100, this.hp + regen);
    const ramp = n.gold ? PAL.gold : this.noteRampHex(n);
    if (n.gold && j !== "good") {
      this.spawn(critHit, { x: hx, y: hy, angle: out, height: 0, palette: ["#2a1a08", "#6a4410", "#b07a1a", "#e8b030", "#ffe066", "#fff6c4", "#fffbe6", "#ffffff"], seed: n.id });
      this.spawn(parry, { x: hx, y: hy, angle: up, height: 0, seed: n.id });
      this.shake = Math.max(this.shake, 2.5);
      this.flash = 0.6;
    } else if (j === "perfect") {
      this.spawn(collectBurst, { x: hx, y: hy, angle: up, palette: ramp, seed: n.id });
      this.spawn(noteBurst, { x: hx, y: hy, angle: out, power: 1.3, palette: ramp, seed: n.id });
    } else if (j === "great") {
      this.spawn(hitSpark, { x: hx, y: hy, angle: out, height: 0, palette: fit(ramp, 7), seed: n.id });
      this.spawn(noteBurst, { x: hx, y: hy, angle: out, power: 0.8, palette: ramp, seed: n.id });
    } else {
      this.spawn(noteBurst, { x: hx, y: hy, angle: out, power: 0.35, palette: ramp, seed: n.id });
    }
    const label = { perfect: "PERFECT", great: "GREAT", good: "GOOD" }[j];
    const pal = { perfect: ["#1a0c3a", "#3a1a7a", "#a070ff", "#7cf0ff", "#e0fcff", "#ffffff"], great: ["#06202a", "#0c4a5a", "#18a0b0", "#4ce8d8", "#b4fff0", "#ffffff"], good: ["#101a08", "#2a4410", "#5a8a20", "#a8d84a", "#e0ff9a", "#ffffff"] }[j];
    const px = this.cx + Math.cos(n.angle) * (this.R + 22), py = this.cy + Math.sin(n.angle) * (this.R + 22);
    this.pop(label, pal, px, py);
    this.coreKick = 1;
    // 콤보 이정표
    const c = this.combo;
    if (c === 25 || (c > 0 && c % 50 === 0)) {
      this.spawn(comboCounter, { x: this.cx, y: Math.max(40, this.cy - this.R - 52), count: c, label: "COMBO", palette: this.feverOn ? PAL.candy.slice().reverse() : PAL.neon, seed: c });
      this.spawn(manaBurst, { x: this.cx, y: this.cy + 26, palette: PAL.arcane, seed: c });
      this.flash = Math.max(this.flash, 0.35);
    }
  }

  pop(text, palette, x, y) {
    // 같은 자리에 판정 글자가 겹쳐 쌓이지 않도록 이전 것을 지운다
    this.fx = this.fx.filter((f) => !(f.mod === judgePop && Math.hypot(f.fx.options.x - x, f.fx.options.y - y) < 30));
    this.spawn(judgePop, { x, y, text, palette });
  }

  spawn(mod, opts, list = this.fx) {
    const max = list === this.fx ? 60 : 12;
    if (list.length >= max) list.shift();
    list.push({ mod, fx: createFx(mod, opts) });
  }

  noteRampHex(n) {
    if (n.kind === "half") return PAL.neon;
    if (n.kind === "quarter") return ["#0f1a08", "#1f4410", "#3a7a18", "#6cc02a", "#b4f04a", "#e8ff9a", "#ffffff"];
    return PAL.cyber;
  }

  fail() {
    this.mode = "failed";
    const { ctx } = this.audio;
    const t = ctx.currentTime;
    // 테이프가 멈추듯 느려지며 꺼진다
    if (this.source) {
      this.source.playbackRate.setValueAtTime(1, t);
      this.source.playbackRate.exponentialRampToValueAtTime(0.08, t + 1.2);
    }
    this.audio.music.gain.setValueAtTime(1, t);
    this.audio.music.gain.linearRampToValueAtTime(0, t + 1.3);
    this.spawn(plasmaExplosion, { x: this.cx, y: this.cy, palette: PAL.blood, accent: PAL.shadow.slice(3), seed: 3 });
    setTimeout(() => { this.stopSource(); this.emit("fail", this.result(true)); }, 1400);
  }

  finish() {
    if (this.mode !== "play") return;
    this.mode = "result";
    const { ctx } = this.audio;
    const t = ctx.currentTime;
    this.audio.music.gain.setValueAtTime(this.audio.music.gain.value, t);
    this.audio.music.gain.linearRampToValueAtTime(0, t + 1.5);
    setTimeout(() => this.stopSource(), 1600);
    const r = this.result(false);
    this.celebrate(r);
    this.emit("end", r);
  }

  celebrate(r) {
    const good = r.rank.startsWith("S") || r.rank === "A";
    this.spawn(confetti, { x: this.cx, y: this.H - 8, seed: 5 });
    if (good) {
      const R = new Rng(11);
      for (let i = 0; i < (r.rank.startsWith("S") ? 6 : 3); i++)
        setTimeout(() => this.spawn(fireworkBurst, { x: R.range(40, this.W - 40), y: R.range(this.H * 0.3, this.H * 0.55), seed: i + 1, palette: [PAL.neon, PAL.cyber, PAL.candy][i % 3].slice(-7) }), i * 420);
    }
  }

  result(failed) {
    const N = this.notes.length;
    const acc = N ? this.weightSum / N : 0;
    const score = failed ? this.score : Math.round(900000 * acc + (100000 * this.maxCombo) / Math.max(1, N));
    const rank = failed ? "F" : score >= 980000 ? "S+" : score >= 950000 ? "S" : score >= 900000 ? "A" : score >= 800000 ? "B" : score >= 700000 ? "C" : "D";
    const mean = this.offsets.length ? this.offsets.reduce((a, b) => a + b, 0) / this.offsets.length : 0;
    return {
      failed, score, rank, acc, maxCombo: this.maxCombo, counts: { ...this.counts }, notes: N,
      fullCombo: !failed && this.counts.miss === 0 && N > 0, allPerfect: !failed && this.counts.perfect === N && N > 0,
      meanOffset: mean, hits: this.offsets.length,
    };
  }

  // ------------------------------------------------------------------------------------------
  // 매 프레임
  frameTick(now) {
    const t0 = performance.now();
    this.frameTickInner(now);
    // 자동 화질: 프레임 처리 시간이 계속 길면 무거운 연출을 줄인다
    const cost = performance.now() - t0;
    this.costEma = (this.costEma ?? cost) * 0.97 + cost * 0.03;
    if (!this.lowQuality && this.costEma > 13) this.lowQuality = true;
  }

  frameTickInner(now) {
    const dt = Math.min(0.05, (now - this.lastNow) / 1000);
    this.lastNow = now;
    this.time += dt;
    let song = null;
    if (this.mode === "play") {
      this.updateClock(now);
      song = this.songTime(now);
      this.updatePlay(song);
    } else if (this.mode === "paused") song = this.pausedSong;
    else if ((this.mode === "result" || this.mode === "failed") && this.startCtx !== undefined) song = this.songTime(now);
    this.songNow = song;
    this.render(dt, song);
  }

  updatePlay(t) {
    // 카운트다운
    if (!this.countdownShown && t >= -3.15) {
      this.countdownShown = true;
      if (t < -2.6) this.spawn(countdown, { x: this.cx, y: this.cy, seed: 2 });
    }
    // 지나간 노트는 미스
    while (this.nextNote < this.notes.length) {
      const n = this.notes[this.nextNote];
      if (n.judged) { this.nextNote++; continue; }
      if (t - n.t > JUDGE.good) { this.judge(n, "miss"); this.nextNote++; continue; }
      break;
    }
    // 비트: 배경 도형 + 링 펄스
    const A = this.analysis;
    while (this.nextBeat < A.beats.length && A.beats[this.nextBeat] <= t) {
      const i = this.nextBeat++;
      const down = (i - A.downPhase) % 4 === 0;
      this.polys.push({ t0: this.time, down, rot: i * 0.18 });
      this.beatPulse = down ? 1 : 0.6;
      if (this.feverOn && down && ((i - A.downPhase) / 4) % 2 === 0) {
        const R = new Rng(i * 31 + 7);
        const side = R.chance(0.5) ? R.range(30, this.cx - this.R - 20) : R.range(this.cx + this.R + 20, this.W - 30);
        this.spawn(fireworkBurst, { x: side, y: R.range(40, this.H * 0.45), seed: i, palette: [PAL.neon, PAL.cyber, PAL.ice, PAL.holy][i % 4].slice(-7) }, this.bgFx);
      }
    }
    // 피버 구간
    const f = A.fever[this.feverIdx];
    if (f && !this.feverOn && t >= f.start) {
      this.feverOn = true;
      this.spawn(feverBanner, { x: this.cx, y: Math.max(36, this.cy - this.R - 40) });
      this.spawn(plasmaExplosion, { x: this.cx, y: this.cy, seed: this.feverIdx + 1, palette: ["#1a0420", "#4a0a5c", "#8a1ca8", "#c84cf0", "#f08cff", "#ffd8ff", "#ffffff"] });
      this.flash = 0.8;
    }
    if (f && this.feverOn && t >= f.end) {
      this.feverOn = false;
      this.feverIdx++;
    }
    if (t >= this.endAt) this.finish();
  }

  envAt(key, t) {
    const e = this.analysis?.env;
    if (!e || t === null || t < 0) return 0;
    const i = Math.floor(t * e.rate);
    return i < e[key].length ? e[key][i] : 0;
  }

  // ------------------------------------------------------------------------------------------
  render(dt, song) {
    const lk = this.mode === "idle" ? 0 : 1;
    if (lk !== this.layoutK) {
      this.layoutK += Math.sign(lk - this.layoutK) * Math.min(Math.abs(lk - this.layoutK), dt * 2.5);
      this.applyLayout();
    }
    const { frame, W, H, cx, cy, R, Rc } = this;
    clearFrame(frame);
    const p = painterFor(frame);
    const T = this.time;
    const playing = song !== null && this.analysis;
    const energy = playing ? this.envAt("energy", song) : 0.35 + 0.15 * Math.sin(T * 0.7);
    const low = playing ? this.envAt("low", song) : 0;
    this.beatPulse = Math.max(0, (this.beatPulse || 0) - dt * 4);
    if (!playing) {
      // 대기 화면: 가짜 박자(100 BPM)
      const ph = (T * 100) / 60;
      if (Math.floor(ph) !== this.idleBeat) {
        this.idleBeat = Math.floor(ph);
        this.polys.push({ t0: T, down: this.idleBeat % 4 === 0, rot: this.idleBeat * 0.18 });
        this.beatPulse = this.idleBeat % 4 === 0 ? 1 : 0.5;
      }
    }

    // ---- 하늘: 피버 때는 오로라, 대기 화면은 유성우
    const auroraTarget = this.feverOn || this.mode === "result" ? 1 : 0;
    this.auroraMix += (auroraTarget - this.auroraMix) * Math.min(1, dt * 1.5);
    const idleSky = this.mode === "idle";
    this.idleSkyMix = (this.idleSkyMix ?? 1) + ((idleSky ? 1 : 0) - (this.idleSkyMix ?? 1)) * Math.min(1, dt * 2);
    if (this.auroraMix > 0.02) {
      this.skyAurora.update(dt);
      this.drawSky(this.skyAurora, this.auroraMix, "aurora");
    }
    if (this.idleSkyMix > 0.02) {
      this.skyStars.update(dt);
      this.drawSky(this.skyStars, this.idleSkyMix * 0.9, "stars");
    }

    // ---- 별 터널
    const speed = 18 + energy * 70 + this.beatPulse * 40 + (this.feverOn ? 60 : 0);
    const nStars = this.lowQuality ? 90 : this.stars.length;
    for (let si = 0; si < nStars; si++) {
      const s = this.stars[si];
      s.d += dt * speed * s.z * (0.3 + s.d / this.spawnR * 1.6);
      if (s.d > this.spawnR) { s.d = Math.random() * 6 + 2; s.a = Math.random() * TAU; }
      const ca = Math.cos(s.a), sa = Math.sin(s.a);
      const x = cx + ca * s.d, y = cy + sa * s.d;
      const k = clamp(s.d / this.spawnR) * s.z;
      const c = this.feverOn ? RAINBOW[Math.floor(s.a * 3) % RAINBOW.length] : mix(hex("#4a5aa0"), WHITE, k);
      const len = speed * s.z * 0.04 * (0.3 + s.d / this.spawnR * 2);
      if (len > 1.2) p.line(x - ca * len, y - sa * len, x, y, c, Math.min(1, k * 1.6));
      else p.dot(x, y, c, Math.min(1, k * 1.8));
      if (k > 0.5) p.light(x, y, c, k * 0.5);
    }

    // ---- 비트마다 퍼지는 육각형
    this.polys = this.polys.filter((g) => T - g.t0 < 1.6);
    for (const g of this.polys) {
      const u = (T - g.t0) / 1.6;
      const r = Rc + ease.outQuad(u) * (this.spawnR - Rc);
      const sides = 6, rot = g.rot;
      const col = this.feverOn ? RAINBOW[Math.floor(g.rot * 5) % RAINBOW.length] : g.down ? RING[4] : RING[3];
      const a = (1 - u) * (g.down ? 0.9 : 0.5);
      const pts = [];
      for (let i = 0; i <= sides; i++) {
        const ang = rot + (i / sides) * TAU;
        pts.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r]);
      }
      if (r > R + 2) p.polyline(pts, col, a);
      if (g.down && u < 0.6) for (let i = 0; i < sides; i++) p.glowLine(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 4, col, 0.12 * (1 - u / 0.6));
    }

    // ---- 원형 스펙트럼
    const an = this.audio.analyser;
    const bars = 48;
    if (playing) an.getByteFrequencyData(this.spectrum);
    for (let i = 0; i < bars; i++) {
      const half = bars / 2, m = i < half ? i : bars - 1 - i;
      let v;
      if (playing) {
        const bin = Math.floor(2 + Math.pow(m / half, 1.6) * 70);
        v = this.spectrum[bin] / 255;
      } else v = 0.25 + 0.2 * Math.sin(T * 2 + m * 0.5) * Math.sin(T * 1.3 + m * 0.21) + this.beatPulse * 0.2;
      v = Math.pow(clamp(v), 1.6);
      const ang = (i / bars) * TAU - Math.PI / 2 + TAU / bars / 2;
      const r0 = R + 6, r1 = r0 + 2 + v * R * 0.85;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const col = this.feverOn ? RAINBOW[(i + Math.floor(T * 8)) % RAINBOW.length] : at(RING, 0.35 + v * 0.65);
      p.line(cx + ca * r0, cy + sa * r0, cx + ca * r1, cy + sa * r1, col, 0.85);
      p.light(cx + ca * r1, cy + sa * r1, col, 0.25 + v * 0.6);
    }

    // ---- 판정 링
    this.ringFlash = Math.max(0, (this.ringFlash || 0) - dt * 6);
    const pr = R + this.beatPulse * 1.5;
    p.ring(cx, cy, pr + 1.5, 3, (v) => (this.ringFlash > 0.5 ? WHITE : v > 0.5 ? RING[5] : RING[3]), 1);
    p.ring(cx, cy, pr - 2.5, 1, RING[2], 0.8);
    p.glowRing(cx, cy, pr, 7, this.feverOn ? RAINBOW[Math.floor(T * 6) % RAINBOW.length] : RING[4], 0.22 + this.beatPulse * 0.25 + this.ringFlash * 0.3);
    // 12방향 눈금
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * TAU - Math.PI / 2;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      p.line(cx + ca * (pr + 3), cy + sa * (pr + 3), cx + ca * (pr + 5), cy + sa * (pr + 5), RING[4], 0.9);
    }

    // ---- 노트
    if (this.notes && song !== null && (this.mode === "play" || this.mode === "paused" || this.mode === "failed")) this.drawNotes(p, song);

    // ---- 코어
    this.drawCore(p, T, energy, low);

    // ---- 이펙트
    this.bgFx = this.bgFx.filter((f) => !f.fx.done());
    this.fx = this.fx.filter((f) => !f.fx.done());
    if (this.mode !== "paused") {
      for (const f of this.bgFx) f.fx.update(dt);
      for (const f of this.fx) f.fx.update(dt);
    }
    for (const f of this.bgFx) f.fx.draw(frame);
    for (const f of this.fx) f.fx.draw(frame);

    // ---- HUD
    // (이펙트가 공용 painter 의 위치·회전을 바꿔 놓았으므로 새로 받는다)
    if (this.mode === "play" || this.mode === "paused" || this.mode === "failed") this.drawHud(painterFor(frame), song);

    // ---- 합성
    const bg = this.feverOn ? this.bgFever : this.bgNormal;
    composite(frame, this.img.data, bg, this.feverOn ? 1.1 : 1);
    this.pxCtx.putImageData(this.img, 0, 0);

    const ctx = this.ctx, s = this.scale;
    this.shake = Math.max(0, this.shake - dt * 14);
    const sx = this.shake > 0.2 ? Math.round((Math.random() * 2 - 1) * this.shake) * s : 0;
    const sy = this.shake > 0.2 ? Math.round((Math.random() * 2 - 1) * this.shake) * s : 0;
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#05040e";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.px, sx, sy, this.W * s, this.H * s);

    // 블룸: 빛 버퍼만 흐리게 해서 더한다
    if (this.settings.bloom) {
      const L = frame.light, G = this.glowImg.data;
      const k = this.feverOn ? 1.15 : 0.9;
      for (let i = 0, n = W * H; i < n; i++) {
        const l = L[i], j = i * 4;
        G[j] = (l & 255) * k; G[j + 1] = ((l >>> 8) & 255) * k; G[j + 2] = ((l >>> 16) & 255) * k; G[j + 3] = 255;
      }
      this.glowCtx.putImageData(this.glowImg, 0, 0);
      const b = this.blurCtx;
      b.globalCompositeOperation = "copy";
      b.filter = "blur(3px)";
      b.drawImage(this.glowCv, 0, 0);
      b.filter = "none";
      ctx.globalCompositeOperation = "lighter";
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = 0.85;
      ctx.drawImage(this.blurCv, sx, sy, W * s, H * s);
      if (!this.lowQuality) {
        ctx.globalAlpha = 0.35;
        ctx.drawImage(this.blurCv, sx - 4 * s, sy - 4 * s, (W + 8) * s, (H + 8) * s);
      }
    }
    // 섬광
    this.flash = Math.max(0, this.flash - dt * 3);
    this.redFlash = Math.max(0, this.redFlash - dt * 3);
    ctx.globalCompositeOperation = "lighter";
    if (this.flash > 0) {
      ctx.globalAlpha = this.flash * 0.35;
      ctx.fillStyle = "#c8b4ff";
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    ctx.globalCompositeOperation = "source-over";
    if (this.redFlash > 0) {
      const g = ctx.createRadialGradient(this.canvas.width / 2, this.canvas.height / 2, Math.min(this.canvas.width, this.canvas.height) * 0.3, this.canvas.width / 2, this.canvas.height / 2, Math.hypot(this.canvas.width, this.canvas.height) / 2);
      g.addColorStop(0, "rgba(255,20,60,0)");
      g.addColorStop(1, `rgba(255,20,60,${0.45 * this.redFlash})`);
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    ctx.globalAlpha = 1;
  }

  // 320x180 하늘 이펙트를 화면 전체로 늘려서 배경에 깐다
  drawSky(fx, k, key) {
    // 하늘은 느리게 변하므로 30fps 로만 다시 그리고, 사이 프레임은 지난 그림을 재사용한다
    this.skyCache = this.skyCache || {};
    let sf = this.skyCache[key];
    if (!sf) sf = this.skyCache[key] = { frame: createFrame(320, 180), at: -1 };
    if (this.time - sf.at > (this.lowQuality ? 1 / 15 : 1 / 30)) {
      clearFrame(sf.frame);
      fx.draw(sf.frame);
      sf.at = this.time;
    }
    const { W, H, frame, skyMapX: MX, skyMapY: MY } = this;
    const C = frame.color, L = frame.light, SC = sf.frame.color, SL = sf.frame.light;
    const ka = k * 0.85;
    for (let y = 0; y < H; y++) {
      const row = MY[y], base = y * W;
      for (let x = 0; x < W; x++) {
        const si = row + MX[x], i = base + x;
        const c = SC[si];
        if (c >>> 24) {
          const a = ((c >>> 24) * ka) | 0;
          if (a > 8) C[i] = (a << 24) | (c & 0xffffff);
        }
        const l = SL[si];
        if (l) {
          const d = L[i];
          const r = Math.min(255, (d & 255) + (l & 255) * k);
          const g = Math.min(255, ((d >>> 8) & 255) + ((l >>> 8) & 255) * k);
          const b = Math.min(255, ((d >>> 16) & 255) + ((l >>> 16) & 255) * k);
          L[i] = (255 << 24) | (b << 16) | (g << 8) | r;
        }
      }
    }
  }

  drawNotes(p, t) {
    const { cx, cy, R } = this;
    const ap = this.approach;
    for (let i = Math.max(0, this.nextNote - 8); i < this.notes.length; i++) {
      const n = this.notes[i];
      const dt = n.t - t;
      if (dt > ap) break;
      if (n.judged && n.judged !== "miss") continue;
      if (n.judged === "miss" && dt < -0.4) continue;
      const ramp = n.gold ? NOTE_RAMPS.gold : NOTE_RAMPS[n.kind] || NOTE_RAMPS.beat;
      const u = dt / ap; // 1 → 0 → 음수
      const r = R + (this.spawnR - R) * u;
      const ca = Math.cos(n.angle), sa = Math.sin(n.angle);
      const x = cx + ca * r, y = cy + sa * r;
      const missed = n.judged === "miss";
      const appear = clamp((1 - u) * 6);
      // 링 위 도착 지점 표시
      if (!missed && dt > -0.05) {
        const near = clamp(1 - dt / (ap * 0.6));
        if (near > 0) {
          p.arc(cx, cy, R + 3, 3, n.angle - 0.2, n.angle + 0.2, () => (near > 0.9 ? WHITE : ramp[5]), near * 0.9);
          p.glow(cx + ca * R, cy + sa * R, 10, ramp[4], near * 0.35);
        }
      }
      // 꼬리
      const speed = (this.spawnR - R) / ap;
      const tail = Math.min(34, speed * 0.12);
      for (let k = 1; k <= 7; k++) {
        const rr = r + (k / 7) * tail;
        const c = this.feverOn ? RAINBOW[(k + i) % RAINBOW.length] : ramp[Math.max(1, 5 - k)];
        p.dot(cx + ca * rr, cy + sa * rr, missed ? CORE_HURT[3] : c, (1 - k / 8) * 0.9 * appear);
        const wdt = (1 - k / 8) * (n.gold ? 3 : 2.2);
        p.dot(cx + ca * rr - sa * wdt, cy + sa * rr + ca * wdt, c, (1 - k / 7) * 0.55 * appear);
        p.dot(cx + ca * rr + sa * wdt, cy + sa * rr - ca * wdt, c, (1 - k / 7) * 0.55 * appear);
      }
      // 몸체
      const rad = n.gold ? 6.5 : 4.8;
      const R2 = missed ? CORE_HURT : ramp;
      const spin = this.time * 4 + i;
      p.circle(x, y, rad, (d, ang) => {
        const lit = 1 - d * 0.75 + 0.25 * Math.cos(ang + 2.3);
        return at(R2, 0.25 + lit * 0.7);
      }, missed ? clamp(1 + dt * 3) : appear);
      if (n.gold) {
        for (let k = 0; k < 4; k++) {
          const a = spin + (k * TAU) / 4, l = 8 + Math.sin(this.time * 10) * 1.5;
          p.line(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, ramp[6], 0.8 * appear);
        }
      }
      p.glow(x, y, n.gold ? 16 : 10, ramp[4], (n.gold ? 0.55 : 0.4) * appear);
      p.rect(Math.round(x - 2), Math.round(y - 2), 2, 2, WHITE, appear);
      p.ring(x, y, rad + 1, 1, ramp[2], 0.9 * appear);
    }
  }

  drawCore(p, T, energy, low) {
    const { cx, cy, Rc } = this;
    this.coreKick = Math.max(0, (this.coreKick || 0) - 0.08);
    this.coreHurt = Math.max(0, (this.coreHurt || 0) - 0.03);
    const hpK = this.mode === "idle" ? 1 : clamp(this.hp / 100);
    const r = Rc + this.beatPulse * 1.5 + this.coreKick * 1.5 + low * 1.5;
    const danger = hpK < 0.3 ? 0.5 + 0.5 * Math.sin(T * 12) : 0;
    const hurt = Math.max(this.coreHurt, danger * (1 - hpK / 0.3));
    const C = hurt > 0.05 ? CORE.map((c, i) => mix(c, CORE_HURT[Math.min(CORE_HURT.length - 1, i)], hurt)) : CORE;
    // 바깥 껍질
    p.glow(cx, cy, r * 3, this.feverOn ? RAINBOW[Math.floor(T * 5) % RAINBOW.length] : C[4], 0.3 + energy * 0.25 + this.beatPulse * 0.2);
    p.circle(cx, cy, r, (d, ang) => {
      const sw = Math.sin(ang * 3 + T * 2.2 + d * 7) * 0.5 + Math.sin(d * 11 - T * 5) * 0.5;
      const lit = 0.25 * Math.cos(ang + 2.3);
      return at(C, 0.18 + (1 - d) * 0.55 + sw * 0.12 + lit + this.coreKick * 0.15);
    });
    p.ring(cx, cy, r + 1, 1.5, C[6], 0.9);
    // 회전하는 궤도 링 두 개
    for (let k = 0; k < 2; k++) {
      const tilt = k ? 0.35 : 0.6, rot = T * (k ? -0.9 : 1.3);
      let prev = null;
      for (let s = 0; s <= 40; s++) {
        const a = (s / 40) * TAU;
        const ex = Math.cos(a) * (r + 5), ey = Math.sin(a) * (r + 5) * tilt;
        const x = cx + ex * Math.cos(rot) - ey * Math.sin(rot), y = cy + ex * Math.sin(rot) + ey * Math.cos(rot);
        if (prev && Math.sin(a) > -0.2) p.line(prev[0], prev[1], x, y, C[5], 0.7);
        prev = [x, y];
      }
    }
    p.glow(cx - r * 0.3, cy - r * 0.35, r * 0.7, WHITE, 0.25);
    // 콤보
    if (this.mode !== "idle" && this.combo >= 2) {
      const s = String(this.combo);
      let sc = 3;
      while (sc > 1 && p.measure(s, { font: "big", scale: sc })[0] > r * 1.6) sc--;
      const col = this.feverOn ? (gx, gy) => RAINBOW[Math.floor(gx / 2 + T * 10) % RAINBOW.length] : (gx, gy) => at(C, 1 - gy / 9);
      p.text(s, cx, cy - (7 * sc) / 2 - (sc > 1 ? 1 : 0), col, { font: "big", scale: sc, align: "center", outline: INK });
    }
  }

  drawHud(p, song) {
    const { W, H } = this;
    // 진행 막대
    const dur = this.song.buffer.duration;
    const prog = clamp((song ?? 0) / dur);
    p.rect(0, 0, W, 2, hex("#1a1236"));
    p.rect(0, 0, Math.round(W * prog), 2, this.feverOn ? RAINBOW[Math.floor(this.time * 8) % RAINBOW.length] : RING[4]);
    p.glow(W * prog, 1, 6, RING[5], 0.5);
    // HP
    const seg = 20, hpN = Math.ceil((this.hp / 100) * seg);
    p.text("HP", 6, 7, RING[5], { font: "mini", outline: INK });
    const hc = this.hp > 60 ? HPCOL[3] : this.hp > 35 ? HPCOL[2] : this.hp > 15 ? HPCOL[1] : HPCOL[0];
    for (let i = 0; i < seg; i++) {
      const x = 17 + i * 4;
      p.rect(x, 7, 3, 5, i < hpN ? hc : hex("#231a40"));
      if (i < hpN) p.px(x, 7, mix(hc, WHITE, 0.5));
    }
    if (this.hp < 30) p.glow(17 + hpN * 4, 9, 8, HPCOL[0], 0.4 + 0.3 * Math.sin(this.time * 12));
    // 점수
    const sc = String(this.score).padStart(7, "0");
    p.text(sc, W - 6, 6, (gx, gy) => at(RING, 0.5 + 0.5 * (1 - gy / 7)), { font: "big", scale: 1, align: "right", outline: INK });
    const N = Math.max(1, this.judgedCount);
    const acc = this.judgedCount ? ((this.weightSum / N) * 100).toFixed(2) + "%" : "100.00%";
    p.text(acc, W - 6, 16, RING[5], { font: "mini", align: "right", outline: INK });
    if (this.feverOn) p.text("FEVER", W - 6, 24, (gx) => RAINBOW[Math.floor(gx / 2 + this.time * 12) % RAINBOW.length], { font: "mini", align: "right", outline: INK });
  }
}
