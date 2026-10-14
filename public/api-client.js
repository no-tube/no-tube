// no-tube API katmanı — iki mod:
// - FULL (kendi backend'in): aynı-origin /api/* (Piped + yt-dlp hibrit, her şey çalışır)
// - STATIC (GitHub Pages): tarayıcıdan direkt Piped (Shorts + indirme yok, gerisi var)
const STATIC = typeof location !== 'undefined' &&
  (location.hostname.endsWith('github.io') || location.protocol === 'file:');

const PD_INST = [
  'https://pipedapi.ducks.party',
  'https://api.piped.private.coffee',
  'https://pipedapi.reallyaweso.me',
  'https://api.piped.yt'
];

const pdThumb = (id) => id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '';
const pdId = (url) => url?.split('v=')[1]?.split('&')[0];
const pdIsHls = (u) => !!u && (/\.m3u8(\?|$)/.test(u) || (u.includes('manifest.googlevideo.com')));
const pdGarbage = (s) => !s?.url || s.quality === 'LBRY' || s.url.includes('odycdn.com') || pdIsHls(s.url);
const pdQNum = (s) => parseInt(s?.quality) || 0;

async function pp(path, ms = 12000) {
  let lastErr = null;
  for (const base of PD_INST) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), ms);
      const r = await fetch(base + path, { signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return { json: await r.json(), base };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('piped yok');
}

function pdNorm(i) {
  const vid = pdId(i.url);
  if (!vid) return null;
  return {
    id: vid, title: i.title, author: i.uploaderName,
    authorId: i.uploaderUrl?.split('/channel/')[1] || i.uploaderUrl?.split('/').pop(),
    views: i.views, published: i.uploadedDate, duration: i.duration,
    thumbnail: pdThumb(vid), description: i.shortDescription || '',
    live: i.duration === -1, short: !!i.isShort
  };
}

function pdSources(data) {
  const vids = (data.videoStreams || []).filter(s => !pdGarbage(s));
  const mp4 = vids.filter(s => s.videoOnly === false && (s.mimeType || '').includes('mp4')).sort((a, b) => pdQNum(b) - pdQNum(a));
  const rest = vids.filter(s => s.videoOnly === false && !(s.mimeType || '').includes('mp4')).sort((a, b) => pdQNum(b) - pdQNum(a));
  return [...mp4, ...rest].map(s => ({ url: s.url, type: s.mimeType || 'video/mp4' }));
}

function pdSplit(data) {
  const vids = (data.videoStreams || []).filter(s => !pdGarbage(s));
  const vo = vids.filter(s => s.videoOnly === true && (s.mimeType || '').includes('mp4')).sort((a, b) => pdQNum(b) - pdQNum(a))[0];
  const auds = (data.audioStreams || []).filter(a => a?.url && !pdGarbage(a));
  const ao = auds.find(a => (a.mimeType || '').includes('mp4')) || auds[0];
  return { vo: vo?.url || null, ao: ao?.url || null, aoType: (ao?.mimeType || '').includes('webm') ? 'audio/webm' : 'audio/mp4' };
}

async function pdShorts(queries) {
  const seen = new Set();
  const scored = [];
  const batches = await Promise.all(queries.map(q =>
    pp(`/search?q=${encodeURIComponent(q)}&filter=videos`).then(({ json }) =>
      (json.items || []).filter(i => i.type === 'stream').map(pdNorm).filter(v => v)
    ).catch(() => [])
  ));
  for (const v of batches.flat()) {
    if (!v || seen.has(v.id) || v.live) continue;
    seen.add(v.id);
    const d = Number(v.duration);
    if (!(d >= 4 && d <= 70)) continue; // sadece kısa videolar
    const t = (v.title || '').toLowerCase();
    const isS = t.includes('shorts') || t.includes('#short') || v.short;
    scored.push({ v: { ...v, short: true }, s: (isS ? 100 : 0) + Math.log10(Math.max(10, Number(v.views) || 100)) });
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, 24).map(x => x.v);
}

async function pdSearchItems(q, n = 5) {
  const { json } = await pp(`/search?q=${encodeURIComponent(q)}&filter=videos`);
  return (json.items || []).filter(i => i.type === 'stream').map(pdNorm).filter(v => v && !v.live).slice(0, n);
}

const Api = {
  async trending() {
    if (!STATIC) return fetch('/api/trending').then(r => r.json());
    const [tr, us] = await Promise.all([
      pp(`/trending?region=TR`).catch(() => ({ json: [], base: 'yok' })),
      pp(`/trending?region=US`).catch(() => ({ json: [], base: 'yok' }))
    ]);
    const seen = new Set();
    const norm = [...(Array.isArray(tr.json) ? tr.json : []), ...(Array.isArray(us.json) ? us.json : [])]
      .map(pdNorm).filter(v => v && !seen.has(v.id) && seen.add(v.id));
    let normal = norm.filter(v => !v.live);
    const live = norm.filter(v => v.live);
    let filled = 0;
    if (normal.length < 12) {
      const fillers = ['popüler müzikler', 'komik videolar', 'teknoloji incelemesi', 'yemek tarifleri', 'futbol özet'];
      const batches = await Promise.all(fillers.map(q => pdSearchItems(q, 4).catch(() => [])));
      for (const v of batches.flat()) {
        if (normal.length >= 24) break;
        if (!seen.has(v.id)) { seen.add(v.id); normal.push(v); filled++; }
      }
    }
    return { source: 'piped-direct' + (filled ? ` (+${filled} popüler)` : ''), results: normal.slice(0, 24), live: live.slice(0, 8) };
  },

  async search(q, limit = 15) {
    if (!STATIC) return fetch('/api/search?q=' + encodeURIComponent(q) + '&limit=' + limit).then(r => r.json());
    const { json, base } = await pp(`/search?q=${encodeURIComponent(q)}&filter=videos`);
    return { source: 'piped-direct:' + base, results: (json.items || []).filter(i => i.type === 'stream').map(pdNorm).filter(v => v).slice(0, limit) };
  },

  async video(id) {
    if (!STATIC) return fetch('/api/video/' + id).then(r => r.json());
    const { json: d, base } = await pp(`/streams/${id}`);
    if (!d || !d.title) throw new Error('video yok');
    return {
      source: 'piped-direct:' + base,
      id, title: d.title, author: d.uploader, authorId: d.uploaderUrl?.split('/channel/')[1],
      views: d.views, likes: d.likes, published: d.uploadDate,
      description: d.description, keywords: d.tags || [], thumbnail: pdThumb(id),
      related: (d.relatedStreams || []).filter(i => i.url?.includes('v=')).map(i => {
        const vid = pdId(i.url);
        return { id: vid, title: i.title, author: i.uploaderName, views: i.views, published: i.uploadedDate, duration: i.duration, thumbnail: pdThumb(vid), live: i.duration === -1, short: !!i.isShort };
      }).filter(v => v.id)
    };
  },

  async stream(id) {
    if (!STATIC) return fetch('/api/stream/' + id).then(r => r.json());
    const embed = `https://www.youtube-nocookie.com/embed/${id}`;
    const { json: d, base } = await pp(`/streams/${id}`);
    if (!d || !d.title) throw new Error('stream yok');
    const sources = pdSources(d);
    const hlsX = (d.videoStreams || []).filter(s => s?.url && pdIsHls(s.url) && !s.url.includes('odycdn.com'));
    const hls = d.hls || hlsX[0]?.url || null;
    const split = pdSplit(d);
    return {
      title: d.title, author: d.uploader, thumbnail: pdThumb(id),
      sources, hls, embed, source: 'piped-direct:' + base,
      vo: split.vo, ao: split.ao, aoType: split.aoType,
      combined720: sources[0]?.url || null, combined: sources[0]?.url || null
    };
  },

  async comments(id) {
    if (!STATIC) return fetch('/api/comments/' + id).then(r => r.json());
    try {
      const { json } = await pp(`/comments/${id}`);
      return { comments: (json.comments || []).map(c => ({ author: c.author, text: c.commentText, likes: c.likeCount, published: c.commentedTime, thumbnail: c.thumbnail })) };
    } catch { return { comments: [] }; }
  },

  async channel(id) {
    if (!STATIC) return fetch('/api/channel/' + id).then(r => r.json());
    const { json: d, base } = await pp(`/channel/${id}`);
    return {
      source: 'piped-direct:' + base, name: d.name, subs: d.subscriberCount,
      banner: d.bannerUrl, avatar: d.avatarUrl, description: d.description,
      videos: (d.relatedStreams || []).filter(i => i.url?.includes('v=')).map(i => {
        const vid = pdId(i.url);
        return { id: vid, title: i.title, author: d.name, views: i.views, thumbnail: pdThumb(vid), duration: i.duration, live: i.duration === -1, short: !!i.isShort };
      }).filter(v => v.id)
    };
  },

  async shorts(channels = [], queries = []) {
    if (!STATIC) return fetch('/api/shorts' + (channels.length ? '?channels=' + channels.join(',') : '')).then(r => r.json());
    const qs = [...queries.slice(0, 3), 'komik shorts', 'shorts videoları', 'ilginç kısa videolar'].slice(0, 5);
    return { source: 'piped-direct shorts', results: await pdShorts(qs) };
  }
};
