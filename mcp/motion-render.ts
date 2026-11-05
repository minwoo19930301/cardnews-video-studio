/**
 * 자유 모션 렌더 (Node): 장면 JSON 또는 그리기 코드 → 영상/이미지.
 * 카드뉴스 틀과 무관하다. 크기·길이·fps 를 마음대로 정한다.
 */
import {existsSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {Canvas, loadImage} from 'skia-canvas';
import * as easing from '../src/engine/easing';
import {drawScene, sceneMedia, sceneSize, type MediaLayer, type Scene, type SceneFrame} from '../src/engine/scene';
import {openEncoder, VideoReader} from './ffmpeg';
import {REPO_ROOT, registerFonts} from './node-render';

export type RenderOpts = {baseDir?: string; audio?: string; onProgress?: (done: number, total: number) => void};

function resolvePath(src: string, baseDir?: string): string {
  if (/^(https?:|data:)/i.test(src)) return src;
  if (path.isAbsolute(src) && existsSync(src)) return src;
  const rel = src.replace(/^\.?\//, '');
  for (const c of [baseDir && path.resolve(baseDir, rel), path.join(REPO_ROOT, 'public', rel), path.resolve(rel)]) {
    if (c && existsSync(c)) return c;
  }
  throw new Error(`파일을 찾을 수 없습니다: ${src}`);
}

/** 장면에 쓰인 이미지·영상을 미리 연다 */
async function openSceneMedia(scene: Scene, fps: number, baseDir?: string) {
  const images = new Map<string, SceneFrame>();
  const videos = new Map<MediaLayer, VideoReader>();
  for (const L of sceneMedia(scene)) {
    const file = resolvePath(L.src, baseDir);
    if (L.type === 'image') {
      if (!images.has(L.src)) {
        const img = await loadImage(file);
        images.set(L.src, {source: img as unknown as CanvasImageSource, width: img.width, height: img.height});
      }
    } else {
      if (/^(https?:|data:)/i.test(file)) throw new Error('영상은 로컬 파일만 됩니다');
      videos.set(L, new VideoReader(file, fps, {width: Math.min(1280, L.width ?? 1080), startSec: L.trimStart, loop: L.loop !== false}));
    }
  }
  return {
    images,
    videos,
    close: () => videos.forEach((v) => v.close()),
  };
}

/** 프레임 f 에 필요한 영상 프레임을 먼저 받아 두고, 그리기용 공급자를 만든다 */
async function providerAt(m: Awaited<ReturnType<typeof openSceneMedia>>, scene: Scene, t: number, fps: number) {
  const vframes = new Map<MediaLayer, SceneFrame>();
  for (const [L, reader] of m.videos) {
    const start = L.start ?? 0;
    const end = L.end ?? scene.duration;
    if (t < start || t > end) continue;
    vframes.set(L, await reader.frameAt(Math.max(0, Math.round((t - start) * fps))));
  }
  return (src: string, _local: number, layer: MediaLayer): SceneFrame =>
    layer.type === 'video' ? (vframes.get(layer) ?? null) : (m.images.get(src) ?? null);
}

export function validateScene(scene: Scene) {
  if (!scene || typeof scene.duration !== 'number' || scene.duration <= 0) throw new Error('duration(초)이 필요합니다');
  if (scene.duration > 600) throw new Error('최대 600초까지 렌더합니다');
  const {W, H, fps} = sceneSize(scene);
  if (W < 16 || H < 16 || W > 4096 || H > 4096) throw new Error('width/height 는 16~4096 사이여야 합니다');
  if (W % 2 || H % 2) throw new Error('width/height 는 짝수여야 합니다 (H.264 제약)');
  if (fps < 1 || fps > 60) throw new Error('fps 는 1~60 사이여야 합니다');
  if (!Array.isArray(scene.layers)) throw new Error('layers 배열이 필요합니다');
}

export async function renderSceneVideo(scene: Scene, outPath: string, opts: RenderOpts = {}) {
  validateScene(scene);
  registerFonts();
  const {W, H, fps} = sceneSize(scene);
  const total = Math.max(1, Math.round(scene.duration * fps));
  const media = await openSceneMedia(scene, fps, opts.baseDir);
  const enc = openEncoder(outPath, W, H, fps, {audio: opts.audio && resolvePath(opts.audio, opts.baseDir)});
  const canvas = new Canvas(W, H);
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  try {
    for (let f = 0; f < total; f++) {
      const t = f / fps;
      const provider = await providerAt(media, scene, t, fps);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      drawScene(ctx, scene, t, provider);
      await enc.write(ctx.getImageData(0, 0, W, H).data);
      if (f % 15 === 0 || f === total - 1) opts.onProgress?.(f + 1, total);
    }
  } catch (e) {
    enc.abort();
    media.close();
    throw e;
  }
  media.close();
  await enc.finish();
  return {path: outPath, seconds: total / fps, frames: total, width: W, height: H, fps};
}

export async function renderSceneStill(scene: Scene, t: number, opts: RenderOpts = {}): Promise<Canvas> {
  validateScene(scene);
  registerFonts();
  const {W, H, fps} = sceneSize(scene);
  const media = await openSceneMedia(scene, fps, opts.baseDir);
  try {
    const canvas = new Canvas(W, H);
    const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
    drawScene(ctx, scene, Math.min(Math.max(0, t), scene.duration), await providerAt(media, scene, t, fps));
    return canvas;
  } finally {
    media.close();
  }
}

/** 여러 시점을 한 장에 */
export async function contactSheet(
  size: {W: number; H: number},
  times: number[],
  still: (t: number) => Promise<Canvas>,
  columns = 4,
): Promise<Canvas> {
  const cols = Math.max(1, Math.min(columns, times.length));
  const tw = 270;
  const th = Math.round((tw * size.H) / size.W);
  const rows = Math.ceil(times.length / cols);
  const sheet = new Canvas(cols * tw, rows * (th + 28));
  const sx = sheet.getContext('2d');
  sx.fillStyle = '#111';
  sx.fillRect(0, 0, sheet.width, sheet.height);
  for (let i = 0; i < times.length; i++) {
    const c = await still(times[i]);
    const x = (i % cols) * tw;
    const y = Math.floor(i / cols) * (th + 28);
    sx.drawImage(c, x, y + 28, tw, th);
    sx.fillStyle = '#ffe14d';
    sx.font = '600 18px sans-serif';
    sx.fillText(`${times[i].toFixed(2)}s`, x + 8, y + 20);
  }
  return sheet;
}

/* ---------------- 코드 모드 ---------------- */

export type CodeSpec = {
  width?: number;
  height?: number;
  fps?: number;
  duration: number;
  /** function (ctx, t, lib) 의 본문. ctx 는 Canvas 2D, t 는 초, lib 에 W/H/progress/이징/이미지 */
  code: string;
  /** 이름 → 이미지 경로. 코드에서 lib.images.이름 으로 씀 */
  images?: Record<string, string>;
};

type Lib = Record<string, unknown>;

/**
 * 코드를 컴파일한다. node:vm 컨텍스트에서 돌고 프레임마다 시간 제한이 있다.
 * 보안 경계가 아니다 — 로컬에서 내가 쓰는 에이전트용이다.
 */
async function compileCode(spec: CodeSpec, baseDir?: string) {
  const W = spec.width ?? 1080;
  const H = spec.height ?? 1920;
  const images: Record<string, {source: unknown; width: number; height: number}> = {};
  for (const [name, src] of Object.entries(spec.images ?? {})) {
    const img = await loadImage(resolvePath(src, baseDir));
    images[name] = {source: img, width: img.width, height: img.height};
  }
  const sandbox = vm.createContext({Math, Number, String, Array, Object, JSON, console: {log: () => undefined}});
  const script = new vm.Script(`(function (ctx, t, lib) {\n${spec.code}\n})`, {filename: 'motion-code.js'});
  const fn = script.runInContext(sandbox, {timeout: 1000}) as (ctx: unknown, t: number, lib: Lib) => void;
  const lib: Lib = {
    W,
    H,
    duration: spec.duration,
    ...easing,
    images,
    /** 이미지를 cover 로 그리기 */
    cover(ctx: CanvasRenderingContext2D, img: {source: CanvasImageSource; width: number; height: number}, scale = 1) {
      const s = Math.max(W / img.width, H / img.height) * scale;
      ctx.drawImage(img.source, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s);
    },
  };
  const run = new vm.Script('__fn(__ctx, __t, __lib)');
  return (ctx: CanvasRenderingContext2D, t: number) => {
    sandbox.__fn = fn;
    sandbox.__ctx = ctx;
    sandbox.__t = t;
    sandbox.__lib = {...lib, progress: t / spec.duration};
    run.runInContext(sandbox, {timeout: 2000});
  };
}

function validateCode(spec: CodeSpec) {
  validateScene({width: spec.width, height: spec.height, fps: spec.fps, duration: spec.duration, layers: []});
  if (!spec.code || typeof spec.code !== 'string') throw new Error('code 가 필요합니다');
}

export async function renderCodeVideo(spec: CodeSpec, outPath: string, opts: RenderOpts = {}) {
  validateCode(spec);
  registerFonts();
  const W = spec.width ?? 1080;
  const H = spec.height ?? 1920;
  const fps = spec.fps ?? 30;
  const draw = await compileCode(spec, opts.baseDir);
  const total = Math.max(1, Math.round(spec.duration * fps));
  const enc = openEncoder(outPath, W, H, fps, {audio: opts.audio && resolvePath(opts.audio, opts.baseDir)});
  const canvas = new Canvas(W, H);
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  try {
    for (let f = 0; f < total; f++) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      draw(ctx, f / fps);
      ctx.restore();
      await enc.write(ctx.getImageData(0, 0, W, H).data);
      if (f % 15 === 0 || f === total - 1) opts.onProgress?.(f + 1, total);
    }
  } catch (e) {
    enc.abort();
    throw e;
  }
  await enc.finish();
  return {path: outPath, seconds: total / fps, frames: total, width: W, height: H, fps};
}

export async function renderCodeStill(spec: CodeSpec, t: number, opts: RenderOpts = {}): Promise<Canvas> {
  validateCode(spec);
  registerFonts();
  const W = spec.width ?? 1080;
  const H = spec.height ?? 1920;
  const draw = await compileCode(spec, opts.baseDir);
  const canvas = new Canvas(W, H);
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  draw(ctx, Math.min(Math.max(0, t), spec.duration));
  return canvas;
}
