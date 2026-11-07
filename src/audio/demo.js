// 데모 곡: 업로드 없이 바로 해볼 수 있도록 WebAudio 로 신스웨이브 트랙을 즉석 합성한다.
// 128 BPM, 36마디(인트로 → 벌스 → 빌드업 → 드롭 → 아웃트로), 약 68초.

export const DEMO_BPM = 128;
export const DEMO_OFFSET = 0.5; // 첫 박 시각(초)

export async function renderDemo(sampleRate = 44100, bpm = DEMO_BPM) {
  const spb = 60 / bpm;
  const bars = 36;
  const dur = DEMO_OFFSET + bars * 4 * spb + 3;
  const ctx = new OfflineAudioContext(2, Math.ceil(dur * sampleRate), sampleRate);

  const master = ctx.createGain();
  master.gain.value = 0.8;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  master.connect(comp).connect(ctx.destination);

  // 간단한 스테레오 딜레이(리드용)
  const delayIn = ctx.createGain();
  delayIn.gain.value = 0.28;
  const dl = ctx.createDelay(1), dr = ctx.createDelay(1);
  dl.delayTime.value = spb * 0.75;
  dr.delayTime.value = spb * 0.5;
  const fb = ctx.createGain();
  fb.gain.value = 0.35;
  const merger = ctx.createChannelMerger(2);
  delayIn.connect(dl); delayIn.connect(dr);
  dl.connect(fb).connect(dl);
  dl.connect(merger, 0, 0); dr.connect(merger, 0, 1);
  merger.connect(master);

  const noise = ctx.createBuffer(1, sampleRate, sampleRate);
  {
    const d = noise.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < d.length; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (s / 0x7fffffff) * 2 - 1;
    }
  }
  const beatT = (bar, beat) => DEMO_OFFSET + (bar * 4 + beat) * spb;
  const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function kick(t, v = 1) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(1.1 * v, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + 0.45);
    // 클릭
    const n = ctx.createBufferSource(), ng = ctx.createGain(), hp = ctx.createBiquadFilter();
    n.buffer = noise; hp.type = "highpass"; hp.frequency.value = 3000;
    ng.gain.setValueAtTime(0.25 * v, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.015);
    n.connect(hp).connect(ng).connect(master);
    n.start(t); n.stop(t + 0.02);
  }
  function snare(t, v = 1) {
    const n = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    n.buffer = noise; bp.type = "bandpass"; bp.frequency.value = 1900; bp.Q.value = 0.7;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.7 * v, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    n.connect(bp).connect(g).connect(master);
    n.start(t, Math.random() * 0.5); n.stop(t + 0.22);
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.frequency.setValueAtTime(240, t);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
    og.gain.setValueAtTime(0.35 * v, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(og).connect(master);
    o.start(t); o.stop(t + 0.12);
  }
  function hat(t, v = 1, open = false) {
    const n = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), g = ctx.createGain();
    n.buffer = noise; hp.type = "highpass"; hp.frequency.value = 8000;
    const len = open ? 0.22 : 0.045;
    g.gain.setValueAtTime(0.22 * v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    n.connect(hp).connect(g).connect(master);
    n.start(t, (t * 7.31) % 0.8); n.stop(t + len + 0.01);
  }
  function bass(t, note, len, v = 1) {
    const o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = "sawtooth"; o.frequency.value = midi(note);
    lp.type = "lowpass"; lp.Q.value = 6;
    lp.frequency.setValueAtTime(1400, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + len * 0.9);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.32 * v, t + 0.006);
    g.gain.setValueAtTime(0.32 * v, t + len * 0.7);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(lp).connect(g).connect(master);
    o.start(t); o.stop(t + len + 0.02);
  }
  function pad(t, notes, len, v = 1) {
    const lp = ctx.createBiquadFilter(), g = ctx.createGain();
    lp.type = "lowpass"; lp.frequency.value = 1600;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.07 * v, t + 0.4);
    g.gain.setValueAtTime(0.07 * v, t + len - 0.3);
    g.gain.linearRampToValueAtTime(0.0001, t + len);
    lp.connect(g).connect(master);
    for (const m of notes)
      for (const det of [-9, 0, 9]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth"; o.frequency.value = midi(m); o.detune.value = det;
        o.connect(lp); o.start(t); o.stop(t + len + 0.05);
      }
  }
  function lead(t, note, len, v = 1) {
    const o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = "square"; o.frequency.value = midi(note);
    lp.type = "lowpass"; lp.frequency.setValueAtTime(4200, t); lp.frequency.exponentialRampToValueAtTime(900, t + len);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.09 * v, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(lp).connect(g);
    g.connect(master); g.connect(delayIn);
    o.start(t); o.stop(t + len + 0.02);
  }
  function riser(t0, t1) {
    const n = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    n.buffer = noise; n.loop = true; bp.type = "bandpass"; bp.Q.value = 3;
    bp.frequency.setValueAtTime(400, t0); bp.frequency.exponentialRampToValueAtTime(9000, t1);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t1);
    n.connect(bp).connect(g).connect(master);
    n.start(t0); n.stop(t1);
  }
  function crash(t) {
    const n = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), g = ctx.createGain();
    n.buffer = noise; hp.type = "highpass"; hp.frequency.value = 5000;
    g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
    n.connect(hp).connect(g).connect(master);
    n.start(t); n.stop(t + 1.9);
  }

  // Am - F - C - G
  const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
  const roots = [33, 29, 36, 31];
  const arp = [0, 2, 1, 2, 0, 1, 2, 1];

  for (let bar = 0; bar < bars; bar++) {
    const ci = bar % 4, sec = bar < 4 ? "intro" : bar < 12 ? "verse" : bar < 16 ? "build" : bar < 32 ? "drop" : "outro";
    if (sec !== "build") pad(beatT(bar, 0), chords[ci], 4 * spb, sec === "drop" ? 1.2 : 1);
    for (let b = 0; b < 4; b++) {
      const t = beatT(bar, b);
      if (sec === "verse" || sec === "drop") kick(t, sec === "drop" ? 1 : 0.9);
      if ((sec === "verse" || sec === "drop") && (b === 1 || b === 3)) snare(t, sec === "drop" ? 1 : 0.8);
      if (sec !== "outro") {
        hat(t + spb / 2, sec === "intro" ? 0.6 : 1, sec === "drop" && b % 2 === 1);
        if (sec === "drop") { hat(t + spb / 4, 0.5); hat(t + (3 * spb) / 4, 0.5); }
      }
      if (sec === "verse" || sec === "drop") {
        bass(t, roots[ci], spb * 0.45, 1);
        bass(t + spb / 2, roots[ci] + 12, spb * 0.4, 0.8);
      }
      if (sec === "outro" && b === 0) kick(t, 0.7);
    }
    if (sec === "drop")
      for (let s = 0; s < 16; s++) lead(beatT(bar, s / 4), chords[ci][arp[s % 8]] + 12 + (s % 8 === 7 ? 12 : 0), spb * 0.3, s % 4 === 0 ? 1.2 : 0.8);
    if (sec === "build") {
      // 스네어 롤이 점점 빨라진다
      const div = bar < 14 ? 2 : bar < 15 ? 4 : 8;
      for (let s = 0; s < 4 * div; s++) snare(beatT(bar, s / div), 0.35 + 0.65 * ((bar - 12) * 4 * div + s) / (16 * div));
      kick(beatT(bar, 0), 0.8);
    }
  }
  riser(beatT(12, 0), beatT(16, 0));
  crash(beatT(16, 0));
  crash(beatT(24, 0));
  crash(beatT(32, 0));

  return ctx.startRendering();
}
