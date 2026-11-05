/** 어드민 스키마 — 인트로/아웃트로 별도, 뉴스 최대 8장 */
export type Pos = 'bl' | 'br' | 'tl' | 'tr';

export type Brand = {
  logoImage?: string;
  logoText?: string;
  handle?: string;
  /** 로고 위치 이동량 (1080×1920 기준 px, 드래그로 조절) */
  logoOffset?: {x: number; y: number};
  /** 로고 크기 배율 (기본 1) */
  logoScale?: number;
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
  | 'soft-zoom'
  | 'rotate-drift'
  | 'tilt-pan'
  | 'punch-in'
  | 'handheld'
  | 'color-pop'
  | 'vignette-pull'
  | 'whip-in'
  | 'light-leak'
  | 'rack-focus'
  | 'float'
  | 'film-flicker'
  | 'dolly-out'
  | 'flash-in'
  | 'spin-settle';

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
  | 'rise-stagger'
  | 'pop-chars'
  | 'drop-chars'
  | 'word-up'
  | 'flip-in'
  | 'zoom-down'
  | 'split-center'
  | 'glitch-in'
  | 'bar-reveal'
  | 'blur-chars'
  | 'scramble'
  | 'mask-lines'
  | 'spring-up'
  | 'skew-in'
  | 'stamp-in';

/** 제목 뒤에 까는 배경 */
export type TextBackdrop = 'none' | 'line' | 'box' | 'band' | 'frost' | 'frost-box';

export const BACKDROP_OPTIONS: Array<{id: TextBackdrop; label: string}> = [
  {id: 'none', label: '없음'},
  {id: 'line', label: '가로선'},
  {id: 'box', label: '글자 뒤 상자'},
  {id: 'band', label: '아래 전체 띠'},
  {id: 'frost', label: '흐린 유리 띠'},
  {id: 'frost-box', label: '흐린 유리 상자'},
];

/** 슬라이드 시작 전환 (앞 0.45초). 'cut' = 바로 시작 */
export type SlideTransition =
  | 'cut'
  | 'fade'
  | 'zoom-blur'
  | 'slide-up'
  | 'push-left'
  | 'iris'
  | 'wipe-accent'
  | 'shutter'
  | 'flash'
  | 'glitch'
  | 'blinds'
  | 'diagonal-wipe'
  | 'color-block'
  | 'spin-in'
  | 'split-doors'
  | 'wave'
  | 'liquid';

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
  transition?: SlideTransition;
  /** 원·밑줄·띠·전환 등 강조색 */
  accentColor?: string;
  /** 제목·부제 글자색 */
  textColor?: string;
  /** 번호 칩 색 */
  chipColor?: string;
  /** 형광펜·박스·숫자 강조색 */
  highlightColor?: string;
  /** 위아래 어둡게 깔기 0(없음)~1(기본)~2(진하게) */
  shade?: number;
  /** 번호 칩 보이기 (기본 숨김) */
  showChip?: boolean;
  /** 제목 묶음 위치 이동량 (1080×1920 기준 px, 드래그로 조절) */
  textOffset?: {x: number; y: number};
  /** 제목·부제 크기 배율 (기본 1) */
  textScale?: number;
  /** 글자 뒤 배경 */
  backdrop?: TextBackdrop;
  /** 배경 색 (기본: 상자·띠는 검정, 유리는 흰색) */
  backdropColor?: string;
  /** 배경 진하기 0~1 */
  backdropOpacity?: number;
};

export type Project = {
  /** 프로젝트 이름 (파일 이름 등에 사용) */
  title: string;
  subtitle?: string;
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
  {id: 'dohyeon', label: '도현', css: '"Do Hyeon", Pretendard, sans-serif'},
  {id: 'jua', label: '주아', css: 'Jua, Pretendard, sans-serif'},
  {id: 'gowundodum', label: '고운돋움', css: '"Gowun Dodum", Pretendard, sans-serif'},
  {id: 'gowunbatang', label: '고운바탕', css: '"Gowun Batang", serif'},
  {id: 'hahmlet', label: '함렛', css: 'Hahmlet, serif'},
  {id: 'orbit', label: '오르빗', css: 'Orbit, Pretendard, sans-serif'},
  {id: 'nanumpen', label: '나눔손글씨 펜', css: '"Nanum Pen Script", Pretendard, sans-serif'},
  {id: 'nanumbrush', label: '나눔손글씨 붓', css: '"Nanum Brush Script", Pretendard, sans-serif'},
  {id: 'yeonsung', label: '연성', css: '"Yeon Sung", Pretendard, sans-serif'},
  {id: 'dongle', label: '동글', css: 'Dongle, Pretendard, sans-serif'},
  {id: 'bagel', label: '베이글', css: '"Bagel Fat One", Pretendard, sans-serif'},
  {id: 'gasoek', label: '가석', css: '"Gasoek One", Pretendard, sans-serif'},
  {id: 'cute', label: '귀여운', css: '"Cute Font", Pretendard, sans-serif'},
  {id: 'kirang', label: '기랑해랑', css: '"Kirang Haerang", Pretendard, sans-serif'},
  {id: 'diphylleia', label: '디필레이아', css: 'Diphylleia, serif'},
  {id: 'moirai', label: '모이라이', css: '"Moirai One", Pretendard, sans-serif'},
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
  {id: 'rotate-drift', label: '살짝 회전'},
  {id: 'tilt-pan', label: '대각선 팬'},
  {id: 'punch-in', label: '펀치 인 (훅 확대)'},
  {id: 'handheld', label: '핸드헬드 흔들림'},
  {id: 'color-pop', label: '흑백→컬러'},
  {id: 'vignette-pull', label: '비네트 집중'},
  {id: 'whip-in', label: '휙 들어오기'},
  {id: 'light-leak', label: '빛 번짐'},
  {id: 'rack-focus', label: '초점 맞추기'},
  {id: 'float', label: '둥둥 떠다니기'},
  {id: 'film-flicker', label: '필름 깜빡임'},
  {id: 'dolly-out', label: '빠르게 물러나기'},
  {id: 'flash-in', label: '밝게 번쩍'},
  {id: 'spin-settle', label: '돌며 자리 잡기'},
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
  {id: 'pop-chars', label: '글자별 팝'},
  {id: 'drop-chars', label: '글자 떨어지기'},
  {id: 'word-up', label: '단어별 상승'},
  {id: 'flip-in', label: '플립 인'},
  {id: 'zoom-down', label: '크게→제자리'},
  {id: 'split-center', label: '가운데서 열리기'},
  {id: 'glitch-in', label: '글리치 인'},
  {id: 'bar-reveal', label: '색 막대 공개'},
  {id: 'blur-chars', label: '글자별 초점'},
  {id: 'scramble', label: '문자 섞였다 맞춰지기'},
  {id: 'mask-lines', label: '줄마다 밀려 올라오기'},
  {id: 'spring-up', label: '스프링 상승'},
  {id: 'skew-in', label: '기울어져 들어오기'},
  {id: 'stamp-in', label: '도장 쾅'},
];

export const TRANSITION_OPTIONS: Array<{id: SlideTransition; label: string}> = [
  {id: 'cut', label: '없음'},
  {id: 'fade', label: '디졸브 (겹쳐 넘기기)'},
  {id: 'zoom-blur', label: '줌 블러'},
  {id: 'slide-up', label: '아래서 밀어 올리기'},
  {id: 'push-left', label: '오른쪽에서 밀기'},
  {id: 'iris', label: '원형으로 열기'},
  {id: 'wipe-accent', label: '강조색 와이프'},
  {id: 'shutter', label: '셔터 열기'},
  {id: 'flash', label: '플래시'},
  {id: 'glitch', label: '글리치'},
  {id: 'blinds', label: '블라인드'},
  {id: 'diagonal-wipe', label: '대각선 와이프'},
  {id: 'color-block', label: '색 판 걷히기'},
  {id: 'spin-in', label: '돌며 들어오기'},
  {id: 'split-doors', label: '양쪽 문 열기'},
  {id: 'wave', label: '물결 올라오기'},
  {id: 'liquid', label: '물결 옆으로 쓸기'},
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
  {id: 'spark', label: '반짝', open: '&&', close: '&&'},
  {id: 'shine', label: '금빛 스윕', open: '$$', close: '$$'},
  {id: 'pop', label: '팝', open: '||', close: '||'},
  {id: 'count', label: '카운트업', open: ';;', close: ';;'},
  {id: 'scribble', label: '낙서밑줄', open: '[~', close: '~]'},
  {id: 'arrow', label: '화살표', open: '(>', close: '<)'},
];

/** 슬라이드 길이(초) — 미리보기 안내에도 사용 */
export const SLIDE_DURATION_SEC = 8;

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
    transition: 'cut',
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
    brand: {logoText: ''},
    fontFamily: 'pretendard',
    slides: [emptySlide(0)],
  };
}

export function defaultChip(index: number, total: number, custom?: string): string {
  const t = custom?.trim();
  if (t) return t;
  return `${index}/${total}`;
}
