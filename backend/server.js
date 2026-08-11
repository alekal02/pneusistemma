/**
 * API Backend - Controle de Desgaste de Pneus
 */
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import { config } from './src/config.js';
import './src/database.js';

import authRouter from './src/routes/auth.js';
import filiaisRouter from './src/routes/filiais.js';
import veiculosRouter from './src/routes/veiculos.js';
import pneusRouter from './src/routes/pneus.js';
import medicoesRouter from './src/routes/medicoes.js';
import configuracoesRouter from './src/routes/configuracoes.js';
import dashboardRouter from './src/routes/dashboard.js';
import { getLimites } from './src/limites.js';

const app = express();

if (!fs.existsSync(config.dataDir)) {
  fs.mkdirSync(config.dataDir, { recursive: true });
}

app.use(cors({
  origin: config.corsOrigin,
  credentials: true,
}));

app.use((_req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return originalJson(body);
  };
  next();
});

app.use(express.json({ limit: '2mb' }));

app.use('/api/auth', authRouter);
app.use('/api/filiais', filiaisRouter);
app.use('/api/veiculos', veiculosRouter);
app.use('/api/pneus', pneusRouter);
app.use('/api/medicoes', medicoesRouter);
app.use('/api/configuracoes', configuracoesRouter);
app.use('/api/dashboard', dashboardRouter);

app.get('/api/health', (_req, res) => {
  const limites = getLimites();
  res.json({
    status: 'ok',
    ambiente: config.nodeEnv,
    sulco_critico_mm: limites.sulco_critico_mm,
    sulco_alerta_mm: limites.sulco_alerta_mm,
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ erro: 'Erro interno do servidor' });
});

app.listen(config.port, config.host, () => {
  console.log('========================================');
  console.log('  API - Controle de Pneus');
  console.log('========================================');
  console.log(`  Ambiente: ${config.nodeEnv}`);
  console.log(`  API: http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}/api`);
  console.log(`  CORS: ${config.corsOrigin}`);
  console.log(`  Banco: ${config.dbPath}`);
  console.log('========================================');
});
