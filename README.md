# YT Alternatif — YouTube Data API'siz YouTube

YouTube Data API anahtarı **gerektirmez**. Veri kaynakları:
1. **Piped API** (public instance havuzu, otomatik fallback) — arama, trendler, video, yorum, kanal, stream
2. **yt-dlp** (yerel yedek) — Piped ölürse aramalar ve stream'ler çalışmaya devam eder

## Çalıştır

```bash
cd ~/Projects/yt-alternatif
npm install
npm start
# → http://localhost:3000
```

Gereksinim: `yt-dlp` kurulu olmalı (`yt-dlp --version` ile kontrol et).

## Özellikler

- 🔍 Arama (sıralama algoritmalı)
- 🔥 Trendler (Türkiye)
- ▶ Reklamsız izleme (direkt MP4 → HLS → gizlilik-dostu embed sırasıyla dener)
- 👤 Kanal sayfaları
- 💬 Yorumlar
- ⏭ İlgili videolar
- ⬇ MP4 / 🎵 MP3 indirme (`/api/download?id=...&format=mp4|mp3`)
- ✨ **Sana Özel algoritması**: izleme geçmişini (localStorage) kullanır —
  başlık kelime örtüşmesi (+3/kelime), aynı kanal (+10~12), izleme tazeliği,
  popülerlik boost ve hafif rastgelelik ile `Sıradakiler`i ve ana sayfadaki
  önerileri sana göre sıralar. Geçmiş panelinden temizlenebilir.
- 🕘 İzleme geçmişi (tarayıcıda saklanır, sunucuya gitmez)

## API

- `GET /api/health` `GET /api/search?q=` `GET /api/trending`
- `GET /api/video/:id` `GET /api/stream/:id` `GET /api/comments/:id`
- `GET /api/channel/:id` `GET /api/download?id=&format=mp4|mp3`
