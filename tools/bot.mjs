// 자동 플레이 봇: 생성된 맵이 실제로 깰 수 있는지, 판당 얼마나 가는지 확인한다.
// node tools/bot.mjs [판 수] [반응 지연(초)] [타이밍 오차 표준편차(초)]
// 봇은 "지금 쏘면 어디에 잡히는지"를 블랙홀·움직이는 행성·소행성까지 넣어 예측하고, 위쪽 새 행성에 잡힐 때만 쏜다.
import { World, orbitR, STEP, SPEED, advance, launchState } from "../src/game/world.js";

const games = Number(process.argv[2] || 100);
const lag = Number(process.argv[3] || 0);
const sigma = Number(process.argv[4] || 0);
let seedN = 7;
const rnd = () => { seedN = (seedN * 16807) % 2147483647; return seedN / 2147483647; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());

function predict(w, delay) {
  const P = w.player, p0 = P.planet;
  const th = P.theta + p0.omega * P.dir * delay, ro = orbitR(p0);
  const t0 = w.t + delay;
  const px0 = p0.move ? p0.baseX + Math.sin(t0 * p0.moveF * Math.PI * 2 * 0.25 + p0.moveP) * p0.move : p0.x;
  const o = launchState(px0, p0.y, ro, th, P.dir);
  const dt = STEP;
  for (let s = 0; s < 600; s++) {
    const t = t0 + s * dt;
    if (advance(o, dt, w.holes)) return null;
    const { x, y } = o;
    for (const r of w.rocks) {
      const rx = r.x + r.vx * (t - w.t);
      if (Math.abs(rx - x) < r.r + 6 && Math.abs(r.y - y) < r.r + 6) return null;
    }
    for (const q of w.planets) {
      if (q.dead) continue;
      const qx = q.move ? q.baseX + Math.sin(t * q.moveF * Math.PI * 2 * 0.25 + q.moveP) * q.move : q.x;
      const d = Math.hypot(x - qx, y - q.y);
      if (q === p0 && s * dt < 0.6) continue;
      if (d < orbitR(q) - 2) return q.visited || q.y >= p0.y || q.fuse > 0 || p0.y - q.y > 220 ? null : { q, perp: d };
    }
    if (Math.abs(x) > w.colW / 2 + 60) return null;
  }
  return null;
}

const deaths = {}, scores = [];
for (let g = 0; g < games; g++) {
  const w = new World(1000 + g, 200);
  let tapAt = -1, steps = 0, nextCheck = 0;
  while (w.player.mode !== "dead" && steps < 240 * 400 && w.score < 400) {
    const P = w.player;
    if (P.mode === "orbit" && tapAt < 0 && w.t >= nextCheck) {
      // 사람처럼: 앞으로 한 바퀴 안에서 "쏘면 잡히는 구간"을 찾고 그 가운데를 노린다(+ 타이밍 오차)
      const period = (2 * Math.PI) / P.planet.omega;
      // 한 바퀴 동안의 발사 가능 구간들을 모으고, 0.08초 이상인 첫 구간(없으면 가장 긴 구간)의 가운데를 노린다
      const wins = [];
      let a = -1;
      for (let d = lag; d < lag + period; d += 1 / 240) {
        const ok = predict(w, d);
        if (ok && a < 0) a = d;
        if (!ok && a >= 0) { wins.push([a, d]); a = -1; }
      }
      if (a >= 0) wins.push([a, lag + period]);
      const pick = wins.find(([x, y]) => y - x >= 0.08) || wins.sort((u, v) => (v[1] - v[0]) - (u[1] - u[0]))[0];
      if (pick) tapAt = w.t + Math.max(0, (pick[0] + pick[1]) / 2 + gauss() * sigma);
      nextCheck = tapAt >= 0 ? Infinity : w.t + 0.1;
    }
    if (tapAt >= 0 && w.t >= tapAt) { w.tap(); tapAt = -1; nextCheck = 0; }
    w.update(STEP);
    w.events.length = 0;
    steps++;
  }
  deaths[w.deathReason || "alive"] = (deaths[w.deathReason || "alive"] || 0) + 1;
  scores.push(w.score);
}
scores.sort((a, b) => a - b);
console.log({ games, lag, sigma, median: scores[scores.length >> 1], p10: scores[Math.floor(scores.length * 0.1)], max: scores.at(-1), deaths });
