import { Router } from 'express';
import { getDb, classificarSulco } from '../database.js';
import { getLimites } from '../limites.js';

const router = Router();

router.get('/alertas', (_req, res) => {
  const db = getDb();
  const alertas = db.prepare(`
    SELECT
      m.*,
      p.posicao, p.marca as pneu_marca, p.modelo as pneu_modelo,
      v.placa, v.apelido, v.tipo,
      MIN(COALESCE(m.sulco_externo, 999), COALESCE(m.sulco_central, 999), COALESCE(m.sulco_interno, 999)) as menor_sulco
    FROM medicoes m
    JOIN pneus p ON p.id = m.pneu_id AND p.ativo = 1
    JOIN veiculos v ON v.id = p.veiculo_id AND v.ativo = 1
    WHERE m.id = (
      SELECT id FROM medicoes WHERE pneu_id = p.id
      ORDER BY data_medicao DESC, id DESC LIMIT 1
    )
    AND MIN(COALESCE(m.sulco_externo, 999), COALESCE(m.sulco_central, 999), COALESCE(m.sulco_interno, 999)) <= ?
    ORDER BY menor_sulco ASC
  `).all(getLimites().sulco_alerta_mm);

  const resultado = alertas.map((a) => ({
    ...a,
    menor_sulco: a.menor_sulco === 999 ? null : a.menor_sulco,
    status_sulco: classificarSulco(a.menor_sulco === 999 ? null : a.menor_sulco),
  }));

  res.json(resultado);
});

router.post('/', (req, res) => {
  const {
    pneu_id,
    data_medicao,
    km_veiculo,
    sulco_externo,
    sulco_central,
    sulco_interno,
    sulco_auxiliar,
    pressao_psi,
    responsavel,
    observacoes,
    marcacao_json,
  } = req.body;

  if (!pneu_id) return res.status(400).json({ erro: 'pneu_id é obrigatório' });

  const db = getDb();
  const pneu = db.prepare('SELECT id FROM pneus WHERE id = ? AND ativo = 1').get(pneu_id);
  if (!pneu) return res.status(404).json({ erro: 'Pneu não encontrado' });

  const result = db.prepare(`
    INSERT INTO medicoes (
      pneu_id, data_medicao, km_veiculo,
      sulco_externo, sulco_central, sulco_interno, sulco_auxiliar,
      pressao_psi, responsavel, observacoes, marcacao_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    pneu_id,
    data_medicao || new Date().toISOString().split('T')[0],
    km_veiculo || null,
    sulco_externo ?? null,
    sulco_central ?? null,
    sulco_interno ?? null,
    sulco_auxiliar ?? null,
    pressao_psi ?? null,
    responsavel?.trim() || null,
    observacoes?.trim() || null,
    marcacao_json ? JSON.stringify(marcacao_json) : null
  );

  if (km_veiculo) {
    db.prepare(`
      UPDATE veiculos SET km_atual = MAX(km_atual, ?), updated_at = datetime('now', 'localtime')
      WHERE id = (SELECT veiculo_id FROM pneus WHERE id = ?)
    `).run(km_veiculo, pneu_id);
  }

  const valores = [sulco_externo, sulco_central, sulco_interno].filter((v) => v != null);
  const menor = valores.length ? Math.min(...valores) : null;

  res.status(201).json({
    id: result.lastInsertRowid,
    menor_sulco: menor,
    status_sulco: classificarSulco(menor),
    mensagem: 'Medição registrada',
  });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM medicoes WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ erro: 'Medição não encontrada' });
  res.json({ mensagem: 'Medição removida' });
});

export default router;
