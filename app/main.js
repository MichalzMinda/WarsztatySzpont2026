const ISS_SATELLITE_ID = 25544;
const ISS_PROPAGATE_API = `https://tle.ivanstanojevic.me/api/tle/${ISS_SATELLITE_ID}/propagate`;
const NOMINATIM_REVERSE_API = "https://nominatim.openstreetmap.org/reverse";
const COUNTRIES_NOW_API = "https://countriesnow.space/api/v0.1/countries";
const OPEN_METEO_GEO_API = "https://geocoding-api.open-meteo.com/v1/search";
const OPEN_METEO_FORECAST_API = "https://api.open-meteo.com/v1/forecast";
const RADIO_BROWSER_API = "https://de1.api.radio-browser.info/json/stations/bycountrycodeexact";
const COUNTRIES_DEV_NEAR_API = "https://countries.dev/cities/near";
const PLAYABLE_CODECS = new Set(["MP3", "AAC", "AAC+"]);
const MAX_RADIO_ATTEMPTS = 3;
const MAX_OCEAN_FALLBACK_COUNTRIES = 3;
const OCEAN_NEAR_CACHE_MS = 45000;
const GEO_COUNTRY_CACHE_MS = 60000;
const COUNTRY_DETAILS_CACHE_MS = 300000;
const OCEAN_CODE = "??";
const AUTO_REFRESH_MS = 5000;
const MIN_REFRESH_MS = 5000;
const MAX_REFRESH_MS = 60000;

const CODEC_PRIORITY = { MP3: 0, AAC: 1, "AAC+": 2 };

const populationFormatter = new Intl.NumberFormat("pl-PL");

function sortStationsByCodec(stations) {
  return [...stations].sort(
    (left, right) => (CODEC_PRIORITY[left.codec] ?? 9) - (CODEC_PRIORITY[right.codec] ?? 9),
  );
}

const musicBannerEl = document.querySelector(".music-banner");
const mapCardEl = document.getElementById("map-card");
const mapEl = document.getElementById("map");
const mapStatusEl = document.getElementById("map-status");
const statusEl = document.getElementById("status");
const countryEl = document.getElementById("country");
const radioEl = document.getElementById("radio");
const refreshBtn = document.getElementById("refresh");
const audioEl = document.createElement("audio");

let currentCountryCode = null;
let currentRadioPlaybackId = null;
let lastLandCountryCode = null;
let oceanNearCache = null;
let radioStations = [];
let radioErrorHandler = null;
let radioContextLabel = null;
let oceanFallbackCountryCodes = [];
let oceanFallbackCountryIndex = 0;
let isOceanRadio = false;
let autoplayBlocked = false;
let pendingUserPlayback = false;
let refreshTimeoutId = null;
let refreshIntervalMs = AUTO_REFRESH_MS;
let isRefreshing = false;
let isInitialLoad = true;
let lastGeoCountryCode = null;
let lastOceanNearestKey = null;
let geoCountryCache = null;
let countryDetailsCache = new Map();
let map = null;
let issMarker = null;

function setMusicBannerPlaying(isPlaying) {
  if (!musicBannerEl) {
    return;
  }
  musicBannerEl.classList.toggle("is-playing", isPlaying);
}

function setMapStatus(message) {
  mapStatusEl.textContent = message;
}

function showMapError(message) {
  mapCardEl.classList.add("error");
  mapEl.classList.add("map-error");
  mapEl.textContent = message;
  setMapStatus("Mapa niedostępna");
}

function resetMapError() {
  mapCardEl.classList.remove("error");
  mapEl.classList.remove("map-error");
  if (!map) {
    mapEl.textContent = "";
  }
}

function ensureMap() {
  if (map) {
    return map;
  }

  if (typeof window.L === "undefined") {
    throw new Error("Nie udało się załadować biblioteki mapy.");
  }

  resetMapError();

  map = window.L.map(mapEl, {
    worldCopyJump: true,
    zoomControl: true,
    attributionControl: true,
  }).setView([0, 0], 2);

  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    minZoom: 1,
    maxZoom: 6,
  }).addTo(map);

  issMarker = window.L.marker([0, 0]).addTo(map);
  issMarker.bindTooltip("ISS", {
    direction: "top",
    offset: [0, -12],
  });

  window.setTimeout(() => {
    map.invalidateSize();
  }, 0);

  return map;
}

function renderMapLoading() {
  resetMapError();
  if (isInitialLoad) {
    setMapStatus("Ładowanie pozycji ISS…");
  }
}

function updateMap(iss, locationLabel) {
  const activeMap = ensureMap();
  const latLng = [iss.latitude, iss.longitude];

  resetMapError();
  activeMap.setView(latLng, 3);
  issMarker.setLatLng(latLng);
  issMarker.setTooltipContent(locationLabel);
  if (mapStatusEl.textContent !== locationLabel) {
    setMapStatus(locationLabel);
  }
}

function showIssError(message) {
  statusEl.className = "card error";
  statusEl.textContent = message;
}

function showCountryError(message) {
  countryEl.className = "card error";
  countryEl.classList.remove("hidden");
  countryEl.textContent = message;
}

function hideCountryCard() {
  countryEl.classList.add("hidden");
  countryEl.className = "card";
  countryEl.textContent = "";
}

function hideRadioCard() {
  stopRadio();
  radioEl.classList.add("hidden");
  radioEl.className = "card";
  radioEl.textContent = "";
}

async function fetchIssPosition() {
  const response = await fetch(ISS_PROPAGATE_API, { cache: "no-store" });
  if (response.status === 429) {
    throw new RateLimitError("ISS API zwróciło błąd 429 — zbyt wiele zapytań.");
  }
  if (!response.ok) {
    throw new Error(`ISS API zwróciło błąd ${response.status}`);
  }

  const data = await response.json();
  const latitude = data.geodetic?.latitude;
  const longitude = data.geodetic?.longitude;
  const altitude = data.geodetic?.altitude;
  const velocityKms = data.vector?.velocity?.r;
  if (
    latitude == null ||
    longitude == null ||
    altitude == null ||
    velocityKms == null
  ) {
    throw new Error("ISS API zwróciło niekompletne dane pozycji.");
  }

  const measuredAt = data.parameters?.date ? Date.parse(data.parameters.date) : NaN;
  return {
    latitude,
    longitude,
    altitude,
    velocity: velocityKms * 3600,
    timestamp: Number.isFinite(measuredAt)
      ? Math.floor(measuredAt / 1000)
      : Math.floor(Date.now() / 1000),
  };
}

class RateLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = "RateLimitError";
  }
}

async function fetchCountryCode(latitude, longitude) {
  const url = new URL(NOMINATIM_REVERSE_API);
  url.searchParams.set("lat", latitude.toString());
  url.searchParams.set("lon", longitude.toString());
  url.searchParams.set("format", "json");

  const response = await fetch(url);
  if (response.status === 429) {
    throw new RateLimitError("Nominatim zwróciło błąd 429 — zbyt wiele zapytań.");
  }
  if (!response.ok) {
    throw new Error(`Nominatim zwróciło błąd ${response.status}`);
  }

  const data = await response.json();
  const countryCode = data.address?.country_code;
  if (data.error || !countryCode) {
    return OCEAN_CODE;
  }
  return countryCode.toUpperCase();
}

async function fetchCountryCodeCached(latitude, longitude) {
  const key = cacheKeyForCoords(latitude, longitude);
  const now = Date.now();
  if (geoCountryCache?.key === key && geoCountryCache.expiresAt > now) {
    return geoCountryCache.countryCode;
  }

  const countryCode = await fetchCountryCode(latitude, longitude);
  geoCountryCache = { key, countryCode, expiresAt: now + GEO_COUNTRY_CACHE_MS };
  return countryCode;
}

function cacheKeyForCoords(latitude, longitude) {
  return `${latitude.toFixed(1)},${longitude.toFixed(1)}`;
}

async function fetchNearestCities(latitude, longitude) {
  const key = cacheKeyForCoords(latitude, longitude);
  const now = Date.now();
  if (oceanNearCache?.key === key && oceanNearCache.expiresAt > now) {
    return oceanNearCache.cities;
  }

  const url = new URL(COUNTRIES_DEV_NEAR_API);
  url.searchParams.set("lat", latitude.toString());
  url.searchParams.set("lng", longitude.toString());

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`countries.dev zwróciło błąd ${response.status}`);
  }

  const cities = await response.json();
  if (!Array.isArray(cities)) {
    throw new Error("countries.dev zwróciło nieoczekiwany format odpowiedzi.");
  }

  oceanNearCache = { key, cities, expiresAt: now + OCEAN_NEAR_CACHE_MS };
  return cities;
}

function uniqueCountryCodesFromCities(cities, maxCountries = MAX_OCEAN_FALLBACK_COUNTRIES) {
  const codes = [];
  for (const city of cities) {
    if (!city.countryCode || codes.includes(city.countryCode)) {
      continue;
    }
    codes.push(city.countryCode);
    if (codes.length >= maxCountries) {
      break;
    }
  }
  return codes;
}

async function resolveOceanFallback(latitude, longitude) {
  try {
    const cities = await fetchNearestCities(latitude, longitude);
    if (cities.length > 0) {
      return { source: "nearest", cities, nearest: cities[0] };
    }
  } catch {
    // Fall through to last known land country.
  }

  if (lastLandCountryCode) {
    return { source: "last-land", countryCode: lastLandCountryCode };
  }

  return null;
}

async function fetchCountryName(iso2) {
  try {
    const data = await fetchCountryCapital(iso2);
    return data.name;
  } catch {
    return iso2;
  }
}

async function fetchCountryCapital(iso2) {
  const response = await fetch(`${COUNTRIES_NOW_API}/capital/q?iso2=${encodeURIComponent(iso2)}`);
  if (!response.ok) {
    throw new Error(`CountriesNow (stolica) zwróciło błąd ${response.status}`);
  }
  const payload = await response.json();
  if (payload.error || !payload.data) {
    throw new Error("CountriesNow nie zwróciło danych o stolicy kraju.");
  }
  return payload.data;
}

async function fetchCountryPopulation(countryName) {
  const response = await fetch(
    `${COUNTRIES_NOW_API}/population/q?country=${encodeURIComponent(countryName)}`,
  );
  if (!response.ok) {
    throw new Error(`CountriesNow (populacja) zwróciło błąd ${response.status}`);
  }
  const payload = await response.json();
  if (payload.error || !payload.data?.populationCounts?.length) {
    throw new Error("CountriesNow nie zwróciło danych o populacji.");
  }
  const latest = payload.data.populationCounts.at(-1);
  return latest.value;
}

async function fetchCapitalTemperature(capital, countryCode) {
  const geoUrl = new URL(OPEN_METEO_GEO_API);
  geoUrl.searchParams.set("name", capital);
  geoUrl.searchParams.set("count", "1");
  geoUrl.searchParams.set("countryCode", countryCode);

  const geoResponse = await fetch(geoUrl);
  if (!geoResponse.ok) {
    throw new Error(`Open-Meteo (geokodowanie) zwróciło błąd ${geoResponse.status}`);
  }
  const geoData = await geoResponse.json();
  const location = geoData.results?.[0];
  if (!location) {
    throw new Error("Nie udało się zlokalizować stolicy dla pogody.");
  }

  const forecastUrl = new URL(OPEN_METEO_FORECAST_API);
  forecastUrl.searchParams.set("latitude", location.latitude);
  forecastUrl.searchParams.set("longitude", location.longitude);
  forecastUrl.searchParams.set("current", "temperature_2m");

  const forecastResponse = await fetch(forecastUrl);
  if (!forecastResponse.ok) {
    throw new Error(`Open-Meteo (pogoda) zwróciło błąd ${forecastResponse.status}`);
  }
  const forecastData = await forecastResponse.json();
  const temperature = forecastData.current?.temperature_2m;
  if (temperature == null) {
    throw new Error("Open-Meteo nie zwróciło temperatury.");
  }
  return temperature;
}

async function fetchRadioStations(countryCode) {
  const url = `${RADIO_BROWSER_API}/${encodeURIComponent(countryCode)}?limit=10&order=clickcount&reverse=true`;
  const response = await fetch(url, {
    headers: { "User-Agent": "ISS-Country-Tracker/1.0" },
  });
  if (!response.ok) {
    throw new Error(`Radio Browser zwróciło błąd ${response.status}`);
  }
  const stations = await response.json();
  return sortStationsByCodec(
    stations.filter((station) => PLAYABLE_CODECS.has(station.codec) && station.url_resolved),
  );
}

function flagUrl(countryCode) {
  return `https://flagcdn.com/w320/${countryCode.toLowerCase()}.png`;
}

function ensureIssCard() {
  if (statusEl.querySelector("#iss-latitude")) {
    return;
  }

  statusEl.className = "card";
  statusEl.innerHTML = `
    <h2>Pozycja ISS</h2>
    <dl>
      <dt>Szerokość</dt><dd id="iss-latitude"></dd>
      <dt>Długość</dt><dd id="iss-longitude"></dd>
      <dt>Wysokość</dt><dd id="iss-altitude"></dd>
      <dt>Prędkość</dt><dd id="iss-velocity"></dd>
      <dt>Pomiar</dt><dd id="iss-measured-at"></dd>
    </dl>
  `;
}

function updateIssCard(iss) {
  ensureIssCard();
  statusEl.className = "card";

  const measuredAt = iss.timestamp
    ? new Date(iss.timestamp * 1000).toLocaleTimeString("pl-PL")
    : "brak danych";

  statusEl.querySelector("#iss-latitude").textContent = `${iss.latitude.toFixed(4)}°`;
  statusEl.querySelector("#iss-longitude").textContent = `${iss.longitude.toFixed(4)}°`;
  statusEl.querySelector("#iss-altitude").textContent = `${Math.round(iss.altitude)} km`;
  statusEl.querySelector("#iss-velocity").textContent = `${Math.round(iss.velocity)} km/h`;
  statusEl.querySelector("#iss-measured-at").textContent = measuredAt;
}

function renderOcean(nearestContext) {
  const nearestKey = nearestContext?.nearest
    ? `${nearestContext.nearest.name}:${nearestContext.countryName || nearestContext.nearest.countryCode}:${Math.round(nearestContext.nearest.distanceKm)}`
    : "";
  if (
    countryEl.dataset.view === "ocean" &&
    countryEl.dataset.nearestKey === nearestKey &&
    !countryEl.classList.contains("hidden")
  ) {
    return;
  }

  countryEl.dataset.view = "ocean";
  countryEl.dataset.nearestKey = nearestKey;
  countryEl.className = "card muted";
  countryEl.classList.remove("hidden");

  let nearestHtml = "";
  if (nearestContext?.nearest) {
    const countryLabel = nearestContext.countryName || nearestContext.nearest.countryCode;
    nearestHtml = `
      <p class="ocean-nearest">Najbliższy ląd: ${nearestContext.nearest.name}, ${countryLabel} (~${Math.round(nearestContext.nearest.distanceKm)} km)</p>
    `;
  }

  countryEl.innerHTML = `
    <h2>Kraj pod ISS</h2>
    <p>Nad oceanem</p>
    ${nearestHtml}
  `;
}

function renderCountry({ countryCode, name, capital, population, temperature }) {
  const snapshot = `${countryCode}:${name}:${capital}:${population}:${Math.round(temperature)}`;
  if (
    countryEl.dataset.view === "land" &&
    countryEl.dataset.snapshot === snapshot &&
    !countryEl.classList.contains("hidden")
  ) {
    return;
  }

  countryEl.dataset.view = "land";
  countryEl.dataset.snapshot = snapshot;
  countryEl.className = "card";
  countryEl.classList.remove("hidden");
  countryEl.innerHTML = `
    <h2>Kraj pod ISS</h2>
    <img class="country-flag" src="${flagUrl(countryCode)}" alt="Flaga: ${name}" width="320" height="auto" />
    <dl>
      <dt>Kraj</dt><dd>${name}</dd>
      <dt>Kod</dt><dd>${countryCode}</dd>
      <dt>Stolica</dt><dd>${capital}</dd>
      <dt>Populacja</dt><dd>${populationFormatter.format(population)}</dd>
      <dt>Temperatura w stolicy</dt><dd>${Math.round(temperature)} °C</dd>
    </dl>
  `;
}

function renderRadioUnavailable() {
  radioEl.className = "card";
  radioEl.classList.remove("hidden");
  const contextHtml = radioContextLabel
    ? `<p class="radio-context">${radioContextLabel}</p>`
    : "";
  radioEl.innerHTML = `
    <h2>Radio</h2>
    ${contextHtml}
    <p class="radio-unavailable">Brak dostępnej stacji radiowej</p>
  `;
}

function renderRadioStation(stationName) {
  radioEl.className = "card";
  radioEl.classList.remove("hidden");
  const contextHtml = radioContextLabel
    ? `<p class="radio-context">${radioContextLabel}</p>`
    : "";
  const autoplayHtml = autoplayBlocked
    ? `<p class="radio-autoplay-hint">Kliknij ▶ w odtwarzaczu, aby włączyć dźwięk.</p>`
    : "";
  radioEl.innerHTML = `
    <h2>Radio</h2>
    ${contextHtml}
    <p>${stationName}</p>
    ${autoplayHtml}
    <div class="radio-player"></div>
  `;
  radioEl.querySelector(".radio-player").appendChild(audioEl);
}

function updateAutoplayHint() {
  const hintEl = radioEl.querySelector(".radio-autoplay-hint");
  if (autoplayBlocked && !hintEl && radioEl.querySelector(".radio-player")) {
    const hint = document.createElement("p");
    hint.className = "radio-autoplay-hint";
    hint.textContent = "Kliknij ▶ w odtwarzaczu, aby włączyć dźwięk.";
    radioEl.querySelector(".radio-player").before(hint);
  } else if (!autoplayBlocked && hintEl) {
    hintEl.remove();
  }
}

async function ensureRadioPlayback(fromUser = false) {
  if (!audioEl.src) {
    return false;
  }

  const userInitiated = fromUser || pendingUserPlayback;
  pendingUserPlayback = false;

  if (!audioEl.paused && !audioEl.ended) {
    autoplayBlocked = false;
    updateAutoplayHint();
    return true;
  }

  try {
    await audioEl.play();
    autoplayBlocked = false;
    updateAutoplayHint();
    return true;
  } catch {
    autoplayBlocked = true;
    updateAutoplayHint();
    if (userInitiated) {
      return false;
    }
    return false;
  }
}

function stopRadio() {
  if (radioErrorHandler) {
    audioEl.removeEventListener("error", radioErrorHandler);
    radioErrorHandler = null;
  }
  audioEl.pause();
  audioEl.removeAttribute("src");
  audioEl.load();
  radioStations = [];
  isOceanRadio = false;
  oceanFallbackCountryCodes = [];
  oceanFallbackCountryIndex = 0;
  radioContextLabel = null;
  setMusicBannerPlaying(false);
}

async function tryNextOceanCountry() {
  oceanFallbackCountryIndex += 1;
  if (oceanFallbackCountryIndex >= oceanFallbackCountryCodes.length) {
    renderRadioUnavailable();
    return;
  }

  const countryCode = oceanFallbackCountryCodes[oceanFallbackCountryIndex];
  currentCountryCode = countryCode;

  try {
    radioStations = await fetchRadioStations(countryCode);
    if (radioStations.length === 0) {
      await tryNextOceanCountry();
      return;
    }
    tryPlayStation(0);
  } catch {
    await tryNextOceanCountry();
  }
}

function tryPlayStation(index) {
  if (index >= MAX_RADIO_ATTEMPTS || index >= radioStations.length) {
    if (isOceanRadio) {
      void tryNextOceanCountry();
      return;
    }
    renderRadioUnavailable();
    return;
  }

  const station = radioStations[index];
  renderRadioStation(station.name);
  audioEl.src = station.url_resolved;

  if (radioErrorHandler) {
    audioEl.removeEventListener("error", radioErrorHandler);
  }

  radioErrorHandler = () => tryPlayStation(index + 1);
  audioEl.addEventListener("error", radioErrorHandler, { once: true });
  void ensureRadioPlayback(false);
}

async function resumeExistingRadio(userInitiated) {
  radioEl.classList.remove("hidden");
  updateAutoplayHint();
  await ensureRadioPlayback(userInitiated);
}

async function loadRadio(countryCode, options = {}) {
  const playbackId = options.playbackId ?? `land:${countryCode}`;
  const userInitiated = Boolean(options.userInitiated);
  if (playbackId === currentRadioPlaybackId && audioEl.src) {
    await resumeExistingRadio(userInitiated);
    return;
  }

  stopRadio();
  currentRadioPlaybackId = playbackId;
  currentCountryCode = countryCode;
  isOceanRadio = Boolean(options.isOceanRadio);
  oceanFallbackCountryCodes = options.fallbackCountryCodes ?? [];
  oceanFallbackCountryIndex = 0;
  radioContextLabel = options.radioContextLabel ?? null;

  try {
    radioStations = await fetchRadioStations(countryCode);
    if (radioStations.length === 0) {
      if (isOceanRadio) {
        await tryNextOceanCountry();
        return;
      }
      renderRadioUnavailable();
      return;
    }
    tryPlayStation(0);
  } catch {
    if (isOceanRadio) {
      await tryNextOceanCountry();
      return;
    }
    renderRadioUnavailable();
  }
}

async function loadOceanRadio(fallback, options = {}) {
  const userInitiated = Boolean(options.userInitiated);

  if (fallback.source === "nearest") {
    const countryCodes = uniqueCountryCodesFromCities(fallback.cities);
    const countryName =
      countryCodes.length > 0 ? await fetchCountryName(countryCodes[0]) : fallback.nearest.countryCode;
    renderOcean({ nearest: fallback.nearest, countryName });

    if (countryCodes.length === 0) {
      currentRadioPlaybackId = null;
      renderRadioUnavailable();
      return;
    }

    const playbackId = `ocean:${countryCodes.join(",")}`;
    if (playbackId === currentRadioPlaybackId && audioEl.src) {
      await resumeExistingRadio(userInitiated);
      return;
    }

    await loadRadio(countryCodes[0], {
      playbackId,
      isOceanRadio: true,
      fallbackCountryCodes: countryCodes,
      radioContextLabel: `Radio z najbliższego kraju: ${countryName}`,
      userInitiated,
    });
    return;
  }

  if (fallback.source === "last-land") {
    const countryName = await fetchCountryName(fallback.countryCode);
    renderOcean();
    const playbackId = `ocean-last:${fallback.countryCode}`;
    if (playbackId === currentRadioPlaybackId && audioEl.src) {
      await resumeExistingRadio(userInitiated);
      return;
    }

    await loadRadio(fallback.countryCode, {
      playbackId,
      isOceanRadio: true,
      fallbackCountryCodes: [fallback.countryCode],
      radioContextLabel: `Radio z ostatniego kraju nad lądem: ${countryName}`,
      userInitiated,
    });
  }
}

async function loadCountryDetails(countryCode, options = {}) {
  const force = Boolean(options.force);
  const now = Date.now();
  const cached = countryDetailsCache.get(countryCode);
  let details = cached && cached.expiresAt > now && !force ? cached.data : null;

  if (!details) {
    const capitalData = await fetchCountryCapital(countryCode);
    const [population, temperature] = await Promise.all([
      fetchCountryPopulation(capitalData.name),
      fetchCapitalTemperature(capitalData.capital, countryCode),
    ]);
    details = {
      countryCode,
      name: capitalData.name,
      capital: capitalData.capital,
      population,
      temperature,
    };
    countryDetailsCache.set(countryCode, {
      data: details,
      expiresAt: now + COUNTRY_DETAILS_CACHE_MS,
    });
  }

  renderCountry(details);

  await loadRadio(countryCode, {
    playbackId: `land:${countryCode}`,
    userInitiated: Boolean(options.userInitiated),
  });
}

function increaseRefreshBackoff() {
  refreshIntervalMs = Math.min(refreshIntervalMs * 2, MAX_REFRESH_MS);
}

function resetRefreshBackoff() {
  refreshIntervalMs = AUTO_REFRESH_MS;
}

function scheduleNextRefresh() {
  window.clearTimeout(refreshTimeoutId);
  refreshTimeoutId = window.setTimeout(() => {
    refresh();
  }, refreshIntervalMs);
}

async function refresh(options = {}) {
  const userInitiated = Boolean(options.userInitiated);
  if (isRefreshing) {
    scheduleNextRefresh();
    return;
  }

  isRefreshing = true;
  if (isInitialLoad) {
    refreshBtn.disabled = true;
    statusEl.className = "card";
    statusEl.textContent = "Ładowanie pozycji ISS…";
    renderMapLoading();
  }

  try {
    const iss = await fetchIssPosition();
    updateIssCard(iss);
    resetRefreshBackoff();

    const coordKey = cacheKeyForCoords(iss.latitude, iss.longitude);
    const countryCode = await fetchCountryCodeCached(iss.latitude, iss.longitude);
    const geoChanged = countryCode !== lastGeoCountryCode;
    lastGeoCountryCode = countryCode;

    if (countryCode === OCEAN_CODE) {
      updateMap(iss, "ISS nad oceanem");
      currentCountryCode = null;

      const oceanContextChanged = coordKey !== lastOceanNearestKey;

      if (!geoChanged && !oceanContextChanged && !userInitiated) {
        if (currentRadioPlaybackId && audioEl.src) {
          await resumeExistingRadio(false);
        }
        return;
      }

      lastOceanNearestKey = coordKey;

      try {
        const fallback = await resolveOceanFallback(iss.latitude, iss.longitude);
        if (fallback) {
          await loadOceanRadio(fallback, { userInitiated });
        } else {
          currentRadioPlaybackId = null;
          hideRadioCard();
          renderOcean();
        }
      } catch {
        currentRadioPlaybackId = null;
        hideRadioCard();
        renderOcean();
        renderRadioUnavailable();
      }
      return;
    }

    lastOceanNearestKey = null;
    lastLandCountryCode = countryCode;
    updateMap(iss, `ISS nad krajem ${countryCode}`);

    if (!geoChanged && !userInitiated) {
      return;
    }

    try {
      await loadCountryDetails(countryCode, { userInitiated });
    } catch (error) {
      showCountryError(error.message || "Nie udało się pobrać informacji o kraju.");
      hideRadioCard();
    }
  } catch (error) {
    if (error instanceof RateLimitError) {
      increaseRefreshBackoff();
      if (!isInitialLoad) {
        return;
      }
    }

    showMapError(error.message || "Nie udało się pobrać danych mapy.");
    showIssError(error.message || "Nie udało się pobrać danych.");
    hideCountryCard();
    hideRadioCard();
  } finally {
    isRefreshing = false;
    isInitialLoad = false;
    refreshBtn.disabled = false;
    scheduleNextRefresh();
  }
}

audioEl.controls = true;
audioEl.preload = "none";
audioEl.addEventListener("playing", () => {
  autoplayBlocked = false;
  updateAutoplayHint();
  setMusicBannerPlaying(true);
});
audioEl.addEventListener("pause", () => {
  setMusicBannerPlaying(false);
});
audioEl.addEventListener("ended", () => {
  setMusicBannerPlaying(false);
});

refreshBtn.addEventListener("click", () => {
  pendingUserPlayback = true;
  if (audioEl.src) {
    void audioEl.play().then(() => {
      autoplayBlocked = false;
      updateAutoplayHint();
    }).catch(() => {
      autoplayBlocked = true;
      updateAutoplayHint();
    });
  }
  window.clearTimeout(refreshTimeoutId);
  void refresh({ userInitiated: true });
});
refresh();
