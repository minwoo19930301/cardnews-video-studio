import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import sample from '../../data/sample.json';
import {downloadBlob, exportSegment, type ExportFormat, type ExportSegment} from './exportVideo';
import {fileToDataUrl, resolveMediaUrl} from './media';
import {applyEmphasis, clearMarkers} from './markers';
import {PreviewCanvas} from './PreviewCanvas';
import {DEFAULT_COLORS} from '../engine/render';
import {
  EMPHASIS_BTNS,
  FONT_OPTIONS,
  MAX_SLIDES,
  PHOTO_EFFECTS,
  POS_LABELS,
  SLIDE_DURATION_SEC,
  TEXT_ENTER_OPTIONS,
  TRANSITION_OPTIONS,
  BACKDROP_OPTIONS,
  createDefaultProject,
  defaultChip,
  emptySlide,
  fontCss,
  makeId,
  type PhotoEffect,
  type Pos,
  type Project,
  type Slide,
  type SlideTransition,
  type TextEnter,
  type TextBackdrop,
} from './types';

const STORAGE_KEY = 'cardnews-video-studio:project:v8';
const MAX_UNDO = 40;

/** 색 프리셋 — 글자 / 강조 / 칩 / 하이라이트 */
const COLOR_PRESETS: Array<{name: string; text: string; accent: string; chip: string; highlight: string}> = [
  {name: '기본', ...DEFAULT_COLORS},
  {name: '먹색', text: '#FFFFFF', accent: '#111111', chip: '#111111', highlight: '#F2F2F2'},
  {name: '네이비', text: '#FFFFFF', accent: '#2F6BFF', chip: '#1B2A4A', highlight: '#9CC2FF'},
  {name: '숲', text: '#F6F3EA', accent: '#2E7D4F', chip: '#2E7D4F', highlight: '#C8E6A0'},
  {name: '코랄', text: '#FFFFFF', accent: '#FF6B4A', chip: '#FF6B4A', highlight: '#FFD3C2'},
  {name: '보라', text: '#FFFFFF', accent: '#7C4DFF', chip: '#5B2EDB', highlight: '#E2D5FF'},
  {name: '신문', text: '#111111', accent: '#C8102E', chip: '#111111', highlight: '#FFE14D'},
];

type ColorKey = 'textColor' | 'accentColor' | 'chipColor' | 'highlightColor';
const COLOR_FIELDS: Array<{key: ColorKey; label: string; fallback: string}> = [
  {key: 'textColor', label: '글자', fallback: DEFAULT_COLORS.text},
  {key: 'accentColor', label: '강조', fallback: DEFAULT_COLORS.accent},
  {key: 'chipColor', label: '번호 칩', fallback: DEFAULT_COLORS.chip},
  {key: 'highlightColor', label: '형광펜', fallback: DEFAULT_COLORS.highlight},
];

function demoSlide(): Slide {
  const first = (sample.slides?.[0] ?? {image: 'photos/demo/01.jpg', title: '제목을 입력하세요', text: ''}) as {
    image: string;
    title?: string;
    text?: string;
  };
  return {
    ...emptySlide(0),
    image: first.image.startsWith('/') ? first.image : `/${first.image}`,
    renderPath: first.image.replace(/^\//, ''),
    title: first.title ?? '제목을 입력하세요',
    text: first.text ?? '',
  };
}

function normalizeImage(image: string): string {
  if (!image || image.startsWith('blob:')) return '';
  if (image.startsWith('/') || image.startsWith('data:') || image.startsWith('http')) return image;
  return `/${image}`;
}

function loadProject(): Project {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Project;
      if (!p.fontFamily || !FONT_OPTIONS.some((f) => f.id === p.fontFamily)) p.fontFamily = 'pretendard';
      p.brand = p.brand || {};
      p.slides = (p.slides || []).map((s) => ({
        ...emptySlide(0),
        ...s,
        image: normalizeImage(s.image || ''),
      }));
      if (p.slides.length) return p;
    }
  } catch {
    /* ignore */
  }
  const base = createDefaultProject();
  return {...base, brand: {logoText: sample.brand?.logoText ?? ''}, slides: [demoSlide()]};
}

function Field({label, hint, children}: {label: string; hint?: string; children: React.ReactNode}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

function Section({title, action, children}: {title: string; action?: React.ReactNode; children: React.ReactNode}) {
  return (
    <section className="section">
      <header className="section-head">
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export default function App() {
  const [project, setProject] = useState<Project>(() => loadProject());
  const [selectedId, setSelectedId] = useState<string>(() => loadProject().slides[0]?.id ?? '');
  const [toast, setToast] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportLabel, setExportLabel] = useState('');
  const [format, setFormat] = useState<ExportFormat>('mp4');
  const historyRef = useRef<Project[]>([]);
  const futureRef = useRef<Project[]>([]);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const [dropOver, setDropOver] = useState<string | null>(null);
  const dragSlideRef = useRef<string | null>(null);

  // 창 아무 데나 파일을 놓아도 브라우저가 파일을 열어 버리지 않게
  useEffect(() => {
    const stop = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', stop);
    return () => {
      window.removeEventListener('dragover', stop);
      window.removeEventListener('drop', stop);
    };
  }, []);

  const selectedIndex = Math.max(0, project.slides.findIndex((s) => s.id === selectedId));
  const slide = project.slides[selectedIndex] ?? null;
  const filledCount = project.slides.filter((s) => s.image || s.title || s.text).length;
  const activeFont = fontCss(slide?.fontFamily || project.fontFamily);

  useEffect(() => {
    if (!project.slides.some((s) => s.id === selectedId) && project.slides[0]) setSelectedId(project.slides[0].id);
  }, [project.slides, selectedId]);

  const commit = useCallback((next: (p: Project) => Project) => {
    setProject((prev) => {
      historyRef.current = [...historyRef.current.slice(-MAX_UNDO), prev];
      futureRef.current = [];
      return next(prev);
    });
  }, []);

  const undo = useCallback(() => {
    const prev = historyRef.current.pop();
    if (!prev) return setToast('되돌릴 변경이 없습니다');
    setProject((cur) => {
      futureRef.current.push(cur);
      return prev;
    });
  }, []);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return setToast('다시 할 변경이 없습니다');
    setProject((cur) => {
      historyRef.current.push(cur);
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    } catch {
      setToast('브라우저 저장 공간이 가득 찼습니다. 큰 영상은 다시 올려야 할 수 있습니다.');
    }
  }, [project]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), toast.length > 40 ? 5200 : 2600);
    return () => window.clearTimeout(t);
  }, [toast]);

  const updateProject = (patch: Partial<Project>) => commit((p) => ({...p, ...patch}));
  const updateSlide = (id: string, patch: Partial<Slide>) =>
    commit((p) => ({...p, slides: p.slides.map((s) => (s.id === id ? {...s, ...patch} : s))}));
  const applyToAll = (patch: Partial<Slide>, what: string) => {
    commit((p) => ({...p, slides: p.slides.map((s) => ({...s, ...patch}))}));
    setToast(`${what}을 모든 장에 적용했습니다`);
  };

  const addSlide = () => {
    if (project.slides.length >= MAX_SLIDES) return setToast(`최대 ${MAX_SLIDES}장까지 만들 수 있습니다`);
    const base = slide ?? emptySlide(0);
    const next: Slide = {
      ...emptySlide(project.slides.length),
      // 새 장은 지금 장의 색·모션·글씨체를 이어받는다
      photoEffect: base.photoEffect,
      textEnter: base.textEnter,
      transition: 'cut',
      accentColor: base.accentColor,
      textColor: base.textColor,
      chipColor: base.chipColor,
      highlightColor: base.highlightColor,
      shade: base.shade,
      fontFamily: base.fontFamily,
      showChip: base.showChip,
      backdrop: base.backdrop,
      backdropColor: base.backdropColor,
      backdropOpacity: base.backdropOpacity,
    };
    commit((p) => ({...p, slides: [...p.slides, next]}));
    setSelectedId(next.id);
  };

  const duplicateSlide = (id: string) => {
    if (project.slides.length >= MAX_SLIDES) return setToast(`최대 ${MAX_SLIDES}장까지 만들 수 있습니다`);
    const i = project.slides.findIndex((s) => s.id === id);
    const copy = {...project.slides[i], id: makeId('slide')};
    commit((p) => ({...p, slides: [...p.slides.slice(0, i + 1), copy, ...p.slides.slice(i + 1)]}));
    setSelectedId(copy.id);
  };

  const moveSlide = (id: string, dir: -1 | 1) => {
    const i = project.slides.findIndex((s) => s.id === id);
    const j = i + dir;
    if (j < 0 || j >= project.slides.length) return;
    commit((p) => {
      const slides = [...p.slides];
      [slides[i], slides[j]] = [slides[j], slides[i]];
      return {...p, slides};
    });
  };

  const removeSlide = (id: string) => {
    if (project.slides.length <= 1) return setToast('최소 1장은 있어야 합니다');
    commit((p) => ({...p, slides: p.slides.filter((s) => s.id !== id)}));
  };

  const isMediaFile = (f: File) => f.type.startsWith('image/') || f.type.startsWith('video/');
  const mediaPatch = async (file: File): Promise<Partial<Slide>> => ({
    image: await fileToDataUrl(file),
    mediaKind: file.type.startsWith('video') ? 'video' : 'image',
    renderPath: `photos/uploads/${file.name}`,
  });

  const setMediaFromFile = async (slideId: string, file: File) => {
    try {
      updateSlide(slideId, await mediaPatch(file));
    } catch (e) {
      setToast(e instanceof Error ? e.message : '파일을 읽지 못했습니다');
    }
  };
  const onPickMedia = async (file: File) => {
    if (slide) await setMediaFromFile(slide.id, file);
  };

  /** 파일 여러 개 → 지금 장 스타일을 이어받은 새 장들 */
  const addSlidesFromFiles = async (files: File[]) => {
    const room = MAX_SLIDES - project.slides.length;
    if (room <= 0) return setToast(`최대 ${MAX_SLIDES}장까지 만들 수 있습니다`);
    const use = files.filter(isMediaFile).slice(0, room);
    if (files.length > use.length) setToast(`${use.length}장만 추가했습니다 (최대 ${MAX_SLIDES}장, 사진·영상만)`);
    const base = slide ?? emptySlide(0);
    const made: Slide[] = [];
    for (const [k, f] of use.entries()) {
      made.push({
        ...emptySlide(project.slides.length + k),
        photoEffect: base.photoEffect,
        textEnter: base.textEnter,
        transition: 'cut',
        accentColor: base.accentColor,
        textColor: base.textColor,
        chipColor: base.chipColor,
        highlightColor: base.highlightColor,
        shade: base.shade,
        fontFamily: base.fontFamily,
        showChip: base.showChip,
        backdrop: base.backdrop,
        backdropColor: base.backdropColor,
        backdropOpacity: base.backdropOpacity,
        ...(await mediaPatch(f)),
      });
    }
    if (!made.length) return;
    commit((p) => ({...p, slides: [...p.slides, ...made]}));
    setSelectedId(made[0].id);
  };

  /** 끌어 놓은 파일 처리: 첫 파일은 대상 장에, 나머지는 새 장으로 */
  const dropFiles = async (files: File[], slideId?: string) => {
    const media = files.filter(isMediaFile);
    if (!media.length) return setToast('사진이나 영상 파일만 놓을 수 있습니다');
    if (slideId) {
      await setMediaFromFile(slideId, media[0]);
      if (media.length > 1) await addSlidesFromFiles(media.slice(1));
    } else await addSlidesFromFiles(media);
  };

  const moveSlideTo = (id: string, toIndex: number) => {
    commit((p) => {
      const from = p.slides.findIndex((s) => s.id === id);
      if (from < 0) return p;
      const slides = [...p.slides];
      const [it] = slides.splice(from, 1);
      slides.splice(Math.max(0, Math.min(slides.length, toIndex > from ? toIndex - 1 : toIndex)), 0, it);
      return {...p, slides};
    });
  };

  const onPickLogo = async (file: File) => {
    try {
      const dataUrl = await fileToDataUrl(file);
      updateProject({brand: {...project.brand, logoImage: dataUrl}});
    } catch (e) {
      setToast(e instanceof Error ? e.message : '로고를 읽지 못했습니다');
    }
  };

  const applyMarker = (id: string) => {
    const el = titleRef.current;
    if (!el || !slide) return;
    const {next, cursor, removed} = applyEmphasis(slide.title, el.selectionStart ?? 0, el.selectionEnd ?? 0, id);
    if (next === slide.title) return setToast('강조할 단어를 드래그하거나 단어 안에 커서를 두세요');
    updateSlide(slide.id, {title: next});
    if (removed) setToast('강조를 풀었습니다');
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  };


  const runExport = async (segment: ExportSegment, label: string) => {
    if (exporting) return;
    setExporting(true);
    setExportLabel(label);
    try {
      const {blob, filename, note} = await exportSegment(project, segment, format, (p) =>
        setExportLabel(`${p.phase} · ${p.pct}%`),
      );
      downloadBlob(blob, filename);
      setToast(note ? `저장했습니다. ${note}` : `${filename} 저장했습니다`);
    } catch (e) {
      setToast(e instanceof Error ? e.message : '내보내기에 실패했습니다');
    } finally {
      setExporting(false);
      setExportLabel('');
    }
  };

  const resetSample = () => {
    if (!window.confirm('지금 작업을 지우고 샘플로 바꿀까요? (실행 취소로 되돌릴 수 있습니다)')) return;
    const base = createDefaultProject();
    const next = {...base, brand: {logoText: sample.brand?.logoText ?? ''}, slides: [demoSlide()]};
    commit(() => next);
    setSelectedId(next.slides[0].id);
  };

  /** 드롭 영역 공통 속성 */
  const dropZone = (key: string, onFiles: (files: File[]) => void, onSlide?: (id: string) => void) => ({
    onDragOver: (e: React.DragEvent) => {
      const isFile = e.dataTransfer.types.includes('Files');
      if (!isFile && !(onSlide && dragSlideRef.current)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = isFile ? 'copy' : 'move';
      if (dropOver !== key) setDropOver(key);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!(e.currentTarget as Element).contains(e.relatedTarget as Node)) setDropOver((k) => (k === key ? null : k));
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropOver(null);
      const files = Array.from(e.dataTransfer.files);
      if (files.length) onFiles(files);
      else if (onSlide && dragSlideRef.current) onSlide(dragSlideRef.current);
      dragSlideRef.current = null;
    },
  });

  const presetActive = useMemo(() => {
    if (!slide) return '';
    return (
      COLOR_PRESETS.find(
        (c) =>
          (slide.textColor || DEFAULT_COLORS.text).toLowerCase() === c.text.toLowerCase() &&
          (slide.accentColor || DEFAULT_COLORS.accent).toLowerCase() === c.accent.toLowerCase() &&
          (slide.chipColor || DEFAULT_COLORS.chip).toLowerCase() === c.chip.toLowerCase() &&
          (slide.highlightColor || DEFAULT_COLORS.highlight).toLowerCase() === c.highlight.toLowerCase(),
      )?.name ?? ''
    );
  }, [slide]);

  return (
    <div className="studio">
      <header className="topbar">
        <div className="wordmark">
          <strong>카드뉴스</strong>
          <input
            className="project-name"
            value={project.title}
            onChange={(e) => updateProject({title: e.target.value})}
            aria-label="프로젝트 이름"
            placeholder="이름 없는 카드뉴스"
          />
        </div>
        <div className="top-actions">
          <button className="icon-btn" type="button" onClick={undo} disabled={exporting} title="실행 취소 (⌘Z)">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
              <path d="M6 4 2.5 7.5 6 11M3 7.5h6.5a4 4 0 0 1 0 8H8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button className="icon-btn" type="button" onClick={redo} disabled={exporting} title="다시 실행 (⌘⇧Z)">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
              <path d="M10 4l3.5 3.5L10 11M13 7.5H6.5a4 4 0 0 0 0 8H8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="divider" />
          <select className="format" value={format} disabled={exporting} onChange={(e) => setFormat(e.target.value as ExportFormat)} aria-label="파일 형식">
            <option value="mp4">MP4</option>
            <option value="gif">GIF</option>
            <option value="webm">WebM</option>
          </select>
          <button
            className="btn"
            type="button"
            disabled={exporting}
            onClick={() => void runExport({kind: 'slide', index: selectedIndex}, `${selectedIndex + 1}장 저장`)}
          >
            이 장만 저장
          </button>
          <button className="btn primary" type="button" disabled={exporting} onClick={() => void runExport({kind: 'full'}, '전체 저장')}>
            전체 저장 · {filledCount * SLIDE_DURATION_SEC}초
          </button>
        </div>
      </header>

      <div className="layout">
        <aside className="rail">
          <Section title={`장 ${project.slides.length}/${MAX_SLIDES}`}>
            <ol className="slide-list">
              {project.slides.map((s, i) => (
                <li
                  key={s.id}
                  className={[s.id === slide?.id ? 'active' : '', dropOver === `slide:${s.id}` ? 'drop' : ''].join(' ')}
                  draggable
                  onDragStart={(e) => {
                    dragSlideRef.current = s.id;
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', s.id);
                  }}
                  onDragEnd={() => {
                    dragSlideRef.current = null;
                    setDropOver(null);
                  }}
                  {...dropZone(
                    `slide:${s.id}`,
                    (files) => void dropFiles(files, s.id),
                    (id) => id !== s.id && moveSlideTo(id, i),
                  )}
                >
                  <button type="button" className="slide-card" onClick={() => setSelectedId(s.id)}>
                    <span
                      className="thumb"
                      style={s.image && s.mediaKind === 'image' ? {backgroundImage: `url(${resolveMediaUrl(s.image)})`} : undefined}
                    >
                      {s.mediaKind === 'video' && s.image ? <em>영상</em> : null}
                    </span>
                    <span className="meta">
                      <span className="idx">{i + 1}</span>
                      <span className="name">{s.title?.split('\n')[0].replace(/[=@_[\]~%#+*:<>!^≈{}&$|;()]/g, '') || '빈 장'}</span>
                    </span>
                  </button>
                  <div className="slide-tools">
                    <button type="button" onClick={() => moveSlide(s.id, -1)} disabled={i === 0} title="위로">↑</button>
                    <button type="button" onClick={() => moveSlide(s.id, 1)} disabled={i === project.slides.length - 1} title="아래로">↓</button>
                    <button type="button" onClick={() => duplicateSlide(s.id)} title="복제">⧉</button>
                    <button type="button" onClick={() => removeSlide(s.id)} title="삭제">×</button>
                  </div>
                </li>
              ))}
            </ol>
            <button
              className={`btn add${dropOver === 'add' ? ' drop' : ''}`}
              type="button"
              onClick={addSlide}
              disabled={project.slides.length >= MAX_SLIDES}
              {...dropZone('add', (files) => void dropFiles(files), (id) => moveSlideTo(id, project.slides.length))}
            >
              장 추가 · 파일을 끌어 놓아도 됩니다
            </button>
          </Section>

          <Section title="공통">
            <div className={`drop-area${dropOver === 'logo' ? ' drop' : ''}`} {...dropZone('logo', (files) => {
              const img = files.find((f) => f.type.startsWith('image/'));
              if (img) void onPickLogo(img);
              else setToast('로고는 이미지 파일만 됩니다');
            })}>
            <Field label="로고">
              <input
                ref={logoRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onPickLogo(f);
                  e.target.value = '';
                }}
              />
              {project.brand.logoImage ? (
                <div className="logo-row">
                  <img src={project.brand.logoImage} alt="로고" />
                  <button type="button" className="link" onClick={() => logoRef.current?.click()}>바꾸기</button>
                  <button type="button" className="link" onClick={() => updateProject({brand: {...project.brand, logoImage: undefined}})}>
                    지우기
                  </button>
                </div>
              ) : (
                <div className="logo-row">
                  <input
                    value={project.brand.logoText ?? ''}
                    placeholder="로고 글자 (비우면 없음)"
                    onChange={(e) => updateProject({brand: {...project.brand, logoText: e.target.value}})}
                  />
                  <button type="button" className="btn small" onClick={() => logoRef.current?.click()}>이미지</button>
                </div>
              )}
            </Field>
            </div>
            <Field label={`로고 크기 · ${Math.round((project.brand.logoScale ?? 1) * 100)}%`}>
              <input
                type="range"
                min={0.3}
                max={4}
                step={0.05}
                value={project.brand.logoScale ?? 1}
                onChange={(e) => updateProject({brand: {...project.brand, logoScale: Number(e.target.value)}})}
              />
            </Field>
            {project.brand.logoOffset && (project.brand.logoOffset.x || project.brand.logoOffset.y) ? (
              <button type="button" className="link" onClick={() => updateProject({brand: {...project.brand, logoOffset: undefined}})}>
                로고 위치 되돌리기
              </button>
            ) : null}
            <Field label="기본 글씨체">
              <select value={project.fontFamily} onChange={(e) => updateProject({fontFamily: e.target.value})}>
                {FONT_OPTIONS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Field>
            <button type="button" className="link muted" onClick={resetSample}>샘플로 다시 시작</button>
          </Section>
        </aside>

        <main
          className={`stage${dropOver === 'stage' ? ' drop' : ''}`}
          {...dropZone('stage', (files) => void dropFiles(files, slide?.id))}
        >
          <PreviewCanvas
            project={project}
            slide={slide}
            slideIndex={selectedIndex + 1}
            slideTotal={project.slides.length}
            prevSlide={selectedIndex > 0 ? project.slides[selectedIndex - 1] : null}
            onMoveText={(o) => slide && updateSlide(slide.id, {textOffset: o})}
            onMoveLogo={(o) => updateProject({brand: {...project.brand, logoOffset: o}})}
            onScaleText={(k) => slide && updateSlide(slide.id, {textScale: k})}
            onScaleLogo={(k) => updateProject({brand: {...project.brand, logoScale: k}})}
            onDeleteText={() => {
              if (!slide) return;
              updateSlide(slide.id, {title: '', text: ''});
              setToast('제목과 보조 문구를 지웠습니다. ⌘Z 로 되돌릴 수 있습니다.');
            }}
            onDeleteLogo={() => {
              updateProject({brand: {...project.brand, logoImage: undefined, logoText: ''}});
              setToast('로고를 지웠습니다. ⌘Z 로 되돌릴 수 있습니다.');
            }}
          />
        </main>

        <aside className="inspector">
          {slide ? (
            <>
              <Section
                title="미디어"
                action={
                  <button
                    type="button"
                    className="link"
                    onClick={() => applyToAll({photoEffect: slide.photoEffect, transition: slide.transition}, '전환·움직임')}
                  >
                    모든 장에 적용
                  </button>
                }
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,video/*"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onPickMedia(f);
                    e.target.value = '';
                  }}
                />
                <button className="btn wide" type="button" onClick={() => fileRef.current?.click()} style={{marginBottom: 12}}>
                  {slide.image ? '사진·영상 바꾸기' : '사진·영상 올리기'}
                </button>
                <div className="row">
                  <Field label="시작 전환">
                    <select value={slide.transition || 'cut'} onChange={(e) => updateSlide(slide.id, {transition: e.target.value as SlideTransition})}>
                      {TRANSITION_OPTIONS.map((fx) => (
                        <option key={fx.id} value={fx.id}>
                          {fx.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="움직임">
                    <select value={slide.photoEffect || 'none'} onChange={(e) => updateSlide(slide.id, {photoEffect: e.target.value as PhotoEffect})}>
                      {PHOTO_EFFECTS.map((fx) => (
                        <option key={fx.id} value={fx.id}>
                          {fx.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </Section>

              <Section
                title="문구"
                action={
                  <button type="button" className="link" onClick={() => applyToAll({textEnter: slide.textEnter}, '제목 등장')}>
                    등장 모든 장에 적용
                  </button>
                }
              >
                <Field label="제목" hint="줄바꿈으로 최대 3줄.">
                  <textarea
                    ref={titleRef}
                    value={slide.title}
                    onChange={(e) => updateSlide(slide.id, {title: e.target.value})}
                    placeholder="예: 세계 최초 @@플래그십@@ 오픈"
                    style={{fontFamily: activeFont}}
                  />
                </Field>
                <Field label="제목 등장" hint="등장 뒤에 아래 강조가 이어집니다. 1.5초 안에 끝납니다.">
                  <select value={slide.textEnter || 'fade-up'} onChange={(e) => updateSlide(slide.id, {textEnter: e.target.value as TextEnter})}>
                    {TEXT_ENTER_OPTIONS.map((fx) => (
                      <option key={fx.id} value={fx.id}>
                        {fx.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="field-label-row">
                  <span className="field-label">강조 (단어를 드래그하거나 커서를 두고 누르기, 다시 누르면 해제)</span>
                  <button type="button" className="link muted" onClick={() => updateSlide(slide.id, {title: clearMarkers(slide.title)})}>
                    강조 모두 지우기
                  </button>
                </div>
                <div className="marker-bar">
                  {EMPHASIS_BTNS.map((m) => (
                    <button key={m.id} type="button" title={`${m.open}텍스트${m.close}`} onClick={() => applyMarker(m.id)}>
                      {m.label}
                    </button>
                  ))}
                </div>
                <Field label="보조 문구">
                  <input value={slide.text} onChange={(e) => updateSlide(slide.id, {text: e.target.value})} style={{fontFamily: activeFont}} />
                </Field>
                <Field label="기준 위치" hint="세밀한 위치는 미리보기에서 제목을 끌어서 맞춥니다.">
                  <div className="inline">
                    <select
                      value={slide.pos ?? 'bl'}
                      onChange={(e) => updateSlide(slide.id, {pos: e.target.value as Pos, textOffset: undefined})}
                    >
                      {(Object.keys(POS_LABELS) as Pos[]).map((k) => (
                        <option key={k} value={k}>
                          {POS_LABELS[k]}
                        </option>
                      ))}
                    </select>
                    {slide.textOffset && (slide.textOffset.x || slide.textOffset.y) ? (
                      <button type="button" className="link" onClick={() => updateSlide(slide.id, {textOffset: undefined})}>
                        끈 위치 되돌리기
                      </button>
                    ) : null}
                  </div>
                </Field>
                <Field label={`글자 크기 · ${Math.round((slide.textScale ?? 1) * 100)}%`} hint="미리보기에서 제목을 누르고 모서리를 끌어도 됩니다.">
                  <input
                    type="range"
                    min={0.3}
                    max={3}
                    step={0.05}
                    value={slide.textScale ?? 1}
                    onChange={(e) => updateSlide(slide.id, {textScale: Number(e.target.value)})}
                  />
                </Field>
                <Field label="글자 배경">
                  <div className="inline">
                    <select
                      value={slide.backdrop ?? 'none'}
                      onChange={(e) => {
                        const backdrop = e.target.value as TextBackdrop;
                        const frost = backdrop === 'frost' || backdrop === 'frost-box';
                        const wasFrost = slide.backdrop === 'frost' || slide.backdrop === 'frost-box';
                        const text = (slide.textColor || DEFAULT_COLORS.text).toLowerCase();
                        // 흐린 유리(밝은 배경)로 바꾸면 흰 글자를 어둡게, 다시 빼면 되돌림
                        const textColor =
                          frost && !wasFrost && text === '#ffffff' ? '#111111' : !frost && wasFrost && text === '#111111' ? '#FFFFFF' : slide.textColor;
                        updateSlide(slide.id, {backdrop, textColor, backdropColor: undefined, backdropOpacity: undefined});
                      }}
                    >
                      {BACKDROP_OPTIONS.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                    {slide.backdrop && slide.backdrop !== 'none' ? (
                      <input
                        type="color"
                        className="mini-color"
                        title="배경 색"
                        value={
                          slide.backdropColor ||
                          (slide.backdrop === 'frost' || slide.backdrop === 'frost-box'
                            ? '#ffffff'
                            : slide.backdrop === 'line'
                              ? slide.textColor || DEFAULT_COLORS.text
                              : '#000000')
                        }
                        onChange={(e) => updateSlide(slide.id, {backdropColor: e.target.value})}
                      />
                    ) : null}
                  </div>
                </Field>
                {slide.backdrop && slide.backdrop !== 'none' ? (
                  <Field
                    label={`배경 진하기 · ${Math.round(
                      (slide.backdropOpacity ??
                        (slide.backdrop === 'frost' || slide.backdrop === 'frost-box' ? 0.35 : slide.backdrop === 'line' ? 0.6 : 0.62)) * 100,
                    )}%`}
                  >
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={
                        slide.backdropOpacity ??
                        (slide.backdrop === 'frost' || slide.backdrop === 'frost-box' ? 0.35 : slide.backdrop === 'line' ? 0.6 : 0.62)
                      }
                      onChange={(e) => updateSlide(slide.id, {backdropOpacity: Number(e.target.value)})}
                    />
                  </Field>
                ) : null}
                <label className="check">
                  <input type="checkbox" checked={!!slide.showChip} onChange={(e) => updateSlide(slide.id, {showChip: e.target.checked})} />
                  <span>번호 칩 보이기</span>
                </label>
                {slide.showChip ? (
                  <Field label="칩 글자">
                    <input
                      value={slide.chipText ?? ''}
                      onChange={(e) => updateSlide(slide.id, {chipText: e.target.value})}
                      placeholder={`${selectedIndex + 1}/${project.slides.length}`}
                    />
                  </Field>
                ) : null}
                <Field label="글씨체">
                  <select value={slide.fontFamily || ''} onChange={(e) => updateSlide(slide.id, {fontFamily: e.target.value || undefined})}>
                    <option value="">공통 글씨체 따르기</option>
                    {FONT_OPTIONS.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </Section>

              <Section
                title="색"
                action={
                  <button
                    type="button"
                    className="link"
                    onClick={() =>
                      applyToAll(
                        {
                          textColor: slide.textColor,
                          accentColor: slide.accentColor,
                          chipColor: slide.chipColor,
                          highlightColor: slide.highlightColor,
                          shade: slide.shade,
                          backdrop: slide.backdrop,
                          backdropColor: slide.backdropColor,
                          backdropOpacity: slide.backdropOpacity,
                        },
                        '색·배경',
                      )
                    }
                  >
                    모든 장에 적용
                  </button>
                }
              >
                <div className="presets">
                  {COLOR_PRESETS.map((c) => (
                    <button
                      key={c.name}
                      type="button"
                      className={presetActive === c.name ? 'active' : ''}
                      onClick={() =>
                        updateSlide(slide.id, {textColor: c.text, accentColor: c.accent, chipColor: c.chip, highlightColor: c.highlight})
                      }
                      title={c.name}
                    >
                      <span style={{background: c.chip}} />
                      <span style={{background: c.accent}} />
                      <span style={{background: c.highlight}} />
                      <em>{c.name}</em>
                    </button>
                  ))}
                </div>
                <div className="swatches">
                  {COLOR_FIELDS.map((cf) => (
                    <label key={cf.key} className="swatch">
                      <input
                        type="color"
                        value={(slide[cf.key] as string | undefined) || cf.fallback}
                        onChange={(e) => updateSlide(slide.id, {[cf.key]: e.target.value} as Partial<Slide>)}
                      />
                      <span>{cf.label}</span>
                    </label>
                  ))}
                </div>
                <Field label={`바탕 어둡게 · ${Math.round((slide.shade ?? 1) * 100)}%`}>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={slide.shade ?? 1}
                    onChange={(e) => updateSlide(slide.id, {shade: Number(e.target.value)})}
                  />
                </Field>
              </Section>
            </>
          ) : null}
        </aside>
      </div>

      {toast ? <div className="toast">{toast}</div> : null}
      {exporting ? (
        <div className="export-overlay">
          <div className="export-card">
            <div className="export-bar">
              <span style={{width: `${Number(exportLabel.match(/(\d+)%/)?.[1] ?? 0)}%`}} />
            </div>
            <strong>{exportLabel || '준비 중'}</strong>
            <p>{format.toUpperCase()} 로 만드는 중입니다. 창을 닫지 마세요.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
