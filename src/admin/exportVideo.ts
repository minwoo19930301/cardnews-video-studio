/**
 * 브라우저 내보내기: 엔진으로 프레임을 그리면서 바로 인코딩한다.
 * (프레임을 메모리에 쌓지 않아 8장 전체도 버틴다)
 */
import {GIFEncoder, quantize, applyPalette} from 'gifenc';
import {ArrayBufferTarget, Muxer} from 'mp4-muxer';
import {loadHtmlImage, loadMedia, type LoadedMedia} from './media';
import {fontCss, type Project, type Slide} from './types';
import {drawFrame, FPS, H, SLIDE_SEC, W, type FrameMedia} from '../engine/render';

export {SLIDE_SEC};

/** 로드된 이미지/비디오 → 엔진이 그릴 수 있는 프레임 */
export function toFrameMedia(media: LoadedMedia | null): FrameMedia {
  if (!media) return null;
  if (media.type === 'image') {
    const el = media.el;
    return {source: el, width: el.naturalWidth || el.width, height: el.naturalHeight || el.height};
  }
  const el = media.el;
  if (!el.videoWidth) return null;
  return {source: el, width: el.videoWidth, height: el.videoHeight};
}

/** 로고 이미지 로드 (없으면 null → 글자 로고) */
export async function loadLogo(src?: string): Promise<FrameMedia> {
  if (!src) return null;
  const el = await loadHtmlImage(src);
  return el ? {source: el, width: el.naturalWidth || el.width, height: el.naturalHeight || el.height} : null;
}

/** 캔버스는 웹폰트를 스스로 불러오지 않으므로 쓰는 글꼴을 미리 받아 둔다 */
export async function ensureFonts(project: Project): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const families = new Set([project.fontFamily, ...project.slides.map((s) => s.fontFamily || project.fontFamily)]);
  const jobs: Array<Promise<unknown>> = [];
  for (const id of families) {
    const css = fontCss(id);
    for (const spec of ['800 64px', '700 28px', '600 28px', '500 34px']) {
      jobs.push(document.fonts.load(`${spec} ${css}`, '가나다ABC123').catch(() => undefined));
    }
  }
  await Promise.all(jobs);
}

export type ExportFormat = 'mp4' | 'gif' | 'webm';
export type ExportSegment = {kind: 'slide'; index: number} | {kind: 'full'};
export type ExportProgress = {phase: string; pct: number};

type Job = {slide: Slide; media: LoadedMedia | null; slideIndex: number; label: string; prev: Job | null};

function buildJobs(segment: ExportSegment, slides: Slide[], medias: Array<LoadedMedia | null>): Job[] {
  const n = slides.length;
  if (segment.kind === 'slide') {
    const i = segment.index;
    if (i < 0 || i >= n) throw new Error('잘못된 슬라이드');
    // 한 장만 저장해도 앞 장과 이어지는 전환은 그대로 보이게
    const prev = i > 0 ? {slide: slides[i - 1], media: medias[i - 1], slideIndex: i, label: '', prev: null} : null;
    return [{slide: slides[i], media: medias[i], slideIndex: i + 1, label: `${i + 1}장`, prev}];
  }
  const jobs: Job[] = [];
  slides.forEach((s, i) => jobs.push({slide: s, media: medias[i], slideIndex: i + 1, label: `${i + 1}/${n}장`, prev: jobs[i - 1] ?? null}));
  return jobs;
}

const FRAMES_PER_SLIDE = Math.round(SLIDE_SEC * FPS);

/** 프레임을 하나씩 그려 onFrame 에 넘긴다 */
async function renderEach(
  ctx: CanvasRenderingContext2D,
  project: Project,
  jobs: Job[],
  logo: FrameMedia,
  slideTotal: number,
  onFrame: (index: number) => Promise<void> | void,
  onProgress?: (p: ExportProgress) => void,
) {
  const total = jobs.length * FRAMES_PER_SLIDE;
  let done = 0;
  for (const job of jobs) {
    for (let f = 0; f < FRAMES_PER_SLIDE; f++) {
      const anim = f / (FRAMES_PER_SLIDE - 1);
      if (job.media?.type === 'video') {
        const el = job.media.el;
        const t = (f / FPS) % Math.max(0.2, el.duration || 4);
        if (Math.abs(el.currentTime - t) > 0.02) {
          el.currentTime = t;
          await new Promise<void>((r) => {
            const fin = () => {
              el.removeEventListener('seeked', fin);
              r();
            };
            el.addEventListener('seeked', fin);
            setTimeout(fin, 60);
          });
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      drawFrame(ctx, {
        project,
        slide: job.slide,
        anim,
        media: toFrameMedia(job.media),
        logo,
        slideIndex: job.slideIndex,
        slideTotal,
        prev: job.prev ? {slide: job.prev.slide, media: toFrameMedia(job.prev.media), slideIndex: job.prev.slideIndex} : null,
      });
      await onFrame(done);
      done += 1;
      if (done % 6 === 0 || done === total) {
        onProgress?.({phase: job.label, pct: Math.min(98, Math.round((done / total) * 98))});
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }
}

function pickWebmMime(): string {
  for (const m of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
  }
  return 'video/webm';
}

/** H.264 코덱 후보 — 세로 1080×1920 은 Level 4.0 이상 필요 */
const H264_CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.420028', 'avc1.64001f', 'avc1.4d001f'];

async function resolveH264Config(): Promise<VideoEncoderConfig | null> {
  if (typeof VideoEncoder === 'undefined') return null;
  const base = {width: W, height: H, bitrate: 10_000_000, framerate: FPS, avc: {format: 'avc' as const}};
  if (typeof VideoEncoder.isConfigSupported !== 'function') return {codec: H264_CODECS[0], ...base};
  for (const codec of H264_CODECS) {
    for (const hw of ['prefer-hardware', 'prefer-software', 'no-preference'] as const) {
      const cfg: VideoEncoderConfig = {codec, ...base, latencyMode: 'quality', hardwareAcceleration: hw};
      try {
        const {supported} = await VideoEncoder.isConfigSupported(cfg);
        if (supported) return cfg;
      } catch {
        /* try next */
      }
    }
  }
  return null;
}

type Ctx = {canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D};
type RenderFn = (onFrame: (i: number) => Promise<void> | void) => Promise<void>;

async function encodeMp4({canvas}: Ctx, render: RenderFn): Promise<Blob | null> {
  const cfg = await resolveH264Config();
  if (!cfg) return null;
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {codec: 'avc', width: W, height: H},
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  let err: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      try {
        muxer.addVideoChunk(chunk, meta);
      } catch (e) {
        err = e instanceof Error ? e : new Error(String(e));
      }
    },
    error: (e) => {
      err = e instanceof Error ? e : new Error(String(e));
    },
  });
  encoder.configure(cfg);
  const frameDur = Math.round(1_000_000 / FPS);
  try {
    await render(async (i) => {
      if (err) throw err;
      while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 4));
      const frame = new VideoFrame(canvas, {timestamp: i * frameDur, duration: frameDur});
      try {
        encoder.encode(frame, {keyFrame: i % 30 === 0});
      } finally {
        frame.close();
      }
    });
    await encoder.flush();
    encoder.close();
    if (err) throw err;
    muxer.finalize();
    if (target.buffer.byteLength < 1000) throw new Error('MP4 버퍼가 비어 있습니다');
    return new Blob([target.buffer], {type: 'video/mp4'});
  } catch (e) {
    console.warn('mp4 encode failed, fallback webm', e);
    try {
      if (encoder.state !== 'closed') encoder.close();
    } catch {
      /* ignore */
    }
    return null;
  }
}

async function encodeGif({canvas}: Ctx, render: RenderFn): Promise<Blob> {
  const scale = 0.4;
  const gw = Math.round(W * scale);
  const gh = Math.round(H * scale);
  const small = document.createElement('canvas');
  small.width = gw;
  small.height = gh;
  const sctx = small.getContext('2d', {willReadFrequently: true})!;
  const gif = GIFEncoder();
  const step = Math.max(1, Math.round(FPS / 10)); // 약 10fps
  const delay = Math.round((1000 * step) / FPS);
  await render((i) => {
    if (i % step) return;
    sctx.drawImage(canvas, 0, 0, gw, gh);
    const data = sctx.getImageData(0, 0, gw, gh);
    const palette = quantize(data.data, 256);
    gif.writeFrame(applyPalette(data.data, palette), gw, gh, {palette, delay});
  });
  gif.finish();
  const bytes = gif.bytes();
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], {type: 'image/gif'});
}

/** WebM 은 MediaRecorder 가 실시간으로 녹화하므로 프레임마다 1/30초씩 기다린다 */
async function encodeWebm({canvas}: Ctx, render: RenderFn): Promise<Blob> {
  const stream = canvas.captureStream(FPS);
  const chunks: BlobPart[] = [];
  const rec = new MediaRecorder(stream, {mimeType: pickWebmMime(), videoBitsPerSecond: 10_000_000});
  rec.ondataavailable = (e) => {
    if (e.data?.size) chunks.push(e.data);
  };
  const done = new Promise<Blob>((resolve, reject) => {
    rec.onstop = () => resolve(new Blob(chunks, {type: 'video/webm'}));
    rec.onerror = () => reject(new Error('webm 인코딩 실패'));
  });
  rec.start(100);
  let last = performance.now();
  await render(async () => {
    const wait = 1000 / FPS - (performance.now() - last);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = performance.now();
  });
  await new Promise((r) => setTimeout(r, 120));
  rec.stop();
  stream.getTracks().forEach((t) => t.stop());
  return done;
}

export async function exportSegment(
  project: Project,
  segment: ExportSegment,
  format: ExportFormat,
  onProgress?: (p: ExportProgress) => void,
): Promise<{blob: Blob; filename: string; note?: string}> {
  const slides = project.slides.filter((s) => s.image || s.title || s.text).slice(0, 8);
  if (slides.length === 0) throw new Error('내보낼 장이 없습니다');
  if (segment.kind === 'slide' && (segment.index < 0 || segment.index >= slides.length)) {
    throw new Error('장 번호 오류');
  }

  onProgress?.({phase: '글꼴·미디어 준비', pct: 1});
  await ensureFonts(project);
  const medias: Array<LoadedMedia | null> = [];
  for (const s of slides) medias.push(await loadMedia(s.image, s.mediaKind));
  const logo = await loadLogo(project.brand.logoImage);

  const jobs = buildJobs(segment, slides, medias);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', {alpha: false, willReadFrequently: format === 'gif'});
  if (!ctx) throw new Error('Canvas 를 쓸 수 없습니다');
  const target: Ctx = {canvas, ctx};
  const render: RenderFn = (onFrame) => renderEach(ctx, project, jobs, logo, slides.length, onFrame, onProgress);

  let blob: Blob;
  let ext: ExportFormat = format;
  let note: string | undefined;
  if (format === 'gif') {
    blob = await encodeGif(target, render);
  } else if (format === 'mp4') {
    const mp4 = await encodeMp4(target, render);
    if (mp4) blob = mp4;
    else {
      onProgress?.({phase: 'MP4 미지원 → WebM', pct: 0});
      blob = await encodeWebm(target, render);
      ext = 'webm';
      note = '이 브라우저에서 MP4(H.264) 인코딩이 안 돼 WebM 으로 저장했습니다. Chrome/Edge 를 권장합니다.';
    }
  } else {
    blob = await encodeWebm(target, render);
  }

  onProgress?.({phase: '완료', pct: 100});
  const base = segment.kind === 'slide' ? `cardnews-${segment.index + 1}` : 'cardnews-all';
  return {blob, filename: `${base}-${Date.now()}.${ext}`, note};
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
