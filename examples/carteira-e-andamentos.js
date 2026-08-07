'use strict';

/**
 * Exemplo: quantos processos da carteira têm andamento de verdade no tribunal?
 *
 *   ADVBOX_TOKEN=... node examples/carteira-e-andamentos.js
 *
 * Só leitura. Mostra as três armadilhas que mais aparecem no dia a dia:
 * a listagem que vem incompleta, o processo sem número que não é rastreável,
 * e a origem que só o campo `header` decide.
 */

const { AdvboxClient, rastreabilidade, apenasDoTribunal } = require('..');

async function main() {
  const advbox = new AdvboxClient();

  const carteira = await advbox.processos();

  // ARMADILHA: nunca assuma que a lista veio inteira.
  if (!carteira.completa) {
    console.warn(
      `⚠️  A API devolveu ${carteira.itens.length} de ${carteira.total} processos ` +
      `(faltam ${carteira.faltando}). Os números abaixo cobrem só o que veio.\n`
    );
  }

  // Sem número de processo não há o que rastrear no tribunal.
  // Ausência de andamento aqui é o esperado — não é "sem novidade".
  const rastreaveis = carteira.itens.filter(p => rastreabilidade(p) === 'rastreavel');
  const semNumero = carteira.itens.length - rastreaveis.length;

  console.log(`Carteira: ${carteira.itens.length} processos`);
  console.log(`  rastreáveis (com número): ${rastreaveis.length}`);
  console.log(`  sem número, fora de rastreio: ${semNumero}\n`);

  // Uma chamada por processo. A versão em lote (`ultimosAndamentos`) seria mais
  // barata, mas devolve `header` nulo — e sem `header` não dá para saber a origem.
  const amostra = rastreaveis.slice(0, 10);
  console.log(`Conferindo andamentos dos ${amostra.length} primeiros...\n`);

  for (const processo of amostra) {
    const { itens } = await advbox.andamentos(processo.id);
    const doTribunal = apenasDoTribunal(itens);

    const rotulo = String(processo.process_number).padEnd(26);
    console.log(
      `  ${rotulo} ${String(doTribunal.length).padStart(3)} do tribunal ` +
      `· ${String(itens.length - doTribunal.length).padStart(3)} internos`
    );
  }
}

main().catch(err => {
  console.error('Falhou:', err.message);
  process.exitCode = 1;
});
