"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { maskCep, maskPhone } from "@/lib/utils";

const MASKS = {
  phone: { apply: maskPhone, inputMode: "tel" as const, autoComplete: "tel" },
  cep: { apply: maskCep, inputMode: "numeric" as const, autoComplete: "postal-code" },
};

/**
 * Input com máscara aplicada enquanto se digita. Funciona tanto com
 * `register(...)` do react-hook-form quanto com `value`/`onChange`
 * controlados: o valor é mascarado antes de chegar ao `onChange`.
 */
function MaskedInput({
  mask,
  onChange,
  ...props
}: React.ComponentProps<"input"> & { mask: keyof typeof MASKS }) {
  const { apply, inputMode, autoComplete } = MASKS[mask];
  return (
    <Input
      inputMode={inputMode}
      autoComplete={autoComplete}
      {...props}
      onChange={(event) => {
        event.target.value = apply(event.target.value);
        onChange?.(event);
      }}
    />
  );
}

export { MaskedInput };
