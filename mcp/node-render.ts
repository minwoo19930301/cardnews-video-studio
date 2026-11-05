/**
 * Node 에서 카드뉴스를 렌더한다 (MCP 서버 · CLI 공용).
 * 그리기는 브라우저와 같은 src/engine/render.ts 를 쓰고, 캔버스는 skia-canvas, 인코딩은 ffmpeg.
 */
import {existsSync, mkdirSync, readdirSync} from 'node:fs';
import {hasFfmpeg, openEncoder, VideoReader} from './ffmpeg';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Canvas, FontLibrary, loadImage} from 'skia-canvas';
import {drawFrame, FPS, H, SLIDE_SEC, W, type FrameMedia} from '../src/engine/render';
import {createDefaultProject, makeId, MAX_SLIDES, type Project, type Slide} from '../src/admin/types';

/** 저장소 루트 (mcp/dist/server.mjs 또는 mcp/*.ts 어디서 실행돼도) */
export const REPO_ROOT = (() => {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++) {
    if (existsSync(path.join(dir, 'package.json')) && existsSync(path.join(dir, 'src', 'engine'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
})();

export const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'out');

/* ---------------- 글꼴 ---------------- */

let fontsReady = false;
/** public/fonts 와 CARDNEWS_FONT_DIR 의 글꼴을 등록. 나머지는 시스템 글꼴로 대체된다. */
export function registerFonts(): string[] {
  if (fontsReady) return [...FontLibrary.families];
  const dirs = [path.join(REPO_ROOT, 'public', 'fonts'), process.env.CARDNEWS_FONT_DIR].filter(Boolean) as string[];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir)
      .filter((f) => /\.(ttf|otf|woff2?)$/i.test(f))
      .map((f) => path.join(dir, f));
    if (!files.length) continue;
    try {
      FontLibrary.use(files);
    } catch (e) {
      console.error('[fonts] register failed', dir, e);
    }
  }
  fontsReady = true;
  return [...FontLibrary.families];
}

/* ---------------- 프로젝트 ---------------- */

/** 'full' = 모든 장, 숫자 = 그 장만 (1부터) */
export type Segment = 'full' | number;

/** 느슨한 입력 → 렌더 가능한 Project (빠진 값은 기본값) */
export function normalizeProject(input: Partial<Project> & {slides?: Array<Partial<Slide>>}): Project {
  const base = createDefaultProject();
  const slides = (input.slides ?? []).slice(0, MAX_SLIDES).map((s, i) => ({
    id: s.id || makeId('slide'),
    image: s.image || '',
    title: s.title || '',
    text: s.text || '',
    pos: s.pos || (['bl', 'tr', 'br', 'tl'] as const)[i % 4],
    mediaKind: s.mediaKind || (/\.(mp4|webm|mov)(\?|$)/i.test(s.image || '') ? 'video' : 'image'),
    fontFamily: s.fontFamily,
    chipText: s.chipText ?? '',
    photoEffect: s.photoEffect || 'none',
    textEnter: s.textEnter || 'fade-up',
    transition: s.transition || 'cut',
    accentColor: s.accentColor,
    textColor: s.textColor,
    chipColor: s.chipColor,
    highlightColor: s.highlightColor,
    shade: s.shade,
    showChip: s.showChip,
    textOffset: s.textOffset,
    textScale: s.textScale,
    backdrop: s.backdrop,
    backdropColor: s.backdropColor,
    backdropOpacity: s.backdropOpacity,
  })) as Slide[];
  return {
    title: input.title ?? base.title,
    brand: {...base.brand, ...(input.brand ?? {})},
    fontFamily: input.fontFamily || base.fontFamily,
    slides: slides.filter((s) => s.image || s.title || s.text),
  };
}

/* ---------------- 미디어 ---------------- */

function resolveMediaPath(src: string, baseDir?: string): string {
  if (!src || /^(https?:|data:)/i.test(src)) return src;
  if (path.isAbsolute(src) && existsSync(src)) return src;
  const rel = src.replace(/^\.?\//, '');
  const candidates = [baseDir && path.resolve(baseDir, rel), path.join(REPO_ROOT, 'public', rel), path.resolve(rel)];
  for (const c of candidates) if (c && existsSync(c)) return c;
  throw new Error(`미디어 파일을 찾을 수 없습니다: ${src}`);
}

type MediaSource = {
  /** 슬라이드 안 f 번째 프레임에 그릴 미디어 */
  frame(f: number): Promise<FrameMedia>;
  close(): void;
};

async function openStill(file: string): Promise<MediaSource> {
  const img = await loadImage(file);
  const fm = {source: img as unknown as CanvasImageSource, width: img.width, height: img.height};
  return {frame: async () => fm, close: () => undefined};
}

/** 영상은 ffmpeg 로 30fps 프레임을 순서대로 읽는다 (짧으면 반복) */
function openVideo(file: string): MediaSource {
  const reader = new VideoReader(file, FPS, {width: 720});
  return {frame: (f) => reader.frameAt(f), close: () => reader.close()};
}

async function openMedia(slide: Slide, baseDir?: string): Promise<MediaSource | null> {
  if (!slide.image) return null;
  const file = resolveMediaPath(slide.image, baseDir);
  if (slide.mediaKind === 'video') {
    if (/^(https?:|data:)/i.test(file)) throw new Error('영상은 로컬 파일 경로만 지원합니다');
    return openVideo(file);
  }
  return openStill(file);
}

/* ---------------- 타임라인 ---------------- */

type Job = {slide: Slide; slideIndex: number; frames: number};
const FRAMES_PER_SLIDE = Math.round(SLIDE_SEC * FPS);

function buildJobs(project: Project, segment: Segment): Job[] {
  const n = project.slides.length;
  if (n === 0) throw new Error('장이 없습니다 (제목·문구·미디어 중 하나는 필요)');
  if (typeof segment === 'number') {
    if (segment < 1 || segment > n) throw new Error(`장 번호는 1~${n} 사이여야 합니다`);
    return [{slide: project.slides[segment - 1], slideIndex: segment, frames: FRAMES_PER_SLIDE}];
  }
  return project.slides.map((s, i) => ({slide: s, slideIndex: i + 1, frames: FRAMES_PER_SLIDE}));
}

/** 프레임을 복사해 둔다 (영상 디코더 캔버스는 계속 덮어써지므로) */
function snapshot(fm: FrameMedia): FrameMedia {
  if (!fm) return null;
  const c = new Canvas(fm.width, fm.height);
  c.getContext('2d').drawImage(fm.source as never, 0, 0);
  return {source: c as unknown as CanvasImageSource, width: fm.width, height: fm.height};
}

/** 앞 장의 마지막 프레임 */
async function lastFrameOf(slide: Slide, slideIndex: number, baseDir?: string) {
  const m = await openMedia(slide, baseDir);
  try {
    return {slide, media: m ? snapshot(await m.frame(FRAMES_PER_SLIDE - 1)) : null, slideIndex};
  } finally {
    m?.close();
  }
}

async function openLogo(project: Project, baseDir?: string): Promise<FrameMedia> {
  const src = project.brand.logoImage;
  if (!src) return null;
  const img = await loadImage(resolveMediaPath(src, baseDir));
  return {source: img as unknown as CanvasImageSource, width: img.width, height: img.height};
}

export function segmentDurationSec(project: Project, segment: Segment): number {
  return buildJobs(project, segment).reduce((s, j) => s + j.frames, 0) / FPS;
}

function newCanvas() {
  const canvas = new Canvas(W, H);
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  return {canvas, ctx};
}

/* ---------------- 출력 ---------------- */

export type RenderOptions = {baseDir?: string; onProgress?: (done: number, total: number) => void};

/** MP4 (H.264, yuv420p, 30fps) 로 저장 */
export async function renderVideo(
  project: Project,
  segment: Segment,
  outPath: string,
  opts: RenderOptions = {},
): Promise<{path: string; seconds: number; frames: number}> {
  registerFonts();
  mkdirSync(path.dirname(outPath), {recursive: true});
  const jobs = buildJobs(project, segment);
  for (const j of jobs) if (j.slide.image) resolveMediaPath(j.slide.image, opts.baseDir);
  const logo = await openLogo(project, opts.baseDir);
  const total = jobs.reduce((s, j) => s + j.frames, 0);
  const {ctx} = newCanvas();

  const enc = openEncoder(outPath, W, H, FPS);

  let done = 0;
  const slideTotal = Math.max(1, project.slides.length);
  // 전환 때 겹쳐 그릴 앞 장 마지막 프레임
  let prev: {slide: Slide; media: FrameMedia; slideIndex: number} | null =
    jobs[0].slideIndex > 1 ? await lastFrameOf(project.slides[jobs[0].slideIndex - 2], jobs[0].slideIndex - 1, opts.baseDir) : null;
  try {
    for (const job of jobs) {
      const media = await openMedia(job.slide, opts.baseDir);
      try {
        for (let f = 0; f < job.frames; f++) {
          const anim = f / (job.frames - 1);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          drawFrame(ctx, {
            project,
            slide: job.slide,
            anim,
            media: media ? await media.frame(f) : null,
            logo,
            slideIndex: job.slideIndex,
            slideTotal,
            prev,
          });
          await enc.write(ctx.getImageData(0, 0, W, H).data);
          done += 1;
          if (done % 15 === 0 || done === total) opts.onProgress?.(done, total);
        }
        prev = {slide: job.slide, media: media ? snapshot(await media.frame(job.frames - 1)) : null, slideIndex: job.slideIndex};
      } finally {
        media?.close();
      }
    }
  } catch (e) {
    enc.abort();
    throw e;
  }
  await enc.finish();
  return {path: outPath, seconds: total / FPS, frames: total};
}

/** 특정 장의 특정 시점 한 프레임 (초는 그 장 안에서의 시간) */
export async function renderStill(project: Project, slideNo: number, timeSec: number, opts: RenderOptions = {}): Promise<Canvas> {
  registerFonts();
  const [job] = buildJobs(project, slideNo);
  const {canvas, ctx} = newCanvas();
  const f = Math.min(job.frames - 1, Math.max(0, Math.round(timeSec * FPS)));
  const media = await openMedia(job.slide, opts.baseDir);
  const logo = await openLogo(project, opts.baseDir);
  const prev = slideNo > 1 ? await lastFrameOf(project.slides[slideNo - 2], slideNo - 1, opts.baseDir) : null;
  try {
    drawFrame(ctx, {
      prev,
      project,
      slide: job.slide,
      anim: f / (job.frames - 1),
      media: media ? await media.frame(f) : null,
      logo,
      slideIndex: job.slideIndex,
      slideTotal: Math.max(1, project.slides.length),
    });
  } finally {
    media?.close();
  }
  return canvas;
}

/** 여러 시점을 한 장에 모은 확인용 시트 */
export async function renderContactSheet(
  project: Project,
  segment: number,
  times: number[],
  opts: RenderOptions & {columns?: number; thumbWidth?: number} = {},
): Promise<Canvas> {
  const cols = Math.max(1, Math.min(opts.columns ?? 4, times.length));
  const tw = opts.thumbWidth ?? 270;
  const th = Math.round((tw * H) / W);
  const rows = Math.ceil(times.length / cols);
  const sheet = new Canvas(cols * tw, rows * (th + 28));
  const sx = sheet.getContext('2d');
  sx.fillStyle = '#111';
  sx.fillRect(0, 0, sheet.width, sheet.height);
  for (let i = 0; i < times.length; i++) {
    const still = await renderStill(project, segment, times[i], opts);
    const x = (i % cols) * tw;
    const y = Math.floor(i / cols) * (th + 28);
    sx.drawImage(still, x, y + 28, tw, th);
    sx.fillStyle = '#ffe14d';
    sx.font = '600 18px sans-serif';
    sx.fillText(`${times[i].toFixed(2)}s`, x + 8, y + 20);
  }
  return sheet;
}

export {hasFfmpeg};
