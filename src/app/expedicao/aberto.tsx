import { criarClienteServidor } from "@/lib/supabase/server";
import { reprocessarCausa } from "./aberto-acoes";

type Causa = {
  fonte: string;
  tipo: string;
  codigo: string | null;
  causa: string;
  detalhe: string | null;
  campo_a_corrigir: string | null;
  pacotes: number;
  contas: string[];
  primeira_ocorrencia: string;
};

type Pausada = {
  id: string;
  apelido: string;
  emissao_pausada_em: string;
  emissao_pausa_motivo: string | null;
  empresa: string | null;
};

/**
 * Só causa fiscal tem botão. As outras ou destravam sozinhas (SKU mapeado) ou
 * não se resolvem pedindo nota (falta de estoque, pedido alterado) — e botão
 * que não conserta nada é pior que botão nenhum.
 */
const FISCAIS = new Set([
  "rejeicao_fiscal",
  "sem_nota",
  "faturador_nao_configurado",
]);

const ROTULO: Record<string, string> = {
  sem_nota: "Sem nota fiscal",
  rejeicao_fiscal: "Rejeição fiscal",
  faturador_nao_configurado: "Faturador não configurado na conta",
  sku_nao_mapeado: "Anúncio sem SKU correspondente",
  sem_etiqueta: "Sem etiqueta",
  sem_estoque: "Sem estoque",
  pedido_alterado: "Pedido alterado",
  impressao_fora_do_sistema: "Impressão fora do sistema",
};

/**
 * Agrupado por causa, não por pedido. Um NCM faltando trava trinta pedidos:
 * listados um a um, o time resolve o mesmo problema trinta vezes.
 */
export async function AbertoPorCausa({ resultado }: { resultado?: string }) {
  const supabase = await criarClienteServidor();

  const [{ data: causas }, { data: pausadas }] = await Promise.all([
    supabase
      .from("aberto_por_causa")
      .select("*")
      .order("pacotes", { ascending: false }),
    supabase.from("emissao_pausada").select("*"),
  ]);

  const lista = (causas ?? []) as Causa[];
  const paradas = (pausadas ?? []) as Pausada[];
  const total = lista.reduce((t, c) => t + c.pacotes, 0);

  return (
    <div className="flex flex-1 flex-col">
      {paradas.map((c) => (
        <div
          key={c.id}
          className="flex flex-wrap items-center gap-3 border-b border-critico-linha bg-critico-bg px-5 py-3"
        >
          <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-critico"
            aria-hidden="true"
          >
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
          <span>
            <span className="block text-[13.5px] font-semibold text-critico">
              Emissão automática pausada na conta {c.apelido}
            </span>
            <span className="block text-[12.5px] text-[#7A2C24]">
              {c.emissao_pausa_motivo ??
                "O disjuntor parou de pedir notas para não repetir o mesmo erro."}
            </span>
          </span>
        </div>
      ))}

      {resultado && <AvisoReprocesso resultado={resultado} />}

      {lista.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 py-20">
          <div className="max-w-[52ch] text-center">
            <h2 className="text-[20px] font-bold tracking-[-0.02em]">
              Nada parado
            </h2>
            <p className="mt-3 text-[14px] leading-relaxed text-suave">
              Em operação normal esta aba fica vazia. Se encher, o problema é de
              cadastro ou de configuração — não de volume.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 border-b border-linha bg-fundo px-5 py-[10px] text-[12.5px] text-suave">
            <b className="font-semibold text-tinta">{total}</b>
            {total === 1 ? " pedido parado" : " pedidos parados"} em{" "}
            <b className="font-semibold text-tinta">{lista.length}</b>
            {lista.length === 1 ? " causa" : " causas"}
          </div>

          <div className="flex flex-col gap-3 p-5">
            {lista.map((c, i) => (
              <article
                key={i}
                className="flex overflow-hidden rounded-[9px] border border-linha"
              >
                <span
                  className={`w-1 shrink-0 ${
                    c.tipo === "rejeicao_fiscal" ||
                    c.tipo === "sku_nao_mapeado" ||
                    c.tipo === "faturador_nao_configurado"
                      ? "bg-critico"
                      : "bg-atencao"
                  }`}
                />
                <div className="flex flex-1 flex-wrap items-center gap-5 px-4 py-[14px]">
                  <div className="min-w-0 flex-1">
                    <h3 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">
                      {ROTULO[c.tipo] ?? c.causa}
                    </h3>
                    <p className="mt-1 text-[12px] text-suave">
                      {c.contas.length === 1
                        ? `conta ${c.contas[0]}`
                        : `contas ${c.contas.join(", ")}`}
                      {" · primeira ocorrência "}
                      {new Date(c.primeira_ocorrencia).toLocaleString("pt-BR", {
                        dateStyle: "short",
                        timeStyle: "short",
                        timeZone: "America/Sao_Paulo",
                      })}
                    </p>

                    {(c.detalhe || c.codigo) && (
                      <p className="mt-2 inline-block rounded-md border border-[#E9DFDB] bg-[#F6F1EE] px-[9px] py-[6px] font-mono text-[11.5px] text-[#5A4B49]">
                        {c.codigo && `${c.codigo} — `}
                        {c.detalhe ?? c.causa}
                      </p>
                    )}

                    {c.campo_a_corrigir && (
                      <p className="mt-2 text-[12px] text-suave">
                        O Mercado Livre aponta o campo:{" "}
                        <code className="font-mono font-semibold text-tinta">
                          {c.campo_a_corrigir}
                        </code>
                      </p>
                    )}
                  </div>

                  <div className="w-[96px] shrink-0 text-right">
                    <div className="font-mono text-[22px] font-semibold tracking-[-0.02em] tabular-nums">
                      {c.pacotes}
                    </div>
                    <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-suave">
                      {c.pacotes === 1 ? "pedido" : "pedidos"}
                    </div>
                  </div>

                  {FISCAIS.has(c.tipo) ? (
                    <form action={reprocessarCausa} className="shrink-0">
                      <input type="hidden" name="tipo" value={c.tipo} />
                      <input type="hidden" name="codigo" value={c.codigo ?? ""} />
                      <button
                        type="submit"
                        className="rounded-lg bg-tinta px-3 py-[7px] text-[12.5px] font-semibold text-white"
                      >
                        Pedir a nota de novo
                      </button>
                    </form>
                  ) : (
                    <span className="max-w-[26ch] shrink-0 text-right text-[11.5px] text-suave">
                      {c.tipo === "sku_nao_mapeado"
                        ? "destrava sozinho quando o anúncio for mapeado"
                        : "não se resolve pedindo nota de novo"}
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * O que aconteceu com o lote. Contagem explícita, porque "reprocessado" sem
 * número não diz se resolveu trinta ou nenhum.
 */
function AvisoReprocesso({ resultado }: { resultado: string }) {
  if (resultado === "servico_nao_publicado") {
    return (
      <Faixa tom="atencao">
        A emissão ainda não está ligada: falta conectar as contas do Mercado
        Livre. Nenhuma nota foi pedida.
      </Faixa>
    );
  }

  if (resultado === "nada_a_fazer") {
    return <Faixa tom="neutro">Não havia pedido nenhum nesta causa.</Faixa>;
  }

  if (resultado === "sem_sessao") {
    return <Faixa tom="critico">Sua sessão expirou. Entre de novo.</Faixa>;
  }

  const [ok, falhou, motivo] = resultado.split("-");
  const autorizadas = Number(ok);
  const rejeitadas = Number(falhou);

  if (Number.isNaN(autorizadas) || Number.isNaN(rejeitadas)) {
    return <Faixa tom="critico">Não foi possível reprocessar.</Faixa>;
  }

  return (
    <Faixa tom={rejeitadas > 0 ? "atencao" : "ok"}>
      {autorizadas > 0 && (
        <>
          <b>{autorizadas}</b>
          {autorizadas === 1 ? " nota autorizada" : " notas autorizadas"}
        </>
      )}
      {autorizadas > 0 && rejeitadas > 0 && " · "}
      {rejeitadas > 0 && (
        <>
          <b>{rejeitadas}</b>
          {rejeitadas === 1 ? " continua parada" : " continuam paradas"}
          {motivo && ` (${decodeURIComponent(motivo)})`}
        </>
      )}
    </Faixa>
  );
}

function Faixa({
  tom,
  children,
}: {
  tom: "ok" | "atencao" | "critico" | "neutro";
  children: React.ReactNode;
}) {
  const estilo =
    tom === "ok"
      ? "border-ok-linha bg-ok-bg text-ok"
      : tom === "atencao"
        ? "border-atencao-linha bg-atencao-bg text-atencao"
        : tom === "critico"
          ? "border-critico-linha bg-critico-bg text-critico"
          : "border-linha bg-fundo text-suave";

  return (
    <p
      role="status"
      className={`m-0 border-b px-5 py-[10px] text-[12.5px] font-semibold ${estilo}`}
    >
      {children}
    </p>
  );
}
