/**
 * Utilitários CSV (separador ; ou ,) para importação de frota.
 */

export function parseCsv(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!raw) return { headers: [], rows: [] };

  const firstLine = raw.split(/\r?\n/).find((l) => l.trim() && !l.trim().startsWith('#')) || '';
  const sep = firstLine.includes(';') && !firstLine.split(';')[0].includes(',')
    ? ';'
    : (firstLine.includes(';') && firstLine.indexOf(';') < (firstLine.indexOf(',') === -1 ? 999 : firstLine.indexOf(','))
      ? ';'
      : ',');

  const lines = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if ((ch === '\n' || (ch === '\r' && next === '\n')) && !inQuotes) {
      if (ch === '\r') i++;
      lines.push(current);
      current = '';
      continue;
    }
    if (ch === '\r' && !inQuotes) {
      lines.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.length) lines.push(current);

  const splitLine = (line) => {
    const cells = [];
    let cell = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const next = line[i + 1];
      if (ch === '"') {
        if (q && next === '"') {
          cell += '"';
          i++;
        } else q = !q;
        continue;
      }
      if (ch === sep && !q) {
        cells.push(cell.trim());
        cell = '';
        continue;
      }
      cell += ch;
    }
    cells.push(cell.trim());
    return cells;
  };

  const usable = lines.filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (!usable.length) return { headers: [], rows: [], separator: sep };

  const headers = splitLine(usable[0]).map((h) => normalizeHeader(h));
  const rows = usable.slice(1).map((line, idx) => {
    const cells = splitLine(line);
    const obj = { __linha: idx + 2 };
    headers.forEach((h, i) => {
      if (!h) return;
      obj[h] = cells[i] ?? '';
    });
    return obj;
  }).filter((r) => Object.keys(r).some((k) => k !== '__linha' && String(r[k] || '').trim()));

  return { headers, rows, separator: sep };
}

function normalizeHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

export function toCsv(headers, rows, { separator = ';' } = {}) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    if (s.includes('"') || s.includes(separator) || s.includes('\n') || s.includes('\r')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [
    headers.join(separator),
    ...rows.map((r) => headers.map((h) => esc(r[h])).join(separator)),
  ];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export const VEICULO_TEMPLATE_HEADERS = [
  'placa',
  'apelido',
  'tipo',
  'layout_pneus',
  'marca',
  'modelo',
  'ano',
  'km_atual',
  'hr_atual',
  'observacoes',
];

export const VEICULO_TEMPLATE_ROWS = [
  {
    placa: 'ABC1D23',
    apelido: 'Compactador 01',
    tipo: 'Truck / Tração',
    layout_pneus: 'truck_10',
    marca: '',
    modelo: '',
    ano: '2020',
    km_atual: '10000',
    hr_atual: '200',
    observacoes: '',
  },
  {
    placa: 'DEF2G45',
    apelido: 'Toco Oficina',
    tipo: 'Toco / Mini',
    layout_pneus: 'toco_6',
    marca: '',
    modelo: '',
    ano: '2018',
    km_atual: '5000',
    hr_atual: '100',
    observacoes: '',
  },
];

export const PNEU_TEMPLATE_HEADERS = [
  'numero_fogo',
  'tipo_pneu',
  'condicao',
  'vida_recap',
  'marca',
  'modelo',
  'medida',
  'dot',
  'sulco_inicial_mm',
  'observacoes',
];

export const PNEU_TEMPLATE_ROWS = [
  {
    numero_fogo: 'F-1001',
    tipo_pneu: 'direcional',
    condicao: 'novo',
    vida_recap: '0',
    marca: 'Michelin',
    modelo: '',
    medida: '275/80R22.5',
    dot: ' vic 2024',
    sulco_inicial_mm: '16',
    observacoes: '',
  },
  {
    numero_fogo: 'F-2002',
    tipo_pneu: 'misto',
    condicao: 'recapado',
    vida_recap: '1',
    marca: 'Goodyear',
    modelo: '',
    medida: '275/80R22.5',
    dot: '',
    sulco_inicial_mm: '14',
    observacoes: '',
  },
];

/** Corrige typo no template de exemplo */
PNEU_TEMPLATE_ROWS[0].dot = '1224';

export function mapLayoutId(raw, tipo) {
  const v = String(raw || '').trim().toLowerCase();
  const aliases = {
    truck_10: 'truck_10',
    truck10: 'truck_10',
    '10': 'truck_10',
    '2+4+4': 'truck_10',
    truck_8: 'truck_8',
    truck8: 'truck_8',
    '8': 'truck_8',
    '2+4+2': 'truck_8',
    truck_8_b: 'truck_8_b',
    truck8b: 'truck_8_b',
    '8b': 'truck_8_b',
    '2+2+4': 'truck_8_b',
    toco_6: 'toco_6',
    toco: 'toco_6',
    mini: 'toco_6',
    '6': 'toco_6',
  };
  if (v && aliases[v]) return aliases[v];
  if (v && aliases[v.replace(/\s+/g, '')]) return aliases[v.replace(/\s+/g, '')];

  const t = String(tipo || '').toLowerCase();
  if (t.includes('toco') || t.includes('mini')) return 'toco_6';
  return 'truck_10';
}

export function mapTipoPneu(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v.startsWith('dir')) return 'direcional';
  if (v.startsWith('mis') || v === 'tracao' || v === 'tração') return 'misto';
  return v === 'direcional' ? 'direcional' : 'misto';
}

export function mapCondicao(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v.startsWith('rec')) return 'recapado';
  return 'novo';
}
