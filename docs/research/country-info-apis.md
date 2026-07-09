# Research: Informacje o kraju po kodzie ISO

**Ticket:** [Skąd brać informacje o kraju](https://github.com/MichalzMinda/WarsztatySzpont2026/issues/5)  
**Data:** 2026-07-09

## Rekomendacja

**Potrzebny podział na co najmniej dwa źródła** — żadne pojedyncze darmowe API nie dostarcza wszystkich pól (nazwa, flaga, stolica, populacja, temperatura) z CORS z przeglądarki.

### Wybór (MVP): CountriesNow + flagcdn + Open-Meteo — bez kluczy API

1. **CountriesNow** — metadane kraju po kodzie ISO z WTIA (`PL`, `US`, …):
   - `GET /api/v0.1/countries/capital/q?iso2={code}` → `name`, `capital`
   - `GET /api/v0.1/countries/population/q?country={name}` → ostatni rok w `populationCounts`
2. **flagcdn.com** — flaga: `https://flagcdn.com/w320/{code}.png` (małe litery ISO-2)
3. **Open-Meteo** — temperatura w stolicy:
   - geokodowanie: `geocoding-api.open-meteo.com/v1/search?name={capital}&count=1&countryCode={code}`
   - pogoda: `api.open-meteo.com/v1/forecast?…&current=temperature_2m`

Temperatura = pogoda w **stolicy**, nie średnia kraju. Gdy WTIA zwraca `country_code === "??"` — bez zapytań; UI „Nad oceanem”.

**Dlaczego ten stos:** zgodny z preferencją mapy (minimalna ceremonia, brak rejestracji). Wada: populacja CountriesNow bywa przestarzała (np. PL → 2018).

### Alternatywa: REST Countries v5 + Open-Meteo

Jeden endpoint metadanych (`/countries/v5/codes.alpha_2/{code}`) + współrzędne stolicy → Open-Meteo. Świeższe dane, mniej requestów, ale wymaga darmowej rejestracji, klucza `Bearer`, whitelisty `localhost` w CORS klucza i limitu **500 żądań/miesiąc** (warto cache w `sessionStorage`).

**Uwaga o REST Countries v3.1:** endpointy `/v3.1/alpha/{code}` są **wyłączone**. Trzeba używać v5.

**Zapasowa pogoda:** wttr.in (po nazwie stolicy, bez klucza) — szybki hack, ale nieoficjalny serwis bez gwarancji SLA.

## Porównanie API

| API | Klucz | CORS (browser) | Nazwa | Flaga | Stolica | Populacja | Temperatura | Uwagi |
|-----|-------|----------------|-------|-------|---------|-----------|-------------|-------|
| **CountriesNow + flagcdn** | Nie | `*` | ✅ | ✅ URL | ✅ | ⚠️ stare | ❌ | **Wybór MVP** — zero rejestracji |
| **REST Countries v5** | Tak (Bearer) | Po whitelist hostname | ✅ | ✅ emoji/URL | ✅ + coords | ✅ | ❌ | Alternatywa; 500 req/mies.; v3 martwy |
| **Open-Meteo** | Nie | `*` | ❌ | ❌ | ❌ | ❌ | ✅ (lat/lon) | 10k/dzień; non-commercial |
| **OpenWeatherMap** | Tak (`appid`) | `*` | ❌ | ❌ | ❌ | ❌ | ✅ (lat/lon) | 1M/mies. free; klucz w URL = widoczny w przeglądarce |
| **wttr.in** | Nie | `*` | ⚠️ częściowo | ❌ | ❌ | ❌ | ✅ (miasto) | Nieoficjalny; brak SLA |
| **flagcdn.com** | Nie | `*` (obraz) | ❌ | ✅ URL | ❌ | ❌ | ❌ | Flaga w stosie MVP |
| REST Countries v3.1 | — | — | ❌ | ❌ | ❌ | ❌ | ❌ | **Deprecated** — zwraca błąd |

## Czy jedno API wystarczy?

| Pole | Jedno API? | Źródło |
|------|------------|--------|
| Nazwa kraju | ✅ (część metadanych) | CountriesNow lub REST Countries v5 |
| Flaga | ✅ (część metadanych) | flagcdn lub REST Countries v5 |
| Stolica | ✅ (część metadanych) | CountriesNow lub REST Countries v5 |
| Populacja | ✅ (część metadanych) | CountriesNow lub REST Countries v5 |
| Temperatura | ❌ — wymaga osobnego API pogodowego | Open-Meteo (geokodowanie lub coords stolicy) |

**Wniosek:** minimum **2–4 zapytania** na pełny ekran kraju (MVP: CountriesNow ×2 + geocode + pogoda).

## Szczegóły per opcja

### 1. CountriesNow + flagcdn — metadane kraju (**wybór MVP**)

- **Strona:** https://countriesnow.space/
- **Stolica + nazwa:** `GET https://countriesnow.space/api/v0.1/countries/capital/q?iso2=PL`
- **Populacja:** `GET …/population/q?country=Poland` (nazwa angielska z poprzedniego kroku)
- **Flaga:** `https://flagcdn.com/w320/pl.png` — bez osobnego JSON API
- **CORS:** `Access-Control-Allow-Origin: *` (zweryfikowano)
- **Wada:** populacja historyczna (ostatni rok często ~2018); więcej requestów niż REST v5

### 2. REST Countries v5 — metadane kraju (**alternatywa**)

- **Dokumentacja:** https://restcountries.com/docs  
- **Deprecacja v3:** https://restcountries.com/docs/legacy-api-deprecation  
- **Endpoint (lookup po ISO-2):**  
  `GET https://api.restcountries.com/countries/v5/codes.alpha_2/{CODE}`  
  np. `…/codes.alpha_2/PL`
- **Nagłówek:** `Authorization: Bearer {API_KEY}`
- **Przykład z wąskim payloadem:**  
  `?response_fields=names.common,capitals,population,flag`
- **Pola odpowiedzi (istotne):**
  - `names.common` — np. `"Poland"`
  - `capitals[0].name` — np. `"Warsaw"`
  - `capitals[0].coordinates.lat` / `.lng` — do Open-Meteo
  - `population` — liczba całkowita
  - `flag.emoji` — `"🇵🇱"` (najprostsze w UI)
  - `flag.url_png` / `flag.url_svg` — URL obrazka (CDN `flags.restcountries.com`)
- **CORS:** wymaga skonfigurowania dozwolonych hostname na stronie klucza API (`localhost`, docelowa domena). Bez tego request z przeglądarki jest blokowany. Test `curl` bez nagłówka `Origin` nie odzwierciedla zachowania browsera.
- **Limity (free plan):** 500 żądań/miesiąc; burst max ~20 req/s (429); `response_fields` zalecane dla mniejszego JSON.
- **Koszt:** darmowy plan po rejestracji (bez karty).

### 3. Open-Meteo — temperatura w stolicy (**wybór**)

- **Dokumentacja:** https://open-meteo.com/en/docs  
- **Warunki / limity:** https://open-meteo.com/en/terms  
- **Endpoint:**  
  `GET https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m`
- **Przykład (Warszawa):** `latitude=52.23&longitude=21.01` → `current.temperature_2m: 16.5` (°C)
- **CORS:** `Access-Control-Allow-Origin: *` (zweryfikowano `curl -H "Origin: http://localhost:8080"`)
- **Klucz API:** nie wymagany
- **Limity (free, non-commercial):** 600/min, 5 000/h, 10 000/dzień, 300 000/mies.
- **Uwaga:** temperatura dotyczy stolicy (proxy „pogody w kraju”), nie punktu ISS — sensowne dla warsztatu.

### 4. REST Countries v3.1 — odrzucone (deprecated)

- **Stary endpoint:** `GET https://restcountries.com/v3.1/alpha/{code}`
- **Status 2026-07:** zwraca JSON z `success: false` i komunikatem o migracji do v5. Wcześniejsze tutoriale i prototypy oparte na v3.1 **nie działają**.
- **CORS (dawne):** historycznie `*` na CDN; obecnie endpoint API jest martwy.

### 5. OpenWeatherMap — zapasowa pogoda

- **Dokumentacja:** https://openweathermap.org/current  
- **Cennik / free tier:** https://openweathermap.org/price — Current Weather w planie free: 60 req/min, 1M/mies.
- **Endpoint:** `GET https://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lon}&units=metric&appid={KEY}`
- **Pole:** `main.temp` (°C przy `units=metric`)
- **CORS:** `Access-Control-Allow-Origin: *` (zweryfikowano)
- **Wady dla vanilla JS:** wymaga rejestracji i klucza; `appid` w query string jest widoczny w DevTools (akceptowalne na warsztat, słabe na produkcję bez backendu). Aktywacja klucza do ~2 h po rejestracji.
- **Dlaczego nie pierwszy wybór:** Open-Meteo daje to samo (temperatura po coords) bez klucza i z wyższymi limitami dla non-commercial.

### 6. wttr.in — zapasowa pogoda (hack)

- **Repozytorium:** https://github.com/chubin/wttr.in  
- **Endpoint JSON:** `GET https://wttr.in/{City}?format=j1`
- **Pole:** `current_condition[0].temp_C`
- **CORS:** `Access-Control-Allow-Origin: *` (zweryfikowano)
- **Klucz API:** nie wymagany
- **Zalety:** zero konfiguracji; wystarczy nazwa stolicy z REST Countries.
- **Wady:** brak oficjalnej dokumentacji API, brak gwarancji limitów i dostępności; problemy z znakami diakrytycznymi w nazwach miast; nie nadaje się jako główne źródło produkcyjne.

## Proponowany przepływ w aplikacji (MVP)

```
country_code (z WTIA)
  ├─ "??" → UI: „Nad oceanem”
  └─ ISO-2:
       1. CountriesNow capital?q?iso2=… → name, capital
       2. CountriesNow population?q?country=… → populacja
       3. flagcdn.com/w320/{code}.png → flaga
       4. Open-Meteo geocode(capital, countryCode) → lat/lon
       5. Open-Meteo forecast → temperature_2m °C
```

Alternatywa (REST v5): kroki 1–3 zastąpione jednym `GET /countries/v5/codes.alpha_2/{code}` → coords stolicy → Open-Meteo.

Gdy `country_code === "??"` (ocean): pominąć oba zapytania; UI „Nad oceanem” (zgodnie z `country-from-coords.md`).

## Implikacje dla `app/main.js`

- Wejście: `country_code` z WTIA coordinates (nie BigDataCloud `countryCode` — patrz `country-from-coords.md`).
- Po kroku 1 można równoleglić kroki 2–5 (`Promise.all`).
- Formatowanie populacji: `Intl.NumberFormat('pl-PL')`; temperatura: `16 °C`.
- Flaga MVP: `<img src="https://flagcdn.com/w320/${code.toLowerCase()}.png">`.
- Przy REST v5: cache w `sessionStorage` po kluczu `country:{code}` — oszczędza limit 500/mies.

## Źródła

1. https://restcountries.com/docs — REST Countries v5 (endpointy, pola, CORS, limity)  
2. https://restcountries.com/docs/legacy-api-deprecation — wyłączenie v1–v4/v3.1  
3. https://open-meteo.com/en/docs — Open-Meteo Forecast API  
4. https://open-meteo.com/en/terms — limity i licencja non-commercial  
5. https://openweathermap.org/current — Current Weather API  
6. https://openweathermap.org/price — plany i limity OpenWeatherMap  
7. https://github.com/chubin/wttr.in — wttr.in  
8. https://countriesnow.space/ — CountriesNow API  
9. https://flagcdn.com/ — CDN flag (wzorzec URL)  
10. Testy HTTP 2026-07-09 (`curl` z nagłówkiem `Origin: http://localhost:8080`)
