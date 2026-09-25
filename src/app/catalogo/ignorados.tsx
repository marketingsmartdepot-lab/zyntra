import { criarClienteServidor } from "@/lib/supabase/server";
import { Botao } from "@/components/botao";
import { restaurarIgnorados } from "./acoes";

type Ignorado = {
  codigo: string;
  descricao: string | null;
  erp_ref: string | null;
  criado_em: string;
};

/**
 * Os produtos que a administração tirou do catálogo.
 *
 * Existe porque apagar, sozinho, não durava: o produto continua ativo no Bling
 * e a sincronização seguinte o recriava. Esta lista é o que faz a limpeza
 * durar — e, sendo visível, também é o que permite desfazer um engano.
 */
export async function Ignorados({ resultado }: { resultado?: string }) {
  const supabase = await criarClienteServidor();

  const { data } = await supabase
    .from("catalogo_ignorado")
    .select("codigo, descricao, erp_ref, criado_em")
    .order("codigo");

  const lista = (data ?? []) as Ignorado[];

  return (
    <div className="flex flex-col gap-4 p-5">
      {resultado && <Aviso resultado={resultado} />}

      <p className="m-0 max-w-[80ch] text-[13.5px] leading-relaxed text-suave">
        Estes produtos foram apagados do catálogo e a sincronização não os traz
        de volta — mesmo que continuem ativos no Bling. Restaurar só tira o
        código desta lista; quem recria o produto é a{" "}
        <b className="font-semibold">próxima sincronização</b>, com os dados
        atuais do Bling.
      </p>

      {lista.length === 0 ? (
        <p className="m-0 rounded-[9px] border border-linha px-4 py-10 text-center text-[13.5px] text-suave">
          Nenhum produto ignorado. Tudo que está no Bling e ativo entra no
          catálogo.
        </p>
      ) : (
        <form action={restaurarIgnorados}>
          <div className="overflow-x-auto rounded-[9px] border border-linha">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {["", "Código", "Produto", "Apagado em"].map((c, i) => (
                    <th
                      key={i}
                      style={
                        i === 0
                          ? { width: "42px" }
                          : i === 1
                            ? { width: "180px" }
                            : i === 3
                              ? { width: "170px" }
                              : undefined
                      }
                      className="border-b border-linha px-4 py-[10px] text-left text-[10.5px] font-semibold uppercase tracking-[0.12em] text-suave"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lista.map((g) => (
                  <tr key={g.codigo} className="hover:bg-fundo">
                    <td className="border-b border-linha-suave px-4 py-2">
                      <input
                        type="checkbox"
                        name="codigo"
                        value={g.codigo}
                        aria-label={`Selecionar ${g.codigo}`}
                        className="accent-[var(--color-tinta)]"
                      />
                    </td>
                    <td className="border-b border-linha-suave px-4 py-2 font-mono text-[13px] font-semibold">
                      {g.codigo}
                    </td>
                    <td className="border-b border-linha-suave px-4 py-2 text-[13.5px] text-suave">
                      {g.descricao ?? "—"}
                    </td>
                    <td className="border-b border-linha-suave px-4 py-2 text-[12.5px] text-suave">
                      {quando(g.criado_em)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Botao
              trabalhando="Restaurando…"
              className="rounded-lg border border-linha px-4 py-[9px] text-[13px] font-semibold"
            >
              Restaurar selecionados
            </Botao>
            <span className="text-[12.5px] text-suave">
              Depois de restaurar, use <b className="font-semibold">Sincronizar
              com o Bling</b> para o produto voltar ao catálogo.
            </span>
          </div>
        </form>
      )}
    </div>
  );
}

function Aviso({ resultado }: { resultado: string }) {
  if (resultado === "restaurados") return null;

  const texto: Record<string, string> = {
    sem_permissao: "Só líder ou administrador mexe no catálogo.",
    nada_selecionado: "Nenhum produto marcado.",
    erro: "Não foi possível restaurar.",
  };

  return (
    <p className="m-0 rounded-[9px] border border-critico-linha bg-critico-bg px-4 py-3 text-[13px] font-semibold text-critico">
      {texto[resultado] ?? "Não foi possível concluir."}
    </p>
  );
}

function quando(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}
