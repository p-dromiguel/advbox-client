'use strict';

/**
 * Funções PURAS sobre tarefas (posts). Sem rede, sem estado.
 *
 * A tarefa do ADVBOX não tem campo de status. Quem conclui é cada convidado:
 * `users[]` traz um item por pessoa, com `user_id` e `completed` (data-hora no
 * formato `YYYY-MM-DD HH:MM:SS`, ou null enquanto a pessoa não concluiu).
 * A data de conclusão também só existe aí: na tarefa concluída, `date` e
 * `date_deadline` costumam vir nulos.
 */

const convidados = tarefa => (tarefa && Array.isArray(tarefa.users) ? tarefa.users : []);
const concluiu = u => u && u.completed != null && String(u.completed).trim() !== '';

/**
 * @returns {'aberta'|'parcial'|'concluida'|'desconhecida'}
 *   'parcial' = algum convidado concluiu e outro não. É a tarefa que aparece
 *   nas duas listas de `GET /posts` ao mesmo tempo.
 *   'desconhecida' = sem convidados na resposta; não dá para afirmar nada.
 */
function situacaoDaTarefa(tarefa) {
  const lista = convidados(tarefa);
  if (lista.length === 0) return 'desconhecida';
  const feitos = lista.filter(concluiu).length;
  if (feitos === 0) return 'aberta';
  return feitos === lista.length ? 'concluida' : 'parcial';
}

/**
 * Ids dos convidados que ainda não concluíram.
 *
 * É a resposta certa para "o que está aberto para fulano": a tarefa está aberta
 * para quem está aqui, mesmo que já conste na lista de concluídas por causa de
 * outro convidado.
 */
function convidadosPendentes(tarefa) {
  return convidados(tarefa).filter(u => !concluiu(u)).map(u => u.user_id);
}

module.exports = { situacaoDaTarefa, convidadosPendentes };
