# Controle de Desgaste de Pneus

Sistema para controle de desgaste de pneus da frota de limpeza urbana.

**Arquitetura separada:**
- `backend/` — API REST (Node.js + Express + SQLite)
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
│   ├── data/               # SQLite
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
| GET | `/api/pneus/:id` | Histórico |
| POST | `/api/medicoes` | Nova medição |
| GET | `/api/medicoes/alertas` | Alertas |

## Licença

MIT
