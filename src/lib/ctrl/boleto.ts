// Validação de linha digitável de boleto.
// - Bancário: 47 dígitos (3 campos com DV mod10 + DV geral mod11 do código de barras).
// - Arrecadação/concessionária: 48 dígitos (4 blocos de 12, DV mod10 ou mod11
//   conforme o identificador de valor — 3º dígito).
// Retorna true quando os dígitos verificadores conferem.

function onlyDigits(s: string): string {
  return (s ?? "").replace(/\D/g, "");
}

function mod10(num: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    let p = Number(num[i]) * weight;
    if (p > 9) p = Math.floor(p / 10) + (p % 10);
    sum += p;
    weight = weight === 2 ? 1 : 2;
  }
  const r = sum % 10;
  return r === 0 ? 0 : 10 - r;
}

// DV geral (mod11) do código de barras bancário. Resultado 0, 10 ou 11 → DV 1.
function mod11Bancario(barcode43: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = barcode43.length - 1; i >= 0; i--) {
    sum += Number(barcode43[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const dv = 11 - (sum % 11);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

// DV mod11 de bloco de arrecadação. Resultado 10 ou 11 → DV 0.
function mod11Arrecadacao(base: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    sum += Number(base[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const dv = 11 - (sum % 11);
  return dv >= 10 ? 0 : dv;
}

function validarBancario(linha: string): boolean {
  const campo1 = linha.slice(0, 10); // 9 + DV
  const campo2 = linha.slice(10, 21); // 10 + DV
  const campo3 = linha.slice(21, 32); // 10 + DV
  if (mod10(campo1.slice(0, 9)) !== Number(campo1[9])) return false;
  if (mod10(campo2.slice(0, 10)) !== Number(campo2[10])) return false;
  if (mod10(campo3.slice(0, 10)) !== Number(campo3[10])) return false;

  const dvGeral = Number(linha[32]);
  const fatorValor = linha.slice(33); // 14 dígitos
  const banco = linha.slice(0, 3);
  const moeda = linha[3];
  // Campo livre (25): campo1[4..8] + campo2[0..9] + campo3[0..9].
  const campoLivre = campo1.slice(4, 9) + campo2.slice(0, 10) + campo3.slice(0, 10);
  const barcode43 = banco + moeda + fatorValor + campoLivre; // 3+1+14+25 = 43 (sem o DV)
  return mod11Bancario(barcode43) === dvGeral;
}

function validarArrecadacao(linha: string): boolean {
  const id = linha[2]; // identificador de valor: 6/7 → mod10 ; 8/9 → mod11
  const useMod10 = id === "6" || id === "7";
  for (let i = 0; i < 4; i++) {
    const bloco = linha.slice(i * 12, i * 12 + 12);
    const base = bloco.slice(0, 11);
    const dv = Number(bloco[11]);
    const calc = useMod10 ? mod10(base) : mod11Arrecadacao(base);
    if (calc !== dv) return false;
  }
  return true;
}

/** True quando a linha digitável tem DVs válidos (boleto bancário ou arrecadação). */
export function isValidBoletoLinhaDigitavel(input: string): boolean {
  const d = onlyDigits(input);
  if (d.length === 47) return validarBancario(d);
  if (d.length === 48) return validarArrecadacao(d);
  return false;
}

// Converte o código de barras BANCÁRIO (44 dígitos) na linha digitável (47).
// Os DVs mod10 dos 3 campos são recalculados; o DV geral (mod11) vem embutido no
// código de barras (posição 5), então validar a linha resultante confere a
// integridade da leitura do código de barras. Arrecadação (inicia em 8) → null.
export function barcodeToLinhaDigitavel(input: string): string | null {
  const b = onlyDigits(input);
  if (b.length !== 44) return null;
  if (b[0] === "8") return null; // arrecadação: conversão diferente, sem ganho de validação

  const banco = b.slice(0, 3);
  const moeda = b.slice(3, 4);
  const dvGeral = b.slice(4, 5);
  const fatorValor = b.slice(5, 19); // fator vencimento (4) + valor (10) = 14
  const campoLivre = b.slice(19, 44); // 25

  const c1 = banco + moeda + campoLivre.slice(0, 5); // 9
  const c2 = campoLivre.slice(5, 15); // 10
  const c3 = campoLivre.slice(15, 25); // 10

  const campo1 = c1 + mod10(c1);
  const campo2 = c2 + mod10(c2);
  const campo3 = c3 + mod10(c3);

  return campo1 + campo2 + campo3 + dvGeral + fatorValor; // 10+11+11+1+14 = 47
}
