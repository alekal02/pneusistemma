/**
 * Diagrama do compactador — vista de cima (planta)
 * Cada pneu é um retângulo separado e clicável
 */

const STATUS_CORES = {
  ok: { fill: '#22c55e', stroke: '#15803d', bg: '#dcfce7' },
  alerta: { fill: '#f59e0b', stroke: '#b45309', bg: '#fef3c7' },
  critico: { fill: '#ef4444', stroke: '#b91c1c', bg: '#fee2e2' },
  sem_dado: { fill: '#64748b', stroke: '#475569', bg: '#e2e8f0' },
};

/**
 * Vista de cima: frente no topo, traseira embaixo.
 * Esquerdo = esquerda do SVG | Direito = direita do SVG
 * Dual: externo mais afastado do centro, interno mais perto
 */
const COORDS_PNEU = {
  // Eixo dianteiro (simples)
  DE: { cx: 185, cy: 175, w: 52, h: 78, short: 'DE' },
  DD: { cx: 515, cy: 175, w: 52, h: 78, short: 'DD' },
  D: { cx: 350, cy: 175, w: 52, h: 78, short: 'D' },

  // Eixo 2 — dual (esq. externo/interno | dir. interno/externo)
  E2EE: { cx: 145, cy: 455, w: 46, h: 70, short: 'E2EE' },
  E2EI: { cx: 205, cy: 455, w: 46, h: 70, short: 'E2EI' },
  E2DI: { cx: 495, cy: 455, w: 46, h: 70, short: 'E2DI' },
  E2DE: { cx: 555, cy: 455, w: 46, h: 70, short: 'E2DE' },

  // Eixo 3 — dual
  E3EE: { cx: 145, cy: 555, w: 46, h: 70, short: 'E3EE' },
  E3EI: { cx: 205, cy: 555, w: 46, h: 70, short: 'E3EI' },
  E3DI: { cx: 495, cy: 555, w: 46, h: 70, short: 'E3DI' },
  E3DE: { cx: 555, cy: 555, w: 46, h: 70, short: 'E3DE' },

  // Layouts sem numeração de eixo
  TE: { cx: 185, cy: 520, w: 52, h: 78, short: 'TE' },
  TD: { cx: 515, cy: 520, w: 52, h: 78, short: 'TD' },
  TEE: { cx: 145, cy: 505, w: 46, h: 70, short: 'TEE' },
  TEI: { cx: 205, cy: 505, w: 46, h: 70, short: 'TEI' },
  TDI: { cx: 495, cy: 505, w: 46, h: 70, short: 'TDI' },
  TDE: { cx: 555, cy: 505, w: 46, h: 70, short: 'TDE' },
  T: { cx: 350, cy: 520, w: 52, h: 78, short: 'T' },

  ESTEPE: { cx: 640, cy: 320, w: 46, h: 70, short: 'EST' },
};

function coordsFallback(index, total) {
  const cols = Math.min(total, 4);
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    cx: 160 + col * 120,
    cy: 200 + row * 100,
    w: 46,
    h: 70,
    short: String(index + 1),
  };
}

function statusLabel(status) {
  return { ok: 'OK', alerta: 'Alerta', critico: 'Crítico', sem_dado: 'Sem medição' }[status] || status;
}

function renderPneu(p, n, coord, cores, sulco, nome, ativo) {
  const { cx, cy, w, h, short } = coord;
  const x = cx - w / 2;
  const y = cy - h / 2;
  return `
    <g class="pneu-click${ativo}" data-pneu-id="${p.id}" data-posicao="${p.posicao}" style="cursor:pointer">
      <rect x="${x - 4}" y="${y - 4}" width="${w + 8}" height="${h + 8}" rx="10"
            fill="none" stroke="${ativo ? '#fbbf24' : 'transparent'}" stroke-width="3" class="pneu-halo"/>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8"
            fill="${cores.fill}" stroke="${cores.stroke}" stroke-width="3"
            class="pneu-ellipse pneu-status-ring"/>
      <!-- sulcos do pneu (vista de cima) -->
      <line x1="${cx - w * 0.28}" y1="${y + 8}" x2="${cx - w * 0.28}" y2="${y + h - 8}"
            stroke="#0f172a" stroke-width="2.5" opacity="0.35" pointer-events="none"/>
      <line x1="${cx}" y1="${y + 8}" x2="${cx}" y2="${y + h - 8}"
            stroke="#0f172a" stroke-width="2.5" opacity="0.35" pointer-events="none"/>
      <line x1="${cx + w * 0.28}" y1="${y + 8}" x2="${cx + w * 0.28}" y2="${y + h - 8}"
            stroke="#0f172a" stroke-width="2.5" opacity="0.35" pointer-events="none"/>
      <circle cx="${cx}" cy="${cy - 10}" r="12" fill="#0f172a" opacity="0.85"/>
      <text x="${cx}" y="${cy - 5}" text-anchor="middle" font-size="12" font-weight="800"
            fill="#fff" pointer-events="none">${n}</text>
      <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="10" font-weight="700"
            fill="#fff" pointer-events="none">${short}</text>
      <text x="${cx}" y="${cy + 28}" text-anchor="middle" font-size="9" font-weight="600"
            fill="#fff" opacity="0.95" pointer-events="none">${sulco}</text>
      <title>${n}. ${nome} — ${sulco} mm</title>
    </g>`;
}

function buildTruckBodySvg(pneusSvg) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 720" class="truck-svg"
     role="img" aria-label="Vista de cima do compactador — clique no pneu">
  <defs>
    <linearGradient id="piso" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#e2e8f0"/><stop offset="100%" stop-color="#cbd5e1"/>
    </linearGradient>
    <linearGradient id="cabine-top" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f8fafc"/><stop offset="100%" stop-color="#e2e8f0"/>
    </linearGradient>
    <linearGradient id="cacamba-top" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#4ade80"/><stop offset="100%" stop-color="#15803d"/>
    </linearGradient>
    <linearGradient id="hopper-top" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#22c55e"/><stop offset="100%" stop-color="#14532d"/>
    </linearGradient>
    <filter id="sombra" x="-5%" y="-5%" width="110%" height="115%">
      <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#0f172a" flood-opacity="0.18"/>
    </filter>
    <pattern id="hazard" width="12" height="14" patternUnits="userSpaceOnUse" patternTransform="skewX(-20)">
      <rect width="6" height="14" fill="#facc15"/>
      <rect x="6" width="6" height="14" fill="#0f172a"/>
    </pattern>
  </defs>

  <rect width="700" height="720" fill="url(#piso)" rx="12"/>

  <!-- Orientação -->
  <text x="350" y="28" text-anchor="middle" font-family="Segoe UI,sans-serif"
        font-size="13" font-weight="700" fill="#334155">▲ FRENTE</text>
  <text x="40" y="360" text-anchor="middle" font-family="Segoe UI,sans-serif"
        font-size="11" font-weight="600" fill="#64748b" transform="rotate(-90 40 360)">ESQUERDO</text>
  <text x="660" y="360" text-anchor="middle" font-family="Segoe UI,sans-serif"
        font-size="11" font-weight="600" fill="#64748b" transform="rotate(90 660 360)">DIREITO</text>
  <text x="350" y="705" text-anchor="middle" font-family="Segoe UI,sans-serif"
        font-size="13" font-weight="700" fill="#334155">▼ TRASEIRA</text>

  <g filter="url(#sombra)">
    <!-- Cabine (vista de cima) -->
    <rect x="230" y="70" width="240" height="150" rx="18" fill="url(#cabine-top)" stroke="#94a3b8" stroke-width="2"/>
    <rect x="255" y="95" width="190" height="70" rx="8" fill="#7dd3fc" opacity="0.55" stroke="#38bdf8" stroke-width="1"/>
    <text x="350" y="140" text-anchor="middle" font-size="12" font-weight="700" fill="#0369a1">CABINE</text>
    <!-- Espelhos -->
    <rect x="210" y="100" width="16" height="36" rx="3" fill="#64748b"/>
    <rect x="474" y="100" width="16" height="36" rx="3" fill="#64748b"/>

    <!-- Caçamba / corpo -->
    <rect x="230" y="230" width="240" height="300" rx="8" fill="url(#cacamba-top)" stroke="#14532d" stroke-width="2"/>
    <text x="350" y="360" text-anchor="middle" font-size="14" font-weight="800" fill="#fff" letter-spacing="1">
      LIMPEZA URBANA
    </text>
    <text x="350" y="382" text-anchor="middle" font-size="11" fill="#dcfce7">CAÇAMBA</text>

    <!-- Faixas refletivas laterais (vista de cima = bordas) -->
    <rect x="230" y="250" width="10" height="260" fill="#f97316"/>
    <rect x="230" y="250" width="10" height="130" fill="#facc15"/>
    <rect x="460" y="250" width="10" height="260" fill="#f97316"/>
    <rect x="460" y="250" width="10" height="130" fill="#facc15"/>

    <!-- Hopper / compactador traseiro -->
    <path d="M 220 530 L 480 530 L 500 620 L 500 660 L 200 660 L 200 620 Z"
          fill="url(#hopper-top)" stroke="#052e16" stroke-width="2"/>
    <text x="350" y="600" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">COMPACTADOR</text>
    <rect x="300" y="640" width="100" height="14" rx="2" fill="#facc15"/>
    <rect x="300" y="640" width="100" height="14" rx="2" fill="url(#hazard)" opacity="0.9"/>

    <!-- Eixos (linhas centrais) -->
    <line x1="185" y1="175" x2="515" y2="175" stroke="#334155" stroke-width="6" stroke-linecap="round" opacity="0.35"/>
    <line x1="145" y1="455" x2="555" y2="455" stroke="#334155" stroke-width="6" stroke-linecap="round" opacity="0.35"/>
    <line x1="145" y1="555" x2="555" y2="555" stroke="#334155" stroke-width="6" stroke-linecap="round" opacity="0.35"/>
  </g>

  <!-- Rótulos dos eixos -->
  <text x="350" y="210" text-anchor="middle" font-size="10" fill="#64748b">Eixo dianteiro</text>
  <text x="350" y="430" text-anchor="middle" font-size="10" fill="#64748b">Eixo 2 (duplo)</text>
  <text x="350" y="530" text-anchor="middle" font-size="10" fill="#64748b">Eixo 3 (duplo)</text>

  <!-- Legenda status -->
  <g transform="translate(20, 40)" font-family="Segoe UI,sans-serif" font-size="10">
    <circle cx="6" cy="0" r="5" fill="#22c55e"/><text x="16" y="4" fill="#334155">OK</text>
    <circle cx="56" cy="0" r="5" fill="#f59e0b"/><text x="66" y="4" fill="#334155">Alerta</text>
    <circle cx="116" cy="0" r="5" fill="#ef4444"/><text x="126" y="4" fill="#334155">Crítico</text>
    <circle cx="180" cy="0" r="5" fill="#64748b"/><text x="190" y="4" fill="#334155">Sem medição</text>
  </g>

  <!-- Pneus clicáveis -->
  ${pneusSvg}
</svg>`;
}

function buildPickerItem(p, n, cores, sulco, nome, ativo) {
  return `
    <button type="button" class="tire-pick${ativo}" data-pneu-id="${p.id}" title="${nome}">
      <span class="tire-pick-num" style="background:${cores.fill}">${n}</span>
      <span class="tire-pick-body">
        <span class="tire-pick-name">${nome}</span>
        <span class="tire-pick-meta">
          <span class="tire-pick-code">${p.posicao}</span>
          <span class="tire-pick-sulco">${sulco} mm</span>
          <span class="tire-pick-status" style="color:${cores.stroke}">${statusLabel(p.status_sulco)}</span>
        </span>
      </span>
    </button>`;
}

export class TruckDiagram {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.onPneuClick = options.onPneuClick || (() => {});
    this.pneus = [];
    this.labels = {};
    this.pneuAtivo = null;
  }

  render(pneus, labels = {}) {
    this.pneus = pneus;
    this.labels = labels;
    this._paint();
  }

  _paint() {
    const items = this.pneus.map((p, i) => {
      const n = i + 1;
      const coord = COORDS_PNEU[p.posicao] || coordsFallback(i, this.pneus.length);
      const cores = STATUS_CORES[p.status_sulco] || STATUS_CORES.sem_dado;
      const sulco = p.menor_sulco != null ? `${p.menor_sulco}` : '—';
      const nome = this.labels[p.posicao] || p.posicao_label || p.posicao;
      const ativo = this.pneuAtivo === p.id ? ' pneu-ativo' : '';
      const ativoBtn = this.pneuAtivo === p.id ? ' is-active' : '';
      return {
        marcador: renderPneu(p, n, coord, cores, sulco, nome, ativo),
        picker: buildPickerItem(p, n, cores, sulco, nome, ativoBtn),
      };
    });

    this.container.innerHTML = `
      <div class="truck-diagram-inner">
        ${buildTruckBodySvg(items.map((x) => x.marcador).join(''))}
        <div class="tire-picker" role="listbox" aria-label="Selecionar pneu">
          <p class="tire-picker-hint">Clique no pneu na planta (vista de cima) ou na lista:</p>
          <div class="tire-picker-grid">
            ${items.map((x) => x.picker).join('')}
          </div>
        </div>
      </div>`;

    this.svg = this.container.querySelector('svg');
    this._bindEvents();
  }

  _bindEvents() {
    const select = (pneuId) => {
      this.setAtivo(pneuId);
      const pneu = this.pneus.find((p) => p.id === pneuId);
      if (pneu) this.onPneuClick(pneu);
    };

    this.container.querySelectorAll('.pneu-click').forEach((g) => {
      g.addEventListener('click', () => select(parseInt(g.dataset.pneuId, 10)));
    });

    this.container.querySelectorAll('.tire-pick').forEach((btn) => {
      btn.addEventListener('click', () => select(parseInt(btn.dataset.pneuId, 10)));
    });
  }

  setAtivo(pneuId) {
    this.pneuAtivo = pneuId;
    this.container.querySelectorAll('.pneu-click').forEach((g) => {
      g.classList.toggle('pneu-ativo', parseInt(g.dataset.pneuId, 10) === pneuId);
    });
    this.container.querySelectorAll('.tire-pick').forEach((btn) => {
      btn.classList.toggle('is-active', parseInt(btn.dataset.pneuId, 10) === pneuId);
    });
  }

  atualizarPneu(pneuAtualizado, labels) {
    const idx = this.pneus.findIndex((p) => p.id === pneuAtualizado.id);
    if (idx >= 0) this.pneus[idx] = { ...this.pneus[idx], ...pneuAtualizado };
    if (labels) this.labels = labels;
    const ativo = this.pneuAtivo;
    this._paint();
    if (ativo) this.setAtivo(ativo);
  }
}
