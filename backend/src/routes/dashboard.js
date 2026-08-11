import { Router } from 'express';
import { getDb } from '../database.js';
import { classificarSulco, getLimites } from '../limites.js';

const router = Router();

router.get('/resumo', (_req, res) => {
  const db = getDb();
  const limites = getLimites();

  const pneus = db.prepare(`
    SELECT
      p.id,
      (SELECT sulco_externo FROM medicoes WHERE pneu_id = p.id ORDER BY data_medicao DESC, id DESC LIMIT 1) as sulco_externo,
      (SELECT sulco_central FROM medicoes WHERE pneu_id = p.id ORDER BY data_medicao DESC, id DESC LIMIT 1) as sulco_central,
      (SELECT sulco_interno FROM medicoes WHERE pneu_id = p.id ORDER BY data_medicao DESC, id DESC LIMIT 1) as sulco_interno
    FROM pneus p
    JOIN veiculos v ON v.id = p.veiculo_id AND v.ativo = 1
    WHERE p.ativo = 1
  `).all();

  let ok = 0, alerta = 0, critico = 0, semDado = 0;

  for (const p of pneus) {
    const valores = [p.sulco_externo, p.sulco_central, p.sulco_interno].filter((v) => v != null);
    const menor = valores.length ? Math.min(...valores) : null;
    const status = classificarSulco(menor);
    if (status === 'ok') ok++;
    else if (status === 'alerta') alerta++;
    else if (status === 'critico') critico++;
    else semDado++;
  }

  const veiculos = db.prepare('SELECT COUNT(*) as total FROM veiculos WHERE ativo = 1').get();

  res.json({
    veiculos_ativos: veiculos.total,
    pneus_total: pneus.length,
    pneus_ok: ok,
    pneus_alerta: alerta,
    pneus_critico: critico,
    pneus_sem_dado: semDado,
    limites,
  });
});

export default router;
