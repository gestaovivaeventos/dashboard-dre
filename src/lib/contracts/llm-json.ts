// Leitura tolerante do JSON devolvido pelo LLM de extração.
//
// Mesmo com response_format=json_object, o provedor às vezes devolve lixo em
// volta do objeto: cerca de markdown (```json), ou um eco do próprio parâmetro
// (`{"type":"json_object"}`) numa linha antes do JSON real — caso real, RPs
// 880709 e 881434 (14/09/2026), que caíram em "erro" com o documento íntegro.
// Aqui pegamos todos os objetos balanceados de nível superior e devolvemos o
// maior que parseia: o eco tem uma chave, a extração tem dezenas.

export function parseLlmJson<T = unknown>(rawText: string): T {
  const text = rawText.trim()
  try {
    return JSON.parse(text) as T
  } catch {
    // segue para a leitura tolerante
  }

  const candidatos = topLevelObjects(text)
  let melhor: { value: T; size: number } | null = null
  for (const c of candidatos) {
    try {
      const value = JSON.parse(c) as T
      if (!melhor || c.length > melhor.size) melhor = { value, size: c.length }
    } catch {
      // candidato inválido — tenta o próximo
    }
  }
  if (melhor) return melhor.value

  // Nenhum objeto legível: relança o erro do parse estrito para a mensagem
  // continuar mostrando o motivo original.
  return JSON.parse(text) as T
}

// Varre o texto e recorta cada `{ ... }` de nível superior, respeitando
// strings (chaves dentro de aspas não contam) e escapes.
function topLevelObjects(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
    } else if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      if (depth === 0) continue
      depth--
      if (depth === 0 && start >= 0) {
        out.push(text.slice(start, i + 1))
        start = -1
      }
    }
  }
  return out
}
