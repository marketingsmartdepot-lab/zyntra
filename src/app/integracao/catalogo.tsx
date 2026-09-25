import Link from "next/link";
import { criarClienteServidor } from "@/lib/supabase/server";
import { sincronizarCatalogo } from "./catalogo-acoes";

type Resumo = {
  total: number;
  com_bling: number;
  sem_bling: number;
  sem_foto: number;
  sem_codigo_barras: number;
  ultima_sincronizacao: string | null;
};

type Sku = {
  id: string;
  codigo: string;
  descricao: string;
  foto_url: string | null;
  erp_ref: string | null;
};

const POR_PAGINA = 60;

/**
 * O catálogo: o que o galpão vende, visto pelo ZYNTRA.
 *
 * Fica numa aba própria porque são milhares de linhas — misturado com
 * empresas, canais e modalidades em Cadastros, ele afogaria tudo o que muda
 * uma vez por ano.
 *
 * A lista é de leitura: quem cria produto é o Bling. Aqui a pergunta é outra —
 * o que está pronto para a esteira e o que ainda falta.
 */
export async function Catalogo({
  busca,
  pagina,
  filtro,
  resultado,
  numeros,
}: {
  busca?: string;
  pagina?: string;
  filtro?: string;
  resultado?: string;
  numeros: { lidos?: string; criados?: string; casados?: string; sem_codigo?: string; repetidos?: string };
}) {
  const supabase = await criarClienteServidor();

  const n = Math.max(Number(pagina ?? 1) || 1, 1);
  const termo = (busca ?? "").trim();

  let consulta = supabase
    .from("skus")
    .select("id, codigo, descricao, foto_url, erp_ref", { count: "exact" })
    .eq("ativo", true);

  if (termo) {
    consulta = consulta.or(`codigo.ilike.%${termo}%,descricao.ilike.%${termo}%`);
  }
  if (filtro === "sem_bling") consulta = consulta.is("erp_ref", null);
  if (filtro === "sem_foto") consulta = consulta.is("foto_url", null);

  const [{ data: resumo }, { data: lista, count }] = await Promise.all([
    supabase.from("catalogo_resumo").select("*").maybeSingle(),
    consulta.order("codigo").range((n - 1) * POR_PAGINA, n * POR_PAGINA - 1),
  ]);

  const r = (resumo ?? null) as Resumo | null;
  const skus = (lista ?? []) as Sku[];
  const total = count ?? 0;
  const ultima = n * POR_PAGINA >= total;

  const comFiltro = (mudanca: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ aba: "catalogo" });
    const base = { busca: termo || undefined, filtro, pagina: undefined, ...mudanca };
    for (const [k, v] of Object.entries(base)) if (v) p.set(k, v);
    return `/integracao?${p.toString()}`;
  };

  return (
    <div className="flex flex-col gap-5 p-5">
      {resultado && <Aviso resultado={resultado} numeros={numeros} />}

      {/* ------------------------------------------------ os números */}
      <section className="flex flex-wrap items-stretch gap-3">
        <Numero valor={r?.total ?? 0} rotulo="SKUs ativos" />
        <Numero
          valor={r?.com_bling ?? 0}
          rotulo="com produto no Bling"
          tom={r && r.total > 0 && r.com_bling === r.total ? "ok" : undefined}
        />
        <Numero
          valor={r?.sem_bling ?? 0}
          rotulo="sem produto no Bling"
          tom={r && r.sem_bling > 0 ? "critico" : undefined}
          href={r && r.sem_bling > 0 ? comFiltro({ filtro: "sem_bling" }) : undefined}
        />
        <Numero
          valor={r?.sem_codigo_barras ?? 0}
          rotulo="sem código de barras"
          tom={r && r.sem_codigo_barras > 0 ? "atencao" : undefined}
        />
      </section>

      <form action={sincronizarCatalogo} className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="rounded-lg bg-tinta px-4 py-[9px] text-[13px] font-semibold text-white"
        >
          Sincronizar com o Bling
        </button>
        <span className="max-w-[74ch] text-[12.5px] text-suave">
          Traz os produtos <b className="font-semibold">ativos</b> do Bling: cria
          o que falta e liga ao que já existe. Produto sem código fica de fora —
          é pelo código que a baixa encontra o produto certo. A descrição que
          alguém ajustou aqui não é sobrescrita.
          {r?.ultima_sincronizacao && (
            <> Última: {quando(r.ultima_sincronizacao)}.</>
          )}
        </span>
      </form>

      {(r?.sem_codigo_barras ?? 0) > 0 && (
        <p className="m-0 rounded-[9px] border border-atencao-linha bg-atencao-bg px-4 py-3 text-[13px] text-atencao">
          <b className="font-semibold">
            {r?.sem_codigo_barras} SKUs sem código de barras.
          </b>{" "}
          A conferência na bancada é por bipagem: sem código de barras, o
          operador não consegue validar a caixa desses produtos. O Bling não
          traz esse dado nesta listagem — ele é cadastrado à parte.
        </p>
      )}

      {/* ------------------------------------------------ busca e filtro */}
      <form action="/integracao" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="aba" value="catalogo" />
        {filtro && <input type="hidden" name="filtro" value={filtro} />}
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
        {(termo || filtro) && (
          <Link
            href="/integracao?aba=catalogo"
            className="text-[13px] font-semibold text-suave no-underline"
          >
            limpar
          </Link>
        )}
        <span className="flex-1" />
        <span className="text-[12.5px] text-suave">
          {total.toLocaleString("pt-BR")}{" "}
          {total === 1 ? "produto" : "produtos"}
          {filtro === "sem_bling" && " sem produto no Bling"}
          {filtro === "sem_foto" && " sem foto"}
        </span>
      </form>

      {/* ------------------------------------------------ a lista */}
      {skus.length === 0 ? (
        <p className="m-0 rounded-[9px] border border-linha px-4 py-8 text-center text-[13.5px] text-suave">
          {termo || filtro
            ? "Nenhum produto com esse filtro."
            : "Catálogo vazio. Conecte o Bling em Estoque e sincronize."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[9px] border border-linha">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["", "Código", "Produto", "No Bling"].map((c, i) => (
                  <th
                    key={i}
                    style={i === 0 ? { width: "56px" } : i === 1 ? { width: "170px" } : undefined}
                    className="border-b border-linha px-4 py-[10px] text-left text-[10.5px] font-semibold uppercase tracking-[0.12em] text-suave"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {skus.map((s) => (
                <tr key={s.id}>
                  <td className="border-b border-linha-suave px-4 py-2">
                    {s.foto_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={s.foto_url}
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
                    {s.codigo}
                  </td>
                  <td className="border-b border-linha-suave px-4 py-2 text-[13.5px]">
                    {s.descricao}
                  </td>
                  <td className="border-b border-linha-suave px-4 py-2">
                    {s.erp_ref ? (
                      <span className="font-mono text-[12px] text-suave">
                        {s.erp_ref}
                      </span>
                    ) : (
                      <span className="rounded-md border border-critico-linha bg-critico-bg px-[9px] py-[3px] text-[12px] font-semibold text-critico">
                        sem vínculo
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > POR_PAGINA && (
        <div className="flex items-center gap-3 text-[13px]">
          {n > 1 && (
            <Link href={comFiltro({ pagina: String(n - 1) })} className="font-semibold">
              ← anteriores
            </Link>
          )}
          <span className="text-suave">
            {(n - 1) * POR_PAGINA + 1}–{Math.min(n * POR_PAGINA, total)} de{" "}
            {total.toLocaleString("pt-BR")}
          </span>
          {!ultima && (
            <Link href={comFiltro({ pagina: String(n + 1) })} className="font-semibold">
              próximos →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function Numero({
  valor,
  rotulo,
  tom,
  href,
}: {
  valor: number;
  rotulo: string;
  tom?: "ok" | "atencao" | "critico";
  href?: string;
}) {
  const cor =
    tom === "ok"
      ? "text-ok"
      : tom === "atencao"
        ? "text-atencao"
        : tom === "critico"
          ? "text-critico"
          : "text-tinta";

  const conteudo = (
    <>
      <span className={`block font-mono text-[26px] font-semibold tabular-nums ${cor}`}>
        {valor.toLocaleString("pt-BR")}
      </span>
      <span className="mt-[2px] block text-[12px] text-suave">{rotulo}</span>
    </>
  );

  const classe =
    "min-w-[168px] rounded-[9px] border border-linha px-4 py-3 no-underline";

  return href ? (
    <Link href={href} className={classe}>
      {conteudo}
    </Link>
  ) : (
    <div className={classe}>{conteudo}</div>
  );
}

/**
 * O que a sincronização fez, em números.
 *
 * "Sincronizado com sucesso" não diz nada. Quantos entraram, quantos ficaram
 * de fora e por quê é o que permite confiar — ou desconfiar — do resultado.
 */
function Aviso({
  resultado,
  numeros,
}: {
  resultado: string;
  numeros: { lidos?: string; criados?: string; casados?: string; sem_codigo?: string; repetidos?: string };
}) {
  const ok = resultado === "ok" || resultado === "parcial";

  const resumo = (
    <>
      {numeros.lidos} produtos lidos no Bling
      {numeros.criados && Number(numeros.criados) > 0 && (
        <> · <b className="font-semibold">{numeros.criados} SKUs criados</b></>
      )}
      {numeros.casados && Number(numeros.casados) > 0 && (
        <> · {numeros.casados} vinculados</>
      )}
      {numeros.sem_codigo && Number(numeros.sem_codigo) > 0 && (
        <> · {numeros.sem_codigo} sem código, de fora</>
      )}
      {numeros.repetidos && Number(numeros.repetidos) > 0 && (
        <> · {numeros.repetidos} com código repetido no Bling, de fora</>
      )}
    </>
  );

  const falha: Record<string, string> = {
    sem_conexao: "Conecte o Bling na aba Estoque antes de sincronizar.",
    conexao_expirada: "A autorização do Bling expirou. Autorize de novo em Estoque.",
    conexao_recusada: "O Bling recusou a credencial. Autorize de novo em Estoque.",
    recusado: "O Bling recusou a consulta no meio da sincronização.",
    rede: "A conexão com o Bling caiu no meio.",
    so_admin: "Só um administrador sincroniza o catálogo.",
    erro: "Não foi possível sincronizar.",
  };

  if (!ok) {
    return (
      <p className="m-0 rounded-[9px] border border-critico-linha bg-critico-bg px-4 py-3 text-[13px] text-critico">
        <b className="font-semibold">{falha[resultado] ?? "Não foi possível sincronizar."}</b>
        {numeros.lidos && (
          <span className="mt-1 block font-normal">
            O que já entrou está gravado: {resumo}. Rodar de novo continua de
            onde parou.
          </span>
        )}
      </p>
    );
  }

  return (
    <p className="m-0 rounded-[9px] border border-ok-linha bg-ok-bg px-4 py-3 text-[13px] text-ok">
      <b className="font-semibold">
        {resultado === "parcial"
          ? "Sincronização parcial — o catálogo é maior que o previsto."
          : "Catálogo sincronizado."}
      </b>{" "}
      <span className="font-normal">{resumo}.</span>
      {resultado === "parcial" && (
        <span className="mt-1 block font-normal">
          Clique em sincronizar de novo para continuar.
        </span>
      )}
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
