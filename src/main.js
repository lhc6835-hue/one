// 리듬 문지기: 화면 흐름(타이틀 → 분석 → 난이도 → 플레이 → 결과)과 입력을 묶는다.

import { Stage } from "./game/stage.js";
import { playRankBadge } from "./game/rank-badge.js";
import { analyzeSignal, toMono } from "./audio/analyze.js";
import { makeChart, DIFFICULTIES } from "./audio/chart.js";
import { renderDemo } from "./audio/demo.js";

const $ = (id) => document.getElementById(id);

// ---- 저장소(사생활 모드 등에서 막혀 있어도 게임은 돌아가야 한다)
const store = {
  get(k, d) { try { const v = localStorage.getItem("rg:" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("rg:" + k, JSON.stringify(v)); } catch {} },
};

// ---- 오디오 그래프: 음악 → 분석기 → 마스터, 효과음 → 마스터
const AC = window.AudioContext || window.webkitAudioContext;
const actx = new AC({ latencyHint: "interactive" });
const master = actx.createGain();
const analyser = actx.createAnalyser();
analyser.fftSize = 256;
analyser.smoothingTimeConstant = 0.72;
const music = actx.createGain();
const sfx = actx.createGain();
music.connect(analyser).connect(master);
sfx.connect(master);
master.connect(actx.destination);
const unlock = () => { if (actx.state === "suspended" && stage?.mode !== "paused") actx.resume(); };
window.addEventListener("pointerdown", unlock, { capture: true });
window.addEventListener("keydown", unlock, { capture: true });

const stage = new Stage($("stage"), { ctx: actx, analyser, music, sfx, master });
Object.assign(stage.settings, store.get("settings", {}));
window.addEventListener("resize", () => stage.resize());

const loop = (now) => { stage.frameTick(now); requestAnimationFrame(loop); };
requestAnimationFrame(loop);

// ---- 화면 전환
let current = "title";
function show(id) {
  for (const s of document.querySelectorAll(".screen:not(.modal)")) s.classList.toggle("show", s.id === id);
  current = id;
  const playing = id === null;
  $("playbar").hidden = !playing;
  document.body.classList.toggle("playing", playing);
}

// ---- 곡 상태
let song = null; // { name, buffer, key }
let analysis = null;
const charts = {};
let diff = store.get("diff", "normal");

const TIPS = [
  "박자는 곡 전체의 템포 격자에 맞춰 다듬어요. 엇박 인트로가 있어도 정박을 찾아요.",
  "곡에서 가장 뜨거운 구간은 FEVER! 오로라가 뜨고 HP 회복이 두 배가 돼요.",
  "금색 노트는 다운비트의 강타예요. 맞추면 크리티컬 이펙트가 터져요.",
  "노트 색은 박자 위치예요. 청록 = 정박, 분홍 = 반박, 연두 = 16분.",
  "결과 화면의 평균 오차를 보고 오프셋을 한 번에 보정할 수 있어요.",
  "같은 곡은 언제나 같은 채보가 나와요. 기록을 갈아치워 보세요!",
];

async function loadSong(name, getBuffer, key) {
  show("loading");
  $("title-error").hidden = true;
  $("load-name").textContent = name;
  $("load-tip").textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  const setP = (v, step) => { $("load-bar").style.width = Math.round(v * 100) + "%"; $("load-step").textContent = step; };
  try {
    setP(0.02, "오디오 디코딩");
    const buffer = await getBuffer();
    if (buffer.duration < 10) throw new Error("곡이 너무 짧아요 (10초 이상 필요).");
    setP(0.05, "모노 변환");
    const mono = await toMono(buffer);
    analysis = await analyzeSignal(mono, setP);
    if (analysis.beats.length < 16) throw new Error("박자를 찾기 어려운 곡이에요. 리듬이 뚜렷한 곡으로 해 보세요.");
    for (const k of Object.keys(DIFFICULTIES)) charts[k] = makeChart(analysis, k);
    song = { name, buffer, key: key + ":" + Math.round(buffer.duration) };
    setP(1, "완료!");
    setTimeout(openSelect, 250);
  } catch (e) {
    console.error(e);
    show("title");
    $("title-error").textContent = e?.message?.includes("decode") || e?.name === "EncodingError"
      ? "이 파일은 재생할 수 없어요. 다른 형식(mp3, wav 등)으로 시도해 보세요."
      : e?.message || "분석 중 문제가 생겼어요.";
    $("title-error").hidden = false;
  }
}

function fromFile(file) {
  if (!file) return;
  const name = file.name.replace(/\.[^.]+$/, "");
  loadSong(name, async () => actx.decodeAudioData(await file.arrayBuffer()), `${file.name}:${file.size}`);
}

$("file").addEventListener("change", (e) => fromFile(e.target.files[0]));
const drop = $("drop");
drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("file").click(); } });
for (const ev of ["dragenter", "dragover"]) window.addEventListener(ev, (e) => { e.preventDefault(); if (current === "title") drop.classList.add("over"); });
for (const ev of ["dragleave", "drop"]) window.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); });
window.addEventListener("drop", (e) => { if (current === "title") fromFile(e.dataTransfer?.files?.[0]); });
$("demo").addEventListener("click", () => loadSong("Neon Gate (데모 곡)", () => renderDemo(actx.sampleRate), "demo"));

// ---- 난이도 선택
const DIFF_COLORS = { easy: "#5ad84a", normal: "#3cc8ff", hard: "#ff9a2a", expert: "#f53cd1" };
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function openSelect() {
  $("sel-name").textContent = song.name;
  $("sel-bpm").textContent = Math.round(analysis.bpm);
  $("sel-len").textContent = fmtTime(song.buffer.duration);
  $("sel-fever").textContent = analysis.fever.length;
  $("speed").value = stage.settings.speed;
  $("speed-val").textContent = Number(stage.settings.speed).toFixed(1) + "x";
  const box = $("diffs");
  box.innerHTML = "";
  for (const [k, D] of Object.entries(DIFFICULTIES)) {
    const c = charts[k], best = store.get(`best:${song.key}:${k}`, null);
    const b = document.createElement("button");
    b.className = "diff" + (k === diff ? " sel" : "");
    b.style.setProperty("--c", DIFF_COLORS[k]);
    b.innerHTML = `<div><span class="dn">${D.label}</span><span class="dk">${D.name}</span></div>
      <div class="stars">${"★".repeat(D.stars)}${"☆".repeat(4 - D.stars)}</div>
      <div class="meta">노트 ${c.notes.length}개 · 초당 ${(c.notes.length / song.buffer.duration).toFixed(1)}개</div>
      <div class="best">${best ? `최고 ${best.rank} · ${best.score.toLocaleString()}${best.fc ? " · FC" : ""}` : ""}</div>`;
    b.addEventListener("click", () => {
      diff = k;
      store.set("diff", k);
      for (const el of box.children) el.classList.toggle("sel", el === b);
    });
    b.addEventListener("dblclick", startGame);
    box.appendChild(b);
  }
  show("select");
}
$("speed").addEventListener("input", (e) => {
  stage.settings.speed = Number(e.target.value);
  $("speed-val").textContent = stage.settings.speed.toFixed(1) + "x";
  store.set("settings", stage.settings);
});
$("back-title").addEventListener("click", () => show("title"));
$("start").addEventListener("click", startGame);

// ---- 플레이
function startGame() {
  actx.resume();
  stage.load(song, analysis, charts[diff]);
  stage.start();
  $("play-name").textContent = `${song.name} · ${DIFFICULTIES[diff].label}`;
  show(null);
}

function pauseGame() {
  if (stage.mode !== "play") return;
  stage.pause();
  $("paused").classList.add("show");
}
async function resumeGame() {
  $("paused").classList.remove("show");
  await stage.resume();
}
$("pause-btn").addEventListener("click", (e) => { e.stopPropagation(); pauseGame(); });
$("pause-btn").addEventListener("pointerdown", (e) => e.stopPropagation());
$("resume").addEventListener("click", resumeGame);
$("retry-p").addEventListener("click", async () => { $("paused").classList.remove("show"); await actx.resume(); startGame(); });
$("quit-p").addEventListener("click", async () => { $("paused").classList.remove("show"); stage.quit(); openSelect(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) pauseGame(); });

// 탭 입력: 캔버스 위 포인터, 아니면 키보드 아무 키
$("stage").addEventListener("pointerdown", (e) => {
  if (stage.mode === "play") { e.preventDefault(); stage.tap(e.timeStamp || performance.now()); }
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (stage.mode === "play") pauseGame();
    else if (stage.mode === "paused") resumeGame();
    else if ($("settings").classList.contains("show")) closeSettings();
    return;
  }
  if (stage.mode !== "play" || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.key === "Tab") return;
  e.preventDefault();
  stage.tap(e.timeStamp || performance.now());
});

// ---- 결과
let stopBadge = null;
stage.on("end", (r) => showResult(r));
stage.on("fail", (r) => showResult(r));

function showResult(r) {
  const key = `best:${song.key}:${diff}`;
  const prev = store.get(key, null);
  const isBest = !r.failed && (!prev || r.score > prev.score);
  if (isBest) store.set(key, { score: r.score, rank: r.rank, fc: r.fullCombo });
  setTimeout(() => {
    show("result");
    stopBadge?.();
    stopBadge = playRankBadge($("rank-cv"), r.rank);
    const badge = $("res-badge");
    badge.hidden = !(r.allPerfect || r.fullCombo || r.failed);
    badge.textContent = r.allPerfect ? "ALL PERFECT" : r.fullCombo ? "FULL COMBO" : "FAILED";
    if (r.failed) badge.style.background = "#ff4a5a";
    else badge.style.background = "";
    countUp($("res-score"), r.score);
    $("res-best").textContent = r.failed ? "HP가 바닥났어요. 다시 도전!" : isBest ? (prev ? `★ 최고 기록 갱신! (+${(r.score - prev.score).toLocaleString()})` : "★ 첫 기록!") : `최고 기록 ${prev.score.toLocaleString()}`;
    $("res-acc").textContent = (r.acc * 100).toFixed(2) + "%";
    $("res-combo").textContent = `${r.maxCombo} / ${r.notes}`;
    for (const j of ["perfect", "great", "good", "miss"]) $("res-" + j).textContent = r.counts[j];
    const off = $("res-offset");
    off.innerHTML = "";
    if (r.hits >= 12) {
      const ms = Math.round(r.meanOffset * 1000);
      const span = document.createElement("span");
      span.textContent = Math.abs(ms) < 8 ? `평균 오차 ${ms >= 0 ? "+" : ""}${ms}ms · 타이밍이 정확해요!` : `평균 ${Math.abs(ms)}ms ${ms > 0 ? "늦게" : "일찍"} 치고 있어요`;
      off.appendChild(span);
      if (Math.abs(ms) >= 8) {
        const b = document.createElement("button");
        b.className = "btn ghost";
        b.textContent = `오프셋 ${ms > 0 ? "+" : ""}${ms}ms 보정`;
        b.addEventListener("click", () => {
          stage.settings.offset = clampOffset(stage.settings.offset + ms);
          store.set("settings", stage.settings);
          syncSettings();
          b.disabled = true;
          b.textContent = `보정됨 (현재 ${stage.settings.offset}ms)`;
        });
        off.appendChild(b);
      }
    }
  }, r.failed ? 200 : 900);
}
const clampOffset = (v) => Math.max(-250, Math.min(250, Math.round(v / 5) * 5));

function countUp(el, target) {
  const t0 = performance.now(), D = 1100;
  const step = (now) => {
    const u = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - u, 3);
    el.textContent = Math.round(target * e).toLocaleString();
    if (u < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

$("res-retry").addEventListener("click", startGame);
$("res-change").addEventListener("click", () => { stage.quit(); openSelect(); });
$("res-new").addEventListener("click", () => { stage.quit(); show("title"); });

// ---- 설정
function syncSettings() {
  const s = stage.settings;
  $("set-offset").value = s.offset; $("set-offset-val").textContent = `${s.offset > 0 ? "+" : ""}${s.offset}ms`;
  $("set-volume").value = s.volume; $("set-volume-val").textContent = Math.round(s.volume * 100) + "%";
  $("set-hit").checked = s.hitSound; $("set-bloom").checked = s.bloom; $("set-nofail").checked = s.noFail;
}
function closeSettings() { $("settings").classList.remove("show"); store.set("settings", stage.settings); }
$("open-settings").addEventListener("click", () => { syncSettings(); $("settings").classList.add("show"); });
$("close-settings").addEventListener("click", closeSettings);
$("set-offset").addEventListener("input", (e) => { stage.settings.offset = Number(e.target.value); syncSettings(); });
$("set-volume").addEventListener("input", (e) => { stage.settings.volume = Number(e.target.value); syncSettings(); });
$("set-hit").addEventListener("change", (e) => (stage.settings.hitSound = e.target.checked));
$("set-bloom").addEventListener("change", (e) => (stage.settings.bloom = e.target.checked));
$("set-nofail").addEventListener("change", (e) => (stage.settings.noFail = e.target.checked));
syncSettings();

// 테스트·디버그용 훅
window.__rg = { stage, get analysis() { return analysis; }, charts, loadDemo: () => $("demo").click(), startGame };
