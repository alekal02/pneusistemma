/**
 * Webhook WuzAPI — recebe mensagem com placa e responde com link de acesso rápido
 */
import { Router } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { getDb } from '../database.js';
import { config } from '../config.js';
import { enviarERegistrar, limparTelefone } from '../services/whatsapp.js';
import {
  gerarTokenAcessoRapido,
  resumoStatusPneusVeiculo,
} from '../services/acesso-rapido.js';

const router = Router();

/** Rate limit simples: max 10 req/min por telefone */
const rateBuckets = new Map();

function rateLimitOk(phone) {
  const key = limparTelefone(phone) || 'unknown';
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.start > 60_000) {
    bucket = { start: now, count: 0 };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count <= 10;
}

function validarHmacWebhook(req) {
  const secret = config.wuzapiWebhookSecret;
  if (!secret) return true;

  const signature = req.headers['x-hmac-signature'] || req.headers['x-hub-signature'];
  if (!signature) {
    console.warn('[webhook] HMAC configurado mas assinatura ausente');
    return false;
  }

  const raw = typeof req.rawBody === 'string'
    ? req.rawBody
    : JSON.stringify(req.body || {});
  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  const received = String(signature).replace(/^sha256=/i, '');

  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(received, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return expected === received;
  }
}

export function extrairTelefone(event) {
  const candidates = [
    event?.data?.from,
    event?.data?.Info?.Sender,
    event?.data?.Info?.Chat,
    event?.from,
    event?.sender,
    event?.Phone,
  ];
  for (const c of candidates) {
    if (!c) continue;
    const phone = limparTelefone(c);
    if (phone) return phone;
  }
  return null;
}

export function extrairTextoMensagem(event) {
  const msg = event?.data?.message
    || event?.data?.Message
    || event?.message
    || event?.data;

  if (!msg || typeof msg !== 'object') {
    if (typeof event?.body === 'string') return event.body.trim();
    if (typeof event?.text === 'string') return event.text.trim();
    return null;
  }

  const text =
    msg.conversation
    || msg.extendedTextMessage?.text
    || msg.ExtendedTextMessage?.Text
    || msg.text
    || msg.Text
    || msg.caption
    || null;

  return text ? String(text).trim() : null;
}

function ehMensagemDeGrupo(event) {
  const from = event?.data?.from || event?.from || '';
  return String(from).includes('@g.us');
}

router.post('/whatsapp', async (req, res) => {
  try {
    if (!validarHmacWebhook(req)) {
      return res.status(401).json({ erro: 'Assinatura HMAC inválida' });
    }

    const event = req.body || {};
    const eventName = event.event || event.type || event.Event || '';

    // Ack eventos que não são mensagem de texto
    if (eventName && !/message/i.test(String(eventName)) && !event?.data?.message && !event?.message) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    if (ehMensagemDeGrupo(event)) {
      return res.status(200).json({ ok: true, ignored: 'group' });
    }

    const phone = extrairTelefone(event);
    const body = extrairTextoMensagem(event);

    if (!phone || !body) {
      return res.status(200).json({ ok: true });
    }

    if (!rateLimitOk(phone)) {
      console.warn(`[webhook] Rate limit: ${phone}`);
      return res.status(200).json({ ok: true, rate_limited: true });
    }

    const placaLimpa = body.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!placaLimpa || placaLimpa.length < 3) {
      return res.status(200).json({ ok: true, ignored: 'texto_curto' });
    }

    const db = getDb();
    const veiculos = db.prepare(`
      SELECT v.*, f.nome as filial_nome
      FROM veiculos v
      JOIN filiais f ON f.id = v.filial_id
      WHERE v.ativo = 1
        AND REPLACE(REPLACE(UPPER(v.placa), '-', ''), ' ', '') LIKE ?
      ORDER BY v.placa
      LIMIT 20
    `).all(`%${placaLimpa}%`);

    if (veiculos.length === 0) {
      const mensagem = `❌ Placa *${body.trim()}* não encontrada no sistema.\n\nEnvie a placa correta do caminhão.`;
      await enviarERegistrar({
        tipo: 'link_veiculo',
        destinatario: phone,
        mensagem,
      });
      return res.status(200).json({ ok: true, encontrados: 0 });
    }

    if (veiculos.length > 1) {
      const lista = veiculos.map((v) => `• ${v.placa} (${v.tipo}) - ${v.filial_nome}`).join('\n');
      const mensagem = `🔍 Encontrei ${veiculos.length} veículos:\n${lista}\n\nEnvie a placa exata para abrir o histórico.`;
      await enviarERegistrar({
        tipo: 'link_veiculo',
        destinatario: phone,
        mensagem,
      });
      return res.status(200).json({ ok: true, encontrados: veiculos.length });
    }

    const veiculo = veiculos[0];
    const { link } = gerarTokenAcessoRapido({
      veiculoId: veiculo.id,
      filialId: veiculo.filial_id,
      whatsappOrigem: phone,
    });

    const { criticos, alertas, ultimaMedicao } = resumoStatusPneusVeiculo(veiculo.id);

    let mensagem = `🚛 *${veiculo.placa}* — ${veiculo.tipo}\n`;
    mensagem += `📍 Filial: ${veiculo.filial_nome}\n\n`;

    if (ultimaMedicao) {
      mensagem += `📊 Última medição: ${ultimaMedicao.data_medicao}\n`;
      mensagem += `Posição ${ultimaMedicao.posicao}${ultimaMedicao.numero_fogo ? ` — Fogo ${ultimaMedicao.numero_fogo}` : ''}\n`;
      mensagem += `Sulco: ${ultimaMedicao.menor_sulco ?? '-'}mm\n\n`;
    }

    if (criticos > 0) {
      mensagem += `🚨 *${criticos} pneu(s) em estado CRÍTICO*\n`;
    }
    if (alertas > 0) {
      mensagem += `⚠️ *${alertas} pneu(s) em ALERTA*\n`;
    }
    if (criticos === 0 && alertas === 0) {
      mensagem += `✅ Todos os pneus estão OK\n`;
    }

    mensagem += `\n👉 *Clique para medir:*\n${link}\n\n`;
    mensagem += `_Link válido por 24 horas._`;

    await enviarERegistrar({
      tipo: 'link_veiculo',
      destinatario: phone,
      mensagem,
      veiculoId: veiculo.id,
      linkPreview: true,
    });

    res.status(200).json({ ok: true, veiculo_id: veiculo.id, placa: veiculo.placa });
  } catch (err) {
    console.error('Webhook WhatsApp erro:', err);
    // Sempre ack 200 quando possível para o WuzAPI não reenviar em loop —
    // mas em erro interno reportamos 500 para diagnóstico em testes.
    res.status(500).json({ erro: err.message });
  }
});

export default router;
