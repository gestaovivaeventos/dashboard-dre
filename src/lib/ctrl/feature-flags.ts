// Flags de funcionalidade do módulo Compras.
//
// Servem de "ponto de reversão" rápido: com a flag em `false`, o recurso fica
// INERTE — a UI some, e o envio/lançamento voltam a se comportar exatamente como
// antes — sem precisar mexer no git. (O ponto de reversão duro é a tag git
// `checkpoint/pre-categoria-investimento`.)

// Categoria escolhida no ENVIO (Contas a Pagar) para tipos de despesa marcados
// como "grupo" no Omie (ex.: Investimentos), que não têm categoria única.
//   true  → mostra o marcador no Mapeamento Omie, pede a categoria no modal de
//           envio e o lançamento usa a categoria escolhida (override).
//   false → esconde tudo isso; um override porventura gravado é ignorado e o
//           lançamento volta a usar só o mapeamento tipo → categoria.
export const CATEGORIA_NO_ENVIO_ENABLED = true;
