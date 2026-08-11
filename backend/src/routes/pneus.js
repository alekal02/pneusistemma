import { Router } from 'express';
import { getDb, classificarSulco } from '../database.js';
import { getLimites, menorSulco } from '../limites.js';
import {
  diagnosticarPerfil,
  sugerirAcao,
  percentualVida,
} from '../diagnostico.js';
import {
  validarMontagem,
  papelPosicao,
  labelPosicao,
  TIPOS_PNEU,
  CONDICOES_PNEU,
  STATUS_PNEU,
  getLayout,
  LAYOUT_PADRAO,
} from '../pneus-layouts.js';
import {
  requireAuth,
  requireFilial,
  filialScopeId,
  assertPneuDaFilial,
  assertVeiculoDaFilial,
} from '../auth.js';
import {
  parseCsv,
  toCsv,
  PNEU_TEMPLATE_HEADERS,
  PNEU_TEMPLATE_ROWS,
  mapTipoPneu,
  mapCondicao,
} from '../csv-utils.js';

const router = Router();

router.use(requireAuth);
router.use(requireFilial);

function enriquecerPneu(pneu, ultimaMedicao = null) {
  const limites = getLimites();
  const row = ultimaMedicao || {};
  const menor = menorSulco(row);
  const diagnostico = diagnosticarPerfil(row, limites.diagnostico_tolerancia_mm);
  const acao = sugerirAcao(menor, limites, pneu.vida_recap || 0);
  const sulcoRef = pneu.sulco_inicial_mm ?? limites.sulco_novo_mm;

  return {
    ...pneu,
    posicao_label: pneu.posicao ? labelPosicao(pneu.posicao) : null,
    papel_posicao: pneu.posicao ? papelPosicao(pneu.posicao) : null,
    menor_sulco: menor,
    status_sulco: classificarSulco(menor),
    diagnostico: diagnostico.codigo,
    diagnostico_label: diagnostico.label,
    diagnostico_desc: diagnostico.descricao,
    acao_sugerida: acao.codigo,
    acao_label: acao.label,
    acao_motivo: acao.motivo,
    vida_util_pct: percentualVida(menor, sulcoRef, limites.sulco_critico_mm),
    vida_label: pneu.vida_recap > 0
      ? `${pneu.vida_recap}ª recap`
      : (pneu.condicao === 'novo' ? 'Novo' : 'Recapado'),
  };
}

function ultimaMedicaoDoPneu(db, pneuId) {
  return db.prepare(`
    SELECT * FROM medicoes
    WHERE pneu_id = ?
    ORDER BY data_medicao DESC, id DESC
    LIMIT 1
  `).get(pneuId) || null;
}

router.get('/meta', (_req, res) => {
  res.json({
    tipos_pneu: TIPOS_PNEU,
    condicoes: CONDICOES_PNEU,
    status: STATUS_PNEU,
    vidas_recap: [0, 1, 2, 3, 4, 5, 6],
  });
});

/** Planilha-modelo de pneus (CSV Excel BR) */
router.get('/import/modelo', (_req, res) => {
  const csv = toCsv(PNEU_TEMPLATE_HEADERS, PNEU_TEMPLATE_ROWS);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="modelo-pneus.csv"');
  res.send(csv);
});

/** Importação em massa de pneus para o estoque */
router.post('/import', (req, res) => {
  const filialId = filialScopeId(req);
  const db = getDb();

  let rows = Array.isArray(req.body?.itens) ? req.body.itens : null;
  if (!rows && req.body?.csv) {
    rows = parseCsv(req.body.csv).rows;
  }
  if (!rows?.length) {
    return res.status(400).json({ erro: 'Nenhuma linha para importar. Envie csv ou itens[].' });
  }

  const inseridos = [];
  const erros = [];

  const insert = db.prepare(`
    INSERT INTO pneus (
      veiculo_id, posicao, filial_id, marca, modelo, medida, dot, numero_fogo,
      tipo_pneu, condicao, vida_recap, sulco_inicial_mm, status_pneu, ativo, observacoes
    ) VALUES (NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'estoque', 1, ?)
  `);

  db.exec('BEGIN');
  try {
    for (const raw of rows) {
      const linha = raw.__linha || '?';
      const fogo = String(raw.numero_fogo || raw.fogo || '').trim();
      if (!fogo) {
        erros.push({ linha, erro: 'Nº de fogo obrigatório' });
        continue;
      }

      const tipo = mapTipoPneu(raw.tipo_pneu || raw.tipo);
      const cond = mapCondicao(raw.condicao);
      let vida = raw.vida_recap != null && raw.vida_recap !== ''
        ? parseInt(raw.vida_recap, 10)
        : (cond === 'recapado' ? 1 : 0);
      if (!Number.isFinite(vida) || vida < 0) vida = 0;
      if (cond === 'novo') vida = 0;

      const sulco = raw.sulco_inicial_mm != null && raw.sulco_inicial_mm !== ''
        ? parseFloat(String(raw.sulco_inicial_mm).replace(',', '.'))
        : null;

      try {
        const result = insert.run(
          filialId,
          String(raw.marca || '').trim() || null,
          String(raw.modelo || '').trim() || null,
          String(raw.medida || '').trim() || null,
          String(raw.dot || '').trim() || null,
          fogo,
          tipo,
          cond,
          vida,
          Number.isFinite(sulco) ? sulco : null,
          String(raw.observacoes || '').trim() || null
        );
        inseridos.push({ id: result.lastInsertRowid, numero_fogo: fogo, tipo_pneu: tipo, condicao: cond });
      } catch (err) {
        if (String(err.message).includes('UNIQUE')) {
          erros.push({ linha, numero_fogo: fogo, erro: 'Nº de fogo já existe nesta filial' });
        } else {
          erros.push({ linha, numero_fogo: fogo, erro: err.message });
        }
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    return res.status(500).json({ erro: err.message });
  }

  if (!inseridos.length && erros.length) {
    return res.status(400).json({
      erro: 'Nenhum pneu importado',
      inseridos: 0,
      erros,
    });
  }

  res.status(201).json({
    mensagem: `${inseridos.length} pneu(s) importado(s) no estoque`,
    inseridos: inseridos.length,
    detalhes: inseridos,
    erros,
  });
});

/** Lista pneus da filial (estoque / montados / todos) */
router.get('/', (req, res) => {
  const db = getDb();
  const filialId = filialScopeId(req);
  const status = (req.query.status || 'todos').toLowerCase();
  const q = (req.query.q || '').trim();

  let where = 'p.ativo = 1 AND p.filial_id = ?';
  const params = [filialId];

  if (status === 'estoque') {
    where += ` AND p.status_pneu = 'estoque'`;
  } else if (status === 'montado') {
    where += ` AND p.status_pneu = 'montado'`;
  } else if (status === 'recapagem') {
    where += ` AND p.status_pneu = 'recapagem'`;
  } else {
    where += ` AND p.status_pneu != 'descarte'`;
  }

  if (q) {
    where += ` AND (
      IFNULL(p.numero_fogo,'') LIKE ? OR IFNULL(p.marca,'') LIKE ?
      OR IFNULL(p.dot,'') LIKE ? OR IFNULL(v.placa,'') LIKE ?
    )`;
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  const rows = db.prepare(`
    SELECT p.*,
      v.placa as veiculo_placa, v.apelido as veiculo_apelido,
      (SELECT sulco_externo FROM medicoes WHERE pneu_id = p.id ORDER BY data_medicao DESC, id DESC LIMIT 1) as ult_sulco_ext,
      (SELECT sulco_central FROM medicoes WHERE pneu_id = p.id ORDER BY data_medicao DESC, id DESC LIMIT 1) as ult_sulco_cent,
      (SELECT sulco_interno FROM medicoes WHERE pneu_id = p.id ORDER BY data_medicao DESC, id DESC LIMIT 1) as ult_sulco_int,
      (SELECT sulco_auxiliar FROM medicoes WHERE pneu_id = p.id ORDER BY data_medicao DESC, id DESC LIMIT 1) as ult_sulco_aux
    FROM pneus p
    LEFT JOIN veiculos v ON v.id = p.veiculo_id
    WHERE ${where}
    ORDER BY
      CASE p.status_pneu WHEN 'estoque' THEN 0 WHEN 'montado' THEN 1 ELSE 2 END,
      p.numero_fogo, p.id DESC
  `).all(...params);

  res.json(rows.map((p) => {
    const ultima = {
      sulco_externo: p.ult_sulco_ext,
      sulco_central: p.ult_sulco_cent,
      sulco_interno: p.ult_sulco_int,
      sulco_auxiliar: p.ult_sulco_aux,
    };
    return enriquecerPneu(p, ultima);
  }));
});

/** Cria pneu no estoque */
router.post('/', (req, res) => {
  const {
    marca, modelo, medida, dot, numero_fogo,
    tipo_pneu, condicao, vida_recap, sulco_inicial_mm, observacoes,
  } = req.body;

  const fogo = numero_fogo?.trim();
  if (!fogo) {
    return res.status(400).json({ erro: 'Nº de fogo é obrigatório para cadastro no estoque' });
  }

  const filialId = filialScopeId(req);
  const db = getDb();
  const tipo = tipo_pneu || 'misto';
  const cond = condicao || 'novo';
  const vida = vida_recap != null ? parseInt(vida_recap, 10) : 0;

  try {
    const result = db.prepare(`
      INSERT INTO pneus (
        veiculo_id, posicao, filial_id, marca, modelo, medida, dot, numero_fogo,
        tipo_pneu, condicao, vida_recap, sulco_inicial_mm, status_pneu, ativo, observacoes
      ) VALUES (NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'estoque', 1, ?)
    `).run(
      filialId,
      marca?.trim() || null,
      modelo?.trim() || null,
      medida?.trim() || null,
      dot?.trim() || null,
      fogo,
      tipo,
      cond,
      Number.isFinite(vida) ? vida : 0,
      sulco_inicial_mm != null ? parseFloat(sulco_inicial_mm) : null,
      observacoes?.trim() || null
    );

    const pneu = db.prepare('SELECT * FROM pneus WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({
      mensagem: 'Pneu cadastrado no estoque',
      pneu: enriquecerPneu(pneu),
    });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ erro: 'Já existe um pneu com este nº de fogo na filial' });
    }
    throw err;
  }
});

router.get('/:id', (req, res) => {
  const pneu = assertPneuDaFilial(req.params.id, filialScopeId(req));
  if (!pneu) return res.status(404).json({ erro: 'Pneu não encontrado' });

  const db = getDb();
  const limites = getLimites();
  const medicoes = db.prepare(`
    SELECT * FROM medicoes
    WHERE pneu_id = ?
    ORDER BY data_medicao DESC, id DESC
    LIMIT 50
  `).all(req.params.id);

  const medicoesComStatus = medicoes.map((m) => {
    const menor = menorSulco(m);
    const diag = diagnosticarPerfil(m, limites.diagnostico_tolerancia_mm);
    return {
      ...m,
      menor_sulco: menor,
      status_sulco: classificarSulco(menor),
      diagnostico_label: diag.label,
    };
  });

  const movimentacoes = db.prepare(`
    SELECT * FROM movimentacoes
    WHERE pneu_id = ?
    ORDER BY data_evento DESC, id DESC
    LIMIT 50
  `).all(req.params.id);

  const ultima = medicoes[0] || null;
  res.json({
    ...enriquecerPneu(pneu, ultima),
    medicoes: medicoesComStatus,
    movimentacoes,
  });
});

router.put('/:id', (req, res) => {
  const {
    marca, modelo, medida, dot, numero_fogo,
    tipo_pneu, condicao, vida_recap, sulco_inicial_mm,
    data_instalacao, km_instalacao, observacoes,
  } = req.body;

  const atual = assertPneuDaFilial(req.params.id, filialScopeId(req));
  if (!atual) return res.status(404).json({ erro: 'Pneu não encontrado' });

  const novaCondicao = condicao || atual.condicao;
  const novoTipo = tipo_pneu || atual.tipo_pneu;
  const fogo = numero_fogo != null ? String(numero_fogo).trim() : atual.numero_fogo;

  if (atual.posicao) {
    const validacao = validarMontagem({
      condicao: novaCondicao,
      tipo_pneu: novoTipo,
      posicao: atual.posicao,
    });
    if (!validacao.ok) {
      return res.status(400).json({ erro: validacao.erros.join(' '), avisos: validacao.avisos });
    }
  }

  const db = getDb();
  try {
    db.prepare(`
      UPDATE pneus SET
        marca = ?,
        modelo = ?,
        medida = ?,
        dot = ?,
        numero_fogo = ?,
        tipo_pneu = ?,
        condicao = ?,
        vida_recap = COALESCE(?, vida_recap),
        sulco_inicial_mm = COALESCE(?, sulco_inicial_mm),
        data_instalacao = COALESCE(?, data_instalacao),
        km_instalacao = COALESCE(?, km_instalacao),
        observacoes = ?
      WHERE id = ? AND ativo = 1
    `).run(
      marca?.trim() || null,
      modelo?.trim() || null,
      medida?.trim() || null,
      dot?.trim() || null,
      fogo || null,
      novoTipo,
      novaCondicao,
      vida_recap != null ? parseInt(vida_recap, 10) : null,
      sulco_inicial_mm != null ? parseFloat(sulco_inicial_mm) : null,
      data_instalacao || null,
      km_instalacao != null ? parseInt(km_instalacao, 10) : null,
      observacoes?.trim() || null,
      Number(req.params.id)
    );
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ erro: 'Já existe um pneu com este nº de fogo na filial' });
    }
    throw err;
  }

  const atualizado = db.prepare('SELECT * FROM pneus WHERE id = ?').get(req.params.id);
  res.json({
    mensagem: 'Pneu atualizado',
    pneu: enriquecerPneu(atualizado, ultimaMedicaoDoPneu(db, atualizado.id)),
  });
});

/** Monta pneu do estoque em uma posição do veículo */
router.post('/:id/montar', (req, res) => {
  const { veiculo_id, posicao, km_veiculo, data_evento } = req.body;
  if (!veiculo_id || !posicao) {
    return res.status(400).json({ erro: 'Informe veiculo_id e posicao' });
  }

  const filialId = filialScopeId(req);
  const pneu = assertPneuDaFilial(req.params.id, filialId);
  if (!pneu) return res.status(404).json({ erro: 'Pneu não encontrado' });

  if (pneu.status_pneu === 'descarte' || !pneu.ativo) {
    return res.status(400).json({ erro: 'Pneu descartado não pode ser montado' });
  }
  if (pneu.status_pneu === 'montado' && pneu.veiculo_id) {
    return res.status(400).json({
      erro: `Pneu já montado em ${pneu.placa || 'veículo'} (${pneu.posicao}). Desmonte antes.`,
    });
  }

  const veiculo = assertVeiculoDaFilial(veiculo_id, filialId);
  if (!veiculo) return res.status(404).json({ erro: 'Veículo não encontrado' });

  const layout = getLayout(veiculo.layout_pneus || LAYOUT_PADRAO);
  if (!layout.posicoes.includes(posicao)) {
    return res.status(400).json({
      erro: `Posição ${posicao} não faz parte do layout do veículo`,
    });
  }

  const validacao = validarMontagem({
    condicao: pneu.condicao,
    tipo_pneu: pneu.tipo_pneu,
    posicao,
  });
  if (!validacao.ok) {
    return res.status(400).json({ erro: validacao.erros.join(' '), avisos: validacao.avisos });
  }

  const db = getDb();
  const ocupado = db.prepare(`
    SELECT id, numero_fogo FROM pneus
    WHERE veiculo_id = ? AND posicao = ? AND ativo = 1 AND status_pneu = 'montado'
  `).get(veiculo_id, posicao);

  if (ocupado) {
    return res.status(409).json({
      erro: `Posição ${posicao} já tem pneu montado${ocupado.numero_fogo ? ` (fogo ${ocupado.numero_fogo})` : ''}. Desmonte antes.`,
    });
  }

  const data = data_evento || new Date().toISOString().split('T')[0];
  const km = km_veiculo != null ? parseInt(km_veiculo, 10) : veiculo.km_atual;

  db.prepare(`
    UPDATE pneus SET
      veiculo_id = ?,
      posicao = ?,
      filial_id = ?,
      status_pneu = 'montado',
      data_instalacao = ?,
      km_instalacao = COALESCE(?, km_instalacao),
      ativo = 1
    WHERE id = ?
  `).run(veiculo_id, posicao, filialId, data, km, pneu.id);

  db.prepare(`
    INSERT INTO movimentacoes (pneu_id, veiculo_id, tipo, data_evento, km_veiculo, posicao, detalhes)
    VALUES (?, ?, 'montagem', ?, ?, ?, ?)
  `).run(pneu.id, veiculo_id, data, km, posicao, `Montado em ${posicao}`);

  const atualizado = db.prepare('SELECT * FROM pneus WHERE id = ?').get(pneu.id);
  res.json({
    mensagem: `Pneu montado em ${labelPosicao(posicao)}`,
    avisos: validacao.avisos,
    pneu: enriquecerPneu(atualizado, ultimaMedicaoDoPneu(db, pneu.id)),
  });
});

/** Desmonta pneu → estoque */
router.post('/:id/desmontar', (req, res) => {
  const { km_veiculo, data_evento, detalhes } = req.body || {};
  const filialId = filialScopeId(req);
  const pneu = assertPneuDaFilial(req.params.id, filialId);
  if (!pneu) return res.status(404).json({ erro: 'Pneu não encontrado' });

  if (pneu.status_pneu !== 'montado' || !pneu.veiculo_id) {
    return res.status(400).json({ erro: 'Pneu não está montado' });
  }

  const db = getDb();
  const data = data_evento || new Date().toISOString().split('T')[0];
  const veiculoId = pneu.veiculo_id;
  const posicao = pneu.posicao;

  db.prepare(`
    UPDATE pneus SET
      veiculo_id = NULL,
      posicao = NULL,
      status_pneu = 'estoque',
      data_instalacao = NULL
    WHERE id = ?
  `).run(pneu.id);

  db.prepare(`
    INSERT INTO movimentacoes (pneu_id, veiculo_id, tipo, data_evento, km_veiculo, posicao, detalhes)
    VALUES (?, ?, 'desmontagem', ?, ?, ?, ?)
  `).run(
    pneu.id,
    veiculoId,
    data,
    km_veiculo != null ? parseInt(km_veiculo, 10) : null,
    posicao,
    detalhes?.trim() || 'Desmontado para estoque'
  );

  const atualizado = db.prepare('SELECT * FROM pneus WHERE id = ?').get(pneu.id);
  res.json({
    mensagem: 'Pneu desmontado e enviado ao estoque',
    pneu: enriquecerPneu(atualizado, ultimaMedicaoDoPneu(db, pneu.id)),
  });
});

router.post('/:id/evento', (req, res) => {
  const { tipo, data_evento, km_veiculo, hr_veiculo, detalhes, sulco_mm } = req.body;
  const tiposOk = ['troca', 'recap', 'descarte', 'montagem', 'desmontagem'];
  if (!tiposOk.includes(tipo)) {
    return res.status(400).json({ erro: `tipo deve ser: ${tiposOk.join(', ')}` });
  }

  const pneu = assertPneuDaFilial(req.params.id, filialScopeId(req));
  if (!pneu) return res.status(404).json({ erro: 'Pneu não encontrado' });

  const db = getDb();
  const limites = getLimites();
  const data = data_evento || new Date().toISOString().split('T')[0];

  if (tipo === 'recap') {
    const novaVida = (pneu.vida_recap || 0) + 1;
    if (novaVida > limites.max_recaps) {
      return res.status(400).json({
        erro: `Limite de recaps atingido (${limites.max_recaps}). Indique troca/descarte.`,
      });
    }
    // Recap: desmonta para estoque/recapagem com sulco renovado
    db.prepare(`
      UPDATE pneus SET
        vida_recap = ?,
        condicao = 'recapado',
        status_pneu = 'estoque',
        veiculo_id = NULL,
        posicao = NULL,
        sulco_inicial_mm = COALESCE(?, sulco_inicial_mm),
        data_instalacao = NULL,
        km_instalacao = COALESCE(?, km_instalacao)
      WHERE id = ?
    `).run(
      novaVida,
      sulco_mm != null ? parseFloat(sulco_mm) : limites.sulco_novo_mm,
      km_veiculo != null ? parseInt(km_veiculo, 10) : null,
      pneu.id
    );
  } else if (tipo === 'troca' || tipo === 'descarte') {
    db.prepare(`
      UPDATE pneus SET
        status_pneu = 'descarte',
        ativo = 0,
        veiculo_id = NULL,
        posicao = NULL,
        observacoes = COALESCE(observacoes || ' | ', '') || ?
      WHERE id = ?
    `).run(`${tipo} em ${data}`, pneu.id);
  } else if (tipo === 'desmontagem') {
    db.prepare(`
      UPDATE pneus SET status_pneu = 'estoque', veiculo_id = NULL, posicao = NULL
      WHERE id = ?
    `).run(pneu.id);
  } else if (tipo === 'montagem') {
    return res.status(400).json({ erro: 'Use POST /pneus/:id/montar para montar' });
  }

  const result = db.prepare(`
    INSERT INTO movimentacoes (pneu_id, veiculo_id, tipo, data_evento, km_veiculo, hr_veiculo, posicao, sulco_mm, detalhes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    pneu.id,
    pneu.veiculo_id,
    tipo,
    data,
    km_veiculo != null ? parseInt(km_veiculo, 10) : null,
    hr_veiculo != null ? parseFloat(hr_veiculo) : null,
    pneu.posicao,
    sulco_mm != null ? parseFloat(sulco_mm) : null,
    detalhes?.trim() || null
  );

  const atualizado = db.prepare('SELECT * FROM pneus WHERE id = ?').get(pneu.id);

  res.status(201).json({
    id: result.lastInsertRowid,
    mensagem: `Evento "${tipo}" registrado`,
    pneu: atualizado,
  });
});

export default router;
