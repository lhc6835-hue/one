// 분석 결과 → 난이도별 채보(노트 목록).
//
// 비트(정박)를 뼈대로 두고, 난이도가 오를수록 반박·16분 자리에 실제 온셋이 있는 곳만 노트를 더한다.
// 강도는 "주변 8박 대비 상대 세기"로 판단해서, 조용한 구간에도 그 구간 나름의 강세에 노트가 붙는다.
// 방향은 마디마다 패턴(쓸기·지그재그·반대편·나선·점프)을 골라 흐름이 있게 만든다.

export const DIFFICULTIES = {
  easy: {
    label: "EASY", name: "쉬움", stars: 1, approach: 1.55, minGap: 0.42,
    beat: 0.55, beatOdd: 1.25, half: Infinity, quarter: Infinity, hp: 7,
  },
  normal: {
    label: "NORMAL", name: "보통", stars: 2, approach: 1.25, minGap: 0.27,
    beat: 0.3, beatOdd: 0.3, half: 1.55, quarter: Infinity, hp: 9,
  },
  hard: {
    label: "HARD", name: "어려움", stars: 3, approach: 1.0, minGap: 0.17,
    beat: 0.18, beatOdd: 0.18, half: 0.85, quarter: 1.75, hp: 11,
  },
  expert: {
    label: "EXPERT", name: "익스퍼트", stars: 4, approach: 0.82, minGap: 0.115,
    beat: 0.08, beatOdd: 0.08, half: 0.55, quarter: 1.15, hp: 13,
  },
};

const DIRS = 12;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 곡마다 다르지만 같은 곡이면 항상 같은 채보가 나오도록 하는 시드 */
export function songSeed(analysis) {
  let h = 2166136261;
  const push = (v) => { h ^= Math.round(v * 1000); h = Math.imul(h, 16777619); };
  push(analysis.duration);
  push(analysis.bpm);
  analysis.beats.slice(0, 32).forEach(push);
  return h >>> 0;
}

export function makeChart(analysis, diffKey, seed = songSeed(analysis)) {
  const D = DIFFICULTIES[diffKey];
  const { beats, period, downPhase, fever, frames } = analysis;
  const { fps, onset, low, high, rms, rmsHi } = frames;
  const n = onset.length;
  const rand = mulberry(seed ^ diffKey.length * 7919);

  const peakNear = (arr, t, r = 0.035) => {
    const c = Math.round(t * fps), w = Math.max(1, Math.round(r * fps));
    let m = 0;
    for (let k = -w; k <= w; k++) {
      const j = c + k;
      if (j >= 0 && j < n && arr[j] > m) m = arr[j];
    }
    return m;
  };
  const loudAt = (t) => peakNear(rms, t, 0.08) > rmsHi * 0.07;
  const inFever = (t) => fever.some((f) => t >= f.start - 0.01 && t < f.end);
  const p95 = (arr) => {
    const s = Float32Array.from(arr.filter((_, i) => i % 4 === 0)).sort();
    return s[Math.floor(s.length * 0.95)] || 1;
  };
  const lowN = p95(low), highN = p95(high);

  // ---- 후보 자리: 정박, 반박, 16분
  const cands = [];
  for (let i = 0; i < beats.length; i++) {
    const t0 = beats[i];
    const t1 = i + 1 < beats.length ? beats[i + 1] : t0 + period;
    const step = t1 - t0;
    cands.push({ t: t0, kind: "beat", beat: i, down: (i - downPhase) % 4 === 0 });
    cands.push({ t: t0 + step / 2, kind: "half", beat: i });
    cands.push({ t: t0 + step / 4, kind: "quarter", beat: i });
    cands.push({ t: t0 + (step * 3) / 4, kind: "quarter", beat: i });
  }
  for (const c of cands) c.s = peakNear(onset, c.t);

  // 주변 8박(정박 후보)의 중앙값 대비 상대 세기
  const beatS = cands.filter((c) => c.kind === "beat").map((c) => c.s);
  const localMed = beatS.map((_, i) => {
    const win = beatS.slice(Math.max(0, i - 8), i + 9).slice().sort((a, b) => a - b);
    return win[Math.floor(win.length / 2)] || 1e-3;
  });
  for (const c of cands) c.rel = c.s / Math.max(0.15, localMed[c.beat] ?? 1);

  // ---- 난이도 문턱 통과한 후보 고르기
  const picked = [];
  for (const c of cands) {
    if (!loudAt(c.t)) continue;
    const fv = inFever(c.t) ? 0.72 : 1;
    let need;
    if (c.kind === "beat") need = (c.beat % 2 === 0 ? D.beat : D.beatOdd) * fv;
    else if (c.kind === "half") need = D.half * fv;
    else need = D.quarter * fv;
    if (c.rel >= need) picked.push(c);
  }
  picked.sort((a, b) => a.t - b.t);

  // 최소 간격: 너무 붙은 두 노트 중 우선순위(정박 > 강한 쪽)가 높은 것을 남긴다
  const prio = (c) => (c.kind === "beat" ? 2 : c.kind === "half" ? 1 : 0) + Math.min(1.5, c.rel) * 0.6;
  const notes = [];
  for (const c of picked) {
    const last = notes[notes.length - 1];
    if (last && c.t - last.t < D.minGap) {
      if (prio(c) > prio(last)) notes[notes.length - 1] = c;
      continue;
    }
    notes.push(c);
  }

  // ---- 골드(강세) 노트: 다운비트 강타, 피버 진입 첫 박
  const feverStarts = new Set(fever.map((f) => f.startBeat));
  let lastGold = -Infinity;
  for (const nt of notes) {
    const strong = nt.kind === "beat" && nt.down && nt.rel > 1.35;
    const entry = nt.kind === "beat" && feverStarts.has(nt.beat);
    if ((strong && nt.t - lastGold > period * 7.5) || entry) {
      nt.gold = true;
      lastGold = nt.t;
    }
  }

  // ---- 방향: 마디마다 패턴
  const patterns = ["sweep", "zigzag", "mirror", "spiral", "jump", "pendulum"];
  let dir = Math.floor(rand() * DIRS), bar = -1, pat = "sweep", sign = 1, k = 0, swing = 0;
  for (let i = 0; i < notes.length; i++) {
    const nt = notes[i];
    const barIdx = Math.floor((nt.beat - downPhase) / 4);
    const gap = i > 0 ? nt.t - notes[i - 1].t : 1;
    if (barIdx !== bar) {
      bar = barIdx;
      pat = patterns[Math.floor(rand() * patterns.length)];
      sign = rand() < 0.5 ? -1 : 1;
      k = 0;
      swing = 0;
      if (i > 0) dir = (dir + (rand() < 0.5 ? 3 : 9)) % DIRS; // 마디가 바뀌면 크게 한 번 돌린다
    }
    if (i > 0 && k > 0) {
      switch (pat) {
        case "sweep": dir += sign; break;
        case "zigzag": dir += k % 2 ? 2 * sign : -sign; break;
        case "mirror": dir += 6; break;
        case "spiral": dir += sign * (gap < 0.22 ? 1 : 2); break;
        case "jump": dir += sign * (3 + Math.floor(rand() * 4)); break;
        case "pendulum": swing = (swing + 1) % 4; dir += sign * (swing < 2 ? 2 : -2); break;
      }
      if (nt.kind !== "beat" && gap < 0.2) dir = notes[i - 1].dir + sign; // 빠른 연타는 붙여서 흐르게
    }
    // 저역(킥)이 압도적인 골드 노트는 아래에서, 고역이 압도적이면 위에서 들어오게
    if (nt.gold) {
      const lowE = peakNear(low, nt.t) / lowN, highE = peakNear(high, nt.t) / highN;
      if (lowE > highE * 1.8) dir = 6;
      else if (highE > lowE * 1.8) dir = 0;
    }
    dir = ((dir % DIRS) + DIRS) % DIRS;
    nt.dir = dir;
    k++;
  }

  return {
    difficulty: diffKey,
    approach: D.approach,
    hpLoss: D.hp,
    notes: notes.map((c, i) => ({
      id: i,
      t: c.t,
      angle: (c.dir / DIRS) * Math.PI * 2 - Math.PI / 2,
      gold: !!c.gold,
      kind: c.kind,
      beat: c.beat,
    })),
  };
}

/** 난이도 카드에 보여줄 요약 */
export function chartSummary(chart, duration) {
  const nps = chart.notes.length / Math.max(1, duration);
  return { count: chart.notes.length, nps };
}
