# Changelog

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), e as versões seguem o [SemVer](https://semver.org/lang/pt-BR/). Enquanto a versão começar com `0.`, uma mudança de comportamento pode vir numa versão menor.

## [0.2.0] - 2026-10-08

### Corrigido

- `tarefas()` contava duas vezes a tarefa concluída por um convidado e ainda aberta para outro. Ela aparece nas duas listas de `GET /posts` ao mesmo tempo (22 numa base de 3.356, medido em 08/10/2026). Agora as duas listas são unidas por `id`, e o item que estava nas duas vem com `_lista_origem: 'ambas'`.
- A versão anterior dizia que `created_*` e `completed_*` são listas mutuamente exclusivas. Não são: a de criadas traz a tarefa enquanto algum convidado não concluiu, e a de concluídas a traz assim que o primeiro conclui.
- `historico()` se declarava completo ao bater no teto de 20 itens da rota. Agora volta com `completa: false`, `total: null` e `faltando: null`.
- O README afirmava que `GET /customers` devolveu 377 declarando 447. Ela devolveu 377 e declarou 377: quem some da listagem é o cliente sem origem, e o `totalCount` some junto.

### Adicionado

- Paginação nas listagens grandes (`clientes`, `processos`, `tarefasCriadas`, `tarefasConcluidas`): segue o `offset` até a página curta, tira repetição por `id`, não entra em laço se a rota ignorar o `offset`, e compara o resultado com o maior `totalCount` declarado.
- `situacaoDaTarefa(tarefa)` e `convidadosPendentes(tarefa)`, funções puras sobre a conclusão por convidado.
- Erro `401` avisa que, nesta API, rota inexistente também responde `401`.
- `RESPOSTA_TRUNCADA` aceita total desconhecido (`declarados: null`).
- CI nos Node 18, 20 e 22.

### Mudou

- `clientes()` e `processos()` não aceitam mais `{ limit }`: paginam sozinhos.
- Instalação pelo GitHub (`npm install github:p-dromiguel/advbox-client`); o pacote não está no npm.

## [0.1.0] - 2026-08-07

Primeira versão: listagem como `{ itens, total, completa, faltando }`, modo estrito, `origemDoAndamento` e companhia, resolução de id por nome a partir do `/settings`, espaçamento entre chamadas e timeout.
