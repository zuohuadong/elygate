const root = './dist';
const port = Number(process.env.PORT || 3001);

const contentTypes: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
};

function safePath(pathname: string) {
  const normalized = pathname === '/' ? '/index.html' : pathname;
  const decoded = decodeURIComponent(normalized);
  if (decoded.includes('..')) return null;
  return `${root}${decoded}`;
}

Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    let path = safePath(url.pathname);
    if (!path) return new Response('Bad Request', { status: 400 });

    let file = Bun.file(path);
    if (!(await file.exists()) && !url.pathname.includes('.')) {
      path = `${root}/index.html`;
      file = Bun.file(path);
    }

    if (!(await file.exists())) return new Response('Not Found', { status: 404 });

    const ext = path.split('.').pop() || '';
    const headers = new Headers();
    headers.set('Content-Type', contentTypes[ext] || 'application/octet-stream');
    headers.set('Cache-Control', url.pathname.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache, no-store, must-revalidate');
    return new Response(file, { headers });
  },
});

console.log(`Elygate admin web listening on :${port}`);
