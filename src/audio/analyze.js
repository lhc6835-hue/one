// 곡 분석: 모노 신호 → 온셋 강도, 템포, 비트, 다운비트, 에너지 구간.
//
// 1) STFT(1024 / hop 256 @ 22050Hz) → 로그 스펙트럼의 spectral flux = 온셋 강도
//    저/중/고역 flux 도 따로 남겨서 채보에서 방향·강세를 정하는 데 쓴다.
// 2) 온셋 강도의 자기상관 × 120BPM 중심 로그-가우시안 가중치 → 템포
// 3) Ellis(2007) 동적 계획법 비트 추적 → 비트 프레임
// 4) 이웃 비트 선형 회귀로 지터를 펴서 박자 시각을 매끈하게 다듬는다
// 5) 마디 위상(다운비트), 비트별 에너지, 피버(하이라이트) 구간

import { createFFT } from "./fft.js";

export const SR = 22050;
const N = 1024;
const HOP = 256;
export const FPS = SR / HOP; // 약 86.13 프레임/초

const tick = () => new Promise((r) => setTimeout(r, 0));

/** 디코딩된 AudioBuffer 를 22050Hz 모노로 내린다 (브라우저 전용). */
export async function toMono(buffer) {
  const len = Math.max(1, Math.ceil(buffer.duration * SR));
  const off = new OfflineAudioContext(1, len, SR);
  const src = off.createBufferSource();
  src.buffer = buffer;
  src.connect(off.destination);
  src.start();
  const out = await off.startRendering();
  return out.getChannelData(0);
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = Float32Array.from(arr).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
}

function movingAverage(x, radius) {
  const n = x.length, out = new Float32Array(n);
  let acc = 0, lo = 0, hi = -1;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - radius), b = Math.min(n - 1, i + radius);
    while (hi < b) acc += x[++hi];
    while (lo < a) acc -= x[lo++];
    out[i] = acc / (hi - lo + 1);
  }
  return out;
}

/**
 * mono: 22050Hz Float32Array. onProgress(0..1, 단계 이름).
 * 반환값은 채보 생성기(chart.js)와 렌더러가 쓰는 분석 결과.
 */
export async function analyzeSignal(mono, onProgress = () => {}) {
  const duration = mono.length / SR;
  const frames = Math.max(1, Math.floor(mono.length / HOP) + 1);
  const fft = createFFT(N);
  const re = new Float32Array(N), im = new Float32Array(N);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);

  const bins = N / 2 + 1;
  const kLow = Math.round((180 / SR) * N); // ~180Hz 아래: 킥/베이스
  const kMid = Math.round((2000 / SR) * N); // ~2kHz 아래: 스네어/보컬
  let prev = new Float32Array(bins), cur = new Float32Array(bins);

  const flux = new Float32Array(frames);
  const fLow = new Float32Array(frames), fMid = new Float32Array(frames), fHigh = new Float32Array(frames);
  const rms = new Float32Array(frames);
  const bright = new Float32Array(frames); // 스펙트럼 무게중심(0..1): 곡의 밝기

  // 프레임 i 의 창 중심이 i*HOP 이 되도록 N/2 만큼 앞을 비워 둔다
  for (let f = 0; f < frames; f++) {
    const start = f * HOP - N / 2;
    let e = 0;
    for (let i = 0; i < N; i++) {
      const j = start + i;
      const v = j >= 0 && j < mono.length ? mono[j] : 0;
      e += v * v;
      re[i] = v * win[i];
      im[i] = 0;
    }
    rms[f] = Math.sqrt(e / N);
    fft.transform(re, im);
    let fl = 0, lo = 0, mi = 0, hi = 0, wsum = 0, msum = 0;
    for (let k = 1; k < bins; k++) {
      const m = Math.log1p(100 * Math.hypot(re[k], im[k]));
      cur[k] = m;
      const d = m - prev[k];
      if (d > 0) {
        fl += d;
        if (k < kLow) lo += d;
        else if (k < kMid) mi += d;
        else hi += d;
      }
      wsum += m * k;
      msum += m;
    }
    flux[f] = fl;
    fLow[f] = lo; fMid[f] = mi; fHigh[f] = hi;
    bright[f] = msum > 0 ? wsum / msum / bins : 0;
    const t = prev; prev = cur; cur = t;
    if ((f & 1023) === 0) {
      onProgress(0.05 + 0.55 * (f / frames), "스펙트럼 분석");
      await tick();
    }
  }
  flux[0] = 0; fLow[0] = 0; fMid[0] = 0; fHigh[0] = 0;

  // ---- 온셋 강도: 국소 평균을 빼고 반파 정류, 표준편차로 정규화
  const avg = movingAverage(flux, Math.round(FPS * 0.25));
  const onset = new Float32Array(frames);
  let sum = 0, sq = 0;
  for (let i = 0; i < frames; i++) {
    const v = Math.max(0, flux[i] - avg[i]);
    onset[i] = v;
    sum += v; sq += v * v;
  }
  const mean = sum / frames, std = Math.sqrt(Math.max(1e-12, sq / frames - mean * mean));
  for (let i = 0; i < frames; i++) onset[i] /= std;

  onProgress(0.62, "템포 추정");
  await tick();

  // ---- 템포: 자기상관, 120BPM 중심 로그-가우시안 사전분포
  const minLag = Math.floor((FPS * 60) / 210), maxLag = Math.ceil((FPS * 60) / 55);
  const acf = new Float32Array(maxLag + 2);
  const om = onset.reduce((a, b) => a + b, 0) / frames;
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = lag; i < frames; i++) s += (onset[i] - om) * (onset[i - lag] - om);
    acf[lag] = s / (frames - lag);
  }
  let bestLag = minLag, bestScore = -Infinity;
  const scoreAt = (lag) => {
    const bpm = (60 * FPS) / lag;
    const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    return acf[lag] * w;
  };
  for (let lag = minLag; lag <= maxLag; lag++) {
    const s = scoreAt(lag);
    if (s > bestScore) { bestScore = s; bestLag = lag; }
  }
  // 게임용으로는 75~165 BPM 이 다루기 좋다. 반/두 배 템포도 충분히 그럴듯하면 그쪽으로 옮긴다.
  const bestIn = (a, b) => {
    let L = -1, S = -Infinity;
    for (let lag = Math.max(minLag, a); lag <= Math.min(maxLag, b); lag++) if (scoreAt(lag) > S) { S = scoreAt(lag); L = lag; }
    return [L, S];
  };
  {
    const bpm = (60 * FPS) / bestLag;
    if (bpm > 165) {
      const [L, S] = bestIn(Math.floor(bestLag * 2) - 2, Math.ceil(bestLag * 2) + 2);
      if (L > 0 && S >= 0.45 * bestScore) { bestLag = L; bestScore = S; }
    } else if (bpm < 75) {
      const [L, S] = bestIn(Math.floor(bestLag / 2) - 1, Math.ceil(bestLag / 2) + 1);
      if (L > 0 && S >= 0.45 * bestScore) { bestLag = L; bestScore = S; }
    }
  }
  // 포물선 보간으로 소수점 주기
  let period = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const a = scoreAt(bestLag - 1), b = scoreAt(bestLag), c = scoreAt(bestLag + 1);
    const den = a - 2 * b + c;
    if (den < 0) period = bestLag + (0.5 * (a - c)) / den;
  }

  onProgress(0.7, "비트 추적");
  await tick();

  // ---- 동적 계획법 비트 추적
  const sigma = period / 16;
  const gw = Math.ceil(sigma * 3);
  const local = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let k = -gw; k <= gw; k++) {
      const j = i + k;
      if (j >= 0 && j < frames) s += onset[j] * Math.exp(-0.5 * (k / sigma) ** 2);
    }
    local[i] = s;
  }
  const tight = 100;
  const cum = new Float32Array(frames), back = new Int32Array(frames).fill(-1);
  const lo2 = Math.round(period * 2), hi2 = Math.round(period / 2);
  for (let i = 0; i < frames; i++) {
    let best = -Infinity, arg = -1;
    for (let j = Math.max(0, i - lo2); j <= i - hi2; j++) {
      const r = Math.log((i - j) / period);
      const s = cum[j] - tight * r * r;
      if (s > best) { best = s; arg = j; }
    }
    cum[i] = local[i] + (arg >= 0 ? best : 0);
    back[i] = arg;
  }
  // 끝 근처 국소 최대 중 충분히 큰 마지막 것을 출발점으로 역추적
  const peaks = [];
  for (let i = 1; i < frames - 1; i++) if (cum[i] > cum[i - 1] && cum[i] >= cum[i + 1]) peaks.push(i);
  const medPeak = percentile(peaks.map((i) => cum[i]), 0.5);
  let last = frames - 1;
  for (let k = peaks.length - 1; k >= 0; k--) if (cum[peaks[k]] >= 0.5 * medPeak) { last = peaks[k]; break; }
  let beatFrames = [];
  for (let i = last; i >= 0; i = back[i]) beatFrames.push(i);
  beatFrames.reverse();

  // 무음인 앞뒤 비트는 버린다
  const rmsHi = percentile(rms, 0.95) || 1e-6;
  const loud = (f) => {
    let m = 0;
    for (let k = -8; k <= 8; k++) m = Math.max(m, rms[Math.min(frames - 1, Math.max(0, f + k))]);
    return m > rmsHi * 0.06;
  };
  while (beatFrames.length && !loud(beatFrames[0])) beatFrames.shift();
  while (beatFrames.length && !loud(beatFrames[beatFrames.length - 1])) beatFrames.pop();

  // ---- 박자 정리
  // 대부분의 곡은 템포가 일정하다. DP 비트가 하나의 격자(t0 + k·P)에 잘 맞으면 격자 자체를 비트로 쓴다.
  // 그러면 인트로처럼 엇박만 나오는 구간에서 추적기가 반 박 밀려도 곡 전체의 박에 다시 맞춰지고,
  // 프레임 단위 양자화 지터도 사라진다. 잘 안 맞으면(라이브 녹음 등) 이웃 비트 회귀로 지터만 편다.
  let beats = beatFrames.map((f) => f / FPS);
  let steady = false;
  if (beats.length > 16) {
    // 첫 추정: DP 비트 번호 i 에 대한 직선 회귀 (DP 는 박을 거의 건너뛰지 않는다)
    let P, t0;
    {
      let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
      beats.forEach((t, i) => { n++; sx += i; sy += t; sxx += i * i; sxy += i * t; });
      P = (n * sxy - sx * sy) / (n * sxx - sx * sx);
      t0 = (sy - P * sx) / n;
    }
    // 반 박 밀린 구간 등 큰 잔차를 빼면서 다시 맞춘다
    for (let pass = 0; pass < 4; pass++) {
      const tol = P * [0.3, 0.2, 0.12, 0.08][pass];
      let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
      beats.forEach((t, i) => {
        if (Math.abs(t - (t0 + i * P)) > tol) return;
        n++; sx += i; sy += t; sxx += i * i; sxy += i * t;
      });
      const den = n * sxx - sx * sx;
      if (n < 8 || den <= 0) break;
      P = (n * sxy - sx * sy) / den;
      t0 = (sy - P * sx) / n;
    }
    t0 = ((t0 % P) + P) % P;
    // 격자 번호를 붙여 최소제곱으로 P, t0 를 다듬는다(벗어난 비트는 제외하고 두 번)
    for (let pass = 0; pass < 3; pass++) {
      let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (const t of beats) {
        const k = Math.round((t - t0) / P), d = t - (t0 + k * P);
        if (Math.abs(d) > P * (pass ? 0.08 : 0.15)) continue;
        n++; sx += k; sy += t; sxx += k * k; sxy += k * t;
      }
      const den = n * sxx - sx * sx;
      if (n < 8 || den <= 0) break;
      P = (n * sxy - sx * sy) / den;
      t0 = (sy - P * sx) / n;
    }
    // 격자에 맞는 비트의 비율. 인트로·아웃트로는 보통 조용하고 박이 애매하므로 음량으로 가중한다.
    let good = 0, wGood = 0, wAll = 0;
    for (const t of beats) {
      const k = Math.round((t - t0) / P), w = rms[Math.min(frames - 1, Math.round(t * FPS))] + 1e-6;
      wAll += w;
      if (Math.abs(t - (t0 + k * P)) < P * 0.09) { good++; wGood += w; }
    }
    // 격자가 DP 비트만큼 음악(온셋)을 잘 설명하면 채택한다
    const first = beats[0], lastB = beats[beats.length - 1];
    const k0 = Math.round((first - t0) / P), k1 = Math.round((lastB - t0) / P);
    const grid = [];
    for (let k = k0; k <= k1; k++) grid.push(t0 + k * P);
    const fit = (list) => list.reduce((a, t) => a + local[Math.min(frames - 1, Math.max(0, Math.round(t * FPS)))], 0) / list.length;
    if (wGood / wAll > 0.65 || (good / beats.length > 0.5 && fit(grid) >= 0.9 * fit(beats))) {
      steady = true;
      period = P * FPS;
      beats = grid;
    }
  }
  if (!steady && beats.length > 4) {
    const smoothBeats = (src, skip) => {
      const out = new Array(src.length);
      for (let i = 0; i < src.length; i++) {
        const a = Math.max(0, i - 4), b = Math.min(src.length - 1, i + 4);
        let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
        for (let k = a; k <= b; k++) {
          if (skip && skip[k] && k !== i) continue;
          n++; sx += k; sy += src[k]; sxx += k * k; sxy += k * src[k];
        }
        const den = n * sxx - sx * sx;
        out[i] = den > 0 ? (sy * sxx - sx * sxy) / den + ((n * sxy - sx * sy) / den) * i : src[i];
      }
      return out;
    };
    const first = smoothBeats(beats);
    const pSec = period / FPS;
    const outlier = beats.map((t, i) => Math.abs(t - first[i]) > pSec * 0.18);
    beats = smoothBeats(beats, outlier);
  }

  onProgress(0.82, "마디·구간 분석");
  await tick();

  // ---- 프레임 → 값 조회 도우미
  const sample = (arr, t, radius = 0.03) => {
    const c = Math.round(t * FPS), r = Math.max(1, Math.round(radius * FPS));
    let m = 0;
    for (let k = -r; k <= r; k++) {
      const j = c + k;
      if (j >= 0 && j < frames && arr[j] > m) m = arr[j];
    }
    return m;
  };

  // ---- 다운비트: 4박 위상 중 킥(저역)이 가장 강한 것
  const phaseScore = [0, 0, 0, 0];
  beats.forEach((t, i) => (phaseScore[i % 4] += sample(fLow, t) * 1.0 + sample(onset, t) * 0.4));
  const downPhase = phaseScore.indexOf(Math.max(...phaseScore));

  // ---- 비트별 에너지(RMS)와 피버 구간
  const beatEnergy = beats.map((t) => {
    const a = Math.max(0, Math.floor(t * FPS)), b = Math.min(frames - 1, a + Math.round(period));
    let s = 0;
    for (let i = a; i <= b; i++) s += rms[i];
    return s / Math.max(1, b - a + 1);
  });
  const eSmooth = beatEnergy.map((_, i) => {
    let s = 0, n = 0;
    for (let k = i - 8; k <= i + 8; k++) if (k >= 0 && k < beatEnergy.length) { s += beatEnergy[k]; n++; }
    return s / n;
  });
  // 오츠(Otsu) 문턱으로 "센 구간 / 약한 구간"을 가른다. 너무 넓거나 좁지 않게 50~85 백분위로 제한.
  const feverCut = (() => {
    const lo = percentile(eSmooth, 0.5), hi = percentile(eSmooth, 0.85);
    const mn = Math.min(...eSmooth), mx = Math.max(...eSmooth);
    if (!(mx > mn)) return Infinity;
    let best = lo, bestVar = -1;
    for (let s = 1; s < 64; s++) {
      const th = mn + ((mx - mn) * s) / 64;
      let n0 = 0, n1 = 0, s0 = 0, s1 = 0;
      for (const v of eSmooth) if (v < th) { n0++; s0 += v; } else { n1++; s1 += v; }
      if (!n0 || !n1) continue;
      const bv = n0 * n1 * (s0 / n0 - s1 / n1) ** 2;
      if (bv > bestVar) { bestVar = bv; best = th; }
    }
    return Math.min(hi, Math.max(lo, best));
  })();
  const fever = [];
  let runStart = -1;
  for (let i = 0; i <= eSmooth.length; i++) {
    const on = i < eSmooth.length && eSmooth[i] >= feverCut;
    if (on && runStart < 0) runStart = i;
    if (!on && runStart >= 0) {
      // 마디 경계에 맞춰서 16박 이상인 구간만
      let s = runStart, e = i - 1;
      while (s < e && (s - downPhase) % 4 !== 0) s++;
      if (e - s + 1 >= 16) fever.push({ start: beats[s], end: beats[e] + period / FPS, startBeat: s, endBeat: e });
      runStart = -1;
    }
  }

  // ---- 재생 중 배경 연출용으로 프레임 값을 가볍게 줄여 둔다 (약 43fps)
  const envRate = FPS / 2;
  const envLen = Math.ceil(frames / 2);
  const energyEnv = new Float32Array(envLen), lowEnv = new Float32Array(envLen), highEnv = new Float32Array(envLen);
  const lowHi = percentile(fLow, 0.97) || 1, highHi = percentile(fHigh, 0.97) || 1;
  for (let i = 0; i < envLen; i++) {
    const j = Math.min(frames - 1, i * 2);
    energyEnv[i] = Math.min(1.5, rms[j] / rmsHi);
    lowEnv[i] = Math.min(1.5, Math.max(fLow[j], fLow[Math.min(frames - 1, j + 1)]) / lowHi);
    highEnv[i] = Math.min(1.5, Math.max(fHigh[j], fHigh[Math.min(frames - 1, j + 1)]) / highHi);
  }

  onProgress(0.9, "채보 준비");
  await tick();

  return {
    duration,
    bpm: (60 * FPS) / period,
    steady,
    period: period / FPS,
    beats,
    downPhase,
    fever,
    beatEnergy,
    // 채보 생성용 원자료
    frames: { fps: FPS, onset, low: fLow, mid: fMid, high: fHigh, rms, bright, rmsHi },
    // 배경 연출용
    env: { rate: envRate, energy: energyEnv, low: lowEnv, high: highEnv },
  };
}
