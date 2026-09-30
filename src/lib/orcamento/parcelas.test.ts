// Parcelas e período de uma despesa da prévia.
//
// O caso que motivou o módulo é o do PESSOAL: alguém admitido em maio tem oito
// parcelas, não doze, e o valor do ano sozinho escondia isso de quem valida.

import test from "node:test";
import assert from "node:assert/strict";

import { resumirParcelas, textoParcelas, textoParcelasDeMeses } from "./parcelas";

/** 12 meses com o mesmo valor. */
const cheio = (v: number) => Array<number>(12).fill(v);
/** Valor nos meses indicados (1..12), zero no resto. */
function nosMeses(valor: number, ...meses: number[]): number[] {
  const out = Array<number>(12).fill(0);
  for (const m of meses) out[m - 1] = valor;
  return out;
}

test("salário do ano inteiro: 12 parcelas de jan a dez", () => {
  // O caso da tela: Luizinho, R$ 3.800 × 12 = R$ 45.600.
  assert.equal(textoParcelasDeMeses(cheio(3800)), "12 parcelas · jan–dez");
});

test("admitido em maio: 8 parcelas, e o período diz de quando", () => {
  const meses = [0, 0, 0, 0, 3800, 3800, 3800, 3800, 3800, 3800, 3800, 3800];
  const r = resumirParcelas(meses);
  assert.deepEqual(r, { parcelas: 8, inicio: 5, fim: 12, contiguo: true });
  assert.equal(textoParcelas(r), "8 parcelas · mai–dez");
});

test("desligado em fevereiro", () => {
  assert.equal(textoParcelasDeMeses(nosMeses(3800, 1, 2)), "2 parcelas · jan–fev");
});

test("pagamento único NÃO vira intervalo", () => {
  assert.equal(textoParcelasDeMeses(nosMeses(12000, 3)), "1 parcela · mar");
});

test("singular e plural", () => {
  assert.match(textoParcelasDeMeses(nosMeses(1, 7)) ?? "", /^1 parcela ·/);
  assert.match(textoParcelasDeMeses(nosMeses(1, 7, 8)) ?? "", /^2 parcelas ·/);
});

test("meses alternados: a contagem denuncia o buraco", () => {
  // Trimestral: jan, abr, jul, out.
  const r = resumirParcelas(nosMeses(5000, 1, 4, 7, 10));
  assert.equal(r.parcelas, 4);
  assert.equal(r.contiguo, false, "há mês vazio entre o início e o fim");
  // 4 parcelas num intervalo de 10 meses — quem lê vê que não é mensal.
  assert.equal(textoParcelas(r), "4 parcelas · jan–out");
});

test("13º em nov e dez", () => {
  assert.equal(textoParcelasDeMeses(nosMeses(1900, 11, 12)), "2 parcelas · nov–dez");
});

test("poeira de arredondamento NÃO conta como parcela", () => {
  // O motor do pessoal deixa fração de centavo em meses em que a pessoa nem
  // estava na empresa; contá-la faria a linha dizer "12 parcelas · jan–dez".
  const meses = [0.001, -0.002, 0, 0, 3800, 3800, 3800, 3800, 3800, 3800, 3800, 3800];
  assert.equal(textoParcelasDeMeses(meses), "8 parcelas · mai–dez");
});

test("um centavo de verdade CONTA", () => {
  // O corte é meio centavo: R$ 0,01 é valor, não poeira.
  assert.equal(resumirParcelas(nosMeses(0.01, 6)).parcelas, 1);
});

test("valor negativo conta como parcela", () => {
  // Estorno é movimento; sumir com ele esconderia o que compõe o total.
  assert.equal(resumirParcelas(nosMeses(-500, 9)).parcelas, 1);
});

test("sem nada lançado não ganha legenda", () => {
  assert.equal(textoParcelasDeMeses(cheio(0)), null);
  assert.equal(textoParcelasDeMeses([]), null);
  assert.equal(textoParcelasDeMeses(null), null);
  assert.equal(textoParcelasDeMeses(undefined), null);
});

test("array maior que 12 é cortado; menor não quebra", () => {
  assert.equal(textoParcelasDeMeses([...cheio(100), 999, 999]), "12 parcelas · jan–dez");
  assert.equal(textoParcelasDeMeses([100, 100]), "2 parcelas · jan–fev");
});

test("valor não numérico é ignorado em vez de derrubar", () => {
  const meses = [Number.NaN, 100, Number.POSITIVE_INFINITY, 100] as number[];
  assert.equal(resumirParcelas(meses).parcelas, 2);
});
