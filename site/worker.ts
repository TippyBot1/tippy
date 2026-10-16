// tippybot.fun is static files; this only runs for /media/* (see wrangler.jsonc).
// Safari won't play a video unless the server answers byte-range requests, and
// static assets send the whole file, so this cuts the requested range out of it.

interface Env {
  ASSETS: { fetch: typeof fetch };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const res = await env.ASSETS.fetch(req.url, { method: req.method === 'HEAD' ? 'HEAD' : 'GET' });
    const headers = new Headers(res.headers);
    headers.set('Accept-Ranges', 'bytes');
    const range = req.headers.get('Range');
    if (!range || res.status !== 200 || req.method === 'HEAD') return new Response(res.body, { status: res.status, headers });

    const body = await res.arrayBuffer();
    const size = body.byteLength;
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    let start = m && m[1] !== '' ? Number(m[1]) : NaN;
    let end = m && m[2] !== '' ? Number(m[2]) : size - 1;
    if (m && m[1] === '' && m[2] !== '') {
      // "bytes=-500": the last 500 bytes
      start = Math.max(0, size - Number(m[2]));
      end = size - 1;
    }
    end = Math.min(end, size - 1);
    if (!m || !Number.isFinite(start) || start > end) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    headers.set('Content-Length', String(end - start + 1));
    return new Response(body.slice(start, end + 1), { status: 206, headers });
  },
};
