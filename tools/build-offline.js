/* Build a single-file, fully offline copy of the app.
   Usage: node tools/build-offline.js
   Output: 六年之约.html in the project root. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let html = read('index.html');
const css = read('assets/style.css');
const js = read('assets/app.js');
const iconSvg = read('assets/icon.svg').replace(/\s+/g, ' ').trim();
const iconPng = fs.readFileSync(path.join(ROOT, 'assets/icon-180.png')).toString('base64');

if (js.includes('</script>')) throw new Error('app.js contains </script>');

html = html
  .replace('<link rel="manifest" href="manifest.webmanifest">', '')
  .replace('<link rel="icon" href="assets/icon.svg" type="image/svg+xml">',
    `<link rel="icon" href="data:image/svg+xml;base64,${Buffer.from(iconSvg).toString('base64')}">`)
  .replace('<link rel="apple-touch-icon" href="assets/icon-180.png">',
    `<link rel="apple-touch-icon" href="data:image/png;base64,${iconPng}">`)
  .replace(/<link rel="stylesheet" href="assets\/style\.css[^"]*">/, `<style>\n${css}\n</style>`)
  .replace(/<script src="assets\/app\.js[^"]*"><\/script>/, `<script>\n${js}\n</script>`);

if (html.includes('href="assets/') || html.includes('src="assets/')) {
  throw new Error('asset reference left in output');
}

const out = path.join(ROOT, '六年之约.html');
fs.writeFileSync(out, html, 'utf8');
console.log('built', out);
console.log('size', (Buffer.byteLength(html) / 1024).toFixed(1) + ' KB');
