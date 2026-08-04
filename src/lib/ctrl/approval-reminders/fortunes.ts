// "Biscoito da sorte" do lembrete diário de aprovações.
//
// A frase precisa parecer sorteada para AQUELE usuário NAQUELE dia. Sorteio com
// Math.random() não serve: a mesma execução repetida (retry do cron, reenvio
// manual) devolveria uma frase diferente da que já foi registrada no log, e não
// haveria como reproduzir o que foi enviado.
//
// Em vez disso o sorteio é DETERMINÍSTICO por (usuário, dia): um hash FNV-1a de
// `userId|dia` indexa o banco de frases. Como o hash embute o id do usuário,
// pessoas diferentes recebem frases diferentes no mesmo dia (distribuição
// espalhada); como embute o dia, a frase muda todo dia para a mesma pessoa.
//
// Para o "não repetir em dias próximos", o sorteio ocorre sobre o banco MENOS as
// últimas frases já enviadas àquele usuário (lidas do ctrl_approval_email_log).

export const FORTUNE_MESSAGES: readonly string[] = [
  "A paciência é uma árvore de raiz amarga, mas de frutos muito doces.",
  "A maior de todas as torres começa no solo.",
  "Não pense no tempo perdido, foque no caminho que ainda pode trilhar.",
  "Aprenda com o passado, viva o presente e não tenha medo do futuro.",
  "Quem olha para fora sonha; quem olha para dentro desperta.",
  "Uma grande jornada sempre começa com o primeiro passo.",
  "O silêncio traz as respostas que a ansiedade esconde.",
  "As melhores coisas da vida não são coisas.",
  "Cultive a gentileza e colherá respeito por onde passar.",
  "A sabedoria não está em saber tudo, mas em saber o que fazer com o que se sabe.",
  "O sucesso é a soma de pequenos esforços repetidos dia após dia.",
  "O momento perfeito para agir é agora.",
  "Acredite no seu potencial: até a maior das tempestades chega ao fim.",
  "Não espere por oportunidades, crie-as.",
  "Sua determinação hoje será a sua vitória de amanhã.",
  "A coragem não é a ausência de medo, mas a decisão de seguir em frente apesar dele.",
  "O talento ganha jogos, mas o trabalho em equipe ganha campeonatos.",
  "Pequenas mudanças de hábito geram grandes transformações na vida.",
  "Faça do obstáculo o seu degrau para subir mais alto.",
  "A sua energia atrai a sua realidade: pense positivo!",
  "Uma surpresa agradável está a caminho de encontrar você.",
  "Sorria! Uma nova porta se abrirá quando você menos esperar.",
  "Hoje é um excelente dia para começar um novo projeto.",
  "Alguém distante está pensando em você com muito carinho.",
  "Uma boa notícia chegará antes do fim desta semana.",
  "A sorte favorece a mente preparada.",
  "Compartilhar sua alegria hoje dobrará a sua felicidade amanhã.",
  "Você encontrará a resposta para aquilo que tanto procura.",
  "Um reencontro inesperado trará muita luz ao seu dia.",
  "Seu dia será tão radiante quanto a sua determinação.",
  "Um vento de boas energias soprará na sua direção ainda hoje.",
  "O universo está conspirando a favor dos seus planos mais secretos.",
  "Um gesto simples de gentileza vai transformar o seu dia para melhor.",
  "A prosperidade baterá à sua porta quando você menos esperar.",
  "Prepare-se: uma grande oportunidade surgirá fantasiada de um pequeno acaso.",
  "Sua intuição estará afiada hoje; confie no que o seu coração diz.",
  "Dias de luz e boas risadas estão prestes a começar.",
  "O destino reserva um encontro muito especial no seu caminho.",
  "Um antigo desejo seu está mais perto de se realizar do que você imagina.",
  "Boas notícias virão acompanhadas de um grande alívio.",
  "O seu bom humor hoje será o amuleto de sorte de alguém ao seu redor.",
  "Um ciclo de pura sorte e tranquilidade se inicia para você hoje.",
  "A resposta positiva que você tanto espera está a caminho.",
  "Boas conversas trarão ideias brilhantes para o seu dia.",
  "O acaso vai colocar a pessoa certa no seu caminho na hora certa.",
  "A sorte de hoje será proporcional ao tamanho do seu sorriso.",
  "Um pequeno detalhe hoje trará uma grande onda de alegria.",
  "A sorte não vai apenas bater à sua porta, ela vai entrar e se sentar com você.",
  "O horizonte do seu dia está repleto de momentos leves e inesquecíveis.",
  "Uma coincidência feliz vai mudar o rumo da sua semana para melhor.",
];

/**
 * Quantas frases recentes do próprio usuário ficam de fora do sorteio. Com 50
 * frases no banco, bloquear as 12 últimas garante que uma frase só pode voltar
 * depois de ~2 semanas úteis sem estreitar demais o sorteio.
 */
export const FORTUNE_HISTORY_WINDOW = 12;

/** FNV-1a de 32 bits — determinístico, estável entre execuções e runtimes. */
function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // Multiplicação por 16777619 em aritmética de 32 bits sem estourar float.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Sorteia a mensagem do dia para um usuário.
 *
 * @param userId     id do destinatário (entra no hash → frases distintas entre pessoas)
 * @param dayKey     dia em Brasília, 'YYYY-MM-DD' (entra no hash → muda a cada dia)
 * @param recentSent frases já enviadas a esse usuário nos últimos dias (excluídas do sorteio)
 */
export function pickFortune(
  userId: string,
  dayKey: string,
  recentSent: readonly string[] = [],
): string {
  const blocked = new Set(recentSent.filter(Boolean));
  // Se o histórico cobriu quase tudo (banco pequeno ou janela grande), volta ao
  // banco completo em vez de devolver frase vazia.
  const pool = FORTUNE_MESSAGES.filter((m) => !blocked.has(m));
  const candidates = pool.length > 0 ? pool : FORTUNE_MESSAGES;
  const index = hash32(`${userId}|${dayKey}`) % candidates.length;
  return candidates[index];
}
