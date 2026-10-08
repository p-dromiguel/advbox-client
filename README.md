# advbox-client

Cliente Node para a API do [ADVBOX](https://www.advbox.com.br/), escrito em volta do comportamento que a documentação oficial não descreve.

[![testes](https://github.com/p-dromiguel/advbox-client/actions/workflows/testes.yml/badge.svg)](https://github.com/p-dromiguel/advbox-client/actions/workflows/testes.yml)

Zero dependências. Node 18+.

---

## O problema

Escrever um wrapper para uma API REST é trabalho de uma tarde. O que custa caro nessa API é outra coisa: **o comportamento que decide se o seu dado está certo não está escrito em lugar nenhum.** As respostas voltam `200`, bem formadas, e incompletas.

### Como eu descobri, e o erro que foi meu

Eu precisava saber se os processos de um escritório tinham andamento no tribunal. Chamei `/lawsuits/{id}/movements` — o formato óbvio, e o que eu tinha anotado num resumo interno das rotas. Recebi `200` com lista vazia e reportei que não havia andamento nenhum.

Esse caminho não existe, e a API responde `200` em vez de `404`. No caminho certo havia **23 movimentações do tribunal** num processo que eu tinha acabado de dar como parado.

(Remedido em outubro de 2026, o mesmo caminho responde `401 Unauthenticated.`, igual a token inválido. Continua sem ser `404`, e mudou sem aviso.)

**O caminho certo — `GET /movements/{lawsuit_id}` — está na documentação oficial.** Se eu tivesse aberto a fonte primária em vez de confiar no meu próprio resumo, não teria errado. A lição não é "a documentação é ruim", é **não usar resumo como fonte** — e desconfiar de um `200` vazio, porque nessa API ele não distingue "não tem dado" de "perguntei errado".

Foi esse tombo que me fez medir o resto. As armadilhas seguintes são de outra natureza: **a documentação é silenciosa sobre elas** — não menciona `totalCount`, nem paginação, nem os filtros de `/posts`, nem o teto do histórico, nem quais campos vêm nulos em qual endpoint. Nenhuma dá para deduzir lendo; todas foram medidas contra a API real, entre junho e outubro de 2026.

---

## Instalação

Ainda não está publicado no npm. Instale direto do GitHub:

```bash
npm install github:p-dromiguel/advbox-client
```

```js
const { AdvboxClient } = require('advbox-client');

const advbox = new AdvboxClient();   // lê ADVBOX_TOKEN do ambiente

const { itens, total, completa } = await advbox.clientes();
if (!completa) {
  console.warn(`Atenção: recebi ${itens.length} de ${total} clientes.`);
}
```

---

## As cinco armadilhas não documentadas

### 1. A listagem devolve menos do que declara — e às vezes esconde sem declarar

`GET /posts` já devolveu **157 registros num corpo que declarava `totalCount: 169`**. Paginar até o fim não fecha a conta: em outubro de 2026, as tarefas concluídas declararam **3.308** e entregaram **3.193** em quatro páginas.

Se o cliente devolve um array, quem chama não tem como perceber. Uma auditoria em cima de uma base pela metade acusa de "não cadastrado" gente que está cadastrada.

**Como esta biblioteca trata:** nenhuma listagem devolve array. Todas devolvem `{ itens, total, completa, faltando }` — o formato torna impossível confundir parte com todo.

As listagens grandes (`clientes`, `processos`, tarefas) paginam sozinhas, com três cuidados medidos. Param na página curta, não no `totalCount`, porque o total declarado oscila entre chamadas seguidas (227, depois 225). Tiram repetição por `id`, porque offset sobre uma lista que muda durante a varredura pode trazer o mesmo registro duas vezes. E comparam o resultado com o **maior** total declarado: se a conta oscilou, a listagem sai como incompleta, porque daqui não dá para saber se foi exclusão ou contagem instável.

```js
const r = await advbox.tarefasCriadas({ de, ate });
// { itens: [...157], total: 169, completa: false, faltando: 12 }
```

Ou, quando você prefere quebrar a não seguir com dado incompleto:

```js
const advbox = new AdvboxClient({ estrito: true });
await advbox.tarefasCriadas({ de, ate });   // lança RESPOSTA_TRUNCADA
```

**O buraco que o `totalCount` não admite: cliente sem origem.** `GET /customers` devolveu 377 registros e declarou 377 — tudo certo, pela conta da própria API. Só que as partes citadas em `GET /lawsuits` somavam **447 pessoas**, e as 70 de diferença existem: `GET /customers/{id}` responde `200` com a ficha completa. A causa: **a listagem esconde quem está sem origem, e o `totalCount` esconde junto.** Quase todas vieram de uma importação que criou a ficha só com o nome.

Aqui `completa` vem `true`, porque a API não admite o buraco. Para ter a base inteira, junte a listagem com as partes de `GET /lawsuits` — e atenção: lá a chave é `customer_id`, não `id`. Preencher a origem no ADVBOX faz o cliente voltar a aparecer na listagem.

### 2. `?origin=TRIBUNAL` é aceito e ignorado

Esse parâmetro **não está na documentação** — e é justamente o problema: a API o aceita, responde `200`, e não filtra nada. Um andamento escrito pelo *seu próprio sistema* volta tanto em `origin=TRIBUNAL` quanto em `origin=MANUAL`.

Parâmetro desconhecido que devolve erro é um aborrecimento de cinco minutos. Parâmetro desconhecido que é silenciosamente ignorado passa em revisão de código, passa em teste manual, e só aparece em produção como dado errado.

O que separa é o campo **`header`**: a sigla do tribunal (`"TJRJ"`) quando veio do Judiciário, `null` quando é registro interno.

Isso não é detalhe técnico. Confiar nesse filtro significa avisar o cliente que "saiu novidade no processo" quando o que saiu foi um boleto que o próprio sistema emitiu.

```js
const { origemDoAndamento, apenasDoTribunal } = require('advbox-client');

origemDoAndamento({ header: 'TJRJ' });   // 'tribunal'
origemDoAndamento({ header: null });     // 'interno'
origemDoAndamento({ description: '…' }); // 'desconhecido'  ← não assume nada
```

E não é só o `origin`. **Qualquer parâmetro que a API não conhece é ignorado do mesmo jeito**, com `200` e a base inteira: `GET /customers?search=ZZZQQQXXX` devolve todos os 404 clientes. Pior, o campo `query` da resposta ecoa o `search` de volta, como se o filtro tivesse sido aplicado. Já vimos o mesmo com `users_id`, `date`, `from`/`to`, `period` e `q`.

Por isso nenhum método desta biblioteca aceita parâmetro livre. Cada filtro que ela manda (`created_*`, `completed_*`, `identification`, `limit`, `offset`) foi conferido contra a API.

### 3. A chamada barata é justamente a que perde o campo que decide

`GET /last_movements` traz o último andamento de **todos** os processos numa requisição só — e devolve `header` **nulo em todos os registros**.

Ou seja: a chamada eficiente não permite distinguir tribunal de interno. Para isso é `/movements/{id}`, um processo por vez, o que só se paga quando o conjunto é pequeno.

**Como esta biblioteca trata:** uma guarda explícita, para que ninguém conclua "nenhum andamento do tribunal" a partir de um campo que a chamada não trouxe.

```js
const { origemEhDecidivel } = require('advbox-client');

const { itens } = await advbox.ultimosAndamentos();
if (!origemEhDecidivel(itens)) {
  // header nulo em tudo — use andamentos(id) nos que interessam
}
```

### 4. A tarefa não tem status; quem conclui é cada convidado

Não existe campo de status na tarefa. `users[]` traz um item por convidado, cada um com o seu `completed` (data e hora, ou `null` enquanto a pessoa não concluiu). As duas janelas de `GET /posts` seguem isso, de um jeito que não está escrito em lugar nenhum:

- `created_*` traz a tarefa enquanto **algum** convidado ainda não concluiu. Quando todos concluem, ela sai;
- `completed_*` traz a tarefa assim que o **primeiro** convidado conclui.

Lendo só a de criadas, o trabalho terminado some sem aviso, e é justamente o que você queria contar. Juntando as duas por concatenação, a tarefa concluída pela metade conta duas vezes: em outubro de 2026 eram **22 tarefas nas duas listas** numa base de 3.356, todas com mais de um convidado. E a receita que parece esperta, "criadas menos concluídas = o que está aberto", apaga a tarefa que ainda está aberta para alguém.

**Como esta biblioteca trata:** `tarefas()` consulta as duas e une por `id`, com a origem marcada em cada item. Quem ainda deve a tarefa se pergunta à própria tarefa, não à lista:

```js
const { situacaoDaTarefa, convidadosPendentes } = require('advbox-client');

const r = await advbox.tarefas({ de: '2026-01-01', ate: '2026-12-31' });
r.itens[0]._lista_origem;          // 'criadas' | 'concluidas' | 'ambas'
situacaoDaTarefa(r.itens[0]);      // 'aberta' | 'parcial' | 'concluida'
convidadosPendentes(r.itens[0]);   // [260244]  ← user_id de quem ainda não concluiu
```

A data de conclusão também só existe no convidado: na tarefa concluída, `date_deadline` veio nulo em 965 de 1.000.

As chamadas individuais continuam disponíveis, para quando o buraco é consciente:

```js
await advbox.tarefasCriadas({ de, ate });
await advbox.tarefasConcluidas({ de, ate });
```

### 5. O histórico para em 20 e não avisa

`GET /history/{lawsuit_id}` devolve no máximo **20 itens** e não pagina: `offset=20` e `page=2` voltam com os mesmos 20. Não há `totalCount` para denunciar o corte. Medido num processo com 432 tarefas.

É a única rota que diz quem escreveu um comentário (em `GET /posts`, `users` é quem *recebeu*). Então, numa conversa longa, o começo some, e com ele quem pediu o quê.

**Como esta biblioteca trata:** ao bater no teto, `historico()` devolve `completa: false` e `total: null`. O total real é desconhecido, e um número inventado seria pior que nenhum.

```js
const h = await advbox.historico(lawsuitId);
// { itens: [...20], total: null, completa: false, faltando: null }
```

### Mais duas, sem tratamento em código

Não há o que um cliente só de leitura possa fazer por elas, mas custam caro para quem não sabe:

- **O preço de hoje reescreve o passado.** O `reward` que `GET /posts` devolve é o valor *atual* do tipo de tarefa. Editar o valor de um tipo muda o `reward` de todas as tarefas antigas dele (uma tarefa de março que valia 15 passou a mostrar 25). Excluir o tipo e criar outro com o mesmo nome preserva as antigas. Placar de mês fechado tem que ser guardado no dia, não recalculado.
- **`/settings` só lista conta ativa.** Quem foi desativado some de `users`, mas continua convidado nas tarefas abertas. `resolverId` devolve `null` para essa pessoa, e a tarefa fica parada no nome de quem saiu.

---

## Outras decisões

**Nenhum id fixado no código.** Ids de tipo de tarefa, etapa, origem e usuário mudam quando a equipe mexe no painel — e um id errado não dá erro, grava no lugar errado, calado. Resolva por nome, a partir do `GET /settings`:

```js
const { resolverId, resolverItem } = require('advbox-client');

const settings = await advbox.settings();
resolverId(settings, 'users', 'joão da silva');            // 102 — ignora acento e caixa
resolverItem(settings, 'tasks', 'reunião com cliente');    // { id, task, reward }
```

Atenção: na coleção `tasks`, o nome fica no campo **`task`**, não em `name`. É o erro mais comum contra essa API.

**Espaçamento entre chamadas.** O limite é 30 GET por minuto e o `429` chega no pior momento — no meio de uma varredura, deixando metade dos dados para trás. O cliente espaça as requisições sozinho. Ajuste com `intervaloMs`, ou passe `0` para desligar.

**Timeout de 15s.** Sem `AbortController`, uma API lenta pendura a requisição de quem chamou indefinidamente. Configurável em `timeoutMs`; o estouro vira um erro com `status: 504`.

**`401` nem sempre é token.** Rota inexistente responde `401 Unauthenticated.`, igual a token inválido. A mensagem de erro diz isso, para ninguém trocar um token que estava certo.

**O token nunca aparece em mensagem de erro.** Há teste travando isso.

---

## API

| Método | Endpoint | Devolve |
|---|---|---|
| `settings()` | `GET /settings` | objeto |
| `clientes()` | `GET /customers`, paginado | listagem |
| `clientePorCpf(cpf)` | `GET /customers?identification=` | objeto ou `null` |
| `aniversariantes()` | `GET /customers/birthdays` | listagem |
| `processos()` | `GET /lawsuits`, paginado | listagem |
| `processo(id)` | `GET /lawsuits/{id}` | objeto |
| `andamentos(lawsuitId)` | `GET /movements/{id}` | listagem |
| `ultimosAndamentos()` | `GET /last_movements` | listagem |
| `historico(lawsuitId)` | `GET /history/{id}` (teto de 20) | listagem |
| `tarefas({ de, ate })` | `GET /posts` ×2, unidas por `id` | listagem |
| `tarefasCriadas({ de, ate })` | `GET /posts`, paginado | listagem |
| `tarefasConcluidas({ de, ate })` | `GET /posts`, paginado | listagem |

*Listagem* é sempre `{ itens, total, completa, faltando }`. `total` e `faltando` vêm `null` quando a rota corta sem dizer quanto existe (é o caso do histórico).

**Funções puras** (sem rede, testáveis isoladas): `origemDoAndamento`, `apenasDoTribunal`, `origemEhDecidivel`, `rastreabilidade`, `situacaoDaTarefa`, `convidadosPendentes`, `resolverId`, `resolverItem`, `nomesDisponiveis`, `normalizar`.

---

## Testes

```bash
npm test
```

44 testes, sem rede e sem segredo — o `fetch` é injetado. As armadilhas são testadas com os números reais que as revelaram (157 de 169, 3.193 de 3.308, a tarefa concluída por um convidado e aberta para o outro).

---

## Escopo

Só leitura, por enquanto. A API tem rotas de escrita (`POST /customers`, `POST /lawsuits`, `POST /posts`, `POST /movements`), mas escrever no sistema de um escritório é decisão, não conveniência — e a API **não tem DELETE nem PUT de tarefa**, então o que entra errado fica. Prefiro publicar a parte que não pode causar dano.

Não é um projeto oficial nem tem qualquer relação com o ADVBOX. Foi escrito a partir de comportamento observado contra a API real, e o comportamento pode mudar sem aviso — os números citados foram medidos entre junho e outubro de 2026. O que mudou entre uma versão e outra está no [CHANGELOG](CHANGELOG.md).

## Licença

MIT © Pedro Miguel dos Santos Silva
