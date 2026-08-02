#!/usr/bin/env node
// 데모용 플레이스홀더 사진 8장 및 샘플 비디오/GIF 생성 (ffmpeg 필요)
import {execSync} from 'node:child_process';
const FF = process.env.FFMPEG ?? 'ffmpeg';
const colors = [['0x2b2620','0x8a7a66'],['0x1d2126','0x5d6b7a'],['0x26201d','0x9a5f4a'],['0x20241f','0x6f7d5c'],['0x24202a','0x7a6a8a'],['0x14202a','0x4a7a8a'],['0x2a1d20','0x8a4a5f'],['0x1f2416','0x7d8a4a']];

console.log('Generating images...');
colors.forEach(([c0, c1], i) => {
  execSync(`${FF} -y -hide_banner -loglevel error -f lavfi -i "gradients=s=1080x1920:c0=${c0}:c1=${c1}:type=linear:speed=0.00001" -vf "noise=alls=8:allf=t" -frames:v 1 public/photos/demo/0${i + 1}.jpg`);
});
console.log('✅ public/photos/demo/01~08.jpg');

console.log('Generating sample video (video.mp4)...');
execSync(`${FF} -y -hide_banner -loglevel error -f lavfi -i "gradients=s=1080x1920:c0=0x2b2620:c1=0x8a7a66:speed=1" -t 5 -c:v libx264 -pix_fmt yuv420p public/photos/demo/video.mp4`);
console.log('✅ public/photos/demo/video.mp4');

console.log('Generating sample animated GIF (sample.gif)...');
execSync(`${FF} -y -hide_banner -loglevel error -f lavfi -i "gradients=s=1080x1920:c0=0x1d2126:c1=0x5d6b7a:speed=1" -t 3 -pix_fmt rgb24 -r 10 public/photos/demo/sample.gif`);
console.log('✅ public/photos/demo/sample.gif');
