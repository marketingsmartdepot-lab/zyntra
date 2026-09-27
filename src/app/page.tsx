import { redirect } from "next/navigation";
import { primeiraFrenteAberta } from "@/lib/permissoes";

export default async function Raiz() {
  // O middleware já garantiu que há sessão — sem ela a raiz nem chega aqui.
  // O que se decide agora é PARA ONDE: mandar todo mundo para a esteira fazia
  // quem só enxerga o Painel bater numa porta trancada a cada login. Quem não
  // enxerga nada vai para a esteira mesmo, e lá recebe a tela que explica.
  redirect((await primeiraFrenteAberta()) ?? "/expedicao");
}
