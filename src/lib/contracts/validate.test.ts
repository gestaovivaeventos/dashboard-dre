import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isComissao, isFeeCerimonial } from './validate'

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
