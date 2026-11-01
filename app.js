/* ------------------------------------------------------------
   Weather app
   Data: Open-Meteo (https://open-meteo.com) - free, no API key needed.
------------------------------------------------------------ */
(() => {
    'use strict';

    const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
    const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

    /* ---------- Small helpers ---------- */
    const $ = (sel, root = document) => root.querySelector(sel);
    const el = (tag, cls, text) => {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text != null) node.textContent = text;
        return node;
    };
    const store = {
        get(key, fallback) {
            try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
            catch (e) { return fallback; }
        },
        set(key, value) {
            try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
        },
    };
    async function getJson(url) {
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
    }

    /* ---------- Weather codes (WMO) -> text, icons, theme ---------- */
    // [description, day icon, night icon]
    const CODES = {
        0: ['Clear sky', '☀️', '🌙'],
        1: ['Mainly clear', '🌤️', '🌙'],
        2: ['Partly cloudy', '⛅', '☁️'],
        3: ['Overcast', '☁️', '☁️'],
        45: ['Fog', '🌫️', '🌫️'],
        48: ['Freezing fog', '🌫️', '🌫️'],
        51: ['Light drizzle', '🌦️', '🌧️'],
        53: ['Drizzle', '🌦️', '🌧️'],
        55: ['Heavy drizzle', '🌧️', '🌧️'],
        56: ['Freezing drizzle', '🌧️', '🌧️'],
        57: ['Heavy freezing drizzle', '🌧️', '🌧️'],
        61: ['Light rain', '🌦️', '🌧️'],
        63: ['Rain', '🌧️', '🌧️'],
        65: ['Heavy rain', '🌧️', '🌧️'],
        66: ['Freezing rain', '🌧️', '🌧️'],
        67: ['Heavy freezing rain', '🌧️', '🌧️'],
        71: ['Light snow', '🌨️', '🌨️'],
        73: ['Snow', '❄️', '❄️'],
        75: ['Heavy snow', '❄️', '❄️'],
        77: ['Snow grains', '🌨️', '🌨️'],
        80: ['Light showers', '🌦️', '🌧️'],
        81: ['Showers', '🌧️', '🌧️'],
        82: ['Violent showers', '⛈️', '⛈️'],
        85: ['Snow showers', '🌨️', '🌨️'],
        86: ['Heavy snow showers', '❄️', '❄️'],
        95: ['Thunderstorm', '⛈️', '⛈️'],
        96: ['Thunderstorm with hail', '⛈️', '⛈️'],
        99: ['Severe thunderstorm with hail', '⛈️', '⛈️'],
    };

    function describe(code, isDay) {
        const c = CODES[code] || ['Unknown', '🌡️', '🌡️'];
        return { text: c[0], icon: isDay ? c[1] : c[2] };
    }

    function themeFor(code, isDay) {
        if (code >= 95) return 'storm';
        if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
        if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'rain';
        if (code === 45 || code === 48) return 'fog';
        if (code === 2 || code === 3) return isDay ? 'cloudy-day' : 'cloudy-night';
        return isDay ? 'clear-day' : 'clear-night';
    }

    /* ---------- State ---------- */
    const DEFAULTS = [
        { name: 'Amsterdam', region: 'North Holland', country: 'Netherlands', lat: 52.37, lon: 4.89 },
        { name: 'London', region: 'England', country: 'United Kingdom', lat: 51.51, lon: -0.13 },
        { name: 'New York', region: 'New York', country: 'United States', lat: 40.71, lon: -74.01 },
        { name: 'Tokyo', region: 'Tokyo', country: 'Japan', lat: 35.68, lon: 139.69 },
        { name: 'Sydney', region: 'New South Wales', country: 'Australia', lat: -33.87, lon: 151.21 },
    ];

    let units = store.get('units', 'metric');
    let recent = store.get('recent', []);
    let current = null;        // { loc, data } - the last weather that was loaded
    let requestId = 0;         // ignores slow responses that arrive late

    /* ---------- Elements ---------- */
    const cityInput = $('#cityInput');
    const suggestions = $('#suggestions');
    const statusEl = $('#status');
    const skeleton = $('#skeleton');
    const weatherEl = $('#weather');

    /* ---------- Status, loading and errors ---------- */
    function setStatus(message) {
        statusEl.className = 'status';
        statusEl.textContent = message || '';
    }

    function showError(message, retry) {
        statusEl.className = 'status error';
        statusEl.textContent = '';
        statusEl.append(el('span', null, message));
        if (retry) {
            const btn = el('button', null, 'Try again');
            btn.type = 'button';
            btn.addEventListener('click', retry);
            statusEl.append(btn);
        }
    }

    /* ---------- Formatting ---------- */
    const temp = (c) => Math.round(units === 'imperial' ? c * 9 / 5 + 32 : c);
    const speed = (kmh) => Math.round(units === 'imperial' ? kmh / 1.609 : kmh);
    const speedUnit = () => (units === 'imperial' ? 'mph' : 'km/h');
    const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const compass = (deg) => COMPASS[Math.round(deg / 22.5) % 16];

    function uvLabel(uv) {
        if (uv < 3) return 'Low';
        if (uv < 6) return 'Moderate';
        if (uv < 8) return 'High';
        if (uv < 11) return 'Very high';
        return 'Extreme';
    }

    function placeLabel(loc) {
        return [loc.region && loc.region !== loc.name ? loc.region : '', loc.country].filter(Boolean).join(', ');
    }

    function localTimeText(timezone) {
        const options = { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' };
        try { return new Date().toLocaleString(undefined, { ...options, timeZone: timezone }); }
        catch (e) { return new Date().toLocaleString(undefined, options); }
    }

    function dayName(isoDate, index) {
        if (index === 0) return 'Today';
        return new Date(isoDate + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
    }

    /* ---------- Rendering ---------- */
    function tile(label, valueNode) {
        const t = el('div', 'tile');
        t.append(el('div', 'tile-label', label));
        const v = el('div', 'tile-value');
        if (typeof valueNode === 'string') v.textContent = valueNode; else v.append(valueNode);
        t.append(v);
        return t;
    }

    function render() {
        if (!current) return;
        const { loc, data } = current;
        const cur = data.current;
        const daily = data.daily;
        const info = describe(cur.weather_code, cur.is_day);

        document.body.dataset.theme = themeFor(cur.weather_code, cur.is_day);
        // Allow the smooth colour fade from now on (not on the first paint)
        requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('ready')));
        document.title = `${temp(cur.temperature_2m)}° ${loc.name} — Weather`;

        // Main block
        $('#placeName').textContent = loc.name;
        $('#placeSub').textContent = loc.mine ? `Your location · ${data.timezone}` : placeLabel(loc);
        $('#localTime').textContent = `${localTimeText(data.timezone)} (local time)`;
        const icon = $('#icon');
        icon.textContent = info.icon;
        icon.setAttribute('aria-label', info.text);
        $('#temp').textContent = `${temp(cur.temperature_2m)}°`;
        $('#desc').textContent = info.text;
        $('#feels').textContent = `Feels like ${temp(cur.apparent_temperature)}° · High ${temp(daily.temperature_2m_max[0])}° · Low ${temp(daily.temperature_2m_min[0])}°`;

        // Detail tiles
        const tiles = $('#tiles');
        tiles.textContent = '';
        const arrow = el('span', 'arrow', '↑');
        arrow.style.transform = `rotate(${cur.wind_direction_10m + 180}deg)`;
        arrow.setAttribute('aria-hidden', 'true');
        const wind = el('span');
        wind.append(arrow, `${speed(cur.wind_speed_10m)} `, el('small', null, `${speedUnit()} ${compass(cur.wind_direction_10m)}`));
        const uv = daily.uv_index_max[0];
        tiles.append(
            tile('Humidity', `${cur.relative_humidity_2m}%`),
            tile('Wind', wind),
            tile('Chance of rain', `${daily.precipitation_probability_max[0] ?? 0}%`),
            tile('Pressure', `${Math.round(cur.pressure_msl)} hPa`),
            tile('UV index', uv == null ? '–' : `${Math.round(uv)} · ${uvLabel(uv)}`),
            tile('Sunrise', daily.sunrise[0].slice(11, 16)),
            tile('Sunset', daily.sunset[0].slice(11, 16)),
            tile('Local timezone', data.timezone.replace(/_/g, ' ')),
        );

        // Next 24 hours
        const hours = $('#hours');
        hours.textContent = '';
        const nowKey = cur.time.slice(0, 13) + ':00';
        let start = data.hourly.time.findIndex((t) => t >= nowKey);
        if (start < 0) start = 0;
        for (let i = start; i < Math.min(start + 24, data.hourly.time.length); i++) {
            const h = describe(data.hourly.weather_code[i], data.hourly.is_day[i]);
            const rain = data.hourly.precipitation_probability[i];
            const item = el('div', 'hour' + (i === start ? ' now-hour' : ''));
            item.append(
                el('div', 'hour-time', i === start ? 'Now' : data.hourly.time[i].slice(11, 16)),
                Object.assign(el('div', 'hour-icon', h.icon), { title: h.text }),
                el('div', 'hour-temp', `${temp(data.hourly.temperature_2m[i])}°`),
                el('div', 'hour-rain', rain >= 10 ? `${rain}%` : ''),
            );
            hours.append(item);
        }

        // 7-day forecast
        const days = $('#days');
        days.textContent = '';
        const lows = daily.temperature_2m_min;
        const highs = daily.temperature_2m_max;
        const weekLow = Math.min(...lows);
        const weekHigh = Math.max(...highs);
        const span = Math.max(1, weekHigh - weekLow);
        daily.time.forEach((date, i) => {
            const d = describe(daily.weather_code[i], 1);
            const track = el('div', 'track');
            const fill = el('i');
            fill.style.left = `${((lows[i] - weekLow) / span) * 100}%`;
            fill.style.width = `${Math.max(6, ((highs[i] - lows[i]) / span) * 100)}%`;
            track.append(fill);
            const range = el('div', 'range');
            range.append(el('span', 'lo', `${temp(lows[i])}°`), track, el('span', 'hi', `${temp(highs[i])}°`));
            const row = el('div', 'day');
            row.append(
                el('span', 'day-name', dayName(date, i)),
                Object.assign(el('span', 'day-icon', d.icon), { title: d.text }),
                el('span', 'day-rain', daily.precipitation_probability_max[i] >= 10 ? `${daily.precipitation_probability_max[i]}%` : ''),
                range,
            );
            days.append(row);
        });

        weatherEl.hidden = false;
    }

    /* ---------- Loading weather ---------- */
    async function fetchForecast(lat, lon) {
        const params = new URLSearchParams({
            latitude: lat,
            longitude: lon,
            timezone: 'auto',
            forecast_days: 7,
            current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,wind_direction_10m,pressure_msl',
            hourly: 'temperature_2m,precipitation_probability,weather_code,is_day',
            daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,uv_index_max',
        });
        return getJson(`${FORECAST_URL}?${params}`);
    }

    async function loadLocation(loc, { silent = false } = {}) {
        const id = ++requestId;
        if (!silent) {
            setStatus('');
            if (current) weatherEl.setAttribute('aria-busy', 'true');
            else skeleton.hidden = false;
        }
        try {
            const data = await fetchForecast(loc.lat, loc.lon);
            if (id !== requestId) return;               // a newer search replaced this one
            current = { loc, data };
            skeleton.hidden = true;
            weatherEl.removeAttribute('aria-busy');
            render();
            if (!silent) setStatus(`Showing the weather for ${loc.name}.`);
            if (!loc.mine) {
                store.set('last', loc);
                rememberRecent(loc);
            }
        } catch (err) {
            if (id !== requestId) return;
            skeleton.hidden = true;
            weatherEl.removeAttribute('aria-busy');
            if (!silent) showError("Couldn't reach the weather service. Check your connection and try again.", () => loadLocation(loc));
        }
    }

    /* ---------- Quick-pick chips ---------- */
    function rememberRecent(loc) {
        recent = [loc, ...recent.filter((r) => !(r.name === loc.name && r.lat === loc.lat))].slice(0, 5);
        store.set('recent', recent);
        renderChips();
    }

    function renderChips() {
        const chips = $('#chips');
        chips.textContent = '';
        const seen = new Set();
        [...recent, ...DEFAULTS].forEach((loc) => {
            const key = `${loc.name}|${loc.lat}`;
            if (seen.has(key) || seen.size >= 5) return;
            seen.add(key);
            const chip = el('button', 'chip', loc.name);
            chip.type = 'button';
            chip.addEventListener('click', () => loadLocation(loc));
            chips.append(chip);
        });
    }

    /* ---------- City search with suggestions ---------- */
    let results = [];
    let active = -1;
    let typingTimer = 0;
    let searchId = 0;

    async function searchCities(query) {
        const url = `${GEO_URL}?name=${encodeURIComponent(query)}&count=6&language=en&format=json`;
        const data = await getJson(url);
        return (data.results || []).map((r) => ({
            name: r.name, region: r.admin1 || '', country: r.country || '', lat: r.latitude, lon: r.longitude,
        }));
    }

    function hideSuggestions() {
        suggestions.hidden = true;
        suggestions.textContent = '';
        cityInput.setAttribute('aria-expanded', 'false');
        cityInput.removeAttribute('aria-activedescendant');
        active = -1;
    }

    function showSuggestions(list, message) {
        suggestions.textContent = '';
        if (message) {
            suggestions.append(Object.assign(el('li', 'empty', message), { role: 'presentation' }));
        } else {
            list.forEach((r, i) => {
                const li = el('li');
                li.id = `sug-${i}`;
                li.setAttribute('role', 'option');
                li.setAttribute('aria-selected', 'false');
                li.append(el('div', null, r.name), el('div', 'sub', placeLabel(r)));
                li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(r); });
                suggestions.append(li);
            });
        }
        suggestions.hidden = false;
        cityInput.setAttribute('aria-expanded', 'true');
        active = -1;
    }

    function highlight(index) {
        const items = [...suggestions.querySelectorAll('[role="option"]')];
        if (!items.length) return;
        active = (index + items.length) % items.length;
        items.forEach((item, i) => item.setAttribute('aria-selected', String(i === active)));
        cityInput.setAttribute('aria-activedescendant', items[active].id);
    }

    function choose(loc) {
        cityInput.value = '';
        hideSuggestions();
        loadLocation(loc);
    }

    async function submitSearch() {
        const query = cityInput.value.trim();
        if (active >= 0 && results[active]) return choose(results[active]);
        if (results.length) return choose(results[0]);
        if (!query) return;
        try {
            const found = await searchCities(query);
            if (!found.length) return showNotFound(query);
            choose(found[0]);
        } catch (err) {
            showError("Couldn't search right now. Check your connection and try again.", submitSearch);
        }
    }

    function showNotFound(query) {
        hideSuggestions();
        showError(`No city found for “${query}”. Check the spelling or try a bigger nearby city.`);
    }

    cityInput.addEventListener('input', () => {
        clearTimeout(typingTimer);
        const query = cityInput.value.trim();
        results = [];
        if (query.length < 2) return hideSuggestions();
        typingTimer = setTimeout(async () => {
            const id = ++searchId;
            try {
                const found = await searchCities(query);
                if (id !== searchId) return;
                results = found;
                if (found.length) showSuggestions(found);
                else showSuggestions([], `No city found for “${query}”`);
            } catch (err) {
                if (id === searchId) hideSuggestions();
            }
        }, 250);
    });

    cityInput.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); highlight(active + 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(active - 1); }
        else if (e.key === 'Enter') { e.preventDefault(); submitSearch(); }
        else if (e.key === 'Escape') { hideSuggestions(); }
    });
    cityInput.addEventListener('blur', () => setTimeout(hideSuggestions, 120));

    /* ---------- My location ---------- */
    $('#locateBtn').addEventListener('click', () => {
        if (!navigator.geolocation) return showError("Your browser doesn't support finding your location. Try searching for a city instead.");
        setStatus('Finding your location…');
        navigator.geolocation.getCurrentPosition(
            (pos) => loadLocation({ name: 'My location', region: '', country: '', lat: pos.coords.latitude, lon: pos.coords.longitude, mine: true }),
            (err) => showError(err.code === 1
                ? 'Location access was blocked. You can still search for a city.'
                : "Couldn't find your location. Try searching for a city instead."),
            { timeout: 10000, maximumAge: 600000 },
        );
    });

    /* ---------- Units ---------- */
    function syncUnitButtons() {
        document.querySelectorAll('.units button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.unit === units)));
    }
    document.querySelectorAll('.units button').forEach((b) => b.addEventListener('click', () => {
        units = b.dataset.unit;
        store.set('units', units);
        syncUnitButtons();
        render();                       // converts the numbers we already have
    }));

    /* ---------- Start ---------- */
    syncUnitButtons();
    renderChips();
    loadLocation(store.get('last', null) || DEFAULTS[0]);

    // Keep the weather fresh while the page is open and visible
    setInterval(() => {
        if (current && document.visibilityState === 'visible') loadLocation(current.loc, { silent: true });
    }, 15 * 60 * 1000);
})();
