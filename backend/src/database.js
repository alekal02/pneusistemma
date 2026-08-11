import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { config } from './config.js';

const dataDir = path.dirname(config.dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new DatabaseSync(config.dbPath);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS veiculos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    placa TEXT NOT NULL UNIQUE,
    apelido TEXT,
    tipo TEXT NOT NULL DEFAULT 'Outro',
    marca TEXT,
    modelo TEXT,
    ano INTEGER,
    km_atual INTEGER DEFAULT 0,
    ativo INTEGER DEFAULT 1,
    observacoes TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS pneus (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    veiculo_id INTEGER NOT NULL,
    posicao TEXT NOT NULL,
    marca TEXT,
    modelo TEXT,
    medida TEXT,
    dot TEXT,
    data_instalacao TEXT,
    km_instalacao INTEGER DEFAULT 0,
    ativo INTEGER DEFAULT 1,
    observacoes TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (veiculo_id) REFERENCES veiculos(id) ON DELETE CASCADE,
    UNIQUE(veiculo_id, posicao)
  );

  CREATE TABLE IF NOT EXISTS medicoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pneu_id INTEGER NOT NULL,
    data_medicao TEXT NOT NULL DEFAULT (date('now', 'localtime')),
    km_veiculo INTEGER,
    sulco_externo REAL,
    sulco_central REAL,
    sulco_interno REAL,
    sulco_auxiliar REAL,
    pressao_psi REAL,
    responsavel TEXT,
    observacoes TEXT,
    marcacao_json TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (pneu_id) REFERENCES pneus(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_pneus_veiculo ON pneus(veiculo_id);
  CREATE INDEX IF NOT EXISTS idx_medicoes_pneu ON medicoes(pneu_id);
  CREATE INDEX IF NOT EXISTS idx_medicoes_data ON medicoes(data_medicao);

  CREATE TABLE IF NOT EXISTS configuracoes (
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
  );
`);

// Valores padrão dos limites de sulco (se ainda não configurados)
const insertConfig = db.prepare(`
  INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES (?, ?)
`);
insertConfig.run('sulco_critico_mm', String(config.sulcoMinimo));
insertConfig.run('sulco_alerta_mm', String(config.sulcoAlerta));

// Migracao: coluna layout de pneus por veiculo
try {
  db.exec(`ALTER TABLE veiculos ADD COLUMN layout_pneus TEXT DEFAULT 'padrao_5'`);
} catch {
  // coluna ja existe
}

export function getDb() {
  return db;
}

// Reexportado de limites.js para compatibilidade
export { classificarSulco } from './limites.js';

if (process.argv[1] && process.argv[1].endsWith('database.js')) {
  console.log('Banco de dados inicializado em:', config.dbPath);
}

export default db;
