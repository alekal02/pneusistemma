import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || 'localhost',
  nodeEnv: process.env.NODE_ENV || 'development',
  dbPath: process.env.DB_PATH || path.join(rootDir, 'data', 'pneus.db'),
  sulcoMinimo: parseFloat(process.env.SULCO_MINIMO_MM || '1.6'),
  sulcoAlerta: parseFloat(process.env.SULCO_ALERTA_MM || '3.0'),
  // URL do frontend permitida no CORS (separado do backend)
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  rootDir,
  dataDir: path.join(rootDir, 'data'),
};

export const TIPOS_VEICULO = [
  'Caminhão Compactador',
  'Caminhão Basculante',
  'Varredeira',
  'Lavadora de Ruas',
  'Caminhão Pipa',
  'Utilitário',
  'Moto',
  'Outro',
];

// Posições e layouts: backend/src/pneus-layouts.js
