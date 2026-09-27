"use client";

import { useEffect } from "react";

/**
 * Abre a caixa de impressão do navegador assim que a folha aparece.
 *
 * É o navegador que pergunta qual impressora, e não o sistema que decide: a
 * folha de separação é papel comum, e a impressora que está livre no corredor
 * muda ao longo do dia. A bancada configurada serve para a etiqueta térmica,
 * que é sempre a mesma.
 */
export function AbrirImpressao() {
  useEffect(() => {
    // Um quadro depois, para a folha já estar desenhada quando a caixa abrir.
    const t = setTimeout(() => window.print(), 250);
    return () => clearTimeout(t);
  }, []);

  return null;
}
