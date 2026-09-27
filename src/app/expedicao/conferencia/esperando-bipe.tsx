import { criarClienteServidor } from "@/lib/supabase/server";
import { Botao } from "@/components/botao";
import { FilaDePacotes, type PacoteNaFila } from "./fila";
import { acharPedido, alternarModoBipagem } from "../bipagem-acoes";
import { CampoQueFocaSozinho } from "../campo-bipagem";

/**
 * A tela do modo bipagem: o pedido antes de existir.
 *
 * Tem a forma exata do pedido aberto — fila à esquerda, dados em cima, tabela
 * embaixo — só que vazia, esperando. É de propósito: quando o bipe acerta, o
 * conteúdo aparece no lugar onde os olhos já estavam. Uma tela de espera com
 * outro desenho faria a bancada reencontrar tudo a cada caixa.
 */
export async function EsperandoBipe({
  fila,
  bipe,
  codigo,
  veValores,
}: {
  fila: PacoteNaFila[];
  /** O que aconteceu no último bipe: nenhum, varios, erro. */
  bipe?: string;
  codigo?: string;
  veValores: boolean;
}) {
  return (
    <div className="flex flex-1">
      <FilaDePacotes fila={fila} etapa="conferir" />

      <section className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex flex-1 flex-col gap-5 p-5">
          <div className="flex flex-wrap items-start gap-6">
            {/* Os dados do pedido, no lugar em que vão aparecer. */}
            <dl className="m-0 grid min-w-[300px] flex-1 grid-cols-[auto_1fr] gap-x-4 gap-y-[10px] text-[13px]">
              {["Cliente", "Loja", "Transportadora", "Data limite", "Nota fiscal"].map(
                (r, i) => (
                  <Fragmento key={r} rotulo={r} largura={[62, 48, 74, 40, 56][i]} />
                ),
              )}
            </dl>

            <Ilustracao />
          </div>

          {/* ------------------------------------------------- o bipe */}
          <form action={acharPedido} className="flex flex-wrap items-center gap-3">
            <CampoQueFocaSozinho />
            <Botao
              trabalhando="Procurando…"
              className="rounded-lg bg-tinta px-4 py-[9px] text-[13px] font-semibold text-white"
            >
              Achar o pedido
            </Botao>
            <span className="text-[12px] text-suave">
              Vale o código de barras do produto ou o código do SKU.
            </span>
          </form>

          {bipe && <Resposta bipe={bipe} codigo={codigo} />}

          {/* ------------------------------------------------ a tabela */}
          <div className="overflow-x-auto rounded-[10px] border border-linha">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {["Sku", "Descrição", "Qtd", ...(veValores ? ["Preço"] : []), "Lido"].map(
                    (c) => (
                      <th
                        key={c}
                        className="whitespace-nowrap border-b border-linha bg-fundo px-3 py-[10px] text-left text-[10.5px] font-semibold uppercase tracking-[0.12em] text-suave"
                      >
                        {c}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td
                    colSpan={veValores ? 5 : 4}
                    className="px-3 py-12 text-center text-[13px] text-suave"
                  >
                    Os itens aparecem aqui quando o pedido abrir.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* O selo fica flutuando no canto, como na Lexos: o modo vale para a
            bancada inteira, então não some quando a tela rola. */}
        <div className="sticky bottom-0 ml-auto flex items-center gap-3 rounded-tl-[12px] border-l border-t border-grafite-linha bg-grafite px-4 py-3">
          <span className="text-[12.5px] font-semibold text-white">
            Modo bipagem ativo
            <span className="mt-[1px] block text-[11px] font-normal text-white/60">
              bipe e o pedido abre sozinho
            </span>
          </span>
          <form action={alternarModoBipagem}>
            <input type="hidden" name="ligar" value="0" />
            <button
              type="submit"
              className="rounded-lg bg-critico px-3 py-[7px] text-[12.5px] font-semibold text-white"
            >
              Desativar
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}

/** Um rótulo do pedido com a barra cinza no lugar do valor que vai vir. */
function Fragmento({ rotulo, largura }: { rotulo: string; largura: number }) {
  return (
    <>
      <dt className="font-medium text-suave">{rotulo}:</dt>
      <dd className="m-0">
        <span
          aria-hidden
          className="block h-[11px] rounded-full bg-linha-suave"
          style={{ width: `${largura}%`, maxWidth: "100%" }}
        />
      </dd>
    </>
  );
}

/**
 * A caixa e o leitor.
 *
 * SVG e não imagem: são quatro formas, e um arquivo a mais para baixar numa
 * máquina de galpão é um arquivo a mais para não carregar.
 */
function Ilustracao() {
  return (
    <div className="flex items-center gap-3">
      <span className="max-w-[26ch] rounded-[10px] bg-grafite px-3 py-2 text-[12.5px] leading-snug text-white">
        Bipe um produto para abrir o pedido pronto para a conferência
      </span>

      <svg
        width="150"
        height="120"
        viewBox="0 0 150 120"
        fill="none"
        aria-hidden
        className="shrink-0"
      >
        <rect x="2" y="2" width="146" height="116" rx="12" fill="#F4F1E8" />

        {/* a caixa */}
        <path d="M38 44h58v46H38z" fill="#fff" stroke="#C9C2B4" strokeWidth="2" />
        <path d="M38 44l10-12h58l-10 12" fill="#fff" stroke="#C9C2B4" strokeWidth="2" strokeLinejoin="round" />
        <path d="M96 44l10-12v46l-10 12" fill="#EFEADF" stroke="#C9C2B4" strokeWidth="2" strokeLinejoin="round" />

        {/* a etiqueta com o código */}
        <rect x="50" y="56" width="34" height="22" rx="2" fill="#fff" stroke="#C9C2B4" />
        {[54, 57, 61, 64, 68, 71, 75, 78].map((x, i) => (
          <rect
            key={x}
            x={x}
            y="60"
            width={i % 3 === 0 ? 2 : 1}
            height="14"
            fill="#2B2B2B"
          />
        ))}

        {/* o feixe do leitor */}
        <path d="M108 40l-16 16" stroke="#C0392B" strokeWidth="2" strokeLinecap="round" />
        <path d="M114 46l-12 12" stroke="#C0392B" strokeWidth="2" strokeLinecap="round" opacity=".55" />
        <rect x="104" y="24" width="30" height="16" rx="4" transform="rotate(45 104 24)" fill="#2B2B2B" />
      </svg>
    </div>
  );
}

/** O que houve com o último bipe, em português e dizendo o que fazer. */
async function Resposta({ bipe, codigo }: { bipe: string; codigo?: string }) {
  if (bipe === "nenhum") {
    return (
      <p className="m-0 rounded-[9px] border border-atencao-linha bg-atencao-bg px-4 py-3 text-[13px] text-atencao">
        <b className="font-semibold">{codigo}</b> não está em nenhum pedido
        desta aba. Ou a caixa é de outra etapa, ou este produto ainda não tem
        código de barras no catálogo.
      </p>
    );
  }

  if (bipe === "erro") {
    return (
      <p className="m-0 rounded-[9px] border border-critico-linha bg-critico-bg px-4 py-3 text-[13px] text-critico">
        Não foi possível procurar agora. Bipe de novo.
      </p>
    );
  }

  if (bipe !== "varios" || !codigo) return null;

  // Mais de um pedido tem este produto. Mostrar quais e deixar a pessoa
  // apontar é mais barato que abrir a caixa errada.
  const supabase = await criarClienteServidor();
  const { data } = await supabase.rpc("achar_pacote_por_codigo", {
    p_codigo: codigo,
  });

  const achados = (data ?? []) as {
    pacote_id: string;
    pedido: string;
    cliente: string;
    conta: string;
    unidades: number;
    ja_aberta: boolean;
  }[];

  return (
    <div className="rounded-[9px] border border-atencao-linha bg-atencao-bg px-4 py-3">
      <p className="m-0 mb-2 text-[13px] text-atencao">
        <b className="font-semibold">{achados.length} pedidos</b> desta aba têm
        este produto. Qual é a caixa que está na sua mão?
      </p>
      <div className="flex flex-wrap gap-2">
        {achados.map((a) => (
          <a
            key={a.pacote_id}
            href={`/expedicao?etapa=conferir&pacote=${a.pacote_id}`}
            className="rounded-lg border border-linha bg-superficie px-3 py-2 text-[12.5px] no-underline"
          >
            <span className="block font-mono font-semibold">{a.pedido}</span>
            <span className="block text-[11.5px] text-suave">
              {a.cliente} · {a.conta} · {a.unidades}{" "}
              {a.unidades === 1 ? "unidade" : "unidades"}
              {a.ja_aberta ? " · conferência aberta" : ""}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
