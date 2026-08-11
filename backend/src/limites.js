import { getDb } from './database.js';
import { config } from './config.js';

const CHAVES = {
  CRITICO: 'sulco_critico_mm',
  ALERTA: 'sulco_alerta_mm',
};

const PADROES = {
  [CHAVES.CRITICO]: config.sulcoMinimo,
  [CHAVES.ALERTA]: config.sulcoAlerta,
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
  };
}

export function setLimites({ sulco_critico_mm, sulco_alerta_mm }) {
  const critico = parseFloat(sulco_critico_mm);
  const alerta = parseFloat(sulco_alerta_mm);

  if (!Number.isFinite(critico) || critico < 0) {
    throw new Error('Limite crítico inválido');
  }
  if (!Number.isFinite(alerta) || alerta < 0) {
    throw new Error('Limite de alerta inválido');
  }
  if (alerta <= critico) {
    throw new Error('O limite de alerta deve ser maior que o limite crítico');
  }

  salvarValor(CHAVES.CRITICO, critico);
  salvarValor(CHAVES.ALERTA, alerta);

  return getLimites();
}

export function classificarSulco(mm) {
  if (mm === null || mm === undefined) return 'sem_dado';
  const { sulco_critico_mm, sulco_alerta_mm } = getLimites();
  if (mm <= sulco_critico_mm) return 'critico';
  if (mm <= sulco_alerta_mm) return 'alerta';
  return 'ok';
}

export function menorSulco(row) {
  const valores = [row.sulco_externo, row.sulco_central, row.sulco_interno]
    .filter((v) => v != null);
  return valores.length ? Math.min(...valores) : null;
}
