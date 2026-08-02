/** 어드민 ↔ 영상 렌더 공통 스키마 (최대 8장, 기본 시작은 1장) */
export type Pos = 'bl' | 'br' | 'tl' | 'tr';

export type Brand = {
  logoImage?: string;
  logoText?: string;
  handle?: string;
};

export type Slide = {
  id: string;
  /** public/ 상대경로 또는 blob: URL (어드민 미리보기용) */
  image: string;
  /** 렌더용 public 경로 — blob이면 업로드 후 채워짐 */
  renderPath?: string;
  title: string;
  text: string;
  pos?: Pos;
  mediaKind: 'image' | 'video';
};

export type Project = {
  title: string;
  subtitle: string;
  brand: Brand;
  slides: Slide[];
};

export type ReelData = {
  title: string;
  subtitle?: string;
  brand?: Brand;
  slides: Array<{
    image: string;
    title?: string;
    text?: string;
    pos?: Pos;
  }>;
};

export const MAX_SLIDES = 8;

export const POS_LABELS: Record<Pos, string> = {
  bl: '좌하단',
  br: '우하단',
  tl: '좌상단',
  tr: '우상단',
};

export const EMPHASIS_MARKERS = [
  {label: '형광펜', open: '==', close: '==', tip: '==강조=='},
  {label: '동그라미', open: '@@', close: '@@', tip: '@@강조@@'},
  {label: '밑줄', open: '__', close: '__', tip: '__강조__'},
  {label: '박스', open: '[[', close: ']]', tip: '[[강조]]'},
  {label: '취소선', open: '~~', close: '~~', tip: '~~강조~~'},
  {label: '타이핑', open: '%%', close: '%%', tip: '%%강조%%'},
  {label: '숫자슬롯', open: '##', close: '##', tip: '##1,234##'},
  {label: '빨간강조', open: '++', close: '++', tip: '++강조++'},
] as const;

export function makeId(prefix = 's'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function emptySlide(index: number): Slide {
  const cycle: Pos[] = ['bl', 'tr', 'br', 'tl'];
  return {
    id: makeId('slide'),
    image: '',
    title: '',
    text: '',
    pos: cycle[index % 4],
    mediaKind: 'image',
  };
}

export function createDefaultProject(): Project {
  return {
    title: '카드뉴스',
    subtitle: new Date().toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    }),
    brand: {logoText: '{로고 넣는 자리}', handle: '{주소}'},
    // 처음부터 8장 깔아두지 않음 — 1장 예시로 시작
    slides: [emptySlide(0)],
  };
}

/** 렌더 props JSON으로 변환 (빈 슬라이드 제외, 최대 8) */
export function toReelData(project: Project): ReelData {
  const slides = project.slides
    .filter((s) => s.image || s.title || s.text)
    .slice(0, MAX_SLIDES)
    .map((s) => ({
      image: s.renderPath || s.image.replace(/^\//, ''),
      title: s.title || undefined,
      text: s.text || undefined,
      pos: s.pos,
    }));

  return {
    title: project.title || '카드뉴스',
    subtitle: project.subtitle || undefined,
    brand: project.brand,
    slides:
      slides.length > 0
        ? slides
        : [{image: 'photos/demo/01.jpg', title: '빈 프로젝트', text: '슬라이드를 채워 주세요'}],
  };
}
