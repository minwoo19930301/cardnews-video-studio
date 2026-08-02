/** 제목 문자열에서 강조 마커를 미리보기용 HTML 조각으로 변환 */
export type Fx =
  | 'none'
  | 'hl'
  | 'redhl'
  | 'circle'
  | 'under'
  | 'box'
  | 'strike'
  | 'type'
  | 'slot';

export type Tok = {text: string; fx: Fx};

export function parseFx(line: string): Tok[] {
  const out: Tok[] = [];
  const re =
    /(==(.+?)==|@@(.+?)@@|__(.+?)__|\[\[(.+?)\]\]|~~(.+?)~~|%%(.+?)%%|##(.+?)##|\+\+(.+?)\+\+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) out.push({text: line.slice(last, m.index), fx: 'none'});
    const fx: Fx =
      m[2] != null
        ? 'hl'
        : m[3] != null
          ? 'circle'
          : m[4] != null
            ? 'under'
            : m[5] != null
              ? 'box'
              : m[6] != null
                ? 'strike'
                : m[7] != null
                  ? 'type'
                  : m[8] != null
                    ? 'slot'
                    : 'redhl';
    out.push({
      text: (m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6] ?? m[7] ?? m[8] ?? m[9])!,
      fx,
    });
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
  const selected = value.slice(start, end) || '강조';
  const next = value.slice(0, start) + open + selected + close + value.slice(end);
  const cursor = start + open.length + selected.length + close.length;
  return {next, cursor};
}
