/** 부분 강조 마커 파서 */
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
  | 'fill';

export type Tok = {text: string; fx: Fx};

/**
 * 마커 문법 (긴 것 우선 매칭):
 * ==형광== @@원@@ __밑줄__ [[박스]] ~~취소~~ %%타이핑%% ##숫자## ++빨간++
 * **글로우** ::외곽:: <<스탬프>> !!흔들!! ^^통통^^ ≈≈물결≈≈ {{채움}}
 */
export function parseFx(line: string): Tok[] {
  const out: Tok[] = [];
  const re =
    /(==(.+?)==|@@(.+?)@@|__(.+?)__|\[\[(.+?)\]\]|~~(.+?)~~|%%(.+?)%%|##(.+?)##|\+\+(.+?)\+\+|\*\*(.+?)\*\*|::(.+?)::|<<(.+?)>>|!!(.+?)!!|\^\^(.+?)\^\^|≈≈(.+?)≈≈|\{\{(.+?)\}\})/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) out.push({text: line.slice(last, m.index), fx: 'none'});
    const groups = m as unknown as string[];
    // map capture groups 2.. to fx
    let fx: Fx = 'none';
    let text = '';
    if (m[2] != null) {
      fx = 'hl';
      text = m[2];
    } else if (m[3] != null) {
      fx = 'circle';
      text = m[3];
    } else if (m[4] != null) {
      fx = 'under';
      text = m[4];
    } else if (m[5] != null) {
      fx = 'box';
      text = m[5];
    } else if (m[6] != null) {
      fx = 'strike';
      text = m[6];
    } else if (m[7] != null) {
      fx = 'type';
      text = m[7];
    } else if (m[8] != null) {
      fx = 'slot';
      text = m[8];
    } else if (m[9] != null) {
      fx = 'redhl';
      text = m[9];
    } else if (m[10] != null) {
      fx = 'glow';
      text = m[10];
    } else if (m[11] != null) {
      fx = 'outline';
      text = m[11];
    } else if (m[12] != null) {
      fx = 'stamp';
      text = m[12];
    } else if (m[13] != null) {
      fx = 'shake';
      text = m[13];
    } else if (m[14] != null) {
      fx = 'bounce';
      text = m[14];
    } else if (m[15] != null) {
      fx = 'wave';
      text = m[15];
    } else if (m[16] != null) {
      fx = 'fill';
      text = m[16];
    }
    out.push({text, fx});
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({text: line.slice(last), fx: 'none'});
  return out.length ? out : [{text: line, fx: 'none'}];
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
