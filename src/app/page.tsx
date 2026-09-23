import { redirect } from "next/navigation";

export default function Raiz() {
  // O middleware decide: com sessão vai para a esteira, sem sessão cai em /entrar.
  redirect("/expedicao");
}
