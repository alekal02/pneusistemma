import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { corrigirEncodingBanco } from './fix-encoding.js';

const dataDir = path.dirname(config.dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new DatabaseSync(config.dbPath);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS filiais (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    codigo TEXT NOT NULL UNIQUE,
    contrato TEXT,
    ativo INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login TEXT NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL,
    papel TEXT NOT NULL CHECK(papel IN ('admin', 'filial')),
    filial_id INTEGER,
    ativo INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (filial_id) REFERENCES filiais(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS veiculos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    placa TEXT NOT NULL UNIQUE,
    apelido TEXT,
    tipo TEXT NOT NULL DEFAULT 'Outro',
    marca TEXT,
    modelo TEXT,
    ano INTEGER,
    km_atual INTEGER DEFAULT 0,
    hr_atual REAL DEFAULT 0,
    ativo INTEGER DEFAULT 1,
    observacoes TEXT,
    filial_id INTEGER,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (filial_id) REFERENCES filiais(id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS pneus (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    veiculo_id INTEGER,
    posicao TEXT,
    filial_id INTEGER,
    marca TEXT,
    modelo TEXT,
    medida TEXT,
    dot TEXT,
    numero_fogo TEXT,
    tipo_pneu TEXT DEFAULT 'misto',
    condicao TEXT DEFAULT 'novo',
    vida_recap INTEGER DEFAULT 0,
    sulco_inicial_mm REAL,
    status_pneu TEXT DEFAULT 'estoque',
    data_instalacao TEXT,
    km_instalacao INTEGER DEFAULT 0,
    ativo INTEGER DEFAULT 1,
    observacoes TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (veiculo_id) REFERENCES veiculos(id) ON DELETE SET NULL,
    FOREIGN KEY (filial_id) REFERENCES filiais(id) ON DELETE RESTRICT,
    UNIQUE(veiculo_id, posicao)
  );

  CREATE TABLE IF NOT EXISTS medicoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pneu_id INTEGER NOT NULL,
    data_medicao TEXT NOT NULL DEFAULT (date('now', 'localtime')),
    km_veiculo INTEGER,
    hr_veiculo REAL,
    sulco_externo REAL,
    sulco_central REAL,
    sulco_interno REAL,
    sulco_auxiliar REAL,
    pressao_psi REAL,
    responsavel TEXT,
    observacoes TEXT,
    marcacao_json TEXT,
    diagnostico TEXT,
    acao_sugerida TEXT,
    desgaste_mm_km REAL,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (pneu_id) REFERENCES pneus(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS movimentacoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pneu_id INTEGER NOT NULL,
    veiculo_id INTEGER,
    tipo TEXT NOT NULL,
    data_evento TEXT NOT NULL DEFAULT (date('now', 'localtime')),
    km_veiculo INTEGER,
    hr_veiculo REAL,
    posicao TEXT,
    sulco_mm REAL,
    detalhes TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (pneu_id) REFERENCES pneus(id) ON DELETE CASCADE,
    FOREIGN KEY (veiculo_id) REFERENCES veiculos(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_pneus_veiculo ON pneus(veiculo_id);
  CREATE INDEX IF NOT EXISTS idx_medicoes_pneu ON medicoes(pneu_id);
  CREATE INDEX IF NOT EXISTS idx_medicoes_data ON medicoes(data_medicao);
  CREATE INDEX IF NOT EXISTS idx_movimentacoes_pneu ON movimentacoes(pneu_id);

  CREATE TABLE IF NOT EXISTS configuracoes (
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
  );
`);

const insertConfig = db.prepare(`
  INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES (?, ?)
`);
insertConfig.run('sulco_critico_mm', String(config.sulcoMinimo));
insertConfig.run('sulco_alerta_mm', String(config.sulcoAlerta));
insertConfig.run('sulco_recap_mm', '5');
insertConfig.run('sulco_novo_mm', '14');
insertConfig.run('max_recaps', '6');
insertConfig.run('diagnostico_tolerancia_mm', '1');

function ensureColumn(table, column, ddl) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  } catch {
    // coluna já existe
  }
}

ensureColumn('veiculos', 'layout_pneus', `TEXT DEFAULT 'truck_10'`);
ensureColumn('veiculos', 'hr_atual', 'REAL DEFAULT 0');
ensureColumn('veiculos', 'filial_id', 'INTEGER');

ensureColumn('pneus', 'numero_fogo', 'TEXT');
ensureColumn('pneus', 'tipo_pneu', `TEXT DEFAULT 'misto'`);
ensureColumn('pneus', 'condicao', `TEXT DEFAULT 'novo'`);
ensureColumn('pneus', 'vida_recap', 'INTEGER DEFAULT 0');
ensureColumn('pneus', 'sulco_inicial_mm', 'REAL');
ensureColumn('pneus', 'status_pneu', `TEXT DEFAULT 'montado'`);
ensureColumn('pneus', 'filial_id', 'INTEGER');

ensureColumn('medicoes', 'hr_veiculo', 'REAL');
ensureColumn('medicoes', 'diagnostico', 'TEXT');
ensureColumn('medicoes', 'acao_sugerida', 'TEXT');
ensureColumn('medicoes', 'desgaste_mm_km', 'REAL');

try {
  db.exec('CREATE INDEX IF NOT EXISTS idx_veiculos_filial ON veiculos(filial_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_usuarios_filial ON usuarios(filial_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_pneus_filial ON pneus(filial_id)');
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_pneus_fogo_filial
    ON pneus(filial_id, numero_fogo)
    WHERE numero_fogo IS NOT NULL AND numero_fogo != '' AND ativo = 1`);
} catch {
  // índice já existe ou coluna ainda indisponível
}

/** Migra veículos sem filial para Matriz e cria admin se necessário */
function seedAuthAndFilial() {
  let matriz = db.prepare(`SELECT id FROM filiais WHERE codigo = 'MATRIZ'`).get();
  if (!matriz) {
    const r = db.prepare(`
      INSERT INTO filiais (nome, codigo, contrato)
      VALUES ('Matriz', 'MATRIZ', 'Dados migrados')
    `).run();
    matriz = { id: r.lastInsertRowid };
  }

  db.prepare(`
    UPDATE veiculos SET filial_id = ? WHERE filial_id IS NULL
  `).run(matriz.id);

  const admin = db.prepare(`SELECT id FROM usuarios WHERE papel = 'admin' LIMIT 1`).get();
  if (!admin) {
    const hash = bcrypt.hashSync(config.adminPassword, 10);
    db.prepare(`
      INSERT INTO usuarios (login, senha_hash, papel, filial_id, ativo)
      VALUES (?, ?, 'admin', NULL, 1)
    `).run(config.adminUser, hash);
    console.log(`[seed] Admin criado: ${config.adminUser} / (senha do .env ADMIN_PASSWORD)`);
  }

  // Usuário da Matriz se não existir
  const userMatriz = db.prepare(`
    SELECT id FROM usuarios WHERE filial_id = ? AND papel = 'filial' LIMIT 1
  `).get(matriz.id);
  if (!userMatriz) {
    const hash = bcrypt.hashSync('matriz123', 10);
    db.prepare(`
      INSERT INTO usuarios (login, senha_hash, papel, filial_id, ativo)
      VALUES ('matriz', ?, 'filial', ?, 1)
    `).run(hash, matriz.id);
    console.log('[seed] Usuário filial Matriz: matriz / matriz123');
  }

  return matriz.id;
}

/** Torna veiculo_id/posicao nullable e garante filial_id (estoque reutilizável) */
function migratePneusEstoque(filialFallbackId) {
  db.prepare(`
    UPDATE pneus SET filial_id = (
      SELECT v.filial_id FROM veiculos v WHERE v.id = pneus.veiculo_id
    )
    WHERE filial_id IS NULL AND veiculo_id IS NOT NULL
  `).run();

  if (filialFallbackId) {
    db.prepare(`
      UPDATE pneus SET filial_id = ? WHERE filial_id IS NULL
    `).run(filialFallbackId);
  }

  const info = db.prepare('PRAGMA table_info(pneus)').all();
  const veiculoCol = info.find((c) => c.name === 'veiculo_id');
  if (!veiculoCol || veiculoCol.notnull !== 1) return;

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(`
    CREATE TABLE pneus_novo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      veiculo_id INTEGER,
      posicao TEXT,
      filial_id INTEGER,
      marca TEXT,
      modelo TEXT,
      medida TEXT,
      dot TEXT,
      numero_fogo TEXT,
      tipo_pneu TEXT DEFAULT 'misto',
      condicao TEXT DEFAULT 'novo',
      vida_recap INTEGER DEFAULT 0,
      sulco_inicial_mm REAL,
      status_pneu TEXT DEFAULT 'montado',
      data_instalacao TEXT,
      km_instalacao INTEGER DEFAULT 0,
      ativo INTEGER DEFAULT 1,
      observacoes TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (veiculo_id) REFERENCES veiculos(id) ON DELETE SET NULL,
      FOREIGN KEY (filial_id) REFERENCES filiais(id) ON DELETE RESTRICT,
      UNIQUE(veiculo_id, posicao)
    );

    INSERT INTO pneus_novo (
      id, veiculo_id, posicao, filial_id, marca, modelo, medida, dot, numero_fogo,
      tipo_pneu, condicao, vida_recap, sulco_inicial_mm, status_pneu,
      data_instalacao, km_instalacao, ativo, observacoes, created_at
    )
    SELECT
      id, veiculo_id, posicao, filial_id, marca, modelo, medida, dot, numero_fogo,
      tipo_pneu, condicao, vida_recap, sulco_inicial_mm, status_pneu,
      data_instalacao, km_instalacao, ativo, observacoes, created_at
    FROM pneus;

    DROP TABLE pneus;
    ALTER TABLE pneus_novo RENAME TO pneus;

    CREATE INDEX IF NOT EXISTS idx_pneus_veiculo ON pneus(veiculo_id);
    CREATE INDEX IF NOT EXISTS idx_pneus_filial ON pneus(filial_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pneus_fogo_filial
      ON pneus(filial_id, numero_fogo)
      WHERE numero_fogo IS NOT NULL AND numero_fogo != '' AND ativo = 1;
  `);
  db.exec('PRAGMA foreign_keys = ON');
  console.log('[migrate] Tabela pneus: veiculo_id/posicao nullable + filial_id');
}

const matrizId = seedAuthAndFilial();
migratePneusEstoque(matrizId);

// Corrige acentos/corrompidos salvos no SQLite (ex.: Tração → Tra��o)
corrigirEncodingBanco(db);

export function getDb() {
  return db;
}

export { classificarSulco } from './limites.js';

if (process.argv[1] && process.argv[1].endsWith('database.js')) {
  console.log('Banco de dados inicializado em:', config.dbPath);
}

export default db;
