/**
 * Comandos naturais do WhatsApp (sem menu).
 * Não grava nada — só interpreta o texto.
 */
function norm(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim();
}

const RE_DESC = /^(descarte|descartar|descarta|lixo|sucata|sucatear|desc)$/;
const RE_RECAP = /^(recap|recapagem|recapar|recape|recapeamento|rec)$/;
const RE_EST = /^(estoque|stock|desmontar|desmonta|estq|est)$/;
const RE_ONDE = /^(onde|localizar|localiza|achar|acha|encontrar|cad[eê]|status|situacao)$/;
const RE_TROCA = /^(trocar|troca|substituir|substitui|subst)$/;
const RE_CAD = /^(cadastrar|cadastro|cadastre|cadastra|cad)$/;
const RE_PNEU = /^(pneu|pneus|tire)$/;
const RE_LIXO = /^(pneu|por|pelo|pela|pro|pra|para|ao|a|o|um|uma|do|da|de|no|na|com|em|este|essa|esse|foi|vai|enviar|envie|manda|mandar|o|os)$/;

const TIPOS_CADASTRO_VEICULO = [
  [/^(caminhao|truck|tracao)$/, 'Truck / Tração'],
  [/^(trator|tratores)$/, 'Trator'],
  [/^(toco|mini)$/, 'Toco / Mini'],
  [/^(compactador|compactadora)$/, 'Compactador'],
  [/^(utilitario|varredeira)$/, 'Utilitário / Varredeira'],
  [/^(veiculo|veiculos)$/, null],
];

function parseCadastrar(parts) {
  const iCad = parts.findIndex((p) => RE_CAD.test(p));
  const semCad = parts.filter((_, i) => i !== iCad);
  const iPneu = semCad.findIndex((p) => RE_PNEU.test(p));
  if (iPneu >= 0) {
    const resto = semCad.filter((_, i) => i !== iPneu);
    const fogos = fogosDe(resto);
    return { tipo: 'cadastrar_pneu', fogo: fogos[0] || null };
  }

  let tipoVeiculo;
  let iTipo = -1;
  for (let i = 0; i < semCad.length; i += 1) {
    for (const [re, tipo] of TIPOS_CADASTRO_VEICULO) {
      if (re.test(semCad[i])) {
        tipoVeiculo = tipo;
        iTipo = i;
        break;
      }
    }
    if (iTipo >= 0) break;
  }

  const placaParts = semCad.filter((_, i) => i !== iTipo);
  const placa = placaParts.join('') || null;
  return {
    tipo: 'cadastrar_veiculo',
    placa: placa && /[0-9]/.test(placa) ? placa.toUpperCase() : null,
    tipoVeiculo: tipoVeiculo === undefined ? null : tipoVeiculo,
  };
}

function pareceTokenFogo(t) {
  const s = String(t || '').trim();
  if (!s || s.length < 2 || s.length > 24) return false;
  if (!/[0-9]/.test(s)) return false;
  if (!/^[a-z0-9][a-z0-9\-_./]*$/i.test(s)) return false;
  if (/^[0-9]+$/.test(s) && s.length < 3) return false;
  if (RE_DESC.test(s) || RE_RECAP.test(s) || RE_EST.test(s) || RE_ONDE.test(s) || RE_TROCA.test(s)) {
    return false;
  }
  if (RE_LIXO.test(s)) return false;
  return true;
}

function tokensDe(texto) {
  const n = norm(texto)
    .replace(/[^\p{L}\p{N}\-_./]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return n ? n.split(' ') : [];
}

function fogosDe(parts) {
  return parts.filter((p) => pareceTokenFogo(p));
}

/**
 * @returns {{ tipo: string, fogo?: string, fogo2?: string, placa?: string|null, tipoVeiculo?: string|null } | null}
 */
export function parseComandoNatural(texto) {
  const parts = tokensDe(texto);
  if (!parts.length) return null;

  if (parts.some((p) => RE_CAD.test(p))) {
    return parseCadastrar(parts);
  }

  if (parts.length < 2) return null;

  const fogos = fogosDe(parts);
  const iTroca = parts.findIndex((p) => RE_TROCA.test(p));
  const iPor = parts.findIndex((p) => p === 'por' || p === 'pelo' || p === 'pela');

  if (iTroca >= 0 && fogos.length >= 2) {
    return { tipo: 'troca', fogo: fogos[0], fogo2: fogos[1] };
  }
  if (iTroca >= 0 && fogos.length === 1) {
    return { tipo: 'troca', fogo: fogos[0] };
  }
  if (iPor > 0 && iTroca >= 0 && pareceTokenFogo(parts[iPor - 1]) && pareceTokenFogo(parts[iPor + 1])) {
    return { tipo: 'troca', fogo: parts[iPor - 1], fogo2: parts[iPor + 1] };
  }

  if (!fogos.length) return null;

  if (parts.some((p) => RE_ONDE.test(p))) {
    return { tipo: 'onde', fogo: fogos[0] };
  }
  if (parts.some((p) => RE_DESC.test(p))) {
    return { tipo: 'descarte', fogo: fogos[0] };
  }
  if (parts.some((p) => RE_RECAP.test(p))) {
    return { tipo: 'recap', fogo: fogos[0] };
  }
  if (parts.some((p) => RE_EST.test(p))) {
    return { tipo: 'estoque', fogo: fogos[0] };
  }
  return null;
}

export function pareceComandoNatural(texto) {
  return parseComandoNatural(texto) != null;
}
