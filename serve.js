/* Tiny static server for local preview.
   Usage: node serve.js   →  http://localhost:5173
   Bind 0.0.0.0 so a phone on the same Wi-Fi can open it too.
*/
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 5173;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch { res.writeHead(400); res.end('Bad request'); return; }

  let file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  if (urlPath === '/' || urlPath === '') file = path.join(ROOT, 'index.html');

  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA fallback
      file = path.join(ROOT, 'index.html');
      if (!fs.existsSync(file)) { res.writeHead(404); res.end('Not found'); return; }
      stat = fs.statSync(file);
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const lan = [];
  for (const list of Object.values(nets)) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) lan.push(n.address);
    }
  }
  console.log('');
  console.log('  六年之约 · Jack 已启动');
  console.log('  电脑访问: http://localhost:' + PORT);
  lan.forEach((ip) => console.log('  手机访问: http://' + ip + ':' + PORT));
  console.log('');
  console.log('  按 Ctrl+C 停止。');
  if (process.argv.includes('--open') && process.platform === 'win32') {
    setTimeout(() => exec('start "" "http://localhost:' + PORT + '"'), 350);
  }
});
