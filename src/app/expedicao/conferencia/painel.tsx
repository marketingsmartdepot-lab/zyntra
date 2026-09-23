import Link from "next/link";
import { criarClienteServidor } from "@/lib/supabase/server";
import { Bancada, type ItemConferido } from "./bancada";
import { iniciarConferencia } from "./acoes";

type PacoteNaFila = {
  id: string;
  unidades_esperadas: number | null;
  envios: {
    ref_externa: string;
    limite_envio_em: string | null;
    modalidades: { nome: string } | null;
    pedidos: { ref_externa: string }[];
  } | null;
  contas: { apelido: string; empresas: { nome_curto: string } | null } | null;
};

export async function PainelConferencia({
  fila,
  pacoteId,
}: {
  fila: PacoteNaFila[];
  pacoteId?: string;
}) {
  const selecionado = pacoteId
    ? (fila.find((p) => p.id === pacoteId) ?? null)
    : (fila[0] ?? null);

  return (
    <div className="flex flex-1">
      <aside className="flex w-[380px] shrink-0 flex-col border-r border-linha">
        <div className="flex items-center gap-2 border-b border-linha bg-fundo px-4 py-[11px] text-[12.5px] text-suave">
          <b className="font-semibold text-tinta">{fila.length}</b>
          {fila.length === 1 ? " pacote na fila" : " pacotes na fila"}
        </div>

        {fila.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-suave">
            Nada esperando a bancada. Os pacotes chegam aqui quando a lista de
            separação é concluída.
          </p>
        ) : (
          <ul className="m-0 list-none p-0">
            {fila.map((p) => {
              const ativo = selecionado?.id === p.id;
              const pedidos = p.envios?.pedidos ?? [];
              return (
                <li key={p.id}>
                  <Link
                    href={`/expedicao?etapa=conferir&pacote=${p.id}`}
                    aria-current={ativo ? "true" : undefined}
                    className={`flex items-center gap-3 border-b border-linha-suave px-4 py-[10px] no-underline ${
                      ativo ? "bg-[#F4F1E8] shadow-[inset_3px_0_0_var(--color-tinta)]" : ""
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-[12px] font-semibold tracking-[-0.02em]">
                        {pedidos[0]?.ref_externa ??
                          p.envios?.ref_externa ??
                          "sem código"}
                      </span>
                      <span className="mt-[1px] block truncate text-[11px] text-suave">
                        {p.contas?.apelido ?? "—"}
                        {pedidos.length > 1 && ` · pack ${pedidos.length}`}
                        {p.envios?.modalidades &&
                          ` · ${p.envios.modalidades.nome}`}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[12.5px] font-semibold text-suave">
                      {p.unidades_esperadas ?? "—"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {selecionado ? (
          <Aberto pacote={selecionado} fila={fila} />
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 py-20">
            <p className="max-w-[46ch] text-center text-[14px] leading-relaxed text-suave">
              Escolha um pacote na fila para abrir a bancada. Nada é conferido
              sem que alguém abra a passagem — é ela que congela o que tem que
              estar na caixa.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

async function Aberto({
  pacote,
  fila,
}: {
  pacote: PacoteNaFila;
  fila: PacoteNaFila[];
}) {
  const supabase = await criarClienteServidor();

  const { data: conferencias } = await supabase
    .from("conferencias")
    .select("id")
    .eq("pacote_id", pacote.id)
    .eq("situacao", "em_andamento")
    .limit(1);

  const conferencia = conferencias?.[0];
  const pedidos = pacote.envios?.pedidos ?? [];
  const proximo = fila.find((p) => p.id !== pacote.id)?.id ?? null;

  let itens: ItemConferido[] = [];
  if (conferencia) {
    const { data } = await supabase
      .from("conferencia_itens")
      .select(
        "sku_id, quantidade_esperada, quantidade_lida, skus ( codigo, descricao )",
      )
      .eq("conferencia_id", conferencia.id);

    itens = ((data ?? []) as unknown as RawItem[]).map((i) => ({
      sku_id: i.sku_id,
      codigo: i.skus?.codigo ?? "—",
      descricao: i.skus?.descricao ?? "Produto sem descrição",
      quantidade_esperada: i.quantidade_esperada,
      quantidade_lida: i.quantidade_lida,
      eh_kit: false,
    }));
  }

  return (
    <>
      <header className="flex flex-wrap items-center gap-3 px-6 pb-0 pt-5">
        <h1 className="m-0 text-[21px] font-bold tracking-[-0.025em]">
          Conferência{" "}
          <span className="font-mono font-semibold">
            {pedidos[0]?.ref_externa ?? pacote.envios?.ref_externa}
          </span>
        </h1>
        {pedidos.length > 1 && (
          <span className="rounded-full border border-linha px-[9px] py-[3px] text-[11.5px] font-semibold text-suave">
            pack · {pedidos.length} pedidos
          </span>
        )}
      </header>

      <dl className="grid grid-cols-[auto_1fr_auto_1fr] items-baseline gap-x-[14px] gap-y-[7px] px-6 py-4 text-[13px]">
        <dt className="font-medium text-suave">Conta</dt>
        <dd className="m-0 font-semibold">{pacote.contas?.apelido ?? "—"}</dd>
        <dt className="font-medium text-suave">Modalidade</dt>
        <dd className="m-0 font-semibold">
          {pacote.envios?.modalidades?.nome ?? "não classificada"}
        </dd>
        <dt className="font-medium text-suave">Empresa emissora</dt>
        <dd className="m-0 font-semibold">
          {pacote.contas?.empresas?.nome_curto ?? "—"}
        </dd>
        <dt className="font-medium text-suave">Data limite</dt>
        <dd className="m-0 font-semibold">
          {pacote.envios?.limite_envio_em
            ? new Date(pacote.envios.limite_envio_em).toLocaleString("pt-BR", {
                dateStyle: "short",
                timeStyle: "short",
                timeZone: "America/Sao_Paulo",
              })
            : "sem prazo do canal"}
        </dd>
      </dl>

      {conferencia ? (
        <Bancada
          conferenciaId={conferencia.id}
          itensIniciais={itens}
          proximoPacote={proximo}
        />
      ) : (
        <IniciarBancada pacoteId={pacote.id} />
      )}
    </>
  );
}

type RawItem = {
  sku_id: string;
  quantidade_esperada: number;
  quantidade_lida: number;
  skus: { codigo: string; descricao: string } | null;
};

function IniciarBancada({ pacoteId }: { pacoteId: string }) {
  async function abrir() {
    "use server";
    await iniciarConferencia(pacoteId);
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <p className="max-w-[48ch] text-[14px] leading-relaxed text-suave">
        Abrir a conferência congela o que tem que estar na caixa, já expandindo
        kit. O catálogo pode mudar no meio do turno, mas a caixa que o operador
        tem na mão é a de agora.
      </p>
      <form action={abrir}>
        <button
          type="submit"
          className="rounded-[10px] bg-tinta px-[22px] py-[13px] text-[15px] font-semibold text-white"
        >
          Abrir a bancada
        </button>
      </form>
    </div>
  );
}
