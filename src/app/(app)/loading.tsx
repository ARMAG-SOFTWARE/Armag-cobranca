/**
 * Esqueleto mostrado na hora em que o usuário toca num item do menu, enquanto
 * o servidor busca os dados da próxima tela. Sem ele, o clique parecia não
 * fazer nada até a página inteira chegar. Também permite ao Next pré-carregar
 * esta casca ao passar/aparecer um link, deixando a troca de tela imediata.
 */
function Block({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-xl bg-white/[0.06] motion-reduce:animate-none ${className}`} />;
}

export default function AppLoading() {
  return (
    <main
      aria-busy="true"
      aria-label="Carregando"
      className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-10"
    >
      <div className="flex flex-col gap-2.5">
        <Block className="h-3 w-28" />
        <Block className="h-9 w-56 sm:h-10" />
        <Block className="h-4 w-full max-w-md" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Block key={i} className="h-[92px] sm:h-[108px]" />
        ))}
      </div>

      <Block className="h-72 w-full" />
    </main>
  );
}
