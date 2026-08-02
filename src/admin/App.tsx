import {useEffect, useMemo, useRef, useState} from 'react';
import sample from '../../data/sample.json';
import {parseFx, wrapSelection} from './markers';
import {
  EMPHASIS_MARKERS,
  MAX_SLIDES,
  POS_LABELS,
  createDefaultProject,
  emptySlide,
  makeId,
  toReelData,
  type Pos,
  type Project,
  type Slide,
} from './types';

// v2: 기본 1장 시작 (이전 8장 캐시 무시)
const STORAGE_KEY = 'cardnews-video-studio:project:v2';

function loadProject(): Project {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Project;
  } catch {
    /* ignore */
  }
  // 예시 1장만 — sample.json의 첫 슬라이드
  const base = createDefaultProject();
  const first = (sample.slides?.[0] ?? null) as
    | {image: string; title?: string; text?: string; pos?: Pos}
    | null;
  if (!first) return base;
  return {
    title: '카드뉴스',
    subtitle: base.subtitle,
    brand: {
      logoText: sample.brand?.logoText ?? base.brand.logoText,
      handle: sample.brand?.handle ?? base.brand.handle,
    },
    slides: [
      {
        id: makeId('slide'),
        image: `/${first.image}`,
        renderPath: first.image,
        title: first.title ?? '제목을 입력하세요',
        text: first.text ?? '',
        pos: first.pos ?? 'bl',
        mediaKind: 'image',
      },
    ],
  };
}

function TitlePreview({title}: {title: string}) {
  const lines = (title || '제목을 입력하세요').split('\n');
  return (
    <h1>
      {lines.map((line, li) => (
        <span key={li}>
          {li > 0 ? <br /> : null}
          {parseFx(line).map((tok, i) => {
            if (tok.fx === 'none') return <span key={i}>{tok.text}</span>;
            return (
              <span key={i} className={`fx-${tok.fx === 'redhl' ? 'redhl' : tok.fx === 'hl' ? 'hl' : tok.fx}`}>
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
  const [selectedId, setSelectedId] = useState(() => project.slides[0]?.id ?? '');
  const [toast, setToast] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => project.slides.find((s) => s.id === selectedId) ?? project.slides[0],
    [project.slides, selectedId],
  );
  const selectedIndex = project.slides.findIndex((s) => s.id === selected?.id);
  const filledCount = project.slides.filter((s) => s.image || s.title || s.text).length;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  }, [project]);

  useEffect(() => {
    if (!playing || project.slides.length < 2) return;
    const ids = project.slides.map((s) => s.id);
    const timer = window.setInterval(() => {
      setSelectedId((cur) => {
        const i = ids.indexOf(cur);
        return ids[(i + 1) % ids.length];
      });
    }, 2200);
    return () => window.clearInterval(timer);
  }, [playing, project.slides]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const updateProject = (patch: Partial<Project>) => setProject((p) => ({...p, ...patch}));
  const updateSlide = (id: string, patch: Partial<Slide>) =>
    setProject((p) => ({
      ...p,
      slides: p.slides.map((s) => (s.id === id ? {...s, ...patch} : s)),
    }));

  const addSlide = () => {
    if (project.slides.length >= MAX_SLIDES) {
      setToast(`최대 ${MAX_SLIDES}장까지 가능합니다`);
      return;
    }
    const slide = emptySlide(project.slides.length);
    setProject((p) => ({...p, slides: [...p.slides, slide]}));
    setSelectedId(slide.id);
  };

  const fillToEight = () => {
    setProject((p) => {
      const slides = [...p.slides];
      while (slides.length < MAX_SLIDES) slides.push(emptySlide(slides.length));
      return {...p, slides: slides.slice(0, MAX_SLIDES)};
    });
    setToast('8장 슬롯을 준비했습니다');
  };

  const removeSlide = (id: string) => {
    if (project.slides.length <= 1) {
      setToast('최소 1장은 필요합니다');
      return;
    }
    setProject((p) => {
      const slides = p.slides.filter((s) => s.id !== id);
      return {...p, slides};
    });
    if (selectedId === id) {
      const next = project.slides.find((s) => s.id !== id);
      if (next) setSelectedId(next.id);
    }
  };

  const onPickMedia = (file: File) => {
    if (!selected) return;
    const url = URL.createObjectURL(file);
    const kind = file.type.startsWith('video') ? 'video' : 'image';
    // 렌더 경로: 사용자가 public/photos 아래에 두면 맞출 수 있게 파일명 제안
    const safe = file.name.replace(/[^\w.\-가-힣]/g, '_');
    updateSlide(selected.id, {
      image: url,
      mediaKind: kind,
      renderPath: `photos/uploads/${safe}`,
    });
    setToast(
      `미디어 미리보기 반영. 렌더 시 public/photos/uploads/${safe} 에 같은 파일을 두세요.`,
    );
  };

  const applyMarker = (open: string, close: string) => {
    const el = titleRef.current;
    if (!el || !selected) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const {next, cursor} = wrapSelection(selected.title, start, end, open, close);
    updateSlide(selected.id, {title: next});
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  };

  const exportJson = () => {
    const reel = toReelData(project);
    const blob = new Blob([JSON.stringify(reel, null, 2)], {type: 'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'content.json';
    a.click();
    setToast('content.json 다운로드 — data/content.json 저장 후 npm run render');
  };

  const copyJson = async () => {
    const reel = toReelData(project);
    await navigator.clipboard.writeText(JSON.stringify(reel, null, 2));
    setToast('클립보드에 렌더용 JSON 복사됨');
  };

  const resetSample = () => {
    localStorage.removeItem(STORAGE_KEY);
    const next = loadProject();
    setProject(next);
    setSelectedId(next.slides[0].id);
    setToast('1장 예시로 초기화');
  };

  if (!selected) return null;

  const mediaSrc = selected.image;
  const pos = selected.pos ?? 'bl';

  return (
    <div className="studio">
      <header className="topbar">
        <div className="brand">
          <mark>✦</mark>
          <span>CARDNEWS VIDEO STUDIO</span>
          <small>최대 {MAX_SLIDES}장 · 1080×1920 세로 영상</small>
        </div>
        <div className="top-actions">
          <button className="btn ghost" type="button" onClick={resetSample}>
            샘플
          </button>
          <button className="btn" type="button" onClick={copyJson}>
            JSON 복사
          </button>
          <button className="btn" type="button" onClick={exportJson}>
            content.json
          </button>
          <button className="btn primary" type="button" onClick={exportJson}>
            내보내기 → 렌더
          </button>
        </div>
      </header>

      <div className="layout">
        <aside className="rail">
          <h2 className="section-title">
            슬라이드
            <span className="badge">
              {filledCount}/{MAX_SLIDES}
            </span>
          </h2>
          <div className="slide-list">
            {project.slides.map((slide, i) => (
              <button
                key={slide.id}
                type="button"
                className={`slide-card${slide.id === selected.id ? ' active' : ''}`}
                onClick={() => setSelectedId(slide.id)}
              >
                <div
                  className="thumb"
                  style={
                    slide.image
                      ? {backgroundImage: slide.mediaKind === 'image' ? `url(${slide.image})` : undefined}
                      : undefined
                  }
                />
                <div className="meta">
                  <span className="idx">
                    {i + 1}/{project.slides.length}
                  </span>
                  <strong>{slide.title?.split('\n')[0] || '빈 슬라이드'}</strong>
                </div>
              </button>
            ))}
          </div>
          <div className="add-row">
            <button className="btn" type="button" onClick={addSlide} disabled={project.slides.length >= MAX_SLIDES}>
              + 장 추가
            </button>
            <button className="btn" type="button" onClick={fillToEight}>
              8장 맞추기
            </button>
          </div>
          <p className="hint">
            기본은 1장 예시. 필요하면 + 장 추가 / 8장 맞추기로 늘린 뒤
            미디어·제목·강조를 채우고 한 번에 영상으로 내보냅니다.
          </p>
        </aside>

        <section className="canvas">
          <div className="canvas-toolbar">
            <span>
              미리보기 · {selectedIndex + 1}/{project.slides.length} · 9:16
            </span>
            <button className="btn" type="button" onClick={() => setPlaying((v) => !v)}>
              {playing ? '정지' : '전체 재생'}
            </button>
          </div>
          <div className="canvas-stage">
            <div className="phone">
              {mediaSrc ? (
                selected.mediaKind === 'video' ? (
                  <video className="media" src={mediaSrc} autoPlay muted loop playsInline />
                ) : (
                  <img className="media" src={mediaSrc} alt="" />
                )
              ) : (
                <div className="empty-phone">사진/영상을 업로드하면
                  <br />여기에 미리보기가 표시됩니다</div>
              )}
              <div className="shade" />
              <div className="brand-slot">{project.brand.logoText || 'BRAND'}</div>
              <div className={`copy ${pos}`}>
                <span className="chip">
                  {selectedIndex + 1}/{project.slides.length}
                </span>
                <TitlePreview title={selected.title} />
                {selected.text ? <p>{selected.text}</p> : null}
              </div>
            </div>
          </div>
        </section>

        <aside className="inspector">
          <h2 className="section-title">프로젝트</h2>
          <label className="field">
            <span>인트로 타이틀</span>
            <input
              value={project.title}
              onChange={(e) => updateProject({title: e.target.value})}
              placeholder="오늘의 뉴스 8"
            />
          </label>
          <label className="field">
            <span>서브 (날짜 등)</span>
            <input
              value={project.subtitle}
              onChange={(e) => updateProject({subtitle: e.target.value})}
            />
          </label>
          <label className="field">
            <span>브랜드 로고 텍스트</span>
            <input
              value={project.brand.logoText ?? ''}
              onChange={(e) =>
                updateProject({brand: {...project.brand, logoText: e.target.value}})
              }
            />
          </label>
          <label className="field">
            <span>아웃트로 CTA</span>
            <input
              value={project.brand.handle ?? ''}
              onChange={(e) =>
                updateProject({brand: {...project.brand, handle: e.target.value}})
              }
            />
          </label>

          <h2 className="section-title" style={{marginTop: 18}}>
            선택 슬라이드 #{selectedIndex + 1}
            <button className="btn danger" type="button" onClick={() => removeSlide(selected.id)}>
              삭제
            </button>
          </h2>

          <input
            ref={fileRef}
            className="visually-hidden"
            type="file"
            accept="image/*,video/*"
            style={{display: 'none'}}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPickMedia(f);
              e.target.value = '';
            }}
          />
          <button className="btn" type="button" style={{width: '100%', marginBottom: 12}} onClick={() => fileRef.current?.click()}>
            사진 / 영상 업로드
          </button>
          <label className="field">
            <span>렌더 경로 (public/ 기준)</span>
            <input
              value={selected.renderPath || selected.image.replace(/^\//, '')}
              onChange={(e) =>
                updateSlide(selected.id, {
                  renderPath: e.target.value,
                  image: e.target.value.startsWith('blob:')
                    ? selected.image
                    : `/${e.target.value.replace(/^\//, '')}`,
                })
              }
              placeholder="photos/uploads/01.jpg"
            />
          </label>

          <div className="marker-bar">
            {EMPHASIS_MARKERS.map((m) => (
              <button
                key={m.label}
                type="button"
                title={m.tip}
                onClick={() => applyMarker(m.open, m.close)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <label className="field">
            <span>제목 (줄바꿈 최대 2줄 · 마커로 강조)</span>
            <textarea
              ref={titleRef}
              value={selected.title}
              onChange={(e) => updateSlide(selected.id, {title: e.target.value})}
              placeholder={'예: 세계 최초 @@플래그십@@ 오픈\n성수동에 상륙'}
            />
          </label>
          <label className="field">
            <span>보조 문구</span>
            <input
              value={selected.text}
              onChange={(e) => updateSlide(selected.id, {text: e.target.value})}
              placeholder="한 줄 설명"
            />
          </label>
          <label className="field">
            <span>텍스트 위치</span>
            <select
              value={pos}
              onChange={(e) => updateSlide(selected.id, {pos: e.target.value as Pos})}
            >
              {(Object.keys(POS_LABELS) as Pos[]).map((k) => (
                <option key={k} value={k}>
                  {POS_LABELS[k]}
                </option>
              ))}
            </select>
          </label>

          <div className="batch">
            <h2 className="section-title">
              8장 일괄 편집
              <span className="badge">제목 빠른 입력</span>
            </h2>
            <p className="hint" style={{marginTop: 0}}>
              한 장씩 고르지 않고 여기서 제목만 쭉 채울 수 있습니다. 미디어는 각 장 선택 후 업로드.
            </p>
            <div className="batch-grid">
              {project.slides.map((slide, i) => (
                <div key={slide.id} className="batch-row">
                  <div className="n">{i + 1}</div>
                  <div>
                    <textarea
                      value={slide.title}
                      placeholder={`슬라이드 ${i + 1} 제목`}
                      onFocus={() => setSelectedId(slide.id)}
                      onChange={(e) => updateSlide(slide.id, {title: e.target.value})}
                    />
                    <input
                      value={slide.text}
                      placeholder="보조 문구"
                      onFocus={() => setSelectedId(slide.id)}
                      onChange={(e) => updateSlide(slide.id, {text: e.target.value})}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="hint">
            내보내기 후: <code>data/content.json</code> 저장 → <code>npm run render</code>
            <br />
            프레임 단위 미리보기: <code>npm run studio</code>
          </p>
        </aside>
      </div>

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
