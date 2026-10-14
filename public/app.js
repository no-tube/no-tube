// API'siz istemci + öneri algoritması
let currentAuthorId = null;
let lastRelated = [];

const $ = id => document.getElementById(id);
const fmtViews = v => v == null ? '' : Number(v).toLocaleString('tr-TR') + ' görüntüleme';
const fmtDur = s => { if (s === -1) return '🔴 CANLI'; if (s == null) return ''; s = Number(s); if (isNaN(s)) return s; const h = Math.floor(s/3600), m = Math.floor(s%3600/60), ss = s%60; return h ? `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}` : `${m}:${String(ss).padStart(2,'0')}`; };

// ---------- Geçmiş + Algoritma ----------
const getHist = () => JSON.parse(localStorage.getItem('yt_hist') || '[]');
const saveWatch = v => {
  const h = getHist().filter(x => x.id !== v.id);
  h.unshift({ id: v.id, title: v.title||'', author: v.author||'', authorId: v.authorId||'', ts: Date.now() });
  localStorage.setItem('yt_hist', JSON.stringify(h.slice(0, 100)));
};
// Arama geçmişi — algoritmanın 2. sinyali (açık niyet beyanı)
const getSearches = () => JSON.parse(localStorage.getItem('yt_search') || '[]');
const saveSearch = q => {
  q = (q || '').trim();
  if (q.length < 2) return;
  const h = getSearches().filter(x => x.q.toLowerCase() !== q.toLowerCase());
  h.unshift({ q, ts: Date.now() });
  localStorage.setItem('yt_search', JSON.stringify(h.slice(0, 20)));
};
const tok = s => (s || '').toLowerCase().split(/[^a-zçğıöşü0-9]+/).filter(w => w.length > 2);
const searchTerms = () => {
  const set = new Set();
  getSearches().slice(0, 8).forEach(s => tok(s.q).forEach(w => set.add(w)));
  return set;
};

// Kullanıcının geçmişine göre videoyu puanla — KELİME EŞLEŞTİRMESİ YOK.
// ("yapay zeka" izleyince "AI music cover" gelmesi gibi yanlış pozitifler yapıyordu.)
// Sinyaller: aynı kanal + YouTube ilişki grafiğinden gelme + popülerlik.
function scoreVideo(v) {
  const hist = getHist();
  const st = searchTerms();
  if (!hist.length && !st.size) return Math.random(); // soğuk başlangıç
  let score = 0;
  for (const h of hist) {
    if (v.author && h.author && v.author === h.author) score += 10;
    if (v.authorId && h.authorId && v.authorId === h.authorId) score += 12;
  }
  if (v._via) score += 6; // izlediğin videoyla ilişkili (anlamsal benzerlik)
  // Arama sinyali: KULLANICININ KENDİ aradığı kelimeler (açık niyet — başlık çıkarımı değil)
  // Bilerek hafif tutuldu: tek arama tüm sayfayı ele geçirmesin (yanına kota da var)
  if (st.size && v.title) {
    const vt = new Set(tok(v.title));
    let n = 0;
    st.forEach(t => { if (vt.has(t)) n++; });
    score += Math.min(n, 3) * 2;
  }
  score += Math.log10(Math.max(10, Number(v.views) || 1000)) * 0.5; // popülerlik boost
  return score + Math.random() * 0.5;
}
function rankVideos(list) { return [...list].sort((a,b) => scoreVideo(b) - scoreVideo(a)); }

const recoCard = (v) => card(v);

function card(v) {
  return `<div class="card rounded-xl overflow-hidden cursor-pointer bg-[#1a1a1a]" onclick="watch('${v.id}')">
    <div class="relative"><img src="${v.thumbnail}" onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${v.id}/hqdefault.jpg'" loading="lazy" class="w-full aspect-video object-cover"/>
    <span class="absolute bottom-1 right-1 text-xs bg-black/80 rounded px-1">${fmtDur(v.duration)}</span></div>
    <div class="p-3"><p class="font-semibold text-sm line2">${v.title||'Başlıksız'}</p>
    <p class="text-xs text-gray-400 mt-1">${v.author||''} • ${v.published||''}</p></div></div>`;
}

// ---------- Views ----------
async function goHome() {
  hideShorts();
  $('watchView').classList.add('hidden'); $('channelView').classList.add('hidden'); $('homeView').classList.remove('hidden');
  loadTrending();
}
async function loadTrending() {
  try {
    const r = await Api.trending();
    const list = r.results || [];
    lastRelated = list;
    // Geçmiş (izleme veya arama) varsa ana sayfa = sadece öneriler. Yoksa Keşfet göster.
    if (getHist().length || getSearches().length) { $('exploreWrap').classList.add('hidden'); }
    else {
      $('exploreWrap').classList.remove('hidden');
      $('exploreTitle').textContent = '🧭 Keşfet';
      $('grid').innerHTML = list.map(card).join('');
    }
    renderReco(list);
  } catch { $('grid').innerHTML = '<p class="text-gray-400">Yüklenemedi, sayfayı yenile.</p>'; }
}

// Gerçek öneri motoru: geçmişten yeni adaylar bulur (sadece sıralamaz, keşfeder)
let recoToken = 0;
async function renderReco(pool) {
  const my = ++recoToken;
  const hist = getHist();
  const nSearch = getSearches().length;
  if (!hist.length && !nSearch) { $('recoBar').classList.add('hidden'); return; }
  $('recoBar').classList.remove('hidden');
  const watched = new Set(hist.map(h => h.id));
  const fresh = (pool || []).filter(v => v.id && !watched.has(v.id) && !v.live);
  const basis = `${hist.length} izleme + ${nSearch} arama`;
  // 1) Anında: mevcut havuzu kişiselleştirilmiş sırayla göster
  $('recoRow').innerHTML = rankVideos(fresh).slice(0, 8).map(recoCard).join('')
    || '<p class="text-sm text-gray-400">Öneriler hazırlanıyor...</p>';
  $('recoNote').textContent = `${basis} baz alındı • yeni öneriler bulunuyor...`;
  // 2) Arka planda: YENİ adaylar — 3 kaynak (başlık kelimesi çıkarımı YOK):
  try {
    const queries = [];
    // a) İzlediğin videoların "ilgili videoları" → YouTube'un kendi anlam grafiği
    //    (kelime benzerliği değil, gerçekten ilişkili içerik + başka kanallar)
    for (const h of hist.slice(0, 4)) queries.push({ type: 'related', q: h.id, via: h.title });
    // b) İzlediğin kanalların yenileri (aynı youtuber'dan da gelsin ama kotayla)
    const seenCh = new Set();
    for (const h of hist) {
      if (h.authorId && !seenCh.has(h.authorId) && queries.filter(q => q.type === 'channel').length < 2) {
        seenCh.add(h.authorId);
        queries.push({ type: 'channel', q: h.authorId });
      }
      if (queries.filter(q => q.type === 'channel').length >= 2) break;
    }
    // c) Geçmiş aramaların güncel sonuçları → aradığın konularda yeni videolar
    const seenQ = new Set();
    for (const s of getSearches().slice(0, 6)) {
      const key = s.q.toLowerCase();
      if (!seenQ.has(key) && queries.length < 8) { seenQ.add(key); queries.push({ type: 'search', q: s.q }); }
    }
    const batches = await Promise.all(queries.map(async qq => {
      try {
        if (qq.type === 'related') {
          const v = await Api.video(qq.q);
          return (v.related || []).map(x => ({ ...x, _via: qq.via, _src: 'related' }));
        }
        if (qq.type === 'search') {
          const s = await Api.search(qq.q, 8);
          return (s.results || []).map(x => ({ ...x, _src: 'search:' + qq.q.toLowerCase() }));
        }
        const c = await Api.channel(qq.q);
        return (c.videos || []).map(x => ({ ...x, _src: 'channel' }));
      } catch { return []; }
    }));
    if (my !== recoToken) return;
    const cand = new Map();
    batches.flat().forEach(v => { if (v?.id && !watched.has(v.id) && !v.live && !cand.has(v.id)) cand.set(v.id, v); });
    // Çeşitlilik kotası: tek kanal max 2 video + kaynak bütçesi
    // (ilişkili max 7, kanal max 3, arama kökenli max 4, aynı sorgudan max 2
    //  → tek arama/kategori sayfayı ele geçiremez)
    const perAuthor = {};
    const perSrc = {};
    const diverse = [];
    const TARGET = 12;
    const budgetOf = (kind) => ({ related: 7, channel: 3, search: 4 }[kind] ?? 99);
    for (const v of rankVideos([...cand.values()])) {
      const k = v.authorId || v.author || '?';
      if ((perAuthor[k] || 0) >= 2) continue;
      const kind = v._src ? v._src.split(':')[0] : 'related';
      if ((perSrc[kind] || 0) >= budgetOf(kind)) continue;
      if (kind === 'search' && (perSrc[v._src] || 0) >= 2) continue;
      perAuthor[k] = (perAuthor[k] || 0) + 1;
      perSrc[kind] = (perSrc[kind] || 0) + 1;
      if (kind === 'search') perSrc[v._src] = (perSrc[v._src] || 0) + 1;
      diverse.push(v);
      if (diverse.length >= TARGET) break;
    }
    // Aday az gelirse havuzdan tamamla — ana sayfa boş kalmasın
    if (diverse.length < TARGET) {
      const inList = new Set(diverse.map(v => v.id));
      for (const v of rankVideos(fresh.filter(x => !cand.has(x.id)))) {
        if (diverse.length >= TARGET) break;
        if (inList.has(v.id)) continue;
        const k = v.authorId || v.author || '?';
        if ((perAuthor[k] || 0) >= 2) continue;
        perAuthor[k] = (perAuthor[k] || 0) + 1;
        diverse.push(v); inList.add(v.id);
      }
    }
    if (diverse.length) {
      $('recoRow').innerHTML = diverse.map(recoCard).join('');
      const nCh = Object.keys(perAuthor).length;
      $('recoNote').textContent = `${basis} baz alındı • ${diverse.length} yeni öneri • ${nCh} farklı kanal`;
    } else {
      $('recoNote').textContent = `${basis} baz alındı`;
    }
  } catch { $('recoNote').textContent = `${basis} baz alındı`; }
}
async function doSearch() {
  const q = $('q').value.trim(); if (!q) return;
  saveSearch(q); // aramayı da algoritmaya işle
  recoToken++; // bekleyen öneri işini iptal et (arama sonuçlarına Sana Özel bulaşmasın)
  hideShorts();
  $('recoBar').classList.add('hidden');
  $('homeView').classList.remove('hidden'); $('watchView').classList.add('hidden'); $('channelView').classList.add('hidden');
  const r = await Api.search(q);
  const list = rankVideos(r.results || []);
  lastRelated = list;
  $('exploreWrap').classList.remove('hidden');
  $('exploreTitle').textContent = `“${q}” sonuçları`;
  $('grid').innerHTML = list.map(card).join('') || '<p>Sonuç yok</p>';
}

async function watch(id) {
  recoToken++; // bekleyen öneri işini iptal et
  hideShorts();
  $('homeView').classList.add('hidden'); $('channelView').classList.add('hidden'); $('watchView').classList.remove('hidden');
  window.scrollTo(0,0);
  $('vTitle').textContent = 'Yükleniyor...'; $('related').innerHTML = ''; $('comments').innerHTML = 'Yorumlar yükleniyor...';
  $('player').classList.add('hidden'); $('embed').classList.add('hidden');
  try {
    const metaP = Api.video(id);
    const streamP = Api.stream(id).catch(() => null);
    const meta = await metaP; // bilgi hemen gelsin, stream beklenmesin
    if (meta.error) throw new Error(meta.error);
    $('vTitle').textContent = meta.title;
    $('vAuthor').textContent = '👤 ' + meta.author;
    currentAuthorId = meta.authorId;
    $('vMeta').textContent = `${fmtViews(meta.views)} • 👍 ${Number(meta.likes||0).toLocaleString('tr-TR')} • ${meta.published||''}`;
    $('vDesc').textContent = meta.description || '';
    $('dlMp4').href = '/api/download?id=' + id + '&format=mp4';
    $('dlMp3').href = '/api/download?id=' + id + '&format=mp3';
    saveWatch({ id, title: meta.title, author: meta.author, authorId: meta.authorId });
    // Oynat: kaynakları sırayla dene (mp4 → alternatif → HLS → embed).
    // Biri MIME/ölü URL olursa otomatik sonrakine geçer, "no supported format" bitiyor.
    playWithFallback(id, meta.thumbnail, await streamP);
    // İlgili videoları algoritmayla yeniden sırala
    const ranked = rankVideos(meta.related || []);
    $('related').innerHTML = ranked.map(v => `<div class="card flex gap-2 rounded-lg overflow-hidden cursor-pointer bg-[#1a1a1a]" onclick="watch('${v.id}')">
      <img src="${v.thumbnail}" onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${v.id}/hqdefault.jpg'" loading="lazy" class="w-40 aspect-video object-cover"/><div class="p-2 text-xs"><b class="line2">${v.title}</b><br/><span class="text-gray-400">${v.author||''}</span></div></div>`).join('') || '<p class="text-sm text-gray-400">İlgili video yok</p>';
    const c = await Api.comments(id);
    $('comments').innerHTML = (c.comments||[]).slice(0,30).map(x => `<div class="bg-[#1a1a1a] rounded-lg p-2"><b>${x.author}</b> <span class="text-gray-500">• ${x.published||''} • 👍 ${x.likes||0}</span><br/>${x.text}</div>`).join('') || '<p class="text-gray-400">Yorum yok</p>';
  } catch (e) { // son çare: direkt embed
    $('vTitle').textContent = 'Video açılıyor (yedek oynatıcı)...';
    const em = $('embed'); em.src = `https://www.youtube-nocookie.com/embed/${id}`; em.classList.remove('hidden');
  }
}

function showEmbed(id) {
  $('player').classList.add('hidden');
  const e = $('embed'); e.src = `https://www.youtube-nocookie.com/embed/${id}`; e.classList.remove('hidden');
}

function playWithFallback(id, poster, stream) {
  const p = $('player');
  p.classList.remove('hidden');
  p.poster = poster || '';
  if (p._hls) { try { p._hls.destroy(); } catch {} p._hls = null; }
  if (p._errHandler) { p.removeEventListener('error', p._errHandler); p._errHandler = null; }
  p.onplaying = null;

  const sources = [...(stream?.sources || [])];
  // eski backend alanlarıyla uyumluluk
  for (const k of ['combined720', 'combined', 'video720', 'video480']) {
    if (stream?.[k] && !sources.some(s => s.url === stream[k])) sources.push({ url: stream[k], type: 'video/mp4' });
  }
  let i = 0, hlsTried = false, done = false;
  const embed = () => { if (!done) { done = true; showEmbed(id); } };
  const tryHls = () => {
    if (hlsTried) return embed();
    hlsTried = true;
    if (window.Hls && Hls.isSupported()) {
      const hls = new Hls(); p._hls = hls;
      hls.loadSource(stream.hls); hls.attachMedia(p);
      hls.on(Hls.Events.ERROR, (ev, data) => { if (data?.fatal) embed(); });
    } else {
      p.src = stream.hls; // Safari native HLS
      try { p.load(); } catch {}
    }
  };
  const next = () => {
    if (done) return;
    if (i < sources.length) { p.src = sources[i++].url; try { p.load(); } catch {} }
    else if (stream?.hls) tryHls();
    else embed();
  };
  const onErr = () => {
    if (hlsTried && p.src && p.src.includes('m3u8')) return embed();
    next();
  };
  p._errHandler = onErr;
  p.addEventListener('error', onErr);
  p.onplaying = () => {
    done = true;
    if (p._errHandler) { p.removeEventListener('error', p._errHandler); p._errHandler = null; }
  };
  if (!sources.length && !stream?.hls) return embed();
  next();
}

async function openChannel(authorId) {
  if (!authorId) return alert('Kanal bilgisi yok');
  recoToken++; // bekleyen öneri işini iptal et
  hideShorts();
  $('watchView').classList.add('hidden'); $('homeView').classList.add('hidden'); $('channelView').classList.remove('hidden');
  $('chHead').innerHTML = 'Yükleniyor...'; $('chGrid').innerHTML = '';
  const c = await Api.channel(authorId);
  if (c.error) { $('chHead').textContent = c.error; return; }
  $('chHead').innerHTML = `<img src="${c.avatar||''}" class="w-20 h-20 rounded-full"/><div><h2 class="text-xl font-bold">${c.name}</h2><p class="text-sm text-gray-400">${Number(c.subs||0).toLocaleString('tr-TR')} abone</p><p class="text-sm text-gray-300 mt-1 max-w-2xl">${(c.description||'').slice(0,300)}</p></div>`;
  $('chGrid').innerHTML = (c.videos||[]).map(card).join('');
}

// ---------- Shorts (dikey akış) ----------
const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
let shortsObs = null;
function pauseAllShorts() {
  document.querySelectorAll('#shortsFeed video').forEach(v => v.pause());
  document.querySelectorAll('#shortsFeed iframe').forEach(f => { if (f.src) { f.dataset.fsrc = f.src; f.removeAttribute('src'); } });
}
function hideShorts() { const el = $('shortsView'); if (el) { el.classList.add('hidden'); pauseAllShorts(); } }

async function openShorts() {
  recoToken++;
  pauseAllShorts();
  $('homeView').classList.add('hidden'); $('watchView').classList.add('hidden'); $('channelView').classList.add('hidden');
  $('shortsView').classList.remove('hidden');
  $('shortsFeed').innerHTML = '<p class="text-gray-400 p-8 text-center">⚡ Shorts yükleniyor...</p>';
  const chs = [...new Set(getHist().filter(h => h.authorId).slice(0, 5).map(h => h.authorId))];
  const sq = [...new Set(getSearches().slice(0, 3).map(s => s.q + ' shorts'))];
  try {
    const r = await Api.shorts(chs, sq);
    // Birleştir: önce SENİN kanallarından kısa videolar, sonra havuz (izlediklerin üstte), sonra aramalar
    const seen = new Set();
    const final = [];
    const pushAll = arr => (arr || []).forEach(v => {
      if (v?.id && v.id.length === 11 && !seen.has(v.id)) { seen.add(v.id); final.push(v); }
    });
    pushAll(rankVideos(r.personal || []));
    pushAll(rankVideos(r.pool || []));
    pushAll(r.qres || []);
    const list = final.slice(0, 30);
    if (!list.length) { $('shortsFeed').innerHTML = '<p class="text-gray-400 p-8 text-center">Shorts bulunamadı.</p>'; return; }
    $('shortsFeed').innerHTML = list.map((v, i) => `
      <div class="slide" data-i="${i}">
        <div class="relative h-full aspect-[9/16] max-w-full bg-black rounded-xl overflow-hidden">
          <video data-id="${v.id}" class="w-full h-full object-contain bg-black" loop playsinline muted preload="none" poster="${v.thumbnail}" onclick="this.paused?this.play().catch(()=>{}):this.pause()"></video>
          <button onclick="event.stopPropagation();toggleShortMute(this)" class="absolute top-2 right-2 z-10 chip rounded-full px-3 py-1.5 text-sm">🔇</button>
          <div class="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 to-transparent pointer-events-none">
            <p class="font-semibold text-sm line2">${esc(v.title)}</p>
            <p class="text-xs text-gray-300">👤 ${esc(v.author)}</p>
          </div>
        </div>
      </div>`).join('');
    setupShortsObserver();
    $('shortsView').scrollTop = 0;
  } catch { $('shortsFeed').innerHTML = '<p class="text-gray-400 p-8 text-center">Shorts yüklenemedi.</p>'; }
}

function setupShortsObserver() {
  if (shortsObs) shortsObs.disconnect();
  shortsObs = new IntersectionObserver(es => {
    es.forEach(e => {
      const slide = e.target;
      if (e.isIntersecting) {
        const frame = slide.querySelector('iframe');
        if (frame) { if (!frame.src && frame.dataset.fsrc) frame.src = frame.dataset.fsrc; }
        else {
          const vid = slide.querySelector('video');
          if (vid) playShort(vid);
        }
        const nxt = document.querySelector(`#shortsFeed .slide[data-i="${+slide.dataset.i + 1}"] video`);
        if (nxt) prefetchShort(nxt);
      } else {
        const vid = slide.querySelector('video');
        if (vid) vid.pause();
        slide.querySelectorAll('iframe').forEach(f => { if (f.src) { f.dataset.fsrc = f.src; f.removeAttribute('src'); } });
      }
    });
  }, { root: $('shortsView'), threshold: 0.6 });
  document.querySelectorAll('#shortsFeed .slide').forEach(s => shortsObs.observe(s));
}

async function streamUrlFor(id) {
  const s = await Api.stream(id).catch(() => null);
  if (s?.sources?.[0]?.url) return { kind: 'one', url: s.sources[0].url };
  if (s?.vo) return { kind: 'dual', vo: s.vo, ao: s.ao || null };
  return null;
}

async function prefetchShort(vid) {
  if (!vid || vid.src || vid.dataset.pre) return;
  vid.dataset.pre = '...';
  const r = await streamUrlFor(vid.dataset.id);
  vid.dataset.pre = r ? JSON.stringify(r) : '';
}

async function playShort(vid) {
  if (!vid.src && !vid.dataset.mode) {
    let r = null;
    try { r = vid.dataset.pre && vid.dataset.pre !== '...' ? JSON.parse(vid.dataset.pre) : await streamUrlFor(vid.dataset.id); } catch { r = null; }
    if (r?.kind === 'one') {
      vid.src = r.url;
    } else if (r?.kind === 'dual') {
      // Birleşik link yok (Shorts genelde böyle): görüntü sessiz + ayrı ses hattı
      vid.muted = true;
      vid.src = r.vo;
      vid.dataset.mode = 'dual';
      if (r.ao) {
        const au = new Audio(r.ao);
        au.muted = true; // ilk dokunuş kullanıcıdan gelene kadar sessiz (tarayıcı kuralı)
        au.preload = 'auto';
        vid._au = au;
        vid.onplay = () => { try { au.currentTime = vid.currentTime; au.play().catch(() => {}); } catch {} };
        vid.onpause = () => { try { au.pause(); } catch {} };
      }
    } else {
      return embedShort(vid); // hiçbiri yok → gömülü oynatıcı
    }
  }
  if (!vid.isConnected) return; // arada embed'e çevrildiyse
  // Önce SESLİ dene: Shorts düğmesine dokunuşun verdiği izin birkaç saniye geçerli.
  // İzin verilirse sesli açılır, reddedilirse sessize düşer (ikon durumu gösterir).
  if (!vid.dataset.sndTried) {
    vid.dataset.sndTried = '1';
    if (vid._au) vid._au.muted = false; else vid.muted = false;
    try { await vid.play(); setMuteIcon(vid); return; } catch {}
  }
  if (vid._au) vid._au.muted = true; else vid.muted = true;
  setMuteIcon(vid);
  vid.play().catch(() => {});
}

function setMuteIcon(vid) {
  const btn = vid.closest('.slide')?.querySelector('button');
  if (!btn) return;
  btn.textContent = (vid._au ? vid._au.muted : vid.muted) ? '🔇' : '🔊';
}

// Son çare: slaytın içine gömülü oynatıcı koy
function embedShort(vid) {
  const slide = vid.closest('.slide');
  const box = slide.querySelector('.relative');
  const f = document.createElement('iframe');
  f.src = `https://www.youtube-nocookie.com/embed/${vid.dataset.id}?autoplay=1&rel=0`;
  f.className = 'w-full h-full';
  f.allow = 'autoplay; encrypted-media; picture-in-picture';
  f.allowFullscreen = true;
  box.querySelectorAll('video,button').forEach(el => el.remove());
  box.prepend(f);
}

function toggleShortMute(btn) {
  const vid = btn.closest('.slide').querySelector('video');
  if (vid._au) { // çift hat: ses ayrı elementte
    vid._au.muted = !vid._au.muted;
    btn.textContent = vid._au.muted ? '🔇' : '🔊';
  } else if (vid) {
    vid.muted = !vid.muted;
    btn.textContent = vid.muted ? '🔇' : '🔊';
  }
}

function shortsNav(d) {
  const el = $('shortsView');
  const slide = el.querySelector('.slide');
  el.scrollBy({ top: d * (slide ? slide.offsetHeight : window.innerHeight * 0.8), behavior: 'smooth' });
}

document.addEventListener('keydown', e => {
  if ($('shortsView').classList.contains('hidden')) return;
  if (e.key === 'ArrowDown') shortsNav(1);
  if (e.key === 'ArrowUp') shortsNav(-1);
});

// geçmiş paneli
function toggleHistory() {
  const p = $('histPanel'); p.classList.toggle('hidden');
  $('histList').innerHTML = getHist().map(h => `<div class="cursor-pointer hover:underline" onclick="watch('${h.id}')">▶ ${h.title.slice(0,60)}<br/><span class="text-gray-500 text-xs">${h.author}</span></div>`).join('') || '<p class="text-gray-500">Henüz bir şey izlemedin.</p>';
}
function clearHistory() { localStorage.removeItem('yt_hist'); toggleHistory(); toggleHistory(); loadTrending(); }

// Statik modda (GitHub Pages) backend yok: indirme gizlenir (Shorts statikte de var)
if (typeof STATIC !== 'undefined' && STATIC) {
  for (const b of ['dlMp4', 'dlMp3']) { const el = $(b); if (el) el.style.display = 'none'; }
}

loadTrending();
