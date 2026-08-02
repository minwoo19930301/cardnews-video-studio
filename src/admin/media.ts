/** 업로드 미디어를 영구 저장 가능한 data URL로 변환 (blob URL은 새로고침 시 죽음) */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.readAsDataURL(file);
  });
}

export function resolveMediaUrl(src: string): string {
  if (!src) return '';
  if (
    src.startsWith('blob:') ||
    src.startsWith('data:') ||
    /^https?:\/\//i.test(src)
  ) {
    return src;
  }
  if (src.startsWith('/')) return `${window.location.origin}${src}`;
  return `${window.location.origin}/${src.replace(/^\.\//, '')}`;
}

export function isVideoSrc(src: string, kind?: 'image' | 'video'): boolean {
  if (kind === 'video') return true;
  if (kind === 'image') return false;
  if (src.startsWith('data:video')) return true;
  return /\.(mp4|webm|mov)(\?|$)/i.test(src);
}

export function loadHtmlImage(src: string): Promise<HTMLImageElement | null> {
  const url = resolveMediaUrl(src);
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    // 외부 URL만 CORS. 로컬/data/blob 은 건드리지 않음
    if (/^https?:\/\//i.test(url) && !url.startsWith(window.location.origin)) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => {
      console.warn('[media] image fail', url.slice(0, 80));
      resolve(null);
    };
    img.src = url;
  });
}

/** 비디오를 seek 해서 현재 프레임을 캔버스에 그릴 수 있게 준비 */
export function loadVideoElement(src: string): Promise<HTMLVideoElement | null> {
  const url = resolveMediaUrl(src);
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    // 외부만 CORS — 로컬/data 는 설정하지 않음
    if (/^https?:\/\//i.test(url) && !url.startsWith(window.location.origin)) {
      video.crossOrigin = 'anonymous';
    }
    const fail = () => {
      console.warn('[media] video fail', url.slice(0, 80));
      resolve(null);
    };
    video.onerror = fail;
    video.onloadeddata = async () => {
      try {
        const t = Math.min(0.08, Math.max(0.01, (video.duration || 1) * 0.02));
        if (video.seekable.length > 0) {
          video.currentTime = t;
          await new Promise<void>((r) => {
            const done = () => {
              video.removeEventListener('seeked', done);
              r();
            };
            video.addEventListener('seeked', done);
            setTimeout(done, 80);
          });
        }
        resolve(video);
      } catch {
        fail();
      }
    };
    video.src = url;
    video.load();
  });
}

export type LoadedMedia =
  | {type: 'image'; el: HTMLImageElement}
  | {type: 'video'; el: HTMLVideoElement};

export async function loadMedia(
  src: string,
  kind?: 'image' | 'video',
): Promise<LoadedMedia | null> {
  if (!src) return null;
  if (isVideoSrc(src, kind)) {
    const el = await loadVideoElement(src);
    return el ? {type: 'video', el} : null;
  }
  const el = await loadHtmlImage(src);
  return el ? {type: 'image', el} : null;
}

/** 캔버스 cover 그리기 (이미지 또는 비디오 프레임) */
export function drawMediaCover(
  ctx: CanvasRenderingContext2D,
  media: LoadedMedia,
  canvasW: number,
  canvasH: number,
  scale = 1,
  videoTime?: number,
) {
  let iw = 0;
  let ih = 0;
  if (media.type === 'image') {
    iw = media.el.naturalWidth || media.el.width;
    ih = media.el.naturalHeight || media.el.height;
  } else {
    if (typeof videoTime === 'number' && Number.isFinite(videoTime)) {
      try {
        media.el.currentTime = Math.min(
          Math.max(0, videoTime),
          Math.max(0, (media.el.duration || 1) - 0.05),
        );
      } catch {
        /* ignore seek errors mid-record */
      }
    }
    iw = media.el.videoWidth || 1080;
    ih = media.el.videoHeight || 1920;
  }
  if (!iw || !ih) return;
  const base = Math.max(canvasW / iw, canvasH / ih) * scale;
  const dw = iw * base;
  const dh = ih * base;
  ctx.drawImage(media.el as CanvasImageSource, (canvasW - dw) / 2, (canvasH - dh) / 2, dw, dh);
}

/** 깨진 blob URL 여부 대략 검사 */
export async function mediaLooksAlive(src: string, kind?: 'image' | 'video'): Promise<boolean> {
  if (!src) return false;
  if (src.startsWith('blob:')) {
    try {
      const r = await fetch(src);
      return r.ok;
    } catch {
      return false;
    }
  }
  const m = await loadMedia(src, kind);
  return !!m;
}
