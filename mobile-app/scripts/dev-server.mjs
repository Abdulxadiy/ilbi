import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const metro = new URL('http://127.0.0.1:8081');
const backend = new URL(process.env.MOBILE_API_PROXY_TARGET || 'http://nginx:80');
if (!['http:', 'https:'].includes(backend.protocol) || backend.username || backend.password) throw Error('Invalid API proxy target');
const preview = await readFile(new URL('../preview/index.html', import.meta.url));
const favicon = await readFile(new URL('../assets/favicon.png', import.meta.url));
const hopHeaders = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];

function forward(req, res, target) {
  const headers = { ...req.headers, host: target.host };
  for (const name of hopHeaders) delete headers[name];
  const transport = target.protocol === 'https:' ? https : http;
  const upstream = transport.request(new URL(req.url, target), { method: req.method, headers }, response => {
    const responseHeaders = { ...response.headers };
    for (const name of hopHeaders) delete responseHeaders[name];
    res.writeHead(response.statusCode, responseHeaders);
    response.pipe(res);
  });
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: 'Development service unavailable. Check the mobile/Metro or backend logs.' }));
  });
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/preview' || pathname === '/preview/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(preview);
  } else if (pathname === '/favicon.ico') {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    res.end(favicon);
  } else if (pathname === '/healthz') {
    try {
      const response = await fetch(new URL('/status', metro), { signal: AbortSignal.timeout(3000) });
      const ready = response.ok && (await response.text()).includes('packager-status:running');
      res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ metro: ready ? 'ready' : 'starting' }));
    } catch {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ metro: 'starting' }));
    }
  } else {
    forward(req, res, pathname.startsWith('/api/') ? backend : metro);
  }
});

server.on('upgrade', (req, socket, head) => {
  const upstream = http.request(new URL(req.url, metro), { headers: { ...req.headers, host: metro.host } });
  upstream.on('upgrade', (response, remote, remoteHead) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\n');
    for (const [name, value] of Object.entries(response.headers)) socket.write(name + ': ' + value + '\r\n');
    socket.write('\r\n');
    if (remoteHead.length) socket.write(remoteHead);
    if (head.length) remote.write(head);
    socket.pipe(remote).pipe(socket);
    socket.on('error', () => remote.destroy());
    remote.on('error', () => socket.destroy());
  });
  upstream.on('error', () => socket.destroy());
  upstream.end();
});

const child = spawn(process.execPath, ['node_modules/expo/bin/cli', 'start', '--host', 'lan', '--port', '8081', '--max-workers', '2', '--web'], {
  stdio: 'inherit', env: { ...process.env, BROWSER: 'none', EXPO_NO_TELEMETRY: '1' },
});
server.listen(8082, '0.0.0.0', () => console.log('ILBI interactive phone preview: http://localhost:8082/preview'));
child.on('exit', code => { server.close(); process.exit(code || 0); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  child.kill(signal);
  server.close();
  setTimeout(() => process.exit(0), 3000).unref();
});
