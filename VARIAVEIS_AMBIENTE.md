# Variáveis de Ambiente — PneuSistemma

Guia para **Render** (backend), **Vercel** (frontend) e **Neon** (PostgreSQL).

| Serviço | Exemplo |
|---------|---------|
| Backend (Render) | `https://pneusistemma-backend.onrender.com` |
| Frontend (Vercel) | `https://pneusistemma-frontend.vercel.app` |
| Banco (Neon) | connection string `postgresql://…@….neon.tech/…` |
| WuzAPI | `https://seu-wuzapi.exemplo.com` |

---

## 1. Vercel (Frontend)

| Variável | Valor | Obrigatória |
|----------|-------|-------------|
| `VITE_API_URL` | `https://pneusistemma-backend.onrender.com/api` | **Sim** (deve terminar com `/api`) |

Após alterar, faça **Redeploy**. Framework: Vite · Build: `npm run build` · Output: `dist`.

---

## 2. Render (Backend)

### Obrigatórias

| Variável | Valor exemplo | Descrição |
|----------|---------------|-----------|
| `NODE_ENV` | `production` | Ambiente |
| `HOST` | `0.0.0.0` | Escuta pública |
| `PORT` | *(automático)* | Render injeta — não fixe se já existir |
| `DATABASE_URL` | `postgresql://…@….neon.tech/neondb?sslmode=require` | URI do **Neon** (ou outro Postgres) |
| `DATABASE_SSL` | `true` | SSL (Neon e produção) |
| `JWT_SECRET` | string longa | Assinatura JWT |
| `JWT_EXPIRES_IN` | `7d` | Validade do token |
| `ADMIN_USER` | `admin` | Admin inicial |
| `ADMIN_PASSWORD` | senha forte | Troque após o 1º login |
| `CORS_ORIGIN` | `https://pneusistemma-frontend.vercel.app` | Front (vírgula se várias) |
| `FRONTEND_URL` | `https://pneusistemma-frontend.vercel.app` | Links WhatsApp |

### WhatsApp (WuzAPI)

| Variável | Descrição |
|----------|-----------|
| `WUZAPI_BASE_URL` | URL pública do WuzAPI |
| `WUZAPI_TOKEN` | Token do usuário da instância |
| `WUZAPI_ADMIN_TOKEN` | Token admin WuzAPI |
| `WUZAPI_WEBHOOK_PUBLIC_URL` | `https://SEU-BACKEND.onrender.com/api/webhook/whatsapp` |
| `WUZAPI_WEBHOOK_SECRET` | Opcional |
| `GERENTE_COMPRAS_WHATSAPP` | DDI+DDD+número, sem `+` |

### Opcionais

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `ALLOW_VERCEL_PREVIEWS` | `true` | CORS para `*.vercel.app` |
| `SULCO_MINIMO_MM` | `3.0` | Limite crítico |
| `SULCO_ALERTA_MM` | `8.0` | Limite alerta |
| `NODE_VERSION` | `22` | Versão Node no Render |

> **Removido:** `DB_PATH` (era SQLite). Não use disco `/var/data` para banco.

---

## 3. Neon (PostgreSQL)

1. Crie o projeto no [Neon](https://neon.tech).
2. Rode o schema: `backend/schema-neon.sql` (SQL Editor).
3. Copie a **Connection string (URI)** e cole em `DATABASE_URL` no Render.
4. Use `DATABASE_SSL=true` (Neon exige SSL).

Formato típico:

```text
DATABASE_URL=postgresql://USER:PASSWORD@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require
DATABASE_SSL=true
```

### Local (Docker, opcional)

```text
DATABASE_URL=postgresql://pneu:pneu123@localhost:5434/pneusistemma
DATABASE_SSL=false
```

---

## 4. Ordem de deploy

1. Neon → schema + anote a URI  
2. Render → backend com `DATABASE_URL` / `DATABASE_SSL=true`  
3. Vercel → `VITE_API_URL=https://….onrender.com/api`  
4. Ajuste `CORS_ORIGIN`, `FRONTEND_URL`, webhook WuzAPI  
5. Teste: `GET /api/health` → `"database":"postgresql"`

---

## 5. Checklist

### Render
- [ ] `DATABASE_URL` = URI Neon
- [ ] `DATABASE_SSL=true`
- [ ] Sem `DB_PATH` / sem Disk de SQLite
- [ ] `JWT_SECRET` e `ADMIN_PASSWORD` fortes
- [ ] `CORS_ORIGIN` / `FRONTEND_URL` = Vercel
- [ ] Health OK

### Vercel
- [ ] `VITE_API_URL` apontando para o backend
- [ ] Redeploy após salvar

---

## 6. Colar no Render (Add from .env)

```text
NODE_ENV=production
HOST=0.0.0.0
DATABASE_URL=postgresql://USER:PASSWORD@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require
DATABASE_SSL=true
JWT_SECRET=troque-por-um-segredo-longo
JWT_EXPIRES_IN=7d
ADMIN_USER=admin
ADMIN_PASSWORD=troque-esta-senha
CORS_ORIGIN=https://pneusistemma-frontend.vercel.app
FRONTEND_URL=https://pneusistemma-frontend.vercel.app
ALLOW_VERCEL_PREVIEWS=true
SULCO_MINIMO_MM=3.0
SULCO_ALERTA_MM=8.0
WUZAPI_BASE_URL=https://seu-wuzapi.exemplo.com
WUZAPI_TOKEN=
WUZAPI_ADMIN_TOKEN=
WUZAPI_WEBHOOK_PUBLIC_URL=https://pneusistemma-backend.onrender.com/api/webhook/whatsapp
WUZAPI_WEBHOOK_SECRET=
GERENTE_COMPRAS_WHATSAPP=5511999999999
```

Arquivo pronto: `backend/render.env.example`
