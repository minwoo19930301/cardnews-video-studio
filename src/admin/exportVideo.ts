import {GIFEncoder, quantize, applyPalette} from 'gifenc';
import {ArrayBufferTarget, Muxer} from 'mp4-muxer';
import {drawMediaCover, loadMedia, type LoadedMedia} from './media';
import {parseFx} from './markers';
import {defaultChip, fontCss, type PhotoEffect, type Pos, type Project, type Slide} from './types';

const W = 1080;
const H = 1920;
const FPS = 30;

/** 파트별 길이 (초) — 인트로/아웃트로는 뉴스와 완전 분리 */
export const INTRO_SEC = 2.5;
export const SLIDE_SEC = 8;
export const OUTRO_SEC = 2.5;

/**
 * 글자 연출 타임라인 (슬라이드 8초 중 앞부분만 사용)
 * 1) 전체 등장(제목+부제) ~0.85초
 * 2) 끝난 뒤 부분 강조 ~0.9초
 * 합쳐 2초 이내 완료, 이후 홀드
 */
export const TEXT_ENTER_SEC = 0.85;
export const TEXT_EMPHASIS_GAP_SEC = 0.05;
export const TEXT_EMPHASIS_SEC = 0.9;

const RED = '#E03A2C';
const YELLOW = '#FFE14D';

/** 슬라이드 진행(0~1) → 실제 초 */
function animToSec(anim: number): number {
  return Math.min(1, Math.max(0, anim)) * SLIDE_SEC;
}

/** 0~1 클램프 */
function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export type ExportFormat = 'mp4' | 'gif' | 'webm';
export type ExportSegment =
  | {kind: 'intro'}
  | {kind: 'outro'}
  | {kind: 'slide'; index: number}
  | {kind: 'full'};

export type ExportProgress = {phase: string; pct: number};

function pickWebmMime(): string {
  for (const m of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
  }
  return 'video/webm';
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
  const plain = text.replace(
    /==|@@|__|\[\[|\]\]|~~|%%|##|\+\+|\*\*|::|<<|>>|!!|\^\^|≈≈|\{\{|}}/g,
    '',
  );
  while (size > 28) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(plain).width <= maxWidth) break;
    size -= 2;
  }
  return size;
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
  accent = RED,
) {
  const toks = parseFx(line);
  ctx.font = `800 ${fontSize}px ${family}`;
  ctx.textBaseline = 'alphabetic';
  const widths = toks.map((t) => ctx.measureText(t.text).width);
  const total = widths.reduce((a, b) => a + b, 0);
  let cx = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;
  const p = Math.min(1, Math.max(0, progress));
  const A = accent || RED;

  toks.forEach((tok, i) => {
    const tw = widths[i];
    const top = y - fontSize * 0.78;
    const h = fontSize * 0.95;

    if (tok.fx === 'hl') {
      ctx.fillStyle = YELLOW;
      ctx.fillRect(cx - 3, y - fontSize * 0.35, Math.max(2, tw * p) + 6, fontSize * 0.5);
    } else if (tok.fx === 'redhl') {
      ctx.fillStyle = A;
      ctx.fillRect(cx - 5, top + fontSize * 0.1, Math.max(2, tw * p) + 10, h * 0.85);
    }

    if (tok.fx === 'type') {
      const n = Math.max(0, Math.floor(tok.text.length * p));
      const shown = tok.text.slice(0, n);
      ctx.fillStyle = '#fff';
      ctx.fillText(shown, cx, y);
      if (p < 1) {
        ctx.fillStyle = YELLOW;
        ctx.fillText('|', cx + ctx.measureText(shown).width, y);
      }
    } else if (tok.fx === 'slot') {
      const locked = p > 0.7;
      const chars = [...tok.text].map((ch, ci) => {
        if (!/\d/.test(ch) || locked) return ch;
        return String((ci * 3 + Math.floor(p * 14)) % 10);
      });
      ctx.fillStyle = YELLOW;
      ctx.fillText(chars.join(''), cx, y);
    } else if (
      tok.fx === 'glow' ||
      tok.fx === 'outline' ||
      tok.fx === 'stamp' ||
      tok.fx === 'shake' ||
      tok.fx === 'bounce' ||
      tok.fx === 'wave' ||
      tok.fx === 'fill'
    ) {
      // 아래에서 전용 렌더
    } else {
      ctx.fillStyle = '#fff';
      ctx.fillText(tok.text, cx, y);
    }

    if (tok.fx === 'under') {
      ctx.strokeStyle = A;
      ctx.lineWidth = Math.max(4, fontSize * 0.08);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, y + 6);
      ctx.lineTo(cx + tw * p, y + 4);
      ctx.stroke();
    } else if (tok.fx === 'strike') {
      ctx.strokeStyle = A;
      ctx.lineWidth = Math.max(4, fontSize * 0.08);
      ctx.beginPath();
      ctx.moveTo(cx, y - fontSize * 0.28);
      ctx.lineTo(cx + tw * p, y - fontSize * 0.32);
      ctx.stroke();
    } else if (tok.fx === 'box') {
      ctx.strokeStyle = YELLOW;
      ctx.lineWidth = 4;
      ctx.strokeRect(cx - 6, top, (tw + 12) * Math.max(p, 0.08), h);
    } else if (tok.fx === 'circle') {
      // 손그림 색연필 원 — 불규칙 타원 + 겹선 + 끝 오버랩
      const cx0 = cx + tw / 2;
      const cy0 = y - fontSize * 0.28;
      const rx = tw * 0.56 + 14;
      const ry = fontSize * 0.58;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const segs = 42;
      const drawWobbly = (phase: number, scale: number, lw: number, alpha: number) => {
        ctx.strokeStyle = A;
        ctx.lineWidth = lw;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        const maxS = Math.floor(segs * p);
        for (let s = 0; s <= maxS; s++) {
          const a = -Math.PI / 2 + (Math.PI * 2 * s) / segs + phase;
          // 끝에서 살짝 겹치게 (손 마무리)
          const over = s > segs * 0.92 ? 1 + (s / segs - 0.92) * 0.4 : 1;
          const jig =
            1 +
            Math.sin(s * 1.9 + phase * 3) * 0.055 +
            Math.cos(s * 2.7 + phase) * 0.04 +
            Math.sin(s * 0.6) * 0.02;
          const px = cx0 + Math.cos(a) * rx * jig * scale * over;
          const py = cy0 + Math.sin(a) * ry * jig * scale * 0.93;
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      };
      drawWobbly(0, 1, Math.max(3.5, fontSize * 0.07), 0.92);
      drawWobbly(0.12, 1.04, Math.max(2, fontSize * 0.045), 0.4);
      drawWobbly(-0.08, 0.97, Math.max(1.5, fontSize * 0.03), 0.28);
      ctx.globalAlpha = 1;
    } else if (tok.fx === 'glow') {
      ctx.shadowColor = A;
      ctx.shadowBlur = 18 * p;
      ctx.fillStyle = '#fff';
      ctx.fillText(tok.text, cx, y);
      ctx.shadowBlur = 0;
    } else if (tok.fx === 'outline') {
      ctx.lineWidth = Math.max(3, fontSize * 0.06);
      ctx.strokeStyle = A;
      ctx.strokeText(tok.text, cx, y);
      ctx.fillStyle = '#fff';
      ctx.fillText(tok.text, cx, y);
    } else if (tok.fx === 'stamp') {
      ctx.save();
      ctx.translate(cx + tw / 2, y - fontSize * 0.25);
      ctx.rotate(-0.08 + (1 - p) * 0.2);
      ctx.scale(0.85 + 0.15 * p, 0.85 + 0.15 * p);
      ctx.fillStyle = A;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(-tw / 2 - 6, -fontSize * 0.55, tw + 12, fontSize);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(tok.text, 0, fontSize * 0.28);
      ctx.restore();
    } else if (tok.fx === 'shake') {
      const jx = p < 1 ? Math.sin(p * 40) * 3 : 0;
      ctx.fillStyle = '#fff';
      ctx.fillText(tok.text, cx + jx, y);
    } else if (tok.fx === 'bounce') {
      const by = p < 1 ? Math.sin(p * Math.PI) * -10 : 0;
      ctx.fillStyle = '#fff';
      ctx.fillText(tok.text, cx, y + by);
    } else if (tok.fx === 'wave') {
      ctx.fillStyle = '#fff';
      ctx.fillText(tok.text, cx, y);
      ctx.strokeStyle = A;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let s = 0; s <= 20 * p; s++) {
        const px = cx + (tw * s) / 20;
        const py = y + 8 + Math.sin(s * 0.9) * 3;
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    } else if (tok.fx === 'fill') {
      ctx.fillStyle = A;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(cx - 4, top + fontSize * 0.05, tw * p + 8, h * 0.9);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff';
      ctx.fillText(tok.text, cx, y);
    }
    cx += tw;
  });
}

function photoScaleOffset(effect: PhotoEffect | undefined, anim: number): {
  scale: number;
  ox: number;
  oy: number;
  alpha: number;
  blur: number;
} {
  const e = effect || 'none';
  const t = anim;
  switch (e) {
    case 'none':
      return {scale: 1.05, ox: 0, oy: 0, alpha: 1, blur: 0};
    case 'ken-out':
      return {scale: 1.18 - t * 0.12, ox: 0, oy: 0, alpha: 1, blur: 0};
    case 'pan-left':
      return {scale: 1.15, ox: (0.5 - t) * 80, oy: 0, alpha: 1, blur: 0};
    case 'pan-right':
      return {scale: 1.15, ox: (t - 0.5) * 80, oy: 0, alpha: 1, blur: 0};
    case 'zoom-pulse': {
      const pulse = 1.08 + Math.sin(t * Math.PI * 2) * 0.04;
      return {scale: pulse, ox: 0, oy: 0, alpha: 1, blur: 0};
    }
    case 'fade-rise':
      return {scale: 1.08, ox: 0, oy: (1 - t) * 40, alpha: Math.min(1, t * 2), blur: 0};
    case 'blur-sharp':
      return {scale: 1.1, ox: 0, oy: 0, alpha: 1, blur: Math.max(0, 12 * (1 - t * 2.5))};
    case 'drift-up':
      return {scale: 1.12, ox: 0, oy: (0.5 - t) * 60, alpha: 1, blur: 0};
    case 'soft-zoom':
      return {scale: 1.04 + t * 0.08, ox: 0, oy: 0, alpha: 1, blur: 0};
    case 'ken-in':
      return {scale: 1.05 + t * 0.1, ox: 0, oy: 0, alpha: 1, blur: 0};
    default:
      return {scale: 1.05, ox: 0, oy: 0, alpha: 1, blur: 0};
  }
}

function drawTextBlock(
  ctx: CanvasRenderingContext2D,
  title: string,
  text: string,
  pos: Pos,
  chipLabel: string,
  family: string,
  anim: number,
  accent = RED,
  textEnter: string = 'fade-up',
) {
  const lines = (title || ' ').split('\n').filter(Boolean).slice(0, 3);
  const right = pos === 'br' || pos === 'tr';
  const top = pos === 'tl' || pos === 'tr';
  const align: CanvasTextAlign = right ? 'right' : 'left';
  const pad = 72;
  const x = right ? W - pad : pad;
  const maxTextW = W - pad * 2;
  const fontSize = Math.min(
    ...lines.map((l) => fitFontSize(ctx, l, 64, maxTextW, 800, family)),
    64,
  );
  const blockH = 48 + lines.length * (fontSize + 14) + (text ? 50 : 0);
  const blockTop = top ? 200 : H - 140 - blockH;

  // 실제 초 기준 타이밍 (8초 슬라이드 중 앞 2초만 글자 연출)
  const tSec = animToSec(anim);
  const te = textEnter || 'fade-up';
  const enterDur = te === 'none' ? 0 : TEXT_ENTER_SEC;
  // 전체 등장 진행 0→1 (제목·부제 공통)
  const ep = te === 'none' ? 1 : clamp01(tSec / enterDur);
  // 부분 강조는 등장이 끝난 뒤 시작
  const emphasisStart = enterDur + TEXT_EMPHASIS_GAP_SEC;
  const markBase = clamp01((tSec - emphasisStart) / TEXT_EMPHASIS_SEC);

  ctx.save();
  // 전체 텍스트 등장 (제목+부제 블록 통째로)
  if (te === 'none') {
    ctx.globalAlpha = 1;
  } else if (te === 'fade-up') {
    ctx.globalAlpha = ep;
    ctx.translate(0, (1 - ep) * 28);
  } else if (te === 'mask-up') {
    ctx.globalAlpha = ep;
    ctx.translate(0, (1 - ep) * 48);
  } else if (te === 'scale-in') {
    const s = 0.86 + ep * 0.14;
    ctx.translate(W / 2, 0);
    ctx.scale(s, s);
    ctx.translate(-W / 2, 0);
    ctx.globalAlpha = ep;
  } else if (te === 'blur-in') {
    ctx.globalAlpha = ep;
    if (ep < 1) ctx.filter = `blur(${(1 - ep) * 8}px)`;
  } else if (te === 'slide-left') {
    ctx.globalAlpha = ep;
    ctx.translate((1 - ep) * -80, 0);
  } else if (te === 'bounce-in') {
    const s = ep < 1 ? 0.7 + Math.sin(ep * Math.PI) * 0.4 : 1;
    ctx.translate(W / 2, 0);
    ctx.scale(s, s);
    ctx.translate(-W / 2, 0);
  } else if (te === 'type-block' || te === 'line-draw' || te === 'wipe-right' || te === 'rise-stagger') {
    ctx.globalAlpha = 1;
  }

  // wipe 클립 — 등장 구간에서만
  if (te === 'wipe-right' && ep < 1) {
    ctx.beginPath();
    ctx.rect(pad - 20, blockTop - 10, (W - pad * 2 + 40) * ep, blockH + 40);
    ctx.clip();
  }

  ctx.font = `700 28px ${family}`;
  const chip = chipLabel;
  const chipW = ctx.measureText(chip).width + 30;
  const chipX = right ? x - chipW : x;
  const chipY = blockTop;
  ctx.fillStyle = RED;
  ctx.fillRect(chipX, chipY, chipW, 42);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(chip, chipX + 14, chipY + 22);

  // 칩 옆 선 — 등장과 함께 빠르게
  const lineP = te === 'line-draw' ? ep : 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (right) {
    const x0 = chipX - 12;
    const x1 = pad;
    ctx.moveTo(x0, chipY + 21);
    ctx.lineTo(x0 + (x1 - x0) * lineP, chipY + 21);
  } else {
    const x0 = chipX + chipW + 12;
    const x1 = W - pad;
    ctx.moveTo(x0, chipY + 21);
    ctx.lineTo(x0 + (x1 - x0) * lineP, chipY + 21);
  }
  ctx.stroke();

  // line-draw: 강조색 가이드 선 (등장 구간)
  if (te === 'line-draw') {
    ctx.strokeStyle = accent || RED;
    ctx.lineWidth = 5;
    ctx.globalAlpha = 0.85 * Math.min(1, ep + 0.15);
    ctx.beginPath();
    const guideY = chipY + 42 + 28 + fontSize + 10;
    if (right) {
      ctx.moveTo(x, guideY);
      ctx.lineTo(x - maxTextW * ep, guideY);
    } else {
      ctx.moveTo(x, guideY);
      ctx.lineTo(x + maxTextW * ep, guideY);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 14;
  lines.forEach((line, i) => {
    const y = chipY + 42 + 28 + fontSize + i * (fontSize + 16);
    // 등장 끝난 뒤에만 강조 progress (줄마다 아주 살짝 스태거)
    const markP = clamp01(markBase - i * 0.06);

    if (te === 'rise-stagger') {
      const sp = clamp01((tSec - i * 0.1) / Math.max(0.2, enterDur - i * 0.1));
      ctx.save();
      ctx.globalAlpha = sp;
      ctx.translate(0, (1 - sp) * 24);
      drawMarkedLine(ctx, line, x, y, align, fontSize, family, markP, accent);
      ctx.restore();
      return;
    }

    if (te === 'type-block' && ep < 1) {
      // 등장 중: 글자 수 기준 드러내기, 강조는 0
      const plain = line.replace(
        /==|@@|__|\[\[|\]\]|~~|%%|##|\+\+|\*\*|::|<<|>>|!!|\^\^|≈≈|\{\{|}}/g,
        '',
      );
      const n = Math.max(0, Math.floor(plain.length * ep));
      let left = n;
      const toks = parseFx(line);
      let clipped = '';
      for (const tok of toks) {
        if (left <= 0) break;
        const take = tok.text.slice(0, left);
        if (tok.fx === 'none') clipped += take;
        else {
          // 마커 구간도 등장 중에는 일반 글자로만 표시
          clipped += take;
        }
        left -= take.length;
      }
      ctx.font = `800 ${fontSize}px ${family}`;
      ctx.fillStyle = '#fff';
      ctx.textAlign = align;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(clipped, x, y);
      return;
    }

    // 등장 완료 후: 전체 텍스트 + 부분 강조 스윕
    drawMarkedLine(ctx, line, x, y, align, fontSize, family, markP, accent);
  });

  // 부제 — 제목과 같은 전체 등장 (블록 transform/alpha 공유 + 특수 모드 보정)
  if (text) {
    ctx.shadowBlur = 10;
    ctx.font = `500 34px ${family}`;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.textAlign = align;
    ctx.save();
    if (te === 'type-block') {
      const n = Math.max(0, Math.floor(text.length * ep));
      ctx.globalAlpha = 1;
      ctx.fillText(text.slice(0, n), x, chipY + 42 + 28 + lines.length * (fontSize + 16) + 28);
    } else if (te === 'rise-stagger') {
      ctx.globalAlpha = ep;
      ctx.translate(0, (1 - ep) * 12);
      ctx.fillText(text, x, chipY + 42 + 28 + lines.length * (fontSize + 16) + 28);
    } else if (te === 'line-draw' || te === 'wipe-right') {
      // wipe는 이미 클립, line-draw는 함께 페이드
      ctx.globalAlpha = te === 'line-draw' ? Math.min(1, ep + 0.2) : 1;
      ctx.fillText(text, x, chipY + 42 + 28 + lines.length * (fontSize + 16) + 28);
    } else {
      // fade-up 등은 블록 전체 transform/alpha 적용 상태
      ctx.fillText(text, x, chipY + 42 + 28 + lines.length * (fontSize + 16) + 28);
    }
    ctx.restore();
  }
  ctx.restore();
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  project: Project,
  slide: Slide | null,
  phase: 'intro' | 'slide' | 'outro',
  anim: number,
  media: LoadedMedia | null,
  slideIndex: number,
  slideTotal: number,
) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const family = fontCss(slide?.fontFamily || project.fontFamily);

  if (phase === 'intro') {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const a = Math.min(1, anim * 2.2);
    ctx.globalAlpha = a;
    ctx.fillStyle = '#101010';
    ctx.font = `700 56px ${family}`;
    ctx.fillText(project.brand.logoText || 'BRAND', W / 2, H * 0.42);
    ctx.font = `700 48px ${family}`;
    ctx.fillText(project.title || '카드뉴스', W / 2, H * 0.5);
    if (project.subtitle) {
      ctx.font = `500 30px ${family}`;
      ctx.fillStyle = '#8a8a8a';
      ctx.fillText(project.subtitle, W / 2, H * 0.56);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = RED;
    const barW = 120 * Math.min(1, anim * 2);
    ctx.fillRect(W / 2 - barW / 2, H * 0.62, barW, 8);
    return;
  }

  if (phase === 'outro') {
    ctx.fillStyle = RED;
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = Math.min(1, anim * 2);
    ctx.fillStyle = '#fff';
    ctx.font = `700 54px ${family}`;
    ctx.fillText(project.brand.logoText || 'BRAND', W / 2, H * 0.45);
    ctx.globalAlpha = Math.min(1, Math.max(0, (anim - 0.15) / 0.25));
    const cta = project.brand.handle || '{주소}';
    ctx.font = `700 34px ${family}`;
    const tw = ctx.measureText(cta).width + 72;
    const bx = W / 2 - tw / 2;
    const by = H * 0.52;
    ctx.fillStyle = '#fff';
    roundRect(ctx, bx, by, tw, 72, 36);
    ctx.fill();
    ctx.fillStyle = '#101010';
    ctx.fillText(cta, W / 2, by + 38);
    ctx.globalAlpha = 1;
    return;
  }

  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, W, H);
  if (media) {
    const pe = photoScaleOffset(slide?.photoEffect, anim);
    ctx.save();
    ctx.globalAlpha = pe.alpha;
    if (pe.blur > 0.5) ctx.filter = `blur(${pe.blur}px)`;
    ctx.translate(pe.ox, pe.oy);
    drawMediaCover(ctx, media, W, H, pe.scale);
    ctx.filter = 'none';
    ctx.restore();
  } else {
    const g0 = ctx.createLinearGradient(0, 0, W, H);
    g0.addColorStop(0, '#3a2a20');
    g0.addColorStop(1, '#1a3040');
    ctx.fillStyle = g0;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `600 32px ${family}`;
    ctx.textAlign = 'center';
    ctx.fillText('미디어 없음', W / 2, H / 2);
  }

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0.28)');
  g.addColorStop(0.4, 'rgba(0,0,0,0.05)');
  g.addColorStop(1, 'rgba(0,0,0,0.72)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#fff';
  ctx.font = `500 26px ${family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(project.brand.logoText || 'BRAND', W / 2, 88);

  if (slide) {
    const chip = defaultChip(slideIndex, slideTotal, slide.chipText);
    drawTextBlock(
      ctx,
      slide.title,
      slide.text,
      slide.pos ?? 'bl',
      chip,
      family,
      anim,
      slide.accentColor || RED,
      slide.textEnter || 'fade-up',
    );
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

type PhaseJob = {
  phase: 'intro' | 'slide' | 'outro';
  sec: number;
  slide: Slide | null;
  media: LoadedMedia | null;
  slideIndex: number; // 1-based for chip
  label: string;
};

function buildJobs(
  project: Project,
  segment: ExportSegment,
  slides: Slide[],
  medias: Array<LoadedMedia | null>,
): PhaseJob[] {
  const n = slides.length;
  if (segment.kind === 'intro') {
    return [{phase: 'intro', sec: INTRO_SEC, slide: null, media: null, slideIndex: 0, label: '인트로'}];
  }
  if (segment.kind === 'outro') {
    return [{phase: 'outro', sec: OUTRO_SEC, slide: null, media: null, slideIndex: 0, label: '아웃트로'}];
  }
  if (segment.kind === 'slide') {
    const i = segment.index;
    if (i < 0 || i >= n) throw new Error('잘못된 슬라이드');
    return [
      {
        phase: 'slide',
        sec: SLIDE_SEC,
        slide: slides[i],
        media: medias[i],
        slideIndex: i + 1,
        label: `뉴스 ${i + 1}`,
      },
    ];
  }
  // full
  return [
    {phase: 'intro', sec: INTRO_SEC, slide: null, media: null, slideIndex: 0, label: '인트로'},
    ...slides.map((s, i) => ({
      phase: 'slide' as const,
      sec: SLIDE_SEC,
      slide: s,
      media: medias[i],
      slideIndex: i + 1,
      label: `뉴스 ${i + 1}/${n}`,
    })),
    {phase: 'outro', sec: OUTRO_SEC, slide: null, media: null, slideIndex: 0, label: '아웃트로'},
  ];
}

/** 오프라인으로 프레임 비트맵 생성 (실시간 sleep 없음 → 빠르고 타이밍 정확) */
async function renderFrames(
  project: Project,
  jobs: PhaseJob[],
  onProgress?: (p: ExportProgress) => void,
): Promise<ImageData[]> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', {alpha: false, willReadFrequently: true});
  if (!ctx) throw new Error('Canvas 불가');

  const frames: ImageData[] = [];
  const totalFrames = jobs.reduce((s, j) => s + Math.round(j.sec * FPS), 0);
  let done = 0;

  for (const job of jobs) {
    const n = Math.round(job.sec * FPS);
    for (let f = 0; f < n; f++) {
      const anim = n <= 1 ? 1 : f / (n - 1);
      // 비디오 프레임 전진
      if (job.media?.type === 'video' && f % 2 === 0) {
        try {
          const t = (f / FPS) % Math.max(0.2, job.media.el.duration || 4);
          if (Math.abs(job.media.el.currentTime - t) > 0.05) {
            job.media.el.currentTime = t;
            await new Promise<void>((r) => {
              const fin = () => {
                job.media!.el.removeEventListener('seeked', fin);
                r();
              };
              job.media!.el.addEventListener('seeked', fin);
              setTimeout(fin, 50);
            });
          }
        } catch {
          /* ignore */
        }
      }
      drawFrame(
        ctx,
        project,
        job.slide,
        job.phase,
        anim,
        job.media,
        job.slideIndex,
        Math.max(1, jobs.filter((j) => j.phase === 'slide').length || project.slides.length),
      );
      // full 모드일 때 slideTotal 은 뉴스 장수
      frames.push(ctx.getImageData(0, 0, W, H));
      done += 1;
      if (done % 4 === 0 || done === totalFrames) {
        onProgress?.({
          phase: job.label,
          pct: Math.min(92, Math.round((done / totalFrames) * 90)),
        });
        // UI 숨 쉴 틈
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }
  return frames;
}

async function encodeWebm(frames: ImageData[], onProgress?: (p: ExportProgress) => void): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', {alpha: false})!;
  const mime = pickWebmMime();
  const stream = canvas.captureStream(FPS);
  const chunks: BlobPart[] = [];
  const rec = new MediaRecorder(stream, {mimeType: mime, videoBitsPerSecond: 10_000_000});
  rec.ondataavailable = (e) => {
    if (e.data?.size) chunks.push(e.data);
  };
  const done = new Promise<Blob>((resolve, reject) => {
    rec.onstop = () => resolve(new Blob(chunks, {type: 'video/webm'}));
    rec.onerror = () => reject(new Error('webm 인코딩 실패'));
  });
  ctx.putImageData(frames[0], 0, 0);
  rec.start(100);
  for (let i = 0; i < frames.length; i++) {
    ctx.putImageData(frames[i], 0, 0);
    onProgress?.({phase: 'webm 인코딩', pct: 90 + Math.round((i / frames.length) * 9)});
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await new Promise((r) => setTimeout(r, 1000 / FPS));
  }
  await new Promise((r) => setTimeout(r, 80));
  rec.stop();
  stream.getTracks().forEach((t) => t.stop());
  return done;
}

async function encodeGif(frames: ImageData[], onProgress?: (p: ExportProgress) => void): Promise<Blob> {
  // 해상도·프레임 줄여 용량 관리
  const scale = 0.4;
  const gw = Math.round(W * scale);
  const gh = Math.round(H * scale);
  const canvas = document.createElement('canvas');
  canvas.width = gw;
  canvas.height = gh;
  const ctx = canvas.getContext('2d', {willReadFrequently: true})!;
  const gif = GIFEncoder();
  const step = Math.max(1, Math.round(FPS / 10)); // ~10fps gif
  const delay = Math.round((1000 * step) / FPS);
  let written = 0;
  const total = Math.ceil(frames.length / step);
  for (let i = 0; i < frames.length; i += step) {
    // scale down
    const tmp = document.createElement('canvas');
    tmp.width = W;
    tmp.height = H;
    tmp.getContext('2d')!.putImageData(frames[i], 0, 0);
    ctx.clearRect(0, 0, gw, gh);
    ctx.drawImage(tmp, 0, 0, gw, gh);
    const data = ctx.getImageData(0, 0, gw, gh);
    const palette = quantize(data.data, 256);
    const index = applyPalette(data.data, palette);
    gif.writeFrame(index, gw, gh, {palette, delay});
    written += 1;
    onProgress?.({phase: 'gif 인코딩', pct: 90 + Math.round((written / total) * 9)});
    if (written % 3 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  gif.finish();
  const bytes = gif.bytes();
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], {type: 'image/gif'});
}

/** H.264 코덱 후보 — 세로 1080×1920 은 Level 4.0 이상 필요 */
const H264_CODECS = [
  'avc1.640028', // High Profile Level 4.0
  'avc1.4d0028', // Main Profile Level 4.0
  'avc1.420028', // Baseline Level 4.0
  'avc1.64001f', // High Level 3.1 (일부 환경)
  'avc1.4d001f',
];

function pickH264Config(): VideoEncoderConfig | null {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const codec of H264_CODECS) {
    for (const hw of ['prefer-hardware', 'prefer-software'] as const) {
      const cfg: VideoEncoderConfig = {
        codec,
        width: W,
        height: H,
        bitrate: 10_000_000,
        framerate: FPS,
        latencyMode: 'quality',
        avc: {format: 'avc'},
        hardwareAcceleration: hw,
      };
      try {
        // isConfigSupported 는 async — 여기서는 후보만 반환, encode 시 시도
        void cfg;
        return cfg;
      } catch {
        /* continue */
      }
    }
  }
  return {
    codec: 'avc1.640028',
    width: W,
    height: H,
    bitrate: 10_000_000,
    framerate: FPS,
    avc: {format: 'avc'},
  };
}

async function resolveH264Config(): Promise<VideoEncoderConfig | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoEncoder.isConfigSupported !== 'function') {
    return pickH264Config();
  }
  for (const codec of H264_CODECS) {
    for (const hw of ['prefer-hardware', 'prefer-software', 'no-preference'] as const) {
      const cfg: VideoEncoderConfig = {
        codec,
        width: W,
        height: H,
        bitrate: 10_000_000,
        framerate: FPS,
        latencyMode: 'quality',
        avc: {format: 'avc'},
        hardwareAcceleration: hw,
      };
      try {
        const {supported, config} = await VideoEncoder.isConfigSupported(cfg);
        if (supported && config) {
          return {
            codec: config.codec || codec,
            width: W,
            height: H,
            bitrate: config.bitrate || 10_000_000,
            framerate: FPS,
            latencyMode: 'quality',
            avc: {format: 'avc'},
            hardwareAcceleration: hw,
          };
        }
      } catch {
        /* try next */
      }
    }
  }
  return pickH264Config();
}

export type EncodeResult = {blob: Blob; ext: 'mp4' | 'webm' | 'gif'; note?: string};

async function encodeMp4(frames: ImageData[], onProgress?: (p: ExportProgress) => void): Promise<EncodeResult> {
  const cfg = await resolveH264Config();
  if (!cfg || typeof VideoEncoder === 'undefined') {
    onProgress?.({phase: 'MP4 미지원 → WebM', pct: 95});
    const blob = await encodeWebm(frames, onProgress);
    return {blob, ext: 'webm', note: '이 브라우저는 MP4(H.264) 인코딩을 지원하지 않아 WebM으로 저장했습니다. Chrome/Edge를 권장합니다.'};
  }

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {
      codec: 'avc',
      width: W,
      height: H,
    },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  let encodeErr: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      try {
        muxer.addVideoChunk(chunk, meta);
      } catch (e) {
        encodeErr = e instanceof Error ? e : new Error(String(e));
      }
    },
    error: (e) => {
      encodeErr = e instanceof Error ? e : new Error(String(e));
      console.error('[mp4] encoder error', e);
    },
  });

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', {alpha: false, desynchronized: true})!;
  const frameDur = Math.round(1_000_000 / FPS);

  try {
    encoder.configure(cfg);

    for (let i = 0; i < frames.length; i++) {
      if (encodeErr) throw encodeErr;
      if (encoder.state === 'closed') throw new Error('encoder closed');

      // 큐 백프레셔 — 메모리 폭주 방지
      while (encoder.encodeQueueSize > 8) {
        await new Promise<void>((r) => {
          const prev = encoder.ondequeue;
          encoder.ondequeue = () => {
            encoder.ondequeue = prev;
            r();
          };
          setTimeout(r, 16);
        });
      }

      ctx.putImageData(frames[i], 0, 0);
      const bitmap = await createImageBitmap(canvas);
      const frame = new VideoFrame(bitmap, {
        timestamp: i * frameDur,
        duration: frameDur,
      });
      try {
        encoder.encode(frame, {keyFrame: i % 30 === 0 || i === 0});
      } finally {
        frame.close();
        bitmap.close();
      }
      if (i % 5 === 0) {
        onProgress?.({phase: 'mp4 인코딩', pct: 90 + Math.round((i / frames.length) * 8)});
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    if (encodeErr) throw encodeErr;
    if (encoder.state !== 'closed') {
      await encoder.flush();
      encoder.close();
    }
    muxer.finalize();
    const buf = target.buffer;
    if (!buf || buf.byteLength < 1000) {
      throw new Error('MP4 버퍼가 비어 있습니다');
    }
    return {blob: new Blob([buf], {type: 'video/mp4'}), ext: 'mp4'};
  } catch (e) {
    console.warn('mp4 encode failed, fallback webm', e);
    try {
      if (encoder.state !== 'closed') encoder.close();
    } catch {
      /* ignore */
    }
    onProgress?.({phase: 'MP4 실패 → WebM', pct: 95});
    const blob = await encodeWebm(frames, onProgress);
    return {
      blob,
      ext: 'webm',
      note: 'MP4 인코딩에 실패해 WebM으로 저장했습니다. Chrome 최신 버전에서 다시 시도해 주세요.',
    };
  }
}

export async function exportSegment(
  project: Project,
  segment: ExportSegment,
  format: ExportFormat,
  onProgress?: (p: ExportProgress) => void,
): Promise<{blob: Blob; filename: string; note?: string}> {
  const slides = project.slides.filter((s) => s.image || s.title || s.text).slice(0, 8);
  if (segment.kind === 'full' || segment.kind === 'slide') {
    if (slides.length === 0) throw new Error('뉴스 슬라이드가 없습니다');
  }
  if (segment.kind === 'slide' && (segment.index < 0 || segment.index >= slides.length)) {
    throw new Error('슬라이드 번호 오류');
  }

  await document.fonts.ready.catch(() => undefined);
  onProgress?.({phase: '미디어 로딩', pct: 3});

  const medias: Array<LoadedMedia | null> = [];
  for (let i = 0; i < slides.length; i++) {
    medias.push(await loadMedia(slides[i].image, slides[i].mediaKind));
    onProgress?.({phase: '미디어 로딩', pct: 3 + Math.round(((i + 1) / Math.max(1, slides.length)) * 8)});
  }

  const jobs = buildJobs(project, segment, slides, medias);
  const frames = await renderFramesWithTotal(
    project,
    jobs,
    Math.max(1, project.slides.length),
    onProgress,
  );

  onProgress?.({phase: `${format} 인코딩`, pct: 92});
  let blob: Blob;
  let ext: string = format;
  let note: string | undefined;

  if (format === 'gif') {
    blob = await encodeGif(frames, onProgress);
    ext = 'gif';
  } else if (format === 'mp4') {
    const r = await encodeMp4(frames, onProgress);
    blob = r.blob;
    ext = r.ext;
    note = r.note;
  } else {
    blob = await encodeWebm(frames, onProgress);
    ext = 'webm';
  }

  const stamp = Date.now();
  let base = 'cardnews-full';
  if (segment.kind === 'intro') base = 'cardnews-intro';
  else if (segment.kind === 'outro') base = 'cardnews-outro';
  else if (segment.kind === 'slide') base = `cardnews-news-${segment.index + 1}`;

  // 뉴스 1장 = 8초 (인트로/아웃트로 2.5초)
  onProgress?.({phase: '완료', pct: 100});
  return {blob, filename: `${base}-${stamp}.${ext}`, note};
}

async function renderFramesWithTotal(
  project: Project,
  jobs: PhaseJob[],
  newsTotal: number,
  onProgress?: (p: ExportProgress) => void,
): Promise<ImageData[]> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', {alpha: false, willReadFrequently: true});
  if (!ctx) throw new Error('Canvas 불가');

  const frames: ImageData[] = [];
  const totalFrames = jobs.reduce((s, j) => s + Math.round(j.sec * FPS), 0);
  let done = 0;

  for (const job of jobs) {
    const n = Math.round(job.sec * FPS);
    for (let f = 0; f < n; f++) {
      const anim = n <= 1 ? 1 : f / (n - 1);
      if (job.media?.type === 'video' && f % 2 === 0) {
        try {
          const t = (f / FPS) % Math.max(0.2, job.media.el.duration || 4);
          if (Math.abs(job.media.el.currentTime - t) > 0.05) {
            job.media.el.currentTime = t;
            await new Promise<void>((r) => {
              const fin = () => {
                job.media!.el.removeEventListener('seeked', fin);
                r();
              };
              job.media!.el.addEventListener('seeked', fin);
              setTimeout(fin, 40);
            });
          }
        } catch {
          /* ignore */
        }
      }
      drawFrame(
        ctx,
        project,
        job.slide,
        job.phase,
        anim,
        job.media,
        job.slideIndex,
        Math.max(1, newsTotal),
      );
      frames.push(ctx.getImageData(0, 0, W, H));
      done += 1;
      if (done % 5 === 0 || done === totalFrames) {
        onProgress?.({
          phase: job.label,
          pct: Math.min(90, Math.round((done / totalFrames) * 88)),
        });
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }
  return frames;
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}

/** @deprecated use exportSegment */
export async function exportProjectVideo(
  project: Project,
  onProgress?: (p: ExportProgress) => void,
): Promise<Blob> {
  const {blob} = await exportSegment(project, {kind: 'full'}, 'mp4', onProgress);
  return blob;
}
