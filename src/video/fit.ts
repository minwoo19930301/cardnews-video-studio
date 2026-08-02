// 텍스트 폭 추정 기반 자동 폰트 축소 — 약한 모델이 글자수 한도를 넘겨도 화면 밖으로 안 나가게
// 한글은 1em, 대문자/기호 0.72em, 소문자/숫자 0.58em, 나머지 0.42em로 근사
const charEm = (ch: string): number => {
  if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(ch)) return 1;
  if (/[A-Z€$@%&₩#]/.test(ch)) return 0.72;
  if (/[a-z0-9]/.test(ch)) return 0.58;
  return 0.42;
};

export const estimateEm = (s: string): number =>
  [...s].reduce((w, ch) => w + charEm(ch), 0);

// lines의 가장 긴 줄이 availPx 안에 들어가도록 base 이하로 폰트 크기 조정
export const fitFontSize = (lines: string[], base: number, availPx: number): number => {
  const maxEm = Math.max(...lines.map((l) => estimateEm(l.replace(/==/g, ''))), 0.01);
  return Math.min(base, Math.floor(availPx / maxEm));
};
