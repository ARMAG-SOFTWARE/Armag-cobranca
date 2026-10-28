"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Card com brilho radial que segue o cursor, adaptado do SpotlightCard do
 * reactbits.dev (github.com/DavidHDev/react-bits) para os tokens de tema
 * (--primary/--card/--border) já usados no restante do app. Em telas
 * touch (iPad) o efeito simplesmente não aparece — degrada bem, sem custo.
 */
export function SpotlightCard({
  className,
  spotlightColor,
  style,
  ...props
}: React.ComponentProps<"div"> & { spotlightColor?: string }) {
  const ref = React.useRef<HTMLDivElement>(null);

  function handleMouseMove(event: React.MouseEvent<HTMLDivElement>) {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    node.style.setProperty("--mouse-x", `${event.clientX - rect.left}px`);
    node.style.setProperty("--mouse-y", `${event.clientY - rect.top}px`);
  }

  return (
    <div
      ref={ref}
      onMouseMove={handleMouseMove}
      className={cn(
        "card-spotlight rounded-xl border border-border bg-card text-card-foreground",
        className,
      )}
      style={spotlightColor ? ({ ...style, "--spotlight-color": spotlightColor } as React.CSSProperties) : style}
      {...props}
    />
  );
}
