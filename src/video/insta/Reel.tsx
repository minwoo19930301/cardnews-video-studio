import React from 'react';
import {AbsoluteFill, Img, Video, Sequence, interpolate, Easing, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {COLORS, FONT_FAMILY} from '../theme';
import {fitFontSize} from '../fit';
import type {ReelData, Brand} from './schema';

export const INTRO_D = 55;
export const SLIDE_D = 115;
export const OUTRO_D = 70;
export const XFADE = 14;
export const reelDuration = (n: number) => INTRO_D + n * SLIDE_D + OUTRO_D;

const logoText = (b?: Brand) => b?.logoText ?? '{로고 넣는 자리}';
const handleText = (b?: Brand) => b?.handle ?? '{주소}';

// 강조 마커 파서: ==형광펜== @@동그라미@@ __밑줄__ [[박스]] ~~취소선~~ %%타이핑%% ##숫자슬롯##
type Fx = 'none' | 'hl' | 'redhl' | 'circle' | 'under' | 'box' | 'strike' | 'type' | 'slot';
type Tok = {text: string; fx: Fx};
const parseFx = (line: string): Tok[] => {
  const out: Tok[] = [];
  const re = /(==(.+?)==|@@(.+?)@@|__(.+?)__|\[\[(.+?)\]\]|~~(.+?)~~|%%(.+?)%%|##(.+?)##|\+\+(.+?)\+\+)/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) out.push({text: line.slice(last, m.index), fx: 'none'});
    const fx: Fx = m[2] != null ? 'hl' : m[3] != null ? 'circle' : m[4] != null ? 'under' : m[5] != null ? 'box' : m[6] != null ? 'strike' : m[7] != null ? 'type' : m[8] != null ? 'slot' : 'redhl';
    out.push({text: (m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6] ?? m[7] ?? m[8] ?? m[9])!, fx});
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({text: line.slice(last), fx: 'none'});
  return out;
};

const FxSpan: React.FC<{tok: Tok; delay: number}> = ({tok, delay}) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [delay, delay + 14], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  if (tok.fx === 'hl') {
    return (
      <span style={{position: 'relative', display: 'inline-block', padding: '0 6px', margin: '0 -2px'}}>
        <span style={{position: 'absolute', left: 0, right: 0, top: '10%', bottom: '2%', background: COLORS.yellow, transform: `scaleX(${p})`, transformOrigin: 'left center', mixBlendMode: 'multiply'}} />
        <span style={{position: 'relative'}}>{tok.text}</span>
      </span>
    );
  }
  if (tok.fx === 'redhl') {
    // 빨간 하이라이트: 흰 글자 뒤로 붉은 띠 스윕
    return (
      <span style={{position: 'relative', display: 'inline-block', padding: '0 8px', margin: '0 -2px'}}>
        <span style={{position: 'absolute', left: 0, right: 0, top: '6%', bottom: '0%', background: COLORS.red, transform: `scaleX(${p}) skewX(-6deg)`, transformOrigin: 'left center', opacity: 0.92}} />
        <span style={{position: 'relative'}}>{tok.text}</span>
      </span>
    );
  }
  if (tok.fx === 'circle') {
    // 손그림 원: 글자보다 크게, 삐뚤고 끝이 겹치게, 맨 위 레이어
    return (
      <span style={{position: 'relative', display: 'inline-block', padding: '0 4px'}}>
        <span style={{position: 'relative'}}>{tok.text}</span>
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={{position: 'absolute', left: '-16%', top: '-38%', width: '134%', height: '178%', overflow: 'visible', zIndex: 40, transform: 'rotate(-4deg)'}}>
          <path d="M55 6 C86 1 101 13 97 31 C93 51 70 60 44 57 C18 54 0 45 4 28 C8 10 30 2 63 6 C84 9 96 18 94 33" fill="none" stroke={COLORS.red} strokeWidth={5} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} opacity={0.95} />
        </svg>
      </span>
    );
  }
  if (tok.fx === 'under') {
    return (
      <span style={{position: 'relative', display: 'inline-block'}}>
        <span style={{position: 'relative'}}>{tok.text}</span>
        <svg viewBox="0 0 100 12" preserveAspectRatio="none" style={{position: 'absolute', left: 0, bottom: '-14%', width: '100%', height: '0.28em', overflow: 'visible'}}>
          <path d="M2 7 C25 3 45 10 62 6 C78 3 92 8 98 5" fill="none" stroke={COLORS.red} strokeWidth={7} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} />
        </svg>
      </span>
    );
  }
  if (tok.fx === 'box') {
    return (
      <span style={{position: 'relative', display: 'inline-block', padding: '0 8px'}}>
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={{position: 'absolute', inset: '-8% -4%', width: '108%', height: '116%', overflow: 'visible'}}>
          <rect x={2} y={4} width={96} height={52} rx={7} fill="none" stroke={COLORS.yellow} strokeWidth={5} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} />
        </svg>
        <span style={{position: 'relative'}}>{tok.text}</span>
      </span>
    );
  }
  if (tok.fx === 'strike') {
    return (
      <span style={{position: 'relative', display: 'inline-block', opacity: 0.9}}>
        <span style={{position: 'relative'}}>{tok.text}</span>
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={{position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible'}}>
          <path d="M1 34 L99 26" fill="none" stroke={COLORS.red} strokeWidth={7} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} />
        </svg>
      </span>
    );
  }
  if (tok.fx === 'type') {
    const chars = [...tok.text];
    const shown = Math.floor(interpolate(frame, [delay, delay + chars.length * 2.5], [0, chars.length], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}));
    const done = shown >= chars.length;
    return (
      <span>
        {chars.slice(0, shown).join('')}
        <span style={{opacity: done ? (Math.floor(frame / 12) % 2 === 0 ? 1 : 0) : 1, color: COLORS.yellow, fontWeight: 700}}>|</span>
        <span style={{opacity: 0}}>{chars.slice(shown).join('')}</span>
      </span>
    );
  }
  if (tok.fx === 'slot') {
    // 숫자 로터리: 자릿수별로 돌다가 순차 고정
    return (
      <span style={{color: COLORS.yellow}}>
        {[...tok.text].map((ch, i) => {
          if (!/\d/.test(ch)) return <span key={i}>{ch}</span>;
          const lock = delay + 14 + i * 7;
          const spinning = frame < lock;
          const digit = spinning ? String((frame * 7 + i * 13 + Math.floor(frame / 2) * 3) % 10) : ch;
          return (
            <span key={i} style={{display: 'inline-block', minWidth: '0.62em', textAlign: 'center', transform: spinning ? `translateY(${(frame + i) % 2 === 0 ? -3 : 3}px)` : 'none'}}>
              {digit}
            </span>
          );
        })}
      </span>
    );
  }
  return <span>{tok.text}</span>;
};

const isLatin = (s: string) => /^[A-Za-z0-9\s<>'&.,!?:@×%#-]+$/.test(s.replace(/==|@@|__|\[\[|\]\]|~~|%%|##|\+\+/g, ''));

const MaskLines: React.FC<{lines: string[]; delay: number; fontSize: number; weight?: number; align?: 'left' | 'right'}> = ({lines, delay, fontSize, weight = 700, align = 'left'}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return (
    <>
      {lines.map((line, i) => {
        const y = spring({frame, fps, delay: delay + i * 6, config: {damping: 16, stiffness: 120}});
        return (
          <div key={i} style={{overflow: 'visible', position: 'relative', zIndex: 30}}>
            {/* 패딩+네거티브 마진: 슬라이드업 마스크 유지 + 손그림 원 클리핑 방지 */}
            <div style={{overflow: 'hidden', padding: '0.5em 0.55em', margin: '-0.5em -0.55em'}}>
              <div style={{fontSize, fontWeight: weight, lineHeight: 1.28, color: '#fff', letterSpacing: isLatin(line) ? '0.01em' : '-0.01em', wordBreak: 'keep-all', textAlign: align, transform: `translateY(${(1 - y) * 108}%)`}}>
                {parseFx(line).map((t, ti) => <FxSpan key={ti} tok={t} delay={delay + i * 6 + 16} />)}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
};

const isVideo = (src: string) => {
  const ext = src.split('.').pop()?.toLowerCase();
  return ext === 'mp4' || ext === 'webm' || ext === 'mov';
};

const KenBurns: React.FC<{src: string; d: number; dir: 1 | -1}> = ({src, d, dir}) => {
  const frame = useCurrentFrame();
  const t = Math.min(frame / d, 1);
  const scale = dir === 1 ? 1.06 + t * 0.09 : 1.15 - t * 0.09;

  if (isVideo(src)) {
    return (
      <Video
        src={staticFile(src)}
        style={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${scale})`,
        }}
        loop
        muted
      />
    );
  }

  return <Img src={staticFile(src)} style={{position: 'absolute', width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale})`}} />;
};

// 상단 브랜드 슬롯: 로고 이미지(흰색 권장) 또는 텍스트
const BrandMark: React.FC<{brand?: Brand; delay?: number; dark?: boolean}> = ({brand, delay = 4, dark}) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [delay, delay + 10], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const base: React.CSSProperties = {position: 'absolute', top: 62, left: '50%', transform: 'translateX(-50%)', opacity: o};
  if (brand?.logoImage) return <img src={staticFile(brand.logoImage)} style={{...base, height: 26, filter: dark ? 'none' : 'drop-shadow(0 1px 6px rgba(0,0,0,0.4))'}} />;
  return <div style={{...base, color: dark ? COLORS.ink : '#fff', fontSize: 24, fontWeight: 500, letterSpacing: '0.24em', whiteSpace: 'nowrap', textShadow: dark ? 'none' : '0 1px 8px rgba(0,0,0,0.4)'}}>{logoText(brand)}</div>;
};

const Entrance: React.FC<{variant: number; children: React.ReactNode}> = ({variant, children}) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [0, XFADE], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  const style: React.CSSProperties =
    variant === 0 ? {transform: `translateX(${(1 - p) * 100}%)`}
    : variant === 1 ? {opacity: p, transform: `scale(${1.18 - p * 0.18})`}
    : {transform: `translateY(${(1 - p) * 100}%)`};
  return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
};

export const Reel: React.FC<ReelData> = (data) => {
  const n = data.slides.length;
  return (
    <AbsoluteFill style={{background: '#0d0d0d', fontFamily: FONT_FAMILY}}>
      {/* 인트로: 흰 바탕 + 브랜드 슬롯 */}
      <Sequence durationInFrames={INTRO_D + XFADE} name="인트로">
        <AbsoluteFill style={{background: '#FFFFFF'}} />
        <Intro data={data} />
      </Sequence>

      {data.slides.map((s, i) => (
        <Sequence key={i} from={INTRO_D + i * SLIDE_D} durationInFrames={SLIDE_D + XFADE} name={`뉴스 ${i + 1}`}>
          <Entrance variant={i % 3}>
            <KenBurns src={s.image} d={SLIDE_D + XFADE} dir={i % 2 === 0 ? -1 : 1} />
            <AbsoluteFill style={{background: 'linear-gradient(to bottom, rgba(0,0,0,0.16) 0%, rgba(0,0,0,0) 26%, rgba(0,0,0,0) 52%, rgba(0,0,0,0.66) 100%)'}} />
            <BrandMark brand={data.brand} delay={XFADE + 2} />
            <NewsText index={i + 1} total={n} title={s.title ?? ''} text={s.text} pos={s.pos ?? (['bl', 'tr', 'br', 'tl'] as const)[i % 4]} />
          </Entrance>
        </Sequence>
      ))}

      <Sequence from={INTRO_D + n * SLIDE_D} durationInFrames={OUTRO_D} name="아웃트로">
        <Outro brand={data.brand} />
      </Sequence>
    </AbsoluteFill>
  );
};

const Intro: React.FC<{data: ReelData}> = ({data}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const s = spring({frame, fps, delay: 6, config: {damping: 15, stiffness: 130}});
  const o = interpolate(frame, [18, 30], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const b = data.brand;
  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
      {b?.logoImage ? (
        <img src={staticFile(b.logoImage)} style={{width: 620, transform: `scale(${0.85 + s * 0.15})`, opacity: s, filter: 'invert(1)'}} />
      ) : (
        <div style={{color: COLORS.ink, fontSize: 58, fontWeight: 700, letterSpacing: '0.18em', transform: `scale(${0.85 + s * 0.15})`, opacity: s}}>{logoText(b)}</div>
      )}
      <div style={{marginTop: 42, color: COLORS.ink, fontSize: 46, fontWeight: 700, letterSpacing: '0.04em', opacity: o}}>{data.title}</div>
      {data.subtitle ? <div style={{marginTop: 14, color: '#8a8a8a', fontSize: 30, fontWeight: 500, letterSpacing: '0.12em', opacity: o}}>{data.subtitle}</div> : null}
      <div style={{position: 'absolute', bottom: 220, width: 120, height: 8, background: COLORS.red, transform: `scaleX(${s})`}} />
    </AbsoluteFill>
  );
};

const NewsText: React.FC<{index: number; total: number; title: string; text?: string; pos: 'bl' | 'br' | 'tl' | 'tr'}> = ({index, total, title, text, pos}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const D = XFADE + 4;
  const chip = spring({frame, fps, delay: D, config: {damping: 14, stiffness: 150}});
  const titleLines = title.split('\n');
  const o = interpolate(frame, [D + 26, D + 38], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const top = pos === 'tl' || pos === 'tr';
  const right = pos === 'br' || pos === 'tr';
  const origin = right ? 'right center' : 'left center';
  return (
    <div style={{position: 'absolute', left: 64, right: 64, ...(top ? {top: 170} : {bottom: 130}), textShadow: '0 2px 12px rgba(0,0,0,0.55)'}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 16, marginBottom: 22, flexDirection: right ? 'row-reverse' : 'row'}}>
        <div style={{background: COLORS.red, color: '#fff', fontSize: 27, fontWeight: 700, padding: '7px 15px', transform: `scale(${chip})`, transformOrigin: origin, letterSpacing: '0.06em'}}>
          {index}/{total}
        </div>
        <div style={{flex: 1, height: 3, background: 'rgba(255,255,255,0.4)', transform: `scaleX(${chip})`, transformOrigin: origin}} />
      </div>
      <MaskLines lines={titleLines} delay={D + 4} fontSize={fitFontSize(titleLines, 64, 950)} align={right ? 'right' : 'left'} />
      {text ? <div style={{marginTop: 16, fontSize: 34, fontWeight: 500, color: 'rgba(255,255,255,0.95)', wordBreak: 'keep-all', opacity: o, textAlign: right ? 'right' : 'left'}}>{text}</div> : null}
    </div>
  );
};

const Outro: React.FC<{brand?: Brand}> = ({brand}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const s = spring({frame, fps, delay: 8, config: {damping: 14, stiffness: 140}});
  const o = interpolate(frame, [20, 32], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{background: COLORS.red, justifyContent: 'center', alignItems: 'center'}}>
      {brand?.logoImage ? (
        <img src={staticFile(brand.logoImage)} style={{width: 600, filter: 'invert(1)', transform: `scale(${0.9 + s * 0.1})`, opacity: s}} />
      ) : (
        <div style={{color: '#fff', fontSize: 56, fontWeight: 700, letterSpacing: '0.18em', transform: `scale(${0.9 + s * 0.1})`, opacity: s}}>{logoText(brand)}</div>
      )}
      {/* 팔로우 CTA — 살짝 흔들리는 위글 */}
      <div style={{marginTop: 48, background: '#fff', color: COLORS.ink, fontSize: 34, fontWeight: 700, padding: '18px 36px', borderRadius: 999, opacity: o, transform: `rotate(${Math.sin(frame * 0.45) * 2.2}deg) scale(${1 + Math.sin(frame * 0.3) * 0.02})`}}>
        {handleText(brand)}
      </div>
    </AbsoluteFill>
  );
};
