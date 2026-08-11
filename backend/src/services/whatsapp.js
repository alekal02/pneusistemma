/**
 * Cliente WuzAPI — envio de mensagens WhatsApp
 * Spec: POST /chat/send/text com header `token` e body { Phone, Body, LinkPreview? }
 */
import { config } from '../config.js';
import { getDb } from '../database.js';

export function limparTelefone(phone) {
  if (!phone) return '';
  return String(phone).replace(/@.*$/, '').replace(/\D/g, '');
}

export function wuzapiConfigurado() {
  return Boolean(config.wuzapiBaseUrl && config.wuzapiToken);
}

/**
 * Envia texto via WuzAPI POST /chat/send/text
 * @param {string} phone - DDI+DDD+número (sem +)
 * @param {string} text
 * @param {{ linkPreview?: boolean }} [opts]
 */
export async function enviarMensagemWhatsApp(phone, text, opts = {}) {
  const cleanPhone = limparTelefone(phone);
  if (!cleanPhone) throw new Error('Telefone WhatsApp inválido');
  if (!text?.trim()) throw new Error('Mensagem vazia');

  if (!wuzapiConfigurado()) {
    console.warn('[whatsapp] WuzAPI não configurado — mensagem não enviada:', cleanPhone);
    return {
      skipped: true,
      reason: 'wuzapi_nao_configurado',
      Phone: cleanPhone,
      Body: text,
    };
  }

  const payload = {
    Phone: cleanPhone,
    Body: text,
  };
  if (opts.linkPreview) payload.LinkPreview = true;

  const res = await fetch(`${config.wuzapiBaseUrl}/chat/send/text`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      token: config.wuzapiToken,
    },
    body: JSON.stringify(payload),
  });

  const raw = await res.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }

  if (!res.ok) {
    throw new Error(`WuzAPI erro ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }

  return data;
}

export async function enviarMensagemWhatsAppComLink(phone, text) {
  return enviarMensagemWhatsApp(phone, text, { linkPreview: true });
}

/**
 * Persiste log de notificação WhatsApp
 */
export function registrarNotificacao({
  tipo,
  destinatario,
  mensagem,
  veiculoId = null,
  medicaoId = null,
  status = 'enviado',
  respostaApi = null,
}) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO notificacoes_whatsapp (
      tipo, destinatario_whatsapp, veiculo_id, medicao_id,
      mensagem, status, resposta_api
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    tipo,
    limparTelefone(destinatario),
    veiculoId,
    medicaoId,
    mensagem,
    status,
    respostaApi != null ? JSON.stringify(respostaApi) : null
  );
}

/**
 * Envia e registra; em falha grava status=erro
 */
export async function enviarERegistrar({
  tipo,
  destinatario,
  mensagem,
  veiculoId = null,
  medicaoId = null,
  linkPreview = false,
}) {
  const phone = limparTelefone(destinatario);
  if (!phone) {
    registrarNotificacao({
      tipo,
      destinatario: destinatario || '',
      mensagem,
      veiculoId,
      medicaoId,
      status: 'erro',
      respostaApi: { erro: 'WhatsApp não cadastrado' },
    });
    return { ok: false, erro: 'sem_whatsapp' };
  }

  try {
    const resp = await enviarMensagemWhatsApp(phone, mensagem, { linkPreview });
    const status = resp?.skipped ? 'erro' : 'enviado';
    registrarNotificacao({
      tipo,
      destinatario: phone,
      mensagem,
      veiculoId,
      medicaoId,
      status,
      respostaApi: resp,
    });
    return { ok: status === 'enviado', resp };
  } catch (err) {
    console.error(`[whatsapp] Falha ao enviar para ${phone}:`, err.message);
    registrarNotificacao({
      tipo,
      destinatario: phone,
      mensagem,
      veiculoId,
      medicaoId,
      status: 'erro',
      respostaApi: { erro: err.message },
    });
    return { ok: false, erro: err.message };
  }
}
