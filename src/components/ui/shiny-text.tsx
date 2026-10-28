import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Texto com brilho varrendo continuamente, inspirado no ShinyText do
 * reactbits.dev — reimplementado em CSS puro (sem framer-motion) para não
 * adicionar dependência só por este efeito decorativo.
 */
export function ShinyText({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn("shiny-text", className)} {...props} />;
}
