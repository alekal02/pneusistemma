import { Router } from 'express';
import { getDb, classificarSulco } from '../database.js';
import { TIPOS_VEICULO } from '../config.js';
import { getLimites, menorSulco } from '../limites.js';
import { diagnosticarPerfil, sugerirAcao, percentualVida } from '../diagnostico.js';
import { requireAuth, requireFilial, filialScopeId } from '../auth.js';
import {
  POSICOES_PNEU,
  LAYOUTS_PNEU,
  LAYOUT_PADRAO,
  PAPEL_POSICAO,
  TIPOS_PNEU,
  CONDICOES_PNEU,
  labelPosicao,
  papelPosicao,
  sqlOrderPosicao,
  aplicarLayoutPneus,
  getLayout,
} from '../pneus-layouts.js';

const router = Router();

router.use(requireAuth);
router.use(requireFilial);

router.get('/meta', (_req, res) => {
  res.json({
    posicoes: POSICOES_PNEU,
    papeis: PAPEL_POSICAO,
    tipos: TIPOS_VEICULO,
    layouts: Object.values(LAYOUTS_PNEU),
    layout_padrao: LAYOUT_PADRAO,
    tipos_pneu: TIPOS_PNEU,
    condicoes_pneu: CONDICOES_PNEU,
  });
});

router.get('/', (req, res) => {
  const db = getDb();
  const filialId = filialScopeId(req);
  const veiculos = db.prepare(`
    SELECT v.*,
      (SELECT COUNT(*) FROM pneus p WHERE p.veiculo_id = v.id AND p.ativo = 1 AND p.status_pneu = 'montado') as total_pneus,
      (SELECT MIN(
        CASE
          WHEN m.sulco_externo IS NULL AND m.sulco_central IS NULL
               AND m.sulco_interno IS NULL AND m.sulco_auxiliar IS NULL THEN NULL
          ELSE MIN(
            COALESCE(m.sulco_externo, 999),
            COALESCE(m.sulco_central, 999),
            COALESCE(m.sulco_interno, 999),
            COALESCE(m.sulco_auxiliar, 999)
          )
        END
      )
      FROM pneus p
      LEFT JOIN medicoes m ON m.pneu_id = p.id
        AND m.id = (SELECT id FROM medicoes WHERE pneu_id = p.id ORDER BY data_medicao DESC, id DESC LIMIT 1)
      WHERE p.veiculo_id = v.id AND p.ativo = 1
      ) as menor_sulco
    FROM veiculos v
    WHERE v.ativo = 1 AND v.filial_id = ?
    ORDER BY v.apelido, v.placa
  `).all(filialId);

  const resultado = veiculos.map((v) => ({
    ...v,
    menor_sulco: v.menor_sulco === 999 ? null : v.menor_sulco,
    status_sulco: classificarSulco(v.menor_sulco === 999 ? null : v.menor_sulco),
  }));

  res.json(resultado);
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const filialId = filialScopeId(req);
  const limites = getLimites();
  const veiculo = db.prepare(`
    SELECT * FROM veiculos WHERE id = ? AND filial_id = ? AND ativo = 1
  `).get(req.params.id, filialId);
  if (!veiculo) return res.status(404).json({ erro: 'Veículo não encontrado' });

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
  `).all(req.params.id);

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

  res.json({
    ...veiculo,
    pneus: pneusComStatus,
    posicoes_layout: posicoesLayout,
    layout: {
      id: veiculo.layout_pneus || LAYOUT_PADRAO,
      nome: layout.nome,
      posicoes: layout.posicoes,
    },
  });
});

router.post('/', (req, res) => {
  const {
    placa, apelido, tipo, marca, modelo, ano,
    km_atual, hr_atual, observacoes, layout_pneus, posicoes_custom,
  } = req.body;
  if (!placa?.trim()) return res.status(400).json({ erro: 'Placa é obrigatória' });

  const db = getDb();
  const filialId = filialScopeId(req);
  try {
    const layoutId = layout_pneus || LAYOUT_PADRAO;
    const result = db.prepare(`
      INSERT INTO veiculos (placa, apelido, tipo, marca, modelo, ano, km_atual, hr_atual, observacoes, layout_pneus, filial_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      placa.trim().toUpperCase(),
      apelido?.trim() || null,
      tipo || 'Outro',
      marca?.trim() || null,
      modelo?.trim() || null,
      ano || null,
      km_atual || 0,
      hr_atual || 0,
      observacoes?.trim() || null,
      layoutId,
      filialId
    );

    const posicoes = aplicarLayoutPneus(
      db,
      result.lastInsertRowid,
      layoutId,
      posicoes_custom?.length ? posicoes_custom : null
    );

    res.status(201).json({
      id: result.lastInsertRowid,
      total_posicoes: posicoes.length,
      mensagem: `Veículo cadastrado com ${posicoes.length} posições — monte pneus do estoque`,
    });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ erro: 'Placa já cadastrada' });
    }
    throw err;
  }
});

router.put('/:id/layout', (req, res) => {
  const { layout_pneus, posicoes_custom } = req.body;
  const db = getDb();
  const filialId = filialScopeId(req);

  const veiculo = db.prepare(`
    SELECT id FROM veiculos WHERE id = ? AND ativo = 1 AND filial_id = ?
  `).get(req.params.id, filialId);
  if (!veiculo) return res.status(404).json({ erro: 'Veículo não encontrado' });

  if (!layout_pneus && (!posicoes_custom || !posicoes_custom.length)) {
    return res.status(400).json({ erro: 'Informe um layout ou lista de posições' });
  }

  try {
    const posicoes = aplicarLayoutPneus(
      db,
      req.params.id,
      layout_pneus || 'personalizado',
      posicoes_custom
    );

    res.json({
      layout_pneus: layout_pneus || 'personalizado',
      total_posicoes: posicoes.length,
      posicoes: posicoes.map((p) => ({
        codigo: p,
        label: labelPosicao(p),
        papel: papelPosicao(p),
      })),
      mensagem: `Configuração atualizada — ${posicoes.length} posições (monte pneus do estoque)`,
    });
  } catch (err) {
    res.status(400).json({ erro: err.message });
  }
});

router.put('/:id', (req, res) => {
  const { placa, apelido, tipo, marca, modelo, ano, km_atual, hr_atual, observacoes } = req.body;
  const db = getDb();
  const filialId = filialScopeId(req);

  const result = db.prepare(`
    UPDATE veiculos SET
      placa = COALESCE(?, placa),
      apelido = ?,
      tipo = COALESCE(?, tipo),
      marca = ?,
      modelo = ?,
      ano = ?,
      km_atual = COALESCE(?, km_atual),
      hr_atual = COALESCE(?, hr_atual),
      observacoes = ?,
      updated_at = datetime('now', 'localtime')
    WHERE id = ? AND ativo = 1 AND filial_id = ?
  `).run(
    placa?.trim().toUpperCase() || null,
    apelido?.trim() || null,
    tipo || null,
    marca?.trim() || null,
    modelo?.trim() || null,
    ano || null,
    km_atual != null ? km_atual : null,
    hr_atual != null ? hr_atual : null,
    observacoes?.trim() || null,
    req.params.id,
    filialId
  );

  if (result.changes === 0) return res.status(404).json({ erro: 'Veículo não encontrado' });
  res.json({ mensagem: 'Veículo atualizado' });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const filialId = filialScopeId(req);
  const result = db.prepare(`
    UPDATE veiculos SET ativo = 0, updated_at = datetime('now', 'localtime')
    WHERE id = ? AND filial_id = ?
  `).run(req.params.id, filialId);

  if (result.changes === 0) return res.status(404).json({ erro: 'Veículo não encontrado' });
  res.json({ mensagem: 'Veículo desativado' });
});

export default router;
