// render_code 예시: function (ctx, t, lib) 의 본문
const k = lib.easeOutBack(Math.min(1, t / 0.8));
ctx.fillStyle = '#0d1b2a';
ctx.fillRect(0, 0, lib.W, lib.H);
for (let i = 0; i < 40; i++) {
  const a = (i / 40) * Math.PI * 2 + t * 0.6;
  const r = 300 + lib.noise1(i + t) * 80;
  ctx.fillStyle = 'hsl(' + (i * 9 + t * 40) + ',80%,60%)';
  ctx.beginPath();
  ctx.arc(lib.W / 2 + Math.cos(a) * r * k, lib.H / 2 + Math.sin(a) * r * k, 14, 0, Math.PI * 2);
  ctx.fill();
}
ctx.fillStyle = '#fff';
ctx.font = '800 90px "Apple SD Gothic Neo"';
ctx.textAlign = 'center';
ctx.globalAlpha = lib.clamp01((t - 0.5) / 0.5);
ctx.fillText('코드 모드', lib.W / 2, lib.H / 2 + 30);
