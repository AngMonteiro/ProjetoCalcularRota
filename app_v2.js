// ===================================================================
//  CONFIGURAÇÕES
// ===================================================================
// Photon (Komoot) — geocodificador gratuito, sem chave de API e sem bloqueio de CORS
const PHOTON_URL = 'https://photon.komoot.io/api';
// Bounding box aproximada do Brasil: minLon, minLat, maxLon, maxLat
const BRAZIL_BBOX = '-73.99,-33.75,-28.85,5.27';

// ===================================================================
//  UTILITÁRIOS
// ===================================================================
function debounce(func, delay) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
}

// ===================================================================
//  INICIALIZAÇÃO DO MAPA
// ===================================================================
const map = L.map('map').setView([-15.7801, -47.9292], 4);

const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
});

const darkMatterLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CartoDB</a>',
    subdomains: 'abcd',
    maxZoom: 19
}).addTo(map);

const esriSatelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri'
});

const baseLayers = {
    "dark": darkMatterLayer,
    "streets": osmLayer,
    "satellite": esriSatelliteLayer
};

// ===================================================================
//  LEAFLET ROUTING MACHINE
// ===================================================================
const routingControl = L.Routing.control({
    waypoints: [],
    routeWhileDragging: false,
    addWaypoints: false,
    language: 'pt',
    router: L.Routing.osrmv1({
        serviceUrl: 'https://router.project-osrm.org/route/v1',
        profile: 'driving'
    }),
    createMarker: function (i, waypoint, n) {
        let color, label;
        if (i === 0) {
            color = '%2322C55E'; label = 'A';
        } else if (i === n - 1) {
            color = '%23EF4444'; label = 'B';
        } else {
            color = '%233B82F6'; label = String(i);
        }
        const svgIcon = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><circle cx="18" cy="18" r="14" fill="${color}" stroke="%23fff" stroke-width="2.5"/><text x="18" y="23" font-size="13" font-weight="bold" fill="white" text-anchor="middle" font-family="Arial">${label}</text></svg>`;
        return L.marker(waypoint.latLng, {
            icon: L.icon({ iconUrl: svgIcon, iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -38] })
        });
    }
}).addTo(map);

routingControl.on('routesfound', function (e) {
    const summary = e.routes[0].summary;
    const distKm = (summary.totalDistance / 1000).toFixed(1);
    const h = Math.floor(summary.totalTime / 3600);
    const m = Math.round((summary.totalTime % 3600) / 60);
    const timeStr = h > 0 ? `${h}h ${m}min` : `${m}min`;

    document.getElementById('total-distance').textContent = `Distância: ${distKm} km`;
    document.getElementById('total-time').textContent = `Tempo Estimado: ${timeStr}`;

    const list = document.getElementById('instructions-list');
    list.innerHTML = '';
    e.routes[0].instructions.forEach(inst => {
        const li = document.createElement('li');
        li.innerHTML = inst.text;
        list.appendChild(li);
    });

    setStatus('');
});

routingControl.on('routingerror', function (e) {
    console.error('Erro de rota:', e.error);
    setStatus('❌ Não foi possível calcular a rota. Verifique os locais informados.', true);
});

// ===================================================================
//  CONTROLE DE CAMADAS
// ===================================================================
document.querySelectorAll('input[name="map-layer"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        Object.values(baseLayers).forEach(l => { if (map.hasLayer(l)) map.removeLayer(l); });
        baseLayers[e.target.value].addTo(map);
    });
});

// ===================================================================
//  PARADAS INTERMEDIÁRIAS
// ===================================================================
let stopCounter = 0;

document.getElementById('add-stop-btn').addEventListener('click', () => {
    stopCounter++;
    const stopId = `stop-${stopCounter}`;
    const container = document.getElementById('intermediate-stops-container');

    const div = document.createElement('div');
    div.classList.add('input-group');
    div.id = `group-${stopId}`;
    div.innerHTML = `
        <label for="${stopId}-input">Parada ${stopCounter}:</label>
        <input type="text" id="${stopId}-input" placeholder="Cidade, Estado ou endereço..." class="location-input" data-type="stop">
        <ul id="${stopId}-suggestions" class="autocomplete-suggestions"></ul>
        <button class="action-button remove-stop-btn" style="margin-top:8px;background:linear-gradient(90deg,#EF4444,#DC2626);">Remover Parada</button>
    `;
    container.appendChild(div);

    const input = div.querySelector('.location-input');
    const suggestions = div.querySelector('.autocomplete-suggestions');
    setupAutocomplete(input, suggestions);

    div.querySelector('.remove-stop-btn').addEventListener('click', () => {
        div.remove();
    });
});

// ===================================================================
//  AUTOCOMPLETE (Nominatim)
// ===================================================================
function setupAutocomplete(input, suggestionsList) {
    let isSelectingFromList = false;

    input.addEventListener('input', debounce(async (e) => {
        const q = e.target.value.trim();
        if (q.length < 3) { suggestionsList.innerHTML = ''; return; }

        // Detecta CEP
        if (/^\d{5}-?\d{3}$/.test(q)) {
            const result = await searchByCep(q.replace('-', ''));
            if (result) {
                setCoords(input, result.lat, result.lon, result.label);
                suggestionsList.innerHTML = '';
            }
            return;
        }

        const results = await nominatimSearch(q, 5);
        suggestionsList.innerHTML = '';
        results.forEach(item => {
            const li = document.createElement('li');
            li.textContent = item.display_name;

            // Usa mousedown para capturar antes do blur
            li.addEventListener('mousedown', (ev) => {
                ev.preventDefault(); // ← CHAVE: evita que o input perca o foco antes do clique
                isSelectingFromList = true;
                setCoords(input, item.lat, item.lon, item.display_name);
                suggestionsList.innerHTML = '';
                isSelectingFromList = false;
            });
            suggestionsList.appendChild(li);
        });
    }, 350));

    input.addEventListener('blur', () => {
        // Pequeno delay para não apagar antes do mousedown terminar
        setTimeout(() => { suggestionsList.innerHTML = ''; }, 200);
    });
}

// Configura os inputs fixos (origem e destino)
setupAutocomplete(
    document.getElementById('origin-input'),
    document.getElementById('origin-suggestions')
);
setupAutocomplete(
    document.getElementById('destination-input'),
    document.getElementById('destination-suggestions')
);

// ===================================================================
//  BOTÃO CALCULAR ROTA
// ===================================================================
document.getElementById('calc-route-btn').addEventListener('click', async () => {
    setStatus('🔍 Buscando locais e calculando rota...', false, true);

    const inputs = Array.from(document.querySelectorAll('.location-input'));
    const waypointLatLngs = [];

    for (const input of inputs) {
        const val = input.value.trim();
        if (!val) continue;

        // Se já tem coordenadas salvas, usa diretamente
        if (input.dataset.lat && input.dataset.lon) {
            waypointLatLngs.push(L.latLng(parseFloat(input.dataset.lat), parseFloat(input.dataset.lon)));
            continue;
        }

        // Caso contrário, geocodifica agora (permite busca por nome sem precisar clicar na sugestão)
        setStatus(`🔍 Geocodificando: "${val}"...`, false, true);

        // Tenta CEP primeiro
        if (/^\d{5}-?\d{3}$/.test(val)) {
            const r = await searchByCep(val.replace('-', ''));
            if (r) {
                setCoords(input, r.lat, r.lon, r.label);
                waypointLatLngs.push(L.latLng(parseFloat(r.lat), parseFloat(r.lon)));
                continue;
            }
        }

        // Busca por nome
        const results = await nominatimSearch(val, 1);
        if (results.length > 0) {
            const item = results[0];
            setCoords(input, item.lat, item.lon, item.display_name);
            waypointLatLngs.push(L.latLng(parseFloat(item.lat), parseFloat(item.lon)));
        } else {
            setStatus(`❌ Local não encontrado: "${val}". Tente um nome mais específico.`, true);
            return;
        }
    }

    if (waypointLatLngs.length < 2) {
        setStatus('⚠️ Preencha ao menos Origem e Destino.', true);
        return;
    }

    setStatus('🗺️ Calculando rota...', false, true);
    routingControl.setWaypoints(waypointLatLngs);
});

// ===================================================================
//  FUNÇÕES AUXILIARES
// ===================================================================
function setCoords(input, lat, lon, label) {
    input.dataset.lat = lat;
    input.dataset.lon = lon;
    input.value = label;
}

function setStatus(msg, isError = false, isLoading = false) {
    const el = document.getElementById('status-msg');
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? '#F87171' : isLoading ? '#60A5FA' : '#4ADE80';
    el.style.display = msg ? 'block' : 'none';
}

// Formata o nome de exibição a partir de uma feature do Photon
function formatPhotonName(feature) {
    const p = feature.properties;
    const parts = [];
    if (p.name)     parts.push(p.name);
    if (p.street)   parts.push(p.street);
    if (p.city)     parts.push(p.city);
    if (p.state)    parts.push(p.state);
    if (p.country)  parts.push(p.country);
    return parts.filter(Boolean).join(', ');
}

// Geocodificação via Photon (Komoot) — CORS-friendly, gratuito, sem API key
async function nominatimSearch(query, limit = 5) {
    const params = new URLSearchParams({
        q: query,
        limit,
        lang: 'pt',
        bbox: BRAZIL_BBOX
    });
    try {
        const res = await fetch(`${PHOTON_URL}?${params}`);
        const data = await res.json();
        // Normaliza para o formato { display_name, lat, lon } usado no restante do código
        return data.features.map(f => ({
            display_name: formatPhotonName(f),
            lat:  f.geometry.coordinates[1].toString(),
            lon:  f.geometry.coordinates[0].toString()
        }));
    } catch (err) {
        console.error('Photon geocoding error:', err);
        return [];
    }
}

async function searchByCep(cep) {
    try {
        const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        const data = await res.json();
        if (data.erro) return null;

        const addressStr = `${data.logradouro ? data.logradouro + ', ' : ''}${data.bairro ? data.bairro + ', ' : ''}${data.localidade} - ${data.uf}`;
        const results = await nominatimSearch(addressStr, 1);
        if (results.length > 0) {
            return { lat: results[0].lat, lon: results[0].lon, label: addressStr };
        }
    } catch (err) {
        console.error('CEP error:', err);
    }
    return null;
}
