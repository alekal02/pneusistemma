# Controle de Desgaste de Pneus

Sistema para controle de desgaste de pneus da frota de limpeza urbana.

**Arquitetura separada:**
- `backend/` — API REST (Node.js + Express + PostgreSQL)
- `frontend/` — Interface web (Vite + HTML/CSS/JS)

## Desenvolvimento local

```bash
# Na raiz do projeto
npm run install:all

# Configurar ambiente
copy backend\.env.example backend\.env
copy frontend\.env.example frontend\.env

# Subir front + back juntos
npm run dev
```

| Serviço   | URL                        |
|-----------|----------------------------|
| Frontend  | http://localhost:5173      |
| API       | http://localhost:3000/api  |

Ou em terminais separados:

```bash
npm run dev:api   # só backend
npm run dev:web   # só frontend
```

## Estrutura

```
pneu-main/
├── backend/
│   ├── server.js           # API Express
│   ├── src/
│   │   ├── config.js
│   │   ├── database.js
│   │   └── routes/
│   ├── data/               # (legado; banco agora é PostgreSQL)
│   └── deploy/             # PM2, nginx, guia Digital Ocean
├── frontend/
│   ├── index.html
│   ├── src/
│   │   ├── main.js
│   │   ├── app.js
│   │   ├── tire-marker.js
│   │   └── style.css
│   ├── public/assets/      # SVG do pneu
│   └── dist/               # Build de produção (gerado)
└── package.json            # Scripts para rodar ambos
```

## Produção

1. Build do frontend: `npm run build` (na pasta `frontend/`)
2. API com PM2: veja `backend/deploy/DEPLOY.md`
3. Nginx serve `frontend/dist` e faz proxy de `/api` para o backend

## API

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/health` | Status |
| GET | `/api/veiculos` | Listar veículos |
| POST | `/api/veiculos` | Cadastrar |
| GET | `/api/veiculos/:id` | Detalhe |
| GET | `/api/veiculos/acesso-rapido?token=` | Acesso rápido (WhatsApp) |
| GET | `/api/veiculos/:id/link-whatsapp` | Gerar link WhatsApp |
| GET | `/api/pneus/:id` | Histórico |
| POST | `/api/medicoes` | Nova medição (+ alerta WhatsApp) |
| GET | `/api/medicoes/alertas` | Alertas |
| POST | `/api/webhook/whatsapp` | Webhook WuzAPI (placa → link) |

## WhatsApp (WuzAPI)

Fluxo: funcionário envia a **placa** no WhatsApp → backend gera link de acesso rápido (24h) → medição sem login → se sulco em alerta/crítico, notifica gerentes.

1. Suba o WuzAPI: `npm run wuzapi:up` (dashboard: http://localhost:8080/dashboard — admin `1234ABCD`)
2. No app, aba **WhatsApp** → **Gerar token** → **Conectar / QR**
3. Configure `WUZAPI_*` e `FRONTEND_URL` em `backend/.env` (ver `.env.example`). O admin token deve bater com o Docker.

Detalhes: [`INTEGRACAO_WHATSAPP.md`](INTEGRACAO_WHATSAPP.md).

```bash
# Configurar webhook no WuzAPI (após subir a API)
curl -X POST http://localhost:8080/webhook \
  -H "token: $WUZAPI_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"webhook":"http://localhost:3000/api/webhook/whatsapp","events":["Message"]}'
```

## Licença

MIT
