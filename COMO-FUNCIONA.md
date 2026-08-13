# Como funciona o PneuSistemma

Sistema web para **controle de desgaste de pneus** da frota (limpeza urbana / caminhões). O objetivo é registrar medições de sulco, acompanhar o ciclo de vida de cada pneu (estoque → montado → recapagem / descarte) e alertar quando há risco de troca ou problema de calibragem/alinhamento.

---

## Para que serve

Na operação diária, a equipe precisa saber:

- Quais pneus estão **OK**, em **alerta** ou **críticos**
- Em qual **posição** de cada veículo cada pneu está montado
- O **histórico** de sulco, km/horas e eventos (montagem, desmontagem, recap, descarte)
- Quais pneus estão **parados no estoque** da filial e podem ser montados
- Quando o desgaste sugere **falta/excesso de calibragem**, **alinhamento** ou **recapagem/troca**

O sistema concentra isso em uma interface web com diagrama do caminhão, medições em 4 pontos do sulco e painel de alertas.

---

## Visão geral da arquitetura

Monorepo com frontend e backend separados:

```
pneusistemma/
├── backend/     → API REST (Node.js + Express + PostgreSQL)
├── frontend/    → Interface web (Vite + HTML/CSS/JS)
└── package.json → Scripts para instalar e rodar os dois juntos
```

| Camada    | Tecnologia                         | Papel                                      |
|-----------|------------------------------------|--------------------------------------------|
| Frontend  | Vite, HTML, CSS, JavaScript        | Telas, diagrama do truck, marcação no pneu |
| Backend   | Express (ESM), JWT, bcrypt         | Autenticação, regras de negócio, API       |
| Banco     | PostgreSQL (`pg`)                  | Persistência (local Docker / Render)       |

Fluxo típico:

1. O navegador abre o frontend (`localhost:5173` em dev).
2. O usuário faz login; o token JWT fica no `localStorage`.
3. As telas chamam a API em `/api/...` (proxy do Vite ou `VITE_API_URL`).
4. O backend valida o token, aplica o escopo da **filial** e lê/grava o PostgreSQL.

---

## Quem usa o sistema

Há dois papéis:

| Papel    | Acesso | O que faz |
|----------|--------|-----------|
| **admin**  | Gestão global | Filiais, usuários, limites de sulco; não opera a frota no dia a dia |
| **filial** | Operação      | Veículos, estoque de pneus, medições e dashboard da própria filial |

Usuários de filial só enxergam e alteram dados da **sua** filial. O admin gerencia cadastros e configurações (limites críticos/alerta, recapagem, etc.).

No primeiro start, o banco cria automaticamente:

- Filial **Matriz**
- Usuário **admin** (login/senha do `.env`)
- Usuário **matriz** / `matriz123` (papel filial)

---

## Conceitos principais

### Filial

Unidade operacional (ex.: Matriz, contrato X). Veículos, pneus e usuários de operação ficam vinculados a uma filial.

### Veículo

Identificado pela **placa**, com tipo (`Truck / Tração` ou `Toco / Mini`), km/horas atuais e um **layout de pneus** (quantos eixos e posições).

Layouts comuns:

- `truck_10` — truck de 10 posições (padrão para Tração)
- `toco_6` — toco/mini com 6 posições

Cada posição tem um código (ex.: `1E`, `1D`, `2EE`, `2EI`…) e um papel: **direcional**, **tração** ou **estepe**.

### Pneu

Unidade rastreável (idealmente pelo **número de fogo**). Pode estar:

- **estoque** — cadastrado na filial, ainda sem veículo
- **montado** — em uma posição de um veículo
- (via eventos) encaminhado a **recapagem** ou **descarte**

Campos úteis: marca, modelo, medida, DOT, condição (novo/recap), vida de recap, sulco inicial, status.

### Medição

Registro periódico do sulco em até **4 pontos** (esquerdo → direito):

1. Externo  
2. Central  
3. Interno  
4. Auxiliar  

Também pode incluir pressão (psi), km/horas do veículo, responsável, observações e uma **marcação visual** no desenho do pneu (`marcacao_json`).

A partir da medição o backend:

- Classifica o sulco mínimo como **ok / alerta / crítico**
- Roda um **diagnóstico de perfil** (desgaste uniforme, cunha, centro gasto, bordas gastas…)
- Sugere **ação**: OK, monitorar, recapagem ou troca
- Pode calcular desgaste aproximado (mm/km) em relação à medição anterior

### Movimentação

Histórico de eventos do pneu: montagem, desmontagem, recapagem, descarte, etc., com data, km/horas e detalhes.

---

## Como a operação funciona na prática

### 1. Login

Tela de autenticação → `POST /api/auth/login` → JWT. Nas próximas requisições o frontend envia `Authorization: Bearer <token>`.

### 2. Dashboard (filial)

Resumo da frota da filial: cards por veículo com status dos pneus e alertas. Clique no veículo abre o detalhe.

### 3. Cadastro de veículos

A filial cadastra placa, tipo, layout, km/hr. O layout define o diagrama interativo (eixos e slots).

### 4. Estoque de pneus

Pneus entram primeiro no **estoque**. Depois são **montados** em um slot vazio do diagrama do caminhão. Desmontar devolve o pneu ao estoque.

### 5. Medição no caminhão

No detalhe do veículo:

1. Clica na posição no diagrama  
2. Informa os sulcos (e opcionalmente marca o desenho do pneu)  
3. Salva a medição  

O sistema atualiza badges de status, diagnóstico e sugestão de ação. Há auto-save auxiliar na tela de medição do truck.

### 6. Ciclo de vida

- **Montar** estoque → posição do veículo  
- **Medir** periodicamente  
- **Desmontar** → volta ao estoque  
- **Recapagem** / **descarte** → registra evento e altera o status conforme a regra da API  

### 7. Configurações (admin)

Limites configuráveis (mm):

| Chave | Significado típico (padrão) |
|-------|-----------------------------|
| Sulco crítico | ≤ 1,6 mm → crítico |
| Sulco alerta | até 3,0 mm → alerta |
| Limiar de recapagem | ~5 mm |
| Sulco de pneu novo | ~14 mm |
| Máx. de recaps | 6 |
| Tolerância do diagnóstico | 1 mm entre pontos |

Esses valores alimentam badges, alertas do dashboard e as regras de ação sugerida.

---

## Backend — organização

```
backend/
├── server.js              # Express: CORS, rotas, health
├── src/
│   ├── config.js          # .env (porta, DB, JWT, limites)
│   ├── database.js        # Schema PostgreSQL + seed/migrações
│   ├── auth.js            # JWT, bcrypt, escopo de filial
│   ├── limites.js         # Leitura/gravação de thresholds
│   ├── diagnostico.js     # Perfil de desgaste + ações
│   ├── pneus-layouts.js   # Posições e layouts de frota
│   └── routes/
│       ├── auth.js
│       ├── filiais.js
│       ├── veiculos.js
│       ├── pneus.js
│       ├── medicoes.js
│       ├── configuracoes.js
│       └── dashboard.js
├── data/                  # Legado (banco agora é PostgreSQL)
└── deploy/                # PM2, nginx, guia DigitalOcean
```

### Principais rotas da API

| Prefixo | Função |
|---------|--------|
| `GET /api/health` | Status + limites atuais |
| `/api/auth` | Login e sessão |
| `/api/filiais` | Cadastro de filiais (admin) |
| `/api/veiculos` | CRUD de veículos + detalhe com pneus |
| `/api/pneus` | Estoque, montagem, desmontagem, histórico |
| `/api/medicoes` | Nova medição e alertas |
| `/api/configuracoes` | Limites de sulco |
| `/api/dashboard` | Resumo operacional da filial |

### Modelo de dados (tabelas)

- `filiais` — unidades  
- `usuarios` — login, papel (`admin` \| `filial`), vínculo opcional à filial  
- `veiculos` — frota + `layout_pneus`  
- `pneus` — estoque/montados (único por `veiculo_id` + `posicao`; fogo único por filial)  
- `medicoes` — sulcos, pressão, diagnóstico, marcação  
- `movimentacoes` — linha do tempo do pneu  
- `configuracoes` — chave/valor dos limites  

O PostgreSQL é criado/migrado ao subir a API (`database.js`).

---

## Frontend — organização

```
frontend/
├── index.html
├── vite.config.js         # Dev server + proxy /api
├── public/assets/         # SVG do pneu, etc.
└── src/
    ├── main.js            # Entrada
    ├── app.js             # Telas, auth, CRUD, dashboard
    ├── truck-diagram.js   # Diagrama interativo do veículo
    ├── tire-marker.js     # Marcação visual no desenho do pneu
    ├── perfil-sulco.js    # Gráfico/perfil dos 4 pontos
    └── style.css
```

Telas principais (visão operacional):

- Login  
- Dashboard  
- Lista / detalhe de veículos (diagrama + medição)  
- Estoque de pneus  
- Histórico de medições  
- Configurações (admin) e gestão de filiais/usuários  

O estado de autenticação fica em `localStorage` (`pneu_auth`). Se a API retornar 401, a sessão é limpa e a tela de login volta.

---

## Diagnóstico automático

Com pelo menos 3 pontos de sulco válidos, o backend compara o perfil:

| Código | Interpretação |
|--------|----------------|
| `ok` | Desgaste uniforme (dentro da tolerância) |
| `alinhamento` | Cunha (um lado mais gasto) → alinhar/balancear |
| `falta_calib` | Centro mais gasto → possível subcalibragem |
| `excesso_calib` | Bordas mais gastas → possível sobrecalibragem |
| `irregular` | Padrão inconsistente → inspeção visual |
| `sem_dado` | Pontos insuficientes |

Ações sugeridas (prioridade crescente): **OK** → **Monitorar** → **Recapagem** → **Troca**, combinando profundidade do sulco, limiares e vida de recap.

---

## Rodar localmente

Na raiz do projeto:

```bash
npm run install:all

copy backend\.env.example backend\.env
copy frontend\.env.example frontend\.env

npm run dev
```

| Serviço  | URL |
|----------|-----|
| Frontend | http://localhost:5173 |
| API      | http://localhost:3000/api |

Separado:

```bash
npm run dev:api
npm run dev:web
```

Requisitos: **Node.js ≥ 18** no backend e **PostgreSQL** (`DATABASE_URL`).

---

## Produção (resumo)

1. Build do frontend: `npm run build` (pasta `frontend/` → `dist/`)  
2. API com **PM2**  
3. **Nginx** serve o `frontend/dist` e faz proxy de `/api` para o Node  

Detalhes: `backend/deploy/DEPLOY.md`.

Variáveis importantes do backend em produção: `DATABASE_URL`, `JWT_SECRET`, `ADMIN_PASSWORD`, `CORS_ORIGIN`, limites de sulco.

---

## Resumo em uma frase

O **PneuSistemma** é um controle de frota focado em pneus: cada filial cadastra veículos e estoque, monta pneus nas posições do caminhão, registra sulco em quatro pontos e recebe alertas e diagnósticos para decidir calibragem, alinhamento, recapagem ou troca com base em histórico e limites configuráveis.
