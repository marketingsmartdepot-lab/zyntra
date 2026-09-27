import { criarClienteServidor } from "@/lib/supabase/server";
import { Botao } from "@/components/botao";
import { acharPedido, alternarModoBipagem } from "./bipagem-acoes";
import { CampoQueFocaSozinho } from "./campo-bipagem";

/**
 * O modo bipagem da aba Conferir.
 *
 * Desligado, a bancada escolhe o pedido na lista e depois bipa. Ligado, ela
 * bipa primeiro e o sistema acha o pedido — que é a ordem natural de quem
 * está com a caixa na mão e as duas mãos ocupadas.
 *
 * Fica só em Conferir. Nas outras abas o pedido ainda não é uma caixa aberta
 * na bancada, e bipar ali não quer dizer nada.
 */
export async function ModoBipagem({
  ligado,
  bipe,
  codigo,
}: {
  ligado: boolean;
  /** O que aconteceu no último bipe: nenhum, varios, erro. */
  bipe?: string;
  codigo?: string;
}) {
  if (!ligado) {
    return (
      <div className="flex flex-wrap items-center gap-3 border-b border-linha bg-fundo px-5 py-[10px]">
        <form action={alternarModoBipagem}>
          <input type="hidden" name="ligar" value="1" />
          <button
            type="submit"
            className="rounded-lg border border-linha bg-superficie px-3 py-[7px] text-[12.5px] font-semibold"
          >
            Ligar modo bipagem
          </button>
        </form>
        <span className="text-[12px] text-suave">
          Com ele ligado você bipa o produto e o sistema abre o pedido, sem
          escolher na lista.
        </span>
      </div>
    );
  }

  return (
    <div className="border-b border-linha bg-fundo px-5 py-[10px]">
      <div className="flex flex-wrap items-center gap-3">
        <form action={acharPedido} className="flex items-center gap-2">
          <CampoQueFocaSozinho />
          <Botao
            trabalhando="Procurando…"
            className="rounded-lg bg-tinta px-4 py-[9px] text-[13px] font-semibold text-white"
          >
            Achar
          </Botao>
        </form>

        <span className="flex-1" />

        <span className="rounded-md border border-ok-linha bg-ok-bg px-[9px] py-[3px] text-[12px] font-semibold text-ok">
          Modo bipagem ativo
        </span>

        <form action={alternarModoBipagem}>
          <input type="hidden" name="ligar" value="0" />
          <button
            type="submit"
            className="rounded-lg border border-linha bg-superficie px-3 py-[7px] text-[12.5px] font-semibold"
          >
            Desativar
          </button>
        </form>
      </div>

      {bipe && <Resposta bipe={bipe} codigo={codigo} />}
    </div>
  );
}

/** O que houve com o último bipe, em português e dizendo o que fazer. */
async function Resposta({ bipe, codigo }: { bipe: string; codigo?: string }) {
  if (bipe === "nenhum") {
    return (
      <p className="m-0 mt-2 text-[12.5px] text-atencao">
        <b className="font-semibold">{codigo}</b> não está em nenhum pedido
        desta aba. Ou a caixa é de outra etapa, ou este produto não tem código
        de barras no catálogo.
      </p>
    );
  }

  if (bipe === "erro") {
    return (
      <p className="m-0 mt-2 text-[12.5px] text-critico">
        Não foi possível procurar agora. Bipe de novo.
      </p>
    );
  }

  if (bipe !== "varios" || !codigo) return null;

  // Mais de um pedido tem este produto. Mostrar os dois e deixar a pessoa
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
    <div className="mt-2">
      <p className="m-0 mb-[6px] text-[12.5px] text-atencao">
        <b className="font-semibold">{achados.length} pedidos</b> desta aba têm
        este produto. Qual é a caixa que está na sua mão?
      </p>
      <div className="flex flex-wrap gap-2">
        {achados.map((a) => (
          <a
            key={a.pacote_id}
            href={`/expedicao?etapa=conferir&pacote=${a.pacote_id}`}
            className="rounded-lg border border-linha bg-superficie px-3 py-2 text-[12.5px]"
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
