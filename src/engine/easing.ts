/**
 * 모션 레시피 — 이징·스프링·스태거 등 모션을 만들 때 자주 쓰는 도구 모음.
 * 전부 순수 함수라 브라우저·Node 어디서나 쓴다. 입력 t 는 0~1 진행률.
 * 새 모션을 만들 때는 여기 있는 것부터 조합한다 (docs/MOTION-RECIPES.md).
 */

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** 구간 [a,b] 안에서의 진행률 0~1 */
export const progress = (v: number, a: number, b: number) => clamp01((v - a) / Math.max(1e-6, b - a));

/* ---- 기본 이징 (Penner 계열) ---- */
export const linear = (t: number) => clamp01(t);
export const easeInQuad = (t: number) => clamp01(t) ** 2;
export const easeOutQuad = (t: number) => 1 - (1 - clamp01(t)) ** 2;
export const easeInCubic = (t: number) => clamp01(t) ** 3;
export const easeOutCubic = (t: number) => 1 - (1 - clamp01(t)) ** 3;
export const easeInOutCubic = (t: number) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};
export const easeOutQuart = (t: number) => 1 - (1 - clamp01(t)) ** 4;
export const easeOutQuint = (t: number) => 1 - (1 - clamp01(t)) ** 5;
export const easeOutExpo = (t: number) => {
  const x = clamp01(t);
  return x >= 1 ? 1 : 1 - 2 ** (-10 * x);
};
export const easeInOutExpo = (t: number) => {
  const x = clamp01(t);
  if (x <= 0 || x >= 1) return x;
  return x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2;
};
export const easeOutCirc = (t: number) => Math.sqrt(1 - (clamp01(t) - 1) ** 2);
export const easeOutSine = (t: number) => Math.sin((clamp01(t) * Math.PI) / 2);
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * clamp01(t)) - 1) / 2;

/** 살짝 넘쳤다 돌아오는 (overshoot) */
export const easeOutBack = (t: number, s = 1.70158) => {
  const x = clamp01(t);
  return 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2;
};
/** 고무줄처럼 떨림 */
export const easeOutElastic = (t: number) => {
  const x = clamp01(t);
  if (x <= 0 || x >= 1) return x;
  return 2 ** (-10 * x) * Math.sin(((x * 10 - 0.75) * (2 * Math.PI)) / 3) + 1;
};
/** 바닥에 튕김 */
export const easeOutBounce = (t: number) => {
  let x = clamp01(t);
  const n1 = 7.5625;
  const d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
};

/** CSS cubic-bezier(x1,y1,x2,y2) 와 같은 곡선 (디자이너가 준 값을 그대로 쓸 때) */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sy = (u: number) => ((ay * u + by) * u + cy) * u;
  return (t: number) => {
    const x = clamp01(t);
    let u = x;
    for (let i = 0; i < 6; i++) {
      const dx = sx(u) - x;
      const d = (3 * ax * u + 2 * bx) * u + cx;
      if (Math.abs(dx) < 1e-5 || Math.abs(d) < 1e-6) break;
      u -= dx / d;
    }
    return sy(clamp01(u));
  };
}
/** 자주 쓰는 베지어 */
export const easeSnappy = cubicBezier(0.2, 0.9, 0.1, 1); // 빠르게 붙는 UI 느낌
export const easeEditorial = cubicBezier(0.65, 0, 0.35, 1); // 차분한 인아웃

/**
 * 감쇠 스프링 (질량 1). sec 초 뒤의 위치 0→1.
 * stiffness 를 올리면 빨라지고, damping 을 낮추면 더 출렁인다.
 */
export function spring(sec: number, stiffness = 170, damping = 14): number {
  if (sec <= 0) return 0;
  const w0 = Math.sqrt(stiffness);
  const zeta = damping / (2 * w0);
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * sec) * (Math.cos(wd * sec) + ((zeta * w0) / wd) * Math.sin(wd * sec));
  }
  return 1 - Math.exp(-w0 * sec) * (1 + w0 * sec);
}

/**
 * 스태거: n 개 항목이 total 초 안에 차례로 각자 dur 초씩 움직일 때 i 번째의 진행률.
 */
export function stagger(sec: number, i: number, n: number, total: number, dur: number): number {
  const gap = Math.max(0, (total - dur) / Math.max(1, n - 1));
  return clamp01((sec - i * gap) / dur);
}

/** 키프레임 보간: [[t, v], ...] (t 오름차순) */
export function keyframes(t: number, frames: Array<[number, number]>, ease: (x: number) => number = linear): number {
  if (t <= frames[0][0]) return frames[0][1];
  for (let i = 1; i < frames.length; i++) {
    const [t1, v1] = frames[i];
    const [t0, v0] = frames[i - 1];
    if (t <= t1) return lerp(v0, v1, ease(progress(t, t0, t1)));
  }
  return frames[frames.length - 1][1];
}

/** 결정적 의사 난수 0~1 (같은 입력이면 같은 값 → 영상이 매번 똑같이 나옴) */
export function hash01(n: number): number {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** 부드러운 1D 노이즈 -1~1 (핸드헬드·떨림용) */
export function noise1(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash01(i) * 2 - 1, hash01(i + 1) * 2 - 1, u);
}

/** 이름으로 고를 수 있는 이징 목록 (MCP list_motions 에도 노출) */
export const EASINGS = {
  linear,
  easeOutQuad,
  easeOutCubic,
  easeInOutCubic,
  easeOutQuart,
  easeOutQuint,
  easeOutExpo,
  easeInOutExpo,
  easeOutCirc,
  easeOutSine,
  easeInOutSine,
  easeOutBack: (t: number) => easeOutBack(t),
  easeOutElastic,
  easeOutBounce,
  easeSnappy,
  easeEditorial,
} as const;
