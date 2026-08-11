import { getDb } from './database.js';

/**
 * Corrige textos com encoding corrompido no banco (ex: Caminh?o -> Caminhão)
 * Execute: node src/fix-encoding.js
 */
const CORRECOES = [
  ['Caminh?o Compactador', 'Caminhão Compactador'],
  ['Caminh?o Basculante', 'Caminhão Basculante'],
  ['Caminh?o Pipa', 'Caminhão Pipa'],
  ['Utilit?rio', 'Utilitário'],
  ['Ve?culo', 'Veículo'],
  ['Ve?culo cadastrado', 'Veículo cadastrado'],
  ['Medi??o registrada', 'Medição registrada'],
  ['n?o encontrado', 'não encontrado'],
];

const db = getDb();

let total = 0;

for (const [errado, correto] of CORRECOES) {
  const tabelas = [
    { sql: 'UPDATE veiculos SET tipo = ? WHERE tipo = ?', args: [correto, errado] },
    { sql: 'UPDATE veiculos SET apelido = REPLACE(apelido, ?, ?) WHERE apelido LIKE ?', args: [errado, correto, `%${errado}%`] },
    { sql: 'UPDATE veiculos SET observacoes = REPLACE(observacoes, ?, ?) WHERE observacoes LIKE ?', args: [errado, correto, `%${errado}%`] },
    { sql: 'UPDATE medicoes SET observacoes = REPLACE(observacoes, ?, ?) WHERE observacoes LIKE ?', args: [errado, correto, `%${errado}%`] },
    { sql: 'UPDATE medicoes SET responsavel = REPLACE(responsavel, ?, ?) WHERE responsavel LIKE ?', args: [errado, correto, `%${errado}%`] },
  ];

  for (const { sql, args } of tabelas) {
    const result = db.prepare(sql).run(...args);
    if (result.changes > 0) {
      console.log(`Corrigido ${result.changes}x: "${errado}" -> "${correto}"`);
      total += result.changes;
    }
  }
}

console.log(total ? `Total: ${total} registro(s) corrigido(s).` : 'Nenhum dado corrompido encontrado.');
