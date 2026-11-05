/**
 * 터미널 렌더: MCP 와 같은 엔진으로 MP4 / 확인 시트를 만든다.
 *   node mcp/dist/cli.mjs video data/sample.json out/full.mp4 [full|N]
 *   node mcp/dist/cli.mjs sheet data/sample.json out/sheet.png [N] [t1,t2,...]
 *   node mcp/dist/cli.mjs gallery data/sample.json out/text.png text|photo|transition|emphasis [id,id,...]
 *   node mcp/dist/cli.mjs scene docs/examples/scene.json out/scene.mp4
 *   node mcp/dist/cli.mjs code docs/examples/orbit.js out/orbit.mp4 [초] [가로x세로]
 */
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {Canvas} from 'skia-canvas';
import {EMPHASIS_BTNS, PHOTO_EFFECTS, TEXT_ENTER_OPTIONS, TRANSITION_OPTIONS, type Slide} from '../src/admin/types';
import {normalizeProject, renderContactSheet, renderStill, renderVideo, type Segment} from './node-render';
import {renderCodeVideo, renderSceneVideo} from './motion-render';

const [cmd, jsonPath, out, segArg, timesArg] = process.argv.slice(2);
if (!cmd || !jsonPath || !out) {
  console.error('usage: cli.mjs video|sheet|gallery|scene|code <input> <out> [...]');
  process.exit(1);
}
const parseSeg = (s: string | undefined, fallback: Segment): Segment =>
  !s ? fallback : /^\d+$/.test(s) ? Number(s) : (s as Segment);

const baseDir = path.dirname(path.resolve(jsonPath));
const progress = (d: number, t: number) => process.stderr.write(`\r${d}/${t} frames`);
if (cmd === 'scene') {
  const r = await renderSceneVideo(JSON.parse(readFileSync(jsonPath, 'utf8')), path.resolve(out), {baseDir, onProgress: progress});
  process.stderr.write('\n');
  console.log(JSON.stringify(r));
  process.exit(0);
}
if (cmd === 'code') {
  const [w, h] = (timesArg || '1080x1080').split('x').map(Number);
  const r = await renderCodeVideo(
    {code: readFileSync(jsonPath, 'utf8'), duration: Number(segArg || 3), width: w, height: h},
    path.resolve(out),
    {baseDir, onProgress: progress},
  );
  process.stderr.write('\n');
  console.log(JSON.stringify(r));
  process.exit(0);
}
const project = normalizeProject(JSON.parse(readFileSync(jsonPath, 'utf8')));

if (cmd === 'video') {
  const seg = parseSeg(segArg, 'full');
  const r = await renderVideo(project, seg, path.resolve(out), {
    baseDir,
    onProgress: (d, t) => process.stderr.write(`\r${d}/${t} frames`),
  });
  process.stderr.write('\n');
  console.log(JSON.stringify(r));
} else if (cmd === 'sheet') {
  const seg = Number(segArg || 1);
  const times = (timesArg || '0.1,0.25,0.4,0.6,0.9,1.2,1.6,5').split(',').map(Number);
  const sheet = await renderContactSheet(project, seg, times, {baseDir});
  await sheet.toFile(path.resolve(out));
  console.log(path.resolve(out));
} else if (cmd === 'gallery') {
  // 모션 종류별 갤러리: 행=효과, 열=시점. segArg = photo|text|transition|emphasis
  const kind = segArg || 'text';
  const lists: Record<string, {key: keyof Slide | 'title'; items: Array<{id: string; label: string}>; times: number[]}> = {
    photo: {key: 'photoEffect', items: PHOTO_EFFECTS, times: [0.2, 1.5, 4, 7.8]},
    text: {key: 'textEnter', items: TEXT_ENTER_OPTIONS, times: [0.1, 0.25, 0.4, 0.6, 1.6]},
    transition: {key: 'transition', items: TRANSITION_OPTIONS, times: [0.03, 0.1, 0.18, 0.26, 0.34, 0.6]},
    emphasis: {key: 'title', items: EMPHASIS_BTNS, times: [0.7, 0.8, 0.9, 1.05, 1.6]},
  };
  const spec = lists[kind];
  if (!spec) throw new Error(`gallery 종류: ${Object.keys(lists).join(', ')}`);
  const only = timesArg ? new Set(timesArg.split(',')) : null;
  const items = spec.items.filter((it) => !only || only.has(it.id));
  const tw = 180;
  const th = 320;
  const labelW = 170;
  const sheet = new Canvas(labelW + spec.times.length * tw, 30 + items.length * th);
  const sx = sheet.getContext('2d');
  sx.fillStyle = '#111';
  sx.fillRect(0, 0, sheet.width, sheet.height);
  sx.fillStyle = '#ffe14d';
  sx.font = '600 16px sans-serif';
  spec.times.forEach((t, c) => sx.fillText(`${t}s`, labelW + c * tw + 8, 20));
  const base = project.slides[0];
  for (let r = 0; r < items.length; r++) {
    const it = items[r] as {id: string; label: string; open?: string; close?: string};
    const slide: Slide =
      kind === 'emphasis'
        ? {...base, transition: 'cut', textEnter: 'fade-up', photoEffect: 'none', title: it.id === 'count' || it.id === 'slot' ? `올해 방문객 ${it.open}12,500${it.close}명\n두 번째 줄` : `오늘의 ${it.open}핵심 뉴스${it.close}\n두 번째 줄`}
        : {...base, transition: 'cut', textEnter: 'fade-up', photoEffect: 'none', [spec.key]: it.id};
    // 전환은 앞 장(다른 사진)과 이어지는 모습으로 본다
    const prevSlide: Slide = {...(project.slides[1] ?? base), id: 'prev', transition: 'cut', textEnter: 'fade-up', photoEffect: 'none'};
    const p = kind === 'transition' ? {...project, slides: [prevSlide, slide]} : {...project, slides: [slide]};
    const no = kind === 'transition' ? 2 : 1;
    for (let c = 0; c < spec.times.length; c++) {
      const still = await renderStill(p, no, spec.times[c], {baseDir});
      sx.drawImage(still, labelW + c * tw, 30 + r * th, tw, th);
    }
    sx.fillStyle = '#fff';
    sx.font = '600 15px "Apple SD Gothic Neo", sans-serif';
    sx.fillText(it.label, 10, 30 + r * th + th / 2);
    sx.fillStyle = '#8a8f9c';
    sx.font = '12px monospace';
    sx.fillText(it.id, 10, 30 + r * th + th / 2 + 20);
    process.stderr.write(`\r${r + 1}/${items.length}`);
  }
  process.stderr.write('\n');
  await sheet.toFile(path.resolve(out));
  console.log(path.resolve(out));
} else {
  console.error(`unknown command: ${cmd}`);
  process.exit(1);
}
