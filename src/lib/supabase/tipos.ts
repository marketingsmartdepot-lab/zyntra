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
  | "encerrado";

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
] as const satisfies ReadonlyArray<{ etapa: Etapa; rotulo: string }>;

export type EtapaAba = (typeof ABAS_EXPEDICAO)[number]["etapa"];

export function ehEtapaDaEsteira(v: string): v is EtapaAba | "retido" {
  return (
    v === "retido" || ABAS_EXPEDICAO.some((a) => (a.etapa as string) === v)
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
    modalidades: { nome: string; gera_etiqueta: boolean } | null;
    pedidos: { ref_externa: string; pack_ref: string | null }[];
  } | null;
  contas: {
    apelido: string;
    empresas: { nome_curto: string } | null;
  } | null;
  bloqueios: { tipo: BloqueioTipo; causa: string | null }[];
};
