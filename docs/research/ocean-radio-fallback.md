# Research: Radio z najbliższego kraju gdy ISS jest nad oceanem

**Ticket:** [Jak wybrać radio z najbliższego kraju gdy ISS jest nad oceanem?](https://github.com/MichalzMinda/WarsztatySzpont2026/issues/30)  
**Data:** 2026-07-09

## Rekomendacja

Gdy WTIA zwraca `country_code === "??"`, użyć **countries.dev** `GET /cities/near?lat={lat}&lng={lon}` i wziąć `countryCode` z **najbliższego miasta na liście** jako kraj zastępczy **wyłącznie do radia** (nie do pełnej karty kraju).

**Dlaczego:** jeden dodatkowy request, CORS `*`, bez klucza API, działa z przeglądarki i zwraca sensowny kraj nadbrzeżny nawet z punktu na środku oceanu (np. `0,-30` → Brazylia `BR`, odległość ~839 km).

**UI:** karta kraju nadal pokazuje **„Nad oceanem”** jako stan główny; radio i ewentualne metadane pochodzą z kraju zastępczego z etykietą typu **„Radio z najbliższego kraju: {nazwa}”**.

**Degradacja radia:** zachować obecną logikę (max 3 stacje z Radio Browser); jeśli pierwszy kraj zastępczy nie ma działającego streamu, przejść do **kolejnego unikalnego `countryCode`** z wyników `/cities/near` (np. pierwsze 5–10 miast), a dopiero potem pokazać „Brak dostępnej stacji radiowej”.

## Zapasowa strategia

**Ostatni znany kraj na lądzie** (`lastLandCountryCode` w pamięci sesji): gdy `/cities/near` zawiedzie (sieć, timeout), użyć ostatniego kodu kraju sprzed wejścia na ocean i odtworzyć radio z niego z etykietą **„Radio z ostatniego kraju nad lądem: {nazwa}”**.

Nie rekomendować jako strategii głównej — ISS może wlecieć na ocean z dowolnej strony, więc „ostatni kraj” bywa geograficznie daleki i mniej intuicyjny niż nearest city.

## Porównanie strategii

| Strategia | Produktowo | Statyczny frontend | Koszt przy refresh 2 s | Radio Browser | Uwagi |
|-----------|------------|--------------------|------------------------|---------------|-------|
| **countries.dev `/cities/near`** | Wysoka — najbliższy ląd/kraj | Tak, CORS `*` | +1 request na cykl oceanu | `bycountrycodeexact/{code}` | **Wybór** |
| Radial search po WTIA coordinates | Średnia — najbliższy kraj po granicy | Tak, ale 4–16 requestów | Zły — limit WTIA ~1 req/s | `bycountrycodeexact` | Odrzucone: zbyt wiele wywołań |
| GeoJSON + point-in-polygon / nearest border | Wysoka geometria | Tak, ale ~MB danych + biblioteka | Lokalnie OK, ciężki bundle | `bycountrycodeexact` | Poza MVP — złożoność |
| BigDataCloud reverse-geocode-client | Średnia | Tak | +1 request | `bycountrycodeexact` | **Odrzucone** — Fair Use wyklucza współrzędne spoza urządzenia użytkownika ([polityka](https://www.bigdatacloud.com/free-api/free-reverse-geocode-to-city-api)) |
| Nominatim reverse | Średnia | Tak, CORS `*` | +1 request, max 1 req/s | `bycountrycodeexact` | Zapas — polityka użycia ogranicza produkcję ([Usage Policy](https://operations.osmfoundation.org/policies/nominatim/)) |
| OpenCage / płatne geokodery | Średnia | Tak z kluczem | +1 request + klucz | `bycountrycodeexact` | Poza MVP — klucz API |
| **Radio Browser geo + Haversine** | Wysoka dla samego radia | Tak | Bardzo zły — `search?has_geo_info=true&limit=1000` | Własna logika odległości | Zapas tylko dla radia; nie daje kraju do karty; ciężki payload |
| Ostatni znany kraj | Niska–średnia | Tak, zero API | 0 dodatkowych requestów | `bycountrycodeexact` | **Zapas** przy awarii `/cities/near` |

## Szczegóły per opcja

### 1. countries.dev `/cities/near` — wybór

- **Dokumentacja:** https://countries.dev/cities-api — sekcja „Reverse geocode a point”
- **Endpoint:** `GET https://countries.dev/cities/near?lat={latitude}&lng={longitude}`
- **Odpowiedź:** tablica miast z `countryCode`, `name`, `distanceKm`, `population`, … posortowana po odległości
- **CORS:** `Access-Control-Allow-Origin: *` (zweryfikowano `curl -H "Origin: http://localhost:8080"`)
- **Klucz API:** nie wymagany ([FAQ](https://countries.dev/cities-api))
- **Test ocean (2026-07-09):**
  - `lat=0, lon=-30` (środek Atlantyku): WTIA → `??`; nearest → Touros, **BR**, 838.7 km
  - `lat=20, lon=-160` (Pacyfik): nearest → Makakilo, **US** (Hawaje), ~248 km
- **Test ląd:** `lat=45, lon=5` → Romans-sur-Isère, **FR**, 7.6 km (nie psuje przypadku lądowego, ale ten endpoint wołamy tylko przy `??`)

**Wybór kraju zastępczego:** pierwszy element listy → `countryCode`. Opcjonalnie dla lepszego radia: preferować wśród wyników miasto o największej `population` w tym samym `countryCode` co najbliższe (większe państwa często mają więcej stacji w Radio Browser).

### 2. WTIA coordinates — zachowanie nad oceanem

- **Dokumentacja:** https://wheretheiss.at/w/developer — `coordinates/[lat,lon]`
- **Ocean:** `country_code: "??"` — brak przypisanego kraju; nie ma osobnego pola „nearest country”
- **Limit:** ~1 req/s (ten sam co pozycja ISS) — uniemożliwia radial search przy odświeżaniu co 2 s

### 3. Radio Browser — brak natywnego „nearest station”

- **Dokumentacja:** https://docs.radio-browser.info/
- Stacje mają opcjonalne `geo_lat` / `geo_long`; filtr `has_geo_info=true` w `/json/stations/search`
- **Brak** endpointu „stacje w promieniu X km” — trzeba pobrać dużą listę i liczyć Haversine po stronie klienta
- Dla MVP lepiej: kraj z countries.dev → istniejący `bycountrycodeexact/{code}` (jak w [radio-streaming.md](./radio-streaming.md))

### 4. Heurystyka „ostatni kraj” — zapas

- W `refresh()` zapamiętać `lastLandCountryCode` gdy `country_code !== "??"`
- Nad oceanem: jeśli `/cities/near` fail → `loadRadio(lastLandCountryCode)` jeśli ustawiony
- Proste, ale gorsze produktowo niż nearest city

## Plan wpięcia w `app/main.js` (bez kodu)

Obecny przepływ:

```
refresh()
  → fetchIssPosition()
  → fetchCountryCode(lat, lon)   // WTIA
  → if ?? → renderOcean(), hideRadio, return
  → else loadCountryDetails(code) → loadRadio(code)
```

Proponowany przepływ:

```
refresh()
  → fetchIssPosition()
  → fetchCountryCode(lat, lon)
  → if ??:
       renderOcean()                    // karta: „Nad oceanem”
       fallback = resolveOceanFallback(lat, lon)
         // GET countries.dev/cities/near; on failure → lastLandCountryCode
       if fallback:
         renderOceanRadioContext(fallback)   // opcjonalnie: „Najbliższy ląd: {miasto}, {kraj} (~{km} km)”
         loadRadio(fallback.countryCode, { mode: "ocean-fallback", label: ... })
         // NIE wołać loadCountryDetails(fallback) — renderCountry() sugerowałby, że ISS jest nad tym krajem
         // opcjonalnie: jeden CountriesNow capital?q?iso2= tylko po nazwę kraju do etykiety radia
       else:
         renderRadioUnavailable() lub ukryj radio
       return
  → else:
       lastLandCountryCode = countryCode
       loadCountryDetails(countryCode)
```

**`resolveOceanFallback`:** jeden `fetch` do countries.dev; zwraca `{ countryCode, cityName, distanceKm }`; przy braku sieci — `{ countryCode: lastLandCountryCode }` jeśli jest. Cache wyniku po zaokrąglonych współrzędnych (np. 1 miejsce po przecinku) na 30–60 s, żeby nie powtarzać requestu przy refresh co 2 s na tym samym odcinku oceanu.

**`loadRadio` — degradacja:** dla oceanu, po wyczerpaniu 3 stacji w kraju A, spróbuj kraju B z kolejnego unikalnego `countryCode` na liście `/cities/near` (max 2–3 kraje łącznie), potem „Brak dostępnej stacji radiowej”.

**Kiedy NIE próbować fallbacku:**

- WTIA zwróciło prawidłowy kod kraju (nie `??`) — normalna ścieżka lądowa
- `/cities/near` pusta tablica i brak `lastLandCountryCode`
- Wszystkie kraje kandydackie wyczerpały limit prób stacji
- WTIA zwraca 429 / twardy błąd — nie dokładać kolejnych API
- (Opcjonalnie) `distanceKm` > ~2500 bez sensowniejszej alternatywy — pokaż kontekst bez radia (np. Ocean Południowy → ZA w ~2300 km)
- (Opcjonalnie) użytkownik wyłączył radio — poza zakresem MVP

## Zachowanie UI

| Sytuacja | Karta kraju | Radio |
|----------|-------------|-------|
| Ląd (`PL`, …) | Pełne metadane kraju | Radio z tego kraju (jak dziś) |
| Ocean + fallback OK | „Nad oceanem” + opcjonalnie „Najbliższy kraj: Brazylia (Touros, ~839 km)” | „Radio z najbliższego kraju: Brazylia” + `<audio>` |
| Ocean + brak radia | Jak wyżej | „Brak dostępnej stacji radiowej” |
| Ocean + brak fallback API i brak last land | „Nad oceanem” | Ukryte lub unavailable |

Nie udawać, że ISS leci nad krajem zastępczym — ocean pozostaje prawdą geodezyjną (WTIA `??`); kraj zastępczy dotyczy tylko doświadczenia radiowego (i opcjonalnie kontekstu).

## Implikacje dla istniejących decyzji

- [country-from-coords.md](./country-from-coords.md): WTIA nadal jedynym źródłem **faktycznego** kraju pod ISS; `??` = ocean bez zmian
- [radio-streaming.md](./radio-streaming.md): Radio Browser `bycountrycodeexact` bez zmian; rozszerzenie tylko o **skąd wziąć kod** nad oceanem
- Issue [#19](https://github.com/MichalzMinda/WarsztatySzpont2026/issues/19) (mapa ISS): decyzja „radio ukryte nad oceanem” wymaga **aktualizacji produktowej** — radio ma grać z fallbacku, nie znikać

## Źródła

1. https://countries.dev/cities-api — dokumentacja i FAQ countries.dev  
2. https://wheretheiss.at/w/developer — WTIA coordinates, `??` nad oceanem  
3. https://docs.radio-browser.info/ — Radio Browser API, `geo_lat`/`geo_long`, `has_geo_info`  
4. https://www.bigdatacloud.com/free-api/free-reverse-geocode-to-city-api — Fair Use (odrzucenie dla ISS)  
5. https://operations.osmfoundation.org/policies/nominatim/ — Nominatim Usage Policy  
6. Testy HTTP 2026-07-09 (`curl` z `Origin: http://localhost:8080`)
