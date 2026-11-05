/**
 * ffmpeg 도우미: 영상 프레임 읽기 / 프레임 묶음을 영상 파일로 쓰기.
 * 카드뉴스 렌더와 자유 장면 렌더가 같이 쓴다.
 */
import {spawn, spawnSync, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {mkdirSync, rmSync} from 'node:fs';
import path from 'node:path';
import {Canvas} from 'skia-canvas';

export type Frame = {source: CanvasImageSource; width: number; height: number};

export function hasFfmpeg(): boolean {
  return spawnSync('ffmpeg', ['-version']).status === 0;
}

export function probeVideo(file: string): {w: number; h: number; duration: number} {
  const r = spawnSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file,
  ]);
  try {
    const j = JSON.parse(String(r.stdout));
    const w = Number(j.streams?.[0]?.width);
    const h = Number(j.streams?.[0]?.height);
    if (!w || !h) throw new Error('size');
    return {w, h, duration: Number(j.format?.duration) || 0};
  } catch {
    throw new Error(`영상 정보를 읽지 못했습니다: ${file}`);
  }
}

/**
 * 영상 프레임을 fps 간격으로 순서대로 읽는다. 뒤로 가면 그 지점부터 다시 연다.
 * frameAt(i) 는 같은 캔버스를 덮어쓰므로 오래 보관하려면 복사해야 한다.
 */
export class VideoReader {
  readonly w: number;
  readonly h: number;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private chunks: Buffer[] = [];
  private queued = 0;
  private ended = false;
  private waiter: (() => void) | null = null;
  private index = -1;
  private base = 0;
  private canvas: Canvas;
  private ctx: ReturnType<Canvas['getContext']>;
  private data: ImageData;
  private current: Frame | null = null;

  constructor(
    private file: string,
    private fps: number,
    private opts: {width?: number; startSec?: number; loop?: boolean} = {},
  ) {
    const src = probeVideo(file);
    this.w = opts.width ?? Math.min(720, src.w);
    this.h = Math.round(((src.h / src.w) * this.w) / 2) * 2;
    this.canvas = new Canvas(this.w, this.h);
    this.ctx = this.canvas.getContext('2d');
    this.data = this.ctx.createImageData(this.w, this.h) as unknown as ImageData;
  }

  private open(fromIndex: number) {
    this.close();
    this.chunks = [];
    this.queued = 0;
    this.ended = false;
    this.index = fromIndex - 1;
    this.base = fromIndex;
    const ss = (this.opts.startSec ?? 0) + fromIndex / this.fps;
    const args = ['-v', 'error'];
    if (this.opts.loop !== false) args.push('-stream_loop', '-1');
    args.push('-ss', ss.toFixed(3), '-i', this.file, '-vf', `scale=${this.w}:${this.h},fps=${this.fps}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-');
    const proc = spawn('ffmpeg', args);
    this.proc = proc;
    const bytes = this.w * this.h * 4;
    proc.stdout.on('data', (c: Buffer) => {
      this.chunks.push(c);
      this.queued += c.length;
      if (this.queued >= bytes * 3) proc.stdout.pause();
      this.waiter?.();
    });
    proc.on('close', () => {
      if (this.proc === proc) this.ended = true;
      this.waiter?.();
    });
  }

  private take(out: Uint8ClampedArray, bytes: number) {
    let off = 0;
    while (off < bytes) {
      const head = this.chunks[0]!;
      const n = Math.min(head.length, bytes - off);
      out.set(head.subarray(0, n), off);
      off += n;
      if (n === head.length) this.chunks.shift();
      else this.chunks[0] = head.subarray(n);
    }
    this.queued -= bytes;
  }

  async frameAt(i: number): Promise<Frame | null> {
    if (!this.proc || i < this.base || i < this.index) this.open(Math.max(0, i));
    const bytes = this.w * this.h * 4;
    while (this.index < i) {
      while (this.queued < bytes && !this.ended) {
        this.proc!.stdout.resume();
        await new Promise<void>((r) => (this.waiter = r));
        this.waiter = null;
      }
      if (this.queued < bytes) return this.current;
      this.take(this.data.data as Uint8ClampedArray, bytes);
      if (this.queued < bytes * 2) this.proc!.stdout.resume();
      this.index += 1;
      if (this.index === i) {
        this.ctx!.putImageData(this.data as never, 0, 0);
        this.current = {source: this.canvas as unknown as CanvasImageSource, width: this.w, height: this.h};
      }
    }
    return this.current;
  }

  close() {
    if (this.proc) {
      const p = this.proc;
      this.proc = null;
      p.kill('SIGKILL');
    }
  }
}

/**
 * RGBA 프레임을 받아 영상 파일로 쓴다. 확장자로 형식 결정: .mp4 / .webm / .gif / .mov(ProRes 4444, 투명)
 * audio 를 주면 영상 길이에 맞춰 함께 넣는다 (mp4/webm/mov).
 */
export function openEncoder(outPath: string, w: number, h: number, fps: number, opts: {audio?: string} = {}) {
  mkdirSync(path.dirname(outPath), {recursive: true});
  const ext = path.extname(outPath).toLowerCase();
  const input = ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-r', String(fps), '-i', '-'];
  const audio = opts.audio && ext !== '.gif' ? ['-i', opts.audio] : [];
  let codec: string[];
  if (ext === '.webm') codec = ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '30', '-pix_fmt', 'yuva420p'];
  else if (ext === '.gif') codec = ['-vf', `fps=${Math.min(fps, 15)},scale=${Math.min(w, 540)}:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse`];
  else if (ext === '.mov') codec = ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le'];
  else codec = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
  const audioCodec = audio.length ? ['-map', '0:v', '-map', '1:a', '-c:a', ext === '.webm' ? 'libopus' : 'aac', '-shortest'] : [];
  const ff = spawn('ffmpeg', [...input, ...audio, ...codec, ...audioCodec, outPath]);
  let err = '';
  ff.stderr.on('data', (d) => (err += String(d)));
  ff.stdin.on('error', () => undefined);
  const finished = new Promise<void>((resolve, reject) => {
    ff.on('error', (e) => reject(new Error(`ffmpeg 실행 실패 (설치 필요): ${e.message}`)));
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg 종료 코드 ${code}: ${err.slice(-400)}`))));
  });
  finished.catch(() => undefined);
  return {
    async write(rgba: Uint8ClampedArray | Buffer) {
      const buf = Buffer.isBuffer(rgba) ? rgba : Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
      if (!ff.stdin.write(buf)) await new Promise<void>((r) => ff.stdin.once('drain', () => r()));
    },
    async finish() {
      ff.stdin.end();
      await finished;
    },
    abort() {
      ff.kill('SIGKILL');
      rmSync(outPath, {force: true});
    },
  };
}
