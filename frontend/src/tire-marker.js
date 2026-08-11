/**
 * Componente de marcação visual do pneu
 * Carrega o SVG e permite clicar nos pontos de sulco
 */
class TireMarker {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.onSulcoClick = options.onSulcoClick || (() => {});
    this.valores = { externo: null, central: null, interno: null };
    this.sulcoAtivo = null;
    this._init();
  }

  async _init() {
    try {
      const resp = await fetch('/assets/pneu-marcacao.svg');
      const svgText = await resp.text();
      this.container.innerHTML = svgText;
      this.svg = this.container.querySelector('svg');
      this._bindEvents();
    } catch (err) {
      this.container.innerHTML = '<p class="hint">Erro ao carregar imagem do pneu</p>';
      console.error(err);
    }
  }

  _bindEvents() {
    const pontos = this.svg.querySelectorAll('.ponto-medicao');
    pontos.forEach((ponto) => {
      ponto.addEventListener('click', () => {
        const sulco = ponto.dataset.sulco;
        this._setAtivo(sulco);
        this.onSulcoClick(sulco);
      });
    });
  }

  _setAtivo(sulco) {
    this.sulcoAtivo = sulco;
    this.svg.querySelectorAll('.ponto-medicao').forEach((p) => {
      p.classList.toggle('ativo', p.dataset.sulco === sulco);
    });
  }

  setValor(sulco, mm) {
    this.valores[sulco] = mm;
    const el = this.svg.querySelector(`#valor-${sulco}`);
    if (el) {
      el.textContent = mm != null ? `${mm} mm` : '-- mm';
      if (mm != null) {
        if (mm <= 1.6) el.setAttribute('fill', '#dc2626');
        else if (mm <= 3.0) el.setAttribute('fill', '#d97706');
        else el.setAttribute('fill', '#166534');
      }
    }
  }

  setValores(externo, central, interno) {
    this.setValor('externo', externo);
    this.setValor('central', central);
    this.setValor('interno', interno);
  }

  getValores() {
    return { ...this.valores };
  }

  reset() {
    this.valores = { externo: null, central: null, interno: null };
    this.setValores(null, null, null);
    this._setAtivo(null);
  }
}

export { TireMarker };
