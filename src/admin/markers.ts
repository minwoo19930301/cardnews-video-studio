/** 부분 강조 마커 파서 — 마커 목록은 types.ts EMPHASIS_BTNS 한 곳에서 관리 */
import {EMPHASIS_BTNS} from './types';

export type Fx =
  | 'none'
  | 'hl'
  | 'redhl'
  | 'circle'
  | 'under'
  | 'box'
  | 'strike'
  | 'type'
  | 'slot'
  | 'glow'
  | 'outline'
  | 'stamp'
  | 'shake'
  | 'bounce'
  | 'wave'
  | 'fill'
  | 'spark'
  | 'shine'
  | 'pop'
  | 'count'
  | 'scribble'
  | 'arrow';

export type Tok = {text: string; fx: Fx};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** ==형광== @@원@@ __밑줄__ ... 각 마커가 캡처 그룹 하나 */
const MARKER_RE = new RegExp(
  EMPHASIS_BTNS.map((m) => `${esc(m.open)}(.+?)${esc(m.close)}`).join('|'),
  'g',
);

/** 마커 기호만 지운 순수 텍스트 (폭 계산·한 글자씩 등장용) */
export function stripMarkers(line: string): string {
  return line.replace(MARKER_RE, (...args) => {
    const groups = args.slice(1, 1 + EMPHASIS_BTNS.length) as Array<string | undefined>;
    return groups.find((g) => g != null) ?? '';
  });
}

export function parseFx(line: string): Tok[] {
  const out: Tok[] = [];
  const re = new RegExp(MARKER_RE.source, 'g');
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) out.push({text: line.slice(last, m.index), fx: 'none'});
    const gi = EMPHASIS_BTNS.findIndex((_, i) => m![i + 1] != null);
    out.push({text: m[gi + 1] ?? '', fx: (EMPHASIS_BTNS[gi]?.id ?? 'none') as Fx});
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({text: line.slice(last), fx: 'none'});
  return out.length ? out : [{text: line, fx: 'none'}];
}

type Span = {start: number; end: number; inner: string; id: string};

/** 글 전체에서 강조 구간 위치 찾기 */
function scanSpans(value: string): Span[] {
  const out: Span[] = [];
  const re = new RegExp(MARKER_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    const gi = EMPHASIS_BTNS.findIndex((_, i) => m![i + 1] != null);
    out.push({start: m.index, end: m.index + m[0].length, inner: m[gi + 1] ?? '', id: EMPHASIS_BTNS[gi]?.id ?? ''});
  }
  return out;
}

/** 겹겹이 쌓인 것까지 강조 기호를 모두 지운다 */
export function clearMarkers(value: string): string {
  let prev = '';
  let cur = value;
  for (let i = 0; i < 10 && cur !== prev; i++) {
    prev = cur;
    cur = cur
      .split('\n')
      .map((l) => stripMarkers(l))
      .join('\n');
  }
  return cur;
}

/**
 * 강조 적용: 기호를 겹치지 않는다.
 * - 이미 강조된 곳이면 그 강조를 새 것으로 바꾼다 (같은 강조면 해제)
 * - 선택이 없으면 커서가 있는 강조 구간, 없으면 커서 앞뒤 단어
 */
export function applyEmphasis(
  value: string,
  selStart: number,
  selEnd: number,
  id: string,
): {next: string; cursor: number; removed: boolean} {
  const btn = EMPHASIS_BTNS.find((b) => b.id === id);
  if (!btn) return {next: value, cursor: selEnd, removed: false};
  const spans = scanSpans(value);
  let s = Math.min(selStart, selEnd);
  let e = Math.max(selStart, selEnd);

  if (s === e) {
    const inside = spans.find((sp) => s >= sp.start && s <= sp.end);
    if (inside) {
      s = inside.start;
      e = inside.end;
    } else {
      // 커서 앞뒤로 공백이 아닌 글자를 단어로
      const isWord = (ch: string | undefined) => !!ch && !/\s/.test(ch);
      while (s > 0 && isWord(value[s - 1])) s--;
      while (e < value.length && isWord(value[e])) e++;
      if (s === e) return {next: value, cursor: selEnd, removed: false};
    }
  }
  // 걸친 강조 구간은 통째로 포함
  for (const sp of spans) {
    if (sp.start < e && sp.end > s) {
      s = Math.min(s, sp.start);
      e = Math.max(e, sp.end);
    }
  }
  const exact = spans.find((sp) => sp.start === s && sp.end === e);
  const inner = clearMarkers(value.slice(s, e));
  const removed = !!exact && exact.id === id;
  const rep = removed ? inner : btn.open + inner + btn.close;
  return {next: value.slice(0, s) + rep + value.slice(e), cursor: s + rep.length, removed};
}

export function wrapSelection(
  value: string,
  start: number,
  end: number,
  open: string,
  close: string,
): {next: string; cursor: number} {
  let selected = value.slice(start, end);
  let s = start;
  let e = end;
  if (!selected) {
    const left = value.slice(0, start);
    const m = left.match(/([^\s\n]+)$/);
    if (m) {
      selected = m[1];
      s = start - selected.length;
      e = start;
    } else {
      selected = '텍스트';
    }
  }
  const next = value.slice(0, s) + open + selected + close + value.slice(e);
  const cursor = s + open.length + selected.length + close.length;
  return {next, cursor};
}
