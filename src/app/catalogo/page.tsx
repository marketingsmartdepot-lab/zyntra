import { redirect } from "next/navigation";
import { Casca } from "@/components/casca";
import { Barra, Indicador } from "@/components/barra";
import { criarClienteServidor } from "@/lib/supabase/server";
import { ListaCatalogo } from "./lista";

export const metadata = { title: "Catálogo — ZYNTRA" };

/**
 * O catálogo virou frente própria, ao lado de Expedição e Logística.
 *
 * Dentro de Integração ele não cabia: Integração é o que se configura uma vez
 * — contas, impressoras, depósito. O catálogo é consultado toda semana, tem
 * milhares de linhas e é onde se descobre que um produto não pode ser bipado.
 * Isso é trabalho, não configuração.
 */
export default async function PaginaCatalogo({
  searchParams,
}: {
  searchParams: Promise<{
    busca?: string;
    pagina?: string;
    filtro?: string;
    resultado?: string;
    lidos?: string;
    criados?: string;
    casados?: string;
    sem_codigo?: string;
    repetidos?: string;
    apagados?: string;
    bloqueados?: string;
    eans?: string;
  }>;
}) {
  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar?destino=/catalogo");

  const p = await searchParams;
  const filtro = p.filtro ?? "todos";

  const { data: resumo } = await supabase
    .from("catalogo_resumo")
    .select("*")
    .maybeSingle();

  const r = (resumo ?? null) as {
    total: number;
    com_bling: number;
    sem_bling: number;
    com_ean: number;
    sem_ean: number;
    sem_ean_no_bling: number;
    sem_foto: number;
    ultima_sincronizacao: string | null;
  } | null;

  const aba = (chave: string, rotulo: string, contagem: number, tom?: "critico" | "atencao") => ({
    chave,
    href: `/catalogo${chave === "todos" ? "" : `?filtro=${chave}`}`,
    rotulo,
    contagem,
    ativa: filtro === chave,
    tom,
  });

  return (
    <Casca frente="catalogo" email={user.email ?? "sem e-mail"}>
      <Barra
        rotulo="Recortes do catálogo"
        abas={[
          aba("todos", "Todos", r?.total ?? 0),
          aba("sem_ean", "Sem código de barras", r?.sem_ean ?? 0, "critico"),
          aba("sem_bling", "Sem vínculo no Bling", r?.sem_bling ?? 0, "atencao"),
          aba("sem_foto", "Sem foto", r?.sem_foto ?? 0),
        ]}
        explicacao="Quem cria produto é o Bling. Aqui a pergunta é o que já está pronto para a esteira — e o que a bancada não consegue bipar."
        direita={
          r && r.total > 0 ? (
            <Indicador
              valor={`${Math.round((r.com_ean / r.total) * 100)}% prontos para bipagem`}
              tom={r.com_ean === r.total ? "ok" : r.com_ean === 0 ? "critico" : "neutro"}
            />
          ) : undefined
        }
      />

      <div className="flex flex-1 flex-col bg-superficie">
        <ListaCatalogo
          busca={p.busca}
          pagina={p.pagina}
          filtro={filtro}
          resumo={r}
          resultado={p.resultado}
          numeros={p}
        />
      </div>
    </Casca>
  );
}
