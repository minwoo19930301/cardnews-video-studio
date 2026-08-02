import {loadFont} from '@remotion/fonts';
import {staticFile} from 'remotion';

for (const [file, weight] of [
  ['fonts/GmarketSansLight.woff', '300'],
  ['fonts/GmarketSansMedium.woff', '500'],
  ['fonts/GmarketSansBold.woff', '700'],
] as const) {
  loadFont({family: 'Gmarket Sans', url: staticFile(file), weight});
}
