'use strict';

/**
 * Funções PURAS sobre andamentos. Sem rede, sem estado: dá para testar cada
 * regra isolada.
 */

/**
 * De onde veio o andamento, decidido pelo campo `header`: preenchido com o
 * tribunal (ex.: "TJRJ") quando veio do Judiciário, nulo quando é registro
 * interno (o que o seu sistema escreveu por `POST /lawsuits/movement`).
 *
 * Por que não confiar só no `?origin=` de `GET /movements/{id}`: o filtro é
 * documentado, mas em agosto de 2026 deixava andamento interno ("Cobrança gerada,
 * 1ª parcela") voltar também em `origin=TRIBUNAL`. Remedido em 08/10/2026, separa
 * certo (21 do tribunal, 1 interno). Classificar pelo `header` dá o mesmo
 * resultado hoje e não depende de o filtro continuar funcionando.
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
 * não traz o campo `header`, então tudo sairia 'desconhecido' e o filtro
 * voltaria vazio: de novo, um vazio que mente.
 */
function apenasDoTribunal(andamentos) {
  return (andamentos || []).filter(a => origemDoAndamento(a) === 'tribunal');
}

/**
 * A resposta de `ultimosAndamentos()` serve para classificar origem?
 *
 * Guarda explícita: se nenhum item da amostra traz `header` preenchido (nulo
 * ou campo ausente, que é o caso de `ultimosAndamentos()`), a origem não é
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
