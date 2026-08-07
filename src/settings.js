'use strict';

/**
 * Resolução de ID por NOME, a partir do GET /settings.
 *
 * Nenhum id de tipo de tarefa, etapa, origem ou usuário deve ser fixado no
 * código: eles mudam quando a equipe mexe no painel, e um id errado não dá erro
 * — grava no lugar errado, calado.
 */

/** Onde cada coleção do /settings guarda o nome legível. */
const CHAVE_DO_NOME = {
  users: 'name',
  origins: 'origin',
  stages: 'stage',
  lawsuit_types: 'type',
  tasks: 'task',      // atenção: é `task`, não `name` — o mais fácil de errar
  steps: 'step',
  groups: 'group',
};

function normalizar(s) {
  return String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Acha o id de um item pelo nome, sem diferenciar acento, caixa ou espaço extra.
 *
 * @param {object} settings  corpo do GET /settings
 * @param {string} colecao   'tasks' | 'users' | 'stages' | 'origins' | ...
 * @param {string} nome      nome como aparece no painel
 * @returns {number|string|null}
 */
function resolverId(settings, colecao, nome) {
  const item = resolverItem(settings, colecao, nome);
  return item ? item.id : null;
}

/** Igual a resolverId, mas devolve o objeto inteiro (útil pro `reward` de tarefa). */
function resolverItem(settings, colecao, nome) {
  const chave = CHAVE_DO_NOME[colecao];
  if (!chave) throw new Error(`Coleção desconhecida em /settings: "${colecao}".`);
  const lista = (settings && settings[colecao]) || [];
  const alvo = normalizar(nome);
  if (!alvo) return null;
  return lista.find(o => normalizar(o[chave]) === alvo) || null;
}

/**
 * Lista os nomes disponíveis numa coleção. Serve para a mensagem de erro dizer
 * o que existe em vez de só dizer que não achou.
 */
function nomesDisponiveis(settings, colecao) {
  const chave = CHAVE_DO_NOME[colecao];
  if (!chave) return [];
  return ((settings && settings[colecao]) || []).map(o => o[chave]).filter(Boolean);
}

module.exports = { resolverId, resolverItem, nomesDisponiveis, normalizar, CHAVE_DO_NOME };
