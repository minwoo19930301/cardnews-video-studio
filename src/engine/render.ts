/**
 * 카드뉴스 한 프레임을 그리는 엔진.
 * 브라우저 미리보기 · 브라우저 내보내기 · MCP(Node) 렌더가 모두 이 파일 하나를 쓴다.
 * window / document 를 쓰지 않는다 (ctx 와 미리 준비된 미디어 프레임만 받는다).
 */
import {parseFx, stripMarkers} from '../admin/markers';
import {
  defaultChip,
  fontCss,
  type PhotoEffect,
  type Pos,
  type Project,
  type Slide,
  type SlideTransition,
  type TextEnter,
} from '../admin/types';

import {
  clamp01,
  easeInOutCubic,
  easeOutBack,
  easeOutBounce,
  easeOutCubic,
  easeOutExpo,
  easeOutQuint,
  hash01,
  keyframes,
  lerp,
  noise1,
  spring,
} from './easing';

export const W = 1080;
export const H = 1920;
export const FPS = 30;

/** 뉴스 한 장 길이 (초) */
export const SLIDE_SEC = 8;

/**
 * 글자 연출 타임라인 (슬라이드 8초 중 앞부분만 사용)
 * 전체 등장 → 끝난 뒤 부분 강조. 합쳐 1.4초 안팎에 끝나고 이후 홀드.
 */
export const TEXT_ENTER_SEC = 0.6;
/** 글자·단어 단위 등장은 스태거가 있어 조금 더 길게 */
export const TEXT_ENTER_UNIT_SEC = 0.8;
export const TEXT_EMPHASIS_GAP_SEC = 0.03;
export const TEXT_EMPHASIS_SEC = 0.6;
/** 슬라이드 시작 전환 길이 */
export const TRANSITION_SEC = 0.45;

export const DEFAULT_COLORS = {
  text: '#FFFFFF',
  accent: '#E03A2C',
  chip: '#E03A2C',
  highlight: '#FFE14D',
};

/** 한 장에서 쓰는 색 */
export type Palette = {text: string; accent: string; chip: string; highlight: string; shade: number};

export function paletteOf(slide: Slide | null): Palette {
  return {
    text: slide?.textColor || DEFAULT_COLORS.text,
    accent: slide?.accentColor || DEFAULT_COLORS.accent,
    chip: slide?.chipColor || DEFAULT_COLORS.chip,
    highlight: slide?.highlightColor || DEFAULT_COLORS.highlight,
    shade: slide?.shade ?? 1,
  };
}

/** 이번 프레임에 그릴 미디어 (이미지, 또는 이미 seek 된 비디오 프레임) */
export type FrameMedia = {
  source: CanvasImageSource;
  width: number;
  height: number;
} | null;

/* ---------------- 공통 유틸 ---------------- */

/** 슬라이드 진행(0~1) → 실제 초 */
const animToSec = (anim: number) => clamp01(anim) * SLIDE_SEC;

/** 등장 효과별 길이 */
export function textEnterSec(te: TextEnter | string): number {
  if (te === 'none') return 0;
  if (te === 'pop-chars' || te === 'drop-chars' || te === 'word-up' || te === 'blur-chars' || te === 'scramble') return TEXT_ENTER_UNIT_SEC;
  return TEXT_ENTER_SEC;
}

export function drawCover(
  ctx: CanvasRenderingContext2D,
  media: NonNullable<FrameMedia>,
  scale = 1,
) {
  const {width: iw, height: ih} = media;
  if (!iw || !ih) return;
  const base = Math.max(W / iw, H / ih) * scale;
  const dw = iw * base;
  const dh = ih * base;
  ctx.drawImage(media.source, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

function fitFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxPx: number,
  maxWidth: number,
  weight: number,
  family: string,
) {
  let size = maxPx;
  const plain = stripMarkers(text);
  while (size > 28) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(plain).width <= maxWidth) break;
    size -= 2;
  }
  return size;
}

/* ---------------- 부분 강조 (마커) ---------------- */

type Pt = [number, number];

/**
 * 펜 획: 점들을 따라 굵기가 변하는 선을 채워 그린다 (시작·끝은 가늘고 가운데는 굵게).
 * progress 0~1 만큼만 그리고, 그리는 중인 앞쪽은 둥글게 마감한다.
 */
function penStroke(
  ctx: CanvasRenderingContext2D,
  pts: Pt[],
  width: number,
  progress: number,
  color: string,
  opts: {head?: number; tail?: number; min?: number} = {},
) {
  const n = pts.length;
  if (n < 2 || progress <= 0) return;
  const head = opts.head ?? 0.12;
  const tail = opts.tail ?? 0.25;
  const min = opts.min ?? 0.18;
  const last = Math.max(1, Math.min(n - 1, Math.floor((n - 1) * clamp01(progress))));
  const widthAt = (u: number) => {
    const a = Math.min(1, u / head);
    const b = Math.min(1, (1 - u) / tail);
    return width * (min + (1 - min) * easeOutCubic(Math.min(a, b)));
  };
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i <= last; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[Math.min(n - 1, i + 1)];
    let nx = -(p1[1] - p0[1]);
    let ny = p1[0] - p0[0];
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    const w = widthAt(i / (n - 1)) / 2;
    left.push([pts[i][0] + nx * w, pts[i][1] + ny * w]);
    right.push([pts[i][0] - nx * w, pts[i][1] - ny * w]);
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (const p of left) ctx.lineTo(p[0], p[1]);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fill();
  // 앞쪽·시작 둥근 마감
  const capR = (i: number) => widthAt(i / (n - 1)) / 2;
  ctx.beginPath();
  ctx.arc(pts[last][0], pts[last][1], capR(last), 0, Math.PI * 2);
  ctx.arc(pts[0][0], pts[0][1], capR(0), 0, Math.PI * 2);
  ctx.fill();
}

/** 0~1 → 점 함수를 steps 개로 샘플 */
function sample(steps: number, fn: (u: number) => Pt): Pt[] {
  return Array.from({length: steps + 1}, (_, i) => fn(i / steps));
}

/** 손으로 칠한 듯한 띠 (가장자리가 살짝 울퉁불퉁), 왼쪽에서 오른쪽으로 p 만큼 */
function brushBand(ctx: CanvasRenderingContext2D, x: number, top: number, w: number, h: number, p: number, color: string, seed: number, skew = 0) {
  if (p <= 0) return;
  const reach = w * p;
  const steps = Math.max(6, Math.round(reach / 14));
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const xx = x + (reach * i) / steps;
    const yy = top + (hash01(seed + i * 3.1) - 0.5) * h * 0.08 - skew * (i / steps) * h;
    if (i === 0) ctx.moveTo(xx + skew * h, yy);
    else ctx.lineTo(xx + skew * h, yy);
  }
  for (let i = steps; i >= 0; i--) {
    const xx = x + (reach * i) / steps;
    const yy = top + h + (hash01(seed + i * 7.7 + 50) - 0.5) * h * 0.08 - skew * (i / steps) * h;
    ctx.lineTo(xx, yy);
  }
  ctx.closePath();
  ctx.fill();
}

/** 글자를 두 색으로: 왼쪽 edge 까지는 colA, 나머지는 colB */
function splitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, edge: number, colA: string, colB: string, fs: number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(edge, y - fs * 1.2, 4000, fs * 2);
  ctx.clip();
  ctx.fillStyle = colB;
  ctx.fillText(text, x, y);
  ctx.restore();
  if (edge <= x) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - 40, y - fs * 1.2, edge - x + 40, fs * 2);
  ctx.clip();
  ctx.shadowBlur = 0;
  ctx.fillStyle = colA;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** 배경색 위에 올라갈 글자색 (밝으면 검정, 어두우면 흰색) */
function inkOn(hex: string): string {
  const m = hex.trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return '#111111';
  const n = parseInt(m[1], 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 150 ? '#111111' : '#FFFFFF';
}

function drawMarkedLine(
  ctx: CanvasRenderingContext2D,
  line: string,
  x: number,
  y: number,
  align: CanvasTextAlign,
  fontSize: number,
  family: string,
  progress: number,
  pal: Palette,
) {
  const toks = parseFx(line);
  ctx.font = `800 ${fontSize}px ${family}`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const widths = toks.map((t) => ctx.measureText(t.text).width);
  const total = widths.reduce((a, b) => a + b, 0);
  let cx = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;
  const p = clamp01(progress);
  const A = pal.accent;
  const T = pal.text;
  const HL = pal.highlight;
  const fs = fontSize;
  const baseA = ctx.globalAlpha;
  const shadow = ctx.shadowBlur;

  toks.forEach((tok, i) => {
    const tw = widths[i];
    const top = y - fs * 0.8; // 글자 윗선 근처
    const bottom = y + fs * 0.14;
    const midY = y - fs * 0.34;
    const seed = i * 17 + tw;
    const e = easeInOutCubic(p);

    const plainText = (color = T, dx = 0, dy = 0) => {
      ctx.fillStyle = color;
      ctx.fillText(tok.text, cx + dx, y + dy);
    };

    switch (tok.fx) {
      case 'none':
        plainText();
        break;

      case 'hl': {
        // 형광펜: 노란 띠가 칠해지며 지나간 글자는 진한 색으로
        ctx.save();
        ctx.shadowBlur = 0;
        brushBand(ctx, cx - fs * 0.12, top - fs * 0.02, tw + fs * 0.24, bottom - top + fs * 0.04, e, HL, seed);
        ctx.restore();
        splitText(ctx, tok.text, cx, y, cx - fs * 0.12 + (tw + fs * 0.24) * e, inkOn(HL), T, fs);
        break;
      }

      case 'redhl': {
        // 빨간 띠: 기울어진 강조색 띠, 지나간 글자는 흰색
        ctx.save();
        ctx.shadowBlur = 0;
        brushBand(ctx, cx - fs * 0.16, top + fs * 0.02, tw + fs * 0.32, bottom - top, e, A, seed, 0.12);
        ctx.restore();
        splitText(ctx, tok.text, cx, y, cx - fs * 0.16 + (tw + fs * 0.32) * e, inkOn(A), T, fs);
        break;
      }

      case 'fill': {
        // 채움강조: 아래쪽 절반에 반투명 마커
        ctx.save();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = baseA * 0.75;
        brushBand(ctx, cx - fs * 0.08, y - fs * 0.34, tw + fs * 0.16, fs * 0.44, e, A, seed);
        ctx.restore();
        plainText();
        break;
      }

      case 'under': {
        plainText();
        ctx.save();
        ctx.shadowBlur = 0;
        const pts = sample(24, (u) => [cx - fs * 0.04 + (tw + fs * 0.1) * u, y + fs * 0.2 - Math.sin(u * Math.PI) * fs * 0.03 - u * fs * 0.04]);
        penStroke(ctx, pts, fs * 0.15, e, A, {head: 0.08, tail: 0.35, min: 0.3});
        ctx.restore();
        break;
      }

      case 'wave': {
        plainText();
        ctx.save();
        ctx.shadowBlur = 0;
        const waves = Math.max(2, Math.round(tw / (fs * 0.45)));
        const pts = sample(waves * 10, (u) => [cx - fs * 0.04 + (tw + fs * 0.08) * u, y + fs * 0.16 + Math.sin(u * Math.PI * 2 * waves) * fs * 0.055]);
        penStroke(ctx, pts, fs * 0.11, e, A, {head: 0.05, tail: 0.15, min: 0.45});
        ctx.restore();
        break;
      }

      case 'strike': {
        plainText();
        ctx.save();
        ctx.shadowBlur = 0;
        const pts = sample(20, (u) => [cx - fs * 0.08 + (tw + fs * 0.16) * u, midY + fs * 0.06 - u * fs * 0.1]);
        penStroke(ctx, pts, fs * 0.13, e, A, {head: 0.1, tail: 0.2, min: 0.3});
        ctx.restore();
        break;
      }

      case 'circle': {
        // 마커로 한 번에 그린 타원: 살짝 기울고, 끝이 시작을 지나쳐 겹침
        plainText();
        ctx.save();
        ctx.shadowBlur = 0;
        const ox = cx + tw / 2;
        const oy = midY;
        const rx = tw / 2 + fs * 0.36;
        const ry = fs * 0.68;
        const tilt = -0.06;
        const start = Math.PI * 1.12;
        const sweep = Math.PI * 2.18;
        const pts = sample(64, (u) => {
          const a = start + sweep * u;
          const grow = 1 + u * 0.07 + Math.sin(u * 9 + seed) * 0.012;
          const px = Math.cos(a) * rx * grow;
          const py = Math.sin(a) * ry * grow;
          return [ox + px * Math.cos(tilt) - py * Math.sin(tilt), oy + px * Math.sin(tilt) + py * Math.cos(tilt)];
        });
        penStroke(ctx, pts, fs * 0.13, e, A, {head: 0.06, tail: 0.14, min: 0.35});
        ctx.restore();
        break;
      }

      case 'box': {
        // 손으로 그린 사각형: 왼쪽 위에서 시작해 한 바퀴, 모서리를 살짝 넘김
        plainText();
        ctx.save();
        ctx.shadowBlur = 0;
        const bx = cx - fs * 0.22;
        const by = top - fs * 0.16;
        const bw = tw + fs * 0.44;
        const bh = bottom - top + fs * 0.32;
        const corners: Pt[] = [
          [bx - fs * 0.05, by + fs * 0.02],
          [bx + bw + fs * 0.03, by - fs * 0.02],
          [bx + bw, by + bh + fs * 0.03],
          [bx - fs * 0.02, by + bh],
          [bx + fs * 0.02, by - fs * 0.08],
        ];
        const pts: Pt[] = [];
        for (let k = 0; k < corners.length - 1; k++) {
          const [x0, y0] = corners[k];
          const [x1, y1] = corners[k + 1];
          for (let s = 0; s < 14; s++) pts.push([lerp(x0, x1, s / 14), lerp(y0, y1, s / 14)]);
        }
        pts.push(corners[corners.length - 1]);
        penStroke(ctx, pts, fs * 0.1, e, HL, {head: 0.03, tail: 0.08, min: 0.5});
        ctx.restore();
        break;
      }

      case 'outline': {
        // 속이 비어 가는 외곽선 글자
        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineWidth = fs * 0.08;
        ctx.strokeStyle = A;
        ctx.globalAlpha = baseA * Math.min(1, p * 3);
        ctx.strokeText(tok.text, cx, y);
        ctx.restore();
        ctx.save();
        ctx.globalAlpha = baseA * (1 - e * 0.92);
        plainText();
        ctx.restore();
        break;
      }

      case 'glow': {
        // 빛이 확 번졌다가 은은하게 남음
        const g = p <= 0 ? 0 : p < 0.35 ? p / 0.35 : 1 - 0.45 * easeOutCubic((p - 0.35) / 0.65);
        ctx.save();
        ctx.shadowColor = A;
        ctx.shadowBlur = fs * 0.6 * g;
        plainText(T);
        ctx.shadowBlur = fs * 0.25 * g;
        plainText(T);
        ctx.restore();
        break;
      }

      case 'stamp': {
        // 도장: 크게 떨어져 탁 찍히고 테두리가 남음
        if (p <= 0) {
          plainText();
          break;
        }
        const k = p < 0.45 ? easeOutCubic(p / 0.45) : 1;
        const s = 1.9 - 0.9 * k + (p > 0.45 && p < 0.6 ? Math.sin(((p - 0.45) / 0.15) * Math.PI) * 0.04 : 0);
        ctx.save();
        ctx.shadowBlur = 0;
        ctx.translate(cx + tw / 2, midY);
        ctx.rotate(-0.1);
        ctx.scale(s, s);
        ctx.globalAlpha = baseA * Math.min(1, p * 3) * 0.95;
        ctx.strokeStyle = A;
        ctx.lineWidth = fs * 0.06;
        rrect(ctx, -tw / 2 - fs * 0.24, -fs * 0.62, tw + fs * 0.48, fs * 1.18, fs * 0.12);
        ctx.stroke();
        ctx.lineWidth = fs * 0.025;
        rrect(ctx, -tw / 2 - fs * 0.14, -fs * 0.52, tw + fs * 0.28, fs * 0.98, fs * 0.08);
        ctx.stroke();
        ctx.fillStyle = A;
        ctx.textAlign = 'center';
        ctx.fillText(tok.text, 0, fs * 0.34);
        ctx.restore();
        break;
      }

      case 'shake': {
        // 점점 잦아드는 떨림
        const amp = p > 0 && p < 1 ? (1 - p) * fs * 0.08 : 0;
        const t = p * 30;
        ctx.save();
        ctx.translate(cx + tw / 2, midY);
        ctx.rotate(Math.sin(t * 1.3) * 0.05 * (1 - p));
        ctx.translate(-(cx + tw / 2), -midY);
        plainText(p > 0 ? A : T, Math.sin(t) * amp, Math.cos(t * 1.7) * amp * 0.4);
        ctx.restore();
        break;
      }

      case 'bounce': {
        // 글자마다 차례로 통 튀어 오름
        const chars = Array.from(tok.text);
        let px = cx;
        chars.forEach((ch, ci) => {
          const cw = ctx.measureText(ch).width;
          const lp = clamp01(p * 1.6 - (ci / Math.max(1, chars.length)) * 0.6);
          const jump = lp > 0 && lp < 1 ? Math.sin(lp * Math.PI) * fs * 0.32 : 0;
          const squash = lp > 0.85 && lp < 1 ? 1 - Math.sin(((lp - 0.85) / 0.15) * Math.PI) * 0.12 : 1;
          ctx.save();
          ctx.translate(px + cw / 2, y);
          ctx.scale(1 / squash, squash);
          ctx.fillStyle = T;
          ctx.fillText(ch, -cw / 2, -jump);
          ctx.restore();
          px += cw;
        });
        break;
      }

      case 'type': {
        // 타자: 한 글자씩, 커서가 깜빡이다 사라짐
        const chars = Array.from(tok.text);
        const shown = chars.slice(0, Math.floor(chars.length * Math.min(1, p * 1.15))).join('');
        ctx.fillStyle = T;
        ctx.fillText(shown, cx, y);
        const blink = p < 1 && Math.floor(p * 12) % 2 === 0;
        if (blink) {
          ctx.save();
          ctx.shadowBlur = 0;
          ctx.fillStyle = HL;
          ctx.fillRect(cx + ctx.measureText(shown).width + fs * 0.04, top + fs * 0.06, fs * 0.08, bottom - top - fs * 0.04);
          ctx.restore();
        }
        break;
      }

      case 'slot': {
        // 숫자 슬롯: 자리마다 세로로 굴러가다 왼쪽부터 차례로 멈춤
        const chars = Array.from(tok.text);
        const digits = chars.filter((c) => /\d/.test(c)).length;
        let px = cx;
        let di = 0;
        chars.forEach((ch) => {
          const cw = ctx.measureText(ch).width;
          if (!/\d/.test(ch)) {
            ctx.fillStyle = HL;
            ctx.fillText(ch, px, y);
            px += cw;
            return;
          }
          const stopAt = 0.35 + 0.55 * (di / Math.max(1, digits - 1));
          const lp = clamp01(p / stopAt);
          const target = Number(ch);
          const spins = 2 + di;
          const pos = (spins * 10 + target) * easeOutCubic(lp); // 지금까지 넘어간 칸 수
          const lineH = fs * 1.05;
          ctx.save();
          ctx.beginPath();
          ctx.rect(px - 2, top - fs * 0.1, cw + 4, bottom - top + fs * 0.2);
          ctx.clip();
          ctx.fillStyle = HL;
          const base = Math.floor(pos);
          const frac = pos - base;
          for (const k of [0, 1]) {
            const v = (base + k) % 10;
            ctx.fillText(String(v), px, y + (k - frac) * lineH); // 위로 굴러감
          }
          ctx.restore();
          px += cw;
          di += 1;
        });
        break;
      }

      case 'count': {
        // 카운트업: 숫자가 0 에서 목표값까지 (쉼표·단위 유지)
        const digits = tok.text.replace(/[^\d]/g, '');
        const target = Number(digits || '0');
        const k = easeOutExpo(p);
        const now = String(Math.round(target * k)).padStart(k >= 1 ? digits.length : 1, '0');
        let di = now.length - 1;
        const shown = Array.from(tok.text)
          .reverse()
          .map((ch) => (/\d/.test(ch) ? (di >= 0 ? now[di--] : '') : ch))
          .reverse()
          .join('');
        // 폭이 변해도 뒤 글자와 간격이 그대로이게 오른쪽 끝에 맞춤
        ctx.save();
        ctx.fillStyle = HL;
        ctx.textAlign = 'right';
        ctx.fillText(p <= 0 ? tok.text.replace(/\d/g, '0') : shown, cx + tw, y);
        ctx.restore();
        break;
      }

      case 'spark': {
        // 반짝: 글자가 강조색으로 바뀌며 빛살 + 작은 별
        plainText(p > 0.2 ? HL : T);
        if (p > 0 && p < 1) {
          ctx.save();
          ctx.shadowBlur = 0;
          const ox = cx + tw / 2;
          const oy = midY;
          const r0 = Math.max(tw * 0.5, fs * 0.55) + fs * 0.12;
          const burst = easeOutCubic(p);
          ctx.globalAlpha = baseA * Math.sin(p * Math.PI);
          for (let k = 0; k < 8; k++) {
            const a = (Math.PI * 2 * k) / 8 + 0.3;
            const sx = Math.cos(a);
            const sy = Math.sin(a) * 0.7;
            const a0 = r0 + burst * fs * 0.25;
            const a1 = a0 + fs * (0.18 + burst * 0.3);
            penStroke(ctx, [[ox + sx * a0, oy + sy * a0], [ox + sx * (a0 + a1) / 2, oy + sy * (a0 + a1) / 2], [ox + sx * a1, oy + sy * a1]], fs * 0.11, 1, HL, {head: 0.3, tail: 0.6});
          }
          // 작은 별 두 개
          for (const [dx, dy, sz] of [[-0.6, -0.9, 0.22], [0.65, 0.75, 0.16]] as const) {
            const sx = ox + dx * (tw / 2 + fs * 0.4);
            const sy = oy + dy * fs * 0.6;
            const s = fs * sz * Math.sin(p * Math.PI);
            ctx.fillStyle = HL;
            ctx.beginPath();
            for (let k = 0; k < 8; k++) {
              const r = k % 2 ? s * 0.28 : s;
              const a = (Math.PI * k) / 4;
              ctx.lineTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r);
            }
            ctx.closePath();
            ctx.fill();
          }
          ctx.restore();
        }
        break;
      }

      case 'shine': {
        // 금빛 스윕: 밝은 빛이 지나가고 지나간 자리는 금색
        const edge = cx - tw * 0.2 + tw * 1.4 * p;
        const g = ctx.createLinearGradient(cx, 0, cx + tw, 0);
        const at = (px: number) => clamp01((px - cx) / Math.max(1, tw));
        g.addColorStop(0, p > 0 ? HL : T);
        g.addColorStop(at(edge - tw * 0.12), HL);
        g.addColorStop(at(edge), '#FFFFFF');
        g.addColorStop(at(edge + tw * 0.08), '#FFFFFF');
        g.addColorStop(1, p >= 1 ? HL : T);
        ctx.save();
        ctx.fillStyle = g;
        if (p > 0 && p < 1) {
          ctx.shadowColor = HL;
          ctx.shadowBlur = fs * 0.22;
        }
        ctx.fillText(tok.text, cx, y);
        ctx.restore();
        break;
      }

      case 'pop': {
        // 팝: 크게 튀었다가 제자리 크기로, 강조색으로 정착
        const s = p <= 0 ? 1 : p < 0.4 ? 1 + 0.3 * easeOutCubic(p / 0.4) : 1.3 - 0.3 * easeOutBack((p - 0.4) / 0.6);
        // 왼쪽 아래를 기준으로 커져서 앞 글자를 덮지 않음
        ctx.save();
        ctx.translate(cx, y);
        ctx.scale(s, s);
        ctx.fillStyle = p > 0.2 ? A : T;
        ctx.fillText(tok.text, 0, 0);
        ctx.restore();
        break;
      }

      case 'scribble': {
        // 펜으로 빙글빙글 감아 그린 고리 밑줄
        plainText();
        ctx.save();
        ctx.shadowBlur = 0;
        const loops = Math.max(3, Math.round(tw / (fs * 0.42)));
        const r = fs * 0.11;
        const pts = sample(loops * 18, (u) => {
          const th = u * Math.PI * 2 * loops;
          const jitter = (hash01(seed + Math.floor(u * loops)) - 0.5) * fs * 0.03;
          return [cx - fs * 0.04 + (tw + fs * 0.08) * u - Math.sin(th) * r * 1.3, y + fs * 0.22 - Math.cos(th) * r + jitter];
        });
        penStroke(ctx, pts, fs * 0.085, e, A, {head: 0.04, tail: 0.1, min: 0.5});
        ctx.restore();
        break;
      }

      case 'arrow': {
        // 손그림 화살표가 오른쪽 위에서 휘어 들어와 단어를 가리킴
        plainText();
        ctx.save();
        ctx.shadowBlur = 0;
        const tipX = cx + tw * 0.62;
        const tipY = top - fs * 0.08;
        const sx0 = tipX + fs * 1.5;
        const sy0 = tipY - fs * 1.25;
        const pts = sample(30, (u) => {
          const bx = lerp(sx0, tipX, u);
          const by = lerp(sy0, tipY, u);
          return [bx + Math.sin(u * Math.PI) * fs * 0.35, by - Math.sin(u * Math.PI) * fs * 0.15];
        });
        const k = easeOutCubic(clamp01(p / 0.75));
        penStroke(ctx, pts, fs * 0.13, k, A, {head: 0.1, tail: 0.05, min: 0.5});
        if (p > 0.7) {
          const h = fs * 0.42 * easeOutBack((p - 0.7) / 0.3);
          const dir = Math.atan2(pts[30][1] - pts[27][1], pts[30][0] - pts[27][0]);
          for (const side of [-1, 1]) {
            const a = dir + Math.PI + side * 0.55;
            penStroke(ctx, [[tipX, tipY], [tipX + Math.cos(a) * h * 0.5, tipY + Math.sin(a) * h * 0.5], [tipX + Math.cos(a) * h, tipY + Math.sin(a) * h]], fs * 0.12, 1, A, {head: 0.4, tail: 0.4, min: 0.55});
          }
        }
        ctx.restore();
        break;
      }

      default:
        plainText();
    }
    ctx.globalAlpha = baseA;
    ctx.shadowBlur = shadow;
    cx += tw;
  });
}

/* ---------------- 사진/영상 효과 ---------------- */

type PhotoState = {
  scale: number;
  ox: number;
  oy: number;
  alpha: number;
  blur: number;
  rot: number;
  gray: number;
  vignette: number;
  leak: number; // <0 이면 없음, 0~1 빛 위치
  bright: number; // 1 = 그대로
};

export function photoState(effect: PhotoEffect | undefined, anim: number): PhotoState {
  const t = clamp01(anim);
  const sec = t * SLIDE_SEC;
  const base: PhotoState = {scale: 1.05, ox: 0, oy: 0, alpha: 1, blur: 0, rot: 0, gray: 0, vignette: 0, leak: -1, bright: 1};
  switch (effect || 'none') {
    case 'none':
      return base;
    case 'ken-out':
      return {...base, scale: 1.22 - t * 0.17};
    case 'pan-left':
      return {...base, scale: 1.18, ox: (0.5 - t) * 130};
    case 'pan-right':
      return {...base, scale: 1.18, ox: (t - 0.5) * 130};
    case 'zoom-pulse':
      return {...base, scale: 1.08 + Math.sin(t * Math.PI * 4) * 0.04};
    case 'fade-rise':
      return {...base, scale: 1.08, oy: (1 - easeOutCubic(sec / 0.8)) * 60, alpha: Math.min(1, sec / 0.5)};
    case 'blur-sharp':
      return {...base, scale: 1.1, blur: 14 * (1 - easeOutCubic(sec / 0.9))};
    case 'drift-up':
      return {...base, scale: 1.14, oy: (0.5 - t) * 110};
    case 'soft-zoom':
      return {...base, scale: 1.04 + t * 0.12};
    case 'ken-in':
      return {...base, scale: 1.05 + t * 0.16};
    case 'rotate-drift':
      return {...base, scale: 1.14 + t * 0.04, rot: (t - 0.5) * 0.05};
    case 'tilt-pan':
      return {...base, scale: 1.2, ox: (t - 0.5) * 90, oy: (0.5 - t) * 120};
    case 'punch-in': {
      const k = easeOutCubic(sec / 0.7);
      return {...base, scale: 1.3 - 0.24 * k + 0.03 * t};
    }
    case 'handheld':
      return {
        ...base,
        scale: 1.1,
        ox: Math.sin(sec * 2.1) * 7 + Math.sin(sec * 5.3) * 3,
        oy: Math.cos(sec * 1.7) * 6 + Math.sin(sec * 4.1) * 2,
        rot: Math.sin(sec * 1.3) * 0.005,
      };
    case 'color-pop':
      return {...base, scale: 1.06 + t * 0.04, gray: 1 - easeInOutCubic((sec - 0.3) / 1.2)};
    case 'vignette-pull':
      return {...base, scale: 1.05 + t * 0.1, vignette: 0.25 + 0.55 * t};
    case 'whip-in': {
      const k = easeOutCubic(sec / 0.6);
      return {...base, scale: 1.1, ox: (1 - k) * -W * 0.55, blur: (1 - k) * 14};
    }
    case 'light-leak':
      return {...base, scale: 1.06 + t * 0.06, leak: t};
    case 'rack-focus': {
      // 초점이 흐렸다가 맞음 → 살짝 다시 흔들림
      const b = keyframes(sec, [[0, 16], [0.7, 0], [3.5, 0], [3.9, 4], [4.4, 0]], easeInOutCubic);
      return {...base, scale: 1.08 + t * 0.04, blur: b};
    }
    case 'float':
      return {...base, scale: 1.12, ox: noise1(sec * 0.6) * 22, oy: noise1(sec * 0.45 + 9) * 26, rot: noise1(sec * 0.3 + 3) * 0.01};
    case 'film-flicker':
      return {...base, scale: 1.06 + t * 0.03, vignette: 0.45, bright: 0.92 + hash01(Math.floor(sec * 12)) * 0.16};
    case 'dolly-out': {
      const k = easeOutExpo(sec / 1.2);
      return {...base, scale: 1.45 - 0.35 * k - 0.03 * t};
    }
    case 'flash-in':
      return {...base, scale: 1.08 + t * 0.05, bright: 1 + 1.2 * (1 - easeOutCubic(sec / 0.6))};
    case 'spin-settle': {
      const k = spring(sec, 120, 11);
      return {...base, scale: 1.35 - 0.25 * k, rot: (1 - k) * 0.12};
    }
    default:
      return base;
  }
}

function drawPhoto(
  ctx: CanvasRenderingContext2D,
  media: NonNullable<FrameMedia>,
  pe: PhotoState,
  extraBlur = 0,
) {
  ctx.save();
  ctx.globalAlpha *= pe.alpha;
  const blur = pe.blur + extraBlur;
  const filters: string[] = [];
  if (blur > 0.5) filters.push(`blur(${blur.toFixed(1)}px)`);
  if (pe.gray > 0.01) filters.push(`grayscale(${pe.gray.toFixed(2)})`);
  if (Math.abs(pe.bright - 1) > 0.01) filters.push(`brightness(${pe.bright.toFixed(2)})`);
  if (filters.length) ctx.filter = filters.join(' ');
  ctx.translate(W / 2 + pe.ox, H / 2 + pe.oy);
  if (pe.rot) ctx.rotate(pe.rot);
  ctx.translate(-W / 2, -H / 2);
  drawCover(ctx, media, pe.scale);
  ctx.restore();

  if (pe.vignette > 0) {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.22, W / 2, H / 2, H * 0.62);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${pe.vignette.toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  if (pe.leak >= 0) {
    const lx = -W * 0.3 + pe.leak * W * 1.6;
    const ly = H * 0.15 + pe.leak * H * 0.4;
    const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, W * 0.9);
    g.addColorStop(0, 'rgba(255,170,80,0.55)');
    g.addColorStop(0.45, 'rgba(255,90,60,0.22)');
    g.addColorStop(1, 'rgba(255,90,60,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

/* ---------------- 제목·부제 블록 ---------------- */

type UnitAnim = (u: number, i: number) => {alpha: number; dx: number; dy: number; scale: number; blur?: number; char?: string};

/** 순수 텍스트 한 줄을 글자/단어 단위로 나눠 각자 애니메이션 */
function drawUnits(
  ctx: CanvasRenderingContext2D,
  plain: string,
  x: number,
  y: number,
  align: CanvasTextAlign,
  fontSize: number,
  family: string,
  units: string[],
  progressOf: (i: number) => number,
  anim: UnitAnim,
  color: string,
) {
  ctx.font = `800 ${fontSize}px ${family}`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const total = ctx.measureText(plain).width;
  const startX = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;
  let prefix = '';
  units.forEach((unit, i) => {
    const ux = startX + ctx.measureText(prefix).width;
    prefix += unit;
    if (!unit.trim()) return;
    const uw = ctx.measureText(unit).width;
    const a = anim(progressOf(i), i);
    if (a.alpha <= 0.001) return;
    ctx.save();
    ctx.globalAlpha *= clamp01(a.alpha);
    if (a.blur && a.blur > 0.3) ctx.filter = `blur(${a.blur.toFixed(1)}px)`;
    ctx.translate(ux + uw / 2 + a.dx, y - fontSize * 0.35 + a.dy);
    ctx.scale(a.scale, a.scale);
    ctx.fillStyle = color;
    ctx.fillText(a.char ?? unit, -uw / 2, fontSize * 0.35);
    ctx.restore();
  });
}

export type TextLayout = {
  lines: string[];
  align: CanvasTextAlign;
  /** 정렬 기준 x (왼쪽 정렬이면 왼쪽 끝, 오른쪽 정렬이면 오른쪽 끝) */
  x: number;
  maxTextW: number;
  fontSize: number;
  blockTop: number;
  blockH: number;
  /** 칩 줄 높이 (칩이 없으면 0) */
  headerH: number;
  /** 부제 글자 크기 */
  subSize: number;
  /** 줄 간격 */
  gap: number;
  /** 잡기 쉬운 영역 (드래그 판정용, 여유 포함) */
  box: {x: number; y: number; w: number; h: number};
  /** 글자가 실제로 차지하는 영역 (정렬선 기준) */
  content: {x: number; y: number; w: number; h: number};
};

/** 제목 묶음 배치 계산 — 그리기와 드래그 판정이 같은 값을 쓴다 */
export function textLayout(ctx: CanvasRenderingContext2D, slide: Slide, family: string): TextLayout {
  const lines = (slide.title || ' ').split('\n').filter(Boolean).slice(0, 3);
  const pos: Pos = slide.pos ?? 'bl';
  const right = pos === 'br' || pos === 'tr';
  const top = pos === 'tl' || pos === 'tr';
  const align: CanvasTextAlign = right ? 'right' : 'left';
  const pad = 72;
  const maxTextW = W - pad * 2;
  const k = Math.max(0.3, Math.min(3, slide.textScale ?? 1));
  // 키운 만큼은 화면 폭을 넘어가도 되게 (배율이 1보다 크면 최대 폭도 같이 늘림)
  const fitW = maxTextW * Math.max(1, k);
  const fontSize = Math.min(...lines.map((l) => fitFontSize(ctx, l, 64 * k, fitW, 800, family)), 64 * k);
  const subSize = 34 * k;
  const headerH = slide.showChip ? 70 : 0;
  const blockH = headerH + lines.length * (fontSize + 16 * k) + (slide.text ? 56 * k : 0);
  const off = slide.textOffset ?? {x: 0, y: 0};
  const x = (right ? W - pad : pad) + off.x;
  const blockTop = (top ? 200 : H - 150 - blockH) + off.y;
  ctx.save();
  ctx.font = `800 ${fontSize}px ${family}`;
  let w = Math.max(...lines.map((l) => ctx.measureText(stripMarkers(l)).width), 1);
  ctx.font = `500 ${subSize}px ${family}`;
  if (slide.text) w = Math.max(w, ctx.measureText(slide.text).width);
  if (slide.showChip) w = Math.max(w, maxTextW);
  ctx.restore();
  const bx = right ? x - w : x;
  // 마지막 줄 아래 여백(56/16)은 빼고 실제 글자 높이만
  const contentH = headerH + lines.length * (fontSize + 16 * k) - 16 * k + (slide.text ? 52 * k : 0);
  return {
    lines,
    align,
    x,
    maxTextW,
    fontSize,
    blockTop,
    blockH,
    headerH,
    subSize,
    gap: 16 * k,
    box: {x: bx - 16, y: blockTop - 16, w: w + 32, h: blockH + 24},
    content: {x: bx, y: blockTop, w, h: contentH},
  };
}

function hexToRgba(hex: string, a: number): string {
  const m = hex.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return hex;
  let h = m[1];
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
}

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * 제목 뒤 배경 (가로선 / 상자 / 아래 띠 / 흐린 유리). 글자보다 먼저 그린다.
 * appear 0~1 은 나타나는 정도 (글자 등장과 함께).
 */
function drawBackdrop(ctx: CanvasRenderingContext2D, slide: Slide, L: TextLayout, pal: Palette, appear: number) {
  const kind = slide.backdrop ?? 'none';
  if (kind === 'none' || appear <= 0) return;
  const c = L.content;
  const frost = kind === 'frost' || kind === 'frost-box';
  const color = slide.backdropColor || (frost ? '#ffffff' : '#000000');
  const opacity = slide.backdropOpacity ?? (frost ? 0.35 : kind === 'line' ? 0.6 : 0.62);
  const k = slide.textScale ?? 1;
  const pad = 36 * Math.max(0.6, k);
  const atBottom = c.y + c.h / 2 > H / 2;

  ctx.save();
  if (kind === 'line') {
    // 제목 위 가로선 — 정렬된 쪽에서부터 그어짐
    if (slide.showChip) {
      ctx.restore();
      return; // 칩을 켜면 칩 옆 선이 이미 있음
    }
    const y = c.y - 26 * Math.max(0.6, k);
    const len = L.maxTextW * easeOutCubic(appear);
    ctx.strokeStyle = hexToRgba(slide.backdropColor || pal.text, opacity);
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (L.align === 'right') {
      ctx.moveTo(L.x, y);
      ctx.lineTo(L.x - len, y);
    } else {
      ctx.moveTo(L.x, y);
      ctx.lineTo(L.x + len, y);
    }
    ctx.stroke();
    ctx.restore();
    return;
  }

  // 그릴 영역
  let rx: number;
  let ry: number;
  let rw: number;
  let rh: number;
  let radius: number;
  if (kind === 'box' || kind === 'frost-box') {
    rx = c.x - pad;
    ry = c.y - pad * 0.8;
    rw = c.w + pad * 2;
    rh = c.h + pad * 1.6;
    radius = 22 * Math.max(0.6, k);
  } else {
    // 띠: 글자 위아래 여유를 두고 화면 끝까지
    rx = 0;
    rw = W;
    radius = 0;
    if (atBottom) {
      ry = c.y - pad * 1.6;
      rh = H - ry;
    } else {
      ry = 0;
      rh = c.y + c.h + pad * 1.6;
    }
  }

  ctx.globalAlpha *= clamp01(appear);
  rrect(ctx, rx, ry, rw, rh, radius);
  if (frost) {
    // 지금까지 그린 화면을 흐리게 복사해 영역 안에만
    ctx.save();
    ctx.clip();
    const m = ctx.getTransform();
    const s = m.a || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = `blur(${Math.round(28 * s)}px)`;
    ctx.drawImage(ctx.canvas as unknown as CanvasImageSource, 0, 0);
    ctx.filter = 'none';
    ctx.restore();
    rrect(ctx, rx, ry, rw, rh, radius);
    ctx.fillStyle = hexToRgba(color, opacity);
    ctx.fill();
    // 위쪽 경계에 얇은 하이라이트
    if (kind === 'frost-box' || atBottom) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      if (kind === 'frost-box') ctx.stroke();
      else {
        ctx.beginPath();
        ctx.moveTo(0, ry);
        ctx.lineTo(W, ry);
        ctx.stroke();
      }
    }
  } else if (kind === 'band') {
    // 띠는 글자 쪽이 진하고 바깥으로 갈수록 살짝 옅게
    const g = ctx.createLinearGradient(0, atBottom ? ry : ry + rh, 0, atBottom ? ry + rh : ry);
    g.addColorStop(0, hexToRgba(color, opacity * 0.85));
    g.addColorStop(0.25, hexToRgba(color, opacity));
    g.addColorStop(1, hexToRgba(color, Math.min(1, opacity * 1.15)));
    ctx.fillStyle = g;
    ctx.fill();
  } else {
    ctx.fillStyle = hexToRgba(color, opacity);
    ctx.fill();
  }
  ctx.restore();
}

function drawTextBlock(
  ctx: CanvasRenderingContext2D,
  slide: Slide,
  chipLabel: string,
  family: string,
  anim: number,
  pal: Palette,
) {
  const text = slide.text;
  const textEnter = slide.textEnter || 'fade-up';
  const accent = pal.accent;
  const L = textLayout(ctx, slide, family);
  const {lines, align, x, maxTextW, fontSize, blockTop, blockH, headerH, subSize, gap} = L;
  const right = align === 'right';
  const pad = 72;
  const blockMidY = blockTop + blockH / 2;
  const textTop = blockTop + headerH;

  const tSec = animToSec(anim);
  const te = textEnter || 'fade-up';
  const enterDur = textEnterSec(te);
  const ep = te === 'none' ? 1 : clamp01(tSec / enterDur);
  const emphasisStart = enterDur + TEXT_EMPHASIS_GAP_SEC;
  const markBase = clamp01((tSec - emphasisStart) / TEXT_EMPHASIS_SEC);
  const unitMode = te === 'pop-chars' || te === 'drop-chars' || te === 'word-up' || te === 'blur-chars' || te === 'scramble';

  // 글자 뒤 배경은 블록 등장 변형과 별개로, 등장과 함께 서서히
  drawBackdrop(ctx, slide, L, pal, te === 'none' ? 1 : clamp01(tSec / Math.max(0.25, enterDur * 0.7)));

  ctx.save();
  // 블록 통째 등장
  if (te === 'fade-up') {
    ctx.globalAlpha *= ep;
    ctx.translate(0, (1 - ep) * 28);
  } else if (te === 'mask-up') {
    ctx.globalAlpha *= ep;
    ctx.translate(0, (1 - ep) * 48);
  } else if (te === 'scale-in') {
    const s = 0.86 + ep * 0.14;
    ctx.translate(W / 2, 0);
    ctx.scale(s, s);
    ctx.translate(-W / 2, 0);
    ctx.globalAlpha *= ep;
  } else if (te === 'blur-in') {
    ctx.globalAlpha *= ep;
    if (ep < 1) ctx.filter = `blur(${(1 - ep) * 8}px)`;
  } else if (te === 'slide-left') {
    ctx.globalAlpha *= ep;
    ctx.translate((1 - ep) * -80, 0);
  } else if (te === 'bounce-in') {
    const s = ep < 1 ? 0.7 + Math.sin(ep * Math.PI) * 0.4 : 1;
    ctx.translate(W / 2, 0);
    ctx.scale(s, s);
    ctx.translate(-W / 2, 0);
  } else if (te === 'flip-in') {
    const k = easeOutBack(ep);
    ctx.translate(0, blockMidY);
    ctx.scale(1, Math.max(0.001, k));
    ctx.translate(0, -blockMidY);
    ctx.globalAlpha *= Math.min(1, ep * 2);
  } else if (te === 'zoom-down') {
    const s = 1.6 - 0.6 * easeOutCubic(ep);
    ctx.translate(x, blockMidY);
    ctx.scale(s, s);
    ctx.translate(-x, -blockMidY);
    ctx.globalAlpha *= Math.min(1, ep * 1.6);
  } else if (te === 'spring-up') {
    const k = spring(tSec, 220, 16);
    ctx.translate(0, (1 - k) * 90);
    ctx.globalAlpha *= Math.min(1, tSec / 0.2);
  } else if (te === 'skew-in') {
    const k = easeOutQuint(ep);
    ctx.translate((1 - k) * -160, 0);
    ctx.transform(1, 0, -(1 - k) * 0.45, 1, (1 - k) * 0.45 * blockMidY, 0);
    ctx.globalAlpha *= Math.min(1, ep * 2.5);
  } else if (te === 'stamp-in') {
    const k = spring(tSec, 380, 20);
    const s = 2.2 - 1.2 * k;
    const shake = tSec > 0.18 && tSec < 0.45 ? Math.sin(tSec * 120) * 5 * (0.45 - tSec) * 4 : 0;
    ctx.translate(x + shake, blockMidY);
    ctx.scale(s, s);
    ctx.rotate((1 - k) * -0.08);
    ctx.translate(-x, -blockMidY);
    ctx.globalAlpha *= Math.min(1, tSec / 0.12);
  } else if (te === 'glitch-in' && ep < 1) {
    const jitter = (1 - ep) * 18;
    ctx.translate(Math.sin(tSec * 97) * jitter, Math.cos(tSec * 71) * jitter * 0.3);
    ctx.globalAlpha *= 0.4 + 0.6 * ep;
  }

  // 클립형 등장
  if (te === 'wipe-right' && ep < 1) {
    ctx.beginPath();
    ctx.rect(pad - 20, blockTop - 10, (W - pad * 2 + 40) * ep, blockH + 40);
    ctx.clip();
  } else if (te === 'split-center' && ep < 1) {
    const k = easeOutCubic(ep);
    const cxm = W / 2;
    const half = (W / 2) * k;
    ctx.beginPath();
    ctx.rect(cxm - half, blockTop - 20, half * 2, blockH + 60);
    ctx.clip();
  }

  // 번호 칩 (선택) + 옆 선
  const chipY = blockTop;
  if (slide.showChip) {
    ctx.font = `700 28px ${family}`;
    ctx.textAlign = 'left';
    const chipW = ctx.measureText(chipLabel).width + 30;
    const chipX = right ? x - chipW : x;
    ctx.save();
    if (unitMode) {
      const cp = easeOutBack(clamp01(tSec / 0.35));
      ctx.translate(chipX + chipW / 2, chipY + 21);
      ctx.scale(cp, cp);
      ctx.translate(-(chipX + chipW / 2), -(chipY + 21));
    }
    ctx.fillStyle = pal.chip;
    ctx.fillRect(chipX, chipY, chipW, 42);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(chipLabel, chipX + 14, chipY + 22);
    ctx.restore();

    const lineP = te === 'line-draw' ? ep : unitMode ? easeOutCubic(tSec / enterDur) : 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (right) {
      const x0 = chipX - 12;
      const x1 = x - maxTextW;
      ctx.moveTo(x0, chipY + 21);
      ctx.lineTo(x0 + (x1 - x0) * lineP, chipY + 21);
    } else {
      const x0 = chipX + chipW + 12;
      const x1 = x + maxTextW;
      ctx.moveTo(x0, chipY + 21);
      ctx.lineTo(x0 + (x1 - x0) * lineP, chipY + 21);
    }
    ctx.stroke();
  }

  if (te === 'line-draw') {
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 5;
    ctx.globalAlpha *= 0.85 * Math.min(1, ep + 0.15);
    ctx.beginPath();
    const guideY = textTop + fontSize + 10;
    ctx.moveTo(x, guideY);
    ctx.lineTo(right ? x - maxTextW * ep : x + maxTextW * ep, guideY);
    ctx.stroke();
    ctx.restore();
  }

  // 글자/단어 단위 진행률 (모든 줄을 이어서 한 줄처럼 스태거)
  const lineUnits = lines.map((l) => {
    const plain = stripMarkers(l);
    return te === 'word-up' ? plain.split(/(\s+)/).filter((s) => s.length) : Array.from(plain);
  });
  const totalUnits = Math.max(1, lineUnits.reduce((s, u) => s + u.length, 0));
  const unitDur = te === 'word-up' ? 0.4 : te === 'scramble' ? 0.5 : 0.3;
  const stagger = Math.max(0, (enterDur - unitDur) / Math.max(1, totalUnits - 1));

  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 14;
  let unitOffset = 0;
  lines.forEach((line, i) => {
    const y = textTop + fontSize + i * (fontSize + gap);
    const markP = clamp01(markBase - i * 0.06);
    const units = lineUnits[i];
    const myOffset = unitOffset;
    unitOffset += units.length;

    if (te === 'rise-stagger') {
      const sp = clamp01((tSec - i * 0.1) / Math.max(0.2, enterDur - i * 0.1));
      ctx.save();
      ctx.globalAlpha *= sp;
      ctx.translate(0, (1 - sp) * 24);
      drawMarkedLine(ctx, line, x, y, align, fontSize, family, markP, pal);
      ctx.restore();
      return;
    }

    if (unitMode && ep < 1) {
      const plain = stripMarkers(line);
      const progressOf = (k: number) => clamp01((tSec - (myOffset + k) * stagger) / unitDur);
      const GLYPHS = '#%&@*+=?!ABCDEFGHJKLMNPRSTUVXYZ0123456789';
      const animFn: UnitAnim =
        te === 'pop-chars'
          ? (u) => ({alpha: u * 3, dx: 0, dy: 0, scale: Math.max(0.001, easeOutBack(u))})
          : te === 'drop-chars'
            ? (u) => ({alpha: u * 4, dx: 0, dy: -(1 - easeOutBounce(u)) * fontSize * 1.3, scale: 1})
            : te === 'blur-chars'
              ? (u) => ({alpha: u * 1.4, dx: 0, dy: 0, scale: 1 + (1 - easeOutCubic(u)) * 0.25, blur: (1 - easeOutCubic(u)) * 14})
              : te === 'scramble'
                ? (u, k) => ({
                    alpha: Math.min(1, u * 4),
                    dx: 0,
                    dy: 0,
                    scale: 1,
                    char: u >= 0.75 ? undefined : GLYPHS[Math.floor(hash01(k * 31 + Math.floor(tSec * 24)) * GLYPHS.length)],
                  })
                : (u) => ({alpha: u * 1.5, dx: 0, dy: (1 - easeOutCubic(u)) * fontSize * 0.9, scale: 1});
      drawUnits(ctx, plain, x, y, align, fontSize, family, units, progressOf, (u, k) => animFn(u, myOffset + k), pal.text);
      return;
    }

    if (te === 'mask-lines') {
      // 줄마다 보이지 않는 선 아래에서 밀려 올라옴
      const lp = easeOutQuint(clamp01((tSec - i * 0.08) / Math.max(0.2, enterDur - 0.08)));
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, y - fontSize * 1.05, W, fontSize * 1.35);
      ctx.clip();
      ctx.translate(0, (1 - lp) * fontSize * 1.3);
      drawMarkedLine(ctx, line, x, y, align, fontSize, family, markP, pal);
      ctx.restore();
      return;
    }

    if (te === 'type-block' && ep < 1) {
      const chars = Array.from(stripMarkers(line));
      ctx.font = `800 ${fontSize}px ${family}`;
      ctx.fillStyle = pal.text;
      ctx.textAlign = align;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(chars.slice(0, Math.floor(chars.length * ep)).join(''), x, y);
      return;
    }

    if (te === 'bar-reveal' && ep < 1) {
      // 1) 강조색 막대가 줄 길이만큼 자람 2) 막대가 오른쪽으로 빠지며 글자 공개
      const lp = clamp01(ep * 1.15 - i * 0.08);
      ctx.font = `800 ${fontSize}px ${family}`;
      const lw = ctx.measureText(stripMarkers(line)).width;
      const left = align === 'right' ? x - lw : x;
      const grow = easeInOutCubic(lp / 0.5);
      const reveal = easeInOutCubic((lp - 0.5) / 0.5);
      const barTop = y - fontSize * 0.85;
      const barH = fontSize * 1.05;
      ctx.save();
      ctx.beginPath();
      ctx.rect(left - 8, barTop - 4, (lw + 16) * reveal, barH + 12);
      ctx.clip();
      drawMarkedLine(ctx, line, x, y, align, fontSize, family, 0, pal);
      ctx.restore();
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.fillStyle = accent;
      const bx0 = left - 8 + (lw + 16) * reveal;
      const bx1 = left - 8 + (lw + 16) * grow;
      if (bx1 > bx0) ctx.fillRect(bx0, barTop, bx1 - bx0, barH);
      ctx.restore();
      return;
    }

    if (te === 'glitch-in' && ep < 1) {
      // RGB 어긋난 잔상
      const off = (1 - ep) * 14;
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.font = `800 ${fontSize}px ${family}`;
      ctx.textAlign = align;
      ctx.textBaseline = 'alphabetic';
      const plain = stripMarkers(line);
      ctx.globalAlpha *= 0.7;
      ctx.fillStyle = '#ff2a55';
      ctx.fillText(plain, x - off, y);
      ctx.fillStyle = '#21e6ff';
      ctx.fillText(plain, x + off, y + off * 0.2);
      ctx.restore();
    }

    drawMarkedLine(ctx, line, x, y, align, fontSize, family, markP, pal);
  });

  // 부제
  if (text) {
    const sy = textTop + lines.length * (fontSize + gap) + subSize * 0.82;
    ctx.shadowBlur = 10;
    ctx.font = `500 ${subSize}px ${family}`;
    ctx.fillStyle = pal.text;
    ctx.textAlign = align;
    ctx.save();
    ctx.globalAlpha *= 0.95;
    if (te === 'type-block') {
      const chars = Array.from(text);
      ctx.fillText(chars.slice(0, Math.floor(chars.length * ep)).join(''), x, sy);
    } else if (te === 'rise-stagger') {
      ctx.globalAlpha *= ep;
      ctx.translate(0, (1 - ep) * 12);
      ctx.fillText(text, x, sy);
    } else if (unitMode || te === 'bar-reveal' || te === 'mask-lines') {
      const sp = easeOutCubic((tSec - enterDur * 0.6) / (enterDur * 0.5));
      ctx.globalAlpha *= sp;
      ctx.translate(0, (1 - sp) * 14);
      ctx.fillText(text, x, sy);
    } else if (te === 'line-draw') {
      ctx.globalAlpha *= Math.min(1, ep + 0.2);
      ctx.fillText(text, x, sy);
    } else {
      ctx.fillText(text, x, sy);
    }
    ctx.restore();
  }
  ctx.restore();
}

/* ---------------- 슬라이드 시작 전환 ---------------- */

function transitionBlur(tr: SlideTransition, tp: number): number {
  return tr === 'zoom-blur' && tp < 1 ? (1 - easeOutCubic(tp)) * 16 : 0;
}

/** 앞 장을 덮었다가 걷어 내는 2단계 전환 (앞 장이 있을 때) */
const TWO_PHASE: SlideTransition[] = ['shutter', 'split-doors', 'color-block', 'flash', 'glitch'];

/** 앞 장이 빠져나가는 움직임 */
function applyExitLayer(ctx: CanvasRenderingContext2D, tr: SlideTransition, tp: number) {
  const e = easeOutCubic(tp);
  if (tr === 'slide-up') ctx.translate(0, -e * H * 0.35);
  else if (tr === 'push-left') ctx.translate(-e * W, 0);
  else if (tr === 'zoom-blur') {
    const s = 1 + 0.18 * e;
    ctx.translate(W / 2, H / 2);
    ctx.scale(s, s);
    ctx.translate(-W / 2, -H / 2);
  } else if (tr === 'spin-in') {
    const s = 1 - 0.08 * e;
    ctx.translate(W / 2, H / 2);
    ctx.scale(s, s);
    ctx.translate(-W / 2, -H / 2);
  }
}

function exitBlur(tr: SlideTransition, tp: number): number {
  return tr === 'zoom-blur' ? easeOutCubic(tp) * 14 : 0;
}

/** 물결 경계선 위의 점들 (wave: 아래서 위로, liquid: 왼쪽에서 오른쪽으로) */
function waveClip(ctx: CanvasRenderingContext2D, tr: 'wave' | 'liquid', tp: number, edgeOnly = false) {
  const k = easeInOutCubic(tp);
  const amp = 70 * Math.sin(Math.PI * Math.min(1, tp * 1.15)) + 6;
  ctx.beginPath();
  if (tr === 'wave') {
    const level = H + amp - (H + amp * 2) * k;
    if (!edgeOnly) ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 20) {
      const y = level + Math.sin((x / W) * Math.PI * 3 + tp * 9) * amp + Math.sin((x / W) * Math.PI * 7 - tp * 5) * amp * 0.25;
      if (edgeOnly && x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    if (edgeOnly) return;
    ctx.lineTo(W, H);
  } else {
    const edge = -amp + (W + amp * 2) * k;
    if (!edgeOnly) ctx.moveTo(0, 0);
    for (let y = 0; y <= H; y += 24) {
      const x = edge + Math.sin((y / H) * Math.PI * 4 + tp * 10) * amp + Math.sin((y / H) * Math.PI * 9 - tp * 6) * amp * 0.25;
      if (edgeOnly && y === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    if (edgeOnly) return;
    ctx.lineTo(0, H);
  }
  ctx.closePath();
}

/** 전환 중 레이어 변형/클립 (슬라이드 내용을 그리기 전에 적용) */
function applyTransitionLayer(ctx: CanvasRenderingContext2D, tr: SlideTransition, tp: number) {
  const e = easeOutCubic(tp);
  if (tr === 'fade') {
    ctx.globalAlpha *= easeInOutCubic(tp);
  } else if (tr === 'zoom-blur') {
    const s = 1.25 - 0.25 * e;
    ctx.translate(W / 2, H / 2);
    ctx.scale(s, s);
    ctx.translate(-W / 2, -H / 2);
    ctx.globalAlpha *= Math.min(1, tp * 2.5);
  } else if (tr === 'slide-up') {
    ctx.translate(0, (1 - e) * H);
  } else if (tr === 'push-left') {
    ctx.translate((1 - e) * W, 0);
  } else if (tr === 'iris') {
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, Math.max(1, e * Math.hypot(W, H) * 0.52), 0, Math.PI * 2);
    ctx.clip();
  } else if (tr === 'wipe-accent') {
    ctx.beginPath();
    ctx.rect(0, 0, W * easeInOutCubic(tp), H);
    ctx.clip();
  } else if (tr === 'blinds') {
    // 세로 블라인드가 차례로 열림
    ctx.beginPath();
    const n = 8;
    const bw = W / n;
    for (let k = 0; k < n; k++) {
      const lp = easeOutCubic(clamp01(tp * 1.6 - k * 0.08));
      ctx.rect(k * bw + (bw * (1 - lp)) / 2, 0, bw * lp, H);
    }
    ctx.clip();
  } else if (tr === 'diagonal-wipe') {
    const k = easeInOutCubic(tp);
    const reach = (W + H) * k;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.min(reach, W), 0);
    if (reach > W) ctx.lineTo(W, reach - W);
    ctx.lineTo(Math.max(0, reach - H), Math.min(reach, H));
    if (reach < H) ctx.lineTo(0, reach);
    else ctx.lineTo(0, H);
    ctx.closePath();
    ctx.clip();
  } else if (tr === 'spin-in') {
    const k = spring(tp * TRANSITION_SEC, 160, 15);
    ctx.translate(W / 2, H / 2);
    ctx.rotate((1 - k) * -0.35);
    ctx.scale(0.4 + 0.6 * k, 0.4 + 0.6 * k);
    ctx.translate(-W / 2, -H / 2);
    ctx.globalAlpha *= Math.min(1, tp * 3);
  } else if (tr === 'wave' || tr === 'liquid') {
    waveClip(ctx, tr, tp);
    ctx.clip();
  }
}

/** 전환 중 위에 덮는 효과 (슬라이드 내용을 그린 뒤). closing=true 면 앞 장을 덮는 단계 */
function drawTransitionOverlay(ctx: CanvasRenderingContext2D, tr: SlideTransition, tp: number, accent: string, closing = false) {
  if (closing) {
    // 2단계 전환의 앞 절반: tp 0→1 동안 앞 장을 덮어 간다
    const k = easeInOutCubic(tp);
    if (tr === 'shutter') {
      const half = (H / 2) * k;
      ctx.fillStyle = '#0b0b0d';
      ctx.fillRect(0, 0, W, half);
      ctx.fillRect(0, H - half, W, half);
      ctx.fillStyle = accent;
      ctx.fillRect(0, half - 6, W, 6);
      ctx.fillRect(0, H - half, W, 6);
    } else if (tr === 'split-doors') {
      const half = (W / 2) * k;
      ctx.fillStyle = accent;
      ctx.fillRect(0, 0, half, H);
      ctx.fillRect(W - half, 0, half, H);
    } else if (tr === 'color-block') {
      ctx.fillStyle = accent;
      ctx.fillRect(0, H - H * k, W, H);
    } else if (tr === 'flash') {
      ctx.fillStyle = `rgba(255,255,255,${(k * k).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    } else if (tr === 'glitch') {
      drawTransitionOverlay(ctx, 'glitch', 1 - tp, accent);
    }
    return;
  }
  if (tr === 'wave' || tr === 'liquid') {
    // 물결 경계를 따라 강조색 띠
    ctx.save();
    waveClip(ctx, tr, tp, true);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 18 * Math.sin(Math.PI * tp);
    ctx.strokeStyle = accent;
    ctx.globalAlpha *= 0.85;
    ctx.stroke();
    ctx.restore();
  } else if (tr === 'wipe-accent') {
    const edge = W * easeInOutCubic(tp);
    ctx.fillStyle = accent;
    ctx.fillRect(edge - 10, 0, 70, H);
  } else if (tr === 'shutter') {
    const k = easeInOutCubic(tp);
    const half = (H / 2) * (1 - k);
    ctx.fillStyle = '#0b0b0d';
    ctx.fillRect(0, 0, W, half);
    ctx.fillRect(0, H - half, W, half);
    ctx.fillStyle = accent;
    if (half > 2) {
      ctx.fillRect(0, half - 6, W, 6);
      ctx.fillRect(0, H - half, W, 6);
    }
  } else if (tr === 'split-doors') {
    const k = easeInOutCubic(tp);
    const half = (W / 2) * (1 - k);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, half, H);
    ctx.fillRect(W - half, 0, half, H);
  } else if (tr === 'color-block') {
    // 강조색 판이 화면을 덮었다가 위로 빠지며 공개
    const k = easeInOutCubic(tp);
    ctx.fillStyle = accent;
    ctx.fillRect(0, -H * k, W, H);
  } else if (tr === 'flash') {
    ctx.fillStyle = `rgba(255,255,255,${Math.pow(1 - tp, 2).toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
  } else if (tr === 'glitch') {
    // 가로 띠를 어긋나게 복사 + 색 번짐 (캔버스 픽셀 기준이라 현재 배율 고려)
    const amt = Math.pow(1 - tp, 1.5);
    if (amt < 0.02) return;
    const m = ctx.getTransform();
    const k = m.a || 1;
    const src = ctx.canvas as unknown as CanvasImageSource;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let b = 0; b < 7; b++) {
      const r = hash01(b + 1 + Math.floor(tp * 12) * 7);
      const by = Math.floor(r * H * k);
      const bh = Math.floor((20 + r * 90) * k);
      const shift = (r - 0.5) * 160 * amt * k;
      ctx.drawImage(src, 0, by, W * k, bh, shift, by, W * k, bh);
    }
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = `rgba(255,40,90,${(0.25 * amt).toFixed(3)})`;
    ctx.fillRect(-8 * amt * k, 0, W * k, H * k);
    ctx.fillStyle = `rgba(30,230,255,${(0.2 * amt).toFixed(3)})`;
    ctx.fillRect(8 * amt * k, 0, W * k, H * k);
    ctx.restore();
  }
}

/* ---------------- 프레임 ---------------- */

/** 로고 배치 (드래그 판정용 상자 포함). 그릴 게 없으면 null */
export function logoLayout(
  ctx: CanvasRenderingContext2D,
  project: Project,
  logo: FrameMedia,
  family: string,
): {
  kind: 'image' | 'text';
  cx: number;
  cy: number;
  w: number;
  h: number;
  box: {x: number; y: number; w: number; h: number};
  content: {x: number; y: number; w: number; h: number};
} | null {
  const off = project.brand.logoOffset ?? {x: 0, y: 0};
  const k = Math.max(0.3, Math.min(4, project.brand.logoScale ?? 1));
  const cx = W / 2 + off.x;
  const cy = 88 + off.y;
  if (logo && logo.width && logo.height) {
    const s = Math.min((72 * k) / logo.height, (420 * k) / logo.width);
    const w = logo.width * s;
    const h = logo.height * s;
    return {kind: 'image', cx, cy, w, h, box: {x: cx - w / 2 - 12, y: cy - h / 2 - 12, w: w + 24, h: h + 24}, content: {x: cx - w / 2, y: cy - h / 2, w, h}};
  }
  const text = project.brand.logoText?.trim();
  if (!text) return null;
  const size = 28 * k;
  ctx.save();
  ctx.font = `600 ${size}px ${family}`;
  const w = ctx.measureText(text).width;
  ctx.restore();
  return {
    kind: 'text',
    cx,
    cy,
    w,
    h: size,
    box: {x: cx - w / 2 - 14, y: cy - size, w: w + 28, h: size * 2},
    content: {x: cx - w / 2, y: cy - size / 2, w, h: size},
  };
}

/** 상단 로고: 이미지가 있으면 이미지, 없으면 글자 */
function drawLogo(ctx: CanvasRenderingContext2D, project: Project, logo: FrameMedia, family: string, color: string) {
  const L = logoLayout(ctx, project, logo, family);
  if (!L) return;
  if (L.kind === 'image' && logo) {
    ctx.drawImage(logo.source, L.cx - L.w / 2, L.cy - L.h / 2, L.w, L.h);
    return;
  }
  ctx.fillStyle = color;
  ctx.font = `600 ${L.h}px ${family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(project.brand.logoText!.trim(), L.cx, L.cy);
}

function drawSlideContent(ctx: CanvasRenderingContext2D, f: FrameInput, family: string, pal: Palette, extraBlur: number) {
  const {project, slide, anim, media} = f;
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, W, H);
  if (media) {
    drawPhoto(ctx, media, photoState(slide?.photoEffect, anim), extraBlur);
  } else {
    const g0 = ctx.createLinearGradient(0, 0, W, H);
    g0.addColorStop(0, '#2b2d33');
    g0.addColorStop(1, '#16171b');
    ctx.fillStyle = g0;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = `600 32px ${family}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('사진이나 영상을 올려 주세요', W / 2, H / 2);
  }

  // 글자가 잘 보이게 위·아래를 어둡게 (shade 0 = 없음, 1 = 기본, 2 = 진하게)
  const sh = Math.max(0, pal.shade);
  if (sh > 0) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, `rgba(0,0,0,${Math.min(0.9, 0.28 * sh).toFixed(3)})`);
    g.addColorStop(0.4, `rgba(0,0,0,${Math.min(0.9, 0.05 * sh).toFixed(3)})`);
    g.addColorStop(1, `rgba(0,0,0,${Math.min(0.95, 0.72 * sh).toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  if (slide) {
    drawTextBlock(ctx, slide, defaultChip(f.slideIndex, f.slideTotal, slide.chipText), family, anim, pal);
  }
  // 로고는 글자 배경(띠·유리)에 가리지 않게 맨 위에
  drawLogo(ctx, project, f.logo ?? null, family, pal.text);
}

export type FrameInput = {
  project: Project;
  slide: Slide | null;
  /** 슬라이드 진행 0~1 (8초 기준) */
  anim: number;
  media: FrameMedia;
  /** 로고 이미지 (없으면 brand.logoText) */
  logo?: FrameMedia;
  /** 1부터 */
  slideIndex: number;
  slideTotal: number;
  /** 앞 장 (전환할 때 겹쳐 그림). 첫 장이면 없음 */
  prev?: {slide: Slide; media: FrameMedia; slideIndex: number} | null;
};

/**
 * 한 프레임을 1080×1920 좌표계로 그린다.
 * 호출하는 쪽이 ctx 변환(미리보기 축소 등)을 정해 두면 그대로 따른다.
 */
export function drawFrame(ctx: CanvasRenderingContext2D, f: FrameInput) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  ctx.shadowBlur = 0;
  const {project, slide, anim} = f;
  const family = fontCss(slide?.fontFamily || project.fontFamily);
  const pal = paletteOf(slide);
  const tr: SlideTransition = slide?.transition || 'cut';
  const tp = tr === 'cut' ? 1 : clamp01(animToSec(anim) / TRANSITION_SEC);
  const prev = tp < 1 && f.prev ? f.prev : null;

  ctx.fillStyle = '#0b0b0d';
  ctx.fillRect(0, 0, W, H);

  if (tp >= 1) {
    drawSlideContent(ctx, f, family, pal, 0);
    ctx.restore();
    return;
  }

  const drawPrev = (extraBlur: number) => {
    if (!prev) return;
    const pf: FrameInput = {...f, slide: prev.slide, media: prev.media, anim: 1, slideIndex: prev.slideIndex};
    drawSlideContent(ctx, pf, fontCss(prev.slide.fontFamily || project.fontFamily), paletteOf(prev.slide), extraBlur);
  };

  if (prev && TWO_PHASE.includes(tr)) {
    // 앞 절반: 앞 장을 덮고, 뒤 절반: 지금 장을 드러냄
    if (tp < 0.5) {
      drawPrev(0);
      drawTransitionOverlay(ctx, tr, tp * 2, pal.accent, true);
    } else {
      drawSlideContent(ctx, f, family, pal, 0);
      drawTransitionOverlay(ctx, tr, (tp - 0.5) * 2, pal.accent);
    }
    ctx.restore();
    return;
  }

  if (prev) {
    ctx.save();
    applyExitLayer(ctx, tr, tp);
    drawPrev(exitBlur(tr, tp));
    ctx.restore();
  }
  ctx.save();
  applyTransitionLayer(ctx, tr, tp);
  drawSlideContent(ctx, f, family, pal, transitionBlur(tr, tp));
  ctx.restore();
  drawTransitionOverlay(ctx, tr, tp, pal.accent);
  ctx.restore();
}
