// API'siz istemci + öneri algoritması — YouTube tarzı arayüz
let currentAuthorId = null;
let lastRelated = [];

const $ = id => document.getElementById(id);
const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// YouTube tarzı kısa sayı: 1,2 Mn / 12 bin
function shortNum(v) {
  v = Number(v) || 0;
  let s;
  if (v >= 1e9) s = (v / 1e9).toFixed(1).replace('.', ',') + ' Mr';
  else if (v >= 1e6) s = (v / 1e6).toFixed(1).replace('.', ',') + ' Mn';
  else if (v >= 1e3) s = Math.round(v / 1e3) + ' bin';
  else return String(v);
  return s.replace(',0 ', ' ');
}
const fmtViews = v => v == null ? '' : shortNum(v) + ' görüntüleme';
const fmtDur = s => { if (s === -1) return 'CANLI'; if (s == null) return ''; s = Number(s); if (isNaN(s)) return s; const h = Math.floor(s/3600), m = Math.floor(s%3600/60), ss = s%60; return h ? `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}` : `${m}:${String(ss).padStart(2,'0')}`; };
const chColor = s => { let h = 0; for (const c of (s || '')) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h},45%,40%)`; };
const fmtDate = p => { if (/^\d{8}$/.test(p || '')) { const y = p.slice(0,4), m = p.slice(4,6), d = p.slice(6,8); return `${d}.${m}.${y}`; } return p || ''; };
const initials = s => (s || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const avatarHtml = (name, cls = 'avatar') => `<div class="${cls}" style="background:${chColor(name)}">${esc(initials(name))}</div>`;
function avFallback(img) {
  const name = img.dataset.name || '';
  const d = document.createElement('div');
  d.style.background = chColor(name);
  d.style.width = '100%'; d.style.height = '100%';
  d.style.display = 'flex'; d.style.alignItems = 'center'; d.style.justifyContent = 'center';
  d.style.borderRadius = '50%';
  d.style.color = '#fff'; d.style.fontSize = '13px';
  d.textContent = initials(name);
  img.replaceWith(d);
}
// Gerçek kanal fotoğrafı varsa onu kullan, yoksa baş harf avatarı
const avatarAttr = (name, url, cls = 'avatar') => url
  ? `<img src="${esc(url)}" loading="lazy" class="${cls}" data-name="${esc(name||'')}" onerror="avFallback(this)"/>`
  : avatarHtml(name, cls);

// ---------- Sidebar / genel navigasyon ----------
function toggleSidebar() {
  if (window.innerWidth < 1024) document.body.classList.toggle('mobile-open');
  else document.body.classList.toggle('sb-collapsed');
}
function hideSidebar() { document.body.classList.remove('mobile-open'); document.body.classList.add('sb-collapsed'); }
function showSidebar() { document.body.classList.remove('sb-collapsed', 'mobile-open'); }

function toast(msg) {
  const t = $('subToast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.add('hidden'), 2000);
}
function subToast() { toast('no-tube: Abonelikler bu sürümde simülasyon 😄'); }
function shareToast() {
  const url = $('embed')?.src || location.href;
  try { navigator.clipboard.writeText(url); toast('Bağlantı kopyalandı'); } catch { toast('Paylaşım bağlantısı: ' + url); }
}
function likePill() { toast('Begenme burada simülasyon modunda 🙃'); }
function doSearchPrompt(q) { $('q').value = q; doSearch(); }

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

// ---------- Kartlar (YouTube stili) ----------
function card(v) {
  const views = v.views == null ? '' : shortNum(v.views) + ' görüntüleme';
  const dot = views && (v.published || v.date) ? ' • ' : '';
  const pub = v.published || v.date || '';
  return `<div class="card cursor-pointer group" onclick="watch('${v.id}')">
    <div class="relative">
      <img src="${v.thumbnail}" onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${v.id}/hqdefault.jpg'" loading="lazy" class="cardimg w-full aspect-video object-cover"/>
      ${v.duration != null ? `<span class="absolute bottom-1.5 right-1.5 text-xs font-medium bg-black/80 rounded px-1 py-0.5 ${v.duration === -1 ? 'text-red-400' : ''}">${fmtDur(v.duration)}</span>` : ''}
    </div>
    <div class="cardtext flex gap-3">
      ${v.author ? avatarAttr(v.author, v.avatar) : ''}
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium line2 leading-5 group-hover:text-white">${esc(v.title) || 'Başlıksız'}</p>
        ${v.author ? `<p class="text-xs text-[#aaaaaa] mt-1 line1">${esc(v.author)}</p>` : ''}
        <p class="text-xs text-[#aaaaaa]">${views}${dot}${esc(pub)}</p>
      </div>
    </div>
  </div>`;
}

// Izleme sayfası "Sıradaki" listesi — YouTube sıkı yatay kart
const relCard = (v) => `<div class="card flex gap-2 cursor-pointer p-1 rounded-xl" onclick="watch('${v.id}')">
  <div class="relative w-[168px] shrink-0">
    <img src="${v.thumbnail}" onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${v.id}/hqdefault.jpg'" loading="lazy" class="cardimg w-[168px] aspect-video object-cover"/>
    ${v.duration != null ? `<span class="absolute bottom-1 right-1 text-xs font-medium bg-black/80 rounded px-1 py-0.5">${fmtDur(v.duration)}</span>` : ''}
  </div>
  <div class="min-w-0 flex-1 pr-1">
    <p class="text-sm font-medium line2 leading-5">${esc(v.title)}</p>
    <p class="text-xs text-[#aaaaaa] mt-1 line1">${esc(v.author) || ''}</p>
    <p class="text-xs text-[#aaaaaa]">${v.views == null ? '' : shortNum(v.views) + ' görüntüleme'}${v.published ? ' • ' + esc(v.published) : ''}</p>
  </div>
</div>`;

function showSkels(n = 12) {
  const s = $('loadSkels');
  s.classList.remove('hidden');
  s.innerHTML = Array.from({ length: n }, () => `
    <div>
      <div class="skel cardimg w-full aspect-video rounded-xl"></div>
      <div class="cardtext flex gap-3">
        <div class="skel w-9 h-9 rounded-full shrink-0"></div>
        <div class="flex-1 space-y-2"><div class="skel h-4 rounded w-11/12"></div><div class="skel h-3 rounded w-2/3"></div></div>
      </div>
    </div>`).join('');
}
function hideSkels() { $('loadSkels').classList.add('hidden'); }

// ---------- Views ----------
async function goHome() {
  syncUrl('');
  hideShorts();
  $('watchView').classList.add('hidden'); $('channelView').classList.add('hidden'); $('homeView').classList.remove('hidden');
  showSidebar();
  loadTrending();
}
async function loadTrending(force) {
  hideShorts();
  $('watchView').classList.add('hidden'); $('channelView').classList.add('hidden'); $('homeView').classList.remove('hidden');
  showSkels();
  $('exploreWrap').classList.add('hidden'); $('recoBar').classList.add('hidden');
  try {
    const r = await Api.trending();
    const list = r.results || [];
    lastRelated = list;
    hideSkels();
    // Geçmiş (izleme veya arama) varsa ana sayfa = sadece öneriler. Yoksa (veya Trendler'e basıldıysa) Keşfet göster.
    if ((getHist().length || getSearches().length) && !force) { $('exploreWrap').classList.add('hidden'); }
    else {
      $('exploreWrap').classList.remove('hidden');
      $('exploreTitle').textContent = 'Trendler — Türkiye';
      $('grid').innerHTML = list.map(card).join('');
    }
    renderReco(list);
  } catch { hideSkels(); $('exploreTitle').textContent = 'Trendler'; $('exploreWrap').classList.remove('hidden'); $('grid').innerHTML = '<p class="text-[#aaaaaa]">Yüklenemedi, sayfayı yenile.</p>'; }
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
    || '<p class="text-sm text-[#aaaaaa]">Öneriler hazırlanıyor...</p>';
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
  syncUrl('q=' + encodeURIComponent(q));
  saveSearch(q); // aramayı da algoritmaya işle
  recoToken++; // bekleyen öneri işini iptal et (arama sonuçlarına Sana Özel bulaşmasın)
  hideShorts(); showSidebar();
  $('recoBar').classList.add('hidden');
  $('homeView').classList.remove('hidden'); $('watchView').classList.add('hidden'); $('channelView').classList.add('hidden');
  showSkels(8);
  $('exploreWrap').classList.remove('hidden');
  $('exploreTitle').textContent = `“${q}” için sonuçlar`;
  $('grid').innerHTML = '';
  try {
    const r = await Api.search(q);
    const list = rankVideos(r.results || []);
    lastRelated = list;
    hideSkels();
    $('grid').innerHTML = list.map(card).join('') || '<p class="text-[#aaaaaa]">Sonuç yok</p>';
  } catch { hideSkels(); $('grid').innerHTML = '<p class="text-[#aaaaaa]">Arama başarısız oldu.</p>'; }
}

async function watch(id) {
  recoToken++; // bekleyen öneri işini iptal et
  hideShorts(); hideSidebar();
  $('homeView').classList.add('hidden'); $('channelView').classList.add('hidden'); $('watchView').classList.remove('hidden');
  syncUrl('v=' + id);
  window.scrollTo(0,0);
  $('vTitle').textContent = 'Yükleniyor...'; $('related').innerHTML = ''; $('comments').innerHTML = '';
  $('player').classList.add('hidden'); $('embed').classList.add('hidden');
  try {
    const metaP = Api.video(id);
    const streamP = Api.stream(id).catch(() => null);
    const meta = await metaP; // bilgi hemen gelsin, stream beklenmesin
    if (meta.error) throw new Error(meta.error);
    $('vTitle').textContent = meta.title;
    $('vAuthor').textContent = meta.author;
    $('vAvatar').innerHTML = avatarAttr(meta.author, meta.avatar);
    $('vAvatar').style.background = meta.avatar ? 'transparent' : chColor(meta.author);
    currentAuthorId = meta.authorId;
    $('vMeta').textContent = '';
    const likes = Number(meta.likes || 0);
    $('likeCount').textContent = likes ? shortNum(likes) : '';
    $('vMetaTop').textContent = `${fmtViews(meta.views)}${meta.published ? ' • ' + fmtDate(meta.published) : ''}`;
    $('vDesc').textContent = meta.description || '';
    $('descBox').open = false;
    $('dlMp4').href = '/api/download?id=' + id + '&format=mp4';
    $('dlMp3').href = '/api/download?id=' + id + '&format=mp3';
    saveWatch({ id, title: meta.title, author: meta.author, authorId: meta.authorId });
    // İlgili videolar hemen (boş görünmesin diye) yüklensin:
    const relatedInit = meta.related || [];
    $('related').innerHTML = rankVideos(relatedInit).map(relCard).join('') || '<p class="text-sm text-[#aaaaaa]">İlgili video yok</p>';
    // Sponsor bölümlerini çek + atlama kancası (oynatmayı beklemez, arkada gelir)
    sbSegs = [];
    updateSbBtn();
    fetch('https://sponsor.ajay.app/api/skipSegments?videoID=' + id + '&category=sponsor&category=intro&category=outro&category=selfpromo&category=interaction_reminder')
      .then(r => r.ok ? r.json() : [])
      .then(segs => {
        sbSegs = (Array.isArray(segs) ? segs : []).filter(s => s.actionType === 'skip' && s.segment).sort((a, b) => a.segment[0] - b.segment[0]);
        updateSbBtn();
      })
      .catch(() => {});
    const p = $('player');
    p.ontimeupdate = () => {
      if (!sbOn || !sbSegs.length) return;
      const t = p.currentTime;
      const hit = sbSegs.find(s => t >= s.segment[0] && t < s.segment[1] - 0.2);
      if (hit) {
        try { p.currentTime = hit.segment[1]; } catch {}
        toastSb(`⏭ ${sbLabel(hit.category)} atlandı (${Math.round(hit.segment[1] - hit.segment[0])}sn)`);
      }
    };
    // Oynat: kaynakları sırayla dene (mp4 → alternatif → HLS → embed).
    // Biri MIME/ölü URL olursa otomatik sonrakine geçer, "no supported format" bitiyor.
    playWithFallback(id, meta.thumbnail, await streamP);
    // İlgili videoları tam veriyle güncelle (varsa)
    const ranked = rankVideos(meta.related || relatedInit);
    $('related').innerHTML = ranked.map(relCard).join('') || '<p class="text-sm text-[#aaaaaa]">İlgili video yok</p>';
    $('comments').innerHTML = Array.from({ length: 4 }, skelComment).join('');
    const c = await Api.comments(id);
    $('comments').innerHTML = (c.comments||[]).slice(0,50).map(commentItem).join('') || '<p class="text-[#aaaaaa]">Yorum yok</p>';
  } catch (e) { // son çare: direkt embed
    $('vTitle').textContent = 'Video açılıyor (yedek oynatıcı)...';
    const em = $('embed'); em.src = `https://www.youtube-nocookie.com/embed/${id}`; em.classList.remove('hidden');
  }
}

const skelComment = () => `<div class="flex gap-3"><div class="skel w-10 h-10 rounded-full shrink-0"></div><div class="flex-1 space-y-2"><div class="skel h-3 rounded w-36"></div><div class="skel h-3 rounded w-full"></div><div class="skel h-3 rounded w-4/5"></div></div></div>`;

function commentItem(x) {
  const av = x.thumbnail
    ? `<img src="${x.thumbnail}" onerror="this.onerror=null;this.replaceWith(document.createRange().createContextualFragment(avatarHtml('${esc(x.author)}','avatar')))" loading="lazy" class="avatar w-10 h-10"/>`
    : avatarHtml(x.author, 'avatar w-10 h-10 text-sm flex items-center justify-center');
  return `<div class="flex gap-3">
    ${av}
    <div class="min-w-0">
      <p class="text-[13px]"><b class="font-medium">${esc(x.author)}</b> <span class="text-[#aaaaaa] ml-1">${esc(x.published||'')}</span></p>
      <p class="mt-1 whitespace-pre-wrap leading-5">${esc(x.text)}</p>
      <p class="text-xs text-[#aaaaaa] mt-1.5 flex items-center gap-1.5"><svg viewBox="0 0 24 24" class="w-4 h-4" fill="currentColor"><path d="M18.77 11h-4.23l1.52-4.94C16.38 5.03 15.54 4 14.38 4c-.58 0-1.14.24-1.52.65L7 11H3v10h4h13.66c1.13 0 2.07-.84 2.22-1.96l1-8A2.25 2.25 0 0021.66 11h-2.89z"/></svg> ${x.likes||0} · Yanıtla</p>
    </div>
  </div>`;
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
  if (!authorId) return;
  recoToken++; // bekleyen öneri işini iptal et
  hideShorts(); hideSidebar();
  $('watchView').classList.add('hidden'); $('homeView').classList.add('hidden'); $('channelView').classList.remove('hidden');
  showSkels(8);
  $('chHead').innerHTML = ''; $('chGrid').innerHTML = '';
  try {
    const c = await Api.channel(authorId);
    hideSkels();
    if (c.error) { $('chHead').textContent = c.error; return; }
    $('chHead').innerHTML = `
      <div class="sm:w-32 sm:h-32 mt-14 sm:mt-0">${c.avatar ? `<img src="${c.avatar}" onerror="this.style.display='none'" class="w-20 h-20 sm:w-32 sm:h-32 rounded-full object-cover"/>` : avatarHtml(c.name, 'w-20 h-20 sm:w-32 sm:h-32 rounded-full flex items-center justify-center text-2xl')}</div>
      <div class="pt-2 sm:pt-16">
        <h2 class="text-xl sm:text-2xl font-bold">${esc(c.name)}</h2>
        <p class="text-sm text-[#aaaaaa] mt-1">${shortNum(c.subs||0)} abone</p>
        <p class="text-sm text-[#aaaaaa] mt-1 max-w-2xl line1 sm:line2">${esc((c.description||'').slice(0,300))}</p>
      </div>`;
    $('chGrid').innerHTML = (c.videos||[]).map(card).join('');
  } catch { hideSkels(); $('chHead').textContent = 'Kanal yüklenemedi'; }
}

// ---------- Shorts (dikey akış) ----------
let shortsObs = null;
function pauseAllShorts() {
  document.querySelectorAll('#shortsFeed video').forEach(v => v.pause());
  document.querySelectorAll('#shortsFeed iframe').forEach(f => { if (f.src) { f.dataset.fsrc = f.src; f.removeAttribute('src'); } });
}
function hideShorts() { const el = $('shortsView'); if (el && !el.classList.contains('hidden')) { el.classList.add('hidden'); pauseAllShorts(); } }

async function openShorts() {
  recoToken++;
  syncUrl('');
  hideSidebar();
  pauseAllShorts();
  $('shortsView').classList.remove('hidden');
  $('homeView').classList.add('hidden'); $('watchView').classList.add('hidden'); $('channelView').classList.add('hidden');
  $('shortsView').scrollTop = 0;
  $('shortsFeed').innerHTML = '<p class="text-[#aaaaaa] p-8 text-center w-full">Shorts yükleniyor...</p>';
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
    if (!list.length) { $('shortsFeed').innerHTML = '<p class="text-[#aaaaaa] p-8 text-center w-full">Shorts bulunamadı.</p>'; return; }
    $('shortsFeed').innerHTML = list.map((v, i) => `
      <div class="slide" data-i="${i}">
        <div class="relative h-full aspect-[9/16] max-w-full bg-black rounded-none sm:rounded-2xl overflow-hidden">
          <video data-id="${v.id}" class="w-full h-full object-contain bg-black" loop playsinline muted preload="none" poster="${v.thumbnail}" onclick="this.paused?this.play().catch(()=>{}):this.pause()"></video>
          <button onclick="event.stopPropagation();toggleShortMute(this)" class="absolute top-3 right-3 z-10 iconbtn bg-black/50 hover:bg-black/70">🔇</button>
          <div class="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
            <div class="flex items-center gap-3">
              ${avatarAttr(v.author, v.avatar, 'w-9 h-9 rounded-full flex items-center justify-center text-xs object-cover')}
              <span class="text-sm font-medium line1">${esc(v.author)}</span>
            </div>
            <p class="text-sm line2 mt-2">${esc(v.title)}</p>
          </div>
        </div>
      </div>`).join('');
    setupShortsObserver();
    $('shortsView').scrollTop = 0;
  } catch { $('shortsFeed').innerHTML = '<p class="text-[#aaaaaa] p-8 text-center w-full">Shorts yüklenemedi.</p>'; }
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
  btn.innerHTML = (vid._au ? vid._au.muted : vid.muted)
    ? '<svg viewBox="0 0 24 24" class="w-5 h-5" fill="#fff"><path d="M3.63 3.63L2.22 5.04 7.29 10H4a1 1 0 00-1 1v2a1 1 0 001 1h3l4.29 3.29c.63.63 1.71.18 1.71-.71v-3.46l4.04 4.04c-.14.1-.28.2-.42.29l.72 1.2a8.98 8.98 0 00.8-.55L21.79 22 22 21.79 4.21 4 3.63 3.63zM14 4.83v6.05l1 1V3.29c0-.89-1.08-1.34-1.71-.71L9.17 6.46l1.41 1.42L14 4.83zm3.44 6.55l1.9 1.9c.2-.4.2-.9.06-1.34l-1.96.56.84-1.12h-.84zM10.8 12.99v4.18l-2.1-2.1 2.1-2.08zM15 3.29"/></svg>'
    : '<svg viewBox="0 0 24 24" class="w-5 h-5" fill="#fff"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 7.97v8.05c1.48-.73 2.5-2.26 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
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
    setMuteIcon(vid);
  } else if (vid) {
    vid.muted = !vid.muted;
    setMuteIcon(vid);
  }
}

// ---------- Reklam/sponsor engelleme ----------
// Direkt oynatmada YouTube reklamı (pre-roll/mid-roll) zaten HİÇ gelmiyor.
// Burası video İÇİ sponsor/giriş/bitiş bölümlerini SponsorBlock verisiyle atlar.
let sbSegs = [];
let sbOn = (localStorage.getItem('yt_sb') || 'on') === 'on';
const sbLabel = (c) => ({ sponsor: 'Sponsor', intro: 'Giriş', outro: 'Bitiş', selfpromo: 'Tanıtım', interaction_reminder: 'Hatırlatma' }[c] || 'Bölüm');
function updateSbBtn() {
  const b = $('sbToggle');
  if (b) b.title = sbOn ? (sbSegs.length ? `${sbSegs.length} sponsor bölümü otomatik atlanacak` : 'Sponsor bölümleri veride yok') : 'Sponsor atlama kapalı';
}
function toggleSb() {
  sbOn = !sbOn;
  localStorage.setItem('yt_sb', sbOn ? 'on' : 'off');
  updateSbBtn();
  toast(sbOn ? 'Sponsor atlama açık' : 'Sponsor atlama kapalı');
}
let sbToastT = null;
function toastSb(msg) {
  const t = $('sbToast');
  if (!t) return;
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(sbToastT);
  sbToastT = setTimeout(() => t.classList.add('hidden'), 2200);
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
  $('histList').innerHTML = getHist().map(h => `
    <div class="flex gap-2 cursor-pointer hover:bg-[#313131] rounded-lg p-1" onclick="watch('${h.id}')">
      <img src="https://i.ytimg.com/vi/${h.id}/mqdefault.jpg" class="w-24 aspect-video rounded object-cover shrink-0" loading="lazy"/>
      <div class="min-w-0"><p class="line2 font-medium leading-4">${esc(h.title.slice(0,80))}</p><p class="text-xs text-[#aaaaaa] mt-1 line1">${esc(h.author)}</p></div>
    </div>`).join('') || '<p class="text-[#aaaaaa]">Henüz bir şey izlemedin.</p>';
}
function clearHistory() { localStorage.removeItem('yt_hist'); localStorage.removeItem('yt_search'); toggleHistory(); toggleHistory(); loadTrending(true); }

// Ana ekranda sidebar açık başlasın
document.body.classList.remove('sb-collapsed');

// Statik modda (GitHub Pages) backend yok: indirme gizlenir (Shorts statikte de var)
if (typeof STATIC !== 'undefined' && STATIC) {
  for (const b of ['dlMp4', 'dlMp3']) { const el = $(b); if (el) el.style.display = 'none'; }
}

// URL → görünüm senkronu (?v=ID derin bağlantı, aramada ?q=)
function syncUrl(params) {
  try { history.replaceState(null, '', params ? '?' + params : location.pathname); } catch {}
}

// Başlangıç: derin bağlantı varsa aç
const bootV = new URLSearchParams(location.search);
const bootId = bootV.get('v');
const bootQ = bootV.get('q');
if (bootId && bootId.length === 11) watch(bootId);
else if (bootQ) { $('q').value = bootQ; doSearch(); }
else if (bootV.get('view') === 'shorts') openShorts();
else goHome();
