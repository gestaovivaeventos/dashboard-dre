import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  agruparRpsIrmas,
  analisarRequisicao,
  isComissao,
  isFeeCerimonial,
  isPagamentoBvViva,
  type RequisitionDocument,
} from './validate'
import type { RequisitionInput } from './types'

test('isComissao casa as variações de comissão da descrição da RP', () => {
  for (const d of [
    'comissão comercial',
    'COMISSÃO PÓS VENDAS - PRODUÇÃO [2/2]',
    'COMISSÃO PÓS VENDAS - RELACIONAMENTO',
    'Comissao atendimento',
    'Comissões de produção set/26',
    'pagamento de comissão - relacionamento',
  ]) {
    assert.equal(isComissao(d), true, d)
  }
})

test('isComissao não casa descrições sem a palavra', () => {
  for (const d of [null, undefined, '', 'BAILE DE GALA - LUSTRES', 'DESLIGAMENTO_205411_TAIANA', 'comissionamento de obra', 'subcomissão']) {
    assert.equal(isComissao(d), false, String(d))
  }
})

test('isFeeCerimonial continua com a regra de palavra isolada', () => {
  assert.equal(isFeeCerimonial('FEE cerimonial'), true)
  assert.equal(isFeeCerimonial('coffee break'), false)
  assert.equal(isFeeCerimonial('feedback'), false)
})

// ── Fixtures ───────────────────────────────────────────────────────────────
function doc(over: Partial<RequisitionDocument> = {}): RequisitionDocument {
  return {
    tipo_documento: 'Contrato / Aditivo Contratual',
    fornecedor: null,
    cpf_cnpj: null,
    cpf_cnpj_todos: [],
    numero_documento: null,
    chave_acesso: null,
    conta: null,
    contas_todas: [],
    valor_contrato: null,
    valores_pagamentos: [],
    assinatura_contratante: 'Sim',
    assinatura_contratado: 'Sim',
    datas_vencimento: [],
    extraction_failed: false,
    ...over,
  }
}

function req(over: Partial<RequisitionInput> = {}): RequisitionInput {
  return {
    fornecedor: null,
    favorecido: null,
    cpf_cnpj: null,
    conta: null,
    valor: null,
    ...over,
  }
}

// RP 881517: contrato de 3.520 com sinal declarado de 500; a RP paga os 3.020
// restantes ("Saldo do valor do buffet"). Reprovava por "não corresponde a
// nenhuma parcela declarada" — pagar menos que o contrato é caso de saldo.
test('RP abaixo do contrato sem parcela de referência vai para verificar saldo', () => {
  const r = analisarRequisicao({
    requisicao_codigo: '881517',
    descricao: 'Saldo do valor do buffet',
    req: req({
      fornecedor: 'ROBERTA GOURMET LTDA',
      favorecido: 'ROBERTA GOURMET LTDA',
      cpf_cnpj: '29.896.570/0001-93',
      conta: '99493',
      valor: 3020,
    }),
    documentos: [
      doc({
        fornecedor: 'ROBERTA GOURMET LTDA',
        cpf_cnpj: '29.896.570/0001-93',
        cpf_cnpj_todos: ['29.896.570/0001-93'],
        valor_contrato: 3520,
        valores_pagamentos: [500],
      }),
    ],
  })
  assert.equal(r.status, 'verificar_saldo')
  assert.match(r.resumo, /saldo depois das parcelas declaradas/)
})

// RP 881764: documento imprime "00005081-3", a RP guarda "5081".
test('conta com zero à esquerda no documento confere com a conta da RP', () => {
  const r = analisarRequisicao({
    requisicao_codigo: '881764',
    descricao: 'PRÉ EVENTO (1/6) - CANECA COM TIRANTE',
    req: req({
      fornecedor: 'Brindes X',
      favorecido: 'Brindes X',
      cpf_cnpj: '73.130.551/0001-43',
      conta: '5081',
      valor: 1098.8,
    }),
    documentos: [
      doc({
        tipo_documento: 'Atas, Orçamentos, Ordens de Serviço',
        fornecedor: 'Brindes X',
        cpf_cnpj: '73.130.551/0001-43',
        cpf_cnpj_todos: ['73.130.551/0001-43'],
        conta: '00005081-3',
        contas_todas: ['00005081-3'],
        valor_contrato: 1098.8,
        valores_pagamentos: [1098.8],
      }),
    ],
  })
  assert.equal(r.status, 'aprovada', r.resumo)
})

// RPs 881714 (fornecedor) + 881716 (BV Viva) = parcela de 5.100.
const CONTRATO_I9 = () =>
  doc({
    fornecedor: 'I9 Buffet - Silvia Furst Fernandes da Silva',
    cpf_cnpj: '36.357.920/0001-09',
    cpf_cnpj_todos: ['36.357.920/0001-09'],
    conta: '99837-7',
    contas_todas: ['99837-7'],
    valor_contrato: 17000,
    valores_pagamentos: [5100, 11900],
    datas_vencimento: ['10/10/2026'],
  })

test('par de RPs que soma a parcela do contrato não é pagamento parcial', () => {
  const r = analisarRequisicao({
    requisicao_codigo: '881714',
    descricao:
      'Pagamento - parcela 1/2 - contrato pacote ( locação + buffet + bar ) do espaço para festa de X Dias - I9 Buffet - retirando BV Viva',
    irmas: [{ requisicao_codigo: '881716', valor: 1700 }],
    req: req({
      fornecedor: 'I9 Buffet - Silvia Furst Fernandes da Silva',
      favorecido: 'I9 Buffet - Silvia Furst Fernandes da Silva',
      cpf_cnpj: '36.357.920/0001-09',
      conta: '99837',
      valor: 3400,
    }),
    documentos: [CONTRATO_I9()],
  })
  assert.equal(r.status, 'aprovada_ressalva', r.resumo)
  assert.match(r.resumo, /Pagamento dividido/)
})

test('perna BV Viva do par não reprova por favorecido/conta da Viva', () => {
  const r = analisarRequisicao({
    requisicao_codigo: '881716',
    descricao:
      'Pagamento BV Viva - parcela 1/2 - contrato pacote ( locação + buffet + bar ) do espaço para festa de X Dias - I9 Buffet',
    irmas: [{ requisicao_codigo: '881714', valor: 3400 }],
    req: req({
      fornecedor: 'OLIVEIRA MEDEIROS FORMATURAS C. E E.',
      favorecido: 'OLIVEIRA MEDEIROS FORMATURAS C. E E.',
      cpf_cnpj: '19.666.747/0001-01',
      conta: '123642',
      valor: 1700,
    }),
    documentos: [CONTRATO_I9()],
  })
  assert.equal(r.status, 'aprovada_ressalva', r.resumo)
  assert.match(r.resumo, /BV Viva/)
})

test('RP sem irmã que fecha a parcela continua em verificar saldo', () => {
  const r = analisarRequisicao({
    requisicao_codigo: '881714',
    descricao:
      'Pagamento - parcela 1/2 - contrato pacote do espaço para festa de X Dias - I9 Buffet - retirando BV Viva',
    req: req({
      fornecedor: 'I9 Buffet - Silvia Furst Fernandes da Silva',
      favorecido: 'I9 Buffet - Silvia Furst Fernandes da Silva',
      cpf_cnpj: '36.357.920/0001-09',
      conta: '99837',
      valor: 3400,
    }),
    documentos: [CONTRATO_I9()],
  })
  assert.equal(r.status, 'verificar_saldo', r.resumo)
})

test('agruparRpsIrmas casa a RP do fornecedor com a do BV Viva', () => {
  const irmas = agruparRpsIrmas([
    {
      requisicao_codigo: '881714',
      descricao:
        'Pagamento - parcela 1/2 - contrato pacote ( locação + buffet + bar ) do espaço para festa de X Dias - I9 Buffet - retirando BV Viva',
      fundo: 'LUIZA TAITSON – PUCMPL – DIREIT – 2027.2 (PAC)',
      valor: 3400,
    },
    {
      requisicao_codigo: '881716',
      descricao:
        'Pagamento BV Viva - parcela 1/2 - contrato pacote ( locação + buffet + bar ) do espaço para festa de X Dias - I9 Buffet',
      fundo: 'LUIZA TAITSON – PUCMPL – DIREIT – 2027.2 (PAC)',
      valor: 1700,
    },
  ])
  assert.deepEqual(irmas.get('881714'), [{ requisicao_codigo: '881716', valor: 1700 }])
  assert.deepEqual(irmas.get('881716'), [{ requisicao_codigo: '881714', valor: 3400 }])
})

test('agruparRpsIrmas não junta parcelas diferentes nem fundos diferentes', () => {
  const irmas = agruparRpsIrmas([
    { requisicao_codigo: '871843', descricao: 'Pagamento - parcela 1/9 - contrato de buffet - Trigo Leve - retirando BV Viva', fundo: 'F1', valor: 24072.93 },
    { requisicao_codigo: '871844', descricao: 'Pagamento - parcela 2/9 - contrato de buffet - Trigo Leve - retirando BV Viva', fundo: 'F1', valor: 16048.62 },
    { requisicao_codigo: '999999', descricao: 'Pagamento - parcela 1/9 - contrato de buffet - Trigo Leve - retirando BV Viva', fundo: 'OUTRO FUNDO', valor: 10 },
  ])
  assert.equal(irmas.size, 0)
})

test('isPagamentoBvViva separa a perna BV da perna do fornecedor', () => {
  assert.equal(isPagamentoBvViva('Pagamento BV Viva - parcela 1/2 - contrato de bar'), true)
  assert.equal(isPagamentoBvViva('Pagamento BV - parcela 1/2 - contrato de decoração'), true)
  assert.equal(isPagamentoBvViva('Pagamento - parcela 1/2 - contrato de bar - retirando BV Viva'), false)
  assert.equal(isPagamentoBvViva('Pagamento - parcela única - rádios para equipe Viva'), false)
})
