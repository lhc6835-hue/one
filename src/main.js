// 궤도 점프: 화면 흐름(타이틀 → 플레이 → 게임오버)과 입력, 저장(최고 기록·코인·스킨).

import { View } from "./game/view.js";
import { Sfx } from "./game/sfx.js";
import { SKINS } from "./game/skins.js";
import { DEATH } from "./game/world.js";

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem("oh:" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("oh:" + k, JSON.stringify(v)); } catch {} },
};

const save = {
  best: store.get("best", 0),
  coins: store.get("coins", 0),
  owned: store.get("owned", ["comet"]),
  skin: store.get("skin", "comet"),
  sound: store.get("sound", true),
  games: store.get("games", 0),
};
const persist = () => { for (const [k, v] of Object.entries(save)) store.set(k, v); };

const sfx = new Sfx();
sfx.setOn(save.sound);
const view = new View($("stage"), sfx);
view.best = save.best;
view.setSkin(SKINS.find((s) => s.id === save.skin) || SKINS[0]);
window.addEventListener("resize", () => view.resize());

let mode = "title"; // title | play | paused | over
const loop = (now) => { view.tick(now, mode === "paused" ? "paused" : mode === "over" ? "over" : mode); requestAnimationFrame(loop); };
requestAnimationFrame(loop);

function showScreen(id) {
  for (const s of document.querySelectorAll(".screen:not(.modal)")) s.classList.toggle("show", s.id === id);
  $("pause-btn").hidden = mode !== "play";
  document.body.classList.toggle("playing", mode === "play");
}
function refreshTitle() {
  $("t-best").textContent = save.best;
  $("t-coins").textContent = save.coins;
  $("sound").textContent = save.sound ? "소리 켬" : "소리 끔";
  $("sound").setAttribute("aria-pressed", String(save.sound));
}
refreshTitle();

// ---- 시작 / 다시
const trackFor = (zone) => (zone >= 4 ? "boss" : zone >= 2 ? "stage2" : "stage1");
function startRun(fromTitle) {
  sfx.unlock();
  sfx.playMusic(trackFor(0));
  sfx.duck(false);
  if (!fromTitle) view.newWorld(Math.floor(Math.random() * 1e9));
  view.best = save.best;
  view.tutorial = save.games < 2;
  mode = "play";
  showScreen(null);
}
function goTitle() {
  mode = "title";
  sfx.playMusic("title");
  sfx.duck(false);
  view.newWorld(Math.floor(Math.random() * 1e9));
  refreshTitle();
  showScreen("title");
}

// 입력: 플레이 중엔 화면 어디든 탭 / 스페이스 등 아무 키
function onTap(e) {
  if (mode === "title") {
    if (e.target.closest("button")) return;
    startRun(true); // 첫 탭은 시작만 한다(엉뚱한 방향으로 바로 날아가지 않게)
    return;
  }
  if (mode === "play") {
    if (e.target.closest && e.target.closest("button")) return;
    view.tap();
  }
}
window.addEventListener("pointerdown", (e) => {
  sfx.unlock();
  if ($("skins").classList.contains("show") || $("paused").classList.contains("show")) return;
  if (mode === "title" || mode === "play") { e.preventDefault?.(); onTap(e); }
});
window.addEventListener("keydown", (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  sfx.unlock();
  if (e.key === "Escape") {
    if ($("skins").classList.contains("show")) closeSkins();
    else if (mode === "play") pause();
    else if (mode === "paused") resume();
    return;
  }
  if (mode === "over" && (e.key === " " || e.key === "Enter")) {
    if (Date.now() - overAt > 450) { e.preventDefault(); startRun(false); }
    return;
  }
  if ($("skins").classList.contains("show")) return;
  if (e.key === "Tab") return;
  if (mode === "title") { e.preventDefault(); startRun(true); return; }
  if (mode === "play") { e.preventDefault(); view.tap(); }
});

view.on("zone", (z) => sfx.playMusic(trackFor(view.world.zone)));

// ---- 일시정지
function pause() {
  if (mode !== "play") return;
  mode = "paused";
  sfx.duck(true);
  $("paused").classList.add("show");
  $("pause-btn").hidden = true;
}
function resume() {
  $("paused").classList.remove("show");
  mode = "play";
  sfx.duck(false);
  view.last = performance.now();
  showScreen(null);
}
$("pause-btn").addEventListener("pointerdown", (e) => { e.stopPropagation(); pause(); });
$("resume").addEventListener("click", resume);
$("quit").addEventListener("click", () => { $("paused").classList.remove("show"); goTitle(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });

// ---- 게임 오버
let overAt = 0;
const TIPS = [
  "궤도 가장자리를 스치듯 들어가면 PERFECT. 3연속마다 점수 배율이 올라가요.",
  "아래에서 올라오는 붉은 공허를 조심하세요. 머뭇거리면 따라잡혀요.",
  "용암 행성은 2초 뒤에 터져요. 붙잡히자마자 다음 점프를 노리세요.",
  "블랙홀 근처를 스치고 지나가면 CLOSE! 보너스 +2점.",
  "금빛 방패는 공허·폭발·소행성에서 한 번 살려 줘요.",
  "코인을 모아 새 혜성 스킨을 열어 보세요.",
  "항성은 3점! 대신 빨리 돌아요.",
];
view.on("death", (r) => {
  mode = "over";
  overAt = Date.now();
  save.games++;
  save.coins += r.coins;
  const isBest = r.score > save.best;
  sfx.duck(true);
  sfx.jingle(isBest && r.score > 0 ? "jingle-best" : "jingle-over", 0.5);
  if (isBest) save.best = r.score;
  persist();
  $("o-reason").textContent = DEATH[r.reason] || "게임 오버";
  $("o-new").hidden = !isBest || r.score === 0;
  $("o-best").textContent = save.best;
  $("o-jumps").textContent = r.jumps;
  $("o-perfect").textContent = r.perfects;
  $("o-combo").textContent = r.maxCombo;
  $("o-coins").textContent = "+" + r.coins;
  $("o-tip").textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  countUp($("o-score"), r.score);
  showScreen("over");
  setTimeout(() => $("retry").focus({ preventScroll: true }), 50);
});
function countUp(el, target) {
  const t0 = performance.now(), D = 600;
  const step = (now) => {
    const u = Math.min(1, (now - t0) / D);
    el.textContent = Math.round(target * (1 - Math.pow(1 - u, 3)));
    if (u < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
$("retry").addEventListener("click", () => startRun(false));
$("o-home").addEventListener("click", goTitle);

// ---- 스킨
function renderSkins() {
  $("s-coins").textContent = save.coins;
  const grid = $("skin-grid");
  grid.innerHTML = "";
  for (const s of SKINS) {
    const own = save.owned.includes(s.id);
    const b = document.createElement("button");
    b.className = "skin" + (save.skin === s.id ? " sel" : "") + (own ? "" : " locked");
    const r = s.ramp;
    const bg = s.rainbow ? `conic-gradient(${r.join(",")},${r[0]})` : `radial-gradient(circle at 35% 35%, #fff 0 12%, ${r[5]} 22%, ${r[3]} 50%, ${r[1]} 85%)`;
    b.innerHTML = `<span class="orb" style="background:${bg};box-shadow:0 0 16px ${r[4]}"></span><span class="nm">${s.name}</span>
      <span class="pr ${own ? "own" : ""}">${own ? (save.skin === s.id ? "사용 중" : "보유") : "● " + s.cost}</span>`;
    b.disabled = !own && save.coins < s.cost;
    b.addEventListener("click", () => {
      if (!own) {
        if (save.coins < s.cost) return;
        save.coins -= s.cost;
        save.owned.push(s.id);
        sfx.best();
      }
      save.skin = s.id;
      view.setSkin(s);
      persist();
      renderSkins();
      refreshTitle();
    });
    grid.appendChild(b);
  }
}
function openSkins() { renderSkins(); $("skins").classList.add("show"); }
function closeSkins() { $("skins").classList.remove("show"); }
$("open-skins").addEventListener("click", openSkins);
$("o-skins").addEventListener("click", openSkins);
$("close-skins").addEventListener("click", closeSkins);
$("sound").addEventListener("click", () => { save.sound = !save.sound; sfx.setOn(save.sound); persist(); refreshTitle(); });

// 테스트용 훅
window.__oh = { view, get mode() { return mode; }, startRun };
