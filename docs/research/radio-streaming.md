# Research: Radio kraju w przeglądarce

**Ticket:** [Skąd brać i jak odtwarzać radio kraju](https://github.com/MichalzMinda/WarsztatySzpont2026/issues/6)  
**Data:** 2026-07-09

## Rekomendacja

**Źródło stacji:** [Radio Browser API](https://api.radio-browser.info/) — darmowe, open source, bez klucza API.

**Odtwarzanie:** natywny element HTML `<audio controls>` z `src` ustawionym na `url_resolved` wybranej stacji. Działa **client-side** — bez backendu/proxy.

### Przepływ

1. `country_code` z WTIA (np. `PL`) — gdy `??`, pominąć radio.
2. `GET https://de1.api.radio-browser.info/json/stations/bycountrycodeexact/{code}?limit=10&order=clickcount&reverse=true`
   - Nagłówek `User-Agent: ISS-Country-Tracker/1.0` (wymagany przez API).
3. Z listy wybrać pierwszą stację z `codec` ∈ `MP3`, `AAC`, `AAC+` (unikać HLS/M3U8 na MVP — wymaga `hls.js`).
4. `<audio src="{url_resolved}" controls>` — przy `error` spróbować kolejną stację z listy (max 3 próby).

### Gdy brak stacji lub żaden stream nie działa

UI: **„Brak dostępnej stacji radiowej”** — nie traktować jako błąd aplikacji.

## Porównanie źródeł

| Źródło | Klucz API | CORS (fetch) | Stacje per kraj | Client-side audio | Uwagi |
|--------|-----------|--------------|-----------------|-------------------|-------|
| **Radio Browser** | Nie | `*` (zweryfikowano) | Tak (tysiące) | Tak (`<audio>`) | **Wybór** |
| Własna lista JSON w repo | Nie | Lokalnie | Ręcznie | Tak | Utrzymanie; gorsze pokrycie |
| TuneIn / Spotify API | Tak | Ograniczone | Tak | Nie (licencje) | Odrzucone |
| Icecast directory scrape | Nie | Różnie | Częściowe | Niestabilne | Brak API; odrzucone |

## Szczegóły Radio Browser

- **Dokumentacja:** https://api.radio-browser.info/
- **Endpoint:** `GET /json/stations/bycountrycodeexact/{countrycode}`
- **Parametry przydatne na MVP:**
  - `limit=10` — kilka zapasowych stacji
  - `order=clickcount&reverse=true` — najpopularniejsze pierwsze (większa szansa że stream żyje)
- **Pola odpowiedzi:**
  - `name` — nazwa stacji (UI)
  - `url_resolved` — faktyczny URL streamu (preferować nad `url`)
  - `codec` — `MP3`, `AAC`, `AAC+` itd.
  - `stationuuid` — identyfikator (nie używać starego pola `id`)
- **CORS:** `Access-Control-Allow-Origin: *` (zweryfikowano `curl -H "Origin: http://localhost:8080"`)
- **User-Agent:** obowiązkowy opisowy string w każdym `fetch`
- **Serwery:** lista mirrorów przez DNS `all.api.radio-browser.info`; na MVP wystarczy stały mirror `de1.api.radio-browser.info`
- **Licencja API:** open source (GPL); streamy należą do nadawców — warsztatowe MVP OK

## Odtwarzanie w przeglądarce

### CORS a `<audio>`

- **Fetch** listy stacji wymaga CORS — Radio Browser go udostępnia.
- **Odtwarzanie** streamu przez `<audio src="…">` **nie wymaga** CORS na samym streamie — przeglądarka pobiera media inną ścieżką niż `fetch()`.
- Wyjątek: analiza audio (Web Audio API) wymagałaby CORS — nie potrzebujemy tego na MVP.

### Formaty

| Codec | MVP | Uwagi |
|-------|-----|-------|
| MP3 | ✅ | Natywnie w `<audio>` |
| AAC / AAC+ | ✅ | Zwykle działa w nowoczesnych przeglądarkach |
| HLS (M3U8) | ❌ na MVP | Safari OK; Chrome/Firefox wymagają `hls.js` — zbędna złożoność |

### Mixed content (HTTP vs HTTPS)

Część streamów to `http://…` (np. polskieradio.pl). Przy lokalnym dev (`http://localhost:8080`) — **działa**. Przy produkcji na HTTPS — przeglądarka zablokuje HTTP streamy; to problem hostingu (ticket poza aktualną fazą mapy), nie lokalnego MVP.

## Zachowanie UI

| Sytuacja | UI |
|----------|-----|
| `country_code === "??"` | Brak sekcji radia (jak „Nad oceanem”) |
| Brak stacji w API | „Brak dostępnej stacji radiowej” |
| Stream nie startuje | Próba kolejnej stacji; potem komunikat jak wyżej |
| Stream działa | `<audio controls>` + nazwa stacji |

## Implikacje dla `app/main.js`

- Nowa sekcja `#radio` w `index.html`.
- Po pobraniu `country_code` → `fetchStations(code)` → `playStation(stations)`.
- `audio.addEventListener('error', …)` → fallback na następną stację.
- Zatrzymać poprzedni stream przy zmianie kraju (`audio.pause(); audio.src = ''`).

## Źródła

1. https://api.radio-browser.info/ — dokumentacja Radio Browser API  
2. https://github.com/segler-alex/radiobrowser-api-rust — repozytorium API  
3. MDN: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/audio — element `<audio>`  
4. Testy HTTP 2026-07-09 (`curl` z `Origin: http://localhost:8080`, `User-Agent: ISS-Tracker/1.0`)
