"use client";

import { useState } from "react";

type Operador = { id: string; nome: string; papel: string; bloqueado: boolean };

/**
 * Teclado numérico de verdade, e não um campo de texto.
 *
 * Quem está na bancada tem luva, leitor na mão e pressa. Um campo de texto
 * depende do teclado do computador, que na bancada fica atrás do monitor —
 * teclas grandes na tela são o que funciona ali.
 */
export function Teclado({
  operadores,
  destino,
  acao,
}: {
  operadores: Operador[];
  destino: string;
  acao: (formData: FormData) => Promise<void>;
}) {
  const [quem, setQuem] = useState<Operador | null>(
    operadores.length === 1 ? operadores[0] : null,
  );
  const [pin, setPin] = useState("");

  if (!quem) {
    return (
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {operadores.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              disabled={o.bloqueado}
              onClick={() => setQuem(o)}
              className="flex w-full items-center gap-3 rounded-[10px] border border-grafite-linha bg-grafite-3 px-4 py-[13px] text-left disabled:opacity-40"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-semibold">
                  {o.nome}
                </span>
                <span className="block text-[11.5px] text-cinza-2">
                  {o.papel === "lider" ? "líder" : "operador"}
                  {o.bloqueado && " · bloqueado por erro de PIN"}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <form action={acao}>
      <input type="hidden" name="operador" value={quem.id} />
      <input type="hidden" name="destino" value={destino} />
      <input type="hidden" name="pin" value={pin} />

      <div className="mb-4 flex items-center gap-2">
        <span className="flex-1 text-[15px] font-semibold">{quem.nome}</span>
        {operadores.length > 1 && (
          <button
            type="button"
            onClick={() => {
              setQuem(null);
              setPin("");
            }}
            className="text-[12px] font-semibold text-cinza-2"
          >
            trocar
          </button>
        )}
      </div>

      <span className="mb-[9px] block text-[10.5px] font-semibold uppercase tracking-[0.14em] text-cinza-2">
        PIN
      </span>
      <div
        role="status"
        aria-label={`${pin.length} dígitos digitados`}
        className="mb-[18px] flex min-h-[13px] justify-center gap-3"
      >
        {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
          <span
            key={i}
            className={`block h-[13px] w-[13px] rounded-full border-[1.5px] ${
              i < pin.length
                ? "border-champanhe bg-champanhe"
                : "border-grafite-linha-2"
            }`}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <Tecla key={d} onClick={() => pin.length < 8 && setPin(pin + d)}>
            {d}
          </Tecla>
        ))}
        <Tecla onClick={() => setPin("")} texto>
          Limpar
        </Tecla>
        <Tecla onClick={() => pin.length < 8 && setPin(pin + "0")}>0</Tecla>
        <button
          type="submit"
          disabled={pin.length < 4}
          className="rounded-[10px] bg-champanhe py-[13px] text-[12.5px] font-bold text-grafite disabled:opacity-40"
        >
          Entrar
        </button>
      </div>
    </form>
  );
}

function Tecla({
  children,
  onClick,
  texto,
}: {
  children: React.ReactNode;
  onClick: () => void;
  texto?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[10px] border border-grafite-linha bg-grafite-3 py-[13px] ${
        texto
          ? "text-[12.5px] font-semibold text-cinza-2"
          : "font-mono text-[19px] font-semibold text-offwhite"
      }`}
    >
      {children}
    </button>
  );
}
