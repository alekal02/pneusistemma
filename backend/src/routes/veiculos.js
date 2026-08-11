import { Router } from 'express';
import { getDb, classificarSulco } from '../database.js';
import { TIPOS_VEICULO } from '../config.js';
import {
  POSICOES_PNEU,
  LAYOUTS_PNEU,
  LAYOUT_PADRAO,
  labelPosicao,
  sqlOrderPosicao,
  aplicarLayoutPneus,
} from '../pneus-layouts.js';

const router = Router();

router.get('/meta', (_req, res) => {
  res.json({
    posicoes: POSICOES_PNEU,
    tipos: TIPOS_VEICULO,
    layouts: Object.values(LAYOUTS_PNEU),
    layout_padrao: LAYOUT_PADRAO,
  });
});

router.get('/', (_req, res) => {
  const db = getDb();
  const veiculos = db.prepare(`
    SELECT v.*,
      (SELECT COUNT(*) FROM pneus p WHERE p.veiculo_id = v.id AND p.ativo = 1) as total_pneus,
      (SELECT MIN(
        CASE
          WHEN m.sulco_externo IS NULL AND m.sulco_central IS NULL AND m.sulco_interno IS NULL THEN NULL
          ELSE MIN(COALESCE(m.sulco_externo, 999), COALESCE(m.sulco_central, 999), COALESCE(m.sulco_interno, 999))
        END
      )
      FROM pneus p
      LEFT JOIN medicoes m ON m.pneu_id = p.id
        AND m.id = (SELECT id FROM medicoes WHERE pneu_id = p.id ORDER BY data_medicao DESC, id DESC LIMIT 1)
      WHERE p.veiculo_id = v.id AND p.ativo = 1
      ) as menor_sulco
    FROM veiculos v
    WHERE v.ativo = 1
    ORDER BY v.apelido, v.placa
  `).all();

  const resultado = veiculos.map((v) => ({
    ...v,
    status_sulco: classificarSulco(v.menor_sulco === 999 ? null : v.menor_sulco),
  }));

  res.json(resultado);
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const veiculo = db.prepare('SELECT * FROM veiculos WHERE id = ?').get(req.params.id);
  if (!veiculo) return res.status(404).json({ erro: 'Veículo não encontrado' });

  const orderSql = sqlOrderPosicao('p.posicao');
  const pneus = db.prepare(`
    SELECT p.*,
      (SELECT sulco_externo FROM medicoes WHERE pneu_id = p.id ORDER BY data_medicao DESC, id DESC LIMIT 1) as ult_sulco_ext,
      (SELECT sulco_central FROM medicoes WHERE pneu_id = p.id ORDER BY data_medicao DESC, id DESC LIMIT 1) as ult_sulco_cent,
      (SELECT sulco_interno FROM medicoes WHERE pneu_id = p.id ORDER BY data_medicao DESC, id DESC LIMIT 1) as ult_sulco_int,
      (SELECT data_medicao FROM medicoes WHERE pneu_id = p.id ORDER BY data_medicao DESC, id DESC LIMIT 1) as ult_medicao
    FROM pneus p
    WHERE p.veiculo_id = ? AND p.ativo = 1
    ORDER BY ${orderSql}
  `).all(req.params.id);

  const pneusComStatus = pneus.map((p) => {
    const valores = [p.ult_sulco_ext, p.ult_sulco_cent, p.ult_sulco_int].filter((v) => v != null);
    const menor = valores.length ? Math.min(...valores) : null;
    return {
      ...p,
      posicao_label: labelPosicao(p.posicao),
      menor_sulco: menor,
      status_sulco: classificarSulco(menor),
    };
  });

  res.json({ ...veiculo, pneus: pneusComStatus });
});

router.post('/', (req, res) => {
  const { placa, apelido, tipo, marca, modelo, ano, km_atual, observacoes, layout_pneus, posicoes_custom } = req.body;
  if (!placa?.trim()) return res.status(400).json({ erro: 'Placa é obrigatória' });

  const db = getDb();
  try {
    const layoutId = layout_pneus || LAYOUT_PADRAO;
    const result = db.prepare(`
      INSERT INTO veiculos (placa, apelido, tipo, marca, modelo, ano, km_atual, observacoes, layout_pneus)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      placa.trim().toUpperCase(),
      apelido?.trim() || null,
      tipo || 'Outro',
      marca?.trim() || null,
      modelo?.trim() || null,
      ano || null,
      km_atual || 0,
      observacoes?.trim() || null,
      layoutId
    );

    const posicoes = aplicarLayoutPneus(
      db,
      result.lastInsertRowid,
      layoutId,
      posicoes_custom?.length ? posicoes_custom : null
    );

    res.status(201).json({
      id: result.lastInsertRowid,
      total_pneus: posicoes.length,
      mensagem: `Veículo cadastrado com ${posicoes.length} pneus`,
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

  const veiculo = db.prepare('SELECT id FROM veiculos WHERE id = ? AND ativo = 1').get(req.params.id);
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
      total_pneus: posicoes.length,
      posicoes: posicoes.map((p) => ({ codigo: p, label: labelPosicao(p) })),
      mensagem: `Configuração atualizada — ${posicoes.length} pneus ativos`,
    });
  } catch (err) {
    res.status(400).json({ erro: err.message });
  }
});

router.put('/:id', (req, res) => {
  const { placa, apelido, tipo, marca, modelo, ano, km_atual, observacoes } = req.body;
  const db = getDb();

  const result = db.prepare(`
    UPDATE veiculos SET
      placa = COALESCE(?, placa),
      apelido = ?,
      tipo = COALESCE(?, tipo),
      marca = ?,
      modelo = ?,
      ano = ?,
      km_atual = COALESCE(?, km_atual),
      observacoes = ?,
      updated_at = datetime('now', 'localtime')
    WHERE id = ? AND ativo = 1
  `).run(
    placa?.trim().toUpperCase(),
    apelido?.trim() || null,
    tipo,
    marca?.trim() || null,
    modelo?.trim() || null,
    ano || null,
    km_atual,
    observacoes?.trim() || null,
    req.params.id
  );

  if (result.changes === 0) return res.status(404).json({ erro: 'Veículo não encontrado' });
  res.json({ mensagem: 'Veículo atualizado' });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const result = db.prepare(`
    UPDATE veiculos SET ativo = 0, updated_at = datetime('now', 'localtime') WHERE id = ?
  `).run(req.params.id);

  if (result.changes === 0) return res.status(404).json({ erro: 'Veículo não encontrado' });
  res.json({ mensagem: 'Veículo desativado' });
});

export default router;
