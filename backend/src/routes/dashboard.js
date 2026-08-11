import { Router } from 'express';
import { getDb } from '../database.js';
import { classificarSulco, getLimites, menorSulco } from '../limites.js';
import { diagnosticarPerfil, sugerirAcao } from '../diagnostico.js';
import { requireAuth, requireFilial, filialScopeId } from '../auth.js';

const router = Router();

router.use(requireAuth);
router.use(requireFilial);

router.get('/resumo', (req, res) => {
  const db = getDb();
  const limites = getLimites();
  const filialId = filialScopeId(req);

  const pneus = db.prepare(`
    SELECT
      p.id, p.vida_recap, p.condicao, p.numero_fogo, p.posicao,
      v.placa, v.apelido,
      (SELECT sulco_externo FROM medicoes WHERE pneu_id = p.id ORDER BY data_medicao DESC, id DESC LIMIT 1) as sulco_externo,
      (SELECT sulco_central FROM medicoes WHERE pneu_id = p.id ORDER BY data_medicao DESC, id DESC LIMIT 1) as sulco_central,
      (SELECT sulco_interno FROM medicoes WHERE pneu_id = p.id ORDER BY data_medicao DESC, id DESC LIMIT 1) as sulco_interno,
      (SELECT sulco_auxiliar FROM medicoes WHERE pneu_id = p.id ORDER BY data_medicao DESC, id DESC LIMIT 1) as sulco_auxiliar
    FROM pneus p
    JOIN veiculos v ON v.id = p.veiculo_id AND v.ativo = 1 AND v.filial_id = ?
    WHERE p.ativo = 1 AND p.status_pneu = 'montado'
  `).all(filialId);

  let ok = 0, alerta = 0, critico = 0, semDado = 0;
  let troca = 0, recap = 0, monitorar = 0;
  const diagnosticos = {};

  for (const p of pneus) {
    const menor = menorSulco(p);
    const status = classificarSulco(menor);
    if (status === 'ok') ok++;
    else if (status === 'alerta') alerta++;
    else if (status === 'critico') critico++;
    else semDado++;

    const acao = sugerirAcao(menor, limites, p.vida_recap || 0);
    if (acao.codigo === 'troca') troca++;
    else if (acao.codigo === 'recap') recap++;
    else if (acao.codigo === 'monitorar') monitorar++;

    const diag = diagnosticarPerfil(p, limites.diagnostico_tolerancia_mm);
    if (diag.codigo !== 'sem_dado' && diag.codigo !== 'ok') {
      diagnosticos[diag.codigo] = (diagnosticos[diag.codigo] || 0) + 1;
    }
  }

  const veiculos = db.prepare(`
    SELECT COUNT(*) as total FROM veiculos WHERE ativo = 1 AND filial_id = ?
  `).get(filialId);

  res.json({
    veiculos_ativos: veiculos.total,
    pneus_total: pneus.length,
    pneus_ok: ok,
    pneus_alerta: alerta,
    pneus_critico: critico,
    pneus_sem_dado: semDado,
    acoes: { troca, recap, monitorar },
    diagnosticos,
    limites,
    filial_id: filialId,
  });
});

export default router;
