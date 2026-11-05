/**
 * 자유 장면 엔진 — 카드뉴스 틀 없이 레이어와 키프레임으로 아무 영상이나 그린다.
 * 순수 함수: ctx, 시간 t, 미디어 공급자만 받는다 (브라우저·Node 공용).
 *
 * 장면 = 크기·길이·배경 + 레이어 목록.
 * 레이어 = 종류(text/image/video/rect/circle/line) + 기본 속성 + animate(키프레임) + enter/exit(프리셋).
 */
import {clamp01, EASINGS, hash01, lerp, spring} from './easing';

export type Easing = keyof typeof EASINGS | 'spring';
/** [시간(초, 레이어 시작 기준), 값, 이징(이 키프레임으로 들어올 때)] */
export type Keyframe = [number, number | string, Easing?];

export type Preset =
  | 'fade'
  | 'fade-up'
  | 'fade-down'
  | 'slide-left'
  | 'slide-right'
  | 'slide-up'
  | 'slide-down'
  | 'pop'
  | 'zoom-in'
  | 'zoom-out'
  | 'blur'
  | 'drop'
  | 'spin'
  | 'wipe-right'
  | 'wipe-left'
  | 'wipe-up'
  | 'wipe-down';
export type PresetSpec = Preset | {name: Preset; duration?: number; easing?: Easing; distance?: number};

export type UnitReveal = {
  /** 글자·단어·줄 단위로 차례로 등장 */
  by: 'chars' | 'words' | 'lines';
  preset?: 'fade-up' | 'pop' | 'drop' | 'blur' | 'scramble' | 'fade';
  /** 전체 등장에 걸리는 시간 (초) */
  duration?: number;
  /** 한 단위가 움직이는 시간 (초) */
  unitDuration?: number;
  delay?: number;
};

type Base = {
  id?: string;
  start?: number;
  end?: number;
  x?: number;
  y?: number;
  /** 0~1, 0.5 = 가운데 기준 */
  anchorX?: number;
  anchorY?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  /** 도 단위 */
  rotation?: number;
  opacity?: number;
  blur?: number;
  blend?: GlobalCompositeOperation;
  shadow?: {color?: string; blur?: number; x?: number; y?: number};
  /** 이 사각형 밖은 가림 (레이어 좌표 기준이 아니라 화면 좌표) */
  clip?: {x: number; y: number; width: number; height: number; radius?: number};
  animate?: Record<string, Keyframe[]>;
  enter?: PresetSpec;
  exit?: PresetSpec;
};

export type TextLayer = Base & {
  type: 'text';
  text: string;
  font?: string;
  size?: number;
  weight?: number | string;
  color?: string;
  align?: CanvasTextAlign;
  maxWidth?: number;
  lineHeight?: number;
  letterSpacing?: number;
  stroke?: {color: string; width: number};
  background?: {color: string; padding?: number; radius?: number};
  reveal?: UnitReveal;
};
export type MediaLayer = Base & {
  type: 'image' | 'video';
  src: string;
  width?: number;
  height?: number;
  fit?: 'cover' | 'contain' | 'fill';
  radius?: number;
  /** 영상 재생 시작 위치 (초) */
  trimStart?: number;
  loop?: boolean;
};
export type RectLayer = Base & {
  type: 'rect';
  width: number;
  height: number;
  color?: string;
  gradient?: {from: string; to: string; angle?: number};
  radius?: number;
  stroke?: {color: string; width: number};
};
export type CircleLayer = Base & {type: 'circle'; radius: number; color?: string; stroke?: {color: string; width: number}};
export type LineLayer = Base & {
  type: 'line';
  /** 화면 좌표 점들 (x, y 이동과 함께 움직임) */
  points: Array<[number, number]>;
  color?: string;
  width?: number;
  /** 0~1 그려진 비율 (animate 로 선 긋기) */
  progress?: number;
  smooth?: boolean;
  dash?: number[];
};
export type Layer = TextLayer | MediaLayer | RectLayer | CircleLayer | LineLayer;

export type Scene = {
  width?: number;
  height?: number;
  fps?: number;
  duration: number;
  background?: string | {from: string; to: string; angle?: number};
  layers: Layer[];
};

export type SceneFrame = {source: CanvasImageSource; width: number; height: number} | null;
/** 미디어 공급자: src 와 그 레이어 안의 시간(초) → 그릴 프레임 */
export type MediaProvider = (src: string, localSec: number, layer: MediaLayer) => SceneFrame;

export const sceneSize = (s: Scene) => ({W: s.width ?? 1080, H: s.height ?? 1920, fps: s.fps ?? 30});

/* ---------------- 값 보간 ---------------- */

function parseColor(c: string): [number, number, number, number] | null {
  const m = c.trim().match(/^#([0-9a-f]{3,8})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join('');
  const n = parseInt(h.slice(0, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

function mixColor(a: string, b: string, t: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return t < 0.5 ? a : b;
  const c = ca.map((v, i) => lerp(v, cb[i], t));
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${c[3].toFixed(3)})`;
}

function ease(name: Easing | undefined, t: number, segSec: number): number {
  if (name === 'spring') return spring(t * Math.max(0.3, segSec) * 1.6, 170, 14);
  const fn = (name && EASINGS[name]) || EASINGS.easeOutCubic;
  return fn(t);
}

/** 키프레임 값 (숫자 또는 #색) */
export function sampleKeys(keys: Keyframe[], t: number): number | string {
  if (!keys.length) return 0;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, e1] = keys[i];
    const [t0, v0] = keys[i - 1];
    if (t <= t1) {
      const k = ease(e1, clamp01((t - t0) / Math.max(1e-6, t1 - t0)), t1 - t0);
      if (typeof v0 === 'number' && typeof v1 === 'number') return lerp(v0, v1, k);
      return mixColor(String(v0), String(v1), k);
    }
  }
  return keys[keys.length - 1][1];
}

function prop<T extends number | string>(layer: Layer, name: string, base: T, local: number): T {
  const keys = layer.animate?.[name];
  return keys && keys.length ? (sampleKeys(keys, local) as T) : base;
}

/* ---------------- 등장·퇴장 프리셋 ---------------- */

type Tx = {dx: number; dy: number; sx: number; sy: number; rot: number; alpha: number; blur: number; wipe?: {dir: string; k: number}};
const ID: Tx = {dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, alpha: 1, blur: 0};

function presetTx(spec: PresetSpec | undefined, k: number): Tx {
  if (!spec) return ID;
  const name = typeof spec === 'string' ? spec : spec.name;
  const d = (typeof spec === 'object' && spec.distance) || 80;
  const inv = 1 - k;
  switch (name) {
    case 'fade':
      return {...ID, alpha: k};
    case 'fade-up':
      return {...ID, alpha: k, dy: inv * d};
    case 'fade-down':
      return {...ID, alpha: k, dy: -inv * d};
    case 'slide-left':
      return {...ID, alpha: Math.min(1, k * 2), dx: inv * d * 3};
    case 'slide-right':
      return {...ID, alpha: Math.min(1, k * 2), dx: -inv * d * 3};
    case 'slide-up':
      return {...ID, alpha: Math.min(1, k * 2), dy: inv * d * 3};
    case 'slide-down':
      return {...ID, alpha: Math.min(1, k * 2), dy: -inv * d * 3};
    case 'pop':
      return {...ID, alpha: Math.min(1, k * 3), sx: k, sy: k};
    case 'zoom-in':
      return {...ID, alpha: k, sx: 0.6 + 0.4 * k, sy: 0.6 + 0.4 * k};
    case 'zoom-out':
      return {...ID, alpha: k, sx: 1.6 - 0.6 * k, sy: 1.6 - 0.6 * k};
    case 'blur':
      return {...ID, alpha: k, blur: inv * 20};
    case 'drop':
      return {...ID, alpha: Math.min(1, k * 3), dy: -inv * d * 4};
    case 'spin':
      return {...ID, alpha: k, rot: -inv * 180, sx: k, sy: k};
    case 'wipe-right':
    case 'wipe-left':
    case 'wipe-up':
    case 'wipe-down':
      return {...ID, wipe: {dir: name, k}};
    default:
      return ID;
  }
}

function presetDefaults(spec: PresetSpec): {dur: number; easing: Easing} {
  const name = typeof spec === 'string' ? spec : spec.name;
  const dur = (typeof spec === 'object' && spec.duration) || (name === 'drop' ? 0.7 : 0.5);
  const easing = (typeof spec === 'object' && spec.easing) || (name === 'pop' ? 'easeOutBack' : name === 'drop' ? 'easeOutBounce' : 'easeOutCubic');
  return {dur, easing};
}

/* ---------------- 그리기 ---------------- */

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function fillStyleOf(ctx: CanvasRenderingContext2D, color: string | undefined, gradient: RectLayer['gradient'], x: number, y: number, w: number, h: number) {
  if (gradient) {
    const a = ((gradient.angle ?? 90) * Math.PI) / 180;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const r = Math.hypot(w, h) / 2;
    const g = ctx.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    g.addColorStop(0, gradient.from);
    g.addColorStop(1, gradient.to);
    return g;
  }
  return color ?? '#fff';
}

/** 텍스트를 maxWidth 로 줄바꿈 (\n 도 존중) */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth?: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (!maxWidth) {
      out.push(para);
      continue;
    }
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const test = line + word;
      if (line && ctx.measureText(test).width > maxWidth) {
        out.push(line.trimEnd());
        line = word.trimStart();
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

const GLYPHS = '#%&@*+=?!ABCDEFGHJKLMNPRSTUVXYZ0123456789';

function drawText(ctx: CanvasRenderingContext2D, L: TextLayer, local: number) {
  const size = prop(L, 'size', L.size ?? 64, local);
  const color = prop(L, 'color', L.color ?? '#ffffff', local);
  const weight = L.weight ?? 700;
  const font = L.font ?? 'Pretendard, "Apple SD Gothic Neo", sans-serif';
  ctx.font = `${weight} ${size}px ${font}`;
  const spacing = L.letterSpacing ?? 0;
  if (spacing) (ctx as unknown as {letterSpacing: string}).letterSpacing = `${spacing}px`;
  const lh = (L.lineHeight ?? 1.25) * size;
  const lines = wrapLines(ctx, L.text, L.maxWidth);
  const widths = lines.map((l) => ctx.measureText(l).width);
  const boxW = Math.max(...widths, 1);
  const boxH = lines.length * lh;
  const ax = L.anchorX ?? 0.5;
  const ay = L.anchorY ?? 0.5;
  const left = -boxW * ax;
  const top = -boxH * ay;
  const align = L.align ?? 'center';
  const lineX = (w: number) => (align === 'left' ? left : align === 'right' ? left + boxW - w : left + (boxW - w) / 2);

  if (L.background) {
    const p = L.background.padding ?? size * 0.35;
    ctx.fillStyle = L.background.color;
    roundRectPath(ctx, left - p, top - p * 0.6, boxW + p * 2, boxH + p * 1.2, L.background.radius ?? size * 0.25);
    ctx.fill();
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;

  const drawLine = (s: string, x: number, y: number) => {
    if (L.stroke) {
      ctx.lineWidth = L.stroke.width;
      ctx.strokeStyle = L.stroke.color;
      ctx.lineJoin = 'round';
      ctx.strokeText(s, x, y);
    }
    ctx.fillText(s, x, y);
  };

  const R = L.reveal;
  if (!R) {
    lines.forEach((l, i) => drawLine(l, lineX(widths[i]), top + i * lh + size * 0.92));
    return;
  }
  // 단위 등장
  type Unit = {s: string; x: number; y: number; w: number};
  const units: Unit[] = [];
  lines.forEach((l, i) => {
    const y = top + i * lh + size * 0.92;
    const x0 = lineX(widths[i]);
    if (R.by === 'lines') units.push({s: l, x: x0, y, w: widths[i]});
    else {
      const parts = R.by === 'words' ? l.split(/(\s+)/).filter(Boolean) : Array.from(l);
      let pre = '';
      for (const part of parts) {
        const x = x0 + ctx.measureText(pre).width;
        pre += part;
        if (part.trim()) units.push({s: part, x, y, w: ctx.measureText(part).width});
      }
    }
  });
  const total = R.duration ?? 0.8;
  const ud = R.unitDuration ?? Math.min(0.5, total * 0.6);
  const gap = Math.max(0, (total - ud) / Math.max(1, units.length - 1));
  const t = local - (R.delay ?? 0);
  const baseAlpha = ctx.globalAlpha;
  units.forEach((u, i) => {
    const raw = clamp01((t - i * gap) / ud);
    const preset = R.preset ?? 'fade-up';
    const k = preset === 'pop' ? EASINGS.easeOutBack(raw) : preset === 'drop' ? EASINGS.easeOutBounce(raw) : EASINGS.easeOutCubic(raw);
    if (raw <= 0 && preset !== 'scramble') return;
    ctx.save();
    ctx.globalAlpha = baseAlpha * (preset === 'scramble' ? Math.min(1, raw * 4) : Math.min(1, raw * 2));
    const cx = u.x + u.w / 2;
    const cy = u.y - size * 0.35;
    ctx.translate(cx, cy);
    if (preset === 'fade-up') ctx.translate(0, (1 - k) * size * 0.8);
    if (preset === 'drop') ctx.translate(0, -(1 - k) * size * 1.4);
    if (preset === 'pop') ctx.scale(Math.max(0.001, k), Math.max(0.001, k));
    if (preset === 'blur' && raw < 1) ctx.filter = `blur(${((1 - k) * 14).toFixed(1)}px)`;
    let s = u.s;
    if (preset === 'scramble' && raw < 0.75) {
      s = Array.from(u.s)
        .map((_, j) => GLYPHS[Math.floor(hash01(i * 37 + j * 13 + Math.floor(local * 24)) * GLYPHS.length)])
        .join('');
    }
    drawLine(s, -u.w / 2, size * 0.35);
    ctx.restore();
  });
}

function drawMedia(ctx: CanvasRenderingContext2D, L: MediaLayer, local: number, media: MediaProvider, sceneW: number, sceneH: number) {
  const fm = media(L.src, local, L);
  if (!fm) return;
  const w = prop(L, 'width', L.width ?? sceneW, local);
  const h = prop(L, 'height', L.height ?? (L.width ? (L.width * fm.height) / fm.width : sceneH), local);
  const ax = L.anchorX ?? 0.5;
  const ay = L.anchorY ?? 0.5;
  const x = -w * ax;
  const y = -h * ay;
  ctx.save();
  if (L.radius) {
    roundRectPath(ctx, x, y, w, h, prop(L, 'radius', L.radius, local));
    ctx.clip();
  }
  const fit = L.fit ?? 'cover';
  if (fit === 'fill') ctx.drawImage(fm.source, x, y, w, h);
  else {
    const s = fit === 'cover' ? Math.max(w / fm.width, h / fm.height) : Math.min(w / fm.width, h / fm.height);
    const dw = fm.width * s;
    const dh = fm.height * s;
    if (fit === 'cover') {
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
    }
    ctx.drawImage(fm.source, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
  ctx.restore();
}

function drawShape(ctx: CanvasRenderingContext2D, L: RectLayer | CircleLayer | LineLayer, local: number) {
  if (L.type === 'rect') {
    const w = prop(L, 'width', L.width, local);
    const h = prop(L, 'height', L.height, local);
    const x = -w * (L.anchorX ?? 0.5);
    const y = -h * (L.anchorY ?? 0.5);
    roundRectPath(ctx, x, y, w, h, prop(L, 'radius', L.radius ?? 0, local));
    if (L.color || L.gradient || !L.stroke) {
      ctx.fillStyle = fillStyleOf(ctx, prop(L, 'color', L.color ?? '#ffffff', local), L.gradient, x, y, w, h);
      ctx.fill();
    }
    if (L.stroke) {
      ctx.lineWidth = L.stroke.width;
      ctx.strokeStyle = L.stroke.color;
      ctx.stroke();
    }
  } else if (L.type === 'circle') {
    const r = prop(L, 'radius', L.radius, local);
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(0, r), 0, Math.PI * 2);
    if (L.color || !L.stroke) {
      ctx.fillStyle = prop(L, 'color', L.color ?? '#ffffff', local);
      ctx.fill();
    }
    if (L.stroke) {
      ctx.lineWidth = L.stroke.width;
      ctx.strokeStyle = L.stroke.color;
      ctx.stroke();
    }
  } else {
    // 선: 점들은 화면 좌표, 레이어 x/y 는 추가 이동
    const pts = L.points;
    if (pts.length < 2) return;
    const progress = clamp01(prop(L, 'progress', L.progress ?? 1, local));
    const segLens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
    const total = segLens.reduce((a, b) => a + b, 0);
    let remain = total * progress;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length && remain > 0; i++) {
      const seg = segLens[i - 1];
      const k = Math.min(1, remain / Math.max(1e-6, seg));
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      ctx.lineTo(lerp(x0, x1, k), lerp(y0, y1, k));
      remain -= seg;
    }
    ctx.lineWidth = prop(L, 'width', L.width ?? 6, local);
    ctx.strokeStyle = prop(L, 'color', L.color ?? '#ffffff', local);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (L.dash) ctx.setLineDash(L.dash);
    ctx.stroke();
  }
}

/** 장면의 t 초 프레임을 그린다 */
export function drawScene(ctx: CanvasRenderingContext2D, scene: Scene, t: number, media: MediaProvider) {
  const {W, H} = sceneSize(scene);
  ctx.save();
  const bg = scene.background ?? '#000000';
  ctx.fillStyle = typeof bg === 'string' ? bg : fillStyleOf(ctx, undefined, bg, 0, 0, W, H);
  ctx.fillRect(0, 0, W, H);

  for (const L of scene.layers) {
    const start = L.start ?? 0;
    const end = L.end ?? scene.duration;
    if (t < start || t > end) continue;
    const local = t - start;
    const life = end - start;

    // 등장/퇴장 프리셋
    let tx: Tx = ID;
    let ex: Tx = ID;
    if (L.enter) {
      const {dur, easing} = presetDefaults(L.enter);
      tx = presetTx(L.enter, ease(easing, clamp01(local / dur), dur));
    }
    if (L.exit) {
      const {dur, easing} = presetDefaults(L.exit);
      const k = clamp01((life - local) / dur);
      if (k < 1) ex = presetTx(L.exit, ease(easing, k, dur));
    }

    const x = prop(L, 'x', L.x ?? W / 2, local) + tx.dx + ex.dx;
    const y = prop(L, 'y', L.y ?? H / 2, local) + tx.dy + ex.dy;
    const sc = prop(L, 'scale', L.scale ?? 1, local);
    const sx = prop(L, 'scaleX', L.scaleX ?? 1, local) * sc * tx.sx * ex.sx;
    const sy = prop(L, 'scaleY', L.scaleY ?? 1, local) * sc * tx.sy * ex.sy;
    const rot = prop(L, 'rotation', L.rotation ?? 0, local) + tx.rot + ex.rot;
    const alpha = clamp01(prop(L, 'opacity', L.opacity ?? 1, local) * tx.alpha * ex.alpha);
    const blur = prop(L, 'blur', L.blur ?? 0, local) + tx.blur + ex.blur;
    if (alpha <= 0.001) continue;

    ctx.save();
    if (L.clip) {
      roundRectPath(ctx, L.clip.x, L.clip.y, L.clip.width, L.clip.height, L.clip.radius ?? 0);
      ctx.clip();
    }
    const wipe = tx.wipe ?? ex.wipe;
    if (wipe) {
      const k = wipe.k;
      ctx.beginPath();
      if (wipe.dir === 'wipe-right') ctx.rect(0, 0, W * k, H);
      else if (wipe.dir === 'wipe-left') ctx.rect(W * (1 - k), 0, W * k, H);
      else if (wipe.dir === 'wipe-up') ctx.rect(0, H * (1 - k), W, H * k);
      else ctx.rect(0, 0, W, H * k);
      ctx.clip();
    }
    ctx.globalAlpha = alpha;
    if (blur > 0.3) ctx.filter = `blur(${blur.toFixed(1)}px)`;
    if (L.blend) ctx.globalCompositeOperation = L.blend;
    if (L.shadow) {
      ctx.shadowColor = L.shadow.color ?? 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = L.shadow.blur ?? 20;
      ctx.shadowOffsetX = L.shadow.x ?? 0;
      ctx.shadowOffsetY = L.shadow.y ?? 0;
    }
    if (L.type === 'line') {
      ctx.translate(x - W / 2, y - H / 2); // 선은 화면 좌표 기준, x/y 는 이동량으로
    } else {
      ctx.translate(x, y);
      if (rot) ctx.rotate((rot * Math.PI) / 180);
      ctx.scale(sx, sy);
    }

    if (L.type === 'text') drawText(ctx, L, local);
    else if (L.type === 'image' || L.type === 'video') drawMedia(ctx, L as MediaLayer, local, media, W, H);
    else drawShape(ctx, L as RectLayer | CircleLayer | LineLayer, local);
    ctx.restore();
  }
  ctx.restore();
}

/** 장면에 쓰인 미디어 경로 목록 */
export function sceneMedia(scene: Scene): MediaLayer[] {
  return scene.layers.filter((l): l is MediaLayer => l.type === 'image' || l.type === 'video');
}
