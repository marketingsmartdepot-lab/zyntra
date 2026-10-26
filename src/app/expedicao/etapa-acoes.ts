"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";
import { estacaoDaMaquina } from "@/lib/estacao";

/**
 * Move à mão os pacotes marcados para outra etapa.
 *
 * Existe para destravar o caso que ninguém previu — e por isso aceita
 * QUALQUER destino, inclusive para trás. Quem limita é a permissão
 * `alterar_etapa`, não uma lista de destinos escolhida hoje: a emergência que
 * aparecer vai ser justamente a que eu tivesse bloqueado.
 *
 * O motivo é obrigatório e fica no histórico da caixa. Movimento manual é o
 * que alguém vai querer entender três semanas depois, e salto inexplicado no
 * histórico faz ninguém confiar no histórico inteiro.
 */
export async function alterarEtapaDosMarcados(formData: FormData) {
  const vista = String(formData.get("vista") ?? "aberto");
  const etapa = String(formData.get("etapa_destino") ?? "").trim();
  const motivo = String(formData.get("motivo_etapa") ?? "").trim();
  const marcados = formData.getAll("pacote").map(String).filter(Boolean);

  const voltar = (resultado: string, extra = "") =>
    redirect(`/expedicao?etapa=${vista}&etapa_alterada=${resultado}${extra}`);

  if (marcados.length === 0) return voltar("nada_selecionado");
  if (!etapa) return voltar("sem_destino");
  if (motivo.length < 5) return voltar("motivo_curto");

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("alterar_etapa_de_varios", {
    p_pacote_ids: marcados,
    p_etapa: etapa,
    p_motivo: motivo,
  });

  if (error) return voltar("erro");

  const r = Array.isArray(data) ? data[0] : data;
  if (!r?.ok) return voltar(r?.motivo ?? "erro");

  // Mover para Conferir é, na cabeça de quem faz, "quero conferir de novo".
  // Mas a conferência antiga está fechada e mover a etapa não a reabre — a
  // aba mostraria "Abrir a bancada" em vez do campo de bipe, e quem esperava
  // bipar acha que não funcionou. Então reabrimos junto.
  //
  // Aqui e não no banco porque é AQUI que se sabe de qual bancada a máquina
  // é: mora num cookie. Reabrir no banco gravaria a conferência sem bancada,
  // e essa é justamente a coluna que responde "onde a caixa foi conferida".
  if (etapa === "conferir") {
    const estacao = await estacaoDaMaquina();
    const mudados = (r.mudados ?? []) as string[];

    for (const id of mudados) {
      // Falha ao reabrir não desfaz a mudança de etapa: a caixa ESTÁ em
      // Conferir, e isso já é verdade. O botão "Abrir a bancada" continua na
      // tela para quem precisar, agora dizendo o motivo quando recusa.
      await supabase.rpc("abrir_conferencia", {
        p_pacote_id: id,
        p_estacao_id: estacao,
        p_sessao_id: null,
      });
    }
  }

  revalidatePath("/expedicao");

  // Recusa não pode virar número solto: quem marcou vinte caixas precisa saber
  // QUAIS ficaram para trás, não quantas.
  const recusados = (r.recusados ?? []) as { codigo: string; motivo: string }[];
  const detalhe =
    recusados.length > 0
      ? `&etapa_recusados=${encodeURIComponent(
          recusados.map((x) => `${x.codigo}: ${x.motivo}`).join(" · "),
        )}`
      : "";

  voltar(`ok_${r.mudaram}`, detalhe);
}

/**
 * Pergunta ao Mercado Livre de novo o estado dos pedidos marcados.
 *
 * Existe por um defeito concreto: `pedir_etiquetas_ml` só pede a etiqueta
 * quando a CÓPIA que o ZYNTRA tem do estado diz que dá (`ready_to_ship` +
 * `ready_to_print`/`printed`). Se essa cópia estiver atrasada — aviso de
 * webhook perdido, varredura parada — o ML já liberou a etiqueta e o ZYNTRA
 * nem tenta pedir. E a condição não vira verdadeira sozinha: quem a
 * atualizaria é justamente o aviso que se perdeu.
 *
 * Reprocessar refaz a cópia. NÃO pede etiqueta — quem pede é o cron de
 * sempre, no minuto seguinte, agora que a condição dele é verdadeira. Uma
 * função faz uma coisa.
 */
export async function reprocessarMarcados(formData: FormData) {
  const vista = String(formData.get("vista") ?? "aberto");
  const marcados = formData.getAll("pacote").map(String).filter(Boolean);

  const voltar = (resultado: string) =>
    redirect(`/expedicao?etapa=${vista}&reprocessado=${resultado}`);

  if (marcados.length === 0) return voltar("nada_selecionado");

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("reprocessar_pacotes", {
    p_pacote_ids: marcados,
  });

  if (error) return voltar("erro");

  const r = Array.isArray(data) ? data[0] : data;
  if (!r?.ok) return voltar(r?.motivo ?? "erro");

  revalidatePath("/expedicao");

  // Os quatro números vão juntos: "olhei 12, 3 mudaram de estado, 1 saiu da
  // esteira, 0 falharam" responde sozinho se valeu a pena e se algo deu
  // errado. Só "pronto" mandaria a pessoa conferir linha por linha.
  voltar(
    `ok_${r.olhados ?? 0}_${r.atualizados ?? 0}_${r.moveram ?? 0}_${r.falhas ?? 0}` +
      (r.motivo === "parou_no_limite_do_ml" ? "_limite" : ""),
  );
}
