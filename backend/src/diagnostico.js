/**
 * Diagnóstico automático do perfil de desgaste (4 pontos Esq → Dir)
 * e sugestão de ação (OK / RECAP / TROCA).
 */

export const DIAGNOSTICOS = {
  ok: {
    codigo: 'ok',
    label: 'OK',
    descricao: 'Desgaste uniforme — sem indício de problema',
  },
  alinhamento: {
    codigo: 'alinhamento',
    label: 'Alinhamento + Balanceamento',
    descricao: 'Desgaste em cunha (um lado mais gasto) — verificar alinhamento e balanceamento',
  },
  falta_calib: {
    codigo: 'falta_calib',
    label: 'Falta de calibragem',
    descricao: 'Centro mais gasto que as bordas — possível subcalibragem',
  },
  excesso_calib: {
    codigo: 'excesso_calib',
    label: 'Excesso de calibragem',
    descricao: 'Bordas mais gastas que o centro — possível sobrecalibragem',
  },
  irregular: {
    codigo: 'irregular',
    label: 'Desgaste irregular',
    descricao: 'Perfil inconsistente — inspeção visual recomendada',
  },
  sem_dado: {
    codigo: 'sem_dado',
    label: 'Sem dados',
    descricao: 'Pontos insuficientes para diagnóstico',
  },
};

export const ACOES = {
  ok: { codigo: 'ok', label: 'OK', prioridade: 0 },
  monitorar: { codigo: 'monitorar', label: 'Monitorar', prioridade: 1 },
  recap: { codigo: 'recap', label: 'Recapagem', prioridade: 2 },
  troca: { codigo: 'troca', label: 'Troca', prioridade: 3 },
};

/**
 * @param {{ sulco_externo?: number|null, sulco_central?: number|null, sulco_interno?: number|null, sulco_auxiliar?: number|null }} row
 * @returns {(number|null)[]}
 */
export function pontosSulco(row) {
  return [
    row.sulco_externo ?? null,
    row.sulco_central ?? null,
    row.sulco_interno ?? null,
    row.sulco_auxiliar ?? null,
  ];
}

export function valoresValidos(row) {
  return pontosSulco(row).filter((v) => v != null && Number.isFinite(v));
}

export function menorSulco4(row) {
  const vals = valoresValidos(row);
  return vals.length ? Math.min(...vals) : null;
}

/**
 * Classifica o padrão de desgaste com base nos pontos disponíveis.
 * Com 3 pontos: [ext, cent, int]. Com 4: [ext, cent, int, aux].
 */
export function diagnosticarPerfil(row, toleranciaMm = 1.0) {
  const pontos = valoresValidos(row);
  if (pontos.length < 3) return DIAGNOSTICOS.sem_dado;

  const max = Math.max(...pontos);
  const min = Math.min(...pontos);
  const delta = max - min;

  if (delta <= toleranciaMm) return DIAGNOSTICOS.ok;

  // Usa ordem Esq→Dir quando há 3+ pontos na sequência
  const seq = pontosSulco(row).filter((v) => v != null && Number.isFinite(v));
  const primeiro = seq[0];
  const ultimo = seq[seq.length - 1];
  const meio = seq.slice(1, -1);
  const mediaMeio = meio.length ? meio.reduce((a, b) => a + b, 0) / meio.length : null;

  // Cunha: diferença clara entre extremos
  if (Math.abs(primeiro - ultimo) >= toleranciaMm) {
    return DIAGNOSTICOS.alinhamento;
  }

  if (mediaMeio != null) {
    const mediaBordas = (primeiro + ultimo) / 2;
    // Centro mais gasto → falta calibragem
    if (mediaBordas - mediaMeio >= toleranciaMm) {
      return DIAGNOSTICOS.falta_calib;
    }
    // Bordas mais gastas → excesso calibragem
    if (mediaMeio - mediaBordas >= toleranciaMm) {
      return DIAGNOSTICOS.excesso_calib;
    }
  }

  return DIAGNOSTICOS.irregular;
}

/**
 * Sugere ação operacional com base no menor sulco e vida de recap.
 */
export function sugerirAcao(menorMm, limites, vidaRecap = 0) {
  if (menorMm == null) return { ...ACOES.ok, motivo: 'Sem medição' };

  const critico = limites.sulco_critico_mm;
  const alerta = limites.sulco_alerta_mm;
  const recap = limites.sulco_recap_mm ?? 5;
  const maxRecap = limites.max_recaps ?? 6;

  if (menorMm <= critico) {
    return { ...ACOES.troca, motivo: `Sulco crítico (${menorMm} mm ≤ ${critico} mm)` };
  }

  if (menorMm <= alerta) {
    return { ...ACOES.monitorar, motivo: `Sulco em alerta (${menorMm} mm ≤ ${alerta} mm)` };
  }

  if (menorMm <= recap && vidaRecap < maxRecap) {
    return { ...ACOES.recap, motivo: `Indicado para recapagem (${menorMm} mm ≤ ${recap} mm, vida ${vidaRecap}ª)` };
  }

  if (menorMm <= recap && vidaRecap >= maxRecap) {
    return { ...ACOES.troca, motivo: `Limite de recaps atingido (${vidaRecap}/${maxRecap})` };
  }

  return { ...ACOES.ok, motivo: 'Dentro dos parâmetros' };
}

/**
 * Taxa de desgaste mm/km entre duas medições.
 */
export function desgastePorKm(sulcoAnterior, sulcoAtual, kmAnterior, kmAtual) {
  if (sulcoAnterior == null || sulcoAtual == null) return null;
  if (kmAnterior == null || kmAtual == null) return null;
  const deltaKm = kmAtual - kmAnterior;
  if (deltaKm <= 0) return null;
  const deltaSulco = sulcoAnterior - sulcoAtual;
  if (deltaSulco < 0) return null;
  return Math.round((deltaSulco / deltaKm) * 100000) / 100000;
}

/**
 * Percentual de vida útil restante com base no sulco inicial e crítico.
 */
export function percentualVida(sulcoAtual, sulcoInicial, sulcoCritico) {
  if (sulcoAtual == null || sulcoInicial == null) return null;
  const util = sulcoInicial - sulcoCritico;
  if (util <= 0) return null;
  const restante = sulcoAtual - sulcoCritico;
  return Math.max(0, Math.min(100, Math.round((restante / util) * 100)));
}
