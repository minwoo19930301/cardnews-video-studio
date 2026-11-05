# 모션 레시피

이 저장소에서 모션을 만들 때 쓰는 도구와 규칙입니다. 사람과 에이전트가 같이 봅니다.
모든 모션은 `src/engine/render.ts` 한 곳에서 그리고, 미리보기·브라우저 내보내기·MCP 가 같은 코드를 씁니다.

## 원칙

- 프레임은 시간 `t`(초)만 보고 그립니다. 이전 프레임 상태를 기억하지 않습니다. 그래야 아무 시점이나 바로 그릴 수 있고 미리보기 탐색이 됩니다.
- 난수는 `Math.random()` 대신 `hash01(n)` 을 씁니다. 같은 입력이면 같은 값이 나와서 영상이 매번 똑같습니다.
- 글자 연출은 앞 1.5초 안에 끝냅니다. 등장 0.6초 → 부분 강조 0.6초 → 나머지는 멈춰서 읽게 둡니다.
- 전환은 0.45초입니다. 길면 지루하고, 짧으면 안 보입니다.
- 전환은 앞 장의 마지막 화면 위에서 일어납니다. 밀기·디졸브처럼 겹치는 전환은 앞 장도 함께 움직이고, 셔터·문·색 판·플래시·글리치는 앞 절반에 앞 장을 덮고 뒤 절반에 지금 장을 드러냅니다.
- 색은 하드코딩하지 않고 `Palette`(글자·강조·칩·하이라이트)에서 가져옵니다.

## 도구 (`src/engine/easing.ts`)

| 이름 | 쓰는 곳 |
|---|---|
| `easeOutCubic` `easeOutQuart` `easeOutQuint` | 들어오는 움직임 기본값. 숫자가 클수록 끝이 더 부드럽게 멈춥니다 |
| `easeOutExpo` | 확 들어와서 오래 미끄러지는 느낌 (카운트업, 빠른 줌아웃) |
| `easeInOutCubic` `easeEditorial` | 화면 전체가 움직이는 와이프·셔터처럼 시작과 끝이 다 보이는 움직임 |
| `easeOutBack` | 살짝 넘쳤다 돌아오기 (팝, 플립) |
| `easeOutElastic` `easeOutBounce` | 고무줄·튕김. 장난스러운 톤에서만 |
| `cubicBezier(x1,y1,x2,y2)` | 디자이너가 CSS 값으로 준 곡선을 그대로 쓸 때 |
| `spring(sec, stiffness, damping)` | 물리 스프링. 길이를 정하지 않고 자연스럽게 멈춤 (도장 쾅, 돌며 들어오기) |
| `stagger(sec, i, n, total, dur)` | 글자·단어·줄을 차례로. 전체 시간 안에 맞춰 간격 자동 계산 |
| `keyframes(t, [[t,v],...], ease)` | 여러 단계 움직임 (초점 흐림→선명→살짝 흔들림) |
| `noise1(x)` | 부드러운 떨림 (핸드헬드, 둥둥) |
| `hash01(n)` | 결정적 난수 (글리치 띠 위치, 스크램블 글자) |

스프링 값 기준: `spring(t, 170, 14)` 보통, `(220, 16)` 빠르고 단정, `(380, 20)` 탁 박힘, `(120, 11)` 출렁임.

## 자주 쓰는 패턴

- **마스크 등장**: 글자 영역만 `clip()` 하고 아래에서 밀어 올리기 (`mask-lines`).
- **오버슈트**: 크기를 1.3배까지 키웠다가 1로 (`pop`, `stamp-in`).
- **스태거**: 한 줄을 글자 단위로 쪼개 시작 시간을 조금씩 밀기. 전체 등장 시간 안에 간격을 맞춥니다 (`pop-chars`, `blur-chars`, `scramble`). 새로 만들 땐 `stagger()` 를 쓰면 됩니다.
- **흐림→선명**: `ctx.filter = blur(px)` 를 0 으로 (`blur-in`, `rack-focus`).
- **색 판 걷기**: 강조색 사각형을 덮었다가 치우기 (`color-block`, `split-doors`, `bar-reveal`).
- **RGB 어긋남**: 빨강·청록 잔상을 좌우로 (`glitch-in`, `glitch`).
- **카운트업**: 숫자만 바꾸고 쉼표·단위는 그대로 (`;;12,500;;`).

## 새 모션 추가하는 법

1. `src/admin/types.ts` 의 타입과 목록(`PHOTO_EFFECTS` / `TEXT_ENTER_OPTIONS` / `TRANSITION_OPTIONS` / `EMPHASIS_BTNS`)에 한 줄 추가합니다. 어드민 선택지와 MCP 스키마는 여기서 자동으로 따라옵니다.
2. `src/engine/render.ts` 의 해당 함수에 분기를 추가합니다.
   - 사진: `photoState()` 에서 `scale / ox / oy / rot / blur / gray / bright / vignette / leak` 값만 돌려줍니다.
   - 제목 등장: `drawTextBlock()` 의 블록 변형, 또는 글자 단위면 `animFn`.
   - 전환: `applyTransitionLayer()`(지금 장 변형·클립), `applyExitLayer()`(앞 장이 빠지는 움직임), `drawTransitionOverlay()`(그린 뒤 덮기). 덮었다 걷는 2단계 전환이면 `TWO_PHASE` 에 넣습니다.
   - 강조 마커: `drawMarkedLine()`.
3. 갤러리로 눈으로 확인합니다.

```bash
npm run mcp:build
node mcp/dist/cli.mjs gallery data/sample.json out/check.png text 새효과id
```

## 자유 장면 (`src/engine/scene.ts`)

카드뉴스 틀 밖의 영상은 장면 JSON 으로 만듭니다. 같은 이징·스프링을 씁니다.

- 레이어마다 `animate: {"x": [[0, 100], [0.6, 540, "easeOutBack"]]}` 처럼 키프레임을 줍니다. 마지막 칸은 그 키프레임으로 들어올 때의 이징입니다.
- 자주 쓰는 등장은 `enter: "pop"` 같은 프리셋으로 끝냅니다. 퇴장은 `exit`.
- 글자를 하나씩 띄우려면 `reveal: {by: "chars", preset: "pop", duration: 0.7}`.
- 마스크 등장은 `clip` 사각형 + 아래에서 올라오는 `y` 키프레임.
- 표현이 안 되면 코드 모드(`render_code`)로 직접 그립니다.

## 다른 도구와의 관계

- `src/video/` 의 Remotion 구성은 그대로 둡니다. React 컴포넌트로 장면을 짜고 싶을 때 씁니다(새 모션은 아직 반영 안 됨).
- HyperFrames 같은 HTML 기반 도구로 옮길 때도 위 이징·스프링 함수는 그대로 가져가면 됩니다. 순수 함수라 의존성이 없습니다.
- 이 엔진은 Canvas 2D 만 씁니다. 브라우저에서는 그대로, Node 에서는 `skia-canvas` + `ffmpeg` 로 같은 결과를 냅니다.
