# Cardnews Video Studio

어드민에서 카드뉴스 슬라이드(사진·영상·문구·강조 마커)를 만들고 **1080×1920** 세로 영상으로 내보내는 스튜디오입니다.  
**기본 예시는 1장**, 최대 **8장**까지 지원합니다.

- **뉴스 1장**: 8초  
- **인트로 / 아웃트로**: 각 2.5초 (뉴스 장수와 분리)  
- **글자 연출**: 앞 ~2초 안에 완료 (전체 등장 → 끝난 뒤 부분 강조)

## 라이브 데모

| | |
|---|---|
| **사이트** | _(배포 후 이 칸에 URL이 채워집니다)_ |
| **저장소** | https://github.com/minwoo19930301/cardnews-video-studio |

배포는 **Vercel** (또는 Cloudflare Pages) 기준입니다. `ai-ing` 등 별도 호스팅을 쓰지 않습니다.

### Vercel 배포

```bash
npm install
npm run build          # 산출물: dist-admin/
npx vercel --prod      # 로그인 후 프로덕션 배포
```

이 저장소의 `vercel.json`이 `dist-admin` 출력 경로와 SPA 리라이트를 지정합니다.  
GitHub 연동 시: Vercel 대시보드 → Import Project → 이 레포 선택 → Framework **Vite**, Output **dist-admin**.

### Cloudflare Pages 배포 (대안)

```bash
npm run build
npx wrangler pages deploy dist-admin --project-name=cardnews-video-studio
```

대시보드 사용 시: Build command `npm run build`, Build output directory `dist-admin`.

## 로컬 실행

```bash
npm install
npm run dev            # 어드민 http://localhost:5179
```

1. 미디어 · 제목 · 부제 · 강조 마커 · 글씨체 · 위치 설정  
2. **제목·부제 전체 등장 효과** 선택 (통일)  
3. 제목 일부 드래그 → 부분 강조 버튼  
4. **다운로드** — 선택 파트 또는 전체 (MP4 / GIF / WebM)

> MP4는 Chrome/Edge(WebCodecs H.264) 권장. 미지원·실패 시 WebM으로 자동 저장됩니다.

## 강조 마커 (제목 · 드래그 후 버튼)

| 마커 | 효과 |
|------|------|
| `==텍스트==` | 형광펜 |
| `@@텍스트@@` | 색연필 원 |
| `__텍스트__` | 밑줄 |
| `[[텍스트]]` | 노란 박스 |
| `~~텍스트~~` | 취소선 |
| `%%텍스트%%` | 타이핑 |
| `##1,234##` | 숫자 슬롯 |
| `++텍스트++` | 빨간 띠 |
| `**텍스트**` | 글로우 |
| `::텍스트::` | 외곽선 |
| `<<텍스트>>` | 스탬프 |
| `!!텍스트!!` | 흔들림 |
| `^^텍스트^^` | 통통 |
| `≈≈텍스트≈≈` | 물결선 |
| `{{텍스트}}` | 채움 강조 |

## 스크립트

```bash
npm install
npm run dev            # 어드민
npm run build          # 정적 빌드 → dist-admin/
npm run preview        # 빌드 미리보기
npm run check          # TypeScript 검사
npm run render         # (선택) 프레임 파이프라인 렌더
npm run demo           # (선택) 샘플 렌더
```

## 구조

```
src/admin/     # 어드민 UI + 브라우저 영상 인코딩
src/video/     # (선택) 프레임 단위 렌더 파이프라인
data/          # sample JSON
public/photos/
vercel.json    # Vercel 빌드/출력 설정
```

## 라이선스 메모

브라우저 캡처(WebCodecs / MediaRecorder)가 기본 다운로드 경로입니다.  
선택 렌더 스크립트는 오픈소스 프레임 엔진에 의존할 수 있으니, 상업 배포 전 `package.json` 라이선스를 확인하세요.
