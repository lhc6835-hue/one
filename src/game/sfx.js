// 소리: 효과음은 WebAudio 로 즉석 합성하고(포획음은 콤보를 따라 5음계로 올라간다),
// 배경음악은 CC0 칩튠 트랙을 불러와 구역마다 크로스페이드한다.

const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31];

export class Sfx {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: "interactive" });
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    this.master.connect(comp).connect(this.ctx.destination);
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.0;
    this.duckFilter = this.ctx.createBiquadFilter();
    this.duckFilter.type = "lowpass";
    this.duckFilter.frequency.value = 20000;
    this.musicBus.connect(this.duckFilter).connect(this.master);
    // 배경음악: CC0 칩튠 트랙(public/music). 못 불러오면 합성 패드로 대신한다.
    const a = document.createElement("audio");
    this.ext = a.canPlayType('audio/ogg; codecs="vorbis"') ? "ogg" : "mp3";
    this.buffers = {};
    this.want = "title";
    this.current = null;
    this.on = true;
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.musicStarted = false;
  }

  unlock() {
    if (this.ctx.state === "suspended") this.ctx.resume();
    if (!this.musicStarted) {
      this.musicStarted = true;
      this.musicBus.gain.setValueAtTime(0.55, this.ctx.currentTime);
      this.playMusic(this.want);
      for (const n of ["stage1", "stage2", "boss", "jingle-over", "jingle-best"]) this.load(n);
    }
  }

  load(name) {
    if (this.buffers[name]) return this.buffers[name];
    const get = async (ext) => {
      const r = await fetch(`music/${name}.${ext}`);
      if (!r.ok) throw new Error(r.status);
      return this.ctx.decodeAudioData(await r.arrayBuffer());
    };
    this.buffers[name] = get(this.ext).catch(() => get(this.ext === "ogg" ? "mp3" : "ogg")).then((buf) => ({ buf, ...this.loopPoints(buf) })).catch(() => null);
    return this.buffers[name];
  }

  // mp3 는 앞뒤에 인코더 무음이 붙어서 그대로 반복하면 끊긴다. 무음을 건너뛴 구간만 반복한다.
  loopPoints(buf) {
    const d = buf.getChannelData(0), sr = buf.sampleRate, th = 1e-4;
    let a = 0, b = d.length - 1;
    const lim = Math.min(d.length, Math.floor(sr * 0.15));
    while (a < lim && Math.abs(d[a]) < th) a++;
    while (b > d.length - lim && Math.abs(d[b]) < th) b--;
    if (a >= lim) a = 0;
    return { start: a / sr, end: (b + 1) / sr };
  }

  async playMusic(name) {
    this.want = name;
    if (!this.musicStarted) return;
    if (this.current && this.current.name === name) return;
    const t = await this.load(name);
    if (this.want !== name || (this.current && this.current.name === name)) return;
    if (!t) { if (!this.synthStarted) { this.synthStarted = true; this.startMusic(); } return; }
    const c = this.ctx, now = c.currentTime;
    const old = this.current;
    if (old) {
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + 0.9);
      old.src.stop(now + 1);
    }
    const src = c.createBufferSource(), g = c.createGain();
    src.buffer = t.buf;
    src.loop = true;
    src.loopStart = t.start;
    src.loopEnd = t.end;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(1, now + (old ? 0.9 : 0.4));
    src.connect(g).connect(this.musicBus);
    src.start(now, t.start);
    this.current = { name, src, gain: g };
  }

  /** 게임오버·일시정지 때 음악을 먹먹하게 */
  duck(on) {
    const t = this.ctx.currentTime;
    this.duckFilter.frequency.cancelScheduledValues(t);
    this.duckFilter.frequency.setTargetAtTime(on ? 500 : 20000, t, on ? 0.15 : 0.3);
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setTargetAtTime(this.musicStarted ? (on ? 0.25 : 0.55) : 0, t, 0.2);
  }

  async jingle(name, at = 0) {
    const t = await this.load(name);
    if (!t) return;
    const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
    src.buffer = t.buf;
    g.gain.value = 0.7;
    src.connect(g).connect(this.master);
    src.start(this.ctx.currentTime + at, t.start);
  }

  setOn(on) {
    this.on = on;
    this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.05);
  }

  tone(type, f0, f1, dur, vol, at = 0, dest = this.master) {
    const c = this.ctx, t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  hiss(f0, f1, dur, vol, q = 1, type = "bandpass", at = 0) {
    const c = this.ctx, t = c.currentTime + at;
    const n = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    n.buffer = this.noise;
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f).connect(g).connect(this.master);
    n.start(t, Math.random() * 0.5);
    n.stop(t + dur + 0.02);
  }

  launch() {
    this.hiss(600, 3200, 0.18, 0.18, 1.2);
    this.tone("sine", 220, 440, 0.12, 0.12);
  }
  capture(grade, combo) {
    const base = 392; // G4
    const step = SCALE[Math.min(SCALE.length - 1, combo)];
    const f = base * Math.pow(2, step / 12);
    this.tone("triangle", f, f, 0.32, 0.22);
    this.tone("sine", f * 2, f * 2, 0.18, 0.08);
    if (grade === "perfect") {
      this.tone("sine", f * 3, f * 3, 0.4, 0.07, 0.06);
      this.tone("sine", f * 4, f * 4, 0.45, 0.05, 0.12);
    }
    this.tone("sine", 90, 50, 0.12, 0.25);
  }
  coin() {
    this.tone("square", 988, 988, 0.06, 0.06);
    this.tone("square", 1319, 1319, 0.16, 0.06, 0.06);
  }
  close() { this.hiss(4000, 300, 0.35, 0.2, 2); this.tone("sawtooth", 880, 220, 0.3, 0.05); }
  shield() { [523, 659, 784, 1047].forEach((f, i) => this.tone("triangle", f, f, 0.3, 0.12, i * 0.05)); }
  shieldBreak() { this.hiss(3000, 200, 0.4, 0.3, 0.8); this.tone("square", 600, 120, 0.3, 0.08); }
  boom() { this.hiss(1200, 60, 0.9, 0.5, 0.6, "lowpass"); this.tone("sine", 120, 30, 0.7, 0.45); }
  death() {
    this.hiss(2000, 80, 1.1, 0.45, 0.7, "lowpass");
    this.tone("sawtooth", 330, 40, 0.9, 0.12);
    this.tone("sine", 110, 28, 1.0, 0.4);
  }
  zone() { [0, 4, 7, 12, 16].forEach((s, i) => this.tone("triangle", 392 * Math.pow(2, s / 12), 0, 0.5, 0.1, i * 0.07)); }
  best() { [0, 7, 12, 19, 24].forEach((s, i) => this.tone("square", 523 * Math.pow(2, s / 12), 0, 0.22, 0.05, i * 0.06)); }

  // 예비 배경음(트랙을 못 불러올 때): Am - F - C - G 패드 + 느린 아르페지오
  startMusic() {
    const c = this.ctx;
    this.musicBus.gain.setTargetAtTime(0.5, c.currentTime, 1.5);
    this.synthStarted = true;
    const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
    const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const bar = 4.0;
    let next = c.currentTime + 0.1, k = 0;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 1100; lp.Q.value = 0.5;
    lp.connect(this.musicBus);
    const schedule = () => {
      if (this.current) return; // 트랙이 나중에라도 불러와지면 합성 패드는 멈춘다
      while (next < c.currentTime + 1.5) {
        const ch = chords[k % 4];
        for (const m of ch) for (const det of [-7, 7]) {
          const o = c.createOscillator(), g = c.createGain();
          o.type = "sawtooth"; o.frequency.value = midi(m - 12); o.detune.value = det;
          g.gain.setValueAtTime(0.0001, next);
          g.gain.linearRampToValueAtTime(0.018, next + 1.2);
          g.gain.linearRampToValueAtTime(0.0001, next + bar + 0.6);
          o.connect(g).connect(lp); o.start(next); o.stop(next + bar + 0.7);
        }
        for (let i = 0; i < 8; i++) {
          const m = ch[[0, 1, 2, 1, 2, 0, 1, 2][i]] + 12 + (i === 6 ? 12 : 0);
          const t = next + i * (bar / 8);
          const o = c.createOscillator(), g = c.createGain();
          o.type = "triangle"; o.frequency.value = midi(m);
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(0.03, t + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
          o.connect(g).connect(this.musicBus); o.start(t); o.stop(t + 0.5);
        }
        next += bar; k++;
      }
    };
    schedule();
    setInterval(schedule, 500);
  }
}
