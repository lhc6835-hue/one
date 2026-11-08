// 소리: 효과음은 WebAudio 로 즉석 합성한다(포획음은 콤보를 따라 5음계로 올라간다).
// 배경음은 곡이 아니라 실시간으로 합성하는 우주 앰비언스다. 구역과 상관없이 처음부터 끝까지 같은 분위기로 깔린다.
//   저음 드론(숨 쉬듯 천천히) + 열린 화음 패드(필터가 느리게 열리고 닫힘) + 우주 바람(흐르는 노이즈)
//   + 가끔 울리는 별 반짝임(맑은 종소리, 좌우 랜덤) → 전부 6초 잔향을 거친다.
// 파일이 없으니 반복 이음새도 없고 내려받을 것도 없다.

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
    this.on = true;
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.musicStarted = false;
  }

  unlock() {
    if (this.ctx.state === "suspended") this.ctx.resume();
    if (!this.musicStarted) {
      this.musicStarted = true;
      this.musicBus.gain.setValueAtTime(0, this.ctx.currentTime);
      this.musicBus.gain.linearRampToValueAtTime(0.75, this.ctx.currentTime + 4); // 서서히 떠오르듯
      this.startAmbience();
    }
  }

  /** 예전 곡 전환 호출과 호환: 배경음은 하나뿐이라 아무것도 바꾸지 않는다 */
  playMusic() {}

  /** 게임오버·일시정지 때 배경음을 먹먹하게 */
  duck(on) {
    const t = this.ctx.currentTime;
    this.duckFilter.frequency.cancelScheduledValues(t);
    this.duckFilter.frequency.setTargetAtTime(on ? 500 : 20000, t, on ? 0.15 : 0.3);
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setTargetAtTime(this.musicStarted ? (on ? 0.4 : 0.75) : 0, t, 0.3);
  }

  /** 게임오버·신기록 때 짧은 종소리(앰비언스와 같은 잔향을 거친다) */
  jingle(name, at = 0.3) {
    const notes = name === "jingle-best" ? [0, 7, 12, 16, 19] : [12, 7, 3, 0];
    notes.forEach((s, i) => this.bell(440 * Math.pow(2, s / 12), at + i * 0.16, 0.09, 0));
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
  zone() { [0, 7, 12, 19].forEach((s, i) => this.bell(330 * Math.pow(2, s / 12), i * 0.12, 0.07, (i - 1.5) * 0.4)); }
  best() { [0, 7, 12, 19, 24].forEach((s, i) => this.tone("square", 523 * Math.pow(2, s / 12), 0, 0.22, 0.05, i * 0.06)); }

  // ---------------------------------------------------------------------------------------
  // 우주 앰비언스
  makeReverb(seconds = 6) {
    const c = this.ctx, n = Math.floor(c.sampleRate * seconds);
    const ir = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.6);
    }
    const conv = c.createConvolver();
    conv.buffer = ir;
    return conv;
  }

  /** 천천히 흔들리는 값(LFO): param 을 center ± depth 로, period 초 주기로 */
  lfo(param, center, depth, period, type = "sine") {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.value = 1 / period;
    g.gain.value = depth;
    param.value = center;
    o.connect(g).connect(param);
    o.start(c.currentTime + Math.random() * 0.1);
    return o;
  }

  startAmbience() {
    const c = this.ctx, now = c.currentTime;
    const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
    this.reverb = this.makeReverb(6);
    const wet = c.createGain(); wet.gain.value = 0.75;
    const dry = c.createGain(); dry.gain.value = 0.45;
    this.reverb.connect(wet).connect(this.musicBus);
    dry.connect(this.musicBus);
    this.ambDry = dry;

    // 1) 저음 드론: A1·E2·A2 사인, 각자 다른 주기로 숨 쉰다
    const droneLp = c.createBiquadFilter();
    droneLp.type = "lowpass"; droneLp.Q.value = 0.3;
    this.lfo(droneLp.frequency, 420, 220, 37);
    droneLp.connect(dry); droneLp.connect(this.reverb);
    [[33, "sine", 0.16, 23], [40, "triangle", 0.07, 31], [45, "sine", 0.09, 19], [45.07, "sine", 0.06, 29]].forEach(([m, type, vol, per]) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = midi(m);
      this.lfo(g.gain, vol, vol * 0.6, per);
      o.connect(g).connect(droneLp);
      o.start(now);
    });

    // 2) 패드: 열린 화음(A·E·B·E) 톱니파를 두 겹으로 살짝 어긋나게, 필터가 아주 느리게 열고 닫는다
    const padLp = c.createBiquadFilter();
    padLp.type = "lowpass"; padLp.Q.value = 0.7;
    this.lfo(padLp.frequency, 900, 600, 53);
    const padG = c.createGain();
    this.lfo(padG.gain, 0.022, 0.012, 41);
    padLp.connect(padG); padG.connect(this.reverb); padG.connect(dry);
    for (const m of [57, 64, 71, 76]) for (const det of [-6, 6]) {
      const o = c.createOscillator();
      o.type = "sawtooth"; o.frequency.value = midi(m); o.detune.value = det;
      this.lfo(o.detune, det, 4, 13 + m * 0.1);
      o.connect(padLp);
      o.start(now);
    }

    // 3) 우주 바람: 노이즈가 좁은 대역을 천천히 오르내린다(좌우로도 흐른다)
    const wind = c.createBufferSource();
    wind.buffer = this.noise; wind.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass"; bp.Q.value = 1.4;
    this.lfo(bp.frequency, 700, 450, 29);
    const wg = c.createGain();
    this.lfo(wg.gain, 0.05, 0.03, 17);
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    if (pan) { this.lfo(pan.pan, 0, 0.6, 23); wind.connect(bp).connect(wg).connect(pan); pan.connect(this.reverb); pan.connect(dry); }
    else { wind.connect(bp).connect(wg); wg.connect(this.reverb); wg.connect(dry); }
    wind.start(now);

    // 4) 별 반짝임: 2.5~7초마다 맑은 종소리 하나, A 오음계 높은 음, 좌우 랜덤
    const stars = [81, 83, 85, 88, 90, 93, 95, 97].map(midi);
    const twinkle = () => {
      if (!this.musicStarted) return;
      const f = stars[Math.floor(Math.random() * stars.length)];
      this.bell(f, 0, 0.035 + Math.random() * 0.025, Math.random() * 1.6 - 0.8, true);
      if (Math.random() < 0.3) this.bell(f * 1.5, 0.35 + Math.random() * 0.3, 0.02, Math.random() * 1.6 - 0.8, true);
      setTimeout(twinkle, 2500 + Math.random() * 4500);
    };
    setTimeout(twinkle, 3000);
  }

  /** 맑은 종소리(사인 + 배음), 앰비언스 잔향으로 보낸다 */
  bell(f, at, vol, panV = 0, ambient = false) {
    const c = this.ctx, t = c.currentTime + at;
    const out = c.createGain();
    out.gain.value = 1;
    let node = out;
    if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = panV; out.connect(p); node = p; }
    if (this.reverb) node.connect(this.reverb);
    node.connect(ambient && this.ambDry ? this.ambDry : this.master);
    for (const [mul, k, dur] of [[1, 1, 2.6], [2.01, 0.35, 1.4], [3.98, 0.12, 0.8]]) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = "sine"; o.frequency.value = f * mul;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol * k, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + dur + 0.05);
    }
  }
}
