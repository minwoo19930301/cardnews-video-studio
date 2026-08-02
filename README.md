# Cardnews Video Studio

어드민에서 카드뉴스 슬라이드(사진·영상·문구·강조 마커)를 만들고 **1080×1920** 세로 영상으로 렌더하는 스튜디오입니다.  
**기본 예시는 1장**이고, 필요하면 최대 8장까지 늘려 한 번에 렌더할 수 있습니다.

## 상업용 / 라이선스

영상 렌더는 오픈소스 프레임 엔진 라이브러리에 의존합니다.  
**제품 UI에는 엔진 이름을 노출하지 않습니다.** 상업 배포 전에 `package.json` 의존성 라이선스를 확인하세요.  
어드민 JSON 스키마(`content.json`)는 엔진과 분리되어 있어 나중에 교체하기 쉽습니다.

## 한 줄 흐름

1. `npm run dev` → 브라우저 어드민 (기본 1장 예시)
2. 슬라이드 추가(최대 8) · 미디어 · 제목 · 강조 · 위치
3. **content.json 내보내기** → `data/content.json`
4. 업로드 파일은 `public/photos/uploads/` 에 배치
5. `npm run render` → `out/reel.mp4`

## 강조 마커 (제목)

| 마커 | 효과 |
|------|------|
| `==텍스트==` | 형광펜 |
| `@@텍스트@@` | 손그림 동그라미 |
| `__텍스트__` | 밑줄 |
| `[[텍스트]]` | 노란 박스 |
| `~~텍스트~~` | 취소선 |
| `%%텍스트%%` | 타이핑 |
| `##1,234##` | 숫자 슬롯 |
| `++텍스트++` | 빨간 하이라이트 |

## 스크립트

```bash
npm install
npm run dev            # 어드민 http://localhost:5179
npm run render         # data/content.json → out/reel.mp4
npm run demo           # data/sample.json 데모 렌더
npm run studio         # 프레임 단위 미리보기 (개발용)
```

## 구조

```
src/admin/   # 어드민 UI
src/video/   # 영상 렌더 파이프라인
data/        # content / sample JSON
public/photos/
```
