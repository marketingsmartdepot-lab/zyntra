import { imprimirEtiqueta } from "../etiqueta";
import { textoDoMotivo } from "../etiqueta-motivos";

export type ImpressaoDaEtiqueta = {
  situacao: string;
  erro: string | null;
  enviada_em: string;
  reimpressao: boolean;
  confirmada_em: string | null;
  confirmada_codigo: string | null;
};

/**
 * A etiqueta do canal saindo em papel.
 *
 * Hoje ela sai sozinha, no bipe que completa a caixa. Este painel é a
 * segunda via: ver o que aconteceu e reimprimir quando o papel rasga.
 *
 * NÃO PEDE BIPE AQUI. O bipe da etiqueta é um só, na saída da doca, e é ele
 * que carimba a confirmação — decisão da Daniele em 23/10. Pedir aqui também
 * dobrava o gesto e, pior, travava a doca de uma caixa pronta e etiquetada
 * sem ninguém entender o que faltava.
 *
 * Reimprimir exige motivo. Etiqueta é rastreada pelo canal: duas iguais
 * circulando é problema de verdade, e o motivo é o que explica a segunda.
 */
export function PainelEtiqueta({
  pacoteId,
  impressoes,
  resultado,
}: {
  pacoteId: string;
  impressoes: ImpressaoDaEtiqueta[];
  resultado?: string;
}) {
  const jaSaiu = impressoes.some((i) => i.situacao === "impressa");
  const naFila = impressoes.some(
    (i) => i.situacao === "pendente" || i.situacao === "entregue_ao_agente",
  );
  const ultimoErro = impressoes.find((i) => i.situacao === "erro");
  const confirmada = impressoes.find((i) => i.confirmada_em !== null);
  const precisaMotivo =
    jaSaiu || resultado === "motivo_reimpressao_obrigatorio";

  return (
    <section className="mx-6 mb-5 overflow-hidden rounded-[10px] border border-linha">
      <header className="flex flex-wrap items-center gap-3 border-b border-linha bg-fundo px-4 py-3">
        <h3 className="m-0 text-[14px] font-bold tracking-[-0.01em]">
          Etiqueta de envio
        </h3>
        {/*
          A fila vem antes de tudo: numa reimpressão a etiqueta antiga está
          confirmada e a nova ainda está na fila, e dizer "confirmada" ali
          seria mentira sobre o papel que está na mesa agora.

          Não existe mais "Esperando confirmação": ninguém bipa etiqueta na
          bancada, então esse estado seria uma cobrança sem dono.
        */}
        {naFila ? (
          <Selo tom="atencao">Na fila da impressora</Selo>
        ) : confirmada ? (
          <Selo tom="ok">Confirmada na saída</Selo>
        ) : jaSaiu ? (
          <Selo tom="ok">Impressa</Selo>
        ) : (
          <Selo tom="neutro">Não impressa</Selo>
        )}
        <span className="flex-1" />
        <span className="text-[12px] text-suave">
          {impressoes.length === 0
            ? "buscada no canal na hora de imprimir"
            : `${impressoes.length} ${impressoes.length === 1 ? "pedido" : "pedidos"} de impressão`}
        </span>
      </header>

      {resultado && <Aviso resultado={resultado} />}

      {ultimoErro?.erro && !resultado && (
        <p className="m-0 border-b border-linha px-4 py-[10px] text-[12.5px] text-critico">
          A última tentativa falhou na impressora: {ultimoErro.erro}
        </p>
      )}

      {confirmada && (
        <p className="m-0 border-b border-linha px-4 py-[10px] text-[12.5px] text-suave">
          Etiqueta bipada na saída em{" "}
          {new Date(confirmada.confirmada_em!).toLocaleString("pt-BR", {
            dateStyle: "short",
            timeStyle: "short",
            timeZone: "America/Sao_Paulo",
          })}
          {confirmada.confirmada_codigo && (
            <>
              {" · "}
              <span className="font-mono">{confirmada.confirmada_codigo}</span>
            </>
          )}
        </p>
      )}

      <form
        action={imprimirEtiqueta}
        className="flex flex-wrap items-end gap-3 px-4 py-[14px]"
      >
        <input type="hidden" name="pacote" value={pacoteId} />

        {precisaMotivo && (
          <div className="min-w-[260px] flex-1">
            <label
              htmlFor="etq-motivo"
              className="mb-[6px] block text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave"
            >
              Motivo da reimpressão
            </label>
            <input
              id="etq-motivo"
              name="motivo"
              required
              placeholder="ex.: etiqueta rasgou ao descolar"
              className="w-full rounded-lg border border-linha bg-superficie px-3 py-[9px] text-[13.5px]"
            />
          </div>
        )}

        <button
          type="submit"
          className="rounded-lg bg-tinta px-4 py-[9px] text-[13px] font-semibold text-white"
        >
          {precisaMotivo ? "Reimprimir etiqueta" : "Imprimir etiqueta"}
        </button>

        <span className="text-[12px] text-suave">
          Sai na impressora desta bancada.
        </span>
      </form>
    </section>
  );
}

/**
 * As frases vivem em `etiqueta-motivos`, porque a bancada de conferência
 * também mostra estas recusas agora — a etiqueta sai no bipe que completa a
 * caixa, e a recusa aparece lá, não aqui.
 */
function Aviso({ resultado }: { resultado: string }) {
  if (resultado === "ok") {
    return (
      <p className="m-0 border-b border-ok-linha bg-ok-bg px-4 py-[10px] text-[12.5px] font-semibold text-ok">
        Etiqueta enviada para a impressora desta bancada.
      </p>
    );
  }

  const tom =
    resultado === "motivo_reimpressao_obrigatorio" ? "atencao" : "critico";

  return (
    <p
      role="alert"
      className={`m-0 border-b px-4 py-[10px] text-[12.5px] font-semibold ${
        tom === "atencao"
          ? "border-atencao-linha bg-atencao-bg text-atencao"
          : "border-critico-linha bg-critico-bg text-critico"
      }`}
    >
      {textoDoMotivo(resultado)}
    </p>
  );
}

function Selo({
  tom,
  children,
}: {
  tom: "ok" | "atencao" | "neutro";
  children: React.ReactNode;
}) {
  const estilo =
    tom === "ok"
      ? "bg-ok-bg text-ok border-ok-linha"
      : tom === "atencao"
        ? "bg-atencao-bg text-atencao border-atencao-linha"
        : "border-linha text-suave";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-[9px] py-[3px] text-[11.5px] font-semibold ${estilo}`}
    >
      {children}
    </span>
  );
}
