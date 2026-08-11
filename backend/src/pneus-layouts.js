/** Posicoes disponiveis e layouts predefinidos por tipo de veiculo */

export const POSICOES_PNEU = {
  DD: 'Dianteiro Direito',
  DE: 'Dianteiro Esquerdo',
  TD: 'Traseiro Direito',
  TE: 'Traseiro Esquerdo',
  TDE: 'Traseiro Dir. Externo',
  TDI: 'Traseiro Dir. Interno',
  TEE: 'Traseiro Esq. Externo',
  TEI: 'Traseiro Esq. Interno',
  E2DE: 'Eixo 2 Dir. Externo',
  E2DI: 'Eixo 2 Dir. Interno',
  E2EE: 'Eixo 2 Esq. Externo',
  E2EI: 'Eixo 2 Esq. Interno',
  E3DE: 'Eixo 3 Dir. Externo',
  E3DI: 'Eixo 3 Dir. Interno',
  E3EE: 'Eixo 3 Esq. Externo',
  E3EI: 'Eixo 3 Esq. Interno',
  D: 'Dianteiro (moto)',
  T: 'Traseiro (moto)',
  ESTEPE: 'Estepe',
};

/** Ordem de exibicao das posicoes */
export const ORDEM_POSICAO = Object.keys(POSICOES_PNEU);

export const LAYOUTS_PNEU = {
  padrao_5: {
    id: 'padrao_5',
    nome: 'Padrão — 4 rodas + estepe',
    descricao: 'Utilitário, van ou caminhão leve',
    posicoes: ['DD', 'DE', 'TD', 'TE', 'ESTEPE'],
  },
  utilitario_4: {
    id: 'utilitario_4',
    nome: 'Utilitário — 4 rodas',
    descricao: 'Sem estepe cadastrado',
    posicoes: ['DD', 'DE', 'TD', 'TE'],
  },
  truck_8: {
    id: 'truck_8',
    nome: 'Caminhão — 8 rodas',
    descricao: '2 dianteiras + eixo duplo + eixo traseiro (frota urbana)',
    posicoes: ['DD', 'DE', 'E2DE', 'E2DI', 'E2EE', 'E2EI', 'E3DE', 'E3EE'],
  },
  duplo_traseiro: {
    id: 'duplo_traseiro',
    nome: 'Caminhão — duplo traseiro (6 + estepe)',
    descricao: '1 eixo dianteiro + 1 eixo duplo traseiro',
    posicoes: ['DD', 'DE', 'TDE', 'TDI', 'TEE', 'TEI', 'ESTEPE'],
  },
  truck_10: {
    id: 'truck_10',
    nome: 'Caminhão pesado — 10 rodas + estepe',
    descricao: 'Dianteiro + 2 eixos duplos traseiros',
    posicoes: ['DD', 'DE', 'E2DE', 'E2DI', 'E2EE', 'E2EI', 'E3DE', 'E3DI', 'E3EE', 'E3EI', 'ESTEPE'],
  },
  compactador: {
    id: 'compactador',
    nome: 'Compactador / Basculante — 8 rodas',
    descricao: 'Layout padrão frota urbana',
    posicoes: ['DD', 'DE', 'E2DE', 'E2DI', 'E2EE', 'E2EI', 'E3DE', 'E3EE'],
  },
  moto_2: {
    id: 'moto_2',
    nome: 'Moto — 2 pneus',
    descricao: 'Dianteiro e traseiro',
    posicoes: ['D', 'T'],
  },
};

export const LAYOUT_PADRAO = 'truck_8';

export function getLayout(id) {
  return LAYOUTS_PNEU[id] || LAYOUTS_PNEU[LAYOUT_PADRAO];
}

export function labelPosicao(codigo) {
  return POSICOES_PNEU[codigo] || codigo;
}

export function ordenarPosicoes(posicoes) {
  const ordem = ORDEM_POSICAO;
  return [...posicoes].sort((a, b) => {
    const ia = ordem.indexOf(a);
    const ib = ordem.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
}

export function sqlOrderPosicao(campo = 'p.posicao') {
  const cases = ORDEM_POSICAO.map((p, i) => `WHEN '${p}' THEN ${i + 1}`).join(' ');
  return `CASE ${campo} ${cases} ELSE 999 END`;
}

export function aplicarLayoutPneus(db, veiculoId, layoutId, posicoesCustom) {
  const layout = posicoesCustom?.length
    ? { posicoes: ordenarPosicoes(posicoesCustom) }
    : getLayout(layoutId);

  const desejadas = layout.posicoes;

  const atuais = db.prepare(
    'SELECT id, posicao, ativo FROM pneus WHERE veiculo_id = ?'
  ).all(veiculoId);

  const insert = db.prepare(`
    INSERT INTO pneus (veiculo_id, posicao, ativo) VALUES (?, ?, 1)
  `);
  const reativar = db.prepare('UPDATE pneus SET ativo = 1 WHERE id = ?');
  const desativar = db.prepare('UPDATE pneus SET ativo = 0 WHERE id = ?');

  for (const pos of desejadas) {
    const existente = atuais.find((p) => p.posicao === pos);
    if (existente) {
      if (!existente.ativo) reativar.run(existente.id);
    } else {
      insert.run(veiculoId, pos);
    }
  }

  for (const p of atuais) {
    if (p.ativo && !desejadas.includes(p.posicao)) {
      desativar.run(p.id);
    }
  }

  db.prepare(`
    UPDATE veiculos SET layout_pneus = ?, updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `).run(layoutId || 'personalizado', veiculoId);

  return desejadas;
}
