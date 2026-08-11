import { Router } from 'express';
import { getLimites, setLimites } from '../limites.js';
import { DIAGNOSTICOS, ACOES } from '../diagnostico.js';
import { requireAuth, requireAdmin } from '../auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', (_req, res) => {
  const limites = getLimites();
  res.json({
    ...limites,
    descricao: {
      perda: `Sulco < ${limites.sulco_critico_mm} mm — perda/troca`,
      recap: `De ${limites.sulco_critico_mm} a ${limites.sulco_recap_mm} mm — recapagem (máx. ${limites.max_recaps}ª)`,
      monitorar: `De ${limites.sulco_recap_mm} a ${limites.sulco_alerta_mm} mm — monitorar`,
      ok: `Acima de ${limites.sulco_alerta_mm} mm — OK`,
      novo: `Sulco típico de pneu novo: ~${limites.sulco_novo_mm} mm`,
    },
    diagnosticos: Object.values(DIAGNOSTICOS),
    acoes: Object.values(ACOES),
  });
});

router.put('/', requireAdmin, (req, res) => {
  try {
    const limites = setLimites(req.body);
    res.json({
      ...limites,
      mensagem: 'Limites atualizados com sucesso',
    });
  } catch (err) {
    res.status(400).json({ erro: err.message });
  }
});

export default router;
