/**
 * Páginas visuais do relatório — mesmo desenho do Preview-Frota-Visual.pdf
 * (caminhão vista de cima, centralizado no card + log + ações/diagnósticos).
 */
const MM = 2.834645669;

const C = {
  fundo: '#f4f6f5',
  branco: '#ffffff',
  verde: '#145223',
  texto: '#1a1a1a',
  mudo: '#5f6b66',
  linha: '#d5ddd7',
  ok: '#16a34a',
  alerta: '#d97706',
  critico: '#dc2626',
  cinza: '#94a3b8',
  critBg: '#fdecea',
  alertaBg: '#fff8e1',
  okBg: '#e8f5e9',
  card: '#ffffff',
  chassis: '#c5d0c8',
};

/** Vista de cima truck 10: (codigo, dx, dy) — dy cresce da frente para trás */
const LAYOUT_10 = [
  ['1E', 28, 22], ['1D', 78, 22],
  ['2EE', 16, 52], ['2EI', 36, 52], ['2DI', 70, 52], ['2DE', 90, 52],
  ['3EE', 16, 82], ['3EI', 36, 82], ['3DI', 70, 82], ['3DE', 90, 82],
];

const POS_ALIAS = {
  DE: '1E', DD: '1D',
  E2EE: '2EE', E2EI: '2EI', E2DI: '2DI', E2DE: '2DE',
  E3EE: '3EE', E3EI: '3EI', E3DI: '3DI', E3DE: '3DE',
  TEE: '2EE', TEI: '2EI', TDI: '2DI', TDE: '2DE',
  '2E': '2EE', '2D': '2DE',
  '3E': '3EE', '3D': '3DE',
};

function rrect(doc, x, y, w, h, r, fill, stroke) {
  if (fill) {
    doc.roundedRect(x, y, w, h, r).fill(fill);
  }
  if (stroke) {
    doc.lineWidth(0.6).strokeColor(stroke).roundedRect(x, y, w, h, r).stroke();
  }
}

function fillStatus(status) {
  const s = String(status || '').toLowerCase();
  if (s.includes('crit')) return C.critico;
  if (s.includes('alerta') || s.includes('monitor')) return C.alerta;
  if (s === 'ok') return C.ok;
  return C.cinza;
}

function bgStatus(status) {
  const s = String(status || '').toLowerCase();
  if (s.includes('crit')) return C.critBg;
  if (s.includes('alerta') || s.includes('monitor')) return C.alertaBg;
  if (s === 'ok') return C.okBg;
  return C.card;
}

function labelStatus(status) {
  const s = String(status || '').toLowerCase();
  if (s.includes('crit')) return 'Critico';
  if (s.includes('alerta') || s.includes('monitor')) return 'Alerta';
  if (s === 'ok') return 'OK';
  return 'Sem medicao';
}

function normPos(pos) {
  const p = String(pos || '').toUpperCase();
  return POS_ALIAS[p] || p;
}

function pneusPorPos(pneus = []) {
  const map = new Map();
  for (const p of pneus) {
    map.set(normPos(p.posicao), p);
  }
  return map;
}

function txt(doc, str, x, y, opts = {}) {
  const savedY = doc.y;
  const savedB = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.text(String(str ?? ''), x, y, { lineBreak: false, ...opts });
  doc.page.margins.bottom = savedB;
  doc.y = savedY;
}

function drawPneu(doc, x, y, cor, label, mmTxt) {
  rrect(doc, x, y, 15, 20, 3, cor, cor === C.ok ? '#14532d' : null);
  doc.fillColor(C.branco).font('Helvetica-Bold').fontSize(5);
  txt(doc, label, x, y + 3.2, { width: 15, align: 'center' });
  doc.fontSize(4.8);
  txt(doc, mmTxt, x, y + 11.2, { width: 15, align: 'center' });
}

/** Card no estilo do preview: desenho centralizado, texto só na faixa de baixo. */
function drawCardCaminhao(doc, x, y, w, h, veiculo) {
  const footer = 16 * MM;
  const fundo = bgStatus(veiculo.status_sulco || veiculo.status_label);
  rrect(doc, x, y, w, h, 8, fundo, C.linha);

  doc.strokeColor(C.linha).lineWidth(0.5)
    .moveTo(x + 8, y + h - footer).lineTo(x + w - 8, y + h - footer).stroke();

  const placa = veiculo.placa || veiculo.apelido || '-';
  const quando = veiculo.ultima_medicao
    ? String(veiculo.ultima_medicao).slice(0, 10).split('-').reverse().join('/')
    : 'Sem medicao';
  const sulco = veiculo.menor_sulco != null ? `${veiculo.menor_sulco} mm` : '-';
  const status = labelStatus(veiculo.status_sulco || veiculo.status_label);

  doc.fillColor(C.texto).font('Helvetica-Bold').fontSize(10);
  txt(doc, placa, x + 8, y + h - footer + 3);
  doc.fillColor(C.mudo).font('Helvetica').fontSize(6.5);
  txt(doc, quando, x + 8, y + h - footer + 15);
  doc.fillColor(C.texto).font('Helvetica-Bold').fontSize(8);
  txt(doc, sulco, x + 8, y + h - 12);
  doc.fillColor(fillStatus(status)).font('Helvetica-Bold').fontSize(7.5);
  txt(doc, status, x + 8, y + h - 12, { width: w - 16, align: 'right' });

  const ox = x + (w - 105) / 2;
  const diagramTop = y + 8;
  doc.fillColor(C.mudo).font('Helvetica').fontSize(6);
  txt(doc, 'FRENTE', x, diagramTop, { width: w, align: 'center' });

  const chassisTop = diagramTop + 12;
  const chassisH = h - footer - chassisTop + y - 6;
  doc.lineWidth(1.1).strokeColor(C.chassis)
    .roundedRect(ox + 18, chassisTop, 70, Math.max(40, chassisH), 9).stroke();

  const byPos = pneusPorPos(veiculo.pneus);
  for (const [codigo, dx, dy] of LAYOUT_10) {
    const p = byPos.get(codigo);
    const cor = p ? fillStatus(p.status_sulco || p.status_label) : C.cinza;
    const mmTxt = p?.menor_sulco != null ? String(p.menor_sulco) : '-';
    const label = codigo.length > 2 ? codigo.slice(-2) : codigo;
    drawPneu(doc, ox + dx, diagramTop + 8 + dy, cor, label, mmTxt);
  }
}

function drawKpi(doc, x, y, w, h, valor, label, barra) {
  rrect(doc, x, y, w, h, 7, C.card, C.linha);
  doc.rect(x, y, 4, h).fill(barra);
  doc.fillColor(C.texto).font('Helvetica-Bold').fontSize(16);
  txt(doc, String(valor ?? 0), x + 12, y + 8);
  doc.fillColor(C.mudo).font('Helvetica').fontSize(7.5);
  txt(doc, label, x + 12, y + h - 14);
}

function drawLogLinha(doc, x, y, w, item) {
  const fundo = bgStatus(item.status || item.status_sulco);
  rrect(doc, x, y, w, 24, 3, fundo, null);
  const hora = item.hora || (item.data ? String(item.data).slice(0, 10).split('-').reverse().join('/') : '--:--');
  const placa = item.placa || '-';
  const pos = item.posicao || item.pos || '-';
  const sulco = item.menor_sulco != null ? `${item.menor_sulco} mm` : (item.sulco || '-');
  const st = labelStatus(item.status || item.status_sulco);
  doc.fillColor(C.mudo).font('Helvetica').fontSize(7);
  txt(doc, hora, x + 6, y + 4);
  doc.fillColor(C.texto).font('Helvetica-Bold').fontSize(8);
  txt(doc, placa, x + 42, y + 4);
  doc.fillColor(C.mudo).font('Helvetica').fontSize(7);
  txt(doc, pos, x + 6, y + 4, { width: w - 12, align: 'right' });
  doc.fillColor(C.texto).font('Helvetica-Bold').fontSize(7.5);
  txt(doc, sulco, x + 42, y + 13);
  doc.fillColor(fillStatus(st)).font('Helvetica-Bold').fontSize(7);
  txt(doc, st, x + 6, y + 13, { width: w - 12, align: 'right' });
}

function cabecalho(doc, W, titulo, sub) {
  rrect(doc, 0, 0, W, 28 * MM, 0, C.verde, null);
  doc.fillColor(C.branco).font('Helvetica-Bold').fontSize(9);
  txt(doc, 'PNEUSISTEMMA', W / 2 - 80, 8, { width: 160, align: 'center' });
  doc.fontSize(16);
  txt(doc, titulo, 24, 20, { width: W - 48, align: 'center' });
  doc.font('Helvetica').fontSize(9);
  txt(doc, sub, 24, 42, { width: W - 48, align: 'center' });
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out.length ? out : [[]];
}

/**
 * Página 1+ da frota: KPIs + 3 caminhões centralizados + log.
 */
export function desenharPaginaFrota(doc, dados, veiculos, logs, pagina, totalPaginas) {
  const W = doc.page.width;
  const H = doc.page.height;
  const margin = 12 * MM;
  doc.rect(0, 0, W, H).fill(C.fundo);

  const filial = dados.filial?.nome || 'Unidade';
  const periodo = dados.periodo?.label || '';
  cabecalho(
    doc,
    W,
    'Frota visual: caminhoes lado a lado + log de medicoes',
    `${filial}${periodo ? `  ·  Semana ${periodo}` : ''}  ·  cores = sulco  ·  log = quando mediu`,
  );

  const r = dados.resumo || {};
  const yKpi = 40 * MM;
  const kpis = [
    [r.veiculos ?? veiculos.length, 'Veiculos', C.verde],
    [r.sulco_ok ?? 0, 'Pneus OK', C.ok],
    [r.sulco_monitorar ?? 0, 'Em alerta', C.alerta],
    [r.sulco_critico ?? 0, 'Criticos', C.critico],
    [r.acao_trocar ?? 0, 'Troca sugerida', C.critico],
  ];
  const kw = (W - 2 * margin - 16) / 5;
  kpis.forEach((k, i) => {
    drawKpi(doc, margin + i * (kw + 4), yKpi, kw, 18 * MM, k[0], k[1], k[2]);
  });

  let y = yKpi + 26 * MM;
  doc.fillColor(C.texto).font('Helvetica-Bold').fontSize(11);
  txt(doc, 'Caminhoes da unidade', margin, y);
  doc.fillColor(C.mudo).font('Helvetica').fontSize(8);
  txt(doc, 'Vermelho = acao agora  ·  caminhao centralizado no card', margin + 52 * MM, y);

  y += 6 * MM;
  const cw = 62 * MM;
  const ch = 72 * MM;
  const gap = 5 * MM;
  const areaW = 3 * (cw + gap);
  const n = Math.min(veiculos.length, 3);
  const startX = n > 0
    ? margin + (areaW - n * cw - Math.max(0, n - 1) * gap) / 2
    : margin;

  if (!veiculos.length) {
    rrect(doc, margin, y, areaW - gap, ch, 8, C.card, C.linha);
    doc.fillColor(C.mudo).font('Helvetica').fontSize(9);
    txt(doc, 'Nenhum veiculo com pneu montado nesta unidade.', margin, y + ch / 2 - 6, {
      width: areaW - gap, align: 'center',
    });
  } else {
    veiculos.slice(0, 3).forEach((v, i) => {
      drawCardCaminhao(doc, startX + i * (cw + gap), y, cw, ch, v);
    });
  }

  const lx = margin + 3 * (cw + gap);
  const lw = W - margin - lx;
  rrect(doc, lx, y, lw, ch, 8, C.card, C.linha);
  doc.fillColor(C.texto).font('Helvetica-Bold').fontSize(10);
  txt(doc, 'Log de medicoes', lx + 8, y + 8);
  doc.fillColor(C.mudo).font('Helvetica').fontSize(7);
  txt(doc, 'Quando o sulco foi registrado', lx + 8, y + 22);

  const linhas = (logs || []).slice(0, 5);
  let yy = y + 38;
  if (!linhas.length) {
    doc.fillColor(C.mudo).font('Helvetica').fontSize(8);
    txt(doc, 'Sem medicoes nesta semana.', lx + 8, yy);
  } else {
    linhas.forEach((ln) => {
      drawLogLinha(doc, lx + 6, yy, lw - 12, ln);
      yy += 26;
    });
  }

  const fy = H - 42 * MM;
  rrect(doc, margin, fy, W - 2 * margin, 28 * MM, 8, C.card, C.linha);
  doc.fillColor(C.verde).font('Helvetica-Bold').fontSize(9);
  txt(doc, 'Como decidir neste relatorio', margin + 8, fy + 6);
  doc.fillColor(C.texto).font('Helvetica').fontSize(8);
  txt(doc, '1. Vermelho na grade = troca/recap agora.', margin + 8, fy + 18);
  txt(doc, '2. O log a direita mostra se mediu nesta semana.', margin + 8, fy + 30);
  txt(doc, '3. Proxima pagina: acoes a executar e diagnosticos de desgaste.', margin + 8, fy + 42);

  doc.fillColor(C.mudo).font('Helvetica').fontSize(7);
  txt(doc, `Pneusistemma  ·  ${pagina}/${totalPaginas}`, W - margin - 120, H - 12, {
    width: 120, align: 'right',
  });
}

function drawItemDecisao(doc, x, y, w, h, item, tipo) {
  const titulo = tipo === 'acao'
    ? (item.acao || item.acao_label || item.status_label || '-')
    : (item.diagnostico || item.diagnostico_label || '-');
  const fundo = bgStatus(item.status_sulco || item.status_label || item.acao);
  const cor = fillStatus(item.status_sulco || item.status_label || item.acao);
  rrect(doc, x, y, w, h, 5, fundo, null);
  doc.fillColor(C.texto).font('Helvetica-Bold').fontSize(9);
  txt(doc, item.placa || item.apelido || '-', x + 8, y + 6);
  doc.fontSize(8);
  txt(doc, item.menor_sulco != null ? `${item.menor_sulco} mm` : '-', x + 8, y + 6, {
    width: w - 16, align: 'right',
  });
  doc.fillColor(C.mudo).font('Helvetica').fontSize(7.5);
  txt(doc, item.posicao || '-', x + 8, y + 18);
  doc.fillColor(cor).font('Helvetica-Bold').fontSize(8);
  txt(doc, String(titulo).slice(0, 28), x + 8, y + 18, { width: w - 16, align: 'right' });
  doc.fillColor(C.mudo).font('Helvetica').fontSize(7);
  const motivo = String(item.motivo || item.diagnostico_desc || item.diagnostico || '').slice(0, 90);
  txt(doc, motivo, x + 8, y + 34, { width: w - 16 });
}

/**
 * Página de ações + diagnósticos, igual ao preview.
 */
export function desenharPaginaAcoes(doc, dados) {
  const W = doc.page.width;
  const H = doc.page.height;
  const margin = 12 * MM;
  doc.rect(0, 0, W, H).fill(C.fundo);
  cabecalho(
    doc,
    W,
    'Acoes e diagnosticos — abaixo da grade da frota',
    'O que fazer agora  ·  causa do desgaste em cada pneu',
  );

  const acoes = [
    ...(dados.prioridades?.troca || []),
    ...(dados.prioridades?.monitorar || []),
    ...(dados.prioridades?.rodizio || []),
  ].slice(0, 5);
  const diags = (dados.diagnosticos || []).slice(0, 5);

  const y0 = 40 * MM;
  const colW = (W - 2 * margin - 6 * MM) / 2;
  const gap = 6 * MM;
  const boxH = H - y0 - 16 * MM;

  rrect(doc, margin, y0, colW, boxH, 8, C.card, C.linha);
  doc.fillColor(C.texto).font('Helvetica-Bold').fontSize(12);
  txt(doc, 'Acoes', margin + 10, y0 + 10);
  doc.fillColor(C.mudo).font('Helvetica').fontSize(8);
  txt(doc, `${acoes.length} pendentes`, margin + 10, y0 + 10, { width: colW - 20, align: 'right' });
  doc.fontSize(7.5);
  txt(doc, 'Trocar, recapar, mudar posicao ou acompanhar', margin + 10, y0 + 26);

  const ih = 22 * MM;
  let yy = y0 + 42;
  if (!acoes.length) {
    doc.fillColor(C.mudo).font('Helvetica').fontSize(8);
    txt(doc, 'Nenhuma acao pendente.', margin + 10, yy);
  } else {
    acoes.forEach((a) => {
      drawItemDecisao(doc, margin + 8, yy, colW - 16, ih, a, 'acao');
      yy += ih + 3 * MM;
    });
  }

  const dx = margin + colW + gap;
  rrect(doc, dx, y0, colW, boxH, 8, C.card, C.linha);
  doc.fillColor(C.texto).font('Helvetica-Bold').fontSize(12);
  txt(doc, 'Diagnosticos', dx + 10, y0 + 10);
  doc.fillColor(C.mudo).font('Helvetica').fontSize(8);
  txt(doc, `${diags.length} irregularidades`, dx + 10, y0 + 10, { width: colW - 20, align: 'right' });
  doc.fontSize(7.5);
  txt(doc, 'Causa do desgaste: calibragem, perfil ou critico', dx + 10, y0 + 26);

  yy = y0 + 42;
  if (!diags.length) {
    doc.fillColor(C.mudo).font('Helvetica').fontSize(8);
    txt(doc, 'Nenhum diagnostico irregular.', dx + 10, yy);
  } else {
    diags.forEach((d) => {
      drawItemDecisao(doc, dx + 8, yy, colW - 16, ih, d, 'diag');
      yy += ih + 3 * MM;
    });
  }

  doc.fillColor(C.mudo).font('Helvetica').fontSize(7);
  txt(doc, 'Pneusistemma  ·  acoes e diagnosticos', W - margin - 180, H - 12, {
    width: 180, align: 'right',
  });
}

export function desenharRelatorioVisual(doc, dados) {
  const veiculos = (dados.frota || []).filter((v) => v.pneus?.length);
  const logs = (dados.medicoes_semana_lista || []).map((m) => ({
    ...m,
    hora: m.data ? String(m.data).slice(8, 10) + '/' + String(m.data).slice(5, 7) : '',
    status: m.status,
  }));
  const grupos = chunk(veiculos, 3);
  const total = grupos.length + 1;
  grupos.forEach((grupo, i) => {
    if (i > 0) {
      doc.addPage({ size: 'A4', layout: 'landscape', margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    }
    desenharPaginaFrota(doc, dados, grupo, logs, i + 1, total);
  });
  doc.addPage({ size: 'A4', layout: 'landscape', margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  desenharPaginaAcoes(doc, dados);
}
