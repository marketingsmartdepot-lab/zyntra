/**
 * Tipos de domínio do ZYNTRA.
 *
 * NÃO são os tipos gerados do schema. São escritos à mão e cobrem o que o app
 * realmente consulta — o schema tem 30 tabelas e a maior parte só é tocada
 * pelo lado servidor.
 *
 * Quando o CLI do Supabase estiver instalado, gerar os completos:
 *
 *   npx supabase gen types typescript --project-id jhgpqllkeqqeuqxxzzup > src/lib/supabase/schema.ts
 *
 * e tipar os clientes com `Database` de lá. Até isso acontecer, a fonte da
 * verdade do schema são as migrações em supabase/migrations.
 */

export type Papel = "operador" | "lider" | "analista" | "admin";

/** As etapas da esteira, na ordem em que o pedido as percorre. */
export type Etapa =
  | "aberto"
  | "faturado"
  | "separar"
  | "conferir"
  | "pronto"
  | "retido"
  | "enviado"
  | "entregue";

export type BloqueioTipo =
  | "sem_nota"
  | "rejeicao_fiscal"
  | "faturador_nao_configurado"
  | "sku_nao_mapeado"
  | "sem_etiqueta"
  | "sem_estoque"
  | "pedido_alterado"
  | "impressao_fora_do_sistema";

/** As abas da Expedição, na ordem da tela. `retido` fica fora da esteira. */
export const ABAS_EXPEDICAO = [
  { etapa: "aberto", rotulo: "Aberto" },
  { etapa: "faturado", rotulo: "Faturado" },
  { etapa: "separar", rotulo: "Separar" },
  { etapa: "conferir", rotulo: "Conferir" },
  { etapa: "pronto", rotulo: "Pronto pra envio" },
  { etapa: "enviado", rotulo: "Enviado" },
  // Última aba, e a única em que ninguém trabalha: "entregue" é palavra do
  // canal sobre uma caixa que o galpão não controla mais. Ela existe para
  // Enviado parar de ser um balaio — com ela, Enviado significa "saiu daqui e
  // ainda não chegou lá", que é a lista que precisa de vigia.
  { etapa: "entregue", rotulo: "Entregue" },
] as const satisfies ReadonlyArray<{ etapa: Etapa; rotulo: string }>;

export type EtapaAba = (typeof ABAS_EXPEDICAO)[number]["etapa"];

/**
 * O que a aba mostra. `listas` não é etapa: um pacote nunca está "em listas",
 * ele está em Separar e por acaso pertence a uma lista. A aba existe porque o
 * separador precisa dela, não porque o pedido mudou de lugar.
 */
export type Vista = EtapaAba | "retido" | "listas";

export function ehVista(v: string): v is Vista {
  return (
    v === "retido" ||
    v === "listas" ||
    ABAS_EXPEDICAO.some((a) => (a.etapa as string) === v)
  );
}

/** Uma linha da lista de pacotes, do jeito que a tela consome. */
export type LinhaPacote = {
  id: string;
  etapa: Etapa;
  etapa_desde: string;
  unidades_esperadas: number | null;
  envios: {
    ref_externa: string;
    limite_envio_em: string | null;
    etiqueta_obtida_em: string | null;
    /** O que o canal diz do transporte. É o que Enviado mostra no cartão. */
    situacao_canal: string | null;
    substatus_canal: string | null;
    modalidades: { nome: string; gera_etiqueta: boolean } | null;
    pedidos: {
      ref_externa: string;
      pack_ref: string | null;
      comprador: string | null;
    }[];
  } | null;
  contas: {
    apelido: string;
    empresas: { nome_curto: string } | null;
    canais: {
      nome: string;
      icone_url: string | null;
      sigla: string | null;
      cor: string | null;
      cor_texto: string | null;
    } | null;
  } | null;
  notas_fiscais: {
    situacao: "solicitada" | "autorizada" | "rejeitada" | "cancelada";
    serie: string | null;
    numero: number | null;
    erro_mensagem: string | null;
  }[];
  bloqueios: { tipo: BloqueioTipo; causa: string | null }[];
};

/**
 * Onde a caixa está, nas palavras de quem trabalha no galpão.
 *
 * O par status/substatus do Mercado Livre é vocabulário de API, não de
 * pessoa: `ready_to_ship / dropped_off` quer dizer "deixei na agência e o ML
 * ainda não coletou". A tradução mora aqui porque a aba Enviado existe para
 * ser lida de relance.
 *
 * SUBSTATUS DESCONHECIDO NÃO FICA EM BRANCO. Mostra o texto cru do ML, e a
 * tela o exibe em fonte de código para ficar claro que é palavra de máquina.
 * O branco custou caro: `in_hub` e `in_packing_list` apareceram horas depois
 * de eu montar esta lista, nove cartões ficaram vazios, e a Daniele teve que
 * perguntar "por que alguns não aparecem" em vez de me dizer o nome do estado
 * novo. Estado novo tem que se denunciar sozinho — é por ele que a regra de
 * `envio_saiu_do_galpao` descobre que precisa crescer.
 */
export function ondeEstaNoCanal(
  status: string | null,
  substatus: string | null,
): { texto: string; traduzido: boolean } | null {
  const s = (status ?? "").trim();
  const sub = (substatus ?? "").trim();

  if (!s && !sub) return null;

  const diz = (texto: string) => ({ texto, traduzido: true });

  // A cadeia da agência, na ordem em que acontece. Os três mantêm o status em
  // `ready_to_ship`, e só o substatus conta que a caixa já saiu daqui.
  if (sub === "dropped_off") return diz("no ponto de coleta");
  if (sub === "in_packing_list") return diz("agrupada para coleta na agência");
  if (sub === "in_hub") return diz("no centro do Mercado Livre");

  if (sub === "out_for_delivery") return diz("saiu para entrega");
  // XD: está na agência de DESTINO, esperando o comprador buscar. Se ele não
  // buscar, volta — por isso não vira um "em rota" genérico.
  if (sub === "waiting_for_withdrawal") return diz("aguardando o cliente retirar");

  if (s === "shipped") return diz("coletado pelo canal");
  if (s === "delivered") return diz("entregue");

  // Sem tradução: entrega o que o ML disse, cru.
  return { texto: sub ? `${s} / ${sub}` : s, traduzido: false };
}
