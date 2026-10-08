# advbox-client

Cliente Node para a API do [ADVBOX](https://www.advbox.com.br/), escrito em volta do comportamento que a documentação oficial não descreve, ou descreve diferente do que a API faz.

[![testes](https://github.com/p-dromiguel/advbox-client/actions/workflows/testes.yml/badge.svg)](https://github.com/p-dromiguel/advbox-client/actions/workflows/testes.yml)

Zero dependências. Node 18+.

---

## O problema

Escrever um wrapper para uma API REST é trabalho de uma tarde. O que custa caro nessa API é outra coisa: **parte do comportamento que decide se o seu dado está certo não está escrita, e parte está escrita diferente do que acontece.** As respostas voltam `200`, bem formadas, e incompletas.

### Como eu descobri, e o erro que foi meu

Eu precisava saber se os processos de um escritório tinham andamento no tribunal. Chamei `/lawsuits/{id}/movements`, o formato óbvio e o que eu tinha anotado num resumo interno das rotas. Recebi `200` com lista vazia e reportei que não havia andamento nenhum.

Esse caminho não existe, e a API respondeu `200` em vez de `404`. No caminho certo havia **23 movimentações do tribunal** num processo que eu tinha acabado de dar como parado. (Remedido em outubro de 2026, o mesmo caminho responde `401 Unauthenticated.`, igual a token inválido. Continua sem ser `404`, e mudou sem aviso.)

**O caminho certo, `GET /movements/{lawsuit_id}`, está na [documentação oficial](https://api.softwareadvbox.com.br/docs).** Se eu tivesse aberto a fonte primária em vez de confiar no meu próprio resumo, não teria errado. A lição não é "a documentação é ruim". É **não usar resumo como fonte**, e desconfiar de um `200` vazio, porque nessa API ele não distingue "não tem dado" de "perguntei errado".

Foi esse tombo que me fez medir o resto e conferir cada medição contra a doc. Cada armadilha abaixo diz o que a documentação afirma sobre ela, e a seção [A documentação × a API](#a-documentação--a-api) junta as divergências numa tabela. Tudo foi medido contra a API real, entre junho e outubro de 2026, e conferido com a doc na versão v1.25.0 (22/09/2026).

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

## As cinco armadilhas

### 1. A listagem devolve menos do que declara, e às vezes esconde sem declarar

`GET /posts` já devolveu **157 registros num corpo que declarava `totalCount: 169`**. Paginar até o fim não fecha a conta: em outubro de 2026, as tarefas concluídas declararam **3.308** e entregaram **3.193** em quatro páginas.

Se o cliente devolve um array, quem chama não tem como perceber. Uma auditoria em cima de uma base pela metade acusa de "não cadastrado" gente que está cadastrada.

**Na documentação:** `totalCount`, `limit` e `offset` estão documentados, com `limit` de 1 a 1000. Que o total declarado passa do que dá para alcançar, não.

**Como esta biblioteca trata:** nenhuma listagem devolve array. Todas devolvem `{ itens, total, completa, faltando }`, e o formato torna impossível confundir parte com todo.

As listagens (`clientes`, `processos`, `aniversariantes`, `ultimosAndamentos` e as de tarefas) paginam sozinhas, com três cuidados medidos. Param na página curta, não no `totalCount`, porque o total declarado oscila entre chamadas seguidas (227, depois 225). Tiram repetição por chave, porque offset sobre uma lista que muda durante a varredura pode trazer o mesmo registro duas vezes. E comparam o resultado com o **maior** total declarado: se a conta oscilou, a listagem sai como incompleta, porque daqui não dá para saber se foi exclusão ou contagem instável.

```js
const r = await advbox.tarefasConcluidas({ de: '2025-01-01', ate: '2026-10-08' });
// { itens: [...3193], total: 3308, completa: false, faltando: 115 }
```

Ou, quando você prefere quebrar a seguir com dado incompleto:

```js
const advbox = new AdvboxClient({ estrito: true });
await advbox.tarefasConcluidas({ de, ate });   // lança RESPOSTA_TRUNCADA
```

**O buraco que o `totalCount` não admite: cliente sem origem.** `GET /customers` devolveu 377 registros e declarou 377, tudo certo pela conta da própria API. Só que as partes citadas em `GET /lawsuits` somavam **447 pessoas**, e as 70 de diferença existem: `GET /customers/{id}` responde `200` com a ficha completa. A causa: **a listagem esconde quem está sem origem, e o `totalCount` esconde junto.** Quase todas vieram de uma importação que criou a ficha só com o nome.

Aqui `completa` vem `true`, porque a API não admite o buraco. Para ter a base inteira, junte a listagem com as partes de `GET /lawsuits`. Atenção: lá a chave é `customer_id`, não `id`. Preencher a origem no ADVBOX faz o cliente voltar a aparecer na listagem.

### 2. Parâmetro que a API não reconhece é aceito e ignorado

`GET /customers?search=ZZZQQQXXX` devolve `200` com **todos os 404 clientes**. O `search` não existe nessa rota, e a API não reclama: ignora e devolve a base inteira. Pior, o campo `query` da resposta ecoa o `search` de volta, como se o filtro tivesse sido aplicado. Já vimos o mesmo com `users_id`, `date`, `from`/`to`, `period` e `q`.

Vale também para valor inválido em parâmetro que existe: `GET /history/{id}?status=xyz` devolve o mesmo que sem filtro nenhum.

E vale para o par de datas pela metade, este sim documentado. Em `GET /posts`, só `created_start`, sem `created_end`, declarou **191** tarefas, o mesmo total de sem filtro nenhum. Com o par completo, **66**.

Parâmetro desconhecido que devolve erro é um aborrecimento de cinco minutos. Parâmetro desconhecido que é silenciosamente ignorado passa em revisão de código, passa em teste manual, e só aparece em produção como dado errado.

**Na documentação:** o par de datas pela metade está avisado ("faz a API IGNORAR o filtro"). Parâmetro desconhecido e valor inválido, não.

**Como esta biblioteca trata:** nenhum método aceita parâmetro livre. Os filtros que ela manda (`created_*`, `completed_*`, `identification`, `status`, `limit`, `offset`) estão na doc e foram conferidos contra a API. E o que pode sair torto é recusado antes de sair:

```js
await advbox.tarefasCriadas({ de: '2026-10-01' });
// lança: Janela de tarefas exige { de, ate } no formato AAAA-MM-DD

await advbox.historico(lawsuitId, { status: 'xyz' });
// lança: status "xyz" não existe. Use pending, completed, all
```

### 3. A chamada barata não traz o campo que decide a origem do andamento

O que separa um andamento do tribunal de um registro que o seu próprio sistema escreveu é o campo **`header`**: o tribunal (`"TJRJ"`) quando veio do Judiciário, `null` quando é interno. Isso não é detalhe técnico. Errar aqui é avisar o cliente que "saiu novidade no processo" quando o que saiu foi um boleto que o próprio sistema emitiu.

`GET /last_movements` traz o último andamento de cada processo em lote, e **não traz o campo `header`**: em outubro de 2026, ele não veio em nenhum dos 182 itens. Para decidir a origem é `GET /movements/{id}`, um processo por vez, o que só se paga quando o conjunto é pequeno.

**Na documentação:** o exemplo de resposta de `/last_movements` mostra `header` preenchido em todos os itens. A API não manda o campo.

**Como esta biblioteca trata:** a classificação é feita pelo `header`, e uma guarda explícita impede alguém de concluir "nenhum andamento do tribunal" a partir de um campo que a chamada não trouxe.

```js
const { origemDoAndamento, apenasDoTribunal, origemEhDecidivel } = require('advbox-client');

origemDoAndamento({ header: 'TJRJ' });   // 'tribunal'
origemDoAndamento({ header: null });     // 'interno'
origemDoAndamento({ title: '…' });       // 'desconhecido', não assume nada

const { itens } = await advbox.ultimosAndamentos();
if (!origemEhDecidivel(itens)) {
  // sem header em nenhum item: use andamentos(id) nos que interessam
}
```

E o `?origin=TRIBUNAL` de `GET /movements/{id}`? É documentado, e em agosto de 2026 deixava andamento interno voltar também na resposta de `TRIBUNAL`. Remedido em outubro, separa certo (21 do tribunal, 1 interno). A classificação pelo `header` dá o mesmo resultado hoje e não depende de o filtro continuar funcionando.

### 4. A tarefa não tem status; quem conclui é cada convidado

`users[]` traz um item por convidado, cada um com o seu `completed` (data e hora, ou `null` enquanto a pessoa não concluiu). Não existe status da tarefa inteira. As janelas de `GET /posts` seguem isso assim:

- `created_*` traz a tarefa enquanto **algum** convidado ainda não concluiu. Quando todos concluem, ela sai;
- `completed_*` traz a tarefa assim que o **primeiro** convidado conclui, mesmo com outros pendentes;
- sem filtro nenhum, vêm só as tarefas com algum convidado pendente: das 186 entregues (de 191 declaradas), nenhuma foi concluída por todos, contra 3.308 concluídas desde 2025.

Lendo só a de criadas, o trabalho terminado some sem aviso, e é justamente o que você queria contar. Juntando as duas por concatenação, a tarefa concluída pela metade conta duas vezes: em outubro de 2026 eram **22 tarefas nas duas listas** numa base de 3.356, todas com mais de um convidado. E a receita que parece esperta, "criadas menos concluídas = o que está aberto", apaga a tarefa que ainda está aberta para alguém.

**Na documentação:** ela avisa que "tarefas podem ter múltiplos usuários com status diferentes", e isso está certo. Mas diz que `completed_*` retorna "APENAS tarefas concluídas" (traz também a concluída pela metade) e que sem filtro vêm "pendentes e concluídas" (vêm só as pendentes). O que `created_*` faz com a tarefa concluída, ela não diz.

**Como esta biblioteca trata:** `tarefas()` consulta as duas janelas e une por `id`, com a origem marcada em cada item. Quem ainda deve a tarefa se pergunta à própria tarefa, não à lista:

```js
const { situacaoDaTarefa, convidadosPendentes } = require('advbox-client');

const r = await advbox.tarefas({ de: '2026-01-01', ate: '2026-12-31' });
r.itens[0]._lista_origem;          // 'criadas' | 'concluidas' | 'ambas'
situacaoDaTarefa(r.itens[0]);      // 'aberta' | 'parcial' | 'concluida'
convidadosPendentes(r.itens[0]);   // [260244], o user_id de quem ainda não concluiu
```

A data de conclusão também só existe no convidado: na tarefa concluída, `date_deadline` veio nulo em 965 de 1.000.

As chamadas individuais continuam disponíveis, para quando o buraco é consciente:

```js
await advbox.tarefasCriadas({ de, ate });
await advbox.tarefasConcluidas({ de, ate });
```

### 5. O histórico para em 20 e não avisa

`GET /history/{lawsuit_id}` devolve no máximo **20 itens**. Não há `totalCount` para denunciar o corte, e `offset=20` volta com os mesmos 20. Medido num processo com 432 tarefas.

É a única rota que diz quem escreveu um comentário (em `GET /posts`, `users` é quem *recebeu*). Então, numa conversa longa, o começo some, e com ele quem pediu o quê.

**Na documentação:** que `limit` e `offset` não funcionam aqui está avisado. Mas ela diz que a rota "retorna todas as tarefas do processo de uma vez", e são 20. O filtro `status` (`pending`, `completed`, `all`) é documentado e funciona: no mesmo processo, `pending` trouxe 16. O teto vale do mesmo jeito.

**Como esta biblioteca trata:** ao bater no teto, `historico()` devolve `completa: false` e `total: null`. O total real é desconhecido, e um número inventado seria pior que nenhum.

```js
const h = await advbox.historico(lawsuitId);
// { itens: [...20], total: null, completa: false, faltando: null }

await advbox.historico(lawsuitId, { status: 'pending' });   // recorte menor, mesmo teto
```

### Mais duas, sem tratamento em código

Não há o que um cliente só de leitura possa fazer por elas, mas custam caro para quem não sabe. Nenhuma das duas está na documentação.

- **O preço de hoje reescreve o passado.** O `reward` que `GET /posts` devolve é o valor *atual* do tipo de tarefa. Editar o valor de um tipo muda o `reward` de todas as tarefas antigas dele: uma tarefa que valia 15 num retrato de julho aparece com 25 hoje. Excluir o tipo e criar outro com o mesmo nome preserva as antigas. Placar de mês fechado tem que ser guardado no dia, não recalculado.
- **`/settings` só lista conta ativa.** Quem foi desativado some de `users`, mas continua convidado nas tarefas abertas. `resolverId` devolve `null` para essa pessoa, e a tarefa fica parada no nome de quem saiu.

---

## A documentação × a API

Conferido em 08/10/2026 contra a [documentação oficial](https://api.softwareadvbox.com.br/docs), versão **v1.25.0 (22/09/2026)**. A doc tem [changelog público](https://api.softwareadvbox.com.br/docs/changelog); quando ele mudar, esta tabela é a primeira coisa a conferir de novo.

| Ponto | A doc diz | A API fez |
|---|---|---|
| `totalCount` das listagens | o total de registros | maior que o alcançável: 3.308 declaradas, 3.193 entregues paginando até o fim |
| `GET /posts` sem filtro | "todas as tarefas (pendentes e concluídas)" | só as que têm convidado pendente: 186 entregues, nenhuma concluída por todos |
| `GET /posts` com `completed_*` | "APENAS tarefas concluídas" | também a concluída por um convidado e pendente para outro: 22 |
| `GET /history/{id}` | "todas as tarefas do processo de uma vez" | no máximo 20 |
| `header` em `GET /last_movements` | preenchido no exemplo | ausente em 182 de 182 |
| `GET /movements/{id}` com id inexistente | `204 No Content` | `404 Not found.` |
| `GET /movements/{id}` com token inválido | `302` para `/login` | `401 Unauthenticated.` |
| `?origin=` em `GET /movements/{id}` | filtra `TRIBUNAL` ou `MANUAL` | filtra (21 × 1); em agosto de 2026, não filtrava |
| Par de datas pela metade em `GET /posts` | o filtro é ignorado | confirmado: declara 191, igual a sem filtro (com o par, 66) |

---

## Outras decisões

**Nenhum id fixado no código.** Ids de tipo de tarefa, etapa, origem e usuário mudam quando a equipe mexe no painel, e um id errado não dá erro: grava no lugar errado, calado. Resolva por nome, a partir do `GET /settings`:

```js
const { resolverId, resolverItem } = require('advbox-client');

const settings = await advbox.settings();
resolverId(settings, 'users', 'joão da silva');            // 102 (ignora acento e caixa)
resolverItem(settings, 'tasks', 'reunião com cliente');    // { id, task, reward }
```

Atenção: na coleção `tasks`, o nome fica no campo **`task`**, não em `name`. É o erro mais comum contra essa API. As coleções com nome são as que a doc lista e a API devolve: `users`, `origins`, `tasks`, `stages` e `lawsuit_types`. Pedir outra é erro, e coleção que não veio na resposta também: "não achei" só vale quando a pergunta pôde ser feita.

**Espaçamento entre chamadas.** O limite documentado é 30 GET por minuto, e o `429` chega no pior momento: no meio de uma varredura, deixando metade dos dados para trás. O cliente espaça as requisições sozinho. Ajuste com `intervaloMs`, ou passe `0` para desligar.

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
| `aniversariantes()` | `GET /customers/birthdays` (mês atual), paginado | listagem |
| `processos()` | `GET /lawsuits`, paginado | listagem |
| `processo(id)` | `GET /lawsuits/{id}` | objeto |
| `andamentos(lawsuitId)` | `GET /movements/{id}` | listagem |
| `ultimosAndamentos()` | `GET /last_movements`, paginado | listagem |
| `historico(lawsuitId, { status })` | `GET /history/{id}` (teto de 20) | listagem |
| `tarefas({ de, ate })` | `GET /posts` ×2, unidas por `id` | listagem |
| `tarefasCriadas({ de, ate })` | `GET /posts`, paginado | listagem |
| `tarefasConcluidas({ de, ate })` | `GET /posts`, paginado | listagem |

*Listagem* é sempre `{ itens, total, completa, faltando }`. `total` e `faltando` vêm `null` quando a rota corta sem dizer quanto existe (é o caso do histórico). Nas tarefas, `de` e `ate` são obrigatórios, no formato `AAAA-MM-DD`.

**Funções puras** (sem rede, testáveis isoladas): `origemDoAndamento`, `apenasDoTribunal`, `origemEhDecidivel`, `rastreabilidade`, `situacaoDaTarefa`, `convidadosPendentes`, `resolverId`, `resolverItem`, `nomesDisponiveis`, `normalizar`.

---

## Testes

```bash
npm test
```

52 testes, sem rede e sem segredo: o `fetch` é injetado. As armadilhas são testadas com os números reais que as revelaram (157 de 169, 3.193 de 3.308, a tarefa concluída por um convidado e aberta para o outro, o histórico parado em 20). O CI roda nos Node 18, 20 e 22.

---

## Escopo

Só leitura, por enquanto. A API tem rotas de escrita (`POST /customers`, `POST /lawsuits`, `PUT /lawsuits/{id}`, `POST /lawsuits/movement`, `POST /posts`, `POST` e `PUT /transactions`), mas escrever no sistema de um escritório é decisão, não conveniência. E a API **não tem DELETE em rota nenhuma, nem PUT de tarefa**, então o que entra errado fica. Prefiro publicar a parte que não pode causar dano.

Não é um projeto oficial nem tem qualquer relação com o ADVBOX. Foi escrito a partir de comportamento observado contra a API real, e o comportamento pode mudar sem aviso: os números citados foram medidos entre junho e outubro de 2026. O que mudou entre uma versão e outra está no [CHANGELOG](CHANGELOG.md).

## Licença

MIT © Pedro Miguel dos Santos Silva
