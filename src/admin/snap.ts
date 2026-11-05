/**
 * PPT 처럼 끌 때 가운데·여백·다른 요소에 맞으면 착 붙고 안내선이 나오게 하는 계산.
 * 좌표는 모두 1080×1920 영상 기준.
 */
export type Rect = {x: number; y: number; w: number; h: number};
export type Guides = {v: number[]; h: number[]};

export type SnapTargets = {v: number[]; h: number[]};

/** 화면 기준선: 좌우 여백, 가운데, 위아래 안전 영역 */
export function stageTargets(W: number, H: number, margin = 72): SnapTargets {
  return {
    v: [margin, W / 2, W - margin],
    h: [margin * 1.6, H / 2, H - margin * 1.6],
  };
}

/** 다른 요소의 왼쪽·가운데·오른쪽 / 위·가운데·아래 */
export function rectTargets(r: Rect): SnapTargets {
  return {v: [r.x, r.x + r.w / 2, r.x + r.w], h: [r.y, r.y + r.h / 2, r.y + r.h]};
}

function snapAxis(edges: number[], targets: number[], threshold: number): {delta: number; lines: number[]} {
  let best: {d: number; t: number} | null = null;
  for (const e of edges) {
    for (const t of targets) {
      const d = t - e;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d))) best = {d, t};
    }
  }
  if (!best) return {delta: 0, lines: []};
  const delta = best.d;
  // 붙은 뒤 겹치는 기준선은 전부 보여 준다
  const lines = targets.filter((t) => edges.some((e) => Math.abs(e + delta - t) < 0.5));
  return {delta, lines: [...new Set(lines)]};
}

/** r 을 기준선에 맞춰 옮길 양과, 그릴 안내선 */
export function snapRect(r: Rect, targets: SnapTargets, threshold = 14): {dx: number; dy: number; guides: Guides} {
  const sx = snapAxis([r.x, r.x + r.w / 2, r.x + r.w], targets.v, threshold);
  const sy = snapAxis([r.y, r.y + r.h / 2, r.y + r.h], targets.h, threshold);
  return {dx: sx.delta, dy: sy.delta, guides: {v: sx.lines, h: sy.lines}};
}

export function mergeTargets(...list: SnapTargets[]): SnapTargets {
  return {v: list.flatMap((t) => t.v), h: list.flatMap((t) => t.h)};
}
