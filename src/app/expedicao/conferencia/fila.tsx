import Link from "next/link";
import type { Etapa } from "@/lib/supabase/tipos";

export type PacoteNaFila = {
  id: string;
  etapa: Etapa;
  etapa_desde: string;
  unidades_esperadas: number | null;
  envios: {
    ref_externa: string;
    limite_envio_em: string | null;
    etiqueta_obtida_em: string | null;
    modalidades: { nome: string } | null;
    pedidos: { ref_externa: string; pack_ref: string | null }[];
  } | null;
  contas: { apelido: string; empresas: { nome_curto: string } | null } | null;
};

/**
 * A coluna da esquerda: quem está na fila desta etapa.
 *
 * Mora fora do painel porque duas telas mostram a mesma fila — o pedido
 * aberto e a espera do bipe. Duas cópias desta lista acabam divergindo, e
 * divergir aqui é a bancada ver uma fila na tela do pedido e outra ao voltar.
 */
export function FilaDePacotes({
  fila,
  etapa,
  selecionado,
}: {
  fila: PacoteNaFila[];
  etapa: Etapa;
  /** Qual está aberto agora. Nenhum, quando se espera o bipe. */
  selecionado?: string;
}) {
  return (
    <aside className="flex w-[330px] shrink-0 flex-col border-r border-linha">
      <div className="flex items-center gap-2 border-b border-linha bg-fundo px-4 py-[10px] text-[12px] text-suave">
        <b className="font-semibold text-tinta">{fila.length}</b>
        {fila.length === 1 ? " pacote" : " pacotes"}
        <span className="flex-1" />
        <Link
          href={`/expedicao?etapa=${etapa}`}
          className="text-[12px] font-semibold text-tinta no-underline"
        >
          Ver lista inteira
        </Link>
      </div>

      <ul className="m-0 list-none overflow-y-auto p-0">
        {fila.map((p) => {
          const ativo = p.id === selecionado;
          const pedidos = p.envios?.pedidos ?? [];
          return (
            <li key={p.id}>
              <Link
                href={`/expedicao?etapa=${etapa}&pacote=${p.id}`}
                aria-current={ativo ? "true" : undefined}
                className={`flex items-center gap-3 border-b border-linha-suave px-4 py-[10px] no-underline ${
                  ativo
                    ? "bg-[#F4F1E8] shadow-[inset_3px_0_0_var(--color-tinta)]"
                    : ""
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
    </aside>
  );
}
