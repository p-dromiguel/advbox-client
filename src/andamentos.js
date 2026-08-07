'use strict';

/**
 * Funções PURAS sobre andamentos. Sem rede, sem estado — dá para testar cada
 * regra isolada, e é onde mora a armadilha nº 5.
 */

/**
 * Armadilha nº 5: `?origin=TRIBUNAL` NÃO filtra.
 *
 * Um andamento escrito pelo seu próprio sistema (por exemplo "Cobrança gerada —
 * 1ª parcela") volta tanto em `origin=TRIBUNAL` quanto em `origin=MANUAL`. Quem
 * confia nesse filtro para decidir "chegou novidade do tribunal" acaba avisando
 * o cliente sobre um boleto que o próprio sistema emitiu.
 *
 * O que separa de verdade é o campo `header`: preenchido com a sigla do tribunal
 * (ex.: "TJRJ") quando veio do Judiciário, nulo quando é registro interno.
 *
 * @returns {'tribunal'|'interno'|'desconhecido'}
 */
function origemDoAndamento(andamento) {
  if (!andamento || typeof andamento !== 'object') return 'desconhecido';
  if (!('header' in andamento)) return 'desconhecido';
  const header = andamento.header;
  if (header == null || String(header).trim() === '') return 'interno';
  return 'tribunal';
}

/**
 * Só os andamentos que vieram mesmo do tribunal.
 *
 * Aviso: não use com o resultado de `ultimosAndamentos()`. Aquela chamada
 * devolve `header` nulo em TODOS os registros, então tudo seria classificado
 * como interno e o filtro voltaria vazio — de novo, um vazio que mente.
 */
function apenasDoTribunal(andamentos) {
  return (andamentos || []).filter(a => origemDoAndamento(a) === 'tribunal');
}

/**
 * A resposta de `ultimosAndamentos()` serve para classificar origem?
 *
 * Guarda explícita: se todo `header` da amostra é nulo, a origem não é
 * decidível a partir desses dados. Chamar antes de filtrar evita concluir
 * "nenhum andamento do tribunal" a partir de um campo que a chamada não traz.
 */
function origemEhDecidivel(andamentos) {
  const lista = andamentos || [];
  if (lista.length === 0) return false;
  return lista.some(a => a && a.header != null && String(a.header).trim() !== '');
}

/**
 * Um processo sem número não tem como ser rastreado no tribunal — e a ausência
 * de andamento aí é esperada, não é notícia.
 *
 * Distinguir os dois casos importa na interface: "sem novidade" e "não dá para
 * saber" são estados diferentes, e mostrar o primeiro no lugar do segundo é
 * mentir com confiança.
 *
 * @returns {'rastreavel'|'sem_numero'}
 */
function rastreabilidade(processo) {
  const numero = processo && processo.process_number;
  return numero && String(numero).trim() !== '' ? 'rastreavel' : 'sem_numero';
}

module.exports = {
  origemDoAndamento,
  apenasDoTribunal,
  origemEhDecidivel,
  rastreabilidade,
};
