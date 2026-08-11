import { TireMarker } from './tire-marker.js';
import { TruckDiagram } from './truck-diagram.js';

const API = import.meta.env.VITE_API_URL || '/api';
let meta = { posicoes: {}, tipos: [], layouts: [], layout_padrao: 'truck_8' };
let veiculoLayoutId = null;
let veiculoAtual = null;
let pneuSelecionado = null;
let truckDiagram = null;
let truckTireMarker = null;
let autoSaveTimer = null;
let voltarPara = 'dashboard';

const LAYOUT_POR_TIPO = {
  Moto: 'moto_2',
  'Utilitário': 'padrao_5',
  'Caminhão Compactador': 'truck_8',
  'Caminhão Basculante': 'truck_8',
  'Caminhão Pipa': 'truck_8',
  Varredeira: 'truck_8',
  'Lavadora de Ruas': 'truck_10',
};
let veiculosCache = [];
let tireMarker = null;
let limitesAtuais = { sulco_critico_mm: 1.6, sulco_alerta_mm: 3.0 };

// ── Utilitários ──────────────────────────────────────────

const LIMITES_PADRAO = { sulco_critico_mm: 1.6, sulco_alerta_mm: 3.0 };

async function fetchJSON(url, options = {}) {
  const resp = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let data;
  try {
    data = await resp.json();
  } catch {
    data = {};
  }
  if (!resp.ok) {
    const msg = data.erro || (resp.status === 404 ? 'Recurso não encontrado — reinicie o backend (npm run dev)' : 'Erro na requisição');
    throw new Error(msg);
  }
  return data;
}

async function fetchConfiguracoes() {
  try {
    return await fetchJSON(`${API}/configuracoes`);
  } catch {
    return { ...LIMITES_PADRAO };
  }
}

function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  setTimeout(() => el.classList.add('hidden'), 3000);
}

function badge(status) {
  const labels = { ok: 'OK', alerta: 'Alerta', critico: 'Crítico', sem_dado: 'Sem medição' };
  return `<span class="badge badge-${status}">${labels[status] || status}</span>`;
}

function formatDate(d) {
  if (!d) return '-';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

function atualizarPreviewLimites() {
  const critico = parseFloat(document.getElementById('cfg-critico')?.value) || limitesAtuais.sulco_critico_mm;
  const alerta = parseFloat(document.getElementById('cfg-alerta')?.value) || limitesAtuais.sulco_alerta_mm;

  const elCritico = document.getElementById('preview-critico');
  const elAlerta = document.getElementById('preview-alerta');
  const elOk = document.getElementById('preview-ok');
  if (elCritico) elCritico.textContent = `≤ ${critico} mm`;
  if (elAlerta) elAlerta.textContent = `${critico} – ${alerta} mm`;
  if (elOk) elOk.textContent = `> ${alerta} mm`;
}

function hintLimites() {
  const { sulco_critico_mm: c, sulco_alerta_mm: a } = limitesAtuais;
  return `Limites atuais: Crítico ≤ ${c} mm · Alerta ≤ ${a} mm · OK > ${a} mm`;
}

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById(`view-${name}`).classList.add('active');
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.view === name);
  });
}

// ── Navegação ────────────────────────────────────────────

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const view = tab.dataset.view;
    showView(view);
    if (view === 'dashboard') loadDashboard();
    if (view === 'veiculos') loadVeiculos();
    if (view === 'medicao') initMedicao();
    if (view === 'alertas') loadAlertas();
    if (view === 'configuracoes') loadConfiguracoes();
  });
});

document.getElementById('btn-voltar-dashboard').addEventListener('click', () => {
  showView(voltarPara);
  if (voltarPara === 'dashboard') loadDashboard();
  else loadVeiculos();
});

async function fetchDashboardResumo() {
  try {
    return await fetchJSON(`${API}/dashboard/resumo`);
  } catch {
    const veiculos = await fetchJSON(`${API}/veiculos`);
    let ok = 0, alerta = 0, critico = 0, semDado = 0;
    veiculos.forEach((v) => {
      if (v.status_sulco === 'ok') ok++;
      else if (v.status_sulco === 'alerta') alerta++;
      else if (v.status_sulco === 'critico') critico++;
      else semDado++;
    });
    return {
      veiculos_ativos: veiculos.length,
      pneus_ok: ok,
      pneus_alerta: alerta,
      pneus_critico: critico,
      limites: limitesAtuais,
    };
  }
}

// ── Dashboard ──────────────────────────────────────────

async function loadDashboard() {
  try {
    const [resumo, veiculos] = await Promise.all([
      fetchDashboardResumo(),
      fetchJSON(`${API}/veiculos`),
    ]);
    veiculosCache = veiculos;
    limitesAtuais = resumo.limites;

    document.getElementById('stat-veiculos').textContent = resumo.veiculos_ativos;
    document.getElementById('stat-ok').textContent = resumo.pneus_ok;
    document.getElementById('stat-alerta').textContent = resumo.pneus_alerta;
    document.getElementById('stat-critico').textContent = resumo.pneus_critico;

    const hint = document.getElementById('dashboard-limites-hint');
    if (hint) hint.textContent = hintLimites();

    const lista = document.getElementById('dashboard-lista');
    if (!veiculos.length) {
      lista.innerHTML = '<div class="empty-state"><h3>Nenhum veículo cadastrado</h3><p>Cadastre seu primeiro veículo na aba Veículos</p></div>';
      return;
    }

    lista.innerHTML = veiculos.map((v) => `
      <div class="veiculo-card" data-id="${v.id}">
        <div class="veiculo-info">
          <h4>${v.apelido || v.placa}</h4>
          <p>${v.placa} · ${v.tipo} · ${v.km_atual?.toLocaleString('pt-BR') || 0} km</p>
        </div>
        <div class="veiculo-meta">
          ${v.menor_sulco != null ? `<span style="font-weight:600">${v.menor_sulco} mm</span>` : ''}
          ${badge(v.status_sulco)}
        </div>
      </div>
    `).join('');

    lista.querySelectorAll('.veiculo-card').forEach((card) => {
      card.addEventListener('click', () => openVeiculoDetalhe(card.dataset.id, 'dashboard'));
    });
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Veículos ───────────────────────────────────────────

async function loadVeiculos() {
  try {
    const veiculos = await fetchJSON(`${API}/veiculos`);
    veiculosCache = veiculos;
    const lista = document.getElementById('veiculos-lista');

    if (!veiculos.length) {
      lista.innerHTML = '<div class="empty-state"><h3>Nenhum veículo</h3><p>Clique em "+ Novo Veículo" para começar</p></div>';
      return;
    }

    lista.innerHTML = veiculos.map((v) => `
      <div class="veiculo-card" data-id="${v.id}">
        <div class="veiculo-info">
          <h4>${v.apelido || v.placa}</h4>
          <p>${v.placa} · ${v.tipo} · ${v.total_pneus} pneus · ${v.km_atual?.toLocaleString('pt-BR') || 0} km</p>
        </div>
        <div class="veiculo-meta">
          ${badge(v.status_sulco)}
          <button class="btn btn-sm btn-primary btn-medir" data-id="${v.id}">Medir</button>
        </div>
      </div>
    `).join('');

    lista.querySelectorAll('.veiculo-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-medir')) return;
        openVeiculoDetalhe(card.dataset.id, 'veiculos');
      });
    });

    lista.querySelectorAll('.btn-medir').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openVeiculoDetalhe(btn.dataset.id, 'veiculos');
      });
    });
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function openVeiculoDetalhe(id, origem = 'dashboard') {
  voltarPara = origem;
  try {
    const v = await fetchJSON(`${API}/veiculos/${id}`);
    veiculoAtual = v;
    veiculoLayoutId = v.id;

    const layoutInfo = getLayoutById(v.layout_pneus);
    document.getElementById('truck-header').innerHTML = `
      <h2>${v.apelido || v.placa}</h2>
      <p class="hint">${v.placa} · ${v.tipo} · ${v.km_atual?.toLocaleString('pt-BR') || 0} km · ${layoutInfo?.nome || 'Personalizado'} (${v.pneus.length} pneus)</p>
    `;

    document.getElementById('historico-pneu').innerHTML = '';
    document.getElementById('truck-panel-form').classList.add('hidden');
    document.querySelector('.truck-panel-empty').classList.remove('hidden');
    pneuSelecionado = null;

    if (!truckDiagram) {
      truckDiagram = new TruckDiagram('truck-diagram-container', {
        onPneuClick: (pneu) => selecionarPneuTruck(pneu),
      });
    }
    truckDiagram.render(v.pneus, meta.posicoes);

    document.getElementById('truck-km').value = v.km_atual || '';
    document.getElementById('btn-truck-config').onclick = () => {
      abrirConfigLayout(v.id, v.apelido || v.placa, v.layout_pneus, v.pneus.map((p) => p.posicao));
    };

    showView('veiculo-detalhe');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function selecionarPneuTruck(pneu) {
  pneuSelecionado = pneu;
  document.querySelector('.truck-panel-empty').classList.add('hidden');
  document.getElementById('truck-panel-form').classList.remove('hidden');

  document.getElementById('truck-pneu-nome').textContent =
    meta.posicoes[pneu.posicao] || pneu.posicao_label || pneu.posicao;
  document.getElementById('truck-pneu-status').innerHTML = badge(pneu.status_sulco);

  document.getElementById('truck-sulco-ext').value = pneu.ult_sulco_ext ?? '';
  document.getElementById('truck-sulco-cent').value = pneu.ult_sulco_cent ?? '';
  document.getElementById('truck-sulco-int').value = pneu.ult_sulco_int ?? '';
  document.getElementById('truck-pressao').value = '';
  document.getElementById('truck-save-status').textContent = 'Preencha os sulcos — salva automaticamente';
  document.getElementById('truck-save-status').className = 'hint save-status';

  if (!truckTireMarker) {
    truckTireMarker = new TireMarker('truck-mini-marker');
  }
  truckTireMarker.setValores(pneu.ult_sulco_ext, pneu.ult_sulco_cent, pneu.ult_sulco_int);

  document.getElementById('btn-truck-historico').onclick = () => abrirHistoricoPneu(pneu.id);
}

function syncTruckMarkerFromInputs() {
  if (!truckTireMarker) return;
  truckTireMarker.setValores(
    parseFloat(document.getElementById('truck-sulco-ext').value) || null,
    parseFloat(document.getElementById('truck-sulco-cent').value) || null,
    parseFloat(document.getElementById('truck-sulco-int').value) || null
  );
}

function agendarAutoSave() {
  clearTimeout(autoSaveTimer);
  const status = document.getElementById('truck-save-status');
  status.textContent = 'Salvando...';
  status.className = 'hint save-status salvando';

  autoSaveTimer = setTimeout(salvarMedicaoTruck, 700);
}

async function salvarMedicaoTruck() {
  if (!pneuSelecionado || !veiculoAtual) return;

  const ext = parseFloat(document.getElementById('truck-sulco-ext').value);
  const cent = parseFloat(document.getElementById('truck-sulco-cent').value);
  const int = parseFloat(document.getElementById('truck-sulco-int').value);
  const pressao = parseFloat(document.getElementById('truck-pressao').value);
  const km = parseInt(document.getElementById('truck-km').value, 10);

  if (!ext && !cent && !int) {
    document.getElementById('truck-save-status').textContent = 'Informe ao menos um sulco';
    document.getElementById('truck-save-status').className = 'hint save-status';
    return;
  }

  const status = document.getElementById('truck-save-status');
  try {
    const result = await fetchJSON(`${API}/medicoes`, {
      method: 'POST',
      body: JSON.stringify({
        pneu_id: pneuSelecionado.id,
        data_medicao: new Date().toISOString().split('T')[0],
        km_veiculo: km || veiculoAtual.km_atual || null,
        sulco_externo: ext || null,
        sulco_central: cent || null,
        sulco_interno: int || null,
        pressao_psi: pressao || null,
        marcacao_json: truckTireMarker?.getValores(),
      }),
    });

    pneuSelecionado = {
      ...pneuSelecionado,
      ult_sulco_ext: ext || null,
      ult_sulco_cent: cent || null,
      ult_sulco_int: int || null,
      menor_sulco: result.menor_sulco,
      status_sulco: result.status_sulco,
    };

    const idx = veiculoAtual.pneus.findIndex((p) => p.id === pneuSelecionado.id);
    if (idx >= 0) veiculoAtual.pneus[idx] = { ...veiculoAtual.pneus[idx], ...pneuSelecionado };

    truckDiagram.atualizarPneu(pneuSelecionado, meta.posicoes);
    document.getElementById('truck-pneu-status').innerHTML = badge(result.status_sulco);

    status.textContent = result.status_sulco === 'critico'
      ? `Salvo! Crítico — ${result.menor_sulco} mm`
      : `Salvo — menor sulco: ${result.menor_sulco ?? '-'} mm`;
    status.className = `hint save-status ${result.status_sulco === 'critico' ? 'erro' : 'salvo'}`;
  } catch (err) {
    status.textContent = err.message;
    status.className = 'hint save-status erro';
  }
}

['truck-sulco-ext', 'truck-sulco-cent', 'truck-sulco-int', 'truck-pressao', 'truck-km'].forEach((id) => {
  document.getElementById(id)?.addEventListener('input', () => {
    syncTruckMarkerFromInputs();
    agendarAutoSave();
  });
});

async function abrirHistoricoPneu(pneuId) {
  try {
    const data = await fetchJSON(`${API}/pneus/${pneuId}`);
    const el = document.getElementById('historico-pneu');

    if (!data.medicoes.length) {
      el.innerHTML = '<p class="hint">Nenhuma medição registrada para este pneu.</p>';
      return;
    }

    el.innerHTML = `
      <h3>Histórico — ${meta.posicoes[data.posicao] || data.posicao}</h3>
      <table class="historico-table">
        <thead>
          <tr><th>Data</th><th>Ext</th><th>Cent</th><th>Int</th><th>Menor</th><th>Status</th><th>KM</th></tr>
        </thead>
        <tbody>
          ${data.medicoes.map((m) => `
            <tr>
              <td>${formatDate(m.data_medicao)}</td>
              <td>${m.sulco_externo ?? '-'}</td>
              <td>${m.sulco_central ?? '-'}</td>
              <td>${m.sulco_interno ?? '-'}</td>
              <td><strong>${m.menor_sulco ?? '-'}</strong></td>
              <td>${badge(m.status_sulco)}</td>
              <td>${m.km_veiculo?.toLocaleString('pt-BR') || '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    toast(err.message, 'error');
  }
}

window.abrirHistoricoPneu = abrirHistoricoPneu;

// ── Layout de pneus ────────────────────────────────────

function getLayoutById(id) {
  return meta.layouts?.find((l) => l.id === id);
}

function renderLayoutTags(posicoes, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = posicoes.map((p) =>
    `<span class="layout-tag">${meta.posicoes[p] || p}</span>`
  ).join('');
}

function preencherSelectLayouts(selectId, selectedId) {
  const sel = document.getElementById(selectId);
  if (!sel || !meta.layouts) return;
  sel.innerHTML = meta.layouts.map((l) =>
    `<option value="${l.id}">${l.nome} (${l.posicoes.length} pneus)</option>`
  ).join('');
  sel.value = selectedId || meta.layout_padrao;
  sel.dispatchEvent(new Event('change'));
}

function onLayoutSelectChange(selectId, descId, previewId) {
  const sel = document.getElementById(selectId);
  const layout = getLayoutById(sel.value);
  if (!layout) return;
  const desc = document.getElementById(descId);
  if (desc) desc.textContent = layout.descricao;
  renderLayoutTags(layout.posicoes, previewId);
}

function preencherCheckboxesPosicoes(containerId, selecionadas = []) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = Object.entries(meta.posicoes).map(([cod, label]) => `
    <label>
      <input type="checkbox" name="posicao-custom" value="${cod}" ${selecionadas.includes(cod) ? 'checked' : ''}>
      ${label}
    </label>
  `).join('');
}

function abrirConfigLayout(veiculoId, veiculoNome, layoutAtual, posicoesAtuais) {
  veiculoLayoutId = veiculoId;
  document.getElementById('layout-veiculo-nome').textContent = veiculoNome;
  preencherSelectLayouts('layout-select', layoutAtual || meta.layout_padrao);
  preencherCheckboxesPosicoes('layout-custom-checkboxes', posicoesAtuais || []);
  document.getElementById('modal-layout').showModal();
}

window.abrirConfigLayout = abrirConfigLayout;

// ── Modal Veículo ──────────────────────────────────────

const modalVeiculo = document.getElementById('modal-veiculo');

document.getElementById('btn-novo-veiculo').addEventListener('click', () => {
  document.getElementById('form-veiculo').reset();
  document.getElementById('modal-veiculo-titulo').textContent = 'Novo Veículo';
  preencherSelectLayouts('v-layout', meta.layout_padrao);
  modalVeiculo.showModal();
});

document.getElementById('v-layout')?.addEventListener('change', () => {
  onLayoutSelectChange('v-layout', 'v-layout-desc', 'v-layout-preview');
});

document.getElementById('v-tipo')?.addEventListener('change', (e) => {
  const sugestao = LAYOUT_POR_TIPO[e.target.value];
  if (sugestao) {
    document.getElementById('v-layout').value = sugestao;
    document.getElementById('v-layout').dispatchEvent(new Event('change'));
  }
});

document.getElementById('layout-select')?.addEventListener('change', () => {
  const layout = getLayoutById(document.getElementById('layout-select').value);
  onLayoutSelectChange('layout-select', 'layout-select-desc', 'layout-posicoes-preview');
  if (layout) preencherCheckboxesPosicoes('layout-custom-checkboxes', layout.posicoes);
});

document.getElementById('btn-cancelar-veiculo').addEventListener('click', () => modalVeiculo.close());

document.getElementById('form-veiculo').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await fetchJSON(`${API}/veiculos`, {
      method: 'POST',
      body: JSON.stringify({
        placa: document.getElementById('v-placa').value,
        apelido: document.getElementById('v-apelido').value,
        tipo: document.getElementById('v-tipo').value,
        marca: document.getElementById('v-marca').value,
        modelo: document.getElementById('v-modelo').value,
        ano: parseInt(document.getElementById('v-ano').value) || null,
        km_atual: parseInt(document.getElementById('v-km').value) || 0,
        layout_pneus: document.getElementById('v-layout').value,
      }),
    });
    modalVeiculo.close();
    toast('Veículo cadastrado com sucesso!', 'success');
    loadVeiculos();
  } catch (err) {
    toast(err.message, 'error');
  }
});

document.getElementById('btn-cancelar-layout')?.addEventListener('click', () => {
  document.getElementById('modal-layout').close();
});

document.getElementById('form-layout')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!veiculoLayoutId) return;

  const custom = [...document.querySelectorAll('input[name="posicao-custom"]:checked')].map((c) => c.value);
  const layoutId = document.getElementById('layout-select').value;
  const layout = getLayoutById(layoutId);
  const posicoesLayout = layout?.posicoes || [];
  const iguais = custom.length === posicoesLayout.length && custom.every((p) => posicoesLayout.includes(p));

  const payload = iguais
    ? { layout_pneus: layoutId }
    : { layout_pneus: 'personalizado', posicoes_custom: custom };

  if (!custom.length) return toast('Selecione ao menos uma posição de pneu', 'error');

  try {
    const result = await fetchJSON(`${API}/veiculos/${veiculoLayoutId}/layout`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    document.getElementById('modal-layout').close();
    toast(result.mensagem, 'success');
    openVeiculoDetalhe(veiculoLayoutId, voltarPara);
    loadVeiculos();
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ── Medição ────────────────────────────────────────────

const sulcoInputs = {
  externo: document.getElementById('med-externo'),
  central: document.getElementById('med-central'),
  interno: document.getElementById('med-interno'),
};

function syncTireFromInputs() {
  if (!tireMarker) return;
  tireMarker.setValores(
    parseFloat(sulcoInputs.externo.value) || null,
    parseFloat(sulcoInputs.central.value) || null,
    parseFloat(sulcoInputs.interno.value) || null
  );
}

Object.values(sulcoInputs).forEach((input) => {
  input.addEventListener('input', syncTireFromInputs);
});

async function initMedicao() {
  document.getElementById('med-data').value = new Date().toISOString().split('T')[0];

  if (!tireMarker) {
    tireMarker = new TireMarker('tire-marker-container', {
      onSulcoClick: (sulco) => {
        const input = sulcoInputs[sulco];
        if (input) {
          input.focus();
          input.select();
        }
      },
    });
  } else {
    tireMarker.reset();
  }

  try {
    const veiculos = veiculosCache.length ? veiculosCache : await fetchJSON(`${API}/veiculos`);
    const select = document.getElementById('med-veiculo');
    select.innerHTML = '<option value="">Selecione...</option>' +
      veiculos.map((v) => `<option value="${v.id}">${v.apelido || v.placa} (${v.placa})</option>`).join('');
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.getElementById('med-veiculo').addEventListener('change', async (e) => {
  const veiculoId = e.target.value;
  const selectPneu = document.getElementById('med-pneu');

  if (!veiculoId) {
    selectPneu.innerHTML = '<option value="">Selecione o veículo primeiro</option>';
    selectPneu.disabled = true;
    return;
  }

  try {
    const v = await fetchJSON(`${API}/veiculos/${veiculoId}`);
    selectPneu.disabled = false;
    selectPneu.innerHTML = v.pneus.map((p) =>
      `<option value="${p.id}">${meta.posicoes[p.posicao] || p.posicao}</option>`
    ).join('');
    document.getElementById('med-km').value = v.km_atual || '';
  } catch (err) {
    toast(err.message, 'error');
  }
});

async function irParaMedicao(veiculoId) {
  showView('medicao');
  document.querySelector('.tab[data-view="medicao"]').classList.add('active');
  document.querySelectorAll('.tab:not([data-view="medicao"])').forEach((t) => t.classList.remove('active'));
  await initMedicao();
  document.getElementById('med-veiculo').value = veiculoId;
  document.getElementById('med-veiculo').dispatchEvent(new Event('change'));
}

window.irParaMedicao = irParaMedicao;

document.getElementById('btn-salvar-medicao').addEventListener('click', async () => {
  const pneuId = document.getElementById('med-pneu').value;
  if (!pneuId) return toast('Selecione o pneu', 'error');

  const payload = {
    pneu_id: parseInt(pneuId),
    data_medicao: document.getElementById('med-data').value,
    km_veiculo: parseInt(document.getElementById('med-km').value) || null,
    sulco_externo: parseFloat(document.getElementById('med-externo').value) || null,
    sulco_central: parseFloat(document.getElementById('med-central').value) || null,
    sulco_interno: parseFloat(document.getElementById('med-interno').value) || null,
    pressao_psi: parseFloat(document.getElementById('med-pressao').value) || null,
    responsavel: document.getElementById('med-responsavel').value,
    observacoes: document.getElementById('med-obs').value,
    marcacao_json: tireMarker?.getValores(),
  };

  if (!payload.sulco_externo && !payload.sulco_central && !payload.sulco_interno) {
    return toast('Informe ao menos um valor de sulco', 'error');
  }

  try {
    const result = await fetchJSON(`${API}/medicoes`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const msg = result.status_sulco === 'critico'
      ? `Medição salva! ATENÇÃO: sulco crítico (${result.menor_sulco} mm)`
      : `Medição salva! Menor sulco: ${result.menor_sulco ?? '-'} mm`;

    toast(msg, result.status_sulco === 'critico' ? 'error' : 'success');

    document.getElementById('med-externo').value = '';
    document.getElementById('med-central').value = '';
    document.getElementById('med-interno').value = '';
    document.getElementById('med-pressao').value = '';
    document.getElementById('med-obs').value = '';
    tireMarker?.reset();
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ── Alertas ────────────────────────────────────────────

async function loadAlertas() {
  try {
    const [alertas, config] = await Promise.all([
      fetchJSON(`${API}/medicoes/alertas`),
      fetchConfiguracoes(),
    ]);
    limitesAtuais = config;

    const hint = document.getElementById('alertas-limites-hint');
    if (hint) hint.textContent = hintLimites();

    const lista = document.getElementById('alertas-lista');

    if (!alertas.length) {
      lista.innerHTML = '<div class="empty-state"><h3>Nenhum alerta</h3><p>Todos os pneus estão dentro do limite</p></div>';
      return;
    }

    lista.innerHTML = alertas.map((a) => `
      <div class="alerta-card ${a.status_sulco}">
        <div>
          <strong>${a.apelido || a.placa}</strong> — ${meta.posicoes[a.posicao] || a.posicao}
          <p class="hint">${a.placa} · ${a.tipo} · Medição: ${formatDate(a.data_medicao)}</p>
        </div>
        <div class="veiculo-meta">
          <span style="font-size:1.25rem;font-weight:700">${a.menor_sulco} mm</span>
          ${badge(a.status_sulco)}
        </div>
      </div>
    `).join('');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Configurações ──────────────────────────────────────

async function loadConfiguracoes() {
  try {
    const config = await fetchConfiguracoes();
    limitesAtuais = config;

    document.getElementById('cfg-critico').value = config.sulco_critico_mm;
    document.getElementById('cfg-alerta').value = config.sulco_alerta_mm;
    atualizarPreviewLimites();
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.getElementById('cfg-critico')?.addEventListener('input', atualizarPreviewLimites);
document.getElementById('cfg-alerta')?.addEventListener('input', atualizarPreviewLimites);

document.getElementById('btn-salvar-config')?.addEventListener('click', async () => {
  const sulco_critico_mm = parseFloat(document.getElementById('cfg-critico').value);
  const sulco_alerta_mm = parseFloat(document.getElementById('cfg-alerta').value);

  if (!Number.isFinite(sulco_critico_mm) || !Number.isFinite(sulco_alerta_mm)) {
    return toast('Informe valores válidos em mm', 'error');
  }
  if (sulco_alerta_mm <= sulco_critico_mm) {
    return toast('O limite de alerta deve ser maior que o crítico', 'error');
  }

  try {
    const result = await fetchJSON(`${API}/configuracoes`, {
      method: 'PUT',
      body: JSON.stringify({ sulco_critico_mm, sulco_alerta_mm }),
    });
    limitesAtuais = result;
    atualizarPreviewLimites();
    toast('Limites salvos! O dashboard será recalculado.', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ── Inicialização ──────────────────────────────────────

async function init() {
  try {
    const [config, metaData] = await Promise.all([
      fetchConfiguracoes(),
      fetchJSON(`${API}/veiculos/meta`),
    ]);
    meta = metaData;
    limitesAtuais = config;
    const selectTipo = document.getElementById('v-tipo');
    selectTipo.innerHTML = meta.tipos.map((t) => `<option value="${t}">${t}</option>`).join('');
    preencherSelectLayouts('v-layout', meta.layout_padrao);
    preencherSelectLayouts('layout-select', meta.layout_padrao);
    preencherCheckboxesPosicoes('layout-custom-checkboxes', getLayoutById(meta.layout_padrao)?.posicoes || []);
    loadDashboard();
  } catch (err) {
    toast('Erro ao conectar com o servidor. Verifique se está rodando.', 'error');
  }
}

init();
