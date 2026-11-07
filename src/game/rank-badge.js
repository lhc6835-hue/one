// 결과 카드 안의 작은 캔버스에 랭크 도장(pixelfx 이펙트)을 따로 그린다.

import { createFrame, clearFrame, createFx, composite, PAL } from "../vendor/pixelfx/core/index.js";
import { rankStamp } from "./fx-custom.js";

const PALETTES = {
  "S+": ["#1a0a2a", "#3d1060", "#7a28b0", "#c060f0", "#ff9cf0", "#ffe0ff", "#fff6ff", "#ffffff"],
  S: PAL.gold,
  A: PAL.cyber,
  B: PAL.ice,
  C: PAL.heal,
  D: PAL.stone,
  F: PAL.blood,
};

export function playRankBadge(canvas, rank) {
  const W = 128, H = 128;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const frame = createFrame(W, H);
  const img = ctx.createImageData(W, H);
  const fx = createFx(rankStamp, { x: W / 2, y: H / 2, text: rank, palette: PALETTES[rank] ?? PAL.gold });
  // 도장이 다 찍힌 뒤에는 마지막 직전 프레임에 머문다
  const hold = rankStamp.meta.duration - 0.25;
  let last = performance.now(), stop = false;
  const loop = (now) => {
    if (stop) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (fx.t < hold) fx.update(dt);
    clearFrame(frame);
    fx.draw(frame);
    composite(frame, img.data, null);
    ctx.putImageData(img, 0, 0);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return () => (stop = true);
}
