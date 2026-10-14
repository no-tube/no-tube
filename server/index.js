import express from 'express';
import cors from 'cors';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Ölü instance'lar elendi (adminforge site dönüyor, kavin/leptons 502).
// Sıralama adaptif: çalışan instance otomatik öne alınır.
const PIPED = [
  'https://pipedapi.ducks.party',
  'https://api.piped.private.coffee',
  'https://pipedapi.reallyaweso.me',
  'https://api.piped.yt'
];

const cache = new Map();
const CACHE_TTL = 1000 * 60 * 5;
const getCache = (k) => {
  const v = cache.get(k);
  if (!v) return null;
  if (Date.now() - v.t > CACHE_TTL) { cache.delete(k); return null; }
  return v.data;
};
const setCache = (k, data) => cache.set(k, { t: Date.now(), data });

// Piped'in proxy kapakları (proxy.*) sürekli 502 veriyor → direkt YouTube CDN kullan.
// i.ytimg.com her zaman herkese açık, API anahtarı falan gerektirmez.
const ytThumb = (id) => id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '';
const pipedId = (url) => url?.split('v=')[1]?.split('&')[0];

async function fetchWithTimeout(url, ms = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    const text = await r.text();
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + text.slice(0, 100));
    try { return JSON.parse(text); } catch { throw new Error('JSON değil: ' + text.slice(0, 100)); }
  } finally { clearTimeout(t); }
}

async function pipedFetch(endpoint) {
  let lastErr = null;
  for (const base of PIPED) {
    try {
      const data = await fetchWithTimeout(base + endpoint);
      if (data && (data.items || data.relatedStreams || data.title || Array.isArray(data) || data.comments || data.name)) {
        return { data, source: base };
      }
      // trending boş dizi dönerse de kabul etme, sıradakini dene
      if (Array.isArray(data) && data.length > 0) return { data, source: base };
      if (Array.isArray(data) && data.length === 0) continue;
      return { data, source: base };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Piped erişilemedi');
}

// ---------- yt-dlp yedeği (her zaman çalışır, API keysiz) ----------
async function ytdlpSearch(q, limit = 15) {
  const { stdout } = await execFileAsync('yt-dlp', ['-J', '--no-playlist', '--flat-playlist', `ytsearch${limit}:${q}`], { timeout: 30000, maxBuffer: 20 * 1024 * 1024 });
  const info = JSON.parse(stdout);
  return (info.entries || []).map(e => ({
    id: e.id, title: e.title, author: e.channel || e.uploader,
    authorId: e.channel_id, views: e.view_count, published: e.timestamp ? new Date(e.timestamp * 1000).toLocaleDateString('tr-TR') : '',
    duration: e.duration, thumbnail: e.thumbnails?.pop?.()?.url || `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`, description: e.description || '',
    live: e.live_status === 'is_live' || e.live_status === 'is_upcoming', short: false
  }));
}

async function ytdlpVideo(id) {
  const { stdout } = await execFileAsync('yt-dlp', ['-J', '--no-playlist', `https://www.youtube.com/watch?v=${id}`], { timeout: 30000, maxBuffer: 30 * 1024 * 1024 });
  const info = JSON.parse(stdout);
  const formats = (info.formats || []).filter(f => f.url);
  const pick = (pred) => formats.filter(pred).sort((a, b) => (b.tbr || 0) - (a.tbr || 0))[0]?.url || null;
  return {
    meta: {
      source: 'yt-dlp', id, title: info.title, author: info.uploader, authorId: info.channel_id,
      views: info.view_count, likes: info.like_count, published: info.upload_date,
      description: info.description, keywords: info.tags || [],
      thumbnail: info.thumbnail, related: []
    },
    stream: {
      title: info.title, author: info.uploader,
      combined720: pick(f => f.vcodec !== 'none' && f.acodec !== 'none' && (f.height || 0) <= 720),
      combined: pick(f => f.vcodec !== 'none' && f.acodec !== 'none'),
      video720: pick(f => f.vcodec !== 'none' && f.height === 720),
      audio: pick(f => f.vcodec === 'none' && f.acodec !== 'none')
    }
  };
}

// ---------- API ----------

app.get('/api/health', (req, res) => {
  res.json({ ok: true, piped: PIPED.length, ytdlp: true, mode: 'piped-first + ytdlp-fallback (API keysiz)' });
});

app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.status(400).json({ error: 'q gerekli' });
  const limit = Math.min(20, Math.max(5, parseInt(req.query.limit) || 15));
  const ck = 'search:' + q + ':' + limit;
  const hit = getCache(ck);
  if (hit) return res.json(hit);
  try {
    const { data, source } = await pipedFetch(`/search?q=${encodeURIComponent(q)}&filter=videos`);
    const out = {
      source: 'piped:' + source,
      results: (data.items || []).filter(i => i.type === 'stream').map(normPipedItem).filter(v => v)
    };
    setCache(ck, out);
    return res.json(out);
  } catch {
    try {
      const results = await ytdlpSearch(q, limit);
      const out = { source: 'yt-dlp', results };
      setCache(ck, out);
      return res.json(out);
    } catch { return res.status(502).json({ error: 'Arama şu an yapılamıyor, sonra tekrar dene.' }); }
  }
});

const normPipedItem = (i) => {
  const vid = pipedId(i.url);
  if (!vid) return null;
  return {
    id: vid, title: i.title, author: i.uploaderName,
    authorId: i.uploaderUrl?.split('/channel/')[1] || i.uploaderUrl?.split('/').pop(),
    views: i.views, published: i.uploadedDate || i.uploadedDate, duration: i.duration,
    thumbnail: ytThumb(vid), description: i.shortDescription || '',
    live: i.duration === -1, short: !!i.isShort
  };
};

async function pipedSearchItems(q, n = 5) {
  const { data } = await pipedFetch(`/search?q=${encodeURIComponent(q)}&filter=videos`);
  return (data.items || []).filter(i => i.type === 'stream').map(normPipedItem).filter(v => v && !v.live).slice(0, n);
}

app.get('/api/trending', async (req, res) => {
  const ck = 'trending:TR';
  const hit = getCache(ck);
  if (hit) return res.json(hit);
  try {
    const [tr, us] = await Promise.all([
      pipedFetch(`/trending?region=TR`).catch(() => ({ data: [], source: 'yok' })),
      pipedFetch(`/trending?region=US`).catch(() => ({ data: [], source: 'yok' }))
    ]);
    const seen = new Set();
    const norm = [...(Array.isArray(tr.data) ? tr.data : []), ...(Array.isArray(us.data) ? us.data : [])]
      .map(normPipedItem).filter(v => v && !seen.has(v.id) && seen.add(v.id));
    let normal = norm.filter(v => !v.live);
    const live = norm.filter(v => v.live);
    // Trendler canlı istilasındaysa (şu an öyle) popüler aramalarla doldur
    let filled = 0;
    if (normal.length < 12) {
      const fillers = ['popüler müzikler', 'komik videolar', 'teknoloji incelemesi', 'yemek tarifleri', 'futbol özet'];
      const batches = await Promise.all(fillers.map(q => pipedSearchItems(q, 4).catch(() => [])));
      for (const v of batches.flat()) {
        if (normal.length >= 24) break;
        if (!seen.has(v.id)) { seen.add(v.id); normal.push(v); filled++; }
      }
    }
    if (!normal.length && !live.length) throw new Error('boş trending');
    const out = {
      source: 'piped:' + tr.source + (filled ? ` (+${filled} popüler)` : ''),
      results: normal.slice(0, 24),
      live: live.slice(0, 8)
    };
    setCache(ck, out);
    return res.json(out);
  } catch {
    // Yedek: popüler konularda yt-dlp araması karıştır
    try {
      const topics = ['türkiye gündem', 'popüler müzikler 2026', 'komik videolar'];
      const all = [];
      for (const t of topics) { try { all.push(...await ytdlpSearch(t, 8)); } catch {} }
      const mixed = all.sort(() => Math.random() - 0.5).slice(0, 20);
      const out = { source: 'yt-dlp (karma trend)', results: mixed.filter(v => !v.live), live: mixed.filter(v => v.live) };
      setCache(ck, out);
      return res.json(out);
    } catch { return res.status(502).json({ error: 'Trendler alınamadı' }); }
  }
});

app.get('/api/video/:id', async (req, res) => {
  const { id } = req.params;
  const ck = 'video:' + id;
  const hit = getCache(ck);
  if (hit) return res.json(hit);
  try {
    const { data, base } = await getStreams(id);
    const out = {
      source: 'piped:' + base,
      id, title: data.title, author: data.uploader, authorId: data.uploaderUrl?.split('/channel/')[1],
      views: data.views, likes: data.likes, published: data.uploadDate,
      description: data.description, keywords: data.tags || [],
      thumbnail: ytThumb(id),
      related: (data.relatedStreams || []).filter(i => i.url?.includes('v=')).map(i => {
        const vid = pipedId(i.url);
        return {
          id: vid, title: i.title, author: i.uploaderName, views: i.views,
          published: i.uploadedDate, duration: i.duration, thumbnail: ytThumb(vid),
          live: i.duration === -1, short: !!i.isShort
        };
      })
    };
    setCache(ck, out);
    return res.json(out);
  } catch {
    try {
      const { meta } = await ytdlpVideo(id);
      // related için başlıktan arama yap
      try { meta.related = (await ytdlpSearch(meta.title, 12)).filter(v => v.id !== id); } catch {}
      setCache(ck, meta);
      return res.json(meta);
    } catch { return res.status(502).json({ error: 'Video bilgisi alınamadı' }); }
  }
});

app.get('/api/comments/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { data } = await pipedFetch(`/comments/${id}`);
    return res.json({ comments: (data.comments || []).map(c => ({ author: c.author, text: c.commentText, likes: c.likeCount, published: c.commentedTime, thumbnail: c.thumbnail })) });
  } catch { return res.json({ comments: [] }); }
});

app.get('/api/channel/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { data, source } = await pipedFetch(`/channel/${id}`);
    return res.json({
      source, name: data.name, subs: data.subscriberCount, banner: data.bannerUrl,
      avatar: data.avatarUrl, description: data.description,
      videos: (data.relatedStreams || []).filter(i => i.url?.includes('v=')).map(i => {
        const vid = pipedId(i.url);
        return { id: vid, title: i.title, author: data.name, views: i.views, thumbnail: ytThumb(vid), duration: i.duration, live: i.duration === -1, short: !!i.isShort };
      })
    });
  } catch { return res.status(502).json({ error: 'Kanal alınamadı' }); }
});

// Piped bazen LBRY aynası (odycdn) veya HLS manifestini videoStreams'e koyuyor.
// Bunlar <video>'da oynamaz → ele, sadece gerçekten oynatılabilir olanları al.
const isHlsUrl = (u) => !!u && (/\.m3u8(\?|$)/.test(u) || u.includes('manifest.googlevideo.com'));
const isPipedGarbage = (s) => !s?.url || s.quality === 'LBRY' || s.url.includes('odycdn.com') || isHlsUrl(s.url);
const qNum = (s) => parseInt(s?.quality) || 0;

function pipedSources(data) {
  const vids = (data.videoStreams || []).filter(s => !isPipedGarbage(s));
  const mp4combined = vids.filter(s => s.videoOnly === false && (s.mimeType || '').includes('mp4')).sort((a, b) => qNum(b) - qNum(a));
  const otherCombined = vids.filter(s => s.videoOnly === false && !(s.mimeType || '').includes('mp4')).sort((a, b) => qNum(b) - qNum(a));
  return [...mp4combined, ...otherCombined].map(s => ({ url: s.url, type: s.mimeType || 'video/mp4' }));
}

// DASH-only videolar (Shorts dahil) için ayrı görüntü+ses hatları
function pipedSplit(data) {
  const vids = (data.videoStreams || []).filter(s => !isPipedGarbage(s));
  const vo = vids.filter(s => s.videoOnly === true && (s.mimeType || '').includes('mp4')).sort((a, b) => qNum(b) - qNum(a))[0];
  const auds = (data.audioStreams || []).filter(a => a?.url && !isPipedGarbage(a));
  const ao = auds.find(a => (a.mimeType || '').includes('mp4')) || auds[0];
  return {
    vo: vo?.url || null,
    ao: ao?.url || null, aoType: (ao?.mimeType || '').includes('webm') ? 'audio/webm' : 'audio/mp4'
  };
}

// Stream URL'sini tarayıcıya vermeden önce gerçekten video döndüğünü doğrula.
// (Ölü proxy'ler 502/HTML dönüyordu → "no supported format" hatasının sebebi buydu.)
// hostOk: yakın zamanda doğrulanan proxy hostunu tekrar test etme (hız için).
const hostOk = new Map();
async function verifyVideoUrl(url, ms = 4000) {
  try {
    const origin = new URL(url).origin;
    const h = hostOk.get(origin);
    if (h && Date.now() - h < 600000) return true;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0', 'Range': 'bytes=0-1023' } });
    clearTimeout(t);
    const ct = r.headers.get('content-type') || '';
    const ok = (r.status === 200 || r.status === 206) && ct.includes('video');
    try { await r.body?.cancel(); } catch {}
    if (ok) hostOk.set(origin, Date.now());
    return ok;
  } catch { return false; }
}

// Ham /streams yanıtı için paylaşılan kısa önbellek:
// /api/video + /api/stream aynı videoyu isterse Piped'e tek kez gidilir.
const rawCache = new Map();
async function getStreams(id, skip = new Set(), useCache = true) {
  const ck = 'raw:' + id;
  if (useCache) {
    const hit = rawCache.get(ck);
    if (hit && Date.now() - hit.t < 90000 && !skip.has(hit.base)) return hit;
  }
  let lastErr = null;
  for (const base of [...PIPED]) {
    if (skip.has(base)) continue;
    try {
      const data = await fetchWithTimeout(base + `/streams/${id}`, 6000);
      if (!data || !data.title) throw new Error('boş streams');
      const idx = PIPED.indexOf(base); // çalışanı öne al
      if (idx > 0) { PIPED.splice(idx, 1); PIPED.unshift(base); }
      const out = { data, base, t: Date.now() };
      rawCache.set(ck, out);
      return out;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('piped yok');
}

app.get('/api/stream/:id', async (req, res) => {
  const { id } = req.params;
  const ck = 'stream:' + id;
  const hit = getCache(ck);
  if (hit) return res.json(hit);
  const embed = `https://www.youtube-nocookie.com/embed/${id}`;
  // Önbellek + adaptif instance + doğrulanmış proxy sayesinde genelde tek turda biter.
  // Proxy ölüyse o instance atlanıp sıradaki denenir.
  const skip = new Set();
  for (let attempt = 0; attempt < 3; attempt++) {
    let g;
    try { g = await getStreams(id, skip, attempt === 0); }
    catch { break; }
    const { data, base } = g;
    const sources = pipedSources(data);
    const hlsStreams = (data.videoStreams || []).filter(s => s?.url && isHlsUrl(s.url) && !s.url.includes('odycdn.com'));
    const hls = data.hls || hlsStreams[0]?.url || null;
    if (sources.length) {
      if (await verifyVideoUrl(sources[0].url)) {
        const split = pipedSplit(data);
        const out = {
          title: data.title, author: data.uploader, thumbnail: ytThumb(id),
          sources, hls, embed, source: base,
          vo: split.vo, ao: split.ao, aoType: split.aoType,
          combined720: sources[0]?.url || null, combined: sources[0]?.url || null,
          video720: null, audio: (data.audioStreams || []).find(a => a?.url && !isPipedGarbage(a))?.url || null
        };
        setCache(ck, out);
        return res.json(out);
      }
      skip.add(base); rawCache.delete('raw:' + id); continue; // proxy ölü → sıradaki
    }
    if (hls) { // canlı yayın: sadece HLS var
      const out = { title: data.title, author: data.uploader, thumbnail: ytThumb(id), sources: [], hls, embed, source: base, combined720: null, combined: null, video720: null, audio: null };
      setCache(ck, out);
      return res.json(out);
    }
    skip.add(base); rawCache.delete('raw:' + id);
  }
  try {
    const { stdout } = await execFileAsync('yt-dlp', ['-J', '--no-playlist', `https://www.youtube.com/watch?v=${id}`], { timeout: 30000, maxBuffer: 30 * 1024 * 1024 });
    const info = JSON.parse(stdout);
    const fmts = (info.formats || []).filter(f => f.url && (f.protocol === 'https' || f.protocol === 'http') && f.vcodec !== 'none' && f.acodec !== 'none' && !isHlsUrl(f.url));
    const mp4 = fmts.filter(f => f.ext === 'mp4').sort((a, b) => ((b.height || 0) - (a.height || 0)));
    const rest = fmts.filter(f => f.ext !== 'mp4').sort((a, b) => ((b.height || 0) - (a.height || 0)));
    const sources = [...mp4, ...rest].slice(0, 4).map(f => ({ url: f.url, type: f.ext === 'webm' ? 'video/webm' : 'video/mp4' }));
    if (sources.length && !(await verifyVideoUrl(sources[0].url))) sources.shift();
    // Birleşik yoksa (Shorts vb.) ayrı hatları dene
    let vo = null, ao = null, aoType = 'audio/mp4';
    if (!sources.length) {
      const vof = info.formats.filter(f => f.url && (f.protocol === 'https' || f.protocol === 'http') && f.vcodec !== 'none' && f.acodec === 'none' && !isHlsUrl(f.url) && f.ext === 'mp4').sort((a, b) => ((b.height || 0) - (a.height || 0)))[0];
      const aof = info.formats.filter(f => f.url && (f.protocol === 'https' || f.protocol === 'http') && f.vcodec === 'none' && f.acodec !== 'none' && !isHlsUrl(f.url)).sort((a, b) => ((a.ext === 'm4a' ? 0 : 1) - (b.ext === 'm4a' ? 0 : 1)) || ((b.abr || 0) - (a.abr || 0)))[0];
      if (vof && await verifyVideoUrl(vof.url)) {
        vo = vof.url;
        ao = aof?.url || null;
        aoType = aof?.ext === 'webm' ? 'audio/webm' : 'audio/mp4';
      }
    }
    const out = {
      title: info.title, author: info.uploader, thumbnail: ytThumb(id),
      sources, hls: null, embed, source: 'yt-dlp',
      vo, ao, aoType,
      combined720: sources[0]?.url || null, combined: sources[0]?.url || null, video720: null, audio: null
    };
    setCache(ck, out);
    return res.json(out);
  } catch {
    return res.json({ title: '', author: '', thumbnail: ytThumb(id), sources: [], hls: null, embed });
  }
});

// ---------- Shorts akışı (API'siz): izlenen kanalların /shorts sekmeleri + fallback ----------
// Piped Shorts vermiyor (isShort hep boş), o yüzden yt-dlp kanal sekmeleri kullanılıyor.
const SHORTS_FALLBACK = ['@MrBeast', '@YouTube', '@EnesBatur'];
async function shortsFromTab(url) {
  try {
    const { stdout } = await execFileAsync('yt-dlp', ['-J', '--no-playlist', '--flat-playlist', '--playlist-end', '8', url], { timeout: 25000, maxBuffer: 10 * 1024 * 1024 });
    const info = JSON.parse(stdout);
    const ch = info.channel || info.uploader || info.title || '';
    return (info.entries || []).filter(e => e?.id?.length === 11).map(e => ({
      id: e.id, title: e.title || 'Shorts', author: e.channel || e.uploader || ch,
      thumbnail: `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`, short: true
    }));
  } catch { return []; }
}

app.get('/api/shorts', async (req, res) => {
  const chs = (req.query.channels || '').toString().split(',').map(s => s.trim()).filter(s => /^[a-zA-Z0-9_-]{20,}$/.test(s)).slice(0, 5);
  const ck = 'shorts:' + (chs.join(',') || 'default');
  const hit = getCache(ck);
  if (hit) return res.json(hit);
  const tabs = chs.length
    ? chs.map(id => `https://www.youtube.com/channel/${id}/shorts`)
    : SHORTS_FALLBACK.map(h => `https://www.youtube.com/${h}/shorts`);
  const batches = await Promise.all(tabs.map(shortsFromTab));
  const seen = new Set();
  const out = {
    source: chs.length ? 'izlenen kanallar' : 'popüler',
    results: batches.flat().filter(v => !seen.has(v.id) && seen.add(v.id)).sort(() => Math.random() - 0.5).slice(0, 30)
  };
  setCache(ck, out);
  return res.json(out);
});

app.get('/api/download', async (req, res) => {
  const id = (req.query.id || '').toString();
  const format = (req.query.format || 'mp4').toString();
  if (!id.match(/^[a-zA-Z0-9_-]{11}$/)) return res.status(400).send('Geçersiz id');
  const url = `https://www.youtube.com/watch?v=${id}`;
  res.header('Content-Disposition', `attachment; filename="${id}.${format === 'mp3' ? 'mp3' : 'mp4'}"`);
  const args = format === 'mp3'
    ? ['-o', '-', '--no-playlist', '-x', '--audio-format', 'mp3', url]
    : ['-o', '-', '--no-playlist', '-f', 'bv*[height<=720]+ba/b[height<=720]/b', url];
  const child = spawn('yt-dlp', args);
  res.type(format === 'mp3' ? 'audio/mpeg' : 'video/mp4');
  child.stdout.pipe(res);
  child.on('error', () => { if (!res.headersSent) res.status(500).end(); });
});

app.listen(PORT, () => console.log(`✅ no-tube çalışıyor: http://localhost:${PORT}`));
