const ISS_SATELLITE_ID = 25544;
const ISS_API = `https://api.wheretheiss.at/v1/satellites/${ISS_SATELLITE_ID}`;
const WTIA_COORDS_API = "https://api.wheretheiss.at/v1/coordinates";
const COUNTRIES_NOW_API = "https://countriesnow.space/api/v0.1/countries";
const OPEN_METEO_GEO_API = "https://geocoding-api.open-meteo.com/v1/search";
const OPEN_METEO_FORECAST_API = "https://api.open-meteo.com/v1/forecast";
const RADIO_BROWSER_API = "https://de1.api.radio-browser.info/json/stations/bycountrycodeexact";
const PLAYABLE_CODECS = new Set(["MP3", "AAC", "AAC+"]);
const MAX_RADIO_ATTEMPTS = 3;
const OCEAN_CODE = "??";
const AUTO_REFRESH_MS = 2000;

const populationFormatter = new Intl.NumberFormat("pl-PL");

const mapCardEl = document.getElementById("map-card");
const mapEl = document.getElementById("map");
const mapStatusEl = document.getElementById("map-status");
const statusEl = document.getElementById("status");
const countryEl = document.getElementById("country");
const radioEl = document.getElementById("radio");
const refreshBtn = document.getElementById("refresh");
const audioEl = document.createElement("audio");

let currentCountryCode = null;
let radioStations = [];
let radioErrorHandler = null;
let refreshTimeoutId = null;
let isRefreshing = false;
let map = null;
let issMarker = null;

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
  setMapStatus("Ładowanie pozycji ISS…");
}

function renderMap(iss, locationLabel) {
  const activeMap = ensureMap();
  const latLng = [iss.latitude, iss.longitude];

  resetMapError();
  activeMap.setView(latLng, 3);
  issMarker.setLatLng(latLng);
  issMarker.setTooltipContent(locationLabel);
  setMapStatus(locationLabel);
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
  const url = new URL(ISS_API);
  url.searchParams.set("t", Date.now().toString());

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`ISS API zwróciło błąd ${response.status}`);
  }
  return response.json();
}

async function fetchCountryCode(latitude, longitude) {
  const response = await fetch(`${WTIA_COORDS_API}/${latitude},${longitude}`);
  if (!response.ok) {
    throw new Error(`WTIA coordinates zwróciło błąd ${response.status}`);
  }
  const data = await response.json();
  return data.country_code;
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
  return stations.filter((station) => PLAYABLE_CODECS.has(station.codec) && station.url_resolved);
}

function flagUrl(countryCode) {
  return `https://flagcdn.com/w320/${countryCode.toLowerCase()}.png`;
}

function renderIss(iss) {
  const measuredAt = iss.timestamp
    ? new Date(iss.timestamp * 1000).toLocaleTimeString("pl-PL")
    : "brak danych";

  statusEl.className = "card";
  statusEl.innerHTML = `
    <h2>Pozycja ISS</h2>
    <dl>
      <dt>Szerokość</dt><dd>${iss.latitude.toFixed(4)}°</dd>
      <dt>Długość</dt><dd>${iss.longitude.toFixed(4)}°</dd>
      <dt>Wysokość</dt><dd>${Math.round(iss.altitude)} km</dd>
      <dt>Prędkość</dt><dd>${Math.round(iss.velocity)} km/h</dd>
      <dt>Pomiar</dt><dd>${measuredAt}</dd>
    </dl>
  `;
}

function renderOcean() {
  countryEl.className = "card muted";
  countryEl.classList.remove("hidden");
  countryEl.innerHTML = `
    <h2>Kraj pod ISS</h2>
    <p>Nad oceanem</p>
  `;
}

function renderCountry({ countryCode, name, capital, population, temperature }) {
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
  radioEl.innerHTML = `
    <h2>Radio</h2>
    <p class="radio-unavailable">Brak dostępnej stacji radiowej</p>
  `;
}

function renderRadioStation(stationName) {
  radioEl.className = "card";
  radioEl.classList.remove("hidden");
  radioEl.innerHTML = `
    <h2>Radio</h2>
    <p>${stationName}</p>
    <div class="radio-player"></div>
  `;
  radioEl.querySelector(".radio-player").appendChild(audioEl);
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
}

function tryPlayStation(index) {
  if (index >= MAX_RADIO_ATTEMPTS || index >= radioStations.length) {
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
  audioEl.play().catch(() => {
    // Browsers may block autoplay without a user gesture; keep the station loaded.
  });
}

async function loadRadio(countryCode) {
  if (countryCode === currentCountryCode && audioEl.src) {
    return;
  }

  if (countryCode !== currentCountryCode) {
    stopRadio();
    currentCountryCode = countryCode;
  }

  try {
    radioStations = await fetchRadioStations(countryCode);
    if (radioStations.length === 0) {
      renderRadioUnavailable();
      return;
    }
    tryPlayStation(0);
  } catch {
    renderRadioUnavailable();
  }
}

async function loadCountryDetails(countryCode) {
  const capitalData = await fetchCountryCapital(countryCode);
  const [population, temperature] = await Promise.all([
    fetchCountryPopulation(capitalData.name),
    fetchCapitalTemperature(capitalData.capital, countryCode),
  ]);

  renderCountry({
    countryCode,
    name: capitalData.name,
    capital: capitalData.capital,
    population,
    temperature,
  });

  await loadRadio(countryCode);
}

function scheduleNextRefresh() {
  window.clearTimeout(refreshTimeoutId);
  refreshTimeoutId = window.setTimeout(() => {
    refresh();
  }, AUTO_REFRESH_MS);
}

async function refresh() {
  if (isRefreshing) {
    scheduleNextRefresh();
    return;
  }

  isRefreshing = true;
  refreshBtn.disabled = true;
  renderMapLoading();
  statusEl.className = "card";
  statusEl.textContent = "Ładowanie pozycji ISS…";
  hideCountryCard();
  hideRadioCard();

  try {
    const iss = await fetchIssPosition();
    renderIss(iss);

    const countryCode = await fetchCountryCode(iss.latitude, iss.longitude);

    if (countryCode === OCEAN_CODE) {
      renderMap(iss, "ISS nad oceanem");
      currentCountryCode = null;
      hideRadioCard();
      renderOcean();
      return;
    }

    try {
      renderMap(iss, `ISS nad krajem ${countryCode}`);
      await loadCountryDetails(countryCode);
    } catch (error) {
      showCountryError(error.message || "Nie udało się pobrać informacji o kraju.");
      hideRadioCard();
    }
  } catch (error) {
    showMapError(error.message || "Nie udało się pobrać danych mapy.");
    showIssError(error.message || "Nie udało się pobrać danych.");
    hideCountryCard();
    hideRadioCard();
  } finally {
    isRefreshing = false;
    refreshBtn.disabled = false;
    scheduleNextRefresh();
  }
}

audioEl.controls = true;
refreshBtn.addEventListener("click", () => {
  window.clearTimeout(refreshTimeoutId);
  refresh();
});
refresh();
