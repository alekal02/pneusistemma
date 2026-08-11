import { Router } from 'express';
import { getDb, classificarSulco } from '../database.js';

const router = Router();

router.get('/:id', (req, res) => {
  const db = getDb();
  const pneu = db.prepare(`
    SELECT p.*, v.placa, v.apelido, v.km_atual
    FROM pneus p
    JOIN veiculos v ON v.id = p.veiculo_id
    WHERE p.id = ?
  `).get(req.params.id);

  if (!pneu) return res.status(404).json({ erro: 'Pneu não encontrado' });

  const medicoes = db.prepare(`
    SELECT * FROM medicoes
    WHERE pneu_id = ?
    ORDER BY data_medicao DESC, id DESC
    LIMIT 50
  `).all(req.params.id);

  const medicoesComStatus = medicoes.map((m) => {
    const valores = [m.sulco_externo, m.sulco_central, m.sulco_interno].filter((v) => v != null);
    const menor = valores.length ? Math.min(...valores) : null;
    return { ...m, menor_sulco: menor, status_sulco: classificarSulco(menor) };
  });

  res.json({ ...pneu, medicoes: medicoesComStatus });
});

router.put('/:id', (req, res) => {
  const { marca, modelo, medida, dot, data_instalacao, km_instalacao, observacoes } = req.body;
  const db = getDb();

  const result = db.prepare(`
    UPDATE pneus SET
      marca = ?,
      modelo = ?,
      medida = ?,
      dot = ?,
      data_instalacao = ?,
      km_instalacao = COALESCE(?, km_instalacao),
      observacoes = ?
    WHERE id = ? AND ativo = 1
  `).run(
    marca?.trim() || null,
    modelo?.trim() || null,
    medida?.trim() || null,
    dot?.trim() || null,
    data_instalacao || null,
    km_instalacao,
    observacoes?.trim() || null,
    req.params.id
  );

  if (result.changes === 0) return res.status(404).json({ erro: 'Pneu não encontrado' });
  res.json({ mensagem: 'Pneu atualizado' });
});

export default router;
