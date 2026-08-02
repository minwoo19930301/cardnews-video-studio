/** 어드민 스키마 — 인트로/아웃트로 별도, 뉴스 최대 8장 */
export type Pos = 'bl' | 'br' | 'tl' | 'tr';

export type Brand = {
  logoImage?: string;
  logoText?: string;
  handle?: string;
};

export type PhotoEffect =
  | 'none'
  | 'ken-in'
  | 'ken-out'
  | 'pan-left'
  | 'pan-right'
  | 'zoom-pulse'
  | 'fade-rise'
  | 'blur-sharp'
  | 'drift-up'
  | 'soft-zoom';

/** 제목 전체 등장 효과 (선택 강조와 별개, 제목 블록 통째로) */
export type TextEnter =
  | 'none'
  | 'fade-up'
  | 'mask-up'
  | 'scale-in'
  | 'blur-in'
  | 'slide-left'
  | 'bounce-in'
  | 'type-block'
  | 'line-draw'
  | 'wipe-right'
  | 'rise-stagger';

export type Slide = {
  id: string;
  image: string;
  renderPath?: string;
  title: string;
  text: string;
  pos?: Pos;
  mediaKind: 'image' | 'video';
  fontFamily?: string;
  chipText?: string;
  photoEffect?: PhotoEffect;
  textEnter?: TextEnter;
  accentColor?: string;
};

export type Project = {
  title: string;
  subtitle: string;
  brand: Brand;
  slides: Slide[];
  fontFamily: string;
};

export const MAX_SLIDES = 8;

export const POS_LABELS: Record<Pos, string> = {
  bl: '좌하단',
  br: '우하단',
  tl: '좌상단',
  tr: '우상단',
};

export const FONT_OPTIONS: Array<{id: string; label: string; css: string}> = [
  {id: 'pretendard', label: '프리텐다드', css: 'Pretendard, "Apple SD Gothic Neo", sans-serif'},
  {id: 'gmarket', label: '지마켓 산스', css: '"Gmarket Sans", Pretendard, sans-serif'},
  {id: 'noto', label: '노토 산스 KR', css: '"Noto Sans KR", Pretendard, sans-serif'},
  {id: 'gothicA1', label: '고딕 A1', css: '"Gothic A1", Pretendard, sans-serif'},
  {id: 'nanumgothic', label: '나눔고딕', css: '"Nanum Gothic", Pretendard, sans-serif'},
  {id: 'nanummyeongjo', label: '나눔명조', css: '"Nanum Myeongjo", serif'},
  {id: 'ibmplex', label: 'IBM Plex Sans KR', css: '"IBM Plex Sans KR", Pretendard, sans-serif'},
  {id: 'sunflower', label: '선플라워', css: 'Sunflower, Pretendard, sans-serif'},
  {id: 'gaegu', label: '개을', css: 'Gaegu, Pretendard, sans-serif'},
  {id: 'stylish', label: '스타일리시', css: 'Stylish, Pretendard, sans-serif'},
  {id: 'blackhan', label: '검은고딕', css: '"Black Han Sans", Pretendard, sans-serif'},
  {id: 'songmyung', label: '송명', css: '"Song Myung", "Nanum Myeongjo", serif'},
  {id: 'poorstory', label: '푸어 스토리', css: '"Poor Story", Pretendard, sans-serif'},
  {id: 'singleday', label: '싱글데이', css: '"Single Day", Pretendard, sans-serif'},
  {id: 'gamja', label: '감자꽃', css: '"Gamja Flower", Pretendard, sans-serif'},
  {id: 'himelody', label: '하이멜로디', css: '"Hi Melody", Pretendard, sans-serif'},
  {id: 'dokdo', label: '독도체', css: '"East Sea Dokdo", Pretendard, sans-serif'},
];

export const PHOTO_EFFECTS: Array<{id: PhotoEffect; label: string}> = [
  {id: 'none', label: '효과 없음'},
  {id: 'ken-in', label: '천천히 확대'},
  {id: 'ken-out', label: '천천히 축소'},
  {id: 'pan-left', label: '왼쪽 팬'},
  {id: 'pan-right', label: '오른쪽 팬'},
  {id: 'zoom-pulse', label: '줌 펄스'},
  {id: 'fade-rise', label: '페이드 업'},
  {id: 'blur-sharp', label: '블러→선명'},
  {id: 'drift-up', label: '위로 드리프트'},
  {id: 'soft-zoom', label: '소프트 줌'},
];

export const TEXT_ENTER_OPTIONS: Array<{id: TextEnter; label: string}> = [
  {id: 'none', label: '등장 없음'},
  {id: 'fade-up', label: '아래에서 페이드'},
  {id: 'mask-up', label: '마스크 슬라이드 업'},
  {id: 'scale-in', label: '스케일 인'},
  {id: 'blur-in', label: '블러 인'},
  {id: 'slide-left', label: '왼쪽에서 슬라이드'},
  {id: 'bounce-in', label: '바운스 인'},
  {id: 'type-block', label: '한 글자씩 (전체)'},
  {id: 'line-draw', label: '선 그리며 등장'},
  {id: 'wipe-right', label: '왼쪽→오른쪽 와이프'},
  {id: 'rise-stagger', label: '줄 단위 상승'},
];

export const EMPHASIS_BTNS: Array<{id: string; label: string; open: string; close: string}> = [
  {id: 'hl', label: '형광펜', open: '==', close: '=='},
  {id: 'circle', label: '색연필원', open: '@@', close: '@@'},
  {id: 'under', label: '밑줄', open: '__', close: '__'},
  {id: 'box', label: '박스', open: '[[', close: ']]'},
  {id: 'strike', label: '취소선', open: '~~', close: '~~'},
  {id: 'type', label: '타이핑', open: '%%', close: '%%'},
  {id: 'slot', label: '숫자슬롯', open: '##', close: '##'},
  {id: 'redhl', label: '빨간띠', open: '++', close: '++'},
  {id: 'glow', label: '글로우', open: '**', close: '**'},
  {id: 'outline', label: '외곽선', open: '::', close: '::'},
  {id: 'stamp', label: '스탬프', open: '<<', close: '>>'},
  {id: 'shake', label: '흔들림', open: '!!', close: '!!'},
  {id: 'bounce', label: '통통', open: '^^', close: '^^'},
  {id: 'wave', label: '물결선', open: '≈≈', close: '≈≈'},
  {id: 'fill', label: '채움강조', open: '{{', close: '}}'},
];

/** 슬라이드 길이(초) — 미리보기 안내에도 사용 */
export const SLIDE_DURATION_SEC = 8;
export const INTRO_DURATION_SEC = 2.5;
export const OUTRO_DURATION_SEC = 2.5;

export const EMPHASIS_MARKERS = EMPHASIS_BTNS;

export function fontCss(id?: string): string {
  return FONT_OPTIONS.find((f) => f.id === id)?.css ?? FONT_OPTIONS[0].css;
}

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
    chipText: '',
    photoEffect: 'none',
    textEnter: 'fade-up',
    accentColor: '#E03A2C',
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
    fontFamily: 'pretendard',
    slides: [emptySlide(0)],
  };
}

export function defaultChip(index: number, total: number, custom?: string): string {
  const t = custom?.trim();
  if (t) return t;
  return `${index}/${total}`;
}
