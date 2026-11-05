/**
 * Motion Studio MCP 서버 (stdio) — 카드뉴스 틀 없이 자유롭게 모션 영상을 만든다.
 *  - 장면 모드: 레이어 + 키프레임 JSON
 *  - 코드 모드: 매 프레임을 그리는 Canvas 2D 코드
 * 출력: .mp4 / .webm(투명) / .mov(ProRes 4444, 투명) / .gif, 확인용 PNG·시트.
 */
import path from 'node:path';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {Canvas} from 'skia-canvas';
import {z} from 'zod';
import {EASINGS} from '../src/engine/easing';
import {sceneSize, type Scene} from '../src/engine/scene';
import {hasFfmpeg} from './ffmpeg';
import {
  contactSheet,
  renderCodeStill,
  renderCodeVideo,
  renderSceneStill,
  renderSceneVideo,
  type CodeSpec,
} from './motion-render';
import {DEFAULT_OUT_DIR, registerFonts} from './node-render';

const REFERENCE = `
# Motion Studio 사용법

## 장면 모드 (render_scene)
{
  "width": 1080, "height": 1920, "fps": 30, "duration": 6,
  "background": "#101014" | {"from": "#111", "to": "#333", "angle": 90},
  "layers": [ 레이어, ... ]   // 뒤에 올수록 위에 그려짐
}

레이어 공통 (모두 선택):
  start, end        이 레이어가 보이는 구간 (초). 기본 0~duration
  x, y              화면 좌표 (기본 가운데). anchorX/anchorY 0~1 (기본 0.5 = 가운데 기준)
  scale, scaleX, scaleY, rotation(도), opacity(0~1), blur(px)
  blend             canvas globalCompositeOperation (screen, multiply 등)
  shadow            {color, blur, x, y}
  clip              {x, y, width, height, radius} 이 사각형 밖은 가림 (마스크 등장에 사용)
  enter / exit      프리셋 이름 또는 {name, duration, easing, distance}
                    fade, fade-up, fade-down, slide-left, slide-right, slide-up, slide-down,
                    pop, zoom-in, zoom-out, blur, drop, spin, wipe-right, wipe-left, wipe-up, wipe-down
  animate           {"속성": [[시간, 값, 이징?], ...]}  시간은 레이어 시작 기준 초.
                    숫자 속성 전부 + color 는 "#RRGGBB" 끼리 보간.
                    이징: ${Object.keys(EASINGS).join(', ')}, spring

종류별:
  text    text, font(CSS 글꼴), size, weight, color, align(left|center|right), maxWidth(자동 줄바꿈),
          lineHeight(배수), letterSpacing, stroke{color,width}, background{color,padding,radius},
          reveal{by: chars|words|lines, preset: fade-up|pop|drop|blur|scramble|fade, duration, unitDuration, delay}
  image   src(경로/URL), width, height, fit(cover|contain|fill), radius
  video   src(로컬 경로), width, height, fit, radius, trimStart(초), loop(기본 true)
  rect    width, height, color 또는 gradient{from,to,angle}, radius, stroke{color,width}
  circle  radius, color, stroke
  line    points[[x,y],...](화면 좌표), color, width, progress(0~1, animate 로 선 긋기), dash

## 코드 모드 (render_code)
code 는 function (ctx, t, lib) { ... } 의 본문입니다. 매 프레임 호출되고, 그 전에 검은색으로 지워집니다.
  ctx   Canvas 2D 컨텍스트 (fillRect, arc, fillText, drawImage, filter, globalCompositeOperation ...)
  t     현재 시간 (초)
  lib   W, H, duration, progress(0~1), images.이름(+ lib.cover(ctx, img, scale)),
        이징 (easeOutCubic, easeOutBack, easeOutElastic, cubicBezier, spring(sec,k,c), stagger, keyframes, noise1, hash01, lerp, clamp01 ...)
난수는 hash01(n) 을 쓰세요 (같은 결과 보장). Math.random 도 되지만 프레임마다 달라집니다.

## 팁
- 먼저 render_scene_sheet / render_code_frame 으로 몇 장 찍어 확인하고 영상으로 뽑으세요.
- 글자 연출은 0.4~0.8초, 화면 전환은 0.3~0.6초가 보기 좋습니다.
- 투명 배경이 필요하면 background 를 "rgba(0,0,0,0)" 로 두고 .webm 또는 .mov 로 저장.
- 오디오: audio 에 파일 경로를 주면 영상 길이에 맞춰 넣습니다.
`;

const EXAMPLE: Scene = {
  width: 1080,
  height: 1080,
  fps: 30,
  duration: 4,
  background: {from: '#14161c', to: '#2a2f3a', angle: 120},
  layers: [
    {type: 'circle', radius: 260, color: '#ff6b4a', x: 540, y: 540, animate: {scale: [[0, 0], [0.8, 1, 'spring']], opacity: [[3.4, 1], [4, 0]]}},
    {
      type: 'text',
      text: 'Motion Studio',
      size: 110,
      weight: 800,
      color: '#ffffff',
      y: 520,
      reveal: {by: 'chars', preset: 'pop', duration: 0.7, delay: 0.4},
    },
    {type: 'text', text: '레이어와 키프레임으로 자유롭게', size: 40, color: '#ffe9e2', y: 640, start: 1, enter: 'fade-up'},
    {type: 'line', points: [[300, 700], [780, 700]], color: '#ffffff', width: 6, start: 1.2, animate: {progress: [[0, 0], [0.6, 1, 'easeOutCubic']]}},
  ],
};

const sceneSchema = z
  .object({
    width: z.number().int().optional().describe('기본 1080 (짝수)'),
    height: z.number().int().optional().describe('기본 1920 (짝수)'),
    fps: z.number().int().optional().describe('기본 30'),
    duration: z.number().positive().describe('초'),
    background: z.union([z.string(), z.object({from: z.string(), to: z.string(), angle: z.number().optional()})]).optional(),
    layers: z.array(z.record(z.string(), z.any())).describe('레이어 목록. motion_reference 참고'),
  })
  .passthrough();

const codeSchema = z.object({
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  fps: z.number().int().optional(),
  duration: z.number().positive(),
  code: z.string().describe('function (ctx, t, lib) 의 본문'),
  images: z.record(z.string(), z.string()).optional().describe('이름 → 이미지 경로 (lib.images.이름)'),
});

const outPath = (given: string | undefined, ext: string, stem: string) =>
  given ? path.resolve(given) : path.join(DEFAULT_OUT_DIR, `${stem}-${Date.now()}.${ext}`);

async function imageResult(canvas: Canvas, file: string) {
  await canvas.toFile(file);
  const scale = Math.min(1, 720 / Math.max(canvas.width, canvas.height));
  const small = new Canvas(Math.round(canvas.width * scale), Math.round(canvas.height * scale));
  small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
  const jpg = await small.toBuffer('jpeg', {quality: 0.8});
  return {
    content: [
      {type: 'image' as const, data: Buffer.from(jpg).toString('base64'), mimeType: 'image/jpeg'},
      {type: 'text' as const, text: JSON.stringify({path: file})},
    ],
  };
}

const server = new McpServer({name: 'motion-studio', version: '1.0.0'});

server.registerTool(
  'motion_reference',
  {
    title: '사용법·예시',
    description: '장면 JSON 형식, 레이어 종류, 프리셋, 이징, 코드 모드 API 와 예시 장면을 돌려준다. 처음에 한 번 호출.',
    inputSchema: {},
  },
  async () => ({
    content: [
      {type: 'text', text: REFERENCE},
      {type: 'text', text: `예시 장면:\n${JSON.stringify(EXAMPLE, null, 2)}`},
      {type: 'text', text: `글꼴: ${registerFonts().join(', ')} + 시스템 글꼴 (Apple SD Gothic Neo 등). ffmpeg: ${hasFfmpeg() ? 'ok' : '없음'}`},
    ],
  }),
);

server.registerTool(
  'render_scene',
  {
    title: '장면 → 영상',
    description: '장면 JSON 을 영상으로 저장한다. 확장자로 형식 결정 (.mp4 기본, .webm/.mov 투명, .gif).',
    inputSchema: {
      scene: sceneSchema,
      output_path: z.string().optional().describe('비우면 저장소 out/ 에 mp4'),
      audio: z.string().optional().describe('넣을 오디오 파일 경로'),
      base_dir: z.string().optional().describe('상대 경로 기준 폴더'),
    },
  },
  async ({scene, output_path, audio, base_dir}) => {
    const t0 = Date.now();
    const r = await renderSceneVideo(scene as unknown as Scene, outPath(output_path, 'mp4', 'scene'), {baseDir: base_dir, audio});
    return {content: [{type: 'text', text: JSON.stringify({...r, render_sec: (Date.now() - t0) / 1000}, null, 2)}]};
  },
);

server.registerTool(
  'render_scene_frame',
  {
    title: '장면 한 프레임',
    description: '장면의 특정 시점을 PNG 로 저장하고 미리보기를 돌려준다.',
    inputSchema: {scene: sceneSchema, time_sec: z.number().min(0), output_path: z.string().optional(), base_dir: z.string().optional()},
  },
  async ({scene, time_sec, output_path, base_dir}) =>
    imageResult(await renderSceneStill(scene as unknown as Scene, time_sec, {baseDir: base_dir}), outPath(output_path, 'png', 'scene-frame')),
);

server.registerTool(
  'render_scene_sheet',
  {
    title: '장면 확인 시트',
    description: '장면을 여러 시점으로 찍어 한 장에 모은다. 타이밍 확인용.',
    inputSchema: {
      scene: sceneSchema,
      times: z.array(z.number().min(0)).min(1).max(16).optional().describe('비우면 길이를 8등분'),
      columns: z.number().int().min(1).max(8).default(4),
      output_path: z.string().optional(),
      base_dir: z.string().optional(),
    },
  },
  async ({scene, times, columns, output_path, base_dir}) => {
    const sc = scene as unknown as Scene;
    const {W, H} = sceneSize(sc);
    const ts = times ?? Array.from({length: 8}, (_, i) => +((sc.duration * (i + 0.5)) / 8).toFixed(2));
    const sheet = await contactSheet({W, H}, ts, (t) => renderSceneStill(sc, t, {baseDir: base_dir}), columns);
    return imageResult(sheet, outPath(output_path, 'png', 'scene-sheet'));
  },
);

server.registerTool(
  'render_code',
  {
    title: '코드 → 영상',
    description: '매 프레임 Canvas 2D 코드를 실행해 영상으로 저장한다. 장면 JSON 으로 안 되는 표현을 직접 그릴 때. (로컬 전용, 보안 샌드박스 아님)',
    inputSchema: {spec: codeSchema, output_path: z.string().optional(), audio: z.string().optional(), base_dir: z.string().optional()},
  },
  async ({spec, output_path, audio, base_dir}) => {
    const t0 = Date.now();
    const r = await renderCodeVideo(spec as CodeSpec, outPath(output_path, 'mp4', 'code'), {baseDir: base_dir, audio});
    return {content: [{type: 'text', text: JSON.stringify({...r, render_sec: (Date.now() - t0) / 1000}, null, 2)}]};
  },
);

server.registerTool(
  'render_code_frame',
  {
    title: '코드 한 프레임',
    description: '코드 모드의 특정 시점을 PNG 로 저장하고 미리보기를 돌려준다. 오류가 나면 메시지를 돌려준다.',
    inputSchema: {spec: codeSchema, time_sec: z.number().min(0), output_path: z.string().optional(), base_dir: z.string().optional()},
  },
  async ({spec, time_sec, output_path, base_dir}) =>
    imageResult(await renderCodeStill(spec as CodeSpec, time_sec, {baseDir: base_dir}), outPath(output_path, 'png', 'code-frame')),
);

await server.connect(new StdioServerTransport());
