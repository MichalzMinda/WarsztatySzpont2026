# Research: Wyznaczanie kraju z współrzędnych ISS

**Ticket:** [Jak wyznaczyć kraj z współrzędnych](https://github.com/MichalzMinda/WarsztatySzpont2026/issues/4)  
**Data:** 2026-07-09

## Rekomendacja

Używać endpointu **WTIA coordinates** tego samego dostawcy co pozycja ISS:

`GET https://api.wheretheiss.at/v1/coordinates/{latitude},{longitude}`

Zwraca `country_code` (ISO). Wartość `??` = brak kraju (ocean / nieokreślone terytorium) — wtedy w UI pokazać np. „Nad oceanem”.

**Dlaczego nie BigDataCloud client API (obecny prototyp):** endpoint `reverse-geocode-client` działa technicznie z CORS, ale [oficjalna polityka](https://www.bigdatacloud.com/free-api/free-reverse-geocode-to-city-api) zabrania geokodowania współrzędnych spoza urządzenia użytkownika (np. pozycja ISS). Naruszenie może skutkować banem IP (HTTP 402).

**Polygon lookup (GeoJSON):** dokładniejszy przy granicach, ale wymaga pobrania granic państw (~MB danych) i biblioteki point-in-polygon — zbędna złożoność na etapie lokalnego MVP.

## Porównanie podejść

| Podejście | Klucz API | CORS | Kraj z lat/lon | Ocean | Złożoność MVP |
|-----------|-----------|------|----------------|-------|---------------|
| **WTIA coordinates** | Nie | `*` | `country_code` | `??` | Niska — ten sam dostawca co ISS |
| BigDataCloud client | Nie | `*` | `countryName`, `countryCode`, kontynent | puste pola | Niska, ale **Fair Use** wyklucza ISS |
| BigDataCloud server | Tak (50k/mies.) | Serwer | Pełne dane | Tak | Wymaga backendu |
| Nominatim (OSM) | Nie | `*` | `address.country_code` | `Unable to geocode` | Średnia; polityka użycia ogranicza produkcję |
| GeoJSON + point-in-polygon | Nie | Lokalnie | Własna logika | Brak kraju | Wysoka (plik + biblioteka) |

## Szczegóły per opcja

### 1. WTIA coordinates — **wybór**

- **Dokumentacja:** https://wheretheiss.at/w/developer (sekcja `coordinates/[lat,lon]`)
- **Format URL:** `latitude,longitude` — np. Warszawa: `52.23,21.01`
- **Przykład (ląd):** `{ "country_code": "PL", "timezone_id": "Europe/Warsaw", ... }`
- **Przykład (ocean):** `{ "country_code": "??", ... }`
- **CORS:** `Access-Control-Allow-Origin: *` (zweryfikowano)
- **Rate limit:** ten sam co pozycja ISS (~1 req/s)

### 2. BigDataCloud reverse-geocode-client — odrzucone dla ISS

- **Endpoint:** `GET https://api.bigdatacloud.net/data/reverse-geocode-client`
- **Zalety:** nazwa kraju po polsku (`localityLanguage=pl`), kontynent, miasto
- **Wada:** polityka wymaga współrzędnych **urządzenia użytkownika**, nie ISS
- **Ocean:** puste `countryName` / `countryCode` (test: lat=0, lon=-30)

### 3. Nominatim — zapasowa opcja

- **Endpoint:** `https://nominatim.openstreetmap.org/reverse`
- **CORS:** `access-control-allow-origin: *`
- **Ocean:** `{ "error": "Unable to geocode" }`
- **Uwaga:** [Usage Policy](https://operations.osmfoundation.org/policies/nominatim/) — max 1 req/s, wymagany User-Agent, nie do ciężkiego użycia produkcyjnego

### 4. Polygon lookup — poza MVP

- Pobranie granic (np. Natural Earth, geojson-countries)
- `turf.booleanPointInPolygon` lub podobne
- Plus: działa offline, bez API
- Minus: rozmiar danych, ISS „nad” krajem ≠ punkt w granicy państwa przy niskiej wysokości orbitalnej (dla MVP wystarczy projekcja na powierzchnię)

## Zachowanie UI: ISS nad oceanem

Gdy `country_code === "??"` (WTIA) lub brak kodu kraju:

- Wyświetlić: **„Nad oceanem”** (lub „Poza terytorium kraju”)
- Nie traktować jako błąd API
- Nie odtwarzać radia (logika w osobnym tickecie)

## Implikacje dla `app/main.js`

Prototyp używa BigDataCloud — przy implementacji warto przełączyć na WTIA coordinates dla zgodności z polityką i jednego dostawcy. Nazwę kraju można rozwiązać w tickecie „Skąd brać informacje o kraju” (np. REST Countries po kodzie `PL`).

## Źródła

1. https://wheretheiss.at/w/developer — WTIA coordinates endpoint  
2. https://www.bigdatacloud.com/free-api/free-reverse-geocode-to-city-api — BigDataCloud Fair Use Policy  
3. https://operations.osmfoundation.org/policies/nominatim/ — Nominatim Usage Policy  
4. Testy HTTP 2026-07-09 (`curl` z `Origin: http://localhost:8080`)
