// Zero-dependency server. Requires Node.js 18+ (built-in fetch).
const http = require('http'), fs = require('fs'), path = require('path');
const { Readable } = require('stream');
const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const FB = /^(?:[a-z0-9-]+\.)*(facebook\.com|fb\.watch|fb\.com)$/i;
const CDN = /^(?:[a-z0-9-]+\.)*(fbcdn\.net|fbcdn\.com)$/i;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

// simple rate limit: 20 requests / minute / IP
const hits = new Map();
setInterval(() => hits.clear(), 10 * 60 * 1000).unref();
function limited(ip) {
  const now = Date.now(), arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now); hits.set(ip, arr); return arr.length > 20;
}
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function pick(html, keys) {
  for (const k of keys) {
    const m = html.match(new RegExp('"' + k + '":"([^"]+)"'));
    if (m) { try { return JSON.parse('"' + m[1] + '"'); } catch (e) {} }
  }
  return null;
}
function meta(html, prop) {
  const m = html.match(new RegExp('<meta[^>]+property="' + prop + '"[^>]+content="([^"]*)"', 'i'));
  return m ? m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>') : '';
}

async function info(req, res, q) {
  let target;
  try { target = new URL(q.get('url') || ''); } catch (e) { return send(res, 400, { error: 'invalid_url' }); }
  if (!/^https?:$/.test(target.protocol) || !FB.test(target.hostname)) return send(res, 400, { error: 'invalid_url' });
  let r;
  try {
    r = await fetch(target.href, {
      redirect: 'follow', signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9', 'Sec-Fetch-Mode': 'navigate' }
    });
  } catch (e) { return send(res, 502, { error: 'fetch_failed' }); }
  try { if (!FB.test(new URL(r.url).hostname)) return send(res, 400, { error: 'invalid_url' }); } catch (e) {}
  const html = await r.text();
  const hd = pick(html, ['browser_native_hd_url', 'playable_url_quality_hd', 'hd_src_no_ratelimit', 'hd_src']);
  const sd = pick(html, ['browser_native_sd_url', 'playable_url', 'sd_src_no_ratelimit', 'sd_src']);
  const links = [];
  const add = (quality, u) => { if (u && CDN.test(new URL(u).hostname)) links.push({ quality, url: '/api/download?u=' + encodeURIComponent(u) }); };
  try { add('HD', hd); add('SD', sd); } catch (e) {}
  if (!links.length) return send(res, 404, { error: 'not_found' });
  send(res, 200, { title: meta(html, 'og:title'), thumbnail: meta(html, 'og:image'), links });
}

async function download(req, res, q) {
  let u;
  try { u = new URL(q.get('u') || ''); } catch (e) { res.writeHead(400); return res.end('Bad request'); }
  if (u.protocol !== 'https:' || !CDN.test(u.hostname)) { res.writeHead(400); return res.end('Bad request'); }
  const headers = { 'User-Agent': UA };
  if (req.headers.range) headers.Range = req.headers.range;
  let r;
  try { r = await fetch(u.href, { headers, redirect: 'error', signal: AbortSignal.timeout(30000) }); }
  catch (e) { res.writeHead(502); return res.end('Upstream error'); }
  if (!r.ok && r.status !== 206) { res.writeHead(502); return res.end('Upstream error'); }
  const h = { 'Content-Type': r.headers.get('content-type') || 'video/mp4', 'Content-Disposition': 'attachment; filename="facebook-video.mp4"', 'X-Content-Type-Options': 'nosniff' };
  for (const k of ['content-length', 'content-range', 'accept-ranges']) if (r.headers.get(k)) h[k] = r.headers.get(k);
  res.writeHead(r.status, h);
  const stream = Readable.fromWeb(r.body);
  req.on('close', () => stream.destroy());
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

function serveStatic(req, res, pathname) {
  let p = decodeURIComponent(pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(PUB, path.normalize(p));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) {
      return fs.readFile(path.join(PUB, '404.html'), (e2, d2) => {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(d2 || 'Not found');
      });
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin'
    });
    res.end(data);
  });
}

http.createServer((req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname.startsWith('/api/')) {
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      if (req.method !== 'GET') return send(res, 405, { error: 'method' });
      if (limited(ip)) return send(res, 429, { error: 'rate_limited' });
      if (u.pathname === '/api/info') return info(req, res, u.searchParams);
      if (u.pathname === '/api/download') return download(req, res, u.searchParams);
      return send(res, 404, { error: 'not_found' });
    }
    serveStatic(req, res, u.pathname);
  } catch (e) { res.writeHead(500); res.end('Server error'); }
}).listen(PORT, () => console.log('Running on http://localhost:' + PORT));
