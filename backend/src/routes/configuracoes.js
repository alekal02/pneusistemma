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
      ok: `Acima de ${limites.sulco_alerta_mm} mm`,
      alerta: `Entre ${limites.sulco_critico_mm} e ${limites.sulco_alerta_mm} mm`,
      critico: `Abaixo ou igual a ${limites.sulco_critico_mm} mm — troca`,
      recap: `Até ${limites.sulco_recap_mm} mm — avaliar recapagem (máx. ${limites.max_recaps}ª)`,
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
