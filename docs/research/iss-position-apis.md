# Research: API pozycji ISS

**Ticket:** [Skąd brać pozycję ISS](https://github.com/MichalzMinda/WarsztatySzpont2026/issues/3)  
**Data:** 2026-07-09

## Rekomendacja

Używać **[Where the ISS at? (WTIA)](https://wheretheiss.at/w/developer)** — endpoint `GET https://api.wheretheiss.at/v1/satellites/25544`.

Powody: HTTPS, brak klucza API, CORS `*`, bogatsza odpowiedź (wysokość, prędkość, timestamp) i już sprawdzone w prototypie (`app/main.js`).

## Porównanie opcji

| Kryterium | wheretheiss.at | Open Notify | NASA api.nasa.gov |
|-----------|----------------|-------------|-------------------|
| Klucz API | Nie wymagany | Nie wymagany | Wymagany (`DEMO_KEY` / własny) |
| CORS z przeglądarki | `Access-Control-Allow-Origin: *` (zweryfikowano) | `access-control-allow-origin: *` (zweryfikowano) | N/A dla `iss-now` (404) |
| HTTPS | Tak | Tylko HTTP w oficjalnej dokumentacji | Tak |
| Lat/lon | Tak (float) | Tak (stringi w JSON) | — |
| Wysokość / prędkość | Tak | Nie | — |
| Limit zapytań | ~1 req/s; nagłówki `X-Rate-Limit-*` (350 / 5 min w praktyce) | Dokumentacja: max ~1 Hz sensowne; zalecane co 5 s | Zależy od endpointu |
| Prostota odpowiedzi | Jedno pole JSON z wszystkimi danymi | `iss_position.latitude/longitude` + `timestamp` | — |

## Szczegóły per źródło

### 1. Where the ISS at? (WTIA) — **wybór**

- **Dokumentacja:** https://wheretheiss.at/w/developer  
- **Endpoint:** `GET https://api.wheretheiss.at/v1/satellites/25544` (25544 = NORAD catalog ID ISS)  
- **Przykładowa odpowiedź:** `latitude`, `longitude`, `altitude`, `velocity`, `visibility`, `timestamp`, `units`  
- **Rate limiting:** oficjalnie ~1 żądanie/s; nagłówki `X-Rate-Limit-Limit`, `X-Rate-Limit-Remaining`, `X-Rate-Limit-Interval`  
- **CORS:** potwierdzony testem `curl -H "Origin: http://localhost:8080"` → `Access-Control-Allow-Origin: *`

### 2. Open Notify — zapasowa opcja

- **Dokumentacja:** http://open-notify.org/Open-Notify-API/ISS-Location-Now/  
- **Endpoint:** `GET http://api.open-notify.org/iss-now.json`  
- **Odpowiedź:** tylko `iss_position.latitude`, `iss_position.longitude`, `timestamp`  
- **Polling:** dokumentacja zaleca co najmniej 5 s między zapytaniami; >1 Hz bez sensu  
- **CORS:** `access-control-allow-origin: *`  
- **Uwaga:** HTTP (nie HTTPS) — przy lokalnym `http://localhost` OK; przy produkcji na HTTPS może być problem mixed content

### 3. NASA Open APIs — odrzucone dla tego use case

- `https://api.nasa.gov/iss-now.json` zwraca 404 (brak takiego endpointu w API NASA)  
- Inne endpointy NASA wymagają klucza i nie są dedykowane „aktualna pozycja ISS w jednym zapytaniu”

## Implikacje dla aplikacji

- Odświeżanie pozycji: ręczny przycisk lub auto-refresh co **5–10 s** (nie częściej niż 1/s)  
- Brak backendu/proxy potrzebnego wyłącznie dla pozycji ISS  
- Kod w `app/main.js` już używa poprawnego endpointu WTIA

## Źródła

1. https://wheretheiss.at/w/developer — oficjalna dokumentacja WTIA  
2. http://open-notify.org/Open-Notify-API/ISS-Location-Now/ — oficjalna dokumentacja Open Notify  
3. Testy nagłówków HTTP wykonane 2026-07-09 (`curl` z nagłówkiem `Origin: http://localhost:8080`)
