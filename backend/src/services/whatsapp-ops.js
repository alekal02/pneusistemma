/**
 * Operações de frota usadas pelo menu WhatsApp (escopo por filial_id).
 */
import { getDb } from '../database.js';
import { ehViolacaoUnique } from '../db-utils.js';
import { getLimites, classificarSulco, limitesDoVeiculo, menorSulco } from '../limites.js';
import { normalizarTipoVeiculo } from '../fix-encoding.js';
import { comRetryFogoUnico } from '../numero-fogo.js';
import {
  LAYOUT_PADRAO,
  TIPOS_PNEU,
  CONDICOES_PNEU,
  getLayout,
  labelPosicao,
  validarMontagem,
  aplicarLayoutPneus,
  layoutPadraoPorTipo,
} from '../pneus-layouts.js';

function erroOps(mensagem, status) {
  return Object.assign(new Error(mensagem), { status });
}

export const SQL_CADASTRO_COMPLETO = 'COALESCE(cadastro_completo, 1) = 1';

export function cadastroEstaCompleto(row) {
  return row != null && Number(row.cadastro_completo ?? 1) === 1;
}

function assertVeiculoOperacional(veiculo) {
  if (!veiculo) throw erroOps('Veículo não encontrado', 404);
  if (!cadastroEstaCompleto(veiculo)) {
    throw erroOps(
      'Veículo em pré-cadastro: conclua o cadastro no link web antes de operar',
      400
    );
  }
}

function assertPneuOperacional(pneu) {
  if (!pneu) throw erroOps('Pneu não encontrado', 404);
  if (!cadastroEstaCompleto(pneu)) {
    throw erroOps(
      'Pneu em pré-cadastro: conclua o cadastro no link web antes de operar',
      400
    );
  }
}

function falharTxSeTeste() {
  if (process.env.PNEU_TEST_FALHAR_TX === '1') {
    throw erroOps('falha simulada na transação', 500);
  }
}

/**
 * Valida o pneu substituto (filial, estoque, posição, validarMontagem) sem alterar o banco.
 */
export async function validarSubstitutoEstoque({ filialId, pneuEstoqueId, veiculoId, posicao }) {
  const db = getDb();
  const id = parseInt(pneuEstoqueId, 10);
  if (!id) {
    throw erroOps('Informe o pneu do estoque para ocupar a posição', 400);
  }
  const estoque = await db.prepare('SELECT * FROM pneus WHERE id = ?').get(id);
  if (!estoque) {
    throw erroOps('Pneu do estoque não encontrado', 404);
  }
  if (Number(estoque.filial_id) !== Number(filialId)) {
    throw erroOps('Pneu substituto pertence a outra filial', 400);
  }
  if (Number(estoque.ativo) !== 1) {
    throw erroOps('Pneu substituto indisponível (inativo)', 400);
  }
  assertPneuOperacional(estoque);
  if (estoque.status_pneu !== 'estoque') {
    const motivo = estoque.status_pneu === 'montado'
      ? 'já está montado'
      : estoque.status_pneu === 'recapagem'
        ? 'está em recapagem'
        : estoque.status_pneu === 'descarte'
          ? 'está no descarte'
          : `está em ${estoque.status_pneu}`;
    throw erroOps(`Pneu substituto indisponível (${motivo})`, 400);
  }
  const veiculo = await db.prepare(`
    SELECT * FROM veiculos WHERE id = ? AND filial_id = ? AND ativo = 1
  `).get(veiculoId, filialId);
  if (!veiculo) {
    throw erroOps('Veículo não encontrado', 404);
  }
  assertVeiculoOperacional(veiculo);
  const pos = String(posicao || '').trim().toUpperCase();
  const layout = getLayout(veiculo.layout_pneus || LAYOUT_PADRAO);
  if (!layout.posicoes.includes(pos)) {
    throw erroOps(`Posição ${pos} inválida neste veículo`, 400);
  }
  const validacao = validarMontagem({
    condicao: estoque.condicao,
    tipo_pneu: estoque.tipo_pneu,
    posicao: pos,
  });
  if (!validacao.ok) {
    throw erroOps(validacao.erros.join(' '), 400);
  }
  return { estoque, veiculo, posicao: pos };
}

function hojeIso() {
  return new Date().toISOString().split('T')[0];
}

async function registrarMovimentacao(db, {
  pneuId, veiculoId, tipo, data, km, hr, posicao, detalhes = null, placa = null,
}) {
  await db.prepare(`
    INSERT INTO movimentacoes (
      pneu_id, veiculo_id, tipo, data_evento, km_veiculo, hr_veiculo,
      posicao, detalhes, veiculo_placa
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    pneuId, veiculoId, tipo, data,
    km ?? null, hr ?? null, posicao ?? null, detalhes, placa
  );
}

export async function buscarVeiculoPorPlaca(filialId, placaLimpa) {
  const db = getDb();
  const rows = await db.prepare(`
    SELECT v.*, f.nome as filial_nome,
      REPLACE(REPLACE(UPPER(v.placa), '-', ''), ' ', '') AS placa_norm
    FROM veiculos v
    JOIN filiais f ON f.id = v.filial_id
    WHERE v.ativo = 1 AND v.filial_id = ?
      AND ${SQL_CADASTRO_COMPLETO.replace('cadastro_completo', 'v.cadastro_completo')}
      AND REPLACE(REPLACE(UPPER(v.placa), '-', ''), ' ', '') LIKE ?
    ORDER BY v.placa
    LIMIT 15
  `).all(filialId, `%${placaLimpa}%`);

  const exatos = rows.filter((v) => {
    const p = String(v.placa_norm || '').replace(/[^A-Z0-9]/gi, '');
    return p === placaLimpa;
  });
  return exatos.length ? exatos : rows;
}

export async function listarFrota(filialId) {
  const db = getDb();
  const rows = await db.prepare(`
    SELECT id, placa, apelido, tipo, layout_pneus
    FROM veiculos
    WHERE ativo = 1 AND filial_id = ?
      AND ${SQL_CADASTRO_COMPLETO}
    ORDER BY placa
  `).all(filialId);
  const out = [];
  for (const v of rows || []) {
    const pneus = await db.prepare(`
      SELECT
        m.sulco_externo, m.sulco_central, m.sulco_interno, m.sulco_auxiliar
      FROM pneus p
      LEFT JOIN medicoes m ON m.pneu_id = p.id
        AND m.id = (SELECT id FROM medicoes WHERE pneu_id = p.id ORDER BY data_medicao DESC, id DESC LIMIT 1)
      WHERE p.veiculo_id = ? AND p.ativo = 1 AND p.status_pneu = 'montado'
    `).all(v.id);
    let menor = null;
    for (const p of pneus || []) {
      const m = menorSulco(p);
      if (m != null) menor = menor == null ? m : Math.min(menor, m);
    }
    const status = classificarSulco(menor, limitesDoVeiculo(v));
    out.push({
      ...v,
      menor_sulco: menor,
      status_sulco: status,
      status_label: ({ ok: 'OK', alerta: 'Alerta', critico: 'Critico', sem_dado: 'Sem medicao' })[status] || status,
    });
  }
  return out;
}

export async function buscarPlacaFilial(filialId, placaTexto) {
  const db = getDb();
  const placaLimpa = String(placaTexto || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!placaLimpa) return null;
  return db.prepare(`
    SELECT v.*
    FROM veiculos v
    WHERE v.filial_id = ?
      AND REPLACE(REPLACE(UPPER(v.placa), '-', ''), ' ', '') = ?
    LIMIT 1
  `).get(filialId, placaLimpa);
}

export async function criarVeiculo(filialId, {
  placa, apelido = null, tipo = 'Truck / Tração', km_atual = 0, layout_pneus = null,
  marca = null, modelo = null, preCadastro = false,
}) {
  const db = getDb();
  const layoutId = preCadastro ? null : (layout_pneus || layoutPadraoPorTipo(tipo));
  try {
    const result = await db.prepare(`
      INSERT INTO veiculos (
        placa, apelido, tipo, marca, modelo, km_atual, hr_atual, layout_pneus,
        filial_id, ativo, cadastro_completo
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 1, ?)
    `).run(
      String(placa).trim().toUpperCase(),
      apelido?.trim() || null,
      normalizarTipoVeiculo(tipo) || 'Truck / Tração',
      marca?.trim() || null,
      modelo?.trim() || null,
      Number(km_atual) || 0,
      layoutId,
      filialId,
      preCadastro ? 0 : 1
    );
    const id = result.lastInsertRowid;
    if (preCadastro) {
      return { id, layoutId: null, total_posicoes: 0, preCadastro: true };
    }
    const posicoes = await aplicarLayoutPneus(db, id, layoutId, null);
    return { id, layoutId, total_posicoes: posicoes.length, preCadastro: false };
  } catch (err) {
    if (ehViolacaoUnique(err)) {
      const e = new Error('Placa já cadastrada');
      e.status = 409;
      throw e;
    }
    throw err;
  }
}

export async function completarVeiculo(filialId, veiculoId, {
  marca, modelo, tipo, km_atual, layout_pneus, apelido, ano = null,
}) {
  const db = getDb();
  const veiculo = await db.prepare(`
    SELECT * FROM veiculos WHERE id = ? AND filial_id = ?
  `).get(veiculoId, filialId);
  if (!veiculo) throw erroOps('Veículo não encontrado', 404);
  const modeloOk = String(modelo || '').trim();
  const marcaOk = String(marca || '').trim();
  const layoutId = layout_pneus || layoutPadraoPorTipo(tipo || veiculo.tipo);
  if (!modeloOk) throw erroOps('Modelo é obrigatório para concluir o cadastro', 400);
  if (!marcaOk) throw erroOps('Fabricante é obrigatório para concluir o cadastro', 400);
  if (!layoutId) throw erroOps('Configuração dos eixos é obrigatória', 400);

  await db.prepare(`
    UPDATE veiculos SET
      marca = ?, modelo = ?, tipo = COALESCE(?, tipo),
      km_atual = COALESCE(?, km_atual), apelido = COALESCE(?, apelido),
      ano = COALESCE(?, ano), cadastro_completo = 1, updated_at = NOW()
    WHERE id = ?
  `).run(
    marcaOk,
    modeloOk,
    tipo ? (normalizarTipoVeiculo(tipo) || tipo) : null,
    km_atual != null ? Number(km_atual) : null,
    apelido != null ? (String(apelido).trim() || null) : null,
    ano != null ? Number(ano) : null,
    veiculoId
  );
  const posicoes = await aplicarLayoutPneus(db, veiculoId, layoutId, null);
  return { id: veiculoId, layoutId, total_posicoes: posicoes.length, placa: veiculo.placa };
}

export async function criarPneuEstoque(filialId, {
  numero_fogo, marca = null, modelo, tipo_pneu = 'misto',
  condicao = 'novo', sulco_inicial_mm = null, preCadastro = false,
}) {
  const db = getDb();
  const modeloOk = preCadastro ? (String(modelo || '').trim() || 'Pendente') : String(modelo || '').trim();
  if (!modeloOk) throw Object.assign(new Error('Modelo obrigatório'), { status: 400 });
  const tipo = TIPOS_PNEU.includes(tipo_pneu) ? tipo_pneu : 'misto';
  const cond = CONDICOES_PNEU.includes(condicao) ? condicao : 'novo';
  const vida = cond === 'recapado' ? 1 : 0;
  try {
    const { result } = await comRetryFogoUnico(db, filialId, numero_fogo, (fogo) => (
      db.prepare(`
      INSERT INTO pneus (
        veiculo_id, posicao, filial_id, marca, modelo, numero_fogo,
        tipo_pneu, condicao, vida_recap, sulco_inicial_mm, status_pneu, ativo,
        cadastro_completo
      ) VALUES (NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'estoque', 1, ?)
    `).run(
        filialId,
        marca?.trim() || null,
        modeloOk,
        fogo,
        tipo,
        cond,
        vida,
        sulco_inicial_mm != null ? Number(sulco_inicial_mm) : null,
        preCadastro ? 0 : 1
      )
    ));
    return db.prepare('SELECT * FROM pneus WHERE id = ?').get(result.lastInsertRowid);
  } catch (err) {
    if (err.status) throw err;
    if (ehViolacaoUnique(err)) {
      throw Object.assign(new Error('Já existe pneu com este nº de fogo'), { status: 409 });
    }
    throw err;
  }
}

export async function completarPneu(filialId, pneuId, {
  marca, modelo, tipo_pneu, condicao, sulco_inicial_mm, numero_fogo = null,
}) {
  const db = getDb();
  const pneu = await db.prepare(`
    SELECT * FROM pneus WHERE id = ? AND filial_id = ? AND ativo = 1
  `).get(pneuId, filialId);
  if (!pneu) throw erroOps('Pneu não encontrado', 404);
  const modeloOk = String(modelo || '').trim();
  if (!modeloOk || /^pendente$/i.test(modeloOk)) {
    throw erroOps('Modelo é obrigatório para concluir o cadastro', 400);
  }
  const tipo = TIPOS_PNEU.includes(tipo_pneu) ? tipo_pneu : (pneu.tipo_pneu || 'misto');
  const cond = CONDICOES_PNEU.includes(condicao) ? condicao : (pneu.condicao || 'novo');
  const vida = cond === 'recapado' ? Math.max(Number(pneu.vida_recap) || 0, 1) : (Number(pneu.vida_recap) || 0);
  await db.prepare(`
    UPDATE pneus SET
      marca = ?, modelo = ?, tipo_pneu = ?, condicao = ?, vida_recap = ?,
      sulco_inicial_mm = COALESCE(?, sulco_inicial_mm),
      numero_fogo = COALESCE(?, numero_fogo),
      cadastro_completo = 1
    WHERE id = ?
  `).run(
    marca?.trim() || null,
    modeloOk,
    tipo,
    cond,
    vida,
    sulco_inicial_mm != null && sulco_inicial_mm !== '' ? Number(sulco_inicial_mm) : null,
    numero_fogo ? String(numero_fogo).trim() : null,
    pneuId
  );
  return db.prepare('SELECT * FROM pneus WHERE id = ?').get(pneuId);
}

export async function listarEstoque(filialId, limit = 20) {
  const db = getDb();
  return db.prepare(`
    SELECT id, numero_fogo, marca, modelo, tipo_pneu, condicao
    FROM pneus
    WHERE filial_id = ? AND ativo = 1 AND status_pneu = 'estoque'
      AND ${SQL_CADASTRO_COMPLETO}
    ORDER BY numero_fogo
    LIMIT ?
  `).all(filialId, limit);
}

export async function buscarPneuPorFogo(filialId, fogo) {
  const db = getDb();
  const n = String(fogo || '').trim();
  return db.prepare(`
    SELECT p.*, v.placa
    FROM pneus p
    LEFT JOIN veiculos v ON v.id = p.veiculo_id
    WHERE p.filial_id = ? AND p.ativo = 1
      AND LOWER(TRIM(p.numero_fogo)) = LOWER(?)
    LIMIT 1
  `).get(filialId, n);
}

/**
 * Match exato na filial; se não houver, parcial (hífen ignorado). Não cruza filial.
 */
export async function buscarPneusPorFogo(filialId, fogo, { limite = 8 } = {}) {
  const db = getDb();
  const n = String(fogo || '').trim();
  if (!n) return [];
  const exatos = await db.prepare(`
    SELECT p.*, v.placa
    FROM pneus p
    LEFT JOIN veiculos v ON v.id = p.veiculo_id
    WHERE p.filial_id = ? AND p.ativo = 1
      AND LOWER(TRIM(p.numero_fogo)) = LOWER(?)
    ORDER BY p.numero_fogo
    LIMIT ?
  `).all(filialId, n, limite);
  if (exatos.length) return exatos;

  const compacto = n.replace(/[-\s]/g, '').toLowerCase();
  if (compacto.length < 3) return [];
  return db.prepare(`
    SELECT p.*, v.placa
    FROM pneus p
    LEFT JOIN veiculos v ON v.id = p.veiculo_id
    WHERE p.filial_id = ? AND p.ativo = 1
      AND (
        LOWER(p.numero_fogo) LIKE '%' || LOWER(?) || '%'
        OR REPLACE(REPLACE(LOWER(p.numero_fogo), '-', ''), ' ', '') LIKE '%' || ? || '%'
      )
    ORDER BY p.numero_fogo
    LIMIT ?
  `).all(filialId, n, compacto, limite + 1);
}

export async function listarPneusMontados(veiculoId) {
  const db = getDb();
  return db.prepare(`
    SELECT id, numero_fogo, posicao, marca, modelo
    FROM pneus
    WHERE veiculo_id = ? AND ativo = 1 AND status_pneu = 'montado'
    ORDER BY posicao
  `).all(veiculoId);
}

export async function posicoesLivres(veiculoId) {
  const db = getDb();
  const v = await db.prepare('SELECT * FROM veiculos WHERE id = ? AND ativo = 1').get(veiculoId);
  if (!v) return [];
  const layout = getLayout(v.layout_pneus || LAYOUT_PADRAO);
  const ocupadas = new Set(
    (await db.prepare(`
      SELECT posicao FROM pneus
      WHERE veiculo_id = ? AND ativo = 1 AND status_pneu = 'montado'
    `).all(veiculoId)).map((r) => r.posicao)
  );
  return layout.posicoes.filter((p) => !ocupadas.has(p));
}

export async function montarPneu({ filialId, pneuId, veiculoId, posicao }) {
  const db = getDb();
  const pneu = await db.prepare(`
    SELECT * FROM pneus WHERE id = ? AND filial_id = ? AND ativo = 1
  `).get(pneuId, filialId);
  if (!pneu) throw Object.assign(new Error('Pneu não encontrado'), { status: 404 });
  if (pneu.status_pneu === 'descarte') {
    throw Object.assign(new Error('Pneu descartado não pode ser montado'), { status: 400 });
  }
  if (pneu.status_pneu === 'montado') {
    throw Object.assign(new Error('Pneu já está montado'), { status: 400 });
  }
  assertPneuOperacional(pneu);
  const veiculo = await db.prepare(`
    SELECT * FROM veiculos WHERE id = ? AND filial_id = ? AND ativo = 1
  `).get(veiculoId, filialId);
  if (!veiculo) throw Object.assign(new Error('Veículo não encontrado'), { status: 404 });
  assertVeiculoOperacional(veiculo);

  const layout = getLayout(veiculo.layout_pneus || LAYOUT_PADRAO);
  if (!layout.posicoes.includes(posicao)) {
    throw Object.assign(new Error(`Posição ${posicao} inválida neste veículo`), { status: 400 });
  }
  const validacao = validarMontagem({
    condicao: pneu.condicao,
    tipo_pneu: pneu.tipo_pneu,
    posicao,
  });
  if (!validacao.ok) {
    throw Object.assign(new Error(validacao.erros.join(' ')), { status: 400 });
  }
  const ocupado = await db.prepare(`
    SELECT id, numero_fogo FROM pneus
    WHERE veiculo_id = ? AND posicao = ? AND ativo = 1 AND status_pneu = 'montado'
  `).get(veiculoId, posicao);
  if (ocupado) {
    throw Object.assign(
      new Error(`Posição ${posicao} ocupada${ocupado.numero_fogo ? ` (fogo ${ocupado.numero_fogo})` : ''}`),
      { status: 409 }
    );
  }

  const data = hojeIso();
  await db.transaction(async () => {
    await db.prepare(`
      UPDATE pneus SET
        veiculo_id = ?, posicao = ?, status_pneu = 'montado',
        data_instalacao = ?, km_instalacao = ?, ativo = 1
      WHERE id = ?
    `).run(veiculoId, posicao, data, veiculo.km_atual || null, pneuId);
    await registrarMovimentacao(db, {
      pneuId,
      veiculoId,
      tipo: 'montagem',
      data,
      km: veiculo.km_atual,
      hr: veiculo.hr_atual,
      posicao,
      detalhes: `WhatsApp · ${veiculo.placa} · ${labelPosicao(posicao)}`,
      placa: veiculo.placa,
    });
  });
  return { placa: veiculo.placa, posicao, label: labelPosicao(posicao), fogo: pneu.numero_fogo };
}

export function autorizarDesmontagemSimples(valor) {
  if (valor === true || valor === 1) return true;
  const s = String(valor ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'sim';
}

export async function desmontarPneu({
  filialId, pneuId, detalhes = null, km = undefined, hr = undefined,
}) {
  const db = getDb();
  const pneu = await db.prepare(`
    SELECT p.*, v.placa, v.km_atual, v.hr_atual
    FROM pneus p
    LEFT JOIN veiculos v ON v.id = p.veiculo_id
    WHERE p.id = ? AND p.filial_id = ? AND p.ativo = 1
  `).get(pneuId, filialId);
  if (!pneu) throw erroOps('Pneu não encontrado', 404);
  if (pneu.status_pneu !== 'montado' || !pneu.veiculo_id) {
    throw erroOps('Pneu não está montado', 400);
  }
  const data = hojeIso();
  const veiculoId = pneu.veiculo_id;
  const posicao = pneu.posicao;
  await db.transaction(async () => {
    await db.prepare(`
      UPDATE pneus SET veiculo_id = NULL, posicao = NULL, status_pneu = 'estoque', data_instalacao = NULL
      WHERE id = ?
    `).run(pneuId);
    await registrarMovimentacao(db, {
      pneuId,
      veiculoId,
      tipo: 'retirada',
      data,
      km: km !== undefined ? km : pneu.km_atual,
      hr: hr !== undefined ? hr : pneu.hr_atual,
      posicao,
      detalhes: detalhes?.trim() || `WhatsApp · retirou de ${pneu.placa || ''}`,
      placa: pneu.placa,
    });
  });
  return {
    fogo: pneu.numero_fogo,
    placa: pneu.placa,
    posicao,
    veiculo_id: veiculoId,
    estava_montado: true,
  };
}

/**
 * Envio ao estoque: troca atômica se houver substituto; desmontagem simples só com autorização explícita.
 */
export async function enviarAoEstoqueOuTrocar({
  filialId,
  pneuId,
  pneuEstoqueId = null,
  permitirVazio = false,
  detalhes = null,
  km,
  hr,
}) {
  const substId = parseInt(pneuEstoqueId, 10) || null;
  if (substId) {
    const troca = await trocarPorEstoque({
      filialId,
      pneuMontadoId: pneuId,
      pneuEstoqueId: substId,
    });
    return { modo: 'troca', ...troca };
  }
  if (permitirVazio) {
    const r = await desmontarPneu({ filialId, pneuId, detalhes, km, hr });
    return { modo: 'desmontagem_simples', ...r };
  }
  throw erroOps(
    'Informe o pneu do estoque para ocupar a posição, ou autorize desmontagem simples (permitir_vazio)',
    400,
  );
}

export async function registrarRecap({ filialId, pneuId, pneuEstoqueId = null }) {
  const db = getDb();
  const limites = getLimites();
  const pneu = await db.prepare(`
    SELECT * FROM pneus WHERE id = ? AND filial_id = ? AND ativo = 1
  `).get(pneuId, filialId);
  if (!pneu) throw erroOps('Pneu não encontrado', 404);
  if (pneu.status_pneu === 'recapagem') {
    throw erroOps('Pneu já está em recapagem', 400);
  }
  if (pneu.status_pneu === 'descarte') {
    throw erroOps('Pneu já está no descarte', 400);
  }
  const novaVida = (pneu.vida_recap || 0) + 1;
  if (novaVida > (limites.max_recaps || 6)) {
    throw erroOps(`Limite de recaps atingido (${limites.max_recaps})`, 400);
  }
  const data = hojeIso();
  const estavaMontado = pneu.status_pneu === 'montado' && pneu.veiculo_id;
  const veiculoId = pneu.veiculo_id || null;
  const posicao = pneu.posicao || null;
  let placa = null;
  let substituto = null;
  if (estavaMontado) {
    const veiculo = await db.prepare('SELECT * FROM veiculos WHERE id = ?').get(pneu.veiculo_id);
    placa = veiculo?.placa || null;
    if (!pneuEstoqueId) {
      throw erroOps('Informe o pneu do estoque para ocupar a posição', 400);
    }
    if (Number(pneuEstoqueId) === Number(pneuId)) {
      throw erroOps('O pneu substituto deve ser outro pneu do estoque', 400);
    }
    substituto = await validarSubstitutoEstoque({
      filialId,
      pneuEstoqueId,
      veiculoId,
      posicao,
    });
  }
  let montagem = null;
  await db.transaction(async () => {
    if (estavaMontado) {
      const veiculo = await db.prepare('SELECT * FROM veiculos WHERE id = ?').get(pneu.veiculo_id);
      await registrarMovimentacao(db, {
        pneuId,
        veiculoId: pneu.veiculo_id,
        tipo: 'retirada',
        data,
        km: veiculo?.km_atual,
        hr: veiculo?.hr_atual,
        posicao: pneu.posicao,
        detalhes: 'WhatsApp · retirou para recap',
        placa: veiculo?.placa,
      });
    }
    await db.prepare(`
      UPDATE pneus SET
        veiculo_id = NULL, posicao = NULL, status_pneu = 'recapagem',
        vida_recap = ?, condicao = 'recapado', data_instalacao = NULL
      WHERE id = ?
    `).run(novaVida, pneuId);
    await registrarMovimentacao(db, {
      pneuId,
      veiculoId: estavaMontado ? veiculoId : null,
      tipo: 'recap',
      data,
      km: null,
      hr: null,
      posicao: estavaMontado ? posicao : null,
      detalhes: estavaMontado
        ? `WhatsApp · enviou à recap (${novaVida}ª vida) · origem ${placa || ''} ${posicao || ''}`.trim()
        : `WhatsApp · enviou à recap (${novaVida}ª vida) · origem estoque`,
      placa,
    });
    if (estavaMontado && substituto) {
      falharTxSeTeste();
      montagem = await montarPneu({
        filialId,
        pneuId: substituto.estoque.id,
        veiculoId,
        posicao,
      });
    }
  });
  return {
    fogo: pneu.numero_fogo,
    vida: novaVida,
    estava_montado: Boolean(estavaMontado),
    veiculo_id: veiculoId,
    posicao,
    placa,
    substituto: montagem,
  };
}

/** Recap concluído: pneu volta ao estoque para reuso */
export async function devolverRecapAoEstoque({ filialId, pneuId }) {
  const db = getDb();
  const pneu = await db.prepare(`
    SELECT * FROM pneus WHERE id = ? AND filial_id = ? AND ativo = 1
  `).get(pneuId, filialId);
  if (!pneu) throw Object.assign(new Error('Pneu não encontrado'), { status: 404 });
  if (pneu.status_pneu !== 'recapagem') {
    throw Object.assign(new Error('Pneu não está em recapagem'), { status: 400 });
  }
  const data = hojeIso();
  await db.transaction(async () => {
    await db.prepare(`
      UPDATE pneus SET
        status_pneu = 'estoque',
        condicao = 'recapado',
        veiculo_id = NULL,
        posicao = NULL,
        data_instalacao = NULL
      WHERE id = ?
    `).run(pneuId);
    await registrarMovimentacao(db, {
      pneuId,
      veiculoId: null,
      tipo: 'retorno_recap',
      data,
      km: null,
      hr: null,
      posicao: null,
      detalhes: `WhatsApp · recap concluído · voltou ao estoque (${pneu.vida_recap || 1}ª vida)`,
      placa: null,
    });
  });
  return {
    fogo: pneu.numero_fogo,
    vida: pneu.vida_recap || 1,
    mensagem: `Fogo ${pneu.numero_fogo} voltou ao estoque (recapado)`,
  };
}

/**
 * Troca o pneu montado por outro do estoque na mesma posição (validação + transação única).
 */
export async function trocarPorEstoque({ filialId, pneuMontadoId, pneuEstoqueId }) {
  const db = getDb();
  const montado = await db.prepare(`
    SELECT * FROM pneus
    WHERE id = ? AND filial_id = ? AND ativo = 1 AND status_pneu = 'montado'
  `).get(pneuMontadoId, filialId);
  if (!montado) throw erroOps('Pneu montado não encontrado', 404);
  if (!montado.veiculo_id || !montado.posicao) {
    throw erroOps('Pneu montado sem veículo/posição', 400);
  }
  if (Number(pneuEstoqueId) === Number(pneuMontadoId)) {
    throw erroOps('O pneu substituto deve ser outro pneu do estoque', 400);
  }

  const { estoque } = await validarSubstitutoEstoque({
    filialId,
    pneuEstoqueId,
    veiculoId: montado.veiculo_id,
    posicao: montado.posicao,
  });

  const { retirado, montagem } = await db.transaction(async () => {
    const retiradoTx = await desmontarPneu({ filialId, pneuId: montado.id });
    falharTxSeTeste();
    const montagemTx = await montarPneu({
      filialId,
      pneuId: estoque.id,
      veiculoId: montado.veiculo_id,
      posicao: montado.posicao,
    });
    return { retirado: retiradoTx, montagem: montagemTx };
  });
  return {
    mensagem: `Trocou fogo ${retirado.fogo} → ${montagem.fogo} em ${montagem.label}`,
    retirado,
    montado: montagem,
  };
}

/**
 * Move o pneu para outro veículo/posição da frota.
 * Se a posição destino estiver ocupada, troca os dois pneus (swap).
 */
export async function moverOuTrocarNaFrota({
  filialId,
  pneuId,
  veiculoDestinoId,
  posicaoDestino,
  detalhes = null,
}) {
  const db = getDb();
  const posDest = String(posicaoDestino || '').trim().toUpperCase();
  if (!posDest) {
    throw Object.assign(new Error('Informe a posição de destino'), { status: 400 });
  }

  const origem = await db.prepare(`
    SELECT p.*, v.placa as placa_origem, v.km_atual as km_origem, v.hr_atual as hr_origem
    FROM pneus p
    JOIN veiculos v ON v.id = p.veiculo_id AND v.ativo = 1
    WHERE p.id = ? AND p.filial_id = ? AND p.ativo = 1 AND p.status_pneu = 'montado'
  `).get(pneuId, filialId);
  if (!origem) {
    throw Object.assign(new Error('Pneu montado não encontrado'), { status: 404 });
  }

  const veiculoDest = await db.prepare(`
    SELECT * FROM veiculos WHERE id = ? AND filial_id = ? AND ativo = 1
  `).get(veiculoDestinoId, filialId);
  if (!veiculoDest) {
    throw Object.assign(new Error('Veículo de destino não encontrado'), { status: 404 });
  }
  assertVeiculoOperacional(veiculoDest);

  const layoutDest = getLayout(veiculoDest.layout_pneus || LAYOUT_PADRAO);
  if (!layoutDest.posicoes.includes(posDest)) {
    throw Object.assign(new Error(`Posição ${posDest} inválida no veículo ${veiculoDest.placa}`), { status: 400 });
  }

  if (Number(origem.veiculo_id) === Number(veiculoDest.id) && origem.posicao === posDest) {
    throw Object.assign(new Error('Pneu já está nesta posição'), { status: 400 });
  }

  const valOrigem = validarMontagem({
    condicao: origem.condicao,
    tipo_pneu: origem.tipo_pneu,
    posicao: posDest,
  });
  if (!valOrigem.ok) {
    throw Object.assign(new Error(valOrigem.erros.join(' ')), { status: 400 });
  }

  const ocupante = await db.prepare(`
    SELECT p.*, v.placa as placa_ocupante
    FROM pneus p
    JOIN veiculos v ON v.id = p.veiculo_id
    WHERE p.veiculo_id = ? AND p.posicao = ? AND p.ativo = 1 AND p.status_pneu = 'montado' AND p.id != ?
  `).get(veiculoDest.id, posDest, origem.id);

  const data = hojeIso();
  const posOrigem = origem.posicao;
  const veiculoOrigemId = origem.veiculo_id;
  const placaOrigem = origem.placa_origem;

  if (ocupante) {
    const valOcupante = validarMontagem({
      condicao: ocupante.condicao,
      tipo_pneu: ocupante.tipo_pneu,
      posicao: posOrigem,
    });
    if (!valOcupante.ok) {
      throw Object.assign(
        new Error(`Não dá para trocar: pneu fogo ${ocupante.numero_fogo} não serve em ${labelPosicao(posOrigem)}. ${valOcupante.erros.join(' ')}`),
        { status: 400 }
      );
    }

    await db.transaction(async () => {
      // Libera destino temporariamente (evita unique parcial)
      await db.prepare(`
        UPDATE pneus SET posicao = NULL WHERE id = ?
      `).run(ocupante.id);

      await db.prepare(`
        UPDATE pneus SET veiculo_id = ?, posicao = ?, data_instalacao = COALESCE(data_instalacao, ?)
        WHERE id = ?
      `).run(veiculoDest.id, posDest, data, origem.id);

      await db.prepare(`
        UPDATE pneus SET veiculo_id = ?, posicao = ?, data_instalacao = COALESCE(data_instalacao, ?)
        WHERE id = ?
      `).run(veiculoOrigemId, posOrigem, data, ocupante.id);

      const detBase = detalhes?.trim()
        || `Troca na frota · ${placaOrigem} ${labelPosicao(posOrigem)} ↔ ${veiculoDest.placa} ${labelPosicao(posDest)}`;

      await registrarMovimentacao(db, {
        pneuId: origem.id,
        veiculoId: veiculoDest.id,
        tipo: 'mudanca_posicao',
        data,
        km: veiculoDest.km_atual,
        hr: veiculoDest.hr_atual,
        posicao: posDest,
        detalhes: `${detBase} · fogo ${origem.numero_fogo}`,
        placa: veiculoDest.placa,
      });
      await registrarMovimentacao(db, {
        pneuId: ocupante.id,
        veiculoId: veiculoOrigemId,
        tipo: 'mudanca_posicao',
        data,
        km: origem.km_origem,
        hr: origem.hr_origem,
        posicao: posOrigem,
        detalhes: `${detBase} · fogo ${ocupante.numero_fogo}`,
        placa: placaOrigem,
      });
    });

    return {
      modo: 'troca',
      mensagem: `Trocou fogo ${origem.numero_fogo} (${placaOrigem} ${labelPosicao(posOrigem)}) ↔ fogo ${ocupante.numero_fogo} (${veiculoDest.placa} ${labelPosicao(posDest)})`,
      origem: {
        id: origem.id,
        fogo: origem.numero_fogo,
        de: { veiculo_id: veiculoOrigemId, placa: placaOrigem, posicao: posOrigem },
        para: { veiculo_id: veiculoDest.id, placa: veiculoDest.placa, posicao: posDest },
      },
      destino: {
        id: ocupante.id,
        fogo: ocupante.numero_fogo,
        de: { veiculo_id: veiculoDest.id, placa: veiculoDest.placa, posicao: posDest },
        para: { veiculo_id: veiculoOrigemId, placa: placaOrigem, posicao: posOrigem },
      },
    };
  }

  // Posição livre: só move
  await db.transaction(async () => {
    await db.prepare(`
      UPDATE pneus SET veiculo_id = ?, posicao = ?, data_instalacao = COALESCE(data_instalacao, ?)
      WHERE id = ?
    `).run(veiculoDest.id, posDest, data, origem.id);

    await registrarMovimentacao(db, {
      pneuId: origem.id,
      veiculoId: veiculoDest.id,
      tipo: 'mudanca_posicao',
      data,
      km: veiculoDest.km_atual,
      hr: veiculoDest.hr_atual,
      posicao: posDest,
      detalhes: detalhes?.trim()
        || `Moveu na frota · ${placaOrigem} ${labelPosicao(posOrigem)} → ${veiculoDest.placa} ${labelPosicao(posDest)}`,
      placa: veiculoDest.placa,
    });
  });

  return {
    modo: 'mover',
    mensagem: `Moveu fogo ${origem.numero_fogo}: ${placaOrigem} ${labelPosicao(posOrigem)} → ${veiculoDest.placa} ${labelPosicao(posDest)}`,
    origem: {
      id: origem.id,
      fogo: origem.numero_fogo,
      de: { veiculo_id: veiculoOrigemId, placa: placaOrigem, posicao: posOrigem },
      para: { veiculo_id: veiculoDest.id, placa: veiculoDest.placa, posicao: posDest },
    },
  };
}

export async function registrarDescarte({ filialId, pneuId, motivo = null, pneuEstoqueId = null }) {
  const db = getDb();
  const pneu = await db.prepare(`
    SELECT p.*, v.placa, v.km_atual, v.hr_atual
    FROM pneus p
    LEFT JOIN veiculos v ON v.id = p.veiculo_id
    WHERE p.id = ? AND p.filial_id = ? AND p.ativo = 1
  `).get(pneuId, filialId);
  if (!pneu) throw erroOps('Pneu não encontrado', 404);
  if (pneu.status_pneu === 'descarte') {
    throw erroOps('Pneu já está no descarte', 400);
  }
  const data = hojeIso();
  const estavaMontado = pneu.status_pneu === 'montado' && pneu.veiculo_id;
  const veiculoId = pneu.veiculo_id || null;
  const posicao = pneu.posicao || null;
  let substituto = null;
  if (estavaMontado) {
    if (!pneuEstoqueId) {
      throw erroOps('Informe o pneu do estoque para ocupar a posição', 400);
    }
    if (Number(pneuEstoqueId) === Number(pneuId)) {
      throw erroOps('O pneu substituto deve ser outro pneu do estoque', 400);
    }
    substituto = await validarSubstitutoEstoque({
      filialId,
      pneuEstoqueId,
      veiculoId,
      posicao,
    });
  }
  let montagem = null;
  await db.transaction(async () => {
    if (estavaMontado) {
      await registrarMovimentacao(db, {
        pneuId,
        veiculoId: pneu.veiculo_id,
        tipo: 'retirada',
        data,
        km: pneu.km_atual,
        hr: pneu.hr_atual,
        posicao: pneu.posicao,
        detalhes: 'WhatsApp · retirou para descarte',
        placa: pneu.placa,
      });
    }
    await db.prepare(`
      UPDATE pneus SET
        veiculo_id = NULL, posicao = NULL, status_pneu = 'descarte', ativo = 0,
        tratamento_descarte = 'pendente',
        tratamento_descarte_obs = ?,
        tratamento_descarte_em = ?,
        data_instalacao = NULL
      WHERE id = ?
    `).run(motivo?.trim() || null, data, pneuId);
    await registrarMovimentacao(db, {
      pneuId,
      veiculoId: estavaMontado ? veiculoId : null,
      tipo: 'descarte',
      data,
      km: pneu.km_atual,
      hr: pneu.hr_atual,
      posicao: estavaMontado ? posicao : null,
      detalhes: motivo?.trim() || 'WhatsApp · enviou ao descarte',
      placa: pneu.placa || null,
    });
    if (estavaMontado && substituto) {
      falharTxSeTeste();
      montagem = await montarPneu({
        filialId,
        pneuId: substituto.estoque.id,
        veiculoId,
        posicao,
      });
    }
  });
  return {
    fogo: pneu.numero_fogo,
    estava_montado: Boolean(estavaMontado),
    veiculo_id: veiculoId,
    posicao,
    placa: pneu.placa || null,
    substituto: montagem,
  };
}

export { labelPosicao, TIPOS_PNEU, CONDICOES_PNEU };
