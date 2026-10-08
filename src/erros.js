'use strict';

/**
 * A API declarou um total maior do que entregou.
 *
 * Não é erro de rede nem de autenticação: a resposta veio 200 e bem formada, e o
 * próprio corpo contém a prova da falta (`totalCount` maior que o tamanho da
 * lista). É lançado só no modo estrito — no padrão, a listagem volta com
 * `completa: false` e quem chama decide.
 *
 * `declarados` null = a rota bateu num teto fixo sem dizer quanto existe (é o
 * caso de `/history`). Aí `faltando` também é null: desconhecido, não zero.
 */
class RESPOSTA_TRUNCADA extends Error {
  constructor(contexto, recebidos, declarados) {
    super(
      declarados == null
        ? `${contexto}: a API devolveu ${recebidos} registros, que é o teto desta rota. ` +
          `Pode haver mais, e ela não pagina.`
        : `${contexto}: a API devolveu ${recebidos} registros mas declara ${declarados}. ` +
          `Faltam ${declarados - recebidos}, mesmo paginando até o fim.`
    );
    this.name = 'RESPOSTA_TRUNCADA';
    this.contexto = contexto;
    this.recebidos = recebidos;
    this.declarados = declarados;
    this.faltando = declarados == null ? null : declarados - recebidos;
  }
}

/**
 * Chamada montada de um jeito que esta API não reconhece.
 *
 * Existe porque o modo de falha desta API é traiçoeiro: caminho inexistente não
 * responde 404 (já respondeu 200 com lista vazia; hoje responde 401). Sem uma
 * checagem antes de sair, o "não tem dado" é indistinguível de "perguntei errado".
 */
class CAMINHO_INEXISTENTE extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'CAMINHO_INEXISTENTE';
  }
}

module.exports = { RESPOSTA_TRUNCADA, CAMINHO_INEXISTENTE };
