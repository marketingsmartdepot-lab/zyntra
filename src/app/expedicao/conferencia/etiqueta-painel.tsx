import { imprimirEtiqueta } from "../etiqueta";

export type ImpressaoDaEtiqueta = {
  situacao: string;
  erro: string | null;
  enviada_em: string;
  reimpressao: boolean;
};

/**
 * A etiqueta do canal saindo em papel.
 *
 * Fica na aba Pronto e não na bancada de conferência porque só depois da
 * conferência fechada faz sentido colar etiqueta numa caixa — antes disso, a
 * caixa ainda pode mudar de conteúdo.
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
  const precisaMotivo =
    jaSaiu || resultado === "motivo_reimpressao_obrigatorio";

  return (
    <section className="mx-6 mb-5 overflow-hidden rounded-[10px] border border-linha">
      <header className="flex flex-wrap items-center gap-3 border-b border-linha bg-fundo px-4 py-3">
        <h3 className="m-0 text-[14px] font-bold tracking-[-0.01em]">
          Etiqueta de envio
        </h3>
        {naFila ? (
          <Selo tom="atencao">Na fila da impressora</Selo>
        ) : jaSaiu ? (
          <Selo tom="ok">Já impressa</Selo>
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
 * Cada recusa aponta para onde está o problema: no pedido do cliente, na
 * conta, na bancada ou no Mercado Livre. "Não foi possível" faria o operador
 * tentar de novo com a fila parada atrás dele.
 */
function Aviso({ resultado }: { resultado: string }) {
  if (resultado === "ok") {
    return (
      <p className="m-0 border-b border-ok-linha bg-ok-bg px-4 py-[10px] text-[12.5px] font-semibold text-ok">
        Etiqueta enviada para a impressora desta bancada.
      </p>
    );
  }

  const texto: Record<string, string> = {
    conta_sem_credencial:
      "A conta deste pedido ainda não está conectada ao Mercado Livre. Conecte em Integração.",
    credencial_expirada:
      "A conexão com o Mercado Livre desta conta expirou. Reconecte em Integração.",
    credencial_recusada:
      "O Mercado Livre recusou a conexão desta conta. Reconecte em Integração.",
    credencial_de_outra_conta:
      "A credencial usada não é da conta dona deste pedido.",
    envio_nao_liberado:
      "O Mercado Livre ainda não liberou esta etiqueta. Ela só sai quando o envio fica pronto para despacho.",
    envio_fulfillment:
      "Envio Full: a etiqueta de venda é impressa pelo Mercado Livre, não por nós.",
    envio_fora_do_me2:
      "Este envio não é Mercado Envios 2, então não tem etiqueta para imprimir aqui.",
    envio_nao_encontrado:
      "O Mercado Livre não encontrou este envio.",
    modalidade_sem_etiqueta:
      "Esta modalidade não gera etiqueta — é envio combinado com o comprador.",
    pacote_sem_envio: "Este pacote não tem envio associado.",
    conferencia_nao_concluida:
      "A conferência deste pacote ainda não foi fechada.",
    motivo_reimpressao_obrigatorio:
      "Esta etiqueta já foi impressa. Escreva o motivo da reimpressão.",
    estacao_sem_impressora:
      "Esta bancada não tem impressora cadastrada. Cadastre em Integração.",
    agente_offline:
      "O agente desta bancada não está respondendo. Sem ele o computador não fala com a impressora.",
    resposta_nao_e_zpl:
      "O Mercado Livre devolveu algo que não é etiqueta Zebra. Nada foi enviado para a impressora.",
    ml_indisponivel:
      "Não foi possível falar com o Mercado Livre agora. Tente de novo.",
    servico_indisponivel:
      "O serviço de etiquetas não respondeu. Tente de novo.",
    perfil_inativo: "Seu usuário está desativado.",
  };

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
      {texto[resultado] ??
        (resultado.startsWith("ml_")
          ? `O Mercado Livre recusou: ${resultado.slice(3)}`
          : "Não foi possível imprimir a etiqueta.")}
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
