/**
 * Notificações de alerta para gerentes após medição crítica/alerta
 */
import { config } from '../config.js';
import { getDb } from '../database.js';
import { enviarERegistrar } from './whatsapp.js';

/**
 * R10: gerente_compras (todas filiais) + gerente_filial (só a filial)
 * Fallback env GERENTE_COMPRAS_WHATSAPP se não houver compras no banco
 */
export function listarGerentesParaAlerta(filialId) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM usuarios
    WHERE ativo = 1
      AND whatsapp IS NOT NULL AND TRIM(whatsapp) != ''
      AND (
        cargo = 'gerente_compras'
        OR (cargo = 'gerente_filial' AND filial_id = ?)
      )
  `).all(filialId);

  const phones = new Set(rows.map((r) => String(r.whatsapp).replace(/\D/g, '')).filter(Boolean));

  if (config.gerenteComprasWhatsapp && !phones.has(config.gerenteComprasWhatsapp)) {
    rows.push({
      id: null,
      login: 'env_gerente_compras',
      cargo: 'gerente_compras',
      whatsapp: config.gerenteComprasWhatsapp,
      filial_id: null,
    });
  }

  return rows;
}

export function jaNotificouMedicao(medicaoId) {
  if (!medicaoId) return false;
  const db = getDb();
  const row = db.prepare(`
    SELECT id FROM notificacoes_whatsapp
    WHERE medicao_id = ?
      AND tipo IN ('alerta_critico', 'alerta_desgaste')
    LIMIT 1
  `).get(medicaoId);
  return Boolean(row);
}

/**
 * Dispara WhatsApp aos gerentes se status for alerta/crítico (R4, R5, R9, R10)
 */
export async function notificarGerentesAposMedicao({
  statusSulco,
  diagnosticoLabel,
  acaoLabel,
  menorSulco,
  veiculo,
  pneu,
  medicaoId,
}) {
  if (!['alerta', 'critico'].includes(statusSulco)) return { enviados: 0 };

  if (jaNotificouMedicao(medicaoId)) {
    return { enviados: 0, motivo: 'ja_notificado' };
  }

  const filialId = veiculo.filial_id;
  const gerentes = listarGerentesParaAlerta(filialId);
  const tipo = statusSulco === 'critico' ? 'alerta_critico' : 'alerta_desgaste';

  let mensagem = `🚨 *ALERTA DE PNEU* 🚨\n\n`;
  mensagem += `🚛 Veículo: *${veiculo.placa}*\n`;
  mensagem += `📍 Posição: ${pneu.posicao || '-'}${pneu.numero_fogo ? ` — Fogo: ${pneu.numero_fogo}` : ''}\n`;
  mensagem += `⚠️ Status: *${String(statusSulco).toUpperCase()}*\n`;
  mensagem += `📏 Sulco mínimo: ${menorSulco ?? '-'}mm\n`;
  mensagem += `🔧 Diagnóstico: ${diagnosticoLabel || '-'}\n`;
  mensagem += `💡 Ação sugerida: ${acaoLabel || '-'}\n\n`;
  mensagem += `Acesse o sistema para mais detalhes.`;

  let enviados = 0;
  for (const gerente of gerentes) {
    if (!gerente.whatsapp) {
      console.warn(`[alerta] Gerente ${gerente.login || gerente.id} sem WhatsApp — ignorado`);
      continue;
    }
    const result = await enviarERegistrar({
      tipo,
      destinatario: gerente.whatsapp,
      mensagem,
      veiculoId: veiculo.id,
      medicaoId,
    });
    if (result.ok) enviados += 1;
  }

  return { enviados };
}
