/**
 * Fundo com brilhos de gradiente ("aurora") + textura de grid sutil, fixo
 * atrás de todo o conteúdo. Estático de propósito: blobs grandes animados
 * com `blur` obrigavam o navegador a redesenhar a tela inteira a cada
 * quadro — e cada card com fundo translúcido em cima precisava refazer
 * esse desfoque junto — o que pesava bastante no celular/iPad. O gradiente
 * radial já termina em transparente, então o brilho continua suave sem blur.
 */
export function AuroraBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-background" />
      <div className="bg-grid-fade absolute inset-0" />
      <div
        className="absolute -top-1/4 left-[-15%] size-[65vw] rounded-full opacity-60"
        style={{ background: "radial-gradient(circle, var(--primary), transparent 65%)" }}
      />
      <div
        className="absolute top-1/4 right-[-20%] size-[60vw] rounded-full opacity-40"
        style={{ background: "radial-gradient(circle, var(--accent-cyan), transparent 65%)" }}
      />
      <div
        className="absolute bottom-[-25%] left-1/4 size-[55vw] rounded-full opacity-35"
        style={{ background: "radial-gradient(circle, var(--primary), transparent 65%)" }}
      />
      <div className="absolute inset-0 bg-background/45" />
    </div>
  );
}
