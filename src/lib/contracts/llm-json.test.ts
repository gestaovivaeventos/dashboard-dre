import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseLlmJson } from './llm-json'

test('JSON puro parseia direto', () => {
  assert.deepEqual(parseLlmJson('{"a":1}'), { a: 1 })
})

test('eco do response_format antes do JSON real (RP 880709)', () => {
  const raw = '{"type":"json_object"}\n{"tipo_documento":"Boleto","favorecido":{"nome":"X"},"valor_contrato":"10.00"}'
  assert.deepEqual(parseLlmJson(raw), {
    tipo_documento: 'Boleto',
    favorecido: { nome: 'X' },
    valor_contrato: '10.00',
  })
})

test('cerca de markdown em volta do JSON', () => {
  const raw = '```json\n{"tipo_documento":"Boleto","x":{"y":[1,2]}}\n```'
  assert.deepEqual(parseLlmJson(raw), { tipo_documento: 'Boleto', x: { y: [1, 2] } })
})

test('chaves dentro de strings não quebram o recorte', () => {
  const raw = 'ok\n{"nome":"Empresa {ABC} \\"Ltda\\"","valor":"1.00"}'
  assert.deepEqual(parseLlmJson(raw), { nome: 'Empresa {ABC} "Ltda"', valor: '1.00' })
})

test('sem objeto legível relança o erro do parse estrito', () => {
  assert.throws(() => parseLlmJson('isto não é json'), SyntaxError)
})
