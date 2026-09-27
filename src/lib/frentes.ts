/**
 * As frentes do ZYNTRA, na ordem em que aparecem na lateral.
 *
 * Fica num módulo sem nada de servidor porque quatro lugares precisam desta
 * mesma lista e dois deles rodam no navegador: a lateral (cliente), a porta da
 * casca (servidor), a régua de permissões (servidor) e o redirecionamento da
 * raiz (servidor). Duas listas iguais em arquivos diferentes acabam diferentes.
 */
export type Frente =
  | "expedicao"
  | "logistica"
  | "catalogo"
  | "integracao"
  | "painel";

export const FRENTES: {
  chave: Frente;
  rotulo: string;
  href: string;
  /** A permissão que abre esta frente. */
  permissao: string;
}[] = [
  { chave: "painel", rotulo: "Painel", href: "/painel", permissao: "ver_painel" },
  { chave: "expedicao", rotulo: "Expedição", href: "/expedicao", permissao: "ver_expedicao" },
  { chave: "logistica", rotulo: "Logística", href: "/logistica", permissao: "ver_logistica" },
  { chave: "catalogo", rotulo: "Catálogo", href: "/catalogo", permissao: "ver_catalogo" },
  { chave: "integracao", rotulo: "Integração", href: "/integracao", permissao: "ver_integracao" },
];
