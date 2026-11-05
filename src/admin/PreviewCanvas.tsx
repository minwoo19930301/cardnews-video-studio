import {useEffect, useRef, useState} from 'react';
import {drawFrame, H, logoLayout, SLIDE_SEC, textLayout, W, type FrameMedia} from '../engine/render';
import {ensureFonts, loadLogo, toFrameMedia} from './exportVideo';
import {loadMedia, type LoadedMedia} from './media';
import {fontCss, type Project, type Slide} from './types';
import {mergeTargets, rectTargets, snapRect, stageTargets, type Guides, type Rect} from './snap';

/** 미리보기 해상도 배율 (1080×1920 의 절반으로 그려 가볍게) */
const PREVIEW_SCALE = 0.5;

type Offset = {x: number; y: number};
type Box = {x: number; y: number; w: number; h: number};
type DragTarget = 'text' | 'logo';

type Props = {
  project: Project;
  slide: Slide | null;
  slideIndex: number; // 1-based
  slideTotal: number;
  /** 앞 장 (전환 때 겹쳐 보이게) */
  prevSlide: Slide | null;
  onMoveText: (offset: Offset) => void;
  onMoveLogo: (offset: Offset) => void;
  onScaleText: (scale: number) => void;
  onScaleLogo: (scale: number) => void;
  onDeleteText: () => void;
  onDeleteLogo: () => void;
};

const HANDLE = 26; // 모서리 손잡이 크기 (영상 좌표)
const CLOSE_R = 24; // × 버튼 반지름

type Corner = 'nw' | 'ne' | 'sw' | 'se';
const corners = (b: Box): Record<Corner, {x: number; y: number}> => ({
  nw: {x: b.x, y: b.y},
  ne: {x: b.x + b.w, y: b.y},
  sw: {x: b.x, y: b.y + b.h},
  se: {x: b.x + b.w, y: b.y + b.h},
});
const closePos = (b: Box) => ({x: b.x + b.w + 6, y: b.y - 6});

function useMedia(slide: Slide | null, autoplay: boolean) {
  const [media, setMedia] = useState<LoadedMedia | null>(null);
  const src = slide?.image || '';
  const kind = slide?.mediaKind;
  useEffect(() => {
    let alive = true;
    setMedia(null);
    if (!src) return;
    void loadMedia(src, kind).then((m) => {
      if (!alive) return;
      if (m?.type === 'video' && autoplay) {
        m.el.loop = true;
        void m.el.play().catch(() => undefined);
      }
      setMedia(m);
    });
    return () => {
      alive = false;
    };
  }, [src, kind, autoplay]);
  return media;
}

const inside = (b: Box, x: number, y: number) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;

/**
 * 내보내기와 같은 엔진(drawFrame)으로 그리는 실시간 미리보기.
 * 8초를 반복 재생하고, 멈춰서 원하는 시점을 끌어 볼 수 있다.
 * 제목 묶음과 로고는 화면에서 끌어서 옮긴다.
 */
export function PreviewCanvas(props: Props) {
  const {project, slide, slideIndex, slideTotal, prevSlide} = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const media = useMedia(slide, true);
  const prevMedia = useMedia(prevSlide, false);
  const [logo, setLogo] = useState<FrameMedia>(null);
  const [playing, setPlaying] = useState(true);
  const [shownSec, setShownSec] = useState(0);
  const [cursor, setCursor] = useState('default');
  const clockRef = useRef({start: performance.now(), pausedAt: 0, playing: true});
  const dragRef = useRef<{
    mode: 'move' | 'scale';
    target: DragTarget;
    /** 크기 조절: 시작 배율·중심·시작 거리·지금 배율 */
    baseScale: number;
    center: {x: number; y: number};
    startDist: number;
    scale: number;
    startX: number;
    startY: number;
    base: Offset;
    now: Offset;
    /** 끌기 시작할 때의 실제 영역 */
    content: Rect;
    /** 다른 요소 영역 (정렬 기준) */
    other: Rect | null;
    guides: Guides;
  } | null>(null);
  const hoverRef = useRef<DragTarget | null>(null);
  const selectedRef = useRef<DragTarget | null>(null);
  const actionsRef = useRef(props);
  actionsRef.current = props;

  // 다른 장으로 가면 선택 해제
  useEffect(() => {
    selectedRef.current = null;
  }, [slide?.id]);

  // 선택한 채로 Delete/Backspace → 지우기, Esc → 선택 해제 (입력 칸에서는 무시)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const sel = selectedRef.current;
      if (!sel) return;
      if (e.key === 'Escape') selectedRef.current = null;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        selectedRef.current = null;
        if (sel === 'text') actionsRef.current.onDeleteText();
        else actionsRef.current.onDeleteLogo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const boxesRef = useRef<{text: Box | null; logo: Box | null; textContent: Rect | null; logoContent: Rect | null}>({
    text: null,
    logo: null,
    textContent: null,
    logoContent: null,
  });
  const propsRef = useRef({project, slide, slideIndex, slideTotal, media, logo, prevSlide, prevMedia});
  propsRef.current = {project, slide, slideIndex, slideTotal, media, logo, prevSlide, prevMedia};

  useEffect(() => {
    let alive = true;
    void loadLogo(project.brand.logoImage).then((l) => alive && setLogo(l));
    return () => {
      alive = false;
    };
  }, [project.brand.logoImage]);

  const fontKey = `${project.fontFamily}|${slide?.fontFamily ?? ''}|${prevSlide?.fontFamily ?? ''}`;
  useEffect(() => {
    void ensureFonts(project);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontKey]);

  const currentSec = () => {
    const c = clockRef.current;
    return c.playing ? ((performance.now() - c.start) / 1000) % SLIDE_SEC : c.pausedAt;
  };
  const seek = (sec: number) => {
    const c = clockRef.current;
    c.pausedAt = sec;
    c.start = performance.now() - sec * 1000;
    setShownSec(sec);
  };

  // 장이나 효과를 바꾸면 처음부터 다시 (글자를 고칠 때는 되감지 않음)
  const replayKey = [slide?.id, slide?.photoEffect, slide?.textEnter, slide?.transition].join('|');
  useEffect(() => {
    seek(0);
  }, [replayKey]);

  const togglePlay = () => {
    const c = clockRef.current;
    if (c.playing) {
      c.pausedAt = currentSec();
      c.playing = false;
    } else {
      c.start = performance.now() - c.pausedAt * 1000;
      c.playing = true;
    }
    setPlaying(c.playing);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let raf = 0;
    let lastUi = 0;
    const tick = (now: number) => {
      const p = propsRef.current;
      const d = dragRef.current;
      // 끄는 동안은 저장하지 않고 화면에서만 위치를 바꿔 그린다
      const proj =
        d?.target === 'logo'
          ? {...p.project, brand: {...p.project.brand, logoOffset: d.now, logoScale: d.mode === 'scale' ? d.scale : p.project.brand.logoScale}}
          : p.project;
      const sl =
        d?.target === 'text' && p.slide
          ? {...p.slide, textOffset: d.now, textScale: d.mode === 'scale' ? d.scale : p.slide.textScale}
          : p.slide;
      const sec = d ? Math.max(currentSec(), 2) : currentSec(); // 끄는 동안엔 글자가 다 보이는 시점
      ctx.setTransform(PREVIEW_SCALE, 0, 0, PREVIEW_SCALE, 0, 0);
      drawFrame(ctx, {
        project: proj,
        slide: sl,
        anim: sec / SLIDE_SEC,
        media: toFrameMedia(p.media),
        logo: p.logo,
        slideIndex: p.slideIndex,
        slideTotal: p.slideTotal,
        prev: p.prevSlide ? {slide: p.prevSlide, media: toFrameMedia(p.prevMedia), slideIndex: p.slideIndex - 1} : null,
      });

      // 드래그 판정 상자 (화면에만, 영상에는 안 들어감)
      const family = fontCss(sl?.fontFamily || proj.fontFamily);
      const tl = sl ? textLayout(ctx, sl, family) : null;
      const ll = logoLayout(ctx, proj, p.logo, fontCss(proj.fontFamily));
      const tb = tl?.box ?? null;
      const lb = ll?.box ?? null;
      boxesRef.current = {text: tb, logo: lb, textContent: tl?.content ?? null, logoContent: ll?.content ?? null};
      const sel = selectedRef.current;
      const show = d?.target ?? hoverRef.current;
      const box = show && show !== sel ? (show === 'text' ? tb : lb) : null;
      if (box) {
        ctx.save();
        ctx.setLineDash([10, 8]);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.strokeRect(box.x, box.y, box.w, box.h);
        ctx.restore();
      }
      // 선택 상자: 실선 + 모서리 손잡이 + ×
      const selBox = sel === 'text' ? tb : sel === 'logo' ? lb : null;
      if (selBox) {
        ctx.save();
        ctx.setLineDash([]);
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#ffffff';
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 6;
        ctx.strokeRect(selBox.x, selBox.y, selBox.w, selBox.h);
        ctx.shadowBlur = 0;
        for (const c of Object.values(corners(selBox))) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(c.x - HANDLE / 2, c.y - HANDLE / 2, HANDLE, HANDLE);
          ctx.strokeStyle = '#2f6bff';
          ctx.lineWidth = 3;
          ctx.strokeRect(c.x - HANDLE / 2, c.y - HANDLE / 2, HANDLE, HANDLE);
        }
        const cp = closePos(selBox);
        ctx.fillStyle = '#1d1c1a';
        ctx.beginPath();
        ctx.arc(cp.x, cp.y, CLOSE_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cp.x - 9, cp.y - 9);
        ctx.lineTo(cp.x + 9, cp.y + 9);
        ctx.moveTo(cp.x + 9, cp.y - 9);
        ctx.lineTo(cp.x - 9, cp.y + 9);
        ctx.stroke();
        ctx.restore();
      }
      // PPT 식 정렬 안내선
      if (d && (d.guides.v.length || d.guides.h.length)) {
        ctx.save();
        ctx.strokeStyle = '#ff3d7f';
        ctx.lineWidth = 3;
        ctx.setLineDash([]);
        for (const gx of d.guides.v) {
          ctx.beginPath();
          ctx.moveTo(gx, 0);
          ctx.lineTo(gx, H);
          ctx.stroke();
        }
        for (const gy of d.guides.h) {
          ctx.beginPath();
          ctx.moveTo(0, gy);
          ctx.lineTo(W, gy);
          ctx.stroke();
        }
        ctx.restore();
      }

      if (now - lastUi > 80) {
        lastUi = now;
        setShownSec(currentSec());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 화면 좌표 → 1080×1920 좌표 */
  const toStage = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return {x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H};
  };
  const hit = (x: number, y: number): DragTarget | null => {
    const b = boxesRef.current;
    if (b.logo && inside(b.logo, x, y)) return 'logo';
    if (b.text && inside(b.text, x, y)) return 'text';
    return null;
  };

  /** 선택된 요소의 × / 모서리 손잡이 판정 */
  const hitHandle = (x: number, y: number): 'close' | Corner | null => {
    const sel = selectedRef.current;
    const b = sel === 'text' ? boxesRef.current.text : sel === 'logo' ? boxesRef.current.logo : null;
    if (!b) return null;
    const cp = closePos(b);
    if (Math.hypot(x - cp.x, y - cp.y) <= CLOSE_R + 8) return 'close';
    for (const [k, c] of Object.entries(corners(b)) as Array<[Corner, {x: number; y: number}]>) {
      if (Math.abs(x - c.x) <= HANDLE && Math.abs(y - c.y) <= HANDLE) return k;
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const {x, y} = toStage(e);
    const p = propsRef.current;
    const b = boxesRef.current;
    const handle = hitHandle(x, y);
    if (handle === 'close') {
      const sel = selectedRef.current;
      selectedRef.current = null;
      if (sel === 'text') actionsRef.current.onDeleteText();
      else if (sel === 'logo') actionsRef.current.onDeleteLogo();
      return;
    }
    const target = handle ? selectedRef.current! : hit(x, y);
    if (!target) {
      selectedRef.current = null;
      return;
    }
    selectedRef.current = target;
    const base = (target === 'logo' ? p.project.brand.logoOffset : p.slide?.textOffset) ?? {x: 0, y: 0};
    const content = (target === 'logo' ? b.logoContent : b.textContent) ?? {x, y, w: 1, h: 1};
    const other = target === 'logo' ? b.textContent : b.logoContent;
    const baseScale = (target === 'logo' ? p.project.brand.logoScale : p.slide?.textScale) ?? 1;
    const center = {x: content.x + content.w / 2, y: content.y + content.h / 2};
    dragRef.current = {
      mode: handle ? 'scale' : 'move',
      target,
      baseScale,
      center,
      startDist: Math.max(10, Math.hypot(x - center.x, y - center.y)),
      scale: baseScale,
      startX: x,
      startY: y,
      base,
      now: base,
      content,
      other,
      guides: {v: [], h: []},
    };
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      /* 일부 환경(합성 이벤트)에서는 캡처가 안 될 수 있음 */
    }
    setCursor('grabbing');
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const {x, y} = toStage(e);
    const d = dragRef.current;
    if (d?.mode === 'scale') {
      // 중심에서 멀어지면 커지고 가까워지면 작아짐
      const ratio = Math.hypot(x - d.center.x, y - d.center.y) / d.startDist;
      const max = d.target === 'logo' ? 4 : 3;
      d.scale = Math.round(Math.max(0.3, Math.min(max, d.baseScale * ratio)) * 100) / 100;
      return;
    }
    if (d) {
      let dx = x - d.startX;
      let dy = y - d.startY;
      d.guides = {v: [], h: []};
      if (!e.altKey) {
        // 가운데·여백·다른 요소에 가까우면 붙이기 (Alt 를 누르면 끔)
        const moved = {...d.content, x: d.content.x + dx, y: d.content.y + dy};
        const targets = mergeTargets(stageTargets(W, H), d.other ? rectTargets(d.other) : {v: [], h: []});
        const snap = snapRect(moved, targets, 16);
        dx += snap.dx;
        dy += snap.dy;
        d.guides = snap.guides;
      }
      const nx = Math.round(d.base.x + dx);
      const ny = Math.round(d.base.y + dy);
      d.now = {x: Math.max(-W, Math.min(W, nx)), y: Math.max(-H, Math.min(H, ny))};
      return;
    }
    const hd = hitHandle(x, y);
    if (hd) {
      hoverRef.current = selectedRef.current;
      setCursor(hd === 'close' ? 'pointer' : hd === 'nw' || hd === 'se' ? 'nwse-resize' : 'nesw-resize');
      return;
    }
    const h = hit(x, y);
    hoverRef.current = h;
    setCursor(h ? 'grab' : 'default');
  };
  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setCursor(hoverRef.current ? 'grab' : 'default');
    if (!d) return;
    const a = actionsRef.current;
    if (d.mode === 'scale') {
      if (d.scale === d.baseScale) return;
      if (d.target === 'logo') a.onScaleLogo(d.scale);
      else a.onScaleText(d.scale);
      return;
    }
    if (d.now.x === d.base.x && d.now.y === d.base.y) return;
    if (d.target === 'logo') a.onMoveLogo(d.now);
    else a.onMoveText(d.now);
  };

  return (
    <div className="preview">
      <div className="phone">
        <canvas
          ref={canvasRef}
          className="preview-canvas"
          width={Math.round(W * PREVIEW_SCALE)}
          height={Math.round(H * PREVIEW_SCALE)}
          style={{cursor, touchAction: 'none'}}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => {
            if (!dragRef.current) {
              hoverRef.current = null;
              setCursor('default');
            }
          }}
        />
      </div>
      <div className="transport">
        <button type="button" className="play" onClick={togglePlay} aria-label={playing ? '일시정지' : '재생'}>
          {playing ? (
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
              <rect x="3" y="2" width="3.5" height="12" rx="1" fill="currentColor" />
              <rect x="9.5" y="2" width="3.5" height="12" rx="1" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
              <path d="M4 2.5v11l9-5.5z" fill="currentColor" />
            </svg>
          )}
        </button>
        <input
          type="range"
          min={0}
          max={SLIDE_SEC}
          step={0.01}
          value={shownSec}
          onChange={(e) => {
            if (clockRef.current.playing) togglePlay();
            seek(Number(e.target.value));
          }}
          aria-label="재생 위치"
        />
        <span className="time">{shownSec.toFixed(1)}s</span>
      </div>
      <p className="preview-hint">제목·로고를 누르면 선택됩니다. 끌어서 옮기고, 모서리로 크기, ×로 지우기. Alt = 자유 이동.</p>
    </div>
  );
}
