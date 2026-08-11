import { Router } from 'express';
import { getLimites, setLimites } from '../limites.js';

const router = Router();

router.get('/', (_req, res) => {
  const limites = getLimites();
  res.json({
    ...limites,
    descricao: {
      ok: `Acima de ${limites.sulco_alerta_mm} mm`,
      alerta: `Entre ${limites.sulco_critico_mm} e ${limites.sulco_alerta_mm} mm`,
      critico: `Abaixo de ${limites.sulco_critico_mm} mm`,
    },
  });
});

router.put('/', (req, res) => {
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
