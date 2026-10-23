/**
 * O que dizer quando a etiqueta não sai.
 *
 * Estava dentro do painel da aba Pronto, onde só aquela tela alcançava. Agora
 * a etiqueta sai no bipe que completa a caixa, então a BANCADA também precisa
 * destas frases — e precisa das mesmas: operador que lê "conta sem credencial"
 * na bancada e "não foi possível" na aba Pronto acha que são dois problemas.
 *
 * Cada recusa aponta para onde está o problema: no pedido do cliente, na
 * conta, na bancada ou no Mercado Livre. "Não foi possível" faria o operador
 * bipar de novo com a fila parada atrás dele.
 */
export const MOTIVOS_DA_ETIQUETA: Record<string, string> = {
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
  envio_nao_encontrado: "O Mercado Livre não encontrou este envio.",
  modalidade_sem_etiqueta:
    "Esta modalidade não gera etiqueta — é envio combinado com o comprador.",
  pacote_sem_envio: "Este pacote não tem envio associado.",
  conferencia_nao_concluida:
    "A conferência deste pacote ainda não foi fechada.",
  motivo_reimpressao_obrigatorio:
    "Esta etiqueta já foi impressa. Escreva o motivo da reimpressão.",
  estacao_sem_impressora:
    "Esta bancada não tem impressora cadastrada. Cadastre em Integração.",
  estacao_nao_informada:
    "Esta máquina ainda não sabe qual bancada é. Escolha a bancada e tente de novo.",
  agente_offline:
    "O agente desta bancada não está respondendo. Sem ele o computador não fala com a impressora.",
  resposta_nao_e_zpl:
    "O Mercado Livre devolveu algo que não é etiqueta Zebra. Nada foi enviado para a impressora.",
  ml_indisponivel:
    "Não foi possível falar com o Mercado Livre agora. Tente de novo.",
  servico_indisponivel: "O serviço de etiquetas não respondeu. Tente de novo.",
  sem_sessao: "Sua sessão expirou. Entre de novo.",
  perfil_inativo: "Seu usuário está desativado.",
};

/** A frase para um motivo, inclusive os que o ML inventa na hora. */
export function textoDoMotivo(motivo: string) {
  return (
    MOTIVOS_DA_ETIQUETA[motivo] ??
    (motivo.startsWith("ml_")
      ? `O Mercado Livre recusou: ${motivo.slice(3)}`
      : "Não foi possível imprimir a etiqueta.")
  );
}
