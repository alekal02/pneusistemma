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
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  jwtSecret: process.env.JWT_SECRET || 'pneu-dev-secret-altere-em-producao',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  adminUser: process.env.ADMIN_USER || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  rootDir,
  dataDir: path.join(rootDir, 'data'),
};

export const TIPOS_VEICULO = [
  'Truck / Tração',
  'Toco / Mini',
];
