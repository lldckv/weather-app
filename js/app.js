"use strict";

const GEO_API_KEY = "AIzaSyB8nVjP9CBNSCIFYvS0U7QTI-BedKl4CD0"

const CITY_API_BASE = "https://places.googleapis.com/v1/places:searchText";
const FORECAST_API_BASE = "https://api.open-meteo.com/v1/forecast";
const STORAGE_KEY = "weatherApp:v1";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LEN = 2;

function uid() {
  return (
    "id_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8)
  );
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

function formatDayLabel(dateStr, index) {
  if (index === 0) return "Сегодня";
  const d = new Date(dateStr);
  return WEEKDAYS[d.getDay()];
}

// Сопоставление кодов погоды WMO (используются Open-Meteo) с иконкой и описанием
function decodeWeatherCode(code) {
  const map = {
    0: { icon: "☀️", text: "Ясно" },
    1: { icon: "🌤️", text: "Преимущественно ясно" },
    2: { icon: "⛅", text: "Переменная облачность" },
    3: { icon: "☁️", text: "Облачно" },
    45: { icon: "🌫️", text: "Туман" },
    48: { icon: "🌫️", text: "Туман с изморозью" },
    51: { icon: "🌦️", text: "Лёгкая морось" },
    53: { icon: "🌦️", text: "Морось" },
    55: { icon: "🌧️", text: "Сильная морось" },
    56: { icon: "🌧️", text: "Ледяная морось" },
    57: { icon: "🌧️", text: "Сильная ледяная морось" },
    61: { icon: "🌧️", text: "Небольшой дождь" },
    63: { icon: "🌧️", text: "Дождь" },
    65: { icon: "🌧️", text: "Сильный дождь" },
    66: { icon: "🌧️", text: "Ледяной дождь" },
    67: { icon: "🌧️", text: "Сильный ледяной дождь" },
    71: { icon: "❄️", text: "Небольшой снег" },
    73: { icon: "❄️", text: "Снег" },
    75: { icon: "❄️", text: "Сильный снег" },
    77: { icon: "❄️", text: "Снежные зёрна" },
    80: { icon: "🌦️", text: "Небольшие ливни" },
    81: { icon: "🌧️", text: "Ливни" },
    82: { icon: "🌧️", text: "Сильные ливни" },
    85: { icon: "🌨️", text: "Снежные ливни" },
    86: { icon: "🌨️", text: "Сильные снежные ливни" },
    95: { icon: "⛈️", text: "Гроза" },
    96: { icon: "⛈️", text: "Гроза с градом" },
    99: { icon: "⛈️", text: "Сильная гроза с градом" },
  };
  return map[code] || { icon: "🌡️", text: "Нет данных" };
}

/* =========================================================
   Хранилище состояния (localStorage)
   ========================================================= */
const Store = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { primary: null, cities: [] };
      const parsed = JSON.parse(raw);
      return {
        primary: parsed.primary || null,
        cities: Array.isArray(parsed.cities) ? parsed.cities : [],
      };
    } catch (e) {
      console.error("Не удалось прочитать localStorage", e);
      return { primary: null, cities: [] };
    }
  },
  save(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error("Не удалось сохранить в localStorage", e);
    }
  },
};

let state = Store.load();

function persist() {
  Store.save(state);
}

/* =========================================================
   DOM ссылки
   ========================================================= */
const citiesContainer = document.getElementById("citiesContainer");
const emptyState = document.getElementById("emptyState");
const refreshBtn = document.getElementById("refreshBtn");
const addCityBtn = document.getElementById("addCityBtn");

const onboardingModal = document.getElementById("onboardingModal");
const onboardingForm = document.getElementById("onboardingForm");
const onboardingInput = document.getElementById("onboardingInput");
const onboardingDropdown = document.getElementById("onboardingDropdown");
const onboardingError = document.getElementById("onboardingError");

const addCityModal = document.getElementById("addCityModal");
const addCityForm = document.getElementById("addCityForm");
const cityInput = document.getElementById("cityInput");
const cityDropdown = document.getElementById("cityDropdown");
const cityError = document.getElementById("cityError");
const modalOverlay = document.getElementById("modalOverlay");
const modalCloseBtn = document.getElementById("modalCloseBtn");

const cardTemplate = document.getElementById("weatherCardTemplate");
const forecastDayTemplate = document.getElementById("forecastDayTemplate");

/* =========================================================
   Поиск городов через Google Places API (New) — Text Search
   ========================================================= */

/**
 * Приводит один результат Google Places к единому формату,
 * который использует остальной код приложения:
 * { name, country, lat, lon }
 */
function normalizePlace(place) {
  const name = place.displayName?.text || "";
  const address = place.formattedAddress || "";
  // Страна — как правило, последний сегмент адреса через запятую
  // (например: "Coventry, Уэст-Мидлендс, Великобритания" -> "Великобритания")
  const parts = address
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const country = parts.length > 1 ? parts[parts.length - 1] : "";

  return {
    name,
    country,
    lat: place.location.latitude,
    lon: place.location.longitude,
  };
}

/**
 * Ищет населённые пункты по названию (на русском или английском).
 * Возвращает массив уже нормализованных объектов { name, country, lat, lon }.
 */
async function searchPlaces(query) {
  const isRussian = /[а-яё]/i.test(query);
  const languageCode = isRussian ? "ru" : "en";

  try {
    const response = await fetch(CITY_API_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GEO_API_KEY,
        // formattedAddress нужен, чтобы вытащить страну для подсказки/подписи
        "X-Goog-FieldMask": "places.displayName,places.location,places.formattedAddress",
      },
      body: JSON.stringify({
        textQuery: query,
        languageCode,
        // Ограничиваем поиск населёнными пунктами, чтобы не получать
        // рестораны/магазины с похожим названием
        includedType: "locality",
      }),
    });

    if (!response.ok) {
      console.error(`Places API error: ${response.status} ${response.statusText}`);
      return [];
    }

    const data = await response.json();
    if (!Array.isArray(data.places)) return [];

    return data.places
      .filter((p) => p.location && p.displayName)
      .map((p) => normalizePlace(p));
  } catch (error) {
    console.error("Places API fetch error:", error);
    return [];
  }
}

/* =========================================================
   Работа с API погоды (Open-Meteo)
   ========================================================= */
async function fetchWeatherByCoords(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current_weather: "true",
    daily: "weathercode,temperature_2m_max,temperature_2m_min",
    timezone: "auto",
  });
  const res = await fetch(`${FORECAST_API_BASE}?${params.toString()}`);
  if (!res.ok) throw new Error("Не удалось получить прогноз погоды");
  const data = await res.json();
  return normalizeWeather(data);
}

function normalizeWeather(data) {
  const current = data.current_weather;
  const daily = data.daily;
  const days = daily.time.slice(0, 3).map((date, i) => ({
    date,
    label: formatDayLabel(date, i),
    max: Math.round(daily.temperature_2m_max[i]),
    min: Math.round(daily.temperature_2m_min[i]),
    code: daily.weathercode[i],
  }));
  return {
    temp: Math.round(current.temperature),
    code: current.weathercode,
    days,
  };
}

/* =========================================================
   Рендеринг карточек
   ========================================================= */
function getAllLocations() {
  const list = [];
  if (state.primary) list.push(state.primary);
  list.push(...state.cities);
  return list;
}

function renderAll() {
  citiesContainer.innerHTML = "";
  const locations = getAllLocations();
  emptyState.hidden = locations.length > 0;
  locations.forEach((loc) => renderCard(loc));
  locations.forEach((loc) => loadWeatherForCard(loc));
}

function renderCard(loc) {
  const node = cardTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.id = loc.id;
  node.querySelector(".weather-card__title").textContent = loc.label || loc.name;
  node.querySelector(".weather-card__subtitle").textContent =
    loc.source === "geo" ? "Текущее местоположение" : loc.country ? `Город, ${loc.country}` : "Город";

  const removeBtn = node.querySelector(".weather-card__remove");
  if (loc.isPrimary) {
    removeBtn.hidden = true;
  } else {
    removeBtn.hidden = false;
    removeBtn.addEventListener("click", () => removeCity(loc.id));
  }

  node.querySelector(".weather-card__retry").addEventListener("click", () => loadWeatherForCard(loc));

  citiesContainer.appendChild(node);
}

function getCardEl(id) {
  return citiesContainer.querySelector(`[data-id="${id}"]`);
}

function setCardState(id, mode) {
  const card = getCardEl(id);
  if (!card) return;
  card.querySelector(".weather-card__loading").hidden = mode !== "loading";
  card.querySelector(".weather-card__error").hidden = mode !== "error";
  card.querySelector(".weather-card__content").hidden = mode !== "success";
}

async function loadWeatherForCard(loc) {
  const card = getCardEl(loc.id);
  if (!card) return;
  setCardState(loc.id, "loading");
  try {
    const weather = await fetchWeatherByCoords(loc.lat, loc.lon);
    fillCardContent(loc.id, weather);
    setCardState(loc.id, "success");
  } catch (err) {
    console.error(err);
    const errBox = card.querySelector(".weather-card__error-text");
    errBox.textContent = "Не удалось загрузить прогноз погоды. Проверьте подключение к интернету.";
    setCardState(loc.id, "error");
  }
}

function fillCardContent(id, weather) {
  const card = getCardEl(id);
  if (!card) return;
  const decoded = decodeWeatherCode(weather.code);
  card.querySelector(".weather-card__icon").textContent = decoded.icon;
  card.querySelector(".weather-card__temp").textContent = `${weather.temp}°C`;
  card.querySelector(".weather-card__desc").textContent = decoded.text;

  const forecastEl = card.querySelector(".weather-card__forecast");
  forecastEl.innerHTML = "";
  weather.days.forEach((day) => {
    const dayNode = forecastDayTemplate.content.firstElementChild.cloneNode(true);
    const dDecoded = decodeWeatherCode(day.code);
    dayNode.querySelector(".forecast-day__label").textContent = day.label;
    dayNode.querySelector(".forecast-day__icon").textContent = dDecoded.icon;
    dayNode.querySelector(".forecast-day__max").textContent = `${day.max}°`;
    dayNode.querySelector(".forecast-day__min").textContent = `${day.min}°`;
    forecastEl.appendChild(dayNode);
  });
}

function refreshAll() {
  refreshBtn.classList.add("is-spinning");
  refreshBtn.disabled = true;
  const locations = getAllLocations();
  Promise.allSettled(locations.map((loc) => loadWeatherForCard(loc))).finally(() => {
    refreshBtn.classList.remove("is-spinning");
    refreshBtn.disabled = false;
  });
}

/* =========================================================
   Управление городами (добавление/удаление)
   ========================================================= */
function addCity(cityRecord) {
  const newCity = {
    id: uid(),
    name: cityRecord.name,
    country: cityRecord.country,
    lat: cityRecord.lat,
    lon: cityRecord.lon,
    label: cityRecord.country ? `${cityRecord.name}` : cityRecord.name,
    source: "manual",
    isPrimary: false,
  };
  state.cities.push(newCity);
  persist();
  renderCard(newCity);
  loadWeatherForCard(newCity);
}

function removeCity(id) {
  state.cities = state.cities.filter((c) => c.id !== id);
  persist();
  const card = getCardEl(id);
  if (card) card.remove();
  emptyState.hidden = getAllLocations().length > 0;
}

function setPrimaryFromGeo(lat, lon) {
  state.primary = {
    id: "primary",
    label: "Текущее местоположение",
    lat,
    lon,
    source: "geo",
    isPrimary: true,
  };
  persist();
}

function setPrimaryFromManualCity(cityRecord) {
  state.primary = {
    id: "primary",
    label: cityRecord.name,
    country: cityRecord.country,
    lat: cityRecord.lat,
    lon: cityRecord.lon,
    source: "manual",
    isPrimary: true,
  };
  persist();
}

/* =========================================================
   Выпадающий список подсказок городов (переиспользуемый)
   ========================================================= */
function setupCityAutocomplete({ input, dropdown, errorBox, onSelect }) {
  let selected = null;
  let results = [];

  function clearError() {
    errorBox.hidden = true;
    errorBox.textContent = "";
    input.classList.remove("is-invalid");
  }

  function showError(msg) {
    errorBox.hidden = false;
    errorBox.textContent = msg;
    input.classList.add("is-invalid");
  }

  function hideDropdown() {
    dropdown.hidden = true;
    dropdown.innerHTML = "";
  }

  function renderDropdown(items) {
    dropdown.innerHTML = "";
    if (!items.length) {
      hideDropdown();
      return;
    }
    items.forEach((item) => {
      const el = document.createElement("div");
      el.className = "city-form__dropdown-item";
      el.innerHTML = `<span>${item.name}</span><span>${item.country || ""}</span>`;
      el.addEventListener("click", () => {
        selected = item;
        input.value = item.country ? `${item.name}, ${item.country}` : item.name;
        clearError();
        hideDropdown();
      });
      dropdown.appendChild(el);
    });
    dropdown.hidden = false;
  }

  const debouncedSearch = debounce(async (query) => {
    try {
      results = await searchPlaces(query);
      renderDropdown(results);
    } catch (e) {
      console.error(e);
      hideDropdown();
    }
  }, DEBOUNCE_MS);

  input.addEventListener("input", () => {
    selected = null;
    clearError();
    const value = input.value.trim();
    if (value.length < MIN_QUERY_LEN) {
      hideDropdown();
      return;
    }
    debouncedSearch(value);
  });

  document.addEventListener("click", (e) => {
    if (!dropdown.contains(e.target) && e.target !== input) {
      hideDropdown();
    }
  });

  async function resolveAndSubmit() {
    const value = input.value.trim();
    if (!value) {
      showError("Введите название города.");
      return;
    }
    if (selected) {
      clearError();
      onSelect(selected);
      return;
    }
    // Пользователь не выбрал город из списка — пробуем найти точное совпадение
    try {
      const matches = await searchPlaces(value);
      const exact = matches.find((c) => c.name.toLowerCase() === value.toLowerCase());
      if (exact) {
        clearError();
        onSelect(exact);
      } else {
        showError("Город не найден. Выберите вариант из списка подсказок.");
      }
    } catch (e) {
      console.error(e);
      showError("Сервис поиска городов недоступен. Попробуйте позже.");
    }
  }

  return {
    resolveAndSubmit,
    reset: () => {
      selected = null;
      clearError();
      hideDropdown();
      input.value = "";
    },
  };
}

const addCityAutocomplete = setupCityAutocomplete({
  input: cityInput,
  dropdown: cityDropdown,
  errorBox: cityError,
  onSelect: (city) => {
    addCity(city);
    closeAddCityModal();
  },
});

const onboardingAutocomplete = setupCityAutocomplete({
  input: onboardingInput,
  dropdown: onboardingDropdown,
  errorBox: onboardingError,
  onSelect: (city) => {
    setPrimaryFromManualCity(city);
    closeOnboardingModal();
    renderAll();
  },
});

/* =========================================================
   Модальные окна
   ========================================================= */
function openAddCityModal() {
  addCityAutocomplete.reset();
  addCityModal.hidden = false;
  setTimeout(() => cityInput.focus(), 0);
}
function closeAddCityModal() {
  addCityModal.hidden = true;
}

function openOnboardingModal() {
  onboardingModal.hidden = false;
  setTimeout(() => onboardingInput.focus(), 0);
}
function closeOnboardingModal() {
  onboardingModal.hidden = true;
}

addCityBtn.addEventListener("click", openAddCityModal);
modalCloseBtn.addEventListener("click", closeAddCityModal);
modalOverlay.addEventListener("click", closeAddCityModal);

addCityForm.addEventListener("submit", (e) => {
  e.preventDefault();
  addCityAutocomplete.resolveAndSubmit();
});

onboardingForm.addEventListener("submit", (e) => {
  e.preventDefault();
  onboardingAutocomplete.resolveAndSubmit();
});

refreshBtn.addEventListener("click", refreshAll);

/* =========================================================
   Инициализация приложения
   ========================================================= */
function init() {
  if (state.primary) {
    // Данные уже сохранены — просто отображаем и запрашиваем погоду заново
    renderAll();
    return;
  }

  // Нет сохранённых данных — пытаемся получить геолокацию
  if (!("geolocation" in navigator)) {
    openOnboardingModal();
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      setPrimaryFromGeo(position.coords.latitude, position.coords.longitude);
      renderAll();
    },
    () => {
      // Доступ отклонён или недоступен — просим ввести город вручную
      openOnboardingModal();
    },
    { timeout: 10000 }
  );
}

init();