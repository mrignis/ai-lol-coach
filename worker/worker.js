// AI LoL Coach — Cloudflare Worker (key proxy)
// ---------------------------------------------------------------------------
// Hides RIOT_API_KEY, GROQ_API_KEY and GEMINI_API_KEY behind one authenticated
// endpoint, so the desktop app ships with NO upstream keys. The real keys live
// only in Cloudflare secrets and never touch the client, the installer or git.
//
// Secrets (run once):
//   wrangler secret put APP_TOKEN        ← shared token the app sends
//   wrangler secret put RIOT_API_KEY     ← developer.riotgames.com
//   wrangler secret put GROQ_API_KEY     ← console.groq.com
//   wrangler secret put GEMINI_API_KEY   ← aistudio.google.com
// Deploy: wrangler deploy
//
// Security model:
//   1. Every request must carry `Authorization: Bearer <APP_TOKEN>`.
//   2. Riot proxying is restricted to a fixed region list and a path allowlist,
//      so it can't be abused as an arbitrary proxy.
//   3. Best-effort per-IP rate limit; add a Cloudflare dashboard rate-limit rule
//      for a hard guarantee.
//   4. No CORS headers: the desktop app calls this server-to-server, so browsers
//      on other sites can't invoke it.
//   5. Keys are only ever attached to the OUTBOUND upstream request; they are
//      never echoed back to the caller.
// ---------------------------------------------------------------------------

const RIOT_REGIONS = new Set([
  'americas', 'asia', 'europe', 'sea',
  'na1', 'euw1', 'eun1', 'kr', 'br1', 'jp1', 'la1', 'la2', 'oc1', 'tr1', 'ru',
]);
// Only the read-only endpoints the app actually uses.
const RIOT_PATH_OK = /^(riot\/account\/v1|lol\/(summoner|league|match|platform|challenges))\//;

const GEMINI_MODEL_OK = /^[A-Za-z0-9.\-]+:generateContent$/;

const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

// Best-effort per-IP limiter (per isolate). The real guarantee is a Cloudflare
// rate-limit rule; this just blunts a burst from one machine.
const hits = new Map();
function rateLimited(ip, limit = 40, windowMs = 60000) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now - rec.start > windowMs) { hits.set(ip, { start: now, n: 1 }); return false; }
  rec.n++;
  if (hits.size > 5000) hits.clear(); // never grow unbounded
  return rec.n > limit;
}

async function proxyUpstream(target, init, upstreamName) {
  try {
    const r = await fetch(target, init);
    // Pass the body straight through; force JSON content type, drop everything else.
    return new Response(r.body, { status: r.status, headers: { 'Content-Type': 'application/json' } });
  } catch {
    return json(502, { error: upstreamName + '_unreachable' });
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === 'GET' && path === '/health') return json(200, { ok: true });

    // 1) auth gate
    if (!env.APP_TOKEN) return json(500, { error: 'worker_misconfigured' });
    if ((req.headers.get('Authorization') || '') !== `Bearer ${env.APP_TOKEN}`) {
      return json(401, { error: 'unauthorized' });
    }

    // 2) rate limit
    const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
    if (rateLimited(ip)) return json(429, { error: 'rate_limited' });

    // 3) Groq (OpenAI-compatible chat completions)
    if (req.method === 'POST' && path === '/groq') {
      if (!env.GROQ_API_KEY) return json(500, { error: 'groq_key_missing' });
      return proxyUpstream('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.GROQ_API_KEY}` },
        body: await req.text(),
      }, 'groq');
    }

    // 4) Gemini: /gemini/<model>:generateContent
    if (req.method === 'POST' && path.startsWith('/gemini/')) {
      if (!env.GEMINI_API_KEY) return json(500, { error: 'gemini_key_missing' });
      const model = path.slice('/gemini/'.length);
      if (!GEMINI_MODEL_OK.test(model)) return json(400, { error: 'bad_model' });
      return proxyUpstream(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${env.GEMINI_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: await req.text() },
        'gemini');
    }

    // 5) Riot: /riot/<region>/<path...>
    if (req.method === 'GET' && path.startsWith('/riot/')) {
      if (!env.RIOT_API_KEY) return json(500, { error: 'riot_key_missing' });
      const rest = path.slice('/riot/'.length);
      const slash = rest.indexOf('/');
      if (slash < 0) return json(400, { error: 'bad_path' });
      const region = rest.slice(0, slash);
      const riotPath = rest.slice(slash + 1);
      if (!RIOT_REGIONS.has(region)) return json(400, { error: 'bad_region' });
      if (!RIOT_PATH_OK.test(riotPath)) return json(403, { error: 'path_not_allowed' });
      return proxyUpstream(
        `https://${region}.api.riotgames.com/${riotPath}${url.search}`,
        { headers: { 'X-Riot-Token': env.RIOT_API_KEY } },
        'riot');
    }

    return json(404, { error: 'not_found' });
  },
};
