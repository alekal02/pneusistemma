import { TireMarker } from './tire-marker.js';
import { TruckDiagram, renderLayoutPreview } from './truck-diagram.js';
import { renderPerfilSulco } from './perfil-sulco.js';

const API = import.meta.env.VITE_API_URL || '/api';
const AUTH_KEY = 'pneu_auth';

let meta = { posicoes: {}, tipos: [], layouts: [], layout_padrao: 'truck_10' };
let veiculoLayoutId = null;
let veiculoAtual = null;
let pneuSelecionado = null;
let truckDiagram = null;
let truckTireMarker = null;
let autoSaveTimer = null;
let voltarPara = 'dashboard';
let currentUser = null;
let authToken = null;
let slotPosicaoSelecionada = null;
let modoAcessoRapido = false;
let tokenAcessoRapido = null;

const LAYOUT_POR_TIPO = {
  'Truck / Tração': 'truck_10',
  'Toco / Mini': 'toco_6',
};

let veiculosCache = [];
let tireMarker = null;
let limitesAtuais = {
  sulco_critico_mm: 3.0,
  sulco_alerta_mm: 8.0,
  sulco_recap_mm: 5.0,
  sulco_novo_mm: 14.0,
  max_recaps: 6,
  diagnostico_tolerancia_mm: 1.0,
  acoes: {
    troca: { label: 'Troca', instrucao: 'Retirar o pneu — perda/troca obrigatória' },
    recap: { label: 'Recapagem', instrucao: 'Enviar para recapagem (se ainda houver vida de recap)' },
    monitorar: { label: 'Monitorar', instrucao: 'Acompanhar de perto na próxima medição' },
    rodizio: { label: 'Rodízio', instrucao: 'Faça rodízio com outro pneu de sulco parecido para o desgaste ficar linear' },
    ok: { label: 'OK', instrucao: 'Manter em operação — sulco adequado' },
  },
  rodizio_desvio_mm: 3,
  rodizio_similaridade_mm: 2.5,
};

const LIMITES_PADRAO = { ...limitesAtuais };

function loadAuth() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveAuth(token, usuario) {
  authToken = token;
  currentUser = usuario;
  localStorage.setItem(AUTH_KEY, JSON.stringify({ token, usuario }));
}

function clearAuth() {
  authToken = null;
  currentUser = null;
  localStorage.removeItem(AUTH_KEY);
}

function isAdmin() {
  return currentUser?.papel === 'admin';
}

async function fetchJSON(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (modoAcessoRapido && tokenAcessoRapido) {
    headers['X-Acesso-Rapido-Token'] = tokenAcessoRapido;
  }

  const resp = await fetch(url, { ...options, headers });
  let data;
  try {
    data = await resp.json();
  } catch {
    data = {};
  }
  if (resp.status === 401) {
    const isLogin = url.includes('/auth/login');
    const isAcessoRapido = url.includes('/acesso-rapido') || modoAcessoRapido;
    if (!isLogin && !isAcessoRapido) {
      clearAuth();
      showLogin();
    }
    throw new Error(data.erro || (isLogin ? 'Login ou senha inválidos' : 'Sessão expirada — faça login novamente'));
  }
  if (!resp.ok) {
    const msg = data.erro || (resp.status === 404
      ? 'Recurso não encontrado — reinicie o backend (npm run dev)'
      : 'Erro na requisição');
    const err = new Error(msg);
    err.data = data;
    throw err;
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
  setTimeout(() => el.classList.add('hidden'), 3500);
}

function badge(status) {
  const labels = {
    ok: 'OK',
    alerta: 'Alerta',
    critico: 'Crítico',
    sem_dado: 'Sem medição',
  };
  return `<span class="badge badge-${status}">${labels[status] || status}</span>`;
}

function badgeAcao(codigo, label) {
  if (!codigo || codigo === 'ok') return '';
  return `<span class="badge badge-acao badge-acao-${codigo}">${label || codigo}</span>`;
}

function formatDate(d) {
  if (!d) return '-';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

/** Corrige tipos com acento corrompido vindos do banco */
function normalizarTipoLabel(tipo) {
  if (!tipo) return tipo;
  if (/^Truck\s*\/\s*Tra/i.test(tipo) && tipo !== 'Truck / Tração') return 'Truck / Tração';
  if (tipo.includes('\uFFFD') || tipo.includes('�')) {
    return tipo
      .replace(/Truck\s*\/\s*Tra.+?o/i, 'Truck / Tração')
      .replace(/Caminh.?o/gi, 'Caminhão')
      .replace(/Utilit.?rio/gi, 'Utilitário')
      .replace(/Ve.?culo/gi, 'Veículo');
  }
  return tipo;
}

function numOrNull(id) {
  const v = parseFloat(document.getElementById(id)?.value);
  return Number.isFinite(v) ? v : null;
}

function atualizarPreviewLimites() {
  const critico = parseFloat(document.getElementById('cfg-critico')?.value) || limitesAtuais.sulco_critico_mm;
  const recap = parseFloat(document.getElementById('cfg-recap')?.value) || limitesAtuais.sulco_recap_mm;
  const monitorar = parseFloat(document.getElementById('cfg-alerta')?.value) || limitesAtuais.sulco_alerta_mm;

  const elCritico = document.getElementById('preview-critico');
  const elRecap = document.getElementById('preview-recap');
  const elAlerta = document.getElementById('preview-alerta');
  const elOk = document.getElementById('preview-ok');
  if (elCritico) elCritico.textContent = `< ${critico} mm`;
  if (elRecap) elRecap.textContent = `${critico} – ${recap} mm`;
  if (elAlerta) elAlerta.textContent = `${recap} – ${monitorar} mm`;
  if (elOk) elOk.textContent = `> ${monitorar} mm`;

  const hintRecap = document.getElementById('hint-faixa-recap');
  const hintMon = document.getElementById('hint-faixa-monitorar');
  const hintOk = document.getElementById('hint-faixa-ok');
  if (hintRecap) hintRecap.textContent = `De ${critico} mm até ${recap} mm`;
  if (hintMon) hintMon.textContent = `De ${recap} mm até ${monitorar} mm`;
  if (hintOk) hintOk.textContent = `Acima de ${monitorar} mm`;

  const trocaL = document.getElementById('cfg-acao-troca-label')?.value?.trim() || 'Troca';
  const recapL = document.getElementById('cfg-acao-recap-label')?.value?.trim() || 'Recapagem';
  const monL = document.getElementById('cfg-acao-monitorar-label')?.value?.trim() || 'Monitorar';
  const okL = document.getElementById('cfg-acao-ok-label')?.value?.trim() || 'OK';
  const trocaI = document.getElementById('cfg-acao-troca-instrucao')?.value?.trim() || '—';
  const recapI = document.getElementById('cfg-acao-recap-instrucao')?.value?.trim() || '—';
  const monI = document.getElementById('cfg-acao-monitorar-instrucao')?.value?.trim() || '—';
  const okI = document.getElementById('cfg-acao-ok-instrucao')?.value?.trim() || '—';

  const setTxt = (id, txt) => {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  };
  setTxt('preview-label-troca', trocaL);
  setTxt('preview-label-recap', recapL);
  setTxt('preview-label-monitorar', monL);
  setTxt('preview-label-ok', okL);
  setTxt('leg-troca-label', `${trocaL}:`);
  setTxt('leg-recap-label', `${recapL}:`);
  setTxt('leg-monitorar-label', `${monL}:`);
  setTxt('leg-ok-label', `${okL}:`);
  setTxt('leg-troca-instrucao', trocaI);
  setTxt('leg-recap-instrucao', recapI);
  setTxt('leg-monitorar-instrucao', monI);
  setTxt('leg-ok-instrucao', okI);
}

function hintLimites() {
  const { sulco_critico_mm: c, sulco_alerta_mm: a, sulco_recap_mm: r, acoes } = limitesAtuais;
  const t = acoes?.troca?.label || 'Troca';
  const rc = acoes?.recap?.label || 'Recap';
  const m = acoes?.monitorar?.label || 'Monitorar';
  const o = acoes?.ok?.label || 'OK';
  return `< ${c} mm → ${t} · ${c}–${r} mm → ${rc} · ${r}–${a} mm → ${m} · > ${a} mm → ${o}`;
}

function mostrarAcaoInstrucao(pneuOuResult) {
  const el = document.getElementById('truck-acao-instrucao');
  if (!el) return;
  const texto = pneuOuResult?.acao_motivo
    || pneuOuResult?.acao_instrucao
    || limitesAtuais.acoes?.[pneuOuResult?.acao_sugerida]?.instrucao
    || '';
  const codigo = pneuOuResult?.acao_sugerida || 'ok';
  if (!texto) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.textContent = texto;
  el.className = 'acao-instrucao';
  if (codigo === 'troca') el.classList.add('critico');
  else if (codigo === 'recap') el.classList.add('recap');
  else if (codigo === 'monitorar') el.classList.add('alerta');
  else if (codigo === 'rodizio') el.classList.add('rodizio');
  el.classList.remove('hidden');
}

function mostrarRodizioSugestao(pneuOuResult) {
  const el = document.getElementById('truck-rodizio-sugestao');
  if (!el) return;
  const sug = pneuOuResult?.rodizio_sugestao;
  if (!sug || pneuOuResult?.acao_sugerida !== 'rodizio') {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `
    <strong>Par sugerido para rodízio</strong>
    ${sug.label || 'Outro pneu'}
    ${sug.motivo ? `<br><span class="hint">${sug.motivo}</span>` : ''}
  `;
  el.classList.remove('hidden');
}

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  const el = document.getElementById(`view-${name}`);
  if (el) el.classList.add('active');
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.view === name);
  });
}

function showLogin() {
  document.getElementById('app-login').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('hidden');
}

function showAppShell() {
  document.getElementById('app-login').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');

  const navFilial = document.getElementById('nav-tabs-filial');
  const navAdmin = document.getElementById('nav-tabs-admin');
  const label = document.getElementById('header-user-label');
  const subtitle = document.getElementById('header-subtitle');

  if (isAdmin()) {
    navFilial.classList.add('hidden');
    navAdmin.classList.remove('hidden');
    label.textContent = `Admin · ${currentUser.login}`;
    subtitle.textContent = 'Painel administrativo — situação das filiais';
    document.getElementById('btn-salvar-config')?.classList.remove('hidden');
  } else {
    navAdmin.classList.add('hidden');
    navFilial.classList.remove('hidden');
    const nomeFilial = currentUser.filial?.nome || currentUser.filial?.codigo || 'Filial';
    label.textContent = `${nomeFilial} · ${currentUser.login}`;
    subtitle.textContent = 'Medições semanais e alertas da sua frota';
    document.getElementById('btn-salvar-config')?.classList.add('hidden');
  }
}

function syncMarkersLimites() {
  tireMarker?.setLimites?.(limitesAtuais);
  truckTireMarker?.setLimites?.(limitesAtuais);
}

function pontosFromInputs(prefix) {
  if (prefix === 'truck') {
    return {
      externo: numOrNull('truck-sulco-ext'),
      central: numOrNull('truck-sulco-cent'),
      interno: numOrNull('truck-sulco-int'),
      auxiliar: numOrNull('truck-sulco-aux'),
    };
  }
  return {
    externo: numOrNull('med-externo'),
    central: numOrNull('med-central'),
    interno: numOrNull('med-interno'),
    auxiliar: numOrNull('med-auxiliar'),
  };
}

function atualizarPerfilLocal(containerId, pontos, diagnostico = null) {
  renderPerfilSulco(containerId, pontos, limitesAtuais, diagnostico);
}

// ── Navegação ────────────────────────────────────────────

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const view = tab.dataset.view;
    showView(view);
    if (view === 'dashboard') loadDashboard();
    if (view === 'veiculos') loadVeiculos();
    if (view === 'pneus') loadPneus();
    if (view === 'medicao') initMedicao();
    if (view === 'alertas') loadAlertas();
    if (view === 'acoes') loadAcoes();
    if (view === 'configuracoes') {
      if (!isAdmin()) {
        toast('Limites são definidos pelo administrador', 'error');
        showView('dashboard');
        loadDashboard();
        return;
      }
      loadConfiguracoes();
    }
    if (view === 'filiais') loadFiliais();
    if (view === 'whatsapp') loadWhatsApp();
  });
});

document.getElementById('btn-logout')?.addEventListener('click', () => {
  clearAuth();
  showLogin();
  toast('Sessão encerrada');
});

document.getElementById('form-login')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const erro = document.getElementById('login-erro');
  erro.classList.add('hidden');
  try {
    const data = await fetchJSON(`${API}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({
        login: document.getElementById('login-user').value,
        senha: document.getElementById('login-senha').value,
      }),
    });
    saveAuth(data.token, data.usuario);
    document.getElementById('login-senha').value = '';
    await bootApp();
  } catch (err) {
    erro.textContent = err.message;
    erro.classList.remove('hidden');
  }
});

document.getElementById('btn-voltar-dashboard').addEventListener('click', () => {
  showView(voltarPara);
  if (voltarPara === 'dashboard') loadDashboard();
  else if (voltarPara === 'acoes') loadAcoes();
  else loadVeiculos();
});

async function fetchDashboardResumo() {
  try {
    return await fetchJSON(`${API}/dashboard/resumo`);
  } catch {
    const veiculos = await fetchJSON(`${API}/veiculos`);
    return {
      veiculos_ativos: veiculos.length,
      pneus_ok: 0,
      pneus_alerta: 0,
      pneus_critico: 0,
      acoes: { troca: 0, recap: 0, monitorar: 0 },
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
    limitesAtuais = { ...limitesAtuais, ...resumo.limites };
    syncMarkersLimites();

    document.getElementById('stat-veiculos').textContent = resumo.veiculos_ativos;
    document.getElementById('stat-ok').textContent = resumo.pneus_ok;
    document.getElementById('stat-alerta').textContent = resumo.pneus_alerta;
    document.getElementById('stat-critico').textContent = resumo.pneus_critico;
    document.getElementById('stat-troca').textContent = resumo.acoes?.troca ?? 0;
    document.getElementById('stat-recap').textContent = resumo.acoes?.recap ?? 0;
    document.getElementById('stat-monitorar').textContent = resumo.acoes?.monitorar ?? 0;

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

async function openVeiculoDetalhe(id, origem = 'dashboard', dadosPreload = null) {
  voltarPara = origem;
  try {
    const v = dadosPreload || await fetchJSON(`${API}/veiculos/${id}`);
    veiculoAtual = v;
    veiculoLayoutId = v.id;

    if (v.posicoes) meta = { ...meta, posicoes: v.posicoes };
    if (v.limites) {
      limitesAtuais = { ...limitesAtuais, ...v.limites };
      syncMarkersLimites();
    }

    const layoutInfo = getLayoutById(v.layout_pneus);
    const nPos = v.posicoes_layout?.length || v.layout?.posicoes?.length || v.pneus.length;
    document.getElementById('truck-header').innerHTML = `
      <h2>${v.apelido || v.placa}</h2>
      <p class="hint">${v.placa} · ${normalizarTipoLabel(v.tipo)} · ${v.km_atual?.toLocaleString('pt-BR') || 0} km
        ${v.hr_atual ? ` · ${v.hr_atual} h` : ''}
        · ${layoutInfo?.nome || 'Personalizado'}
        · ${v.pneus.length}/${nPos} pneus montados</p>
    `;

    const barRapido = document.getElementById('acesso-rapido-bar');
    if (barRapido) barRapido.classList.toggle('hidden', !modoAcessoRapido);

    const btnVoltar = document.getElementById('btn-voltar-dashboard');
    if (btnVoltar) btnVoltar.classList.toggle('hidden', modoAcessoRapido);

    const banner = document.getElementById('truck-fluxo-banner');
    if (banner) {
      if (modoAcessoRapido) {
        banner.classList.remove('hidden');
        banner.innerHTML = `
          <strong>Medição via WhatsApp</strong>
          Clique em um pneu montado para registrar o sulco. Montagem e descarte ficam disponíveis no sistema completo.`;
      } else if (v.pneus.length === 0) {
        banner.classList.remove('hidden');
        banner.innerHTML = `
          <strong>Clique em uma posição vazia para colocar o pneu</strong>
          Não precisa ir na aba Pneus: no slot (+) você cria e monta na hora.
          Se já tiver pneu no estoque, use a aba “Do estoque”.`;
      } else if (v.pneus.length < nPos) {
        banner.classList.remove('hidden');
        banner.innerHTML = `
          <strong>${v.pneus.length} de ${nPos} posições com pneu</strong>
          Clique em um slot vazio (+) para colocar o próximo.`;
      } else {
        banner.classList.add('hidden');
        banner.innerHTML = '';
      }
    }

    document.getElementById('historico-pneu').innerHTML = '';
    document.getElementById('truck-panel-form').classList.add('hidden');
    document.querySelector('.truck-panel-empty').classList.remove('hidden');
    pneuSelecionado = null;
    slotPosicaoSelecionada = null;

    const posicoesLayout = v.posicoes_layout?.length
      ? v.posicoes_layout.map((p) => p.codigo)
      : (v.layout?.posicoes || v.pneus.map((p) => p.posicao));

    if (!truckDiagram) {
      truckDiagram = new TruckDiagram('truck-diagram-container', {
        onPneuClick: (pneu) => selecionarPneuTruck(pneu),
        onSlotClick: (posicao) => selecionarSlotVazio(posicao),
      });
    }
    truckDiagram.render(v.pneus, meta.posicoes, posicoesLayout);

    document.getElementById('truck-km').value = v.km_atual || '';
    document.getElementById('truck-hr').value = v.hr_atual || '';
    document.getElementById('btn-truck-config').onclick = () => {
      if (modoAcessoRapido) return toast('Indisponível no acesso rápido', 'error');
      abrirConfigLayout(
        v.id,
        v.apelido || v.placa,
        v.layout_pneus,
        posicoesLayout
      );
    };

    const btnWa = document.getElementById('btn-truck-whatsapp');
    if (btnWa) {
      btnWa.classList.toggle('hidden', modoAcessoRapido);
      btnWa.onclick = () => gerarLinkWhatsApp(v.id, v.placa);
    }

    aplicarVisibilidadeAcessoRapido();
    showView('veiculo-detalhe');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function labelPadraoPneu(codigo) {
  const map = {
    direcional: 'Direcional',
    misto: 'Misto (tração)',
    borrachudo: 'Borrachudo',
  };
  return map[codigo] || codigo || '—';
}

function formatUltimaMedicaoSulco(pneu) {
  const u = pneu.ultima_medicao;
  const menor = pneu.menor_sulco ?? u?.menor_sulco;
  const data = u?.data || pneu.ult_medicao;
  if (menor == null && !data) return 'Sem medição';
  const pts = [
    u?.sulco_externo ?? pneu.ult_sulco_ext,
    u?.sulco_central ?? pneu.ult_sulco_cent,
    u?.sulco_interno ?? pneu.ult_sulco_int,
    u?.sulco_auxiliar ?? pneu.ult_sulco_aux,
  ].map((v) => (v != null ? `${v}` : '—')).join(' · ');
  const dataTxt = data ? formatDate(data) : '—';
  return `${menor != null ? `${menor} mm` : '—'} (${pts}) · ${dataTxt}`;
}

function atualizarResumoPneuTruck(pneu) {
  const partes = [];
  if (pneu.numero_fogo) partes.push(`Fogo ${pneu.numero_fogo}`);
  if (pneu.marca) partes.push(pneu.marca);
  if (pneu.dot) partes.push(`DOT ${pneu.dot}`);
  document.getElementById('truck-pneu-resumo').textContent = partes.length
    ? partes.join(' · ')
    : 'Pneu montado nesta posição';

  const elPadrao = document.getElementById('truck-pneu-padrao');
  const elCond = document.getElementById('truck-pneu-condicao-label');
  const elSulco = document.getElementById('truck-pneu-ultima-sulco');
  if (elPadrao) elPadrao.textContent = pneu.padrao_label || labelPadraoPneu(pneu.tipo_pneu);
  if (elCond) elCond.textContent = pneu.vida_label || (pneu.condicao === 'recapado' ? 'Recapado' : 'Novo');
  if (elSulco) elSulco.textContent = formatUltimaMedicaoSulco(pneu);
}

function aplicarVisibilidadeAcessoRapido() {
  const idsOps = [
    'btn-truck-desmontar',
    'btn-truck-recap',
    'btn-truck-troca',
    'btn-truck-config',
  ];
  idsOps.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', modoAcessoRapido);
  });
  const montarBox = document.getElementById('truck-montar-box');
  if (montarBox && modoAcessoRapido) montarBox.classList.add('hidden');
}

async function gerarLinkWhatsApp(veiculoId, placa) {
  try {
    const data = await fetchJSON(`${API}/veiculos/${veiculoId}/link-whatsapp`);
    const texto = `🚛 *${data.placa || placa}*\n👉 ${data.link}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank');
    toast('Link gerado — abrindo WhatsApp', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function selecionarPneuTruck(pneu) {
  pneuSelecionado = pneu;
  slotPosicaoSelecionada = null;
  document.querySelector('.truck-panel-empty').classList.add('hidden');
  document.getElementById('truck-panel-form').classList.remove('hidden');
  document.getElementById('truck-montar-box').classList.add('hidden');
  document.getElementById('truck-medicao-box').classList.remove('hidden');

  const nome = meta.posicoes[pneu.posicao] || pneu.posicao_label || pneu.posicao;
  document.getElementById('truck-pneu-nome').textContent =
    `${nome}${pneu.numero_fogo ? ` · Fogo ${pneu.numero_fogo}` : ''}`;
  document.getElementById('truck-pneu-status').innerHTML = badge(pneu.status_sulco);
  document.getElementById('truck-pneu-acao').innerHTML = badgeAcao(pneu.acao_sugerida, pneu.acao_label);
  document.getElementById('truck-pneu-vida').innerHTML = pneu.vida_label
    ? `<span class="badge badge-vida">${pneu.vida_label}${pneu.vida_util_pct != null ? ` · ${pneu.vida_util_pct}%` : ''}</span>`
    : '';

  atualizarResumoPneuTruck(pneu);

  document.getElementById('truck-sulco-ext').value = pneu.ult_sulco_ext ?? '';
  document.getElementById('truck-sulco-cent').value = pneu.ult_sulco_cent ?? '';
  document.getElementById('truck-sulco-int').value = pneu.ult_sulco_int ?? '';
  document.getElementById('truck-sulco-aux').value = pneu.ult_sulco_aux ?? '';
  document.getElementById('truck-pressao').value = '';
  document.getElementById('truck-save-status').textContent = 'Preencha os sulcos — salva automaticamente';
  document.getElementById('truck-save-status').className = 'hint save-status';
  document.getElementById('truck-diagnostico').textContent = pneu.diagnostico_label
    ? `Diagnóstico: ${pneu.diagnostico_label}`
    : '';
  mostrarAcaoInstrucao(pneu);
  mostrarRodizioSugestao(pneu);

  const pontos = {
    externo: pneu.ult_sulco_ext,
    central: pneu.ult_sulco_cent,
    interno: pneu.ult_sulco_int,
    auxiliar: pneu.ult_sulco_aux,
  };
  atualizarPerfilLocal('truck-perfil', pontos, {
    label: pneu.diagnostico_label,
    desc: pneu.acao_motivo,
  });

  if (!truckTireMarker) {
    truckTireMarker = new TireMarker('truck-mini-marker', {
      limites: limitesAtuais,
      onSulcoClick: (sulco) => {
        const map = {
          externo: 'truck-sulco-ext',
          central: 'truck-sulco-cent',
          interno: 'truck-sulco-int',
          auxiliar: 'truck-sulco-aux',
        };
        const input = document.getElementById(map[sulco]);
        if (!input) return;
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        input.focus({ preventScroll: true });
        input.select();
      },
    });
  }
  truckTireMarker.setLimites(limitesAtuais);
  truckTireMarker.setValores(
    pneu.ult_sulco_ext,
    pneu.ult_sulco_cent,
    pneu.ult_sulco_int,
    pneu.ult_sulco_aux
  );

  document.getElementById('btn-truck-historico').onclick = () => abrirHistoricoPneu(pneu.id);
  document.getElementById('btn-truck-desmontar').onclick = () => desmontarPneuTruck();
  document.getElementById('btn-truck-recap').onclick = () => registrarEventoPneu('recap');
  document.getElementById('btn-truck-troca').onclick = () => registrarEventoPneu('troca');
  aplicarVisibilidadeAcessoRapido();
}

async function selecionarSlotVazio(posicao) {
  if (modoAcessoRapido) {
    toast('Montagem de pneus não está disponível no acesso rápido. Use o sistema completo.', 'error');
    return;
  }
  pneuSelecionado = null;
  slotPosicaoSelecionada = posicao;
  document.querySelector('.truck-panel-empty').classList.add('hidden');
  document.getElementById('truck-panel-form').classList.remove('hidden');
  document.getElementById('truck-montar-box').classList.remove('hidden');
  document.getElementById('truck-medicao-box').classList.add('hidden');

  const nome = meta.posicoes[posicao] || posicao;
  document.getElementById('truck-pneu-nome').textContent = `${nome} — vazio`;
  document.getElementById('truck-pneu-status').innerHTML = '';
  document.getElementById('truck-pneu-acao').innerHTML = '';
  document.getElementById('truck-pneu-vida').innerHTML = '';

  resetFormMontarNovo();
  setMontarTab('novo');
  await carregarSelectEstoque();
}

function resetFormMontarNovo() {
  const fogo = document.getElementById('truck-novo-fogo');
  if (fogo) fogo.value = '';
  const tipo = document.getElementById('truck-novo-tipo');
  if (tipo) tipo.value = 'misto';
  const cond = document.getElementById('truck-novo-condicao');
  if (cond) cond.value = 'novo';
  const marca = document.getElementById('truck-novo-marca');
  if (marca) marca.value = '';
  const dot = document.getElementById('truck-novo-dot');
  if (dot) dot.value = '';
  const vida = document.getElementById('truck-novo-vida');
  if (vida) vida.value = '0';
  const sulco = document.getElementById('truck-novo-sulco');
  if (sulco) sulco.value = '';
  const avancado = document.querySelector('#truck-montar-novo .form-avancado');
  if (avancado) avancado.open = false;
}

function setMontarTab(tab) {
  document.querySelectorAll('.montar-tab').forEach((btn) => {
    btn.classList.toggle('ativo', btn.dataset.montarTab === tab);
  });
  document.getElementById('truck-montar-novo')?.classList.toggle('hidden', tab !== 'novo');
  document.getElementById('truck-montar-estoque')?.classList.toggle('hidden', tab !== 'estoque');
}

async function criarEMontarPneuTruck() {
  if (!veiculoAtual || !slotPosicaoSelecionada) return;
  const fogo = document.getElementById('truck-novo-fogo')?.value?.trim();
  if (!fogo) return toast('Informe o nº de fogo', 'error');

  const btn = document.getElementById('btn-truck-criar-montar');
  if (btn) btn.disabled = true;
  try {
    const criado = await fetchJSON(`${API}/pneus`, {
      method: 'POST',
      body: JSON.stringify({
        numero_fogo: fogo,
        tipo_pneu: document.getElementById('truck-novo-tipo')?.value || 'misto',
        condicao: document.getElementById('truck-novo-condicao')?.value || 'novo',
        marca: document.getElementById('truck-novo-marca')?.value || null,
        dot: document.getElementById('truck-novo-dot')?.value || null,
        vida_recap: parseInt(document.getElementById('truck-novo-vida')?.value || '0', 10),
        sulco_inicial_mm: numOrNull('truck-novo-sulco'),
      }),
    });
    const pneuId = criado.pneu?.id || criado.id;
    if (!pneuId) throw new Error('Pneu criado sem id');

    await fetchJSON(`${API}/pneus/${pneuId}/montar`, {
      method: 'POST',
      body: JSON.stringify({
        veiculo_id: veiculoAtual.id,
        posicao: slotPosicaoSelecionada,
        km_veiculo: veiculoAtual.km_atual,
      }),
    });
    toast('Pneu criado e montado');
    const pos = slotPosicaoSelecionada;
    await openVeiculoDetalhe(veiculoAtual.id, voltarPara);
    const montado = veiculoAtual.pneus.find((p) => p.posicao === pos);
    if (montado) {
      truckDiagram?.setAtivo(montado.id);
      selecionarPneuTruck(montado);
    }
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function carregarSelectEstoque() {
  const select = document.getElementById('truck-estoque-select');
  try {
    const lista = await fetchJSON(`${API}/pneus?status=estoque`);
    if (!lista.length) {
      select.innerHTML = '<option value="">Nenhum pneu no estoque</option>';
      return;
    }
    select.innerHTML = '<option value="">Selecione...</option>' + lista.map((p) => {
      const label = [
        p.numero_fogo ? `Fogo ${p.numero_fogo}` : `#${p.id}`,
        p.marca,
        p.condicao === 'recapado' ? (p.vida_label || 'Recap') : 'Novo',
        p.padrao_label || labelPadraoPneu(p.tipo_pneu),
      ].filter(Boolean).join(' · ');
      return `<option value="${p.id}">${label}</option>`;
    }).join('');
  } catch (err) {
    select.innerHTML = `<option value="">Erro: ${err.message}</option>`;
  }
}

async function montarPneuDoEstoque() {
  if (!veiculoAtual || !slotPosicaoSelecionada) return;
  const pneuId = parseInt(document.getElementById('truck-estoque-select').value, 10);
  if (!pneuId) return toast('Selecione um pneu do estoque', 'error');

  try {
    await fetchJSON(`${API}/pneus/${pneuId}/montar`, {
      method: 'POST',
      body: JSON.stringify({
        veiculo_id: veiculoAtual.id,
        posicao: slotPosicaoSelecionada,
        km_veiculo: veiculoAtual.km_atual,
      }),
    });
    toast('Pneu montado');
    const pos = slotPosicaoSelecionada;
    await openVeiculoDetalhe(veiculoAtual.id, voltarPara);
    const montado = veiculoAtual.pneus.find((p) => p.posicao === pos);
    if (montado) {
      truckDiagram?.setAtivo(montado.id);
      selecionarPneuTruck(montado);
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function desmontarPneuTruck() {
  if (!pneuSelecionado || !veiculoAtual) return;
  if (!confirm('Desmontar este pneu e enviar ao estoque?')) return;
  try {
    await fetchJSON(`${API}/pneus/${pneuSelecionado.id}/desmontar`, {
      method: 'POST',
      body: JSON.stringify({ km_veiculo: veiculoAtual.km_atual }),
    });
    toast('Pneu desmontado → estoque');
    await openVeiculoDetalhe(veiculoAtual.id, voltarPara);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function syncTruckMarkerFromInputs() {
  if (!truckTireMarker) return;
  const p = pontosFromInputs('truck');
  truckTireMarker.setValores(p.externo, p.central, p.interno, p.auxiliar);
  atualizarPerfilLocal('truck-perfil', p);
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

  const pontos = pontosFromInputs('truck');
  const pressao = numOrNull('truck-pressao');
  const km = parseInt(document.getElementById('truck-km').value, 10);
  const hr = numOrNull('truck-hr');

  if (pontos.externo == null && pontos.central == null && pontos.interno == null && pontos.auxiliar == null) {
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
        km_veiculo: Number.isFinite(km) ? km : (veiculoAtual.km_atual || null),
        hr_veiculo: hr,
        sulco_externo: pontos.externo,
        sulco_central: pontos.central,
        sulco_interno: pontos.interno,
        sulco_auxiliar: pontos.auxiliar,
        pressao_psi: pressao,
        marcacao_json: truckTireMarker?.getValores(),
        ...(modoAcessoRapido && tokenAcessoRapido
          ? { token_acesso: tokenAcessoRapido }
          : {}),
      }),
    });

    pneuSelecionado = {
      ...pneuSelecionado,
      ult_sulco_ext: pontos.externo,
      ult_sulco_cent: pontos.central,
      ult_sulco_int: pontos.interno,
      ult_sulco_aux: pontos.auxiliar,
      menor_sulco: result.menor_sulco,
      status_sulco: result.status_sulco,
      diagnostico: result.diagnostico,
      diagnostico_label: result.diagnostico_label,
      acao_sugerida: result.acao_sugerida,
      acao_label: result.acao_label,
      acao_motivo: result.acao_motivo,
      desvio_mm: result.desvio_mm,
      rodizio_sugestao: result.rodizio_sugestao || null,
      ultima_medicao: {
        data: new Date().toISOString().split('T')[0],
        sulco_externo: pontos.externo,
        sulco_central: pontos.central,
        sulco_interno: pontos.interno,
        sulco_auxiliar: pontos.auxiliar,
        menor_sulco: result.menor_sulco,
      },
    };

    const idx = veiculoAtual.pneus.findIndex((p) => p.id === pneuSelecionado.id);
    if (idx >= 0) veiculoAtual.pneus[idx] = { ...veiculoAtual.pneus[idx], ...pneuSelecionado };

    truckDiagram.atualizarPneu(pneuSelecionado, meta.posicoes);
    document.getElementById('truck-pneu-status').innerHTML = badge(result.status_sulco);
    document.getElementById('truck-pneu-acao').innerHTML = badgeAcao(result.acao_sugerida, result.acao_label);
    document.getElementById('truck-diagnostico').textContent =
      result.diagnostico_label ? `Diagnóstico: ${result.diagnostico_label}` : '';
    mostrarAcaoInstrucao({
      acao_sugerida: result.acao_sugerida,
      acao_motivo: result.acao_motivo,
      rodizio_sugestao: result.rodizio_sugestao,
    });
    mostrarRodizioSugestao({
      acao_sugerida: result.acao_sugerida,
      rodizio_sugestao: result.rodizio_sugestao,
    });
    atualizarResumoPneuTruck(pneuSelecionado);
    atualizarPerfilLocal('truck-perfil', pontos, {
      label: result.diagnostico_label,
      desc: result.acao_motivo,
    });

    const acaoTxt = result.acao_sugerida !== 'ok' ? ` · ${result.acao_label}` : '';
    status.textContent = result.status_sulco === 'critico'
      ? `Salvo! Crítico — ${result.menor_sulco} mm${acaoTxt}`
      : `Salvo — menor sulco: ${result.menor_sulco ?? '-'} mm${acaoTxt}`;
    status.className = `hint save-status ${result.status_sulco === 'critico' ? 'erro' : 'salvo'}`;
  } catch (err) {
    status.textContent = err.message;
    status.className = 'hint save-status erro';
  }
}

async function registrarEventoPneu(tipo) {
  if (!pneuSelecionado || !veiculoAtual) return;
  const label = tipo === 'recap' ? 'recapagem (volta ao estoque)' : 'descarte';
  if (!confirm(`Registrar ${label} deste pneu?`)) return;

  try {
    const pontos = pontosFromInputs('truck');
    const menor = [pontos.externo, pontos.central, pontos.interno, pontos.auxiliar]
      .filter((v) => v != null);
    const sulco = menor.length ? Math.min(...menor) : pneuSelecionado.menor_sulco;

    const result = await fetchJSON(`${API}/pneus/${pneuSelecionado.id}/evento`, {
      method: 'POST',
      body: JSON.stringify({
        tipo,
        km_veiculo: parseInt(document.getElementById('truck-km').value, 10) || veiculoAtual.km_atual,
        hr_veiculo: numOrNull('truck-hr'),
        sulco_mm: tipo === 'recap' ? (limitesAtuais.sulco_novo_mm || 14) : sulco,
        detalhes: `Registrado pelo painel do veículo`,
      }),
    });

    toast(result.mensagem, 'success');
    openVeiculoDetalhe(veiculoAtual.id, voltarPara);
  } catch (err) {
    toast(err.message, 'error');
  }
}

['truck-sulco-ext', 'truck-sulco-cent', 'truck-sulco-int', 'truck-sulco-aux', 'truck-pressao', 'truck-km', 'truck-hr']
  .forEach((id) => {
    document.getElementById(id)?.addEventListener('input', () => {
      syncTruckMarkerFromInputs();
      agendarAutoSave();
    });
  });

document.getElementById('btn-truck-montar')?.addEventListener('click', montarPneuDoEstoque);
document.getElementById('btn-truck-criar-montar')?.addEventListener('click', criarEMontarPneuTruck);
document.querySelectorAll('.montar-tab').forEach((btn) => {
  btn.addEventListener('click', () => setMontarTab(btn.dataset.montarTab));
});
document.getElementById('link-ir-pneus')?.addEventListener('click', (e) => {
  e.preventDefault();
  showView('pneus');
  loadPneus();
});

// ── Aba Pneus (estoque) ─────────────────────────────────

async function loadPneus() {
  const status = document.getElementById('pneus-filtro-status')?.value || 'estoque';
  const q = document.getElementById('pneus-busca')?.value?.trim() || '';
  const lista = document.getElementById('pneus-lista');
  try {
    const params = new URLSearchParams({ status });
    if (q) params.set('q', q);
    const pneus = await fetchJSON(`${API}/pneus?${params}`);
    if (!pneus.length) {
      lista.innerHTML = `
        <div class="empty-state">
          <h3>Nenhum pneu encontrado</h3>
          <p>Cadastre pneus no estoque e depois monte no caminhão para medir.</p>
        </div>`;
      return;
    }
    lista.innerHTML = pneus.map((p) => {
      const onde = p.status_pneu === 'montado'
        ? `${p.veiculo_placa || 'Veículo'}${p.posicao ? ` · ${p.posicao}` : ''}`
        : 'Estoque';
      return `
        <article class="pneu-card card">
          <div class="pneu-card-main">
            <h3>Fogo ${p.numero_fogo || '—'}</h3>
            <p class="hint">${[p.marca, p.dot ? `DOT ${p.dot}` : null, p.vida_label].filter(Boolean).join(' · ')}</p>
            <p class="hint">${onde} · ${p.padrao_label || labelPadraoPneu(p.tipo_pneu)}
              ${p.menor_sulco != null ? ` · sulco ${p.menor_sulco} mm` : ' · sem medição'}
              ${p.ultima_medicao?.data ? ` · ${formatDate(p.ultima_medicao.data)}` : ''}</p>
          </div>
          <div class="pneu-card-actions">
            ${badge(p.status_sulco)}
            <span class="badge badge-vida">${p.status_pneu}</span>
            ${p.status_pneu === 'estoque'
              ? `<button type="button" class="btn btn-primary btn-sm" data-montar-pneu="${p.id}" data-fogo="${p.numero_fogo || ''}">Montar</button>`
              : ''}
            <button type="button" class="btn btn-ghost btn-sm" data-edit-pneu="${p.id}">Editar</button>
            ${p.status_pneu === 'montado'
              ? `<button type="button" class="btn btn-ghost btn-sm" data-desmontar-pneu="${p.id}">Desmontar</button>`
              : ''}
            <button type="button" class="btn btn-ghost btn-sm" data-hist-pneu="${p.id}">Histórico</button>
          </div>
        </article>`;
    }).join('');

    lista.querySelectorAll('[data-montar-pneu]').forEach((btn) => {
      btn.addEventListener('click', () => {
        abrirModalMontar(parseInt(btn.dataset.montarPneu, 10), btn.dataset.fogo || '');
      });
    });
    lista.querySelectorAll('[data-edit-pneu]').forEach((btn) => {
      btn.addEventListener('click', () => abrirModalPneu(parseInt(btn.dataset.editPneu, 10)));
    });
    lista.querySelectorAll('[data-desmontar-pneu]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Desmontar e enviar ao estoque?')) return;
        try {
          await fetchJSON(`${API}/pneus/${btn.dataset.desmontarPneu}/desmontar`, { method: 'POST', body: '{}' });
          toast('Pneu no estoque');
          loadPneus();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });
    lista.querySelectorAll('[data-hist-pneu]').forEach((btn) => {
      btn.addEventListener('click', () => abrirHistoricoPneu(parseInt(btn.dataset.histPneu, 10)));
    });
  } catch (err) {
    lista.innerHTML = `<p class="hint erro">${err.message}</p>`;
  }
}

function setTipoCondicaoEditaveis(editavel) {
  const tipo = document.getElementById('pneu-tipo');
  const cond = document.getElementById('pneu-condicao');
  if (tipo) tipo.disabled = !editavel;
  if (cond) cond.disabled = !editavel;
  const hintTipo = document.getElementById('pneu-tipo-hint');
  const hintCond = document.getElementById('pneu-condicao-hint');
  if (hintTipo) {
    hintTipo.textContent = editavel
      ? 'Direcional = dianteira · Misto/Borrachudo = tração'
      : 'Padrão fixo (não pode alterar)';
  }
  if (hintCond) {
    hintCond.textContent = editavel
      ? 'Não muda depois (exceto via Registrar recap)'
      : 'Condição fixa — use Registrar recap';
  }
}

function abrirModalPneuNovo() {
  document.getElementById('modal-pneu-titulo').textContent = 'Novo pneu no estoque';
  document.getElementById('pneu-edit-id').value = '';
  document.getElementById('form-pneu').reset();
  document.getElementById('pneu-tipo').value = 'misto';
  document.getElementById('pneu-condicao').value = 'novo';
  document.getElementById('pneu-vida').value = '0';
  const avancado = document.getElementById('pneu-avancado');
  if (avancado) avancado.open = false;
  setTipoCondicaoEditaveis(true);
  document.getElementById('modal-pneu').showModal();
}

async function abrirModalPneu(id) {
  try {
    const p = await fetchJSON(`${API}/pneus/${id}`);
    document.getElementById('modal-pneu-titulo').textContent = 'Editar pneu';
    document.getElementById('pneu-edit-id').value = String(p.id);
    document.getElementById('pneu-fogo').value = p.numero_fogo || '';
    document.getElementById('pneu-dot').value = p.dot || '';
    document.getElementById('pneu-marca').value = p.marca || '';
    document.getElementById('pneu-tipo').value = p.tipo_pneu || 'misto';
    document.getElementById('pneu-condicao').value = p.condicao || 'novo';
    document.getElementById('pneu-vida').value = String(p.vida_recap ?? 0);
    document.getElementById('pneu-sulco-inicial').value = p.sulco_inicial_mm ?? '';
    const avancado = document.getElementById('pneu-avancado');
    if (avancado) {
      avancado.open = !!(p.dot || p.marca || p.sulco_inicial_mm || (p.vida_recap > 0));
    }
    setTipoCondicaoEditaveis(false);
    document.getElementById('modal-pneu').showModal();
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.getElementById('btn-novo-pneu')?.addEventListener('click', abrirModalPneuNovo);
document.getElementById('btn-cancelar-pneu')?.addEventListener('click', () => {
  document.getElementById('modal-pneu').close();
});
document.getElementById('pneus-filtro-status')?.addEventListener('change', loadPneus);
let pneusBuscaTimer;
document.getElementById('pneus-busca')?.addEventListener('input', () => {
  clearTimeout(pneusBuscaTimer);
  pneusBuscaTimer = setTimeout(loadPneus, 300);
});

document.getElementById('form-pneu')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('pneu-edit-id').value;
  const payload = {
    numero_fogo: document.getElementById('pneu-fogo').value,
    dot: document.getElementById('pneu-dot').value,
    marca: document.getElementById('pneu-marca').value,
    vida_recap: parseInt(document.getElementById('pneu-vida').value, 10),
    sulco_inicial_mm: numOrNull('pneu-sulco-inicial'),
  };
  if (!id) {
    payload.tipo_pneu = document.getElementById('pneu-tipo').value;
    payload.condicao = document.getElementById('pneu-condicao').value;
  }
  try {
    if (id) {
      await fetchJSON(`${API}/pneus/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      toast('Pneu atualizado');
      document.getElementById('modal-pneu').close();
      loadPneus();
    } else {
      const result = await fetchJSON(`${API}/pneus`, { method: 'POST', body: JSON.stringify(payload) });
      document.getElementById('modal-pneu').close();
      document.getElementById('pneus-filtro-status').value = 'estoque';
      await loadPneus();
      const pneuId = result.pneu?.id;
      const fogo = result.pneu?.numero_fogo || payload.numero_fogo;
      if (pneuId) {
        abrirModalPneuPosCriar(pneuId, fogo);
      } else {
        toast('Pneu no estoque', 'success');
      }
    }
  } catch (err) {
    toast(err.message, 'error');
  }
});

function abrirModalPneuPosCriar(pneuId, fogo = '') {
  document.getElementById('pneu-pos-id').value = String(pneuId);
  document.getElementById('pneu-pos-fogo').value = fogo || '';
  document.getElementById('pneu-pos-label').textContent = fogo
    ? `Fogo ${fogo} está no estoque. Quer montar agora em um veículo?`
    : 'O pneu está no estoque. Quer montar agora em um veículo?';
  document.getElementById('modal-pneu-pos').showModal();
}

document.getElementById('btn-pos-montar')?.addEventListener('click', () => {
  const id = parseInt(document.getElementById('pneu-pos-id').value, 10);
  const fogo = document.getElementById('pneu-pos-fogo').value;
  document.getElementById('modal-pneu-pos').close();
  if (id) abrirModalMontar(id, fogo);
});

document.getElementById('btn-pos-estoque')?.addEventListener('click', () => {
  document.getElementById('modal-pneu-pos').close();
  toast('Pneu ficou no estoque', 'success');
});

async function abrirModalMontar(pneuId, fogo = '') {
  document.getElementById('montar-pneu-id').value = String(pneuId);
  document.getElementById('montar-pneu-label').textContent =
    fogo ? `Pneu fogo ${fogo}` : `Pneu #${pneuId}`;
  const selV = document.getElementById('montar-veiculo');
  const selP = document.getElementById('montar-posicao');
  selP.innerHTML = '<option value="">Selecione o veículo primeiro</option>';
  selP.disabled = true;
  try {
    const veiculos = veiculosCache.length ? veiculosCache : await fetchJSON(`${API}/veiculos`);
    veiculosCache = veiculos;
    selV.innerHTML = '<option value="">Selecione...</option>' +
      veiculos.map((v) =>
        `<option value="${v.id}">${v.apelido || v.placa} (${v.placa}) · ${v.total_pneus || 0} montados</option>`
      ).join('');
    if (veiculoAtual?.id) selV.value = String(veiculoAtual.id);
    document.getElementById('modal-montar').showModal();
    if (selV.value) selV.dispatchEvent(new Event('change'));
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.getElementById('btn-cancelar-montar')?.addEventListener('click', () => {
  document.getElementById('modal-montar').close();
});

document.getElementById('montar-veiculo')?.addEventListener('change', async (e) => {
  const veiculoId = e.target.value;
  const selP = document.getElementById('montar-posicao');
  if (!veiculoId) {
    selP.innerHTML = '<option value="">Selecione o veículo primeiro</option>';
    selP.disabled = true;
    return;
  }
  try {
    const v = await fetchJSON(`${API}/veiculos/${veiculoId}`);
    const vazias = (v.posicoes_layout || []).filter((p) => !p.montado);
    if (!vazias.length) {
      selP.innerHTML = '<option value="">Todas as posições já têm pneu</option>';
      selP.disabled = true;
      return;
    }
    selP.disabled = false;
    selP.innerHTML = '<option value="">Selecione...</option>' +
      vazias.map((p) =>
        `<option value="${p.codigo}">${p.codigo} — ${p.label || meta.posicoes[p.codigo] || p.codigo}</option>`
      ).join('');
  } catch (err) {
    toast(err.message, 'error');
  }
});

document.getElementById('form-montar')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const pneuId = parseInt(document.getElementById('montar-pneu-id').value, 10);
  const veiculoId = parseInt(document.getElementById('montar-veiculo').value, 10);
  const posicao = document.getElementById('montar-posicao').value;
  if (!pneuId || !veiculoId || !posicao) {
    return toast('Informe veículo e posição', 'error');
  }
  try {
    const result = await fetchJSON(`${API}/pneus/${pneuId}/montar`, {
      method: 'POST',
      body: JSON.stringify({ veiculo_id: veiculoId, posicao }),
    });
    document.getElementById('modal-montar').close();
    toast(result.mensagem || 'Pneu montado', 'success');
    await openVeiculoDetalhe(veiculoId, 'pneus');
    const montado = veiculoAtual?.pneus?.find((p) => p.posicao === posicao);
    if (montado) {
      truckDiagram?.setAtivo(montado.id);
      selecionarPneuTruck(montado);
    }
  } catch (err) {
    toast(err.message, 'error');
  }
});
async function abrirHistoricoPneu(pneuId) {
  try {
    let data;
    if (modoAcessoRapido) {
      const pneu = veiculoAtual?.pneus?.find((p) => Number(p.id) === Number(pneuId));
      const medicoes = (veiculoAtual?.medicoes || [])
        .filter((m) => Number(m.pneu_id) === Number(pneuId))
        .map((m) => ({
          ...m,
          menor_sulco: [m.sulco_externo, m.sulco_central, m.sulco_interno, m.sulco_auxiliar]
            .filter((v) => v != null)
            .reduce((min, v) => (min == null || v < min ? v : min), null),
          status_sulco: 'sem_dado',
        }));
      data = {
        id: pneuId,
        numero_fogo: pneu?.numero_fogo,
        posicao: pneu?.posicao,
        medicoes,
        movimentacoes: [],
      };
    } else {
      data = await fetchJSON(`${API}/pneus/${pneuId}`);
    }
    const viewPneus = document.getElementById('view-pneus')?.classList.contains('active');
    const el = viewPneus
      ? document.getElementById('pneu-historico-panel')
      : document.getElementById('historico-pneu');
    if (viewPneus && el) el.classList.remove('hidden');

    const titulo = `Histórico — ${data.numero_fogo ? `Fogo ${data.numero_fogo}` : `#${data.id}`}${data.posicao ? ` · ${meta.posicoes[data.posicao] || data.posicao}` : ' · estoque'}${data.padrao_label || data.tipo_pneu ? ` · ${data.padrao_label || labelPadraoPneu(data.tipo_pneu)}` : ''}`;

    if (!data.medicoes.length && !data.movimentacoes?.length) {
      el.innerHTML = `<div class="card"><h3>${titulo}</h3><p class="hint">Nenhuma medição ou movimentação registrada.</p></div>`;
      return;
    }

    el.innerHTML = `
      <div class="card">
      <h3>${titulo}</h3>
      ${data.medicoes.length ? `
      <table class="historico-table">
        <thead>
          <tr>
            <th>Data</th><th>1ª</th><th>2ª</th><th>3ª</th><th>4ª</th>
            <th>Menor</th><th>Status</th><th>Diagnóstico</th><th>KM</th><th>mm/km</th>
          </tr>
        </thead>
        <tbody>
          ${data.medicoes.map((m) => `
            <tr>
              <td>${formatDate(m.data_medicao)}</td>
              <td>${m.sulco_externo ?? '-'}</td>
              <td>${m.sulco_central ?? '-'}</td>
              <td>${m.sulco_interno ?? '-'}</td>
              <td>${m.sulco_auxiliar ?? '-'}</td>
              <td><strong>${m.menor_sulco ?? '-'}</strong></td>
              <td>${badge(m.status_sulco)}</td>
              <td>${m.diagnostico_label || m.diagnostico || '-'}</td>
              <td>${m.km_veiculo?.toLocaleString('pt-BR') || '-'}</td>
              <td>${m.desgaste_mm_km != null ? m.desgaste_mm_km : '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>` : '<p class="hint">Sem medições.</p>'}
      ${data.movimentacoes?.length ? `
        <h4 style="margin-top:1rem">Movimentações</h4>
        <table class="historico-table">
          <thead><tr><th>Data</th><th>Tipo</th><th>Padrão</th><th>Sulco</th><th>KM</th><th>Detalhes</th></tr></thead>
          <tbody>
            ${data.movimentacoes.map((m) => `
              <tr>
                <td>${formatDate(m.data_evento)}</td>
                <td>${m.tipo}</td>
                <td>${m.padrao_label || labelPadraoPneu(m.padrao || data.tipo_pneu)}</td>
                <td>${m.sulco_mm ?? '-'}</td>
                <td>${m.km_veiculo?.toLocaleString('pt-BR') || '-'}</td>
                <td>${m.detalhes || '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : ''}
      </div>`;
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

function layoutsParaTipo(tipo) {
  if (tipo === 'Toco / Mini') return ['toco_6'];
  // Truck / Tração: eixos com 2 ou 4 pneus
  return ['truck_10', 'truck_8', 'truck_8_b'];
}

function preencherSelectLayouts(selectId, selectedId, { soTruckToco = false, tipo = null } = {}) {
  const sel = document.getElementById(selectId);
  if (!sel || !meta.layouts) return;
  let lista = meta.layouts;
  if (soTruckToco) {
    const ids = layoutsParaTipo(tipo || document.getElementById('v-tipo')?.value || 'Truck / Tração');
    lista = meta.layouts.filter((l) => ids.includes(l.id));
    if (!lista.length) lista = meta.layouts.filter((l) =>
      l.id === 'truck_10' || l.id === 'truck_8' || l.id === 'truck_8_b' || l.id === 'toco_6'
    );
  }
  sel.innerHTML = lista.map((l) =>
    `<option value="${l.id}">${l.nome}</option>`
  ).join('');
  const preferido = selectedId && lista.some((l) => l.id === selectedId)
    ? selectedId
    : (soTruckToco ? (lista[0]?.id || meta.layout_padrao) : (selectedId || meta.layout_padrao));
  sel.value = preferido;
  sel.dispatchEvent(new Event('change'));
}

function onLayoutSelectChange(selectId, descId, previewId, diagramId = null) {
  const sel = document.getElementById(selectId);
  const layout = getLayoutById(sel.value);
  if (!layout) return;
  const desc = document.getElementById(descId);
  if (desc) desc.textContent = layout.descricao;
  if (previewId) renderLayoutTags(layout.posicoes, previewId);
  if (diagramId) {
    renderLayoutPreview(document.getElementById(diagramId), {
      posicoes: layout.posicoes,
      labels: meta.posicoes || {},
      papeis: meta.papeis || {},
    });
  }
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

// ── Importação CSV (veículos / pneus) ───────────────────

async function baixarModeloCsv(url, filename) {
  try {
    const headers = {};
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      let msg = 'Falha ao baixar planilha';
      try {
        const data = await resp.json();
        msg = data.erro || msg;
      } catch { /* ignore */ }
      throw new Error(msg);
    }
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function mostrarResultadoImport(elId, result) {
  const el = document.getElementById(elId);
  if (!el) return;
  const erros = result.erros || [];
  const avisos = result.avisos || [];
  el.classList.remove('hidden');
  el.innerHTML = `
    <strong>${result.mensagem || 'Importação concluída'}</strong>
    <p class="hint" style="margin:.35rem 0 0">
      ${result.veiculos != null ? `Veículos: <strong>${result.veiculos}</strong> · ` : ''}
      ${result.pneus_montados != null ? `Montados: <strong>${result.pneus_montados}</strong> · ` : ''}
      ${result.pneus_estoque != null ? `Estoque: <strong>${result.pneus_estoque}</strong> · ` : ''}
      ${result.inseridos != null ? `Inseridos: <strong>${result.inseridos}</strong>` : ''}
      ${erros.length ? ` · Erros: <strong>${erros.length}</strong>` : ''}
      ${avisos.length ? ` · Avisos: <strong>${avisos.length}</strong>` : ''}
    </p>
    ${erros.length
      ? `<ul class="import-erros">${erros.slice(0, 12).map((e) =>
          `<li>Linha ${e.linha}${e.placa || e.numero_fogo ? ` (${e.placa || e.numero_fogo})` : ''}: ${e.erro}</li>`
        ).join('')}${erros.length > 12 ? `<li>… e mais ${erros.length - 12}</li>` : ''}</ul>`
      : ''}
    ${avisos.length
      ? `<ul class="import-avisos">${avisos.slice(0, 8).map((a) =>
          `<li>Linha ${a.linha}${a.numero_fogo ? ` (${a.numero_fogo})` : ''}: ${a.aviso}</li>`
        ).join('')}</ul>`
      : ''}
  `;
}

async function importarCsvArquivo(file, endpoint, resultadoId, onOk) {
  if (!file) return;
  try {
    const csv = await file.text();
    if (!csv.trim()) throw new Error('Arquivo vazio');
    const result = await fetchJSON(endpoint, {
      method: 'POST',
      body: JSON.stringify({ csv }),
    });
    mostrarResultadoImport(resultadoId, result);
    toast(result.mensagem || 'Importação concluída', 'success');
    onOk?.(result);
  } catch (err) {
    const data = err.data;
    if (data?.erros) {
      mostrarResultadoImport(resultadoId, data);
    }
    toast(err.message, 'error');
  }
}

document.getElementById('btn-modelo-veiculos')?.addEventListener('click', (e) => {
  e.preventDefault();
  baixarModeloCsv(`${API}/veiculos/import/modelo`, 'modelo-veiculos.csv');
});
document.getElementById('file-import-veiculos')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  await importarCsvArquivo(file, `${API}/veiculos/import`, 'import-resultado-veiculos', () => loadVeiculos());
});

document.getElementById('btn-modelo-frota')?.addEventListener('click', (e) => {
  e.preventDefault();
  baixarModeloCsv(`${API}/frota/import/modelo`, 'modelo-carga-frota.csv');
});
document.getElementById('file-import-frota')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  await importarCsvArquivo(file, `${API}/frota/import`, 'import-resultado-frota', () => {
    loadVeiculos();
  });
});

document.getElementById('btn-modelo-pneus')?.addEventListener('click', (e) => {
  e.preventDefault();
  baixarModeloCsv(`${API}/pneus/import/modelo`, 'modelo-pneus.csv');
});
document.getElementById('file-import-pneus')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  await importarCsvArquivo(file, `${API}/pneus/import`, 'import-resultado-pneus', () => loadPneus());
});

// ── Modal Veículo ──────────────────────────────────────

const modalVeiculo = document.getElementById('modal-veiculo');

document.getElementById('btn-novo-veiculo').addEventListener('click', () => {
  document.getElementById('form-veiculo').reset();
  document.getElementById('modal-veiculo-titulo').textContent = 'Novo Veículo';
  preencherSelectLayouts('v-layout', meta.layout_padrao, {
    soTruckToco: true,
    tipo: document.getElementById('v-tipo')?.value || 'Truck / Tração',
  });
  const tipo = document.getElementById('v-tipo');
  if (tipo?.value) {
    const sugestao = LAYOUT_POR_TIPO[tipo.value];
    if (sugestao) {
      document.getElementById('v-layout').value = sugestao;
    }
  }
  onLayoutSelectChange('v-layout', 'v-layout-desc', 'v-layout-preview', 'v-layout-diagram');
  modalVeiculo.showModal();
});

document.getElementById('v-layout')?.addEventListener('change', () => {
  onLayoutSelectChange('v-layout', 'v-layout-desc', 'v-layout-preview', 'v-layout-diagram');
});

document.getElementById('v-tipo')?.addEventListener('change', (e) => {
  const tipo = e.target.value;
  const sugestao = LAYOUT_POR_TIPO[tipo] || (tipo === 'Toco / Mini' ? 'toco_6' : 'truck_10');
  preencherSelectLayouts('v-layout', sugestao, { soTruckToco: true, tipo });
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
    const result = await fetchJSON(`${API}/veiculos`, {
      method: 'POST',
      body: JSON.stringify({
        placa: document.getElementById('v-placa').value,
        apelido: document.getElementById('v-apelido').value,
        tipo: document.getElementById('v-tipo').value,
        marca: document.getElementById('v-marca').value,
        modelo: document.getElementById('v-modelo').value,
        ano: parseInt(document.getElementById('v-ano').value) || null,
        km_atual: parseInt(document.getElementById('v-km').value) || 0,
        hr_atual: parseFloat(document.getElementById('v-hr').value) || 0,
        layout_pneus: document.getElementById('v-layout').value,
      }),
    });
    modalVeiculo.close();
    toast('Veículo pronto — clique nas posições vazias para colocar os pneus', 'success');
    await openVeiculoDetalhe(result.id, 'veiculos');
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
  auxiliar: document.getElementById('med-auxiliar'),
};

function syncTireFromInputs() {
  if (!tireMarker) return;
  const p = pontosFromInputs('med');
  tireMarker.setValores(p.externo, p.central, p.interno, p.auxiliar);
  atualizarPerfilLocal('med-perfil', p);
}

Object.values(sulcoInputs).forEach((input) => {
  input?.addEventListener('input', syncTireFromInputs);
});

async function initMedicao() {
  document.getElementById('med-data').value = new Date().toISOString().split('T')[0];

  if (!tireMarker) {
    tireMarker = new TireMarker('tire-marker-container', {
      limites: limitesAtuais,
      onSulcoClick: (sulco) => {
        const map = { externo: 'med-externo', central: 'med-central', interno: 'med-interno', auxiliar: 'med-auxiliar' };
        const input = document.getElementById(map[sulco]);
        if (input) {
          input.focus();
          input.select();
        }
      },
    });
  } else {
    tireMarker.setLimites(limitesAtuais);
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
    if (!v.pneus.length) {
      selectPneu.innerHTML = '<option value="">Nenhum pneu montado — monte na aba Veículos</option>';
      selectPneu.disabled = true;
      return;
    }
    selectPneu.innerHTML = v.pneus.map((p) =>
      `<option value="${p.id}">${meta.posicoes[p.posicao] || p.posicao}${p.numero_fogo ? ` · ${p.numero_fogo}` : ''}</option>`
    ).join('');
    document.getElementById('med-km').value = v.km_atual || '';
    document.getElementById('med-hr').value = v.hr_atual || '';
  } catch (err) {
    toast(err.message, 'error');
  }
});

document.getElementById('btn-salvar-medicao').addEventListener('click', async () => {
  const pneuId = document.getElementById('med-pneu').value;
  if (!pneuId) return toast('Selecione o pneu', 'error');

  const pontos = pontosFromInputs('med');
  const payload = {
    pneu_id: parseInt(pneuId, 10),
    data_medicao: document.getElementById('med-data').value,
    km_veiculo: parseInt(document.getElementById('med-km').value, 10) || null,
    hr_veiculo: numOrNull('med-hr'),
    sulco_externo: pontos.externo,
    sulco_central: pontos.central,
    sulco_interno: pontos.interno,
    sulco_auxiliar: pontos.auxiliar,
    pressao_psi: numOrNull('med-pressao'),
    responsavel: document.getElementById('med-responsavel').value,
    observacoes: document.getElementById('med-obs').value,
    marcacao_json: tireMarker?.getValores(),
  };

  if (payload.sulco_externo == null && payload.sulco_central == null
    && payload.sulco_interno == null && payload.sulco_auxiliar == null) {
    return toast('Informe ao menos um valor de sulco', 'error');
  }

  try {
    const result = await fetchJSON(`${API}/medicoes`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const msg = result.acao_sugerida === 'troca'
      ? `Medição salva! TROCA sugerida (${result.menor_sulco} mm) — ${result.diagnostico_label}`
      : result.acao_sugerida === 'recap'
        ? `Medição salva! RECAP sugerida (${result.menor_sulco} mm)`
        : `Medição salva! ${result.menor_sulco} mm · ${result.diagnostico_label}`;

    toast(msg, result.acao_sugerida === 'troca' ? 'error' : 'success');

    ['med-externo', 'med-central', 'med-interno', 'med-auxiliar', 'med-pressao', 'med-obs']
      .forEach((id) => { document.getElementById(id).value = ''; });
    tireMarker?.reset();
    document.getElementById('med-perfil').innerHTML = '';
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
    limitesAtuais = { ...limitesAtuais, ...config };

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
          <p class="hint">${a.placa} · ${a.diagnostico_label || ''} · ${a.acao_motivo || ''} · ${formatDate(a.data_medicao)}</p>
        </div>
        <div class="veiculo-meta">
          <span style="font-size:1.25rem;font-weight:700">${a.menor_sulco} mm</span>
          ${badge(a.status_sulco)}
          ${badgeAcao(a.acao_sugerida, a.acao_label)}
        </div>
      </div>
    `).join('');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Ações ──────────────────────────────────────────────

async function loadAcoes() {
  try {
    const data = await fetchJSON(`${API}/medicoes/acoes`);
    const resumo = document.getElementById('acoes-resumo');
    resumo.innerHTML = `
      <div class="stat-card stat-troca"><span class="stat-value">${data.troca}</span><span class="stat-label">Troca</span></div>
      <div class="stat-card stat-recap"><span class="stat-value">${data.recap}</span><span class="stat-label">Recapagem</span></div>
      <div class="stat-card stat-monitorar"><span class="stat-value">${data.monitorar}</span><span class="stat-label">Monitorar</span></div>
    `;

    const lista = document.getElementById('acoes-lista');
    if (!data.itens.length) {
      lista.innerHTML = '<div class="empty-state"><h3>Nenhuma ação pendente</h3><p>A frota está dentro dos parâmetros</p></div>';
      return;
    }

    lista.innerHTML = data.itens.map((a) => `
      <div class="alerta-card ${a.acao_sugerida === 'troca' ? 'critico' : a.acao_sugerida === 'recap' ? 'alerta' : ''}">
        <div>
          <strong>${a.apelido || a.placa}</strong> — ${meta.posicoes[a.posicao] || a.posicao}
          <p class="hint">${a.acao_motivo || ''} · Vida: ${a.vida_recap || 0}ª recap</p>
        </div>
        <div class="veiculo-meta">
          <span style="font-weight:700">${a.menor_sulco ?? '—'} mm</span>
          ${badgeAcao(a.acao_sugerida, a.acao_label)}
          <button class="btn btn-sm btn-primary" data-veiculo="${a.veiculo_id}">Abrir</button>
        </div>
      </div>
    `).join('');

    lista.querySelectorAll('button[data-veiculo]').forEach((btn) => {
      btn.addEventListener('click', () => openVeiculoDetalhe(btn.dataset.veiculo, 'acoes'));
    });
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Configurações ──────────────────────────────────────

async function loadConfiguracoes() {
  if (!isAdmin()) return;
  try {
    const config = await fetchConfiguracoes();
    limitesAtuais = { ...limitesAtuais, ...config };

    document.getElementById('cfg-critico').value = config.sulco_critico_mm;
    document.getElementById('cfg-alerta').value = config.sulco_alerta_mm;
    document.getElementById('cfg-recap').value = config.sulco_recap_mm ?? 5;
    document.getElementById('cfg-novo').value = config.sulco_novo_mm ?? 14;
    document.getElementById('cfg-max-recaps').value = config.max_recaps ?? 6;
    document.getElementById('cfg-tolerancia').value = config.diagnostico_tolerancia_mm ?? 1;
    document.getElementById('cfg-rodizio-desvio').value = config.rodizio_desvio_mm ?? 3;
    document.getElementById('cfg-rodizio-similaridade').value = config.rodizio_similaridade_mm ?? 2.5;

    const a = config.acoes || {};
    document.getElementById('cfg-acao-troca-label').value = a.troca?.label || 'Troca';
    document.getElementById('cfg-acao-troca-instrucao').value = a.troca?.instrucao || '';
    document.getElementById('cfg-acao-recap-label').value = a.recap?.label || 'Recapagem';
    document.getElementById('cfg-acao-recap-instrucao').value = a.recap?.instrucao || '';
    document.getElementById('cfg-acao-monitorar-label').value = a.monitorar?.label || 'Monitorar';
    document.getElementById('cfg-acao-monitorar-instrucao').value = a.monitorar?.instrucao || '';
    document.getElementById('cfg-acao-rodizio-label').value = a.rodizio?.label || 'Rodízio';
    document.getElementById('cfg-acao-rodizio-instrucao').value = a.rodizio?.instrucao || '';
    document.getElementById('cfg-acao-ok-label').value = a.ok?.label || 'OK';
    document.getElementById('cfg-acao-ok-instrucao').value = a.ok?.instrucao || '';

    atualizarPreviewLimites();
  } catch (err) {
    toast(err.message, 'error');
  }
}

['cfg-critico', 'cfg-alerta', 'cfg-recap',
  'cfg-acao-troca-label', 'cfg-acao-troca-instrucao',
  'cfg-acao-recap-label', 'cfg-acao-recap-instrucao',
  'cfg-acao-monitorar-label', 'cfg-acao-monitorar-instrucao',
  'cfg-acao-rodizio-label', 'cfg-acao-rodizio-instrucao',
  'cfg-acao-ok-label', 'cfg-acao-ok-instrucao',
  'cfg-rodizio-desvio', 'cfg-rodizio-similaridade',
].forEach((id) => {
  document.getElementById(id)?.addEventListener('input', atualizarPreviewLimites);
});

document.getElementById('btn-salvar-config')?.addEventListener('click', async () => {
  const payload = {
    sulco_critico_mm: parseFloat(document.getElementById('cfg-critico').value),
    sulco_alerta_mm: parseFloat(document.getElementById('cfg-alerta').value),
    sulco_recap_mm: parseFloat(document.getElementById('cfg-recap').value),
    sulco_novo_mm: parseFloat(document.getElementById('cfg-novo').value),
    max_recaps: parseInt(document.getElementById('cfg-max-recaps').value, 10),
    diagnostico_tolerancia_mm: parseFloat(document.getElementById('cfg-tolerancia').value),
    rodizio_desvio_mm: parseFloat(document.getElementById('cfg-rodizio-desvio').value),
    rodizio_similaridade_mm: parseFloat(document.getElementById('cfg-rodizio-similaridade').value),
    acoes: {
      troca: {
        label: document.getElementById('cfg-acao-troca-label').value,
        instrucao: document.getElementById('cfg-acao-troca-instrucao').value,
      },
      recap: {
        label: document.getElementById('cfg-acao-recap-label').value,
        instrucao: document.getElementById('cfg-acao-recap-instrucao').value,
      },
      monitorar: {
        label: document.getElementById('cfg-acao-monitorar-label').value,
        instrucao: document.getElementById('cfg-acao-monitorar-instrucao').value,
      },
      rodizio: {
        label: document.getElementById('cfg-acao-rodizio-label').value,
        instrucao: document.getElementById('cfg-acao-rodizio-instrucao').value,
      },
      ok: {
        label: document.getElementById('cfg-acao-ok-label').value,
        instrucao: document.getElementById('cfg-acao-ok-instrucao').value,
      },
    },
  };

  if (!Number.isFinite(payload.sulco_critico_mm) || !Number.isFinite(payload.sulco_alerta_mm)) {
    return toast('Informe valores válidos em mm', 'error');
  }

  try {
    const result = await fetchJSON(`${API}/configuracoes`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    limitesAtuais = { ...limitesAtuais, ...result };
    syncMarkersLimites();
    atualizarPreviewLimites();
    toast('Limites e ações salvos! Medições usam as novas regras.', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ── WhatsApp (admin) ───────────────────────────────────

let waPollTimer = null;

function stopWaPoll() {
  if (waPollTimer) {
    clearInterval(waPollTimer);
    waPollTimer = null;
  }
}

function renderWaStatus(data) {
  const badge = document.getElementById('wa-status-badge');
  const name = document.getElementById('wa-status-name');
  const jid = document.getElementById('wa-status-jid');
  const webhook = document.getElementById('wa-status-webhook');
  const url = document.getElementById('wa-status-url');
  const qrWrap = document.getElementById('wa-qr-wrap');
  const qrImg = document.getElementById('wa-qr-img');

  if (!data?.configurado) {
    badge.className = 'badge badge-critico';
    badge.textContent = 'Não configurado';
    name.textContent = '—';
    jid.textContent = '—';
    webhook.textContent = '—';
    url.textContent = data?.mensagem || 'Defina WUZAPI_* no .env';
    qrWrap?.classList.add('hidden');
    return;
  }

  url.textContent = data.wuzapi_url || '—';
  name.textContent = data.name || '—';
  jid.textContent = data.jid || '—';
  webhook.textContent = data.webhook || '—';

  if (data.loggedIn) {
    badge.className = 'badge badge-ok';
    badge.textContent = 'Conectado e logado';
    qrWrap?.classList.add('hidden');
    stopWaPoll();
  } else if (data.connected) {
    badge.className = 'badge badge-alerta';
    badge.textContent = 'Aguardando QR / login';
  } else {
    badge.className = 'badge badge-sem_dado';
    badge.textContent = 'Desconectado';
  }

  if (data.qrcode && !data.loggedIn) {
    qrImg.src = data.qrcode;
    qrWrap?.classList.remove('hidden');
  } else if (!data.loggedIn && data.connected) {
    // mantém QR se já estiver na tela
  } else if (data.loggedIn) {
    qrWrap?.classList.add('hidden');
  }
}

async function loadWhatsApp() {
  if (!isAdmin()) return;
  stopWaPoll();
  try {
    const data = await fetchJSON(`${API}/whatsapp/status`);
    renderWaStatus(data);
    if (data.connected && !data.loggedIn) {
      startWaPoll();
    }
  } catch (err) {
    toast(err.message, 'error');
    renderWaStatus({ configurado: false, mensagem: err.message });
  }
}

function startWaPoll() {
  stopWaPoll();
  waPollTimer = setInterval(async () => {
    try {
      const data = await fetchJSON(`${API}/whatsapp/status`);
      renderWaStatus(data);
      if (data.loggedIn) {
        toast('WhatsApp conectado!', 'success');
        stopWaPoll();
      } else if (data.connected && !data.qrcode) {
        const qr = await fetchJSON(`${API}/whatsapp/qr`);
        if (qr.tem_qr) {
          document.getElementById('wa-qr-img').src = qr.qrcode;
          document.getElementById('wa-qr-wrap')?.classList.remove('hidden');
        }
      }
    } catch {
      // ignore poll errors
    }
  }, 3000);
}

document.getElementById('btn-wa-refresh')?.addEventListener('click', () => loadWhatsApp());

document.getElementById('btn-wa-connect')?.addEventListener('click', async () => {
  try {
    toast('Iniciando conexão...');
    const data = await fetchJSON(`${API}/whatsapp/connect`, { method: 'POST', body: '{}' });
    renderWaStatus(data);
    if (data.qrcode) {
      document.getElementById('wa-qr-img').src = data.qrcode;
      document.getElementById('wa-qr-wrap')?.classList.remove('hidden');
    }
    toast(data.mensagem || 'Escaneie o QR Code', 'success');
    startWaPoll();
  } catch (err) {
    toast(err.message, 'error');
  }
});

document.getElementById('btn-wa-disconnect')?.addEventListener('click', async () => {
  try {
    const data = await fetchJSON(`${API}/whatsapp/disconnect`, { method: 'POST', body: '{}' });
    stopWaPoll();
    toast(data.mensagem || 'Desconectado');
    loadWhatsApp();
  } catch (err) {
    toast(err.message, 'error');
  }
});

document.getElementById('btn-wa-logout')?.addEventListener('click', async () => {
  if (!confirm('Encerrar a sessão do WhatsApp? Será preciso escanear o QR novamente.')) return;
  try {
    const data = await fetchJSON(`${API}/whatsapp/logout`, { method: 'POST', body: '{}' });
    stopWaPoll();
    toast(data.mensagem || 'Logout ok');
    document.getElementById('wa-qr-wrap')?.classList.add('hidden');
    loadWhatsApp();
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ── Filiais (admin) ────────────────────────────────────

async function loadFiliais() {
  if (!isAdmin()) return;
  try {
    const [filiais, compras] = await Promise.all([
      fetchJSON(`${API}/filiais`),
      fetchJSON(`${API}/filiais/compras/consolidado`),
    ]);
    filiaisCache = filiais;
    const lista = document.getElementById('filiais-lista');
    document.getElementById('filial-detalhe').classList.add('hidden');

    const banner = document.getElementById('compras-consolidado');
    const t = compras.totais || {};
    banner.innerHTML = `
      <div class="compras-banner-inner">
        <div>
          <h3>Compras e recapagens — consolidado</h3>
          <p class="hint">Baseado nas medições enviadas pelas filiais</p>
        </div>
        <div class="compras-totais">
          <div class="compras-chip compra">
            <strong>${t.pneus_para_comprar ?? 0}</strong>
            <span>Comprar (troca)</span>
          </div>
          <div class="compras-chip recap">
            <strong>${t.pneus_para_recap ?? 0}</strong>
            <span>Recapagem</span>
          </div>
          <div class="compras-chip monitorar">
            <strong>${t.pneus_monitorar ?? 0}</strong>
            <span>Monitorar</span>
          </div>
        </div>
      </div>
      ${compras.filiais?.length ? `
        <div class="compras-por-filial">
          ${compras.filiais.map((f) => `
            <button type="button" class="compras-filial-chip" data-id="${f.filial_id}">
              <strong>${f.codigo}</strong>
              ${f.compras.pneus_para_comprar ? `<span class="chip-troca">${f.compras.pneus_para_comprar} compra</span>` : ''}
              ${f.compras.pneus_para_recap ? `<span class="chip-recap">${f.compras.pneus_para_recap} recap</span>` : ''}
              ${f.compras.pneus_monitorar ? `<span class="chip-mon">${f.compras.pneus_monitorar} mon.</span>` : ''}
            </button>
          `).join('')}
        </div>` : '<p class="hint" style="margin-top:.75rem">Nenhuma pendência de compra no momento</p>'}
    `;
    banner.querySelectorAll('.compras-filial-chip').forEach((btn) => {
      btn.addEventListener('click', () => abrirDetalheFilial(btn.dataset.id));
    });

    if (!filiais.length) {
      lista.innerHTML = '<div class="empty-state"><h3>Nenhuma filial</h3><p>Cadastre a primeira filial para começar</p></div>';
      return;
    }

    lista.innerHTML = filiais.map((f) => {
      const r = f.resumo || {};
      const c = r.compras || {};
      const urgente = (r.pneus_critico || 0) > 0 || (c.pneus_para_comprar || 0) > 0;
      const atrasado = r.precisa_medir_semana;
      return `
        <div class="filial-card ${urgente ? 'is-urgente' : ''} ${atrasado ? 'is-atrasado' : ''}" data-id="${f.id}">
          <div class="filial-card-head">
            <h3>${f.nome}</h3>
            <span class="badge badge-vida">${f.codigo}</span>
          </div>
          <p class="hint">${f.contrato || 'Sem contrato'} · login: ${f.login || '—'}</p>
          <div class="filial-stats">
            <span><strong>${r.veiculos_ativos ?? 0}</strong> veículos</span>
            <span class="text-critico"><strong>${c.pneus_para_comprar ?? r.acoes?.troca ?? 0}</strong> comprar</span>
            <span class="text-recap"><strong>${c.pneus_para_recap ?? r.acoes?.recap ?? 0}</strong> recap</span>
            <span><strong>${r.pneus_critico ?? 0}</strong> críticos</span>
          </div>
          <p class="hint filial-medicao">
            ${r.ultima_medicao
              ? `Última medição: ${formatDate(r.ultima_medicao)} (${r.dias_sem_medicao ?? 0} dias)`
              : 'Nunca mediu'}
            ${atrasado ? ' · <strong>Medir esta semana</strong>' : ''}
          </p>
          <div class="filial-card-actions">
            <button type="button" class="btn btn-sm btn-primary btn-abrir-filial" data-id="${f.id}">Alertas e compras</button>
            <button type="button" class="btn btn-sm btn-ghost btn-editar-filial" data-id="${f.id}">Editar / senha</button>
          </div>
        </div>
      `;
    }).join('');

    lista.querySelectorAll('.btn-abrir-filial').forEach((btn) => {
      btn.addEventListener('click', () => abrirDetalheFilial(btn.dataset.id));
    });
    lista.querySelectorAll('.btn-editar-filial').forEach((btn) => {
      btn.addEventListener('click', () => abrirModalFilial(btn.dataset.id));
    });
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderPendenciaRows(itens, tipo) {
  if (!itens?.length) return '';
  return `
    <div class="pendencia-grupo pendencia-${tipo}">
      <h4>${tipo === 'troca' ? 'Comprar / Trocar' : tipo === 'recap' ? 'Recapagem' : 'Monitorar'} (${itens.length})</h4>
      <table class="historico-table">
        <thead>
          <tr>
            <th>Veículo</th><th>Posição</th><th>Fogo</th><th>Sulco</th>
            <th>Status</th><th>Diagnóstico</th><th>Motivo</th><th>Medição</th>
          </tr>
        </thead>
        <tbody>
          ${itens.map((p) => `
            <tr>
              <td><strong>${p.apelido || p.placa}</strong><br><span class="hint">${p.placa}</span></td>
              <td>${p.posicao_label || p.posicao}</td>
              <td>${p.numero_fogo || '—'}</td>
              <td><strong>${p.menor_sulco ?? '—'} mm</strong></td>
              <td>${badge(p.status_sulco)}</td>
              <td>${p.diagnostico_label || '—'}</td>
              <td>${p.acao_motivo || '—'}</td>
              <td>${formatDate(p.data_medicao)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function abrirDetalheFilial(id) {
  try {
    const data = await fetchJSON(`${API}/filiais/${id}`);
    const el = document.getElementById('filial-detalhe');
    const r = data.resumo || {};
    const c = data.compras || r.compras || {};
    const pend = data.pendencias || { troca: [], recap: [], monitorar: [] };

    el.classList.remove('hidden');
    el.innerHTML = `
      <div class="section-header">
        <h3>${data.nome} (${data.codigo})</h3>
        <button type="button" class="btn btn-ghost btn-sm" id="btn-fechar-detalhe-filial">Fechar</button>
      </div>
      <p class="hint">${data.contrato || ''} · Login: ${data.login || '—'}
        ${r.ultima_medicao ? ` · Última medição ${formatDate(r.ultima_medicao)}` : ''}</p>

      <div class="compras-resumo-filial">
        <div class="compras-chip compra"><strong>${c.pneus_para_comprar ?? 0}</strong><span>Pneus a comprar</span></div>
        <div class="compras-chip recap"><strong>${c.pneus_para_recap ?? 0}</strong><span>Enviar a recap</span></div>
        <div class="compras-chip monitorar"><strong>${c.pneus_monitorar ?? 0}</strong><span>Monitorar</span></div>
        <div class="compras-chip"><strong>${r.pneus_sem_dado ?? 0}</strong><span>Sem medição</span></div>
      </div>

      <h4 style="margin-top:1.25rem">Alertas para adiantar compras</h4>
      ${pend.todos?.length
        ? `${renderPendenciaRows(pend.troca, 'troca')}
           ${renderPendenciaRows(pend.recap, 'recap')}
           ${renderPendenciaRows(pend.monitorar, 'monitorar')}`
        : '<p class="hint">Nenhum alerta pendente nesta filial — frota dentro dos parâmetros.</p>'}

      <h4 style="margin-top:1.5rem">Frota (${data.veiculos?.length || 0})</h4>
      <p class="hint">Clique em um veículo para ver o desenho dos pneus, anomalias e o que fazer.</p>
      ${data.veiculos?.length
        ? `<div class="card-list">${data.veiculos.map((v) => `
            <div class="veiculo-card" data-id="${v.id}" role="button" tabindex="0">
              <div class="veiculo-info">
                <h4>${v.apelido || v.placa}</h4>
                <p>${v.placa} · ${v.tipo} · ${v.total_pneus} pneus · ${v.km_atual?.toLocaleString('pt-BR') || 0} km
                  ${v.menor_sulco != null ? ` · menor sulco ${v.menor_sulco} mm` : ''}</p>
              </div>
              <div class="veiculo-meta">
                ${badge(v.status_sulco)}
                ${v.pendencias_troca ? badgeAcao('troca', `${v.pendencias_troca} troca`) : ''}
                ${v.pendencias_recap ? badgeAcao('recap', `${v.pendencias_recap} recap`) : ''}
              </div>
            </div>`).join('')}</div>`
        : '<p class="hint">Nenhum veículo nesta filial</p>'}
      <div id="filial-veiculo-inspecao" class="filial-inspecao hidden"></div>
    `;
    document.getElementById('btn-fechar-detalhe-filial').onclick = () => el.classList.add('hidden');
    el.querySelectorAll('.veiculo-card[data-id]').forEach((card) => {
      const open = () => abrirInspecaoVeiculoFilial(id, card.dataset.id);
      card.addEventListener('click', open);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      });
    });
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    toast(err.message, 'error');
  }
}

let inspecaoDiagram = null;
let inspecaoVeiculoCache = null;

function textoOQueFazer(p) {
  const acao = (p.acao_sugerida || 'ok').toLowerCase();
  if (acao === 'troca') {
    return 'Trocar o pneu. Retire da posição, descarte ou encaminhe conforme política da frota e monte um pneu do estoque.';
  }
  if (acao === 'recap') {
    return 'Enviar para recapagem. Desmonte, registre a recap e remonte (ou use outro pneu) na posição.';
  }
  if (acao === 'monitorar') {
    return 'Monitorar de perto. Meça novamente em até 7 dias e acompanhe se o sulco continua caindo.';
  }
  if (p.diagnostico && p.diagnostico !== 'ok' && p.diagnostico !== 'sem_dado') {
    return p.diagnostico_desc || `Corrigir causa: ${p.diagnostico_label}.`;
  }
  if (p.status_sulco === 'sem_dado') {
    return 'Realizar medição dos 4 pontos de sulco para avaliar o pneu.';
  }
  return 'Nenhuma ação urgente — manter medição periódica.';
}

function renderPainelPneuInspecao(p) {
  if (!p) {
    return `<div class="inspecao-empty">
      <p>Clique em um pneu no desenho (ou na lista) para ver o diagnóstico e a ação recomendada.</p>
    </div>`;
  }
  const sulcos = [
    p.ult_sulco_ext, p.ult_sulco_cent, p.ult_sulco_int, p.ult_sulco_aux,
  ].map((v) => (v != null ? `${v} mm` : '—')).join(' · ');

  return `
    <div class="inspecao-pneu-detalhe">
      <div class="inspecao-pneu-head">
        <h4>${p.posicao_label || p.posicao}${p.numero_fogo ? ` · Fogo ${p.numero_fogo}` : ''}</h4>
        <div class="inspecao-badges">
          ${badge(p.status_sulco)}
          ${badgeAcao(p.acao_sugerida, p.acao_label)}
        </div>
      </div>
      <p class="hint">${p.marca || '—'} · ${p.vida_label || ''}${p.ult_medicao ? ` · medido em ${formatDate(p.ult_medicao)}` : ''}</p>
      <dl class="inspecao-dl">
        <div><dt>Menor sulco</dt><dd><strong>${p.menor_sulco != null ? `${p.menor_sulco} mm` : '—'}</strong></dd></div>
        <div><dt>4 pontos</dt><dd>${sulcos}</dd></div>
        <div><dt>Diagnóstico</dt><dd>${p.diagnostico_label || '—'}${p.diagnostico_desc ? `<br><span class="hint">${p.diagnostico_desc}</span>` : ''}</dd></div>
        <div><dt>Motivo</dt><dd>${p.acao_motivo || '—'}</dd></div>
      </dl>
      <div class="inspecao-acao-box inspecao-acao-${p.acao_sugerida || 'ok'}">
        <strong>O que fazer</strong>
        <p>${textoOQueFazer(p)}</p>
      </div>
    </div>`;
}

function renderListaAnomalias(anomalias) {
  if (!anomalias?.length) {
    return `<div class="inspecao-ok-banner">
      <strong>Sem anomalias</strong>
      <p>Todos os pneus montados estão dentro dos parâmetros ou sem ação pendente.</p>
    </div>`;
  }
  return `
    <div class="inspecao-anomalias">
      <h4>Pneus com anomalia (${anomalias.length})</h4>
      <div class="inspecao-anomalia-list">
        ${anomalias.map((p) => `
          <button type="button" class="inspecao-anomalia-item" data-pneu-id="${p.id}">
            <span class="inspecao-anomalia-pos">${p.posicao_label || p.posicao}</span>
            <span class="inspecao-anomalia-meta">
              ${badge(p.status_sulco)}
              ${badgeAcao(p.acao_sugerida, p.acao_label)}
              <span class="hint">${p.menor_sulco != null ? `${p.menor_sulco} mm` : 'sem medição'}</span>
            </span>
            <span class="inspecao-anomalia-fazer">${textoOQueFazer(p)}</span>
          </button>
        `).join('')}
      </div>
    </div>`;
}

async function abrirInspecaoVeiculoFilial(filialId, veiculoId) {
  const box = document.getElementById('filial-veiculo-inspecao');
  if (!box) return;
  box.classList.remove('hidden');
  box.innerHTML = '<p class="hint">Carregando diagrama e diagnósticos…</p>';
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const v = await fetchJSON(`${API}/filiais/${filialId}/veiculos/${veiculoId}`);
    inspecaoVeiculoCache = v;
    const labels = v.posicoes_labels || {};
    const posicoes = v.posicoes_layout?.map((p) => p.codigo) || v.layout?.posicoes || [];
    const nAnom = v.anomalias?.length || 0;

    box.innerHTML = `
      <div class="inspecao-header">
        <div>
          <h3>${v.apelido || v.placa}</h3>
          <p class="hint">${v.placa} · ${v.tipo} · ${v.km_atual?.toLocaleString('pt-BR') || 0} km
            · ${v.layout?.nome || 'Layout'}
            · Filial ${v.filial?.nome || ''}</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="btn-fechar-inspecao">Fechar desenho</button>
      </div>
      <p class="inspecao-legenda hint">
        Cores no desenho: <span class="dot-inline ok"></span> OK ·
        <span class="dot-inline alerta"></span> Alerta ·
        <span class="dot-inline critico"></span> Crítico ·
        ${nAnom ? `<strong>${nAnom} pneu(s) exigem ação</strong>` : '<strong>Frota OK neste veículo</strong>'}
      </p>
      <div class="inspecao-layout">
        <div class="card truck-diagram-wrap">
          <div id="filial-inspecao-diagram"></div>
        </div>
        <div class="card inspecao-side">
          <div id="filial-inspecao-painel">${renderPainelPneuInspecao(null)}</div>
          ${renderListaAnomalias(v.anomalias)}
        </div>
      </div>`;

    document.getElementById('btn-fechar-inspecao').onclick = () => {
      box.classList.add('hidden');
      box.innerHTML = '';
      inspecaoDiagram = null;
      inspecaoVeiculoCache = null;
    };

    inspecaoDiagram = new TruckDiagram('filial-inspecao-diagram', {
      pickerHint: 'Clique no pneu colorido para ver a anomalia e o que fazer:',
      onPneuClick: (pneu) => {
        const painel = document.getElementById('filial-inspecao-painel');
        if (painel) painel.innerHTML = renderPainelPneuInspecao(pneu);
      },
      onSlotClick: () => {
        const painel = document.getElementById('filial-inspecao-painel');
        if (painel) {
          painel.innerHTML = `<div class="inspecao-empty"><p>Posição vazia — a filial precisa montar um pneu do estoque neste slot.</p></div>`;
        }
      },
    });
    inspecaoDiagram.render(v.pneus, labels, posicoes);

    box.querySelectorAll('.inspecao-anomalia-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.pneuId, 10);
        const pneu = v.pneus.find((p) => p.id === id);
        if (!pneu) return;
        inspecaoDiagram?.setAtivo(id);
        const painel = document.getElementById('filial-inspecao-painel');
        if (painel) painel.innerHTML = renderPainelPneuInspecao(pneu);
        painel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });

    // Auto-seleciona a anomalia mais crítica
    if (v.anomalias?.length) {
      const primeiro = v.anomalias[0];
      inspecaoDiagram.setAtivo(primeiro.id);
      document.getElementById('filial-inspecao-painel').innerHTML = renderPainelPneuInspecao(primeiro);
    }
  } catch (err) {
    box.innerHTML = `<p class="hint login-erro">${err.message}</p>`;
    toast(err.message, 'error');
  }
}

let filiaisCache = [];

async function abrirModalFilial(id = null) {
  const modal = document.getElementById('modal-filial');
  document.getElementById('form-filial').reset();
  document.getElementById('f-id').value = id || '';

  if (id) {
    document.getElementById('modal-filial-titulo').textContent = 'Editar Filial';
    document.getElementById('f-login-row').classList.add('hidden');
    document.getElementById('f-reset-row').classList.remove('hidden');
    document.getElementById('f-login').required = false;
    document.getElementById('f-senha').required = false;

    if (!filiaisCache.length) {
      filiaisCache = await fetchJSON(`${API}/filiais`);
    }
    const f = filiaisCache.find((x) => String(x.id) === String(id))
      || await fetchJSON(`${API}/filiais/${id}`);
    document.getElementById('f-nome').value = f.nome || '';
    document.getElementById('f-codigo').value = f.codigo || '';
    document.getElementById('f-contrato').value = f.contrato || '';
  } else {
    document.getElementById('modal-filial-titulo').textContent = 'Nova Filial';
    document.getElementById('f-login-row').classList.remove('hidden');
    document.getElementById('f-reset-row').classList.add('hidden');
    document.getElementById('f-login').required = true;
    document.getElementById('f-senha').required = true;
  }
  modal.showModal();
}

document.getElementById('btn-nova-filial')?.addEventListener('click', () => abrirModalFilial());
document.getElementById('btn-cancelar-filial')?.addEventListener('click', () => {
  document.getElementById('modal-filial').close();
});

document.getElementById('form-filial')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('f-id').value;
  try {
    if (id) {
      await fetchJSON(`${API}/filiais/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          nome: document.getElementById('f-nome').value,
          codigo: document.getElementById('f-codigo').value,
          contrato: document.getElementById('f-contrato').value,
        }),
      });
      const novaSenha = document.getElementById('f-nova-senha').value;
      if (novaSenha) {
        await fetchJSON(`${API}/filiais/${id}/reset-senha`, {
          method: 'POST',
          body: JSON.stringify({ senha: novaSenha }),
        });
      }
      toast('Filial atualizada', 'success');
    } else {
      const result = await fetchJSON(`${API}/filiais`, {
        method: 'POST',
        body: JSON.stringify({
          nome: document.getElementById('f-nome').value,
          codigo: document.getElementById('f-codigo').value,
          contrato: document.getElementById('f-contrato').value,
          login: document.getElementById('f-login').value,
          senha: document.getElementById('f-senha').value,
        }),
      });
      toast(result.mensagem, 'success');
    }
    document.getElementById('modal-filial').close();
    filiaisCache = [];
    loadFiliais();
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ── Inicialização ──────────────────────────────────────

function isRotaAcessoRapido() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  return path.endsWith('/veiculo-acesso-rapido')
    || window.location.search.includes('token=') && path.includes('acesso-rapido');
}

function mostrarErroToken(msg) {
  document.getElementById('app-login')?.classList.add('hidden');
  document.getElementById('app-shell')?.classList.remove('hidden');
  document.getElementById('nav-tabs-filial')?.classList.add('hidden');
  document.getElementById('nav-tabs-admin')?.classList.add('hidden');
  document.getElementById('btn-logout')?.classList.add('hidden');
  const label = document.getElementById('header-user-label');
  if (label) label.textContent = 'Acesso rápido';
  const subtitle = document.getElementById('header-subtitle');
  if (subtitle) subtitle.textContent = 'Link WhatsApp';
  const box = document.querySelector('#view-acesso-erro .erro-token-container p');
  if (box && msg) box.textContent = msg;
  showView('acesso-erro');
}

async function bootAcessoRapido(token) {
  modoAcessoRapido = true;
  tokenAcessoRapido = token;
  document.getElementById('app-login')?.classList.add('hidden');
  document.getElementById('app-shell')?.classList.remove('hidden');
  document.getElementById('nav-tabs-filial')?.classList.add('hidden');
  document.getElementById('nav-tabs-admin')?.classList.add('hidden');
  document.getElementById('btn-logout')?.classList.add('hidden');
  const label = document.getElementById('header-user-label');
  if (label) label.textContent = 'Acesso rápido · WhatsApp';
  const subtitle = document.getElementById('header-subtitle');
  if (subtitle) subtitle.textContent = 'Medição sem login — link temporário';

  try {
    const data = await fetchJSON(`${API}/veiculos/acesso-rapido?token=${encodeURIComponent(token)}`);
    if (data.posicoes) meta = { ...meta, posicoes: data.posicoes };
    if (data.limites) limitesAtuais = { ...limitesAtuais, ...data.limites };
    tokenAcessoRapido = data.token_acesso || token;
    await openVeiculoDetalhe(data.id, 'acesso-rapido', data);
  } catch (err) {
    mostrarErroToken(err.message || 'Link expirado ou inválido');
  }
}

async function bootApp() {
  showAppShell();
  try {
    if (isAdmin()) {
      const config = await fetchConfiguracoes();
      limitesAtuais = { ...limitesAtuais, ...config };
      showView('filiais');
      loadFiliais();
      return;
    }

    const [config, metaData] = await Promise.all([
      fetchConfiguracoes(),
      fetchJSON(`${API}/veiculos/meta`),
    ]);
    meta = metaData;
    limitesAtuais = { ...limitesAtuais, ...config };
    const selectTipo = document.getElementById('v-tipo');
    if (selectTipo) {
      selectTipo.innerHTML = meta.tipos.map((t) => `<option value="${t}">${t}</option>`).join('');
    }
    preencherSelectLayouts('v-layout', meta.layout_padrao, { soTruckToco: true });
    preencherSelectLayouts('layout-select', meta.layout_padrao);
    preencherCheckboxesPosicoes('layout-custom-checkboxes', getLayoutById(meta.layout_padrao)?.posicoes || []);
    showView('dashboard');
    loadDashboard();
  } catch (err) {
    toast(err.message || 'Erro ao carregar o sistema', 'error');
  }
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  const tokenUrl = params.get('token');
  if (isRotaAcessoRapido() || (tokenUrl && window.location.pathname.includes('acesso-rapido'))) {
    if (!tokenUrl) {
      mostrarErroToken('Link inválido — token ausente.');
      return;
    }
    await bootAcessoRapido(tokenUrl);
    return;
  }

  const saved = loadAuth();
  if (saved?.token && saved?.usuario) {
    authToken = saved.token;
    currentUser = saved.usuario;
    try {
      const me = await fetchJSON(`${API}/auth/me`);
      currentUser = me;
      saveAuth(authToken, me);
      await bootApp();
      return;
    } catch {
      clearAuth();
    }
  }
  showLogin();
}

init();
