# INTEGRAÇÃO WHATSAPP — PNEUSISTEMMA × WUZAPI

> Documento técnico para implementação no Cursor.  
> **Objetivo:** Automatizar o fluxo de medição de pneus via WhatsApp, enviando links diretos para veículos e alertando gerentes em caso de problemas críticos.

---

## 1. VISÃO GERAL

O funcionário de campo envia a **placa do caminhão** pelo WhatsApp. O sistema responde com um **link direto** para o histórico daquele veículo + a opção de adicionar nova medição. Após salvar a medição, se houver alertas (sulco crítico, desgaste irregular, etc.), o sistema **notifica automaticamente** os gerentes de compras e o gerente da filial responsável.

### 1.1 Fluxo Macro

```
Funcionário → WhatsApp (placa)
                ↓
        WuzAPI Webhook
                ↓
    Backend PneuSistemma
                ↓
    ├─→ Busca veículo pela placa
    ├─→ Gera link direto com token temporário
    └─→ Envia resposta WhatsApp com link + resumo
                ↓
    Funcionário clica no link
                ↓
    Frontend abre tela do veículo (histórico + medição)
                ↓
    Funcionário salva nova medição
                ↓
    Backend processa diagnóstico
                ↓
    Se ALERTA/CRÍTICO:
        ├─→ Notifica Gerente de Compras (WhatsApp)
        └─→ Notifica Gerente da Filial (WhatsApp)
```

---

## 2. CONFIGURAÇÃO DO AMBIENTE

### 2.1 Variáveis de Ambiente (backend/.env)

Adicionar ao `.env` do backend:

```env
# WuzAPI
WUZAPI_BASE_URL=http://localhost:8080
WUZAPI_TOKEN=TOKEN_DO_USUARIO_WUZAPI
WUZAPI_ADMIN_TOKEN=TOKEN_ADMIN_WUZAPI
WUZAPI_WEBHOOK_SECRET=chave_secreta_webhook

# Links do frontend
FRONTEND_URL=http://localhost:5173

# WhatsApp dos gerentes (pode vir do banco, mas fallback aqui)
GERENTE_COMPRAS_WHATSAPP=5511999999999
```

### 2.2 Configuração do Webhook no WuzAPI

Após subir o backend, configurar o webhook no WuzAPI:

```bash
curl -X POST http://localhost:8080/webhook   -H "token: $WUZAPI_TOKEN"   -H "Content-Type: application/json"   -d '{
    "webhook": "http://localhost:3000/api/webhook/whatsapp",
    "events": ["Message"]
  }'
```

> **Nota:** Em produção, o webhook deve ser HTTPS e acessível publicamente.

---

## 3. ALTERAÇÕES NO BANCO DE DADOS (PostgreSQL)

### 3.1 Novas colunas na tabela `usuarios`

```sql
ALTER TABLE usuarios ADD COLUMN whatsapp TEXT;
ALTER TABLE usuarios ADD COLUMN cargo TEXT CHECK(cargo IN ('funcionario', 'gerente_filial', 'gerente_compras', 'admin'));
```

> O `cargo` define quem recebe notificações. Um usuário pode ter múltiplos cargos? Não — um por usuário. O gerente de compras é um usuário com `papel='admin'` ou `papel='filial'` + `cargo='gerente_compras'`.

### 3.2 Nova tabela: `notificacoes_whatsapp`

Log de todas as notificações enviadas.

```sql
CREATE TABLE IF NOT EXISTS notificacoes_whatsapp (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL CHECK(tipo IN ('link_veiculo', 'alerta_critico', 'alerta_desgaste')),
  destinatario_whatsapp TEXT NOT NULL,
  veiculo_id INTEGER,
  medicao_id INTEGER,
  mensagem TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'enviado' CHECK(status IN ('enviado', 'erro', 'entregue')),
  resposta_api TEXT,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (veiculo_id) REFERENCES veiculos(id),
  FOREIGN KEY (medicao_id) REFERENCES medicoes(id)
);
```

### 3.3 Nova tabela: `tokens_acesso_rapido`

Tokens temporários para links diretos (acesso sem login, expira em 24h).

```sql
CREATE TABLE IF NOT EXISTS tokens_acesso_rapido (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT UNIQUE NOT NULL,
  veiculo_id INTEGER NOT NULL,
  filial_id INTEGER NOT NULL,
  whatsapp_origem TEXT,
  expira_em DATETIME NOT NULL,
  usado_em DATETIME,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (veiculo_id) REFERENCES veiculos(id),
  FOREIGN KEY (filial_id) REFERENCES filiais(id)
);
```

### 3.4 Seed de usuários (atualizar `database.js`)

Garantir que existam usuários com WhatsApp para teste:

```sql
-- Gerente de compras (admin com WhatsApp)
INSERT OR IGNORE INTO usuarios (login, senha_hash, papel, cargo, whatsapp, filial_id) 
VALUES ('compras', '$2b$10$...', 'admin', 'gerente_compras', '5511988888888', NULL);

-- Gerente da filial Matriz
INSERT OR IGNORE INTO usuarios (login, senha_hash, papel, cargo, whatsapp, filial_id) 
VALUES ('gerente_matriz', '$2b$10$...', 'filial', 'gerente_filial', '5511977777777', 1);
```

---

## 4. ENDPOINTS NO BACKEND

### 4.1 POST `/api/webhook/whatsapp` — Receber mensagem do WuzAPI

**Recebe:** webhook do WuzAPI quando alguém envia mensagem.

**Lógica:**
1. Validar origem (HMAC ou IP, se possível).
2. Extrair `phone` (remetente) e `body` (texto da mensagem).
3. Limpar o texto: remover espaços, traços, converter para maiúsculo.
4. Tentar encontrar veículo onde `placa` LIKE `%texto%`.
5. Se encontrar 1 veículo:
   - Gerar token na tabela `tokens_acesso_rapido` (expira em 24h).
   - Montar link: `{FRONTEND_URL}/veiculo-acesso-rapido?token=XYZ`.
   - Buscar última medição do veículo.
   - Montar mensagem com link + resumo do histórico.
   - Enviar mensagem via WuzAPI (`POST /chat/send/text`).
   - Salvar log em `notificacoes_whatsapp`.
6. Se encontrar 0 veículos:
   - Responder: "Placa não encontrada. Envie a placa correta."
7. Se encontrar >1 veículo:
   - Responder com lista de placas encontradas.

**Exemplo de payload recebido do WuzAPI:**

```json
{
  "event": "Message",
  "data": {
    "id": "3EB0...",
    "from": "5511999999999@s.whatsapp.net",
    "timestamp": "2026-08-11T14:30:00Z",
    "message": {
      "conversation": "ABC1D23"
    }
  }
}
```

> **Atenção:** O formato exato do webhook do WuzAPI pode variar. Implementar parser flexível que procure `conversation`, `extendedTextMessage.text`, ou `message.conversation`.

**Implementação sugerida (backend/src/routes/webhook.js):**

```js
import { Router } from 'express';
import { randomBytes } from 'crypto';
import { db } from '../database.js';
import { enviarMensagemWhatsApp } from '../services/whatsapp.js';

const router = Router();

router.post('/whatsapp', async (req, res) => {
  try {
    const event = req.body;
    const phone = extrairTelefone(event);
    const body = extrairTextoMensagem(event);

    if (!phone || !body) {
      return res.status(200).json({ ok: true }); // ack silencioso
    }

    const placaLimpa = body.toUpperCase().replace(/[^A-Z0-9]/g, '');

    // Buscar veículo
    const veiculos = db.prepare(
      "SELECT v.*, f.nome as filial_nome FROM veiculos v JOIN filiais f ON v.filial_id = f.id WHERE REPLACE(REPLACE(UPPER(v.placa), '-', ''), ' ', '') LIKE ?"
    ).all(`%${placaLimpa}%`);

    if (veiculos.length === 0) {
      await enviarMensagemWhatsApp(phone, 
        `❌ Placa *${body}* não encontrada no sistema.\n\nEnvie a placa correta do caminhão.`);
      return res.status(200).json({ ok: true });
    }

    if (veiculos.length > 1) {
      const lista = veiculos.map(v => `• ${v.placa} (${v.tipo}) - ${v.filial_nome}`).join('\n');
      await enviarMensagemWhatsApp(phone,
        `🔍 Encontrei ${veiculos.length} veículos:\n${lista}\n\nEnvie a placa exata para abrir o histórico.`);
      return res.status(200).json({ ok: true });
    }

    const veiculo = veiculos[0];

    // Gerar token de acesso rápido
    const token = randomBytes(32).toString('hex');
    const expiraEm = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    db.prepare(
      `INSERT INTO tokens_acesso_rapido (token, veiculo_id, filial_id, whatsapp_origem, expira_em) 
       VALUES (?, ?, ?, ?, ?)`
    ).run(token, veiculo.id, veiculo.filial_id, phone, expiraEm);

    const link = `${process.env.FRONTEND_URL}/veiculo-acesso-rapido?token=${token}`;

    // Buscar última medição e status dos pneus
    const ultimaMedicao = db.prepare(
      `SELECT m.*, p.posicao, p.numero_fogo 
       FROM medicoes m 
       JOIN pneus p ON m.pneu_id = p.id 
       WHERE p.veiculo_id = ? 
       ORDER BY m.data DESC LIMIT 1`
    ).get(veiculo.id);

    const pneusStatus = db.prepare(
      `SELECT posicao, status, sulco_atual FROM pneus WHERE veiculo_id = ?`
    ).all(veiculo.id);

    const alertas = pneusStatus.filter(p => p.status === 'critico').length;
    const alertasAlerta = pneusStatus.filter(p => p.status === 'alerta').length;

    let mensagem = `🚛 *${veiculo.placa}* — ${veiculo.tipo}\n`;
    mensagem += `📍 Filial: ${veiculo.filial_nome}\n\n`;

    if (ultimaMedicao) {
      mensagem += `📊 Última medição: ${ultimaMedicao.data}\n`;
      mensagem += `Posição ${ultimaMedicao.posicao} — Fogo ${ultimaMedicao.numero_fogo}\n`;
      mensagem += `Sulco: ${ultimaMedicao.sulco_minimo}mm\n\n`;
    }

    if (alertas > 0) {
      mensagem += `🚨 *${alertas} pneu(s) em estado CRÍTICO*\n`;
    }
    if (alertasAlerta > 0) {
      mensagem += `⚠️ *${alertasAlerta} pneu(s) em ALERTA*\n`;
    }
    if (alertas === 0 && alertasAlerta === 0) {
      mensagem += `✅ Todos os pneus estão OK\n`;
    }

    mensagem += `\n👉 *Clique para medir:*\n${link}\n\n`;
    mensagem += `_Link válido por 24 horas._`;

    await enviarMensagemWhatsApp(phone, mensagem);

    // Log
    db.prepare(
      `INSERT INTO notificacoes_whatsapp (tipo, destinatario_whatsapp, veiculo_id, mensagem) 
       VALUES (?, ?, ?, ?)`
    ).run('link_veiculo', phone, veiculo.id, mensagem);

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook WhatsApp erro:', err);
    res.status(500).json({ error: err.message });
  }
});

function extrairTelefone(event) {
  // Tenta extrair de vários formatos possíveis do WuzAPI
  return event?.data?.from?.replace(/@.*$/, '') || 
         event?.from?.replace(/@.*$/, '') || 
         null;
}

function extrairTextoMensagem(event) {
  return event?.data?.message?.conversation || 
         event?.data?.message?.extendedTextMessage?.text || 
         event?.message?.conversation || 
         null;
}

export default router;
```

### 4.2 GET `/api/veiculos/acesso-rapido` — Validar token e retornar dados

**Query:** `?token=XYZ`

**Retorna:** dados do veículo + últimas medições + pneus (mesmo formato do detalhe do veículo).

**Lógica:**
1. Buscar token em `tokens_acesso_rapido`.
2. Verificar se `expira_em > now()` e `usado_em IS NULL` (ou permitir múltiplos usos dentro do prazo).
3. Atualizar `usado_em = now()`.
4. Retornar dados do veículo + medições + pneus.

```js
router.get('/acesso-rapido', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token obrigatório' });

  const tokenRow = db.prepare(
    `SELECT * FROM tokens_acesso_rapido WHERE token = ? AND expira_em > datetime('now')`
  ).get(token);

  if (!tokenRow) {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }

  // Atualiza uso
  db.prepare(`UPDATE tokens_acesso_rapido SET usado_em = datetime('now') WHERE id = ?`).run(tokenRow.id);

  // Retorna dados do veículo (reutilizar lógica do /veiculos/:id)
  const veiculo = db.prepare(`SELECT * FROM veiculos WHERE id = ?`).get(tokenRow.veiculo_id);
  const pneus = db.prepare(`SELECT * FROM pneus WHERE veiculo_id = ?`).all(tokenRow.veiculo_id);
  const medicoes = db.prepare(
    `SELECT m.*, p.posicao, p.numero_fogo FROM medicoes m 
     JOIN pneus p ON m.pneu_id = p.id 
     WHERE p.veiculo_id = ? ORDER BY m.data DESC LIMIT 20`
  ).all(tokenRow.veiculo_id);

  res.json({ veiculo, pneus, medicoes, token_valido: true });
});
```

### 4.3 POST `/api/medicoes` — Após salvar, disparar alertas

**Modificar o endpoint existente** para, após salvar a medição e calcular o diagnóstico, verificar se há alertas/críticos e notificar gerentes.

**Lógica adicional após salvar medição:**

```js
// Dentro do POST /api/medicoes, após salvar e calcular diagnóstico:

const veiculo = db.prepare(`SELECT * FROM veiculos WHERE id = ?`).get(pneu.veiculo_id);
const filialId = veiculo.filial_id;

// Verificar se esta medição gerou alerta
if (['alerta', 'critico'].includes(diagnostico.status)) {
  // Buscar gerentes
  const gerentes = db.prepare(
    `SELECT * FROM usuarios WHERE (cargo = 'gerente_compras' OR cargo = 'gerente_filial') 
     AND (filial_id = ? OR filial_id IS NULL)`
  ).all(filialId);

  for (const gerente of gerentes) {
    if (!gerente.whatsapp) continue;

    let mensagem = `🚨 *ALERTA DE PNEU* 🚨\n\n`;
    mensagem += `🚛 Veículo: *${veiculo.placa}*\n`;
    mensagem += `📍 Posição: ${pneu.posicao} — Fogo: ${pneu.numero_fogo}\n`;
    mensagem += `⚠️ Status: *${diagnostico.status.toUpperCase()}*\n`;
    mensagem += `📏 Sulco mínimo: ${medicao.sulco_minimo}mm\n`;
    mensagem += `🔧 Diagnóstico: ${diagnostico.perfil}\n`;
    mensagem += `💡 Ação sugerida: ${diagnostico.acao}\n\n`;
    mensagem += `Acesse o sistema para mais detalhes.`;

    try {
      const resp = await enviarMensagemWhatsApp(gerente.whatsapp, mensagem);
      db.prepare(
        `INSERT INTO notificacoes_whatsapp (tipo, destinatario_whatsapp, veiculo_id, medicao_id, mensagem, resposta_api) 
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('alerta_critico', gerente.whatsapp, veiculo.id, medicaoId, mensagem, JSON.stringify(resp));
    } catch (err) {
      console.error(`Falha ao notificar ${gerente.whatsapp}:`, err);
    }
  }
}
```

### 4.4 Novo serviço: `backend/src/services/whatsapp.js`

```js
// backend/src/services/whatsapp.js
const WUZAPI_URL = process.env.WUZAPI_BASE_URL;
const WUZAPI_TOKEN = process.env.WUZAPI_TOKEN;

export async function enviarMensagemWhatsApp(phone, text) {
  const cleanPhone = phone.replace(/[^0-9]/g, '');

  const res = await fetch(`${WUZAPI_URL}/chat/send/text`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'token': WUZAPI_TOKEN
    },
    body: JSON.stringify({
      Phone: cleanPhone,
      Body: text
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WuzAPI erro ${res.status}: ${err}`);
  }

  return res.json();
}

export async function enviarMensagemWhatsAppComLink(phone, text, link) {
  // Envio com link preview habilitado
  const cleanPhone = phone.replace(/[^0-9]/g, '');

  const res = await fetch(`${WUZAPI_URL}/chat/send/text`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'token': WUZAPI_TOKEN
    },
    body: JSON.stringify({
      Phone: cleanPhone,
      Body: text,
      LinkPreview: true
    })
  });

  return res.json();
}
```

---

## 5. ALTERAÇÕES NO FRONTEND

### 5.1 Nova rota/página: `/veiculo-acesso-rapido`

Criar nova tela que:
1. Lê `?token=` da URL.
2. Chama `GET /api/veiculos/acesso-rapido?token=XYZ`.
3. Se token inválido: mostra tela de erro "Link expirado ou inválido".
4. Se válido: mostra a **mesma tela de detalhe do veículo** (reutilizar componente), mas em modo "acesso rápido" (sem necessidade de login JWT).

**Em `frontend/src/app.js` ou router:**

```js
// Adicionar rota
if (path === '/veiculo-acesso-rapido') {
  const token = new URLSearchParams(window.location.search).get('token');
  if (!token) {
    renderErro('Link inválido');
    return;
  }
  renderVeiculoAcessoRapido(token);
}
```

**Componente `renderVeiculoAcessoRapido(token)`:**

```js
async function renderVeiculoAcessoRapido(token) {
  try {
    const res = await fetch(`/api/veiculos/acesso-rapido?token=${token}`);
    if (!res.ok) throw new Error('Token inválido');
    const data = await res.json();

    // Reutilizar o mesmo render de detalhe do veículo
    // Mas sem o header de auth (o backend valida pelo token)
    renderVeiculoDetalhe(data.veiculo, {
      modoAcessoRapido: true,
      tokenAcesso: token,
      pneus: data.pneus,
      medicoes: data.medicoes
    });
  } catch (err) {
    app.innerHTML = `
      <div class="erro-container">
        <h2>🔗 Link expirado ou inválido</h2>
        <p>Este link de acesso rápido não é mais válido. Solicite um novo link pelo WhatsApp.</p>
        <a href="/">Voltar ao login</a>
      </div>
    `;
  }
}
```

### 5.2 Modificar tela de medição para modo acesso rápido

Na tela de medição do pneu, quando em `modoAcessoRapido`:
- O POST para `/api/medicoes` deve incluir o `token` no body ou header.
- O backend deve aceitar medições via token (autenticação alternativa).

**Modificação no `POST /api/medicoes`:**

```js
// No backend, adicionar verificação alternativa:
const token = req.headers['x-acesso-rapido-token'] || req.body.token_acesso;
let filialId, userId;

if (token) {
  const tokenRow = db.prepare(`SELECT * FROM tokens_acesso_rapido WHERE token = ? AND expira_em > datetime('now')`).get(token);
  if (!tokenRow) return res.status(401).json({ error: 'Token inválido' });
  filialId = tokenRow.filial_id;
  userId = null; // ou um ID de sistema
} else {
  // JWT normal
  filialId = req.filialId;
  userId = req.userId;
}
```

### 5.3 Adicionar botão "Compartilhar no WhatsApp" na tela do veículo

Para facilitar testes e uso interno, adicionar botão que gera link de acesso rápido:

```js
async function gerarLinkWhatsApp(veiculoId) {
  const res = await fetch(`/api/veiculos/${veiculoId}/link-whatsapp`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await res.json();
  const texto = `🚛 *${data.placa}*\n👉 ${data.link}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`);
}
```

**Endpoint correspondente no backend:**

```js
// GET /api/veiculos/:id/link-whatsapp
router.get('/:id/link-whatsapp', authMiddleware, (req, res) => {
  const veiculoId = req.params.id;
  const token = randomBytes(32).toString('hex');
  const expiraEm = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  db.prepare(
    `INSERT INTO tokens_acesso_rapido (token, veiculo_id, filial_id, expira_em) VALUES (?, ?, ?, ?)`
  ).run(token, veiculoId, req.filialId, expiraEm);

  const link = `${process.env.FRONTEND_URL}/veiculo-acesso-rapido?token=${token}`;
  const veiculo = db.prepare(`SELECT placa FROM veiculos WHERE id = ?`).get(veiculoId);

  res.json({ link, placa: veiculo.placa });
});
```

---

## 6. FLUXO DETALHADO POR CENÁRIO

### Cenário 1: Funcionário solicita histórico

1. Funcionário envia "ABC1D23" para o número do WhatsApp do sistema.
2. WuzAPI recebe e POSTa para `/api/webhook/whatsapp`.
3. Backend:
   - Limpa texto → "ABC1D23"
   - Busca placa → encontra veículo ID 5, filial Matriz
   - Gera token `abc123...` válido por 24h
   - Busca última medição: posição 1E, sulco 2.1mm, status ALERTA
   - Monta mensagem com link
   - Envia via WuzAPI `/chat/send/text`
   - Log em `notificacoes_whatsapp`
4. Funcionário recebe no WhatsApp:
   ```
   🚛 ABC1D23 — Truck / Tração
   📍 Filial: Matriz

   📊 Última medição: 2026-08-10
   Posição 1E — Fogo 4455
   Sulco: 2.1mm

   ⚠️ 1 pneu(s) em ALERTA

   👉 Clique para medir:
   http://localhost:5173/veiculo-acesso-rapido?token=abc123...

   _Link válido por 24 horas._
   ```
5. Funcionário clica no link → frontend carrega tela do veículo sem login.

### Cenário 2: Funcionário adiciona medição

1. Funcionário está na tela de acesso rápido do veículo ABC1D23.
2. Clica em posição 2EI (vazio ou com pneu).
3. Preenche sulcos: Ext 3.0, Cent 1.5, Int 2.8, Aux 3.2.
4. Salva medição → POST `/api/medicoes` com `token_acesso` no body.
5. Backend:
   - Valida token
   - Salva medição
   - Roda diagnóstico: sulco mínimo 1.5mm → CRÍTICO
   - Perfil: centro gasto → `falta_calib`
   - Ação: TROCA
   - Verifica alertas → status é CRÍTICO
   - Busca gerentes:
     - Gerente Compras (whatsapp: 5511988888888)
     - Gerente Filial Matriz (whatsapp: 5511977777777)
   - Envia mensagem para ambos via WuzAPI
   - Log em `notificacoes_whatsapp`
6. Gerentes recebem:
   ```
   🚨 ALERTA DE PNEU 🚨

   🚛 Veículo: ABC1D23
   📍 Posição: 2EI — Fogo: 7788
   ⚠️ Status: CRÍTICO
   📏 Sulco mínimo: 1.5mm
   🔧 Diagnóstico: falta_calib
   💡 Ação sugerida: Troca

   Acesse o sistema para mais detalhes.
   ```

### Cenário 3: Placa não encontrada

1. Funcionário envia "XYZ9999".
2. Backend não encontra veículo.
3. Responde: "❌ Placa XYZ9999 não encontrada no sistema. Envie a placa correta do caminhão."

### Cenário 4: Múltiplas placas encontradas

1. Funcionário envia "ABC".
2. Encontra ABC1D23, ABC2E45, ABC3F67.
3. Responde com lista para o usuário escolher.

---

## 7. REGRAS DE NEGÓCIO

| Regra | Descrição |
|-------|-----------|
| **R1** | O token de acesso rápido expira em **24 horas** após geração. |
| **R2** | Um token pode ser usado **múltiplas vezes** dentro do prazo (funcionário pode medir vários pneus). |
| **R3** | Apenas veículos da filial do token são acessíveis (escopo preservado). |
| **R4** | Notificações de alerta são enviadas **apenas uma vez por medição** (verificar se já notificou para essa `medicao_id`). |
| **R5** | Gerentes sem número de WhatsApp cadastrado são ignorados silenciosamente (log como erro). |
| **R6** | O link de acesso rápido **não exige login JWT**, mas o token é obrigatório. |
| **R7** | Mensagens do webhook são processadas apenas se o remetente enviar texto (ignorar imagens, áudio, etc.). |
| **R8** | A busca por placa é **case-insensitive** e ignora traços/espaços. |
| **R9** | Se a medição resultar em status `ok`, nenhuma notificação é enviada aos gerentes. |
| **R10** | O gerente de compras (`cargo='gerente_compras'`) recebe alertas de **todas as filiais**. O gerente da filial (`cargo='gerente_filial'`) recebe apenas da **sua filial**. |

---

## 8. MODELO DE DADOS ATUALIZADO

### Tabela `usuarios` (colunas novas)

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `whatsapp` | TEXT | Número com DDD e DDI, ex: 5511999999999 |
| `cargo` | TEXT | `funcionario`, `gerente_filial`, `gerente_compras`, `admin` |

### Tabela `tokens_acesso_rapido` (nova)

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | INTEGER PK | |
| `token` | TEXT UNIQUE | Hash aleatório de 64 chars |
| `veiculo_id` | INTEGER FK | Veículo vinculado |
| `filial_id` | INTEGER FK | Filial do veículo |
| `whatsapp_origem` | TEXT | Quem solicitou (opcional) |
| `expira_em` | DATETIME | Validade |
| `usado_em` | DATETIME | Primeiro acesso |
| `criado_em` | DATETIME | |

### Tabela `notificacoes_whatsapp` (nova)

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | INTEGER PK | |
| `tipo` | TEXT | `link_veiculo`, `alerta_critico`, `alerta_desgaste` |
| `destinatario_whatsapp` | TEXT | |
| `veiculo_id` | INTEGER FK | |
| `medicao_id` | INTEGER FK | |
| `mensagem` | TEXT | Conteúdo enviado |
| `status` | TEXT | `enviado`, `erro`, `entregue` |
| `resposta_api` | TEXT | JSON da resposta do WuzAPI |
| `criado_em` | DATETIME | |

---

## 9. CHECKLIST DE IMPLEMENTAÇÃO

### Backend

- [ ] **1.** Adicionar variáveis WuzAPI no `.env`
- [ ] **2.** Criar tabela `tokens_acesso_rapido` no `database.js`
- [ ] **3.** Criar tabela `notificacoes_whatsapp` no `database.js`
- [ ] **4.** Adicionar colunas `whatsapp` e `cargo` em `usuarios` no `database.js`
- [ ] **5.** Criar `backend/src/services/whatsapp.js` (funções de envio)
- [ ] **6.** Criar `backend/src/routes/webhook.js` (receber mensagens)
- [ ] **7.** Registrar rota `/api/webhook/whatsapp` no `server.js`
- [ ] **8.** Criar endpoint `GET /api/veiculos/acesso-rapido`
- [ ] **9.** Criar endpoint `GET /api/veiculos/:id/link-whatsapp`
- [ ] **10.** Modificar `POST /api/medicoes` para aceitar `token_acesso` e notificar gerentes
- [ ] **11.** Modificar `POST /api/medicoes` para buscar e notificar gerentes após alerta
- [ ] **12.** Adicionar seed de usuários de teste com WhatsApp no `database.js`

### Frontend

- [ ] **13.** Criar rota `/veiculo-acesso-rapido` no router
- [ ] **14.** Criar função `renderVeiculoAcessoRapido(token)`
- [ ] **15.** Modificar tela de medição para enviar `token_acesso` quando em modo rápido
- [ ] **16.** Adaptar `truck-diagram.js` para funcionar sem autenticação JWT (usar token)
- [ ] **17.** Adicionar botão "Gerar Link WhatsApp" na tela de detalhe do veículo (modo logado)
- [ ] **18.** Criar tela de erro para token inválido/expirado

### Testes / Dev

- [ ] **19.** Configurar webhook no WuzAPI local apontando para `http://localhost:3000/api/webhook/whatsapp`
- [ ] **20.** Testar envio de placa e recebimento de link
- [ ] **21.** Testar acesso ao link e salvamento de medição
- [ ] **22.** Testar notificação de alerta para gerentes
- [ ] **23.** Testar cenário de placa não encontrada
- [ ] **24.** Testar cenário de múltiplas placas

---

## 10. EXEMPLOS DE CURL PARA TESTES

### 10.1 Simular webhook do WuzAPI (placa encontrada)

```bash
curl -X POST http://localhost:3000/api/webhook/whatsapp   -H "Content-Type: application/json"   -d '{
    "event": "Message",
    "data": {
      "from": "5511999999999@s.whatsapp.net",
      "message": {
        "conversation": "ABC1D23"
      }
    }
  }'
```

### 10.2 Simular webhook (placa não encontrada)

```bash
curl -X POST http://localhost:3000/api/webhook/whatsapp   -H "Content-Type: application/json"   -d '{
    "event": "Message",
    "data": {
      "from": "5511999999999@s.whatsapp.net",
      "message": {
        "conversation": "ZZZ9999"
      }
    }
  }'
```

### 10.3 Testar acesso rápido

```bash
curl "http://localhost:3000/api/veiculos/acesso-rapido?token=SEU_TOKEN_AQUI"
```

### 10.4 Enviar mensagem via WuzAPI (teste manual)

```bash
curl -X POST http://localhost:8080/chat/send/text   -H "token: SEU_TOKEN_WUZAPI"   -H "Content-Type: application/json"   -d '{
    "Phone": "5511999999999",
    "Body": "Teste de integração PneuSistemma"
  }'
```

### 10.5 Criar token de acesso rápido manualmente

```bash
curl -X GET http://localhost:3000/api/veiculos/1/link-whatsapp   -H "Authorization: Bearer SEU_JWT"
```

---

## 11. CONSIDERAÇÕES DE SEGURANÇA

1. **Webhook:** Em produção, validar o IP de origem ou usar HMAC do WuzAPI (`/session/hmac/config`).
2. **Tokens:** Os tokens de acesso rápido são de uso único por veículo e expiram em 24h. Não contêm dados sensíveis.
3. **Escopo:** Mesmo no acesso rápido, o usuário só vê dados do veículo vinculado ao token (não pode acessar outros veículos).
4. **Rate Limit:** Considerar adicionar rate limit no webhook para evitar spam (ex: max 10 requisições/minuto por número).
5. **Números WhatsApp:** Sempre armazenar sem o `+` e com DDI+DDD (ex: 5511999999999).

---

## 12. ESTRUTURA DE ARQUIVOS FINAL

```
backend/
├── .env                              # + WUZAPI_* vars
├── server.js                         # + app.use('/api/webhook', webhookRoutes)
├── src/
│   ├── config.js                     # + validar WUZAPI vars
│   ├── database.js                   # + novas tabelas e seeds
│   ├── services/
│   │   └── whatsapp.js               # NOVO: enviarMensagemWhatsApp
│   └── routes/
│       ├── webhook.js                # NOVO: /api/webhook/whatsapp
│       ├── veiculos.js               # + /acesso-rapido, /:id/link-whatsapp
│       └── medicoes.js               # + notificação pós-medição

frontend/
├── src/
│   ├── app.js                        # + rota /veiculo-acesso-rapido
│   ├── pages/
│   │   └── veiculo-acesso-rapido.js  # NOVO (ou inline em app.js)
│   └── style.css                     # + estilos para tela de erro de token
```

---

## 13. MENSAGENS DO SISTEMA (templates)

### Template 1: Link com histórico

```
🚛 {PLACA} — {TIPO}
📍 Filial: {FILIAL}

📊 Última medição: {DATA}
Posição {POS} — Fogo {FOGO}
Sulco: {SULCO}mm

{STATUS_EMOJI} {STATUS_TEXTO}

👉 *Clique para medir:*
{LINK}

_Link válido por 24 horas._
```

### Template 2: Alerta para gerentes

```
🚨 *ALERTA DE PNEU* 🚨

🚛 Veículo: {PLACA}
📍 Posição: {POSICAO} — Fogo: {FOGO}
⚠️ Status: {STATUS}
📏 Sulco mínimo: {SULCO}mm
🔧 Diagnóstico: {PERFIL}
💡 Ação sugerida: {ACAO}

Acesse o sistema para mais detalhes.
```

### Template 3: Placa não encontrada

```
❌ Placa *{PLACA}* não encontrada no sistema.

Envie a placa correta do caminhão.
```

### Template 4: Múltiplas placas

```
🔍 Encontrei {N} veículos:
{LISTA}

Envie a placa exata para abrir o histórico.
```

---

> **Pronto para implementação.** Este documento cobre todo o fluxo solicitado: recebimento de placa por WhatsApp, geração de link direto, acesso sem login, medição de sulco e notificação automática de alertas aos gerentes.
