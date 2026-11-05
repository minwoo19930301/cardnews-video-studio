/**
 * Cardnews Video Studio MCP 서버 (stdio).
 * 에이전트가 프로젝트 JSON 을 넘기면 어드민과 같은 엔진으로 MP4 / 프레임 이미지를 만든다.
 */
import path from 'node:path';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {Canvas} from 'skia-canvas';
import {z} from 'zod';
import {
  BACKDROP_OPTIONS,
  EMPHASIS_BTNS,
  FONT_OPTIONS,
  MAX_SLIDES,
  PHOTO_EFFECTS,
  POS_LABELS,
  TEXT_ENTER_OPTIONS,
  TRANSITION_OPTIONS,
} from '../src/admin/types';
import {DEFAULT_COLORS, SLIDE_SEC, TEXT_EMPHASIS_SEC, TEXT_ENTER_SEC, TRANSITION_SEC} from '../src/engine/render';
import {EASINGS} from '../src/engine/easing';
import {
  DEFAULT_OUT_DIR,
  hasFfmpeg,
  normalizeProject,
  registerFonts,
  renderContactSheet,
  renderStill,
  renderVideo,
  segmentDurationSec,
  type Segment,
} from './node-render';

const ids = <T extends {id: string}>(list: readonly T[]) => list.map((x) => x.id) as [string, ...string[]];

const slideSchema = z.object({
  image: z.string().optional().describe('사진/영상 경로. 절대 경로, base_dir 기준 상대 경로, 저장소 public/ 기준(예: photos/demo/01.jpg), http(s) 이미지 URL'),
  mediaKind: z.enum(['image', 'video']).optional().describe('비우면 확장자로 판단'),
  title: z.string().optional().describe('제목. 줄바꿈 \\n 으로 최대 3줄. 강조 마커 사용 가능 (list_motions 참고)'),
  text: z.string().optional().describe('보조 문구 한 줄'),
  pos: z.enum(Object.keys(POS_LABELS) as [string, ...string[]]).optional().describe('글자 위치 bl/br/tl/tr'),
  chipText: z.string().optional().describe('빨간 칩 글자. 비우면 "1/3" 같은 번호'),
  photoEffect: z.enum(ids(PHOTO_EFFECTS)).optional(),
  textEnter: z.enum(ids(TEXT_ENTER_OPTIONS)).optional(),
  transition: z.enum(ids(TRANSITION_OPTIONS)).optional(),
  accentColor: z.string().optional().describe('강조색 (원·밑줄·띠·전환) #RRGGBB'),
  textColor: z.string().optional().describe('제목·부제 글자색 #RRGGBB'),
  chipColor: z.string().optional().describe('번호 칩 색 #RRGGBB'),
  highlightColor: z.string().optional().describe('형광펜·박스·숫자 강조색 #RRGGBB'),
  shade: z.number().min(0).max(2).optional().describe('위아래 어둡게 깔기 0~2, 기본 1'),
  showChip: z.boolean().optional().describe('번호 칩 보이기 (기본 숨김)'),
  textOffset: z.object({x: z.number(), y: z.number()}).optional().describe('제목 묶음 위치 이동 (px, 1080×1920 기준)'),
  textScale: z.number().min(0.3).max(3).optional().describe('제목·부제 크기 배율 (기본 1)'),
  backdrop: z.enum(ids(BACKDROP_OPTIONS)).optional().describe('글자 뒤 배경: none/line/box/band/frost/frost-box'),
  backdropColor: z.string().optional().describe('배경 색 #RRGGBB'),
  backdropOpacity: z.number().min(0).max(1).optional().describe('배경 진하기 0~1'),
  fontFamily: z.enum(ids(FONT_OPTIONS)).optional(),
});

const projectSchema = z.object({
  title: z.string().optional().describe('프로젝트 이름 (파일 이름에 사용)'),
  brand: z
    .object({
      logoText: z.string().optional().describe('상단 로고 글자. 비우면 없음'),
      logoImage: z.string().optional().describe('상단 로고 이미지 경로/URL. 있으면 글자 대신 사용'),
      logoOffset: z.object({x: z.number(), y: z.number()}).optional().describe('로고 위치 이동 (px)'),
      logoScale: z.number().min(0.3).max(4).optional().describe('로고 크기 배율 (기본 1)'),
    })
    .optional(),
  fontFamily: z.enum(ids(FONT_OPTIONS)).optional(),
  slides: z.array(slideSchema).min(1).max(MAX_SLIDES),
});

const segmentSchema = z
  .union([z.literal('full'), z.number().int().min(1).max(MAX_SLIDES)])
  .describe('full = 모든 장 이어서, 숫자 = 그 장만 (1부터)');

function outPath(given: string | undefined, ext: string, stem: string) {
  if (given) return path.resolve(given);
  return path.join(DEFAULT_OUT_DIR, `${stem}-${Date.now()}.${ext}`);
}

const server = new McpServer({name: 'cardnews-video-studio', version: '1.1.0'});

server.registerTool(
  'list_motions',
  {
    title: '모션·옵션 목록',
    description: '쓸 수 있는 사진 효과, 제목 등장 효과, 슬라이드 전환, 강조 마커, 글씨체, 길이를 돌려준다. 프로젝트를 만들기 전에 먼저 호출.',
    inputSchema: {},
  },
  async () => {
    const fonts = registerFonts();
    const info = {
      durations: {slide_sec: SLIDE_SEC, transition_sec: TRANSITION_SEC, text_enter_sec: TEXT_ENTER_SEC, emphasis_sec: TEXT_EMPHASIS_SEC},
      default_colors: DEFAULT_COLORS,
      colors_note: 'slide 마다 textColor / accentColor / chipColor / highlightColor (#RRGGBB), shade 0~2 (바탕 어둡게, 기본 1)',
      easings: Object.keys(EASINGS),
      max_slides: MAX_SLIDES,
      photoEffect: PHOTO_EFFECTS,
      textEnter: TEXT_ENTER_OPTIONS,
      transition: TRANSITION_OPTIONS,
      backdrop: BACKDROP_OPTIONS,
      emphasis_markers: EMPHASIS_BTNS.map((m) => ({id: m.id, label: m.label, syntax: `${m.open}텍스트${m.close}`})),
      pos: POS_LABELS,
      fontFamily: FONT_OPTIONS.map((f) => ({id: f.id, label: f.label})),
      note: `Node 렌더는 등록된 글꼴(${fonts.join(', ') || '없음'})과 시스템 글꼴만 씁니다. 없는 글꼴은 Apple SD Gothic Neo 등으로 대체됩니다. 글꼴 파일 폴더를 CARDNEWS_FONT_DIR 로 지정할 수 있습니다.`,
      ffmpeg: hasFfmpeg() ? 'ok' : 'missing — render_video 에 ffmpeg 가 필요합니다',
    };
    return {content: [{type: 'text', text: JSON.stringify(info, null, 2)}]};
  },
);

server.registerTool(
  'render_video',
  {
    title: '카드뉴스 영상 렌더',
    description: '프로젝트를 1080×1920 30fps MP4 로 저장한다. 한 장 8초. 저장 경로를 돌려준다.',
    inputSchema: {
      project: projectSchema,
      segment: segmentSchema.optional(),
      output_path: z.string().optional().describe('저장할 .mp4 경로. 비우면 저장소 out/ 폴더'),
      base_dir: z.string().optional().describe('상대 미디어 경로의 기준 폴더'),
    },
  },
  async ({project, segment, output_path, base_dir}) => {
    const p = normalizeProject(project as never);
    const seg = (segment ?? 'full') as Segment;
    const file = outPath(output_path, 'mp4', `cardnews-${seg}`);
    const t0 = Date.now();
    const r = await renderVideo(p, seg, file, {baseDir: base_dir});
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({path: r.path, seconds: r.seconds, frames: r.frames, render_sec: (Date.now() - t0) / 1000}, null, 2),
        },
      ],
    };
  },
);

server.registerTool(
  'render_frame',
  {
    title: '한 프레임 미리보기',
    description: '특정 장의 특정 시점 한 프레임을 PNG 로 저장하고 미리보기 이미지를 돌려준다. 모션을 빠르게 확인할 때 사용.',
    inputSchema: {
      project: projectSchema,
      segment: z.number().int().min(1).max(MAX_SLIDES).default(1).describe('장 번호 (1부터)'),
      time_sec: z.number().min(0).max(8).default(1.5).describe('그 장 시작 기준 초 (0~8)'),
      output_path: z.string().optional(),
      base_dir: z.string().optional(),
    },
  },
  async ({project, segment, time_sec, output_path, base_dir}) => {
    const p = normalizeProject(project as never);
    const canvas = await renderStill(p, segment, time_sec, {baseDir: base_dir});
    const file = outPath(output_path, 'png', `cardnews-frame-${segment}`);
    await canvas.toFile(file);
    const small = new Canvas(Math.round(canvas.width / 2), Math.round(canvas.height / 2));
    small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
    const preview = await small.toBuffer('jpeg', {quality: 0.8});
    return {
      content: [
        {type: 'image', data: Buffer.from(preview).toString('base64'), mimeType: 'image/jpeg'},
        {type: 'text', text: JSON.stringify({path: file}, null, 2)},
      ],
    };
  },
);

server.registerTool(
  'render_contact_sheet',
  {
    title: '모션 확인 시트',
    description: '한 장을 여러 시점으로 찍어 한 이미지에 모은다. 전환·등장·강조 타이밍을 한눈에 확인할 때 사용.',
    inputSchema: {
      project: projectSchema,
      segment: z.number().int().min(1).max(MAX_SLIDES).default(1).describe('장 번호 (1부터)'),
      times: z.array(z.number().min(0)).min(1).max(16).default([0.1, 0.25, 0.4, 0.6, 0.9, 1.2, 1.6, 5]),
      columns: z.number().int().min(1).max(8).default(4),
      output_path: z.string().optional(),
      base_dir: z.string().optional(),
    },
  },
  async ({project, segment, times, columns, output_path, base_dir}) => {
    const p = normalizeProject(project as never);
    const seg = segment;
    const maxT = segmentDurationSec(p, seg);
    const sheet = await renderContactSheet(p, seg, times.map((t) => Math.min(t, maxT)), {columns, baseDir: base_dir});
    const file = outPath(output_path, 'png', `cardnews-sheet-${segment}`);
    await sheet.toFile(file);
    const preview = await sheet.toBuffer('jpeg', {quality: 0.8});
    return {
      content: [
        {type: 'image', data: Buffer.from(preview).toString('base64'), mimeType: 'image/jpeg'},
        {type: 'text', text: JSON.stringify({path: file}, null, 2)},
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
