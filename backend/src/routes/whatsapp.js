/**
 * Proxy admin → WuzAPI (status, QR, connect/disconnect)
 * Spec: /session/status, /session/qr, /session/connect, /session/disconnect, /session/logout
 */
import { Router } from 'express';
import { config } from '../config.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { wuzapiConfigurado } from '../services/whatsapp.js';

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

async function wuzapiFetch(path, { method = 'GET', body } = {}) {
  if (!wuzapiConfigurado()) {
    const err = new Error('WuzAPI não configurado (WUZAPI_BASE_URL / WUZAPI_TOKEN)');
    err.status = 503;
    throw err;
  }

  const res = await fetch(`${config.wuzapiBaseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      token: config.wuzapiToken,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const raw = await res.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }

  if (!res.ok) {
    const err = new Error(data?.error || data?.erro || `WuzAPI ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

function normalizarStatus(payload) {
  const d = payload?.data || payload || {};
  return {
    configurado: true,
    wuzapi_url: config.wuzapiBaseUrl,
    connected: Boolean(d.connected ?? d.Connected),
    loggedIn: Boolean(d.loggedIn ?? d.LoggedIn),
    name: d.name || d.Name || null,
    jid: d.jid || d.JID || null,
    webhook: d.webhook || d.Webhook || null,
    events: d.events || d.Events || null,
    qrcode: d.qrcode || d.QRCode || null,
    token_configurado: Boolean(config.wuzapiToken),
  };
}

/** Garante webhook apontando para esta API (Docker → host) */
async function garantirWebhook() {
  const webhookUrl = `http://host.docker.internal:${config.port}/api/webhook/whatsapp`;
  try {
    await wuzapiFetch('/webhook', {
      method: 'PUT',
      body: {
        webhook: webhookUrl,
        events: ['Message'],
        Active: true,
      },
    });
    return webhookUrl;
  } catch (err) {
    console.warn('[whatsapp] Falha ao configurar webhook:', err.message);
    return null;
  }
}

router.get('/status', async (_req, res) => {
  try {
    if (!wuzapiConfigurado()) {
      return res.json({
        configurado: false,
        connected: false,
        loggedIn: false,
        mensagem: 'Configure WUZAPI_BASE_URL e WUZAPI_TOKEN no .env',
      });
    }
    const data = await wuzapiFetch('/session/status');
    res.json(normalizarStatus(data));
  } catch (err) {
    res.status(err.status || 500).json({ erro: err.message, configurado: wuzapiConfigurado() });
  }
});

router.get('/qr', async (_req, res) => {
  try {
    const data = await wuzapiFetch('/session/qr');
    const qr = data?.data?.QRCode || data?.data?.qrcode || data?.QRCode || '';
    res.json({
      qrcode: qr,
      tem_qr: Boolean(qr),
    });
  } catch (err) {
    res.status(err.status || 500).json({ erro: err.message });
  }
});

router.post('/connect', async (_req, res) => {
  try {
    const webhook = await garantirWebhook();
    const data = await wuzapiFetch('/session/connect', {
      method: 'POST',
      body: { Subscribe: ['Message'], Immediate: true },
    });

    // Aguarda QR ficar disponível
    await new Promise((r) => setTimeout(r, 1500));
    let status;
    try {
      status = normalizarStatus(await wuzapiFetch('/session/status'));
    } catch {
      status = null;
    }

    let qrcode = status?.qrcode || '';
    if (!qrcode && !status?.loggedIn) {
      try {
        const qrData = await wuzapiFetch('/session/qr');
        qrcode = qrData?.data?.QRCode || qrData?.data?.qrcode || '';
      } catch {
        // ignore
      }
    }

    res.json({
      mensagem: 'Conexão iniciada — escaneie o QR Code no WhatsApp',
      webhook,
      ...(status || {}),
      qrcode,
      wuzapi: data?.data || data,
    });
  } catch (err) {
    res.status(err.status || 500).json({ erro: err.message });
  }
});

router.post('/disconnect', async (_req, res) => {
  try {
    await wuzapiFetch('/session/disconnect', { method: 'POST' });
    res.json({ mensagem: 'Desconectado (sessão preservada — reconectar sem QR)' });
  } catch (err) {
    res.status(err.status || 500).json({ erro: err.message });
  }
});

router.post('/logout', async (_req, res) => {
  try {
    await wuzapiFetch('/session/logout', { method: 'POST' });
    res.json({ mensagem: 'Logout realizado — será necessário escanear QR novamente' });
  } catch (err) {
    res.status(err.status || 500).json({ erro: err.message });
  }
});

export default router;
