import Link from "next/link";
import { criarClienteServidor } from "@/lib/supabase/server";
import { buscarEans, excluirSkus, sincronizarCatalogo } from "./acoes";

type Resumo = {
  total: number;
  com_bling: number;
  sem_bling: number;
  com_ean: number;
  sem_ean: number;
  sem_ean_no_bling: number;
  sem_foto: number;
  ultima_sincronizacao: string | null;
};

type Linha = {
  id: string;
  codigo: string;
  descricao: string;
  foto_url: string | null;
  erp_ref: string | null;
  sku_codigos_barras: { codigo: string; principal: boolean }[] | null;
};

const POR_PAGINA = 60;

/**
 * A lista do catálogo.
 *
 * Paginada no banco, não no navegador: com milhares de produtos, trazer tudo
 * para depois cortar na tela é o caminho mais curto para travar a máquina do
 * galpão.
 */
export async function ListaCatalogo({
  busca,
  pagina,
  filtro,
  resumo,
  resultado,
  numeros,
}: {
  busca?: string;
  pagina?: string;
  filtro: string;
  resumo: Resumo | null;
  resultado?: string;
  numeros: Record<string, string | undefined>;
}) {
  const supabase = await criarClienteServidor();

  const n = Math.max(Number(pagina ?? 1) || 1, 1);
  const termo = (busca ?? "").trim();

  let consulta = supabase
    .from("skus")
    .select("id, codigo, descricao, foto_url, erp_ref, sku_codigos_barras(codigo, principal)", {
      count: "exact",
    })
    .eq("ativo", true);

  if (termo) {
    consulta = consulta.or(`codigo.ilike.%${termo}%,descricao.ilike.%${termo}%`);
  }
  if (filtro === "sem_bling") consulta = consulta.is("erp_ref", null);
  if (filtro === "sem_foto") consulta = consulta.is("foto_url", null);

  const { data, count } = await consulta
    .order("codigo")
    .range((n - 1) * POR_PAGINA, n * POR_PAGINA - 1);

  let linhas = (data ?? []) as unknown as Linha[];

  // "Sem código de barras" não dá para filtrar por embed no PostgREST sem
  // trazer tudo, então o recorte acontece aqui. Os outros filtram no banco.
  if (filtro === "sem_ean") {
    linhas = linhas.filter((l) => (l.sku_codigos_barras ?? []).length === 0);
  }

  const total = count ?? 0;
  const ultima = n * POR_PAGINA >= total;

  const href = (mudanca: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const base = {
      busca: termo || undefined,
      filtro: filtro === "todos" ? undefined : filtro,
      pagina: undefined,
      ...mudanca,
    };
    for (const [k, v] of Object.entries(base)) if (v) p.set(k, v);
    const q = p.toString();
    return q ? `/catalogo?${q}` : "/catalogo";
  };

  return (
    <div className="flex flex-col gap-4 p-5">
      {resultado && <Aviso resultado={resultado} numeros={numeros} />}

      {/* ------------------------------------------- o que trava a bancada */}
      {resumo && resumo.sem_ean > 0 && (
        <div className="rounded-[9px] border border-atencao-linha bg-atencao-bg px-4 py-3">
          <p className="m-0 text-[13px] text-atencao">
            <b className="font-semibold">
              {resumo.sem_ean.toLocaleString("pt-BR")} produtos sem código de
              barras.
            </b>{" "}
            A conferência na bancada é por bipagem — sem código de barras, o
            operador não valida a caixa desses produtos.
            {resumo.sem_ean_no_bling > 0 && (
              <>
                {" "}
                Destes,{" "}
                <b className="font-semibold">
                  {resumo.sem_ean_no_bling.toLocaleString("pt-BR")} já foram
                  perguntados ao Bling e ele não tem o EAN cadastrado
                </b>{" "}
                — esses não se resolvem esperando.
              </>
            )}
          </p>
          <form action={buscarEans} className="mt-2 flex items-center gap-3">
            <button
              type="submit"
              className="rounded-lg border border-atencao-linha bg-superficie px-3 py-[7px] text-[12.5px] font-semibold text-atencao"
            >
              Buscar agora no Bling
            </button>
            <span className="text-[12px] text-atencao">
              A busca já roda sozinha de minuto em minuto. O botão é para não
              esperar — vai uma leva de cada vez, porque o EAN só existe no
              detalhe de cada produto.
            </span>
          </form>
        </div>
      )}

      {/* ------------------------------------------------ busca e ações */}
      <div className="flex flex-wrap items-end gap-3">
        <form action="/catalogo" className="flex items-end gap-2">
          {filtro !== "todos" && <input type="hidden" name="filtro" value={filtro} />}
          <div>
            <label
              htmlFor="catalogo-busca"
              className="mb-[6px] block text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave"
            >
              Procurar
            </label>
            <input
              id="catalogo-busca"
              name="busca"
              defaultValue={termo}
              placeholder="código ou descrição"
              className="w-[300px] rounded-lg border border-linha bg-superficie px-3 py-[9px] text-[13.5px]"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg border border-linha px-4 py-[9px] text-[13px] font-semibold"
          >
            Buscar
          </button>
          {(termo || filtro !== "todos") && (
            <Link href="/catalogo" className="px-1 text-[13px] font-semibold text-suave no-underline">
              limpar
            </Link>
          )}
        </form>

        <span className="flex-1" />

        <form action={sincronizarCatalogo}>
          <button
            type="submit"
            className="rounded-lg border border-linha px-4 py-[9px] text-[13px] font-semibold"
          >
            Sincronizar com o Bling
          </button>
        </form>
      </div>

      {resumo?.ultima_sincronizacao && (
        <p className="m-0 text-[12.5px] text-suave">
          Última sincronização: {quando(resumo.ultima_sincronizacao)}. Traz os
          produtos <b className="font-semibold">ativos</b> do Bling e cria o que
          falta; produto sem código fica de fora, e a descrição ajustada aqui
          não é sobrescrita.
        </p>
      )}

      {/* ------------------------------------------------ a tabela */}
      {linhas.length === 0 ? (
        <p className="m-0 rounded-[9px] border border-linha px-4 py-10 text-center text-[13.5px] text-suave">
          {termo || filtro !== "todos"
            ? "Nenhum produto neste recorte."
            : "Catálogo vazio. Conecte o Bling em Integração › Estoque e sincronize."}
        </p>
      ) : (
        <form action={excluirSkus}>
          <div className="overflow-x-auto rounded-[9px] border border-linha">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {["", "", "Código", "Produto", "Código de barras", "No Bling"].map(
                    (c, i) => (
                      <th
                        key={i}
                        style={
                          i === 0
                            ? { width: "42px" }
                            : i === 1
                              ? { width: "56px" }
                              : i === 2
                                ? { width: "160px" }
                                : undefined
                        }
                        className="border-b border-linha px-4 py-[10px] text-left text-[10.5px] font-semibold uppercase tracking-[0.12em] text-suave"
                      >
                        {c}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => {
                  const ean =
                    (l.sku_codigos_barras ?? []).find((b) => b.principal) ??
                    (l.sku_codigos_barras ?? [])[0];

                  return (
                    <tr key={l.id} className="hover:bg-fundo">
                      <td className="border-b border-linha-suave px-4 py-2">
                        <input
                          type="checkbox"
                          name="sku"
                          value={l.id}
                          aria-label={`Selecionar ${l.codigo}`}
                          className="accent-[var(--color-tinta)]"
                        />
                      </td>
                      <td className="border-b border-linha-suave px-4 py-2">
                        {l.foto_url ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={l.foto_url}
                            alt=""
                            width={34}
                            height={34}
                            className="h-[34px] w-[34px] rounded-[6px] border border-linha object-cover"
                          />
                        ) : (
                          <span className="block h-[34px] w-[34px] rounded-[6px] border border-dashed border-linha" />
                        )}
                      </td>
                      <td className="border-b border-linha-suave px-4 py-2 font-mono text-[13px] font-semibold">
                        {l.codigo}
                      </td>
                      <td className="border-b border-linha-suave px-4 py-2 text-[13.5px]">
                        {l.descricao}
                      </td>
                      <td className="border-b border-linha-suave px-4 py-2">
                        {ean ? (
                          <span className="font-mono text-[13px] tabular-nums">
                            {ean.codigo}
                          </span>
                        ) : (
                          <span className="rounded-md border border-atencao-linha bg-atencao-bg px-[9px] py-[3px] text-[12px] font-semibold text-atencao">
                            não bipa
                          </span>
                        )}
                      </td>
                      <td className="border-b border-linha-suave px-4 py-2">
                        {l.erp_ref ? (
                          <span className="font-mono text-[12px] text-suave">
                            {l.erp_ref}
                          </span>
                        ) : (
                          <span className="rounded-md border border-critico-linha bg-critico-bg px-[9px] py-[3px] text-[12px] font-semibold text-critico">
                            sem vínculo
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              className="rounded-lg border border-critico-linha px-4 py-[9px] text-[13px] font-semibold text-critico"
            >
              Apagar selecionados
            </button>
            <span className="max-w-[64ch] text-[12.5px] text-suave">
              Apaga de vez. Produto que já passou por conferência, baixa, anúncio
              ou kit é recusado pelo banco — esse volta nomeado, porque apagá-lo
              deixaria o histórico sem explicação.
            </span>

            <span className="flex-1" />

            {total > POR_PAGINA && (
              <span className="flex items-center gap-3 text-[13px]">
                {n > 1 && (
                  <Link href={href({ pagina: String(n - 1) })} className="font-semibold">
                    ← anteriores
                  </Link>
                )}
                <span className="text-suave tabular-nums">
                  {(n - 1) * POR_PAGINA + 1}–{Math.min(n * POR_PAGINA, total)} de{" "}
                  {total.toLocaleString("pt-BR")}
                </span>
                {!ultima && (
                  <Link href={href({ pagina: String(n + 1) })} className="font-semibold">
                    próximos →
                  </Link>
                )}
              </span>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * O que a última ação fez, em números.
 *
 * "Concluído" não diz nada. Quantos entraram, quantos ficaram de fora e por
 * quê é o que permite confiar — ou desconfiar — do resultado.
 */
function Aviso({
  resultado,
  numeros,
}: {
  resultado: string;
  numeros: Record<string, string | undefined>;
}) {
  if (resultado === "apagados") {
    const bloqueados = (() => {
      try {
        return JSON.parse(numeros.bloqueados ?? "[]") as {
          codigo: string;
          motivo: string;
        }[];
      } catch {
        return [];
      }
    })();

    return (
      <div className="rounded-[9px] border border-ok-linha bg-ok-bg px-4 py-3 text-[13px] text-ok">
        <b className="font-semibold">
          {numeros.apagados} {numeros.apagados === "1" ? "produto apagado" : "produtos apagados"}.
        </b>
        {bloqueados.length > 0 && (
          <div className="mt-2 text-critico">
            <b className="font-semibold">
              {bloqueados.length} não {bloqueados.length === 1 ? "pôde" : "puderam"} ser apagados:
            </b>
            <ul className="m-0 mt-1 list-none p-0">
              {bloqueados.map((b) => (
                <li key={b.codigo} className="font-normal">
                  <span className="font-mono font-semibold">{b.codigo}</span> — {b.motivo}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  if (resultado === "eans") {
    const [achados, vistos] = (numeros.eans ?? "0-0").split("-");
    return (
      <p className="m-0 rounded-[9px] border border-ok-linha bg-ok-bg px-4 py-3 text-[13px] text-ok">
        <b className="font-semibold">{achados} códigos de barras encontrados</b> em{" "}
        {vistos} produtos consultados no Bling.
        {Number(achados) === 0 && Number(vistos) > 0 && (
          <span className="font-normal">
            {" "}
            Nenhum destes tem EAN cadastrado no Bling.
          </span>
        )}
      </p>
    );
  }

  if (resultado === "ok" || resultado === "parcial") {
    return (
      <p className="m-0 rounded-[9px] border border-ok-linha bg-ok-bg px-4 py-3 text-[13px] text-ok">
        <b className="font-semibold">
          {resultado === "parcial"
            ? "Sincronização parcial — o catálogo é maior que o previsto."
            : "Catálogo sincronizado."}
        </b>{" "}
        <span className="font-normal">
          {numeros.lidos} produtos lidos
          {Number(numeros.criados ?? 0) > 0 && <> · {numeros.criados} criados</>}
          {Number(numeros.casados ?? 0) > 0 && <> · {numeros.casados} vinculados</>}
          {Number(numeros.sem_codigo ?? 0) > 0 && (
            <> · {numeros.sem_codigo} sem código, de fora</>
          )}
          {Number(numeros.repetidos ?? 0) > 0 && (
            <> · {numeros.repetidos} com código repetido no Bling, de fora</>
          )}
          .
        </span>
        {resultado === "parcial" && (
          <span className="mt-1 block font-normal">
            Sincronize de novo para continuar de onde parou.
          </span>
        )}
      </p>
    );
  }

  const falha: Record<string, string> = {
    sem_conexao: "Conecte o Bling em Integração › Estoque antes de sincronizar.",
    conexao_expirada: "A autorização do Bling expirou. Autorize de novo em Integração › Estoque.",
    conexao_recusada: "O Bling recusou a credencial. Autorize de novo em Integração › Estoque.",
    recusado: "O Bling recusou a consulta no meio da sincronização.",
    rede: "A conexão com o Bling caiu no meio. O que já entrou está gravado.",
    sem_permissao: "Só líder ou administrador mexe no catálogo.",
    nada_selecionado: "Nenhum produto marcado.",
    erro: "Não foi possível concluir.",
  };

  return (
    <p className="m-0 rounded-[9px] border border-critico-linha bg-critico-bg px-4 py-3 text-[13px] font-semibold text-critico">
      {falha[resultado] ?? "Não foi possível concluir."}
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
