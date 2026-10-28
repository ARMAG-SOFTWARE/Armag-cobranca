import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Título grande com gradiente estático violeta → ciano (marca do app),
 * inspirado no GradientText do reactbits.dev.
 */
export function GradientHeading({
  className,
  as: Component = "h1",
  ...props
}: React.ComponentProps<"h1"> & { as?: "h1" | "h2" }) {
  return (
    <Component
      className={cn("text-gradient-brand font-extrabold tracking-tight", className)}
      {...props}
    />
  );
}
