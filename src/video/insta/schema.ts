// 콘텐츠 JSON 스키마 — 에이전트가 작성하는 유일한 산출물
export type Brand = {
  logoImage?: string; // public/ 기준 로고 이미지 경로 (흰색 로고 권장) — 없으면 logoText 사용
  logoText?: string; // 기본 "{로고 넣는 자리}"
  handle?: string; // 아웃트로 CTA — 기본 "{주소}"
};

export type Slide = {
  image: string; // public/ 기준 상대경로 (이미지 JPG/PNG, 애니메이션 GIF, 동영상 MP4/WEBM 모두 지원)
  title?: string; // \n 최대 2줄 — 강조 마커: ==형광펜== @@동그라미@@ __밑줄__ [[박스]] ~~취소선~~ %%타이핑%% ##숫자슬롯##
  text?: string; // 보조 한 줄
  pos?: 'bl' | 'br' | 'tl' | 'tr'; // 생략 시 bl→tr→br→tl 자동 순환
};

export type ReelData = {
  title: string; // 인트로 타이틀 (예: "오늘의 뉴스 6")
  subtitle?: string; // 인트로 서브 (예: 날짜)
  brand?: Brand;
  slides: Slide[]; // 6~8장 권장
};
