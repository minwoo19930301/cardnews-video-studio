import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import sample from '../../data/sample.json';
import {
  downloadBlob,
  exportSegment,
  type ExportFormat,
  type ExportSegment,
} from './exportVideo';
import {fileToDataUrl, resolveMediaUrl} from './media';
import {parseFx, wrapSelection} from './markers';
import {
  EMPHASIS_BTNS,
  TEXT_ENTER_OPTIONS,
  FONT_OPTIONS,
  MAX_SLIDES,
  PHOTO_EFFECTS,
  POS_LABELS,
  SLIDE_DURATION_SEC,
  createDefaultProject,
  defaultChip,
  emptySlide,
  fontCss,
  makeId,
  type PhotoEffect,
  type TextEnter,
  type Pos,
  type Project,
  type Slide,
} from './types';

const STORAGE_KEY = 'cardnews-video-studio:project:v8';
const MAX_UNDO = 40;

type Selection =
  | {kind: 'intro'}
  | {kind: 'outro'}
  | {kind: 'slide'; id: string};

function demoSlide(): Slide {
  const first = (sample.slides?.[0] ?? {
    image: 'photos/demo/01.jpg',
    title: '제목을 입력하세요',
    text: '',
  }) as {image: string; title?: string; text?: string; pos?: Pos};
  const path = first.image.startsWith('/') ? first.image : `/${first.image}`;
  return {
    id: makeId('slide'),
    image: path,
    renderPath: first.image.replace(/^\//, ''),
    title: first.title ?? '제목을 입력하세요',
    text: first.text ?? '',
    pos: first.pos ?? 'bl',
    mediaKind: 'image',
    chipText: '',
    photoEffect: 'none',
    textEnter: 'fade-up',
    accentColor: '#E03A2C',
  };
}

function loadProject(): Project {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Project;
      if (!p.fontFamily || !FONT_OPTIONS.some((f) => f.id === p.fontFamily)) {
        p.fontFamily = 'pretendard';
      }
      p.slides = (p.slides || []).map((s) => {
        let image = s.image || '';
        if (image.startsWith('blob:')) image = '';
        else if (
          image &&
          !image.startsWith('/') &&
          !image.startsWith('data:') &&
          !image.startsWith('http')
        ) {
          image = `/${image}`;
        }
        return {
          ...s,
          image,
          photoEffect: s.photoEffect || 'none',
          textEnter: s.textEnter || 'fade-up',
          accentColor: s.accentColor || '#E03A2C',
          chipText: s.chipText ?? '',
        };
      });
      return p;
    }
  } catch {
    /* ignore */
  }
  const base = createDefaultProject();
  return {
    ...base,
    brand: {
      logoText: sample.brand?.logoText ?? base.brand.logoText,
      handle: sample.brand?.handle ?? base.brand.handle,
    },
    slides: [demoSlide()],
  };
}

function TitlePreview({title, fontFamily, accent}: {title: string; fontFamily: string; accent?: string}) {
  const lines = (title || '제목을 입력하세요').split('\n');
  return (
    <h1 style={{fontFamily, ['--accent-fx' as string]: accent || '#E03A2C'}} className="title-anim">
      {lines.map((line, li) => (
        <span key={li} className="title-line">
          {li > 0 ? <br /> : null}
          {parseFx(line).map((tok, i) => {
            if (tok.fx === 'none') return <span key={i}>{tok.text}</span>;
            const cls =
              tok.fx === 'hl'
                ? 'fx-hl'
                : tok.fx === 'redhl'
                  ? 'fx-redhl'
                  : `fx-${tok.fx}`;
            return (
              <span key={i} className={cls}>
                {tok.text}
              </span>
            );
          })}
        </span>
      ))}
    </h1>
  );
}

export default function App() {
  const [project, setProject] = useState<Project>(() => loadProject());
  const [selection, setSelection] = useState<Selection>(() => ({
    kind: 'slide',
    id: loadProject().slides[0]?.id ?? '',
  }));
  const [toast, setToast] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportLabel, setExportLabel] = useState('');
  const [format, setFormat] = useState<ExportFormat>('mp4');
  const historyRef = useRef<Project[]>([]);
  const futureRef = useRef<Project[]>([]);
  const skipHistory = useRef(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // sync selection id after first load
  useEffect(() => {
    if (selection.kind === 'slide' && !project.slides.some((s) => s.id === selection.id)) {
      const first = project.slides[0];
      setSelection(first ? {kind: 'slide', id: first.id} : {kind: 'intro'});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedSlide = useMemo(() => {
    if (selection.kind !== 'slide') return null;
    return project.slides.find((s) => s.id === selection.id) ?? null;
  }, [project.slides, selection]);

  const selectedIndex =
    selection.kind === 'slide'
      ? project.slides.findIndex((s) => s.id === selection.id)
      : -1;
  const filledCount = project.slides.filter((s) => s.image || s.title || s.text).length;
  const activeFont = fontCss(selectedSlide?.fontFamily || project.fontFamily);

  const commit = useCallback((next: Project | ((p: Project) => Project)) => {
    setProject((prev) => {
      const value = typeof next === 'function' ? next(prev) : next;
      if (!skipHistory.current) {
        historyRef.current = [...historyRef.current.slice(-MAX_UNDO), prev];
        futureRef.current = [];
      }
      skipHistory.current = false;
      return value;
    });
  }, []);

  const undo = useCallback(() => {
    const prev = historyRef.current.pop();
    if (!prev) {
      setToast('되돌릴 변경 없음');
      return;
    }
    setProject((cur) => {
      futureRef.current.push(cur);
      return prev;
    });
    setToast('실행 취소');
  }, []);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) {
      setToast('다시 실행할 변경 없음');
      return;
    }
    setProject((cur) => {
      historyRef.current.push(cur);
      return next;
    });
    setToast('다시 실행');
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (key === 'z' && e.shiftKey) {
        e.preventDefault();
        redo();
      } else if (key === 'y') {
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
      console.warn('localStorage full');
    }
  }, [project]);

  useEffect(() => {
    if (!toast) return;
    const ms = toast.length > 40 ? 5200 : 2800;
    const t = window.setTimeout(() => setToast(null), ms);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (selection.kind === 'slide' && !project.slides.some((s) => s.id === selection.id)) {
      setSelection({kind: 'intro'});
    }
  }, [project.slides, selection]);

  const updateProject = (patch: Partial<Project>) => commit((p) => ({...p, ...patch}));
  const updateSlide = (id: string, patch: Partial<Slide>) =>
    commit((p) => ({
      ...p,
      slides: p.slides.map((s) => (s.id === id ? {...s, ...patch} : s)),
    }));

  const addSlide = () => {
    if (project.slides.length >= MAX_SLIDES) {
      setToast(`뉴스는 최대 ${MAX_SLIDES}장 (인트로·아웃트로 별도)`);
      return;
    }
    const slide = emptySlide(project.slides.length);
    commit((p) => ({...p, slides: [...p.slides, slide]}));
    setSelection({kind: 'slide', id: slide.id});
  };

  const removeSlide = (id: string) => {
    if (project.slides.length <= 1) {
      setToast('뉴스는 최소 1장');
      return;
    }
    commit((p) => ({...p, slides: p.slides.filter((s) => s.id !== id)}));
    setSelection({kind: 'intro'});
  };

  const onPickMedia = async (file: File) => {
    if (!selectedSlide) return;
    try {
      setToast('미디어 읽는 중…');
      const dataUrl = await fileToDataUrl(file);
      const kind = file.type.startsWith('video') ? 'video' : 'image';
      const safe = file.name.replace(/[^\w.\-가-힣]/g, '_');
      updateSlide(selectedSlide.id, {
        image: dataUrl,
        mediaKind: kind,
        renderPath: `photos/uploads/${safe}`,
      });
      setToast(kind === 'video' ? '영상 반영' : '사진 반영');
    } catch (e) {
      setToast(e instanceof Error ? e.message : '미디어 실패');
    }
  };

  const applyMarker = (open: string, close: string) => {
    const el = titleRef.current;
    if (!el || !selectedSlide) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const {next, cursor} = wrapSelection(selectedSlide.title, start, end, open, close);
    updateSlide(selectedSlide.id, {title: next});
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  };

  const runExport = async (segment: ExportSegment, label: string) => {
    if (exporting) return;
    setExporting(true);
    setExportLabel(`${label}…`);
    try {
      const {blob, filename, note} = await exportSegment(project, segment, format, (p) => {
        setExportLabel(`${p.phase} ${p.pct}%`);
      });
      downloadBlob(blob, filename);
      const ext = filename.split('.').pop()?.toUpperCase() || format.toUpperCase();
      setToast(note ? `${label} 완료 (${ext}) — ${note}` : `${label} 완료 (${ext})`);
    } catch (e) {
      setToast(e instanceof Error ? e.message : '생성 실패');
    } finally {
      setExporting(false);
      setExportLabel('');
    }
  };

  const resetSample = () => {
    ['v2', 'v3', 'v4', 'v5', 'v6', 'v7'].forEach((v) =>
      localStorage.removeItem(`cardnews-video-studio:project:${v}`),
    );
    historyRef.current = [];
    futureRef.current = [];
    const next = loadProject();
    skipHistory.current = true;
    setProject(next);
    setSelection({kind: 'slide', id: next.slides[0].id});
    setToast('샘플 복원');
  };

  const currentDownload = () => {
    if (selection.kind === 'intro') return runExport({kind: 'intro'}, '인트로');
    if (selection.kind === 'outro') return runExport({kind: 'outro'}, '아웃트로');
    const idx = project.slides.findIndex((s) => s.id === selection.id);
    return runExport({kind: 'slide', index: Math.max(0, idx)}, `뉴스 ${idx + 1}`);
  };

  const currentDlLabel =
    selection.kind === 'intro'
      ? '인트로 다운로드'
      : selection.kind === 'outro'
        ? '아웃트로 다운로드'
        : `뉴스 ${selectedIndex + 1} 다운로드`;

  const chipPreview = selectedSlide
    ? defaultChip(selectedIndex + 1, project.slides.length, selectedSlide.chipText)
    : '';

  const photoFx = selectedSlide?.photoEffect || 'none';

  return (
    <div className="studio">
      <header className="topbar">
        <div className="brand">
          <mark>✦</mark>
          <span>CARDNEWS VIDEO STUDIO</span>
          <small>인트로 · 뉴스(최대 {MAX_SLIDES}) · 아웃트로</small>
        </div>
        <div className="top-actions">
          <button className="btn ghost" type="button" onClick={undo} disabled={exporting}>
            ↩ 실행취소
          </button>
          <button className="btn ghost" type="button" onClick={redo} disabled={exporting}>
            ↪ 다시실행
          </button>
          <button className="btn ghost" type="button" onClick={resetSample} disabled={exporting}>
            샘플
          </button>
        </div>
      </header>

      <div className="layout">
        <aside className="rail">
          <h2 className="section-title">
            타임라인
            <span className="badge">분리</span>
          </h2>

          <button
            type="button"
            className={`phase-card intro${selection.kind === 'intro' ? ' active' : ''}`}
            onClick={() => setSelection({kind: 'intro'})}
          >
            <span className="phase-tag">INTRO</span>
            <strong>{project.title || '인트로'}</strong>
            <em>뉴스 장수 미포함</em>
          </button>

          <div className="rail-divider">
            <span>뉴스 {filledCount}/{MAX_SLIDES}</span>
          </div>

          <div className="slide-list">
            {project.slides.map((slide, i) => (
              <button
                key={slide.id}
                type="button"
                className={`slide-card${
                  selection.kind === 'slide' && selection.id === slide.id ? ' active' : ''
                }`}
                onClick={() => setSelection({kind: 'slide', id: slide.id})}
              >
                <div
                  className="thumb"
                  style={
                    slide.image && slide.mediaKind === 'image'
                      ? {backgroundImage: `url(${resolveMediaUrl(slide.image)})`}
                      : undefined
                  }
                />
                <div className="meta">
                  <span className="idx">
                    {defaultChip(i + 1, project.slides.length, slide.chipText)}
                  </span>
                  <strong>{slide.title?.split('\n')[0] || '빈 슬라이드'}</strong>
                </div>
              </button>
            ))}
          </div>
          <button
            className="btn"
            type="button"
            style={{width: '100%', marginTop: 8}}
            onClick={addSlide}
            disabled={project.slides.length >= MAX_SLIDES}
          >
            + 뉴스 추가
          </button>

          <div className="rail-divider">
            <span>끝</span>
          </div>

          <button
            type="button"
            className={`phase-card outro${selection.kind === 'outro' ? ' active' : ''}`}
            onClick={() => setSelection({kind: 'outro'})}
          >
            <span className="phase-tag">OUTRO</span>
            <strong>{project.brand.handle || '아웃트로'}</strong>
            <em>뉴스 장수 미포함</em>
          </button>
        </aside>

        <section className="canvas">
          <div className="canvas-toolbar">
            <span>
              미리보기 ·{' '}
              {selection.kind === 'intro'
                ? '인트로'
                : selection.kind === 'outro'
                  ? '아웃트로'
                  : `뉴스 ${selectedIndex + 1}`}
            </span>
            <span className="muted-hint">
              뉴스 {SLIDE_DURATION_SEC}초 · 효과 루프 미리보기 · ⌘Z
            </span>
          </div>
          <div className="canvas-stage">
            {selection.kind === 'intro' ? (
              <div className="phone phone-intro" style={{fontFamily: fontCss(project.fontFamily)}}>
                <div className="intro-inner intro-loop">
                  <div className="intro-brand">{project.brand.logoText || 'BRAND'}</div>
                  <div className="intro-title">{project.title || '카드뉴스'}</div>
                  {project.subtitle ? <div className="intro-sub">{project.subtitle}</div> : null}
                  <div className="intro-bar" />
                </div>
              </div>
            ) : selection.kind === 'outro' ? (
              <div className="phone phone-outro" style={{fontFamily: fontCss(project.fontFamily)}}>
                <div className="outro-inner outro-loop">
                  <div className="outro-brand">{project.brand.logoText || 'BRAND'}</div>
                  <div className="outro-cta">{project.brand.handle || '{주소}'}</div>
                </div>
              </div>
            ) : selectedSlide ? (
              <div className="phone" style={{fontFamily: activeFont, ['--accent-fx' as string]: selectedSlide.accentColor || '#E03A2C'}}>
                {selectedSlide.image ? (
                  <div className={`media-wrap pe-${photoFx}`}>
                    {selectedSlide.mediaKind === 'video' ||
                    selectedSlide.image.startsWith('data:video') ? (
                      <video
                        className="media"
                        src={resolveMediaUrl(selectedSlide.image)}
                        autoPlay
                        muted
                        loop
                        playsInline
                      />
                    ) : (
                      <img
                        className="media"
                        src={resolveMediaUrl(selectedSlide.image)}
                        alt=""
                        onError={(e) => {
                          const el = e.currentTarget;
                          if (!el.dataset.fallback) {
                            el.dataset.fallback = '1';
                            el.src = '/photos/demo/01.jpg';
                          }
                        }}
                      />
                    )}
                  </div>
                ) : (
                  <div className="empty-phone">
                    사진/영상을 업로드하세요
                  </div>
                )}
                <div className="shade" />
                <div className="brand-slot">{project.brand.logoText || 'BRAND'}</div>
                <div className={`copy ${selectedSlide.pos ?? 'bl'} text-loop te-${selectedSlide.textEnter || 'fade-up'}`}>
                  <span className="chip">{chipPreview}</span>
                  <TitlePreview title={selectedSlide.title} fontFamily={activeFont} accent={selectedSlide.accentColor} />
                  {selectedSlide.text ? (
                    <p className="sub-anim" style={{fontFamily: activeFont}}>
                      {selectedSlide.text}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="inspector">
          {selection.kind === 'intro' ? (
            <>
              <h2 className="section-title">인트로</h2>
              <label className="field">
                <span>타이틀</span>
                <input
                  value={project.title}
                  onChange={(e) => updateProject({title: e.target.value})}
                />
              </label>
              <label className="field">
                <span>서브</span>
                <input
                  value={project.subtitle}
                  onChange={(e) => updateProject({subtitle: e.target.value})}
                />
              </label>
              <label className="field">
                <span>브랜드</span>
                <input
                  value={project.brand.logoText ?? ''}
                  onChange={(e) =>
                    updateProject({brand: {...project.brand, logoText: e.target.value}})
                  }
                />
              </label>
              <label className="field">
                <span>글씨체</span>
                <select
                  value={project.fontFamily}
                  onChange={(e) => updateProject({fontFamily: e.target.value})}
                >
                  {FONT_OPTIONS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : selection.kind === 'outro' ? (
            <>
              <h2 className="section-title">아웃트로</h2>
              <label className="field">
                <span>브랜드</span>
                <input
                  value={project.brand.logoText ?? ''}
                  onChange={(e) =>
                    updateProject({brand: {...project.brand, logoText: e.target.value}})
                  }
                />
              </label>
              <label className="field">
                <span>CTA</span>
                <input
                  value={project.brand.handle ?? ''}
                  onChange={(e) =>
                    updateProject({brand: {...project.brand, handle: e.target.value}})
                  }
                />
              </label>
              <label className="field">
                <span>글씨체</span>
                <select
                  value={project.fontFamily}
                  onChange={(e) => updateProject({fontFamily: e.target.value})}
                >
                  {FONT_OPTIONS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : selectedSlide ? (
            <>
              <h2 className="section-title">
                뉴스 #{selectedIndex + 1}
                <button
                  className="btn danger"
                  type="button"
                  onClick={() => removeSlide(selectedSlide.id)}
                >
                  삭제
                </button>
              </h2>

              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/*"
                style={{display: 'none'}}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onPickMedia(f);
                  e.target.value = '';
                }}
              />
              <button
                className="btn"
                type="button"
                style={{width: '100%', marginBottom: 12}}
                onClick={() => fileRef.current?.click()}
              >
                사진 / 영상 업로드
              </button>

              <label className="field">
                <span>사진/영상 효과 (루프)</span>
                <select
                  value={selectedSlide.photoEffect || 'none'}
                  onChange={(e) =>
                    updateSlide(selectedSlide.id, {
                      photoEffect: e.target.value as PhotoEffect,
                    })
                  }
                >
                  {PHOTO_EFFECTS.map((fx) => (
                    <option key={fx.id} value={fx.id}>
                      {fx.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>① 제목·부제 전체 등장 효과 (통일)</span>
                <select
                  value={selectedSlide.textEnter || 'fade-up'}
                  onChange={(e) =>
                    updateSlide(selectedSlide.id, {
                      textEnter: e.target.value as TextEnter,
                    })
                  }
                >
                  {TEXT_ENTER_OPTIONS.map((fx) => (
                    <option key={fx.id} value={fx.id}>
                      {fx.label}
                    </option>
                  ))}
                </select>
                <em className="field-hint">
                  제목+부제가 함께 ~0.85초 안에 등장 → 끝난 뒤 부분 강조 (~0.9초). 글자 연출은 2초 이내 완료.
                </em>
              </label>

              <label className="field">
                <span>강조 색 (원 · 밑줄 · 띠 · 글로우 등)</span>
                <div className="color-row">
                  <input
                    type="color"
                    value={selectedSlide.accentColor || '#E03A2C'}
                    onChange={(e) =>
                      updateSlide(selectedSlide.id, {accentColor: e.target.value})
                    }
                    style={{height: 36, width: 56, padding: 2, cursor: 'pointer'}}
                  />
                  <input
                    type="text"
                    value={selectedSlide.accentColor || '#E03A2C'}
                    onChange={(e) =>
                      updateSlide(selectedSlide.id, {accentColor: e.target.value})
                    }
                    placeholder="#E03A2C"
                    style={{flex: 1}}
                  />
                </div>
              </label>

              <label className="field">
                <span>칩 텍스트 (비우면 자동 {selectedIndex + 1}/{project.slides.length})</span>
                <input
                  value={selectedSlide.chipText ?? ''}
                  onChange={(e) => updateSlide(selectedSlide.id, {chipText: e.target.value})}
                  placeholder={`${selectedIndex + 1}/${project.slides.length}`}
                />
              </label>

              <label className="field">
                <span>글씨체</span>
                <select
                  value={selectedSlide.fontFamily || ''}
                  onChange={(e) =>
                    updateSlide(selectedSlide.id, {
                      fontFamily: e.target.value || undefined,
                    })
                  }
                >
                  <option value="">프로젝트 기본</option>
                  {FONT_OPTIONS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="emphasis-block">
                <span className="field-label">② 부분 강조 (드래그 후 버튼 · 등장 후 시작)</span>
                <p className="field-hint">
                  제목에서 드래그 선택 후 버튼. 전체 등장이 끝난 다음에야 강조 애니메이션이 재생됩니다.
                </p>
                <div className="marker-bar">
                  {EMPHASIS_BTNS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      title={`${m.open}텍스트${m.close}`}
                      onClick={() => applyMarker(m.open, m.close)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="field">
                <span>제목 ({SLIDE_DURATION_SEC}초 영상 · 강조 루프 미리보기)</span>
                <textarea
                  ref={titleRef}
                  value={selectedSlide.title}
                  onChange={(e) => updateSlide(selectedSlide.id, {title: e.target.value})}
                  placeholder={'예: 세계 최초 @@플래그십@@ 오픈\n드래그 → 강조 버튼'}
                  style={{fontFamily: activeFont}}
                />
              </label>
              <label className="field">
                <span>보조 문구</span>
                <input
                  value={selectedSlide.text}
                  onChange={(e) => updateSlide(selectedSlide.id, {text: e.target.value})}
                  style={{fontFamily: activeFont}}
                />
              </label>
              <label className="field">
                <span>텍스트 위치</span>
                <select
                  value={selectedSlide.pos ?? 'bl'}
                  onChange={(e) =>
                    updateSlide(selectedSlide.id, {pos: e.target.value as Pos})
                  }
                >
                  {(Object.keys(POS_LABELS) as Pos[]).map((k) => (
                    <option key={k} value={k}>
                      {POS_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}

          {/* 다운로드 패널 — 일괄 제목 자리 대신 */}
          <div className="export-panel">
            <h2 className="section-title">다운로드</h2>
            <label className="field">
              <span>포맷</span>
              <select
                value={format}
                disabled={exporting}
                onChange={(e) => setFormat(e.target.value as ExportFormat)}
              >
                <option value="mp4">MP4</option>
                <option value="gif">GIF</option>
                <option value="webm">WebM</option>
              </select>
            </label>
            <button
              className="btn"
              type="button"
              style={{width: '100%', marginBottom: 8}}
              disabled={exporting}
              onClick={() => void currentDownload()}
            >
              {exporting ? exportLabel : `${currentDlLabel} (${format})`}
            </button>
            <button
              className="btn primary"
              type="button"
              style={{width: '100%'}}
              disabled={exporting}
              onClick={() => void runExport({kind: 'full'}, '전체 영상')}
            >
              {exporting ? exportLabel : `전체 영상 (${format})`}
            </button>
            <p className="hint">
              뉴스 1장 {SLIDE_DURATION_SEC}초 · 인트로/아웃트로 2.5초.
              MP4는 Chrome/Edge(WebCodecs H.264) 권장. 미지원·실패 시 WebM으로 자동 저장됩니다.
              ⌘Z 실행취소 · ⌘⇧Z 다시실행
            </p>
          </div>
        </aside>
      </div>

      {toast ? <div className="toast">{toast}</div> : null}
      {exporting ? (
        <div className="export-overlay">
          <div className="export-card">
            <div className="export-spin" />
            <strong>{exportLabel || '생성 중'}</strong>
            <p>프레임 렌더 후 {format.toUpperCase()}로 인코딩합니다.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
