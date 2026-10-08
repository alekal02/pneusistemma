/**
 * Pré-cadastro WhatsApp + dedup por ID de mensagem (PGlite isolado).
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseComandoNatural } from '../src/services/whatsapp-comandos.js';

const ROOT = 'C:/Projetos/pneusistemma';
const BACKEND = path.join(ROOT, 'backend');
const PGLITE_DIR = 'C:/Users/Sistemma/AppData/Local/Temp/pneu-pglite2';
const PG_PORT = 55436;
const toFileUrl = (p) => pathToFileURL(p).href;

let oks = 0;
let fails = 0;
const falhas = [];

function log(ok, rotulo, extra = '') {
  if (ok) oks += 1;
  else {
    fails += 1;
    falhas.push(extra ? `${rotulo} → ${extra}` : rotulo);
  }
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${rotulo}${extra ? ` → ${extra}` : ''}`);
}

async function iniciarPglite() {
  const pglitePkg = path.join(PGLITE_DIR, 'node_modules/@electric-sql/pglite');
  const socketPkg = path.join(PGLITE_DIR, 'node_modules/@electric-sql/pglite-socket');
  const { PGlite } = await import(toFileUrl(path.join(pglitePkg, 'dist/index.js')));
  const { PGLiteSocketServer } = await import(toFileUrl(path.join(socketPkg, 'dist/index.js')));
  const db = await PGlite.create();
  const server = new PGLiteSocketServer({ db, port: PG_PORT, host: '127.0.0.1', maxConnections: 10 });
  await server.start();
  return { db, server };
}

function eqParse(texto, esperado) {
  const r = parseComandoNatural(texto);
  if (!esperado) return r == null;
  if (!r) return false;
  return Object.entries(esperado).every(([k, v]) => r[k] === v);
}

async function ultimaMsg(db, phone) {
  return db.prepare(`
    SELECT mensagem FROM notificacoes_whatsapp
    WHERE destinatario_whatsapp LIKE ?
    ORDER BY id DESC LIMIT 1
  `).get(`%${phone}%`);
}

async function main() {
  log(eqParse('cadastrar caminhão ABC1D23', {
    tipo: 'cadastrar_veiculo', placa: 'ABC1D23', tipoVeiculo: 'Truck / Tração',
  }), 'Parse: cadastrar caminhão ABC1D23');
  log(eqParse('cadastrar trator TR-015', {
    tipo: 'cadastrar_veiculo', placa: 'TR-015', tipoVeiculo: 'Trator',
  }), 'Parse: cadastrar trator TR-015');
  log(eqParse('cadastrar veículo ABC1D23', {
    tipo: 'cadastrar_veiculo', placa: 'ABC1D23', tipoVeiculo: null,
  }), 'Parse: cadastrar veículo ABC1D23');
  log(eqParse('cadastrar pneu 10700050', {
    tipo: 'cadastrar_pneu', fogo: '10700050',
  }), 'Parse: cadastrar pneu 10700050');
  log(eqParse('10700002 descarte', { tipo: 'descarte', fogo: '10700002' }), 'Parse: descarte anterior intacto');
  log(eqParse('1E 14,14,14', null), 'Parse: medição NÃO é cadastro');

  process.env.DATABASE_URL = `postgresql://postgres@127.0.0.1:${PG_PORT}/postgres`;
  process.env.DATABASE_SSL = 'false';
  process.env.NODE_ENV = 'development';
  process.env.WUZAPI_BASE_URL = 'http://127.0.0.1:9';
  process.env.WHATSAPP_ALERTAS_ENABLED = 'false';
  process.env.JWT_SECRET = 'cadastro-wa';
  process.env.FRONTEND_URL = 'https://app.pneusistemma.test';
  delete process.env.PNEU_TEST_FALHAR_TX;

  const pglite = await iniciarPglite();
  const { mensagemDuplicada } = await import(toFileUrl(path.join(BACKEND, 'src/routes/webhook.js')));
  log(mensagemDuplicada({ id: 'mid-1', filialId: 1, body: '1' }) === false, 'Dedup webhook: 1ª mensagem com ID');
  log(mensagemDuplicada({ id: 'mid-1', filialId: 1, body: '1' }) === true, 'Dedup webhook: mesmo ID bloqueia');
  log(mensagemDuplicada({ id: 'mid-2', filialId: 1, body: '1' }) === false, 'Dedup webhook: mesmo texto, outro ID passa');

  const { initDatabase, getDb, closePool } = await import(toFileUrl(path.join(BACKEND, 'src/database.js')));
  const ops = await import(toFileUrl(path.join(BACKEND, 'src/services/whatsapp-ops.js')));
  const { processarMensagemMenu, textoMenu } = await import(toFileUrl(path.join(BACKEND, 'src/services/whatsapp-menu.js')));
  const { obterSessao } = await import(toFileUrl(path.join(BACKEND, 'src/services/whatsapp-sessao.js')));
  const ar = await import(toFileUrl(path.join(BACKEND, 'src/services/acesso-rapido.js')));

  log(/1️⃣ Medir pneu/.test(textoMenu()) && /9️⃣ Frota/.test(textoMenu()), 'Menu 1–9 inalterado');

  await initDatabase();
  const db = getDb();
  const filialId = (await db.prepare(`SELECT id FROM filiais WHERE codigo = 'MATRIZ'`).get()).id;
  await db.prepare(`INSERT INTO filiais (nome, codigo, ativo) VALUES (?, ?, 1)`).run('Londrina Teste', 'LDT');
  const outra = await db.prepare(`SELECT id FROM filiais WHERE codigo = 'LDT'`).get();

  let phoneSeq = 11980000000;
  let msgSeq = 0;
  async function falar(texto, { phone, mensagemId } = {}) {
    const p = phone || String((phoneSeq += 1));
    const id = mensagemId === undefined ? `m-${(msgSeq += 1)}` : mensagemId;
    const r = await processarMensagemMenu({
      filialId, phone: p, destino: p, chatJid: '', texto, mensagemId: id,
    });
    const sessao = await obterSessao(filialId, p, '');
    const notif = await ultimaMsg(db, p);
    return { r, phone: p, sessao, msg: notif?.mensagem || '' };
  }

  const pre = await falar('cadastrar caminhão ABC1D23');
  log(pre.sessao?.passo === 'confirma', 'Pré-cadastro: pede confirmação');
  log(!(await ops.buscarPlacaFilial(filialId, 'ABC1D23')), 'Antes do sim: veículo ainda não existe');

  const cancel = await falar('cadastrar trator TR-015');
  await processarMensagemMenu({
    filialId, phone: cancel.phone, destino: cancel.phone, chatJid: '', texto: '0', mensagemId: `m-${(msgSeq += 1)}`,
  });
  log(!(await ops.buscarPlacaFilial(filialId, 'TR015')) && !(await ops.buscarPlacaFilial(filialId, 'TR-015')),
    'Cancelamento: nada gravado');

  const okPre = await falar('cadastrar caminhão ABC1D23');
  await processarMensagemMenu({
    filialId, phone: okPre.phone, destino: okPre.phone, chatJid: '', texto: '1', mensagemId: `m-${(msgSeq += 1)}`,
  });
  const veiculo = await ops.buscarPlacaFilial(filialId, 'ABC1D23');
  const msgOk = (await ultimaMsg(db, okPre.phone))?.mensagem || '';
  log(veiculo && Number(veiculo.cadastro_completo) === 0, 'Pré-cadastro: veículo incompleto gravado');
  log(
    /Pré-cadastro realizado/.test(msgOk)
      && /ABC1D23/.test(msgOk)
      && /acesso-rapido\/veiculo\?token=/.test(msgOk)
      && /só estará disponível para operações/.test(msgOk),
    'Mensagem de pré-cadastro com link'
  );

  const frota = await ops.listarFrota(filialId);
  log(!frota.some((v) => v.placa === 'ABC1D23'), 'Incompleto não entra na frota operacional');

  const pEst = await ops.criarPneuEstoque(filialId, {
    numero_fogo: 'MATRIZ-10990001', modelo: 'X', tipo_pneu: 'misto', condicao: 'novo',
  });
  let montouIncompleto = false;
  try {
    await ops.montarPneu({
      filialId, pneuId: pEst.id, veiculoId: veiculo.id, posicao: '1E',
    });
    montouIncompleto = true;
  } catch (err) {
    log(/pré-cadastro/i.test(err.message), 'Montagem em incompleto recusada');
  }
  if (montouIncompleto) log(false, 'Montagem em incompleto recusada');

  const dup = await falar('cadastrar caminhão ABC1D23');
  log(
    dup.r.handled === true
      && !dup.sessao
      && /já/.test(dup.msg),
    'Duplicidade: não cria segundo veículo'
  );
  const nPlaca = await db.prepare(`SELECT COUNT(*) as n FROM veiculos WHERE placa = 'ABC1D23'`).get();
  log(Number(nPlaca.n) === 1, 'Duplicidade: uma linha na tabela');

  const tokRow = await db.prepare(`
    SELECT * FROM tokens_acesso_rapido
    WHERE veiculo_id = ? AND tipo = 'cadastrar_veiculo'
    ORDER BY id DESC LIMIT 1
  `).get(veiculo.id);
  log(Boolean(tokRow?.token) && Number(tokRow.filial_id) === Number(filialId), 'Token vinculado à filial e ao veículo');

  const valido = await ar.validarTokenAcessoRapido(tokRow.token, ['cadastrar_veiculo']);
  log(Boolean(valido) && Number(valido.filial_id) === Number(filialId), 'Link válido: token aceito');

  await db.prepare(`
    UPDATE tokens_acesso_rapido SET expira_em = NOW() - INTERVAL '1 hour' WHERE id = ?
  `).run(tokRow.id);
  log((await ar.validarTokenAcessoRapido(tokRow.token, ['cadastrar_veiculo'])) == null, 'Link expirado recusado');

  const { token: tokNovo } = await ar.gerarTokenAcessoRapido({
    tipo: 'cadastrar_veiculo',
    veiculoId: veiculo.id,
    filialId,
    whatsappOrigem: '11980000999',
  });
  const { token: tokOutra } = await ar.gerarTokenAcessoRapido({
    tipo: 'cadastrar_veiculo',
    veiculoId: veiculo.id,
    filialId: outra.id,
    whatsappOrigem: '11980000998',
  });
  log((await ar.validarTokenAcessoRapido(tokOutra, ['cadastrar_veiculo'])) == null, 'Token de outra filial recusado');

  let completouOutra = false;
  try {
    await ops.completarVeiculo(outra.id, veiculo.id, {
      marca: 'Mercedes', modelo: 'Atego', layout_pneus: 'truck_10',
    });
    completouOutra = true;
  } catch (err) {
    log(/não encontrado/i.test(err.message), 'Conclusão web: outra filial não altera o veículo');
  }
  if (completouOutra) log(false, 'Conclusão web: outra filial não altera o veículo');

  const done = await ops.completarVeiculo(filialId, veiculo.id, {
    marca: 'Mercedes', modelo: 'Atego', tipo: 'Truck / Tração', layout_pneus: 'truck_10', km_atual: 1000,
  });
  const veiculoOk = await db.prepare(`SELECT * FROM veiculos WHERE id = ?`).get(veiculo.id);
  log(
    Number(veiculoOk.cadastro_completo) === 1
      && veiculoOk.modelo === 'Atego'
      && veiculoOk.marca === 'Mercedes'
      && done.total_posicoes > 0,
    'Conclusão web: veículo operacional'
  );
  const frota2 = await ops.listarFrota(filialId);
  log(frota2.some((v) => v.placa === 'ABC1D23'), 'Após concluir: aparece na frota');

  await ops.montarPneu({ filialId, pneuId: pEst.id, veiculoId: veiculo.id, posicao: '1E' });
  log((await db.prepare(`SELECT status_pneu FROM pneus WHERE id = ?`).get(pEst.id)).status_pneu === 'montado',
    'Após concluir: montagem permitida');

  await ar.marcarTokenUsado((await db.prepare(`
    SELECT id FROM tokens_acesso_rapido WHERE token = ?
  `).get(tokNovo)).id);
  log((await ar.validarTokenAcessoRapido(tokNovo, ['cadastrar_veiculo'])) == null, 'Token usado não reabre o cadastro');

  const pneuPre = await falar('cadastrar pneu 10700050');
  await processarMensagemMenu({
    filialId, phone: pneuPre.phone, destino: pneuPre.phone, chatJid: '', texto: '1', mensagemId: `m-${(msgSeq += 1)}`,
  });
  const pneuInc = await db.prepare(`
    SELECT * FROM pneus WHERE filial_id = ? AND cadastro_completo = 0
    ORDER BY id DESC LIMIT 1
  `).get(filialId);
  log(pneuInc && Number(pneuInc.cadastro_completo) === 0, 'Pré-cadastro de pneu incompleto');
  const est = await ops.listarEstoque(filialId, 50);
  log(!est.some((p) => p.id === pneuInc.id), 'Pneu incompleto fora do estoque operacional');

  const pneuDone = await ops.completarPneu(filialId, pneuInc.id, {
    marca: 'Michelin', modelo: 'X Multi D', tipo_pneu: 'misto', condicao: 'novo', sulco_inicial_mm: 14,
  });
  log(Number(pneuDone.cadastro_completo) === 1 && pneuDone.modelo === 'X Multi D', 'Conclusão web do pneu');

  const d1 = await processarMensagemMenu({
    filialId, phone: '11980001111', destino: '11980001111', chatJid: '', texto: '1', mensagemId: 'same-id',
  });
  const d2 = await processarMensagemMenu({
    filialId, phone: '11980001112', destino: '11980001112', chatJid: '', texto: '1', mensagemId: 'same-id',
  });
  const d3 = await processarMensagemMenu({
    filialId, phone: '11980001113', destino: '11980001113', chatJid: '', texto: '1', mensagemId: 'other-id',
  });
  log(d1.handled === true && d1.duplicado !== true, 'Dedup menu: 1ª confirmação com ID passa');
  log(d2.duplicado === true, 'Dedup menu: mesmo ID bloqueia');
  log(d3.handled === true && d3.duplicado !== true, 'Dedup menu: outro ID com o mesmo texto passa');

  const tipoAsk = await falar('cadastrar veículo ZZ9Z99');
  log(tipoAsk.sessao?.passo === 'tipo', 'Cadastrar veículo sem tipo pede o tipo');

  await closePool();
  try { await pglite.server?.stop?.(); } catch { /* ignore */ }

  console.log('');
  console.log(`CADASTRO ${oks} OK / ${fails} FAIL`);
  if (falhas.length) {
    console.log('FALHAS:');
    for (const f of falhas) console.log(' -', f);
  }
  process.exit(fails ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
