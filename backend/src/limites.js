import { getDb } from './database.js';
import { config } from './config.js';

const CHAVES = {
  CRITICO: 'sulco_critico_mm',
  ALERTA: 'sulco_alerta_mm',
  RECAP: 'sulco_recap_mm',
  NOVO: 'sulco_novo_mm',
  MAX_RECAPS: 'max_recaps',
  TOLERANCIA: 'diagnostico_tolerancia_mm',
};

const PADROES = {
  [CHAVES.CRITICO]: config.sulcoMinimo, // perda/troca: ≤ 3 mm
  [CHAVES.RECAP]: 5.0,                  // recap: > crítico e ≤ 5 mm
  [CHAVES.ALERTA]: config.sulcoAlerta,  // monitorar: > recap e ≤ 8 mm
  [CHAVES.NOVO]: 14.0,
  [CHAVES.MAX_RECAPS]: 6,
  [CHAVES.TOLERANCIA]: 1.0,
};

function lerValor(chave) {
  const db = getDb();
  const row = db.prepare('SELECT valor FROM configuracoes WHERE chave = ?').get(chave);
  if (!row) return PADROES[chave];
  const n = parseFloat(row.valor);
  return Number.isFinite(n) ? n : PADROES[chave];
}

function salvarValor(chave, valor) {
  const db = getDb();
  db.prepare(`
    INSERT INTO configuracoes (chave, valor, updated_at)
    VALUES (?, ?, datetime('now', 'localtime'))
    ON CONFLICT(chave) DO UPDATE SET
      valor = excluded.valor,
      updated_at = datetime('now', 'localtime')
  `).run(chave, String(valor));
}

export function getLimites() {
  return {
    sulco_critico_mm: lerValor(CHAVES.CRITICO),
    sulco_alerta_mm: lerValor(CHAVES.ALERTA),
    sulco_recap_mm: lerValor(CHAVES.RECAP),
    sulco_novo_mm: lerValor(CHAVES.NOVO),
    max_recaps: Math.round(lerValor(CHAVES.MAX_RECAPS)),
    diagnostico_tolerancia_mm: lerValor(CHAVES.TOLERANCIA),
  };
}

export function setLimites(body) {
  const atual = getLimites();
  const critico = body.sulco_critico_mm != null ? parseFloat(body.sulco_critico_mm) : atual.sulco_critico_mm;
  const alerta = body.sulco_alerta_mm != null ? parseFloat(body.sulco_alerta_mm) : atual.sulco_alerta_mm;
  const recap = body.sulco_recap_mm != null ? parseFloat(body.sulco_recap_mm) : atual.sulco_recap_mm;
  const novo = body.sulco_novo_mm != null ? parseFloat(body.sulco_novo_mm) : atual.sulco_novo_mm;
  const maxRecaps = body.max_recaps != null ? parseInt(body.max_recaps, 10) : atual.max_recaps;
  const tolerancia = body.diagnostico_tolerancia_mm != null
    ? parseFloat(body.diagnostico_tolerancia_mm)
    : atual.diagnostico_tolerancia_mm;

  if (!Number.isFinite(critico) || critico < 0) throw new Error('Limite de perda/troca inválido');
  if (!Number.isFinite(recap) || recap <= critico) {
    throw new Error('O limiar de recapagem deve ser maior que o de perda (<3 → troca)');
  }
  if (!Number.isFinite(alerta) || alerta <= recap) {
    throw new Error('O limiar de monitorar deve ser maior que o de recapagem');
  }
  if (!Number.isFinite(novo) || novo <= alerta) {
    throw new Error('O sulco de pneu novo deve ser maior que o limiar de OK/monitorar');
  }
  if (!Number.isFinite(maxRecaps) || maxRecaps < 0 || maxRecaps > 10) {
    throw new Error('Máximo de recaps inválido (0–10)');
  }
  if (!Number.isFinite(tolerancia) || tolerancia < 0) {
    throw new Error('Tolerância de diagnóstico inválida');
  }

  salvarValor(CHAVES.CRITICO, critico);
  salvarValor(CHAVES.ALERTA, alerta);
  salvarValor(CHAVES.RECAP, recap);
  salvarValor(CHAVES.NOVO, novo);
  salvarValor(CHAVES.MAX_RECAPS, maxRecaps);
  salvarValor(CHAVES.TOLERANCIA, tolerancia);

  return getLimites();
}

export function classificarSulco(mm) {
  if (mm === null || mm === undefined) return 'sem_dado';
  const { sulco_critico_mm, sulco_alerta_mm } = getLimites();
  if (mm < sulco_critico_mm) return 'critico';
  if (mm <= sulco_alerta_mm) return 'alerta';
  return 'ok';
}

/** Menor sulco considerando os 4 pontos de medição */
export function menorSulco(row) {
  const valores = [
    row.sulco_externo,
    row.sulco_central,
    row.sulco_interno,
    row.sulco_auxiliar,
  ].filter((v) => v != null);
  return valores.length ? Math.min(...valores) : null;
}

export { CHAVES, PADROES };
