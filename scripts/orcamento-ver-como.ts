/**
 * "Ver como" no módulo Orçamento — rebaixa TEMPORARIAMENTE o seu próprio papel
 * para viver o módulo como um diretor ou um gerente vive.
 *
 *   npx tsx scripts/orcamento-ver-como.ts <email> diretor
 *   npx tsx scripts/orcamento-ver-como.ts <email> gerente
 *   npx tsx scripts/orcamento-ver-como.ts <email> admin     ← volta ao normal
 *   npx tsx scripts/orcamento-ver-como.ts <email>           ← mostra o estado
 *
 * Por que existe: como admin você já enxerga a barra de validação e faz todas as
 * ações da diretoria, mas NUNCA sente três coisas — o gate por campo em média e
 * valor fixo (só o diretor é barrado ao mexer no valor), a trava do item do lado
 * de quem construiu, e o recorte por empresa e por setor. Sem isso, testar
 * sozinho dá uma falsa sensação de que está tudo liberado.
 *
 * Como funciona: grava `role` na linha de concessão do módulo
 * (`user_module_roles`, module='orcamento'), que `resolveOrcamentoPapel` lê ANTES
 * do atalho de admin. Só REDUZ privilégio — nunca amplia — e é reversível.
 *
 * ATENÇÃO: enquanto estiver rebaixado, você perde as telas de Configuração do
 * módulo e as transições do ciclo (enviar, concluir, publicar), porque elas são
 * de admin. Volte para `admin` ao terminar.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = readFileSync(".env.local", "utf8");
const get = (k: string) => (env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] ?? "").trim();
const db = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

const email = process.argv[2];
const comoArg = (process.argv[3] ?? "").toLowerCase();

const PAPEL: Record<string, string> = {
  diretor: "validador",
  validador: "validador",
  gerente: "construtor",
  construtor: "construtor",
  admin: "auto",
  auto: "auto",
};

async function main() {
  if (!email) {
    console.error("Uso: npx tsx scripts/orcamento-ver-como.ts <email> [diretor|gerente|admin]");
    process.exit(1);
  }

  const { data: user } = await db
    .from("users")
    .select("id, email, name, profile")
    .ilike("email", email)
    .maybeSingle();
  if (!user) {
    console.error(`Usuário não encontrado: ${email}`);
    process.exit(1);
  }

  const { data: linha } = await db
    .from("user_module_roles")
    .select("id, role")
    .eq("user_id", user.id as string)
    .eq("module", "orcamento")
    .maybeSingle();

  // Sem argumento: só relata.
  if (!comoArg) {
    const efetivo =
      linha?.role === "validador" || linha?.role === "construtor"
        ? `${linha.role} (VER COMO ativo)`
        : user.profile === "admin"
          ? "admin"
          : `derivado do perfil (${user.profile})`;
    console.log(`\n${user.email} · perfil ${user.profile}`);
    console.log(`  concessão do módulo: ${linha ? `sim (role='${linha.role}')` : "não"}`);
    console.log(`  papel efetivo no Orçamento: ${efetivo}\n`);
    return;
  }

  const role = PAPEL[comoArg];
  if (!role) {
    console.error(`Papel desconhecido: ${comoArg}. Use diretor, gerente ou admin.`);
    process.exit(1);
  }

  if (linha) {
    const { error } = await db
      .from("user_module_roles")
      .update({ role })
      .eq("id", linha.id as string);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await db
      .from("user_module_roles")
      .insert({ user_id: user.id as string, module: "orcamento", role });
    if (error) throw new Error(error.message);
  }

  if (role === "auto") {
    console.log(`\n✓ ${user.email} voltou ao papel normal (perfil ${user.profile}).\n`);
  } else {
    console.log(`\n✓ ${user.email} agora vive o módulo como "${role}".`);
    console.log("  Recarregue a página (a sessão lê o papel a cada requisição).");
    if (role === "construtor") {
      console.log("  Lembre: como construtor você só vê os setores vinculados a você");
      console.log("  em user_sectors, e só as empresas de user_company_access.");
    }
    console.log(`  Para voltar: npx tsx scripts/orcamento-ver-como.ts ${user.email} admin\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
