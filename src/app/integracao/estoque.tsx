import { criarClienteServidor } from "@/lib/supabase/server";
import { salvarDeposito, tentarBaixaDeNovo } from "./estoque-acoes";

type Config = {
  deposito_ref: string | null;
  ativo: boolean;
  atualizado_em: string;
};

type Baixa = {
  id: string;
  tipo: string;
  situacao: string;
  tentativas: number;
  erro: string | null;
  deposito_ref: string | null;
  criada_em: string;
  pedidos: { ref_externa: string } | null;
};

/**
 * A baixa de estoque no ERP.
 *
 * A baixa acontece na autorização da NF-e e não na saída da caixa: o Bling
 * reflete estoque para a Lexos, que controla os anúncios. Enquanto a baixa não
 * acontece, a peça segue disponível e o canal pode vender de novo — e entre a
 * venda e a expedição passam horas.
 */
export async function Estoque({ falha }: { falha?: string }) {
  const supabase = await criarClienteServidor();

  const [{ data: config }, { data: fila }] = await Promise.all([
    supabase
      .from("erp_config")
      .select("deposito_ref, ativo, atualizado_em")
      .maybeSingle(),
    supabase
      .from("baixas_estoque")
      .select(
        "id, tipo, situacao, tentativas, erro, deposito_ref, criada_em, pedidos ( ref_externa )",
      )
      .neq("situacao", "enviada")
      .order("criada_em", { ascending: false })
      .limit(30),
  ]);

  const c = (config ?? null) as Config | null;
  const pendentes = ((fila ?? []) as unknown as Baixa[]).filter(
    (b) => b.situacao === "pendente",
  );
  const comErro = ((fila ?? []) as unknown as Baixa[]).filter(
    (b) => b.situacao === "erro",
  );

  return (
    <div className="flex flex-col gap-5 p-5">
      {falha && <Aviso resultado={falha} />}

      <form
        action={salvarDeposito}
        className="max-w-[560px] rounded-[9px] border border-linha px-4 py-[14px]"
      >
        <h3 className="m-0 text-[14px] font-bold tracking-[-0.01em]">
          Depósito do Bling
        </h3>
        <p className="mb-3 mt-1 text-[12.5px] leading-relaxed text-suave">
          De qual depósito o estoque sai. Hoje é um só. Se mudar, as baixas
          novas vão para o depósito novo — e um estorno de baixa antiga volta
          para onde a peça realmente saiu, não para o depósito atual.
        </p>

        <label
          htmlFor="erp-deposito"
          className="mb-[6px] block text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave"
        >
          Identificador do depósito
        </label>
        <input
          id="erp-deposito"
          name="deposito"
          defaultValue={c?.deposito_ref ?? ""}
          placeholder="o id do depósito no Bling"
          className="mb-3 w-full rounded-lg border border-linha bg-superficie px-3 py-[9px] font-mono text-[13.5px]"
        />

        <label
          htmlFor="erp-ativo"
          className="mb-3 flex cursor-pointer items-baseline gap-[9px] text-[13px]"
        >
          <input
            id="erp-ativo"
            type="checkbox"
            name="ativo"
            defaultChecked={c?.ativo ?? false}
            className="accent-[var(--color-tinta)]"
          />
          <span>
            <b className="font-semibold">Enviar as baixas para o Bling</b>
            <span className="block text-[12px] text-suave">
              Desligado, a baixa entra na fila e fica esperando. Nada se perde —
              e nada é enviado.
            </span>
          </span>
        </label>

        <button
          type="submit"
          className="rounded-lg bg-tinta px-4 py-[9px] text-[13px] font-semibold text-white"
        >
          Salvar
        </button>
      </form>

      <section>
        <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave">
          Fila de baixas
        </h3>

        {pendentes.length === 0 && comErro.length === 0 ? (
          <p className="m-0 text-[13px] text-suave">
            Nada esperando. A fila enche quando uma nota é autorizada.
          </p>
        ) : (
          <>
            <p className="m-0 mb-3 text-[12.5px] text-suave">
              <b className="font-semibold text-tinta">{pendentes.length}</b>{" "}
              esperando envio
              {comErro.length > 0 && (
                <>
                  {" · "}
                  <b className="font-semibold text-critico">
                    {comErro.length}
                  </b>{" "}
                  com erro
                </>
              )}
            </p>

            <div className="overflow-x-auto rounded-[9px] border border-linha">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {["Pedido", "Tipo", "Depósito", "Situação", "Quando"].map(
                      (h) => (
                        <th
                          key={h}
                          className="whitespace-nowrap border-b border-linha px-4 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.12em] text-suave"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {[...comErro, ...pendentes].map((b) => (
                    <tr key={b.id}>
                      <td className="border-b border-linha-suave px-4 py-3 font-mono text-[12.5px] font-semibold">
                        {b.pedidos?.ref_externa ?? "—"}
                      </td>
                      <td className="border-b border-linha-suave px-4 py-3 text-[12.5px]">
                        {b.tipo === "estorno" ? "Estorno" : "Baixa"}
                      </td>
                      <td className="border-b border-linha-suave px-4 py-3 font-mono text-[11.5px] text-suave">
                        {b.deposito_ref ?? "não definido"}
                      </td>
                      <td className="border-b border-linha-suave px-4 py-3">
                        {b.situacao === "erro" ? (
                          <>
                            <Selo tom="critico">Erro</Selo>
                            {b.erro && (
                              <div className="mt-[3px] max-w-[40ch] text-[11px] text-suave">
                                {b.erro}
                              </div>
                            )}
                          </>
                        ) : (
                          <Selo tom="atencao">Esperando</Selo>
                        )}
                        {b.tentativas > 1 && (
                          <div className="mt-[2px] text-[11px] text-suave">
                            {b.tentativas} tentativas
                          </div>
                        )}
                      </td>
                      <td className="border-b border-linha-suave px-4 py-3 text-[12px] text-suave">
                        {new Date(b.criada_em).toLocaleString("pt-BR", {
                          dateStyle: "short",
                          timeStyle: "short",
                          timeZone: "America/Sao_Paulo",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {comErro.length > 0 && (
              <form action={tentarBaixaDeNovo} className="mt-3">
                <button
                  type="submit"
                  className="rounded-lg border border-linha px-4 py-[9px] text-[13px] font-semibold"
                >
                  Tentar as {comErro.length} de novo
                </button>
              </form>
            )}
          </>
        )}
      </section>

      <p className="m-0 max-w-[70ch] text-[12.5px] leading-relaxed text-suave">
        O anúncio e o controle continuam na Lexos. O ZYNTRA só dá a baixa: o
        Bling reflete para lá. A baixa é do SKU vendido, na quantidade vendida.
      </p>
    </div>
  );
}

function Aviso({ resultado }: { resultado: string }) {
  const texto: Record<string, string> = {
    deposito_salvo: "Depósito salvo.",
    erp_ligado:
      "Envio ligado. As baixas que estavam esperando vão sair na próxima tentativa.",
    erp_desligado:
      "Envio desligado. As baixas continuam entrando na fila, sem sair.",
    refila: "As baixas com erro voltaram para a fila.",
    sem_permissao: "Só administrador muda a configuração do estoque.",
    erro: "Não foi possível salvar.",
  };

  const ok = ["deposito_salvo", "erp_ligado", "erp_desligado", "refila"].includes(
    resultado,
  );

  return (
    <p
      role="status"
      className={`m-0 rounded-lg border px-4 py-3 text-[12.5px] font-semibold ${
        ok
          ? "border-ok-linha bg-ok-bg text-ok"
          : "border-critico-linha bg-critico-bg text-critico"
      }`}
    >
      {texto[resultado] ?? texto.erro}
    </p>
  );
}

function Selo({
  tom,
  children,
}: {
  tom: "atencao" | "critico";
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-[9px] py-[3px] text-[11.5px] font-semibold ${
        tom === "critico"
          ? "bg-critico-bg text-critico border-critico-linha"
          : "bg-atencao-bg text-atencao border-atencao-linha"
      }`}
    >
      {children}
    </span>
  );
}
