/* =====================================================
   Langit - Cuaca Indonesia
   API cuaca  : https://open-meteo.com
   API gempa  : https://data.bmkg.go.id
   ===================================================== */

/* ==================== KONFIGURASI ==================== */
const API_FORECAST = 'https://api.open-meteo.com/v1/forecast';
const API_AIR      = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const API_GEO      = 'https://geocoding-api.open-meteo.com/v1/search';
const API_QUAKE    = 'https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json';
const QUAKE_IMG    = 'https://data.bmkg.go.id/DataMKG/TEWS/';

const DEFAULT_CITY = { name: 'Makassar, Sulawesi Selatan', lat: -5.1477, lon: 119.4327 };

const BIG_CITIES = [
  { name: 'Jakarta',  lat: -6.2088, lon: 106.8456 },
  { name: 'Surabaya', lat: -7.2575, lon: 112.7521 },
  { name: 'Bandung',  lat: -6.9175, lon: 107.6191 },
  { name: 'Medan',    lat: 3.5952,  lon: 98.6722 },
  { name: 'Makassar', lat: -5.1477, lon: 119.4327 }
];

const HOURLY_FIELDS = [
  'temperature_2m', 'apparent_temperature', 'precipitation_probability',
  'relative_humidity_2m', 'dew_point_2m', 'wind_speed_10m', 'wind_gusts_10m',
  'cloud_cover', 'visibility', 'uv_index', 'weather_code'
].join(',');

const DAILY_FIELDS = [
  'weather_code', 'temperature_2m_max', 'temperature_2m_min',
  'precipitation_probability_max', 'sunrise', 'sunset'
].join(',');

/* Kode cuaca WMO: [ikon, deskripsi] */
const WEATHER_CODES = {
  0:  ['☀️', 'Cerah'],
  1:  ['🌤️', 'Cerah berawan'],
  2:  ['⛅', 'Berawan'],
  3:  ['☁️', 'Mendung'],
  45: ['🌫️', 'Berkabut'],
  48: ['🌫️', 'Kabut'],
  51: ['🌦️', 'Gerimis ringan'],
  53: ['🌦️', 'Gerimis'],
  55: ['🌦️', 'Gerimis lebat'],
  61: ['🌧️', 'Hujan ringan'],
  63: ['🌧️', 'Hujan sedang'],
  65: ['🌧️', 'Hujan lebat'],
  80: ['🌦️', 'Hujan lokal'],
  81: ['🌧️', 'Hujan lokal sedang'],
  82: ['⛈️', 'Hujan lokal lebat'],
  95: ['⛈️', 'Badai petir'],
  96: ['⛈️', 'Petir dan es'],
  99: ['⛈️', 'Petir dan es lebat']
};

/* ==================== STATE ==================== */
let weather = null;        // data cuaca kota yang sedang dipilih
let hourIndexes = [];      // indeks 24 jam ke depan di dalam data hourly
let sunProgress = 0;       // posisi matahari terakhir (0-1)
let citiesTimer = null;

const $ = (sel) => document.querySelector(sel);
const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ==================== INISIALISASI ==================== */
document.addEventListener('DOMContentLoaded', () => {
  AOS.init({ duration: 700, once: true, offset: 80 });
  setupEventListeners();
  loadWeather(DEFAULT_CITY.name, DEFAULT_CITY.lat, DEFAULT_CITY.lon);
  loadCities();
  loadQuake();
  citiesTimer = setInterval(loadCities, 5 * 60 * 1000);
});

function setupEventListeners() {
  // Pencarian kota
  $('#searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    searchCity();
  });

  // Pilih jam
  $('#hoursStrip').addEventListener('click', (e) => {
    const btn = e.target.closest('.hour-btn');
    if (btn) selectHour(+btn.dataset.k);
  });

  // Pilih kota besar
  $('#cityList').addEventListener('click', (e) => {
    const btn = e.target.closest('.city-row');
    if (!btn) return;
    const city = BIG_CITIES[+btn.dataset.i];
    loadWeather(city.name, city.lat, city.lon);
    scrollToSection('#home');
  });

  // Perbarui kota besar secara manual
  $('#refreshCities').addEventListener('click', async () => {
    await loadCities();
    showToast('Data kota besar diperbarui!');
  });

  // Form kontak
  $('#contactForm').addEventListener('submit', handleContactSubmit);

  // Back to top + parallax
  const backBtn = $('#backToTop');
  window.addEventListener('scroll', () => {
    backBtn.style.display = window.scrollY > 400 ? 'flex' : 'none';
    applyParallax();
  }, { passive: true });
  backBtn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Smooth scroll untuk semua link anchor + tutup menu mobile
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', function (e) {
      const target = document.querySelector(this.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      scrollToSection(this.getAttribute('href'));
      const collapse = document.querySelector('.navbar-collapse');
      if (collapse.classList.contains('show')) {
        bootstrap.Collapse.getInstance(collapse)?.hide();
      }
    });
  });
}

/* ==================== HELPER UMUM ==================== */
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function weatherInfo(code) {
  return WEATHER_CODES[code] || ['🌡️', '—'];
}

function timeOnly(iso) {
  return iso.slice(11, 16);
}

function minutesOf(iso) {
  return +iso.slice(11, 13) * 60 + +iso.slice(14, 16);
}

function uvLabel(uv) {
  if (uv < 3)  return 'Rendah';
  if (uv < 6)  return 'Sedang';
  if (uv < 8)  return 'Tinggi';
  if (uv < 11) return 'Sangat tinggi';
  return 'Ekstrem';
}

function aqiLabel(aqi) {
  if (aqi <= 50)  return 'Baik';
  if (aqi <= 100) return 'Sedang';
  if (aqi <= 150) return 'Tidak sehat bagi kelompok sensitif';
  if (aqi <= 200) return 'Tidak sehat';
  return 'Sangat tidak sehat';
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function scrollToSection(selector) {
  const target = document.querySelector(selector);
  if (!target) return;
  const top = target.getBoundingClientRect().top + window.scrollY - 60;
  window.scrollTo({ top: selector === '#home' ? 0 : top, behavior: 'smooth' });
}

function showToast(msg, type = 'success') {
  const toastEl = $('#liveToast');
  toastEl.classList.remove('text-bg-success', 'text-bg-danger');
  toastEl.classList.add(type === 'error' ? 'text-bg-danger' : 'text-bg-success');
  $('#toastMessage').textContent = msg;
  new bootstrap.Toast(toastEl, { delay: 3000 }).show();
}

/* ==================== TEMA LANGIT (ikut waktu setempat) ==================== */
function applySkyTheme(hour, weatherCode) {
  let palette;
  if (hour < 5 || hour >= 19)  palette = ['#050b1f', '#0e1f4d', '#2b2a6b', '#050b1f']; // malam
  else if (hour < 7)           palette = ['#1a1f4a', '#7a4a8c', '#f29e7d', '#161a3f']; // fajar
  else if (hour < 16)          palette = ['#0b4f82', '#2c86b8', '#9fd0dc', '#0a3a60']; // siang
  else                         palette = ['#1c2b5a', '#b5543f', '#ffb15c', '#1c2547']; // senja

  // Hujan di siang hari: langit abu-abu
  if (weatherCode >= 51 && hour >= 5 && hour < 19) {
    palette = ['#26343f', '#4a6070', '#8a9ba5', '#1f2b34'];
  }

  const root = document.documentElement.style;
  ['--s1', '--s2', '--s3', '--ink'].forEach((key, i) => root.setProperty(key, palette[i]));
}

/* ==================== CUACA UTAMA ==================== */
async function loadWeather(name, lat, lon) {
  $('#searchMsg').textContent = '';
  try {
    const url = `${API_FORECAST}?latitude=${lat}&longitude=${lon}`
      + `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code`
      + `&hourly=${HOURLY_FIELDS}&daily=${DAILY_FIELDS}&forecast_days=5&timezone=auto`;
    weather = await fetchJSON(url);
    weather.name = name;

    // Kualitas udara bersifat opsional
    weather.aqi = null;
    try {
      const air = await fetchJSON(`${API_AIR}?latitude=${lat}&longitude=${lon}&current=us_aqi`);
      weather.aqi = air.current.us_aqi;
    } catch (err) {
      console.warn('Data kualitas udara tidak tersedia', err);
    }

    renderAll();
  } catch (err) {
    console.error('API Error:', err);
    $('#searchMsg').textContent = 'Data belum bisa dimuat. Periksa koneksi internet, lalu coba lagi.';
  }
}

function renderAll() {
  renderCurrent();
  renderHourly();
  renderDaily();
}

/* ==================== RENDER: SEKARANG ==================== */
function renderCurrent() {
  const c = weather.current;
  const [icon, text] = weatherInfo(c.weather_code);
  const hour = +c.time.slice(11, 13);

  applySkyTheme(hour, c.weather_code);

  $('#placeName').textContent = weather.name;
  $('#tempNow').innerHTML = `${Math.round(c.temperature_2m)}<sup>°</sup>`;
  $('#condNow').textContent = `${icon} ${text}`;

  const idx = Math.max(0, weather.hourly.time.indexOf(c.time.slice(0, 13) + ':00'));
  const uv = weather.hourly.uv_index[idx] ?? 0;

  const chips = [
    `Terasa ${Math.round(c.apparent_temperature)}°`,
    `Kelembapan ${c.relative_humidity_2m}%`,
    `Angin ${Math.round(c.wind_speed_10m)} km/j`,
    `UV ${uv} (${uvLabel(uv)})`
  ];
  if (weather.aqi !== null) {
    chips.push(`Udara ${Math.round(weather.aqi)}: ${aqiLabel(weather.aqi)}`);
  }
  $('#chips').innerHTML = chips.map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join('');

  renderSun(c.time);
}

function renderSun(nowIso) {
  const rise = weather.daily.sunrise[0];
  const set = weather.daily.sunset[0];
  const now = minutesOf(nowIso), a = minutesOf(rise), b = minutesOf(set);
  const progress = Math.min(1, Math.max(0, (now - a) / (b - a)));
  const isNight = now < a || now > b;

  $('#sunrise').textContent = 'Terbit ' + timeOnly(rise);
  $('#sunset').textContent = 'Terbenam ' + timeOnly(set);
  $('#sunNote').textContent = isNight ? 'Matahari sudah terbenam, langit malam' : 'Matahari sedang di langit';
  $('#sunDot').setAttribute('fill', isNight ? '#cfd8ff' : '#ffd66b');

  animateSun(progress);
}

function animateSun(target) {
  const dot = $('#sunDot');
  const from = sunProgress;
  const duration = prefersReducedMotion() ? 0 : 1600;
  const start = performance.now();

  function step(t) {
    let k = duration ? Math.min(1, (t - start) / duration) : 1;
    k = 1 - Math.pow(1 - k, 3); // ease-out
    const f = from + (target - from) * k;
    const angle = Math.PI * f;
    dot.setAttribute('cx', 200 - 180 * Math.cos(angle));
    dot.setAttribute('cy', 190 - 180 * Math.sin(angle));
    if (k < 1) requestAnimationFrame(step);
    else sunProgress = target;
  }
  requestAnimationFrame(step);
}

/* ==================== RENDER: PER JAM ==================== */
function renderHourly() {
  const H = weather.hourly;
  const start = Math.max(0, H.time.indexOf(weather.current.time.slice(0, 13) + ':00'));
  hourIndexes = [...Array(24).keys()].map((k) => start + k).filter((i) => i < H.time.length);

  // Kurva suhu
  const temps = hourIndexes.map((i) => H.temperature_2m[i]);
  const min = Math.min(...temps), max = Math.max(...temps);
  const y = (v) => 78 - ((v - min) / ((max - min) || 1)) * 56;
  const points = temps.map((v, k) => [k * 76 + 38, y(v)]);

  let path = `M${points[0][0]} ${points[0][1]}`;
  for (let k = 1; k < points.length; k++) {
    const [x0, y0] = points[k - 1];
    const [x1, y1] = points[k];
    const mid = (x0 + x1) / 2;
    path += ` C${mid} ${y0} ${mid} ${y1} ${x1} ${y1}`;
  }
  const last = points[points.length - 1];

  $('#tempCurve').innerHTML = `
    <defs>
      <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffd66b" stop-opacity=".35"/>
        <stop offset="1" stop-color="#ffd66b" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${path} L${last[0]} 100 L${points[0][0]} 100Z" fill="url(#curveFill)"/>
    <path d="${path}" fill="none" stroke="#ffd66b" stroke-width="3" stroke-linecap="round"/>
    ${points.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="#ffd66b"/>`).join('')}`;

  // Tombol per jam
  $('#hoursStrip').innerHTML = hourIndexes.map((i, k) => `
    <button class="hour-btn" data-k="${k}">
      <small>${k ? timeOnly(H.time[i]) : 'Kini'}</small>
      <span class="icon">${weatherInfo(H.weather_code[i])[0]}</span>
      <b>${Math.round(H.temperature_2m[i])}°</b>
      <small>💧${H.precipitation_probability[i] ?? 0}%</small>
    </button>`).join('');

  selectHour(0);
}

function selectHour(k) {
  const H = weather.hourly;
  const i = hourIndexes[k];

  document.querySelectorAll('.hour-btn').forEach((btn, j) => {
    btn.classList.toggle('selected', j === k);
  });

  $('#hourLabel').textContent =
    `${weather.name} · pukul ${timeOnly(H.time[i])} · ${weatherInfo(H.weather_code[i])[1]}`;

  const uv = H.uv_index[i] ?? 0;
  const rows = [
    ['Terasa seperti', `${Math.round(H.apparent_temperature[i])}°C`],
    ['Peluang hujan',  `${H.precipitation_probability[i] ?? 0}%`],
    ['Kelembapan',     `${H.relative_humidity_2m[i]}%`],
    ['Angin',          `${Math.round(H.wind_speed_10m[i])} km/j`],
    ['Embusan',        `${Math.round(H.wind_gusts_10m[i])} km/j`],
    ['Indeks UV',      `${uv.toFixed(1)} · ${uvLabel(uv)}`],
    ['Tutupan awan',   `${H.cloud_cover[i]}%`],
    ['Jarak pandang',  `${(H.visibility[i] / 1000).toFixed(1)} km`]
  ];

  $('#hourDetail').innerHTML = rows.map(([label, value]) => `
    <div class="col-6 col-md-3">
      <div class="detail-box">
        <span>${label}</span>
        <b>${escapeHtml(value)}</b>
      </div>
    </div>`).join('');
}

/* ==================== RENDER: 5 HARI ==================== */
function renderDaily() {
  const d = weather.daily;
  const lo = Math.min(...d.temperature_2m_min);
  const hi = Math.max(...d.temperature_2m_max);
  const span = (hi - lo) || 1;

  $('#dailySub').textContent = `Rentang suhu terendah sampai tertinggi di ${weather.name}.`;

  $('#dailyList').innerHTML = d.time.map((date, i) => {
    const left = ((d.temperature_2m_min[i] - lo) / span) * 100;
    const width = ((d.temperature_2m_max[i] - d.temperature_2m_min[i]) / span) * 100;
    const label = i === 0
      ? 'Hari ini'
      : new Date(date + 'T12:00').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short' });
    const [icon, text] = weatherInfo(d.weather_code[i]);

    return `
      <div class="day-row">
        <div>
          <b>${label}</b>
          <div class="text-muted-soft small">${text} · hujan ${d.precipitation_probability_max[i] ?? 0}%</div>
        </div>
        <div style="font-size:1.8rem">${icon}</div>
        <div class="range-bar"><i style="left:${left}%;width:${Math.max(width, 6)}%"></i></div>
        <div class="day-temps">${Math.round(d.temperature_2m_min[i])}°<span>${Math.round(d.temperature_2m_max[i])}°</span></div>
      </div>`;
  }).join('');
}

/* ==================== PENCARIAN KOTA ==================== */
async function searchCity() {
  const query = $('#searchInput').value.trim();
  const msg = $('#searchMsg');

  if (!query) {
    msg.textContent = 'Ketik nama kota dulu, mis. Makassar.';
    return;
  }

  msg.textContent = 'Mencari…';
  try {
    const geo = await fetchJSON(`${API_GEO}?name=${encodeURIComponent(query)}&count=1&language=id`);
    if (!geo.results) {
      msg.textContent = 'Kota tidak ditemukan. Coba nama yang lebih umum.';
      return;
    }
    const p = geo.results[0];
    const fullName = [p.name, p.admin1, p.country].filter(Boolean).join(', ');
    await loadWeather(fullName, p.latitude, p.longitude);
    scrollToSection('#home');
  } catch (err) {
    console.error('Geocoding Error:', err);
    msg.textContent = 'Pencarian gagal. Periksa koneksi internet.';
  }
}

/* ==================== 5 KOTA BESAR ==================== */
async function loadCities() {
  const container = $('#cityList');
  try {
    const results = await Promise.all(BIG_CITIES.map((c) =>
      fetchJSON(`${API_FORECAST}?latitude=${c.lat}&longitude=${c.lon}`
        + `&current=temperature_2m,weather_code&daily=precipitation_probability_max&forecast_days=1&timezone=auto`)
    ));

    container.innerHTML = results.map((data, i) => {
      const temp = data.current.temperature_2m;
      const bar = Math.min(100, Math.max(0, ((temp - 22) / 14) * 100));
      const [icon, text] = weatherInfo(data.current.weather_code);
      const rain = data.daily.precipitation_probability_max[0] ?? 0;

      return `
        <button class="city-row" data-i="${i}">
          <div>
            <h3>${BIG_CITIES[i].name}</h3>
            <span class="text-muted-soft">${text} · hujan ${rain}%</span>
          </div>
          <div style="font-size:2rem">${icon}</div>
          <div class="city-bar"><i style="width:${bar}%"></i></div>
          <div class="city-temp">${Math.round(temp)}°</div>
        </button>`;
    }).join('');

    $('#citiesUpdated').textContent = 'Terakhir: '
      + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  } catch (err) {
    console.error('API Error:', err);
    container.innerHTML = '<p class="text-muted-soft">Data kota belum bisa dimuat. Periksa koneksi internet.</p>';
  }
}

/* ==================== GEMPA TERKINI ==================== */
async function loadQuake() {
  try {
    const json = await fetchJSON(API_QUAKE);
    const g = json.Infogempa.gempa;

    $('#quakeMag').textContent = g.Magnitude;
    $('#quakeBody').innerHTML = `
      <h3 class="h4 fw-normal">${escapeHtml(g.Wilayah)}</h3>
      <p class="mb-1 text-muted-soft">${escapeHtml(g.Tanggal)}, ${escapeHtml(g.Jam)} · kedalaman ${escapeHtml(g.Kedalaman)}</p>
      <p class="text-muted-soft">${escapeHtml(g.Potensi)}</p>
      <img class="quake-img" src="${QUAKE_IMG}${encodeURI(g.Shakemap)}" alt="Peta guncangan gempa" onerror="this.remove()">`;
  } catch (err) {
    console.error('API Error:', err);
    $('#quakeBody').innerHTML = '<span class="text-muted-soft">Data gempa belum bisa dimuat saat ini.</span>';
  }
}

/* ==================== PARALLAX ==================== */
function applyParallax() {
  if (prefersReducedMotion() || window.scrollY > window.innerHeight * 1.3) return;
  document.querySelectorAll('[data-speed]').forEach((el) => {
    el.style.transform = `translateY(${window.scrollY * el.dataset.speed}px)`;
  });
}

/* ==================== FORM KONTAK ==================== */
function handleContactSubmit(e) {
  e.preventDefault();
  const msg = $('#formMsg');
  const name = $('#contactName').value.trim();
  const email = $('#contactEmail').value.trim();
  const text = $('#contactMessage').value.trim();

  msg.className = 'mb-2 text-danger-emphasis';

  if (!name || !email || !text) {
    msg.textContent = 'Isi nama, email, dan pesan.';
    return;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    msg.textContent = 'Format email belum benar, contoh: nama@email.com.';
    return;
  }

  msg.textContent = '';
  showToast(`Terima kasih, ${name}. Pesanmu sudah terkirim.`);
  e.target.reset();
}