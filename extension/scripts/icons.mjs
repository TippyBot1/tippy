// Render the Tippy icon SVG to the PNG sizes Chrome wants.
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'assets/tippy-icon.svg'), 'utf8');
const out = join(root, 'public/icon');
mkdirSync(out, { recursive: true });
for (const size of [16, 32, 48, 96, 128]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(join(out, `${size}.png`), png);
  console.log(`icon/${size}.png`, png.length, 'bytes');
}
