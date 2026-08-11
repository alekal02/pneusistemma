/**
 * Tokens de acesso rápido (links WhatsApp sem JWT)
 */
import { randomBytes } from 'crypto';
import { getDb, classificarSulco } from '../database.js';
import { config } from '../config.js';
import { getLimites, menorSulco } from '../limites.js';
import { diagnosticarPerfil, sugerirAcao, percentualVida } from '../diagnostico.js';
import { normalizarTipoVeiculo } from '../fix-encoding.js';
import {
  POSICOES_PNEU,
  LAYOUTS_PNEU,
  LAYOUT_PADRAO,
  labelPosicao,
  papelPosicao,
  sqlOrderPosicao,
  getLayout,
  labelTipoPneu,
} from '../pneus-layouts.js';

export function gerarTokenAcessoRapido({ veiculoId, filialId, whatsappOrigem = null }) {
  const db = getDb();
  const token = randomBytes(32).toString('hex');
  db.prepare(`
    INSERT INTO tokens_acesso_rapido (token, veiculo_id, filial_id, whatsapp_origem, expira_em)
    VALUES (?, ?, ?, ?, datetime('now', 'localtime', '+24 hours'))
  `).run(token, veiculoId, filialId, whatsappOrigem);

  const link = `${config.frontendUrl.replace(/\/$/, '')}/veiculo-acesso-rapido?token=${token}`;
  return { token, link };
}

export function validarTokenAcessoRapido(token) {
  if (!token) return null;
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM tokens_acesso_rapido
    WHERE token = ? AND expira_em > datetime('now', 'localtime')
  `).get(token);
  return row || null;
}

export function marcarTokenUsado(tokenId) {
  const db = getDb();
  db.prepare(`
    UPDATE tokens_acesso_rapido
    SET usado_em = COALESCE(usado_em, datetime('now', 'localtime'))
    WHERE id = ?
  `).run(tokenId);
}

/** Mesmo payload de GET /veiculos/:id */
export function montarDetalheVeiculo(veiculoId, filialId = null) {
  const db = getDb();
  const limites = getLimites();

  let veiculo;
  if (filialId != null) {
    veiculo = db.prepare(`
      SELECT * FROM veiculos WHERE id = ? AND filial_id = ? AND ativo = 1
    `).get(veiculoId, filialId);
  } else {
    veiculo = db.prepare(`
      SELECT * FROM veiculos WHERE id = ? AND ativo = 1
    `).get(veiculoId);
  }
  if (!veiculo) return null;

  const orderSql = sqlOrderPosicao('p.posicao');
  const pneus = db.prepare(`
    SELECT p.*,
      (SELECT sulco_externo FROM medicoes WHERE pneu_id = p.id ORDER BY data_medicao DESC, id DESC LIMIT 1) as ult_sulco_ext,
      (SELECT sulco_central FROM medicoes WHERE pneu_id = p.id ORDER BY data_medicao DESC, id DESC LIMIT 1) as ult_sulco_cent,
      (SELECT sulco_interno FROM medicoes WHERE pneu_id = p.id ORDER BY data_medicao DESC, id DESC LIMIT 1) as ult_sulco_int,
      (SELECT sulco_auxiliar FROM medicoes WHERE pneu_id = p.id ORDER BY data_medicao DESC, id DESC LIMIT 1) as ult_sulco_aux,
      (SELECT diagnostico FROM medicoes WHERE pneu_id = p.id ORDER BY data_medicao DESC, id DESC LIMIT 1) as ult_diagnostico,
      (SELECT acao_sugerida FROM medicoes WHERE pneu_id = p.id ORDER BY data_medicao DESC, id DESC LIMIT 1) as ult_acao,
      (SELECT data_medicao FROM medicoes WHERE pneu_id = p.id ORDER BY data_medicao DESC, id DESC LIMIT 1) as ult_medicao
    FROM pneus p
    WHERE p.veiculo_id = ? AND p.ativo = 1 AND p.status_pneu = 'montado'
    ORDER BY ${orderSql}
  `).all(veiculoId);

  const pneusComStatus = pneus.map((p) => {
    const row = {
      sulco_externo: p.ult_sulco_ext,
      sulco_central: p.ult_sulco_cent,
      sulco_interno: p.ult_sulco_int,
      sulco_auxiliar: p.ult_sulco_aux,
    };
    const menor = menorSulco(row);
    const diag = diagnosticarPerfil(row, limites.diagnostico_tolerancia_mm);
    const acao = sugerirAcao(menor, limites, p.vida_recap || 0);
    const sulcoRef = p.sulco_inicial_mm ?? limites.sulco_novo_mm;

    return {
      ...p,
      posicao_label: labelPosicao(p.posicao),
      papel_posicao: papelPosicao(p.posicao),
      padrao: p.tipo_pneu,
      padrao_label: labelTipoPneu(p.tipo_pneu),
      menor_sulco: menor,
      status_sulco: classificarSulco(menor),
      diagnostico: p.ult_diagnostico || diag.codigo,
      diagnostico_label: diag.label,
      acao_sugerida: p.ult_acao || acao.codigo,
      acao_label: acao.label,
      acao_motivo: acao.motivo,
      vida_util_pct: percentualVida(menor, sulcoRef, limites.sulco_critico_mm),
      vida_label: p.vida_recap > 0
        ? `${p.vida_recap}ª recap`
        : (p.condicao === 'novo' ? 'Novo' : 'Recapado'),
      ultima_medicao: p.ult_medicao || menor != null
        ? {
          data: p.ult_medicao || null,
          sulco_externo: p.ult_sulco_ext,
          sulco_central: p.ult_sulco_cent,
          sulco_interno: p.ult_sulco_int,
          sulco_auxiliar: p.ult_sulco_aux,
          menor_sulco: menor,
        }
        : null,
    };
  });

  const layout = getLayout(veiculo.layout_pneus || LAYOUT_PADRAO);
  const posicoesLayout = (LAYOUTS_PNEU[veiculo.layout_pneus]
    ? layout.posicoes
    : layout.posicoes).map((codigo) => ({
    codigo,
    label: labelPosicao(codigo),
    papel: papelPosicao(codigo),
    montado: pneusComStatus.some((p) => p.posicao === codigo),
  }));

  const medicoes = db.prepare(`
    SELECT m.*, p.posicao, p.numero_fogo
    FROM medicoes m
    JOIN pneus p ON m.pneu_id = p.id
    WHERE p.veiculo_id = ?
    ORDER BY m.data_medicao DESC, m.id DESC
    LIMIT 20
  `).all(veiculoId);

  return {
    ...veiculo,
    tipo: normalizarTipoVeiculo(veiculo.tipo),
    pneus: pneusComStatus,
    posicoes_layout: posicoesLayout,
    layout: {
      id: veiculo.layout_pneus || LAYOUT_PADRAO,
      nome: layout.nome,
      posicoes: layout.posicoes,
    },
    medicoes,
    posicoes: POSICOES_PNEU,
    limites,
    token_valido: true,
  };
}

export function resumoStatusPneusVeiculo(veiculoId) {
  const detalhe = montarDetalheVeiculo(veiculoId);
  if (!detalhe) return { criticos: 0, alertas: 0, ok: 0, ultimaMedicao: null };

  const criticos = detalhe.pneus.filter((p) => p.status_sulco === 'critico').length;
  const alertas = detalhe.pneus.filter((p) => p.status_sulco === 'alerta').length;
  const ok = detalhe.pneus.filter((p) => p.status_sulco === 'ok').length;

  const ultima = detalhe.medicoes?.[0] || null;
  let ultimaMedicao = null;
  if (ultima) {
    const menor = menorSulco(ultima);
    ultimaMedicao = {
      data_medicao: ultima.data_medicao,
      posicao: ultima.posicao,
      numero_fogo: ultima.numero_fogo,
      menor_sulco: menor,
    };
  }

  return { criticos, alertas, ok, ultimaMedicao };
}
