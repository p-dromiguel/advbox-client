'use strict';

/**
 * A API declarou um total maior do que entregou.
 *
 * Não é erro de rede nem de autenticação: a resposta veio 200 e bem formada, e o
 * próprio corpo contém a prova da falta (`totalCount` maior que o tamanho da
 * lista). É lançado só no modo estrito — no padrão, a listagem volta com
 * `completa: false` e quem chama decide.
 */
class RESPOSTA_TRUNCADA extends Error {
  constructor(contexto, recebidos, declarados) {
    super(
      `${contexto}: a API devolveu ${recebidos} registros mas declara ${declarados}. ` +
      `Faltam ${declarados - recebidos}. Paginar por offset não alcança os que faltam.`
    );
    this.name = 'RESPOSTA_TRUNCADA';
    this.contexto = contexto;
    this.recebidos = recebidos;
    this.declarados = declarados;
    this.faltando = declarados - recebidos;
  }
}

/**
 * Chamada montada de um jeito que esta API não reconhece.
 *
 * Existe porque o modo de falha desta API é traiçoeiro: caminho inexistente
 * responde 200 com lista vazia, não 404. Sem uma checagem antes de sair, o
 * "não tem dado" é indistinguível de "perguntei errado".
 */
class CAMINHO_INEXISTENTE extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'CAMINHO_INEXISTENTE';
  }
}

module.exports = { RESPOSTA_TRUNCADA, CAMINHO_INEXISTENTE };
