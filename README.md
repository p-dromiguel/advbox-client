# advbox-client

Cliente Node para a API do [ADVBOX](https://www.advbox.com.br/), escrito em volta das armadilhas que a documentação oficial não conta.

Zero dependências. Node 18+.

---

## O problema

Escrever um wrapper para uma API REST é trabalho de uma tarde. O que custa caro nessa API não são os endpoints — é que **ela erra em silêncio**. As respostas voltam `200`, bem formadas, e mentem.

O caso que originou esta biblioteca: eu precisava saber se os processos de um escritório tinham andamento no tribunal. Chamei o endpoint, recebi `200` com lista vazia, e reportei que não havia andamento nenhum.

O caminho que eu tinha montado — `/lawsuits/{id}/movements`, que é o formato óbvio — **não existe**. E em vez de `404`, a API responde `200` e uma lista vazia. No caminho certo havia **23 movimentações do tribunal** num único processo que eu tinha acabado de dar como parado.

Nenhuma das cinco armadilhas abaixo aparece na documentação oficial. Todas foram medidas contra a API real.

---

## Instalação

```bash
npm install advbox-client
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

### 1. A listagem devolve menos do que ela mesma declara

`GET /customers` já devolveu **377 registros num corpo que declarava `totalCount: 447`**. `GET /posts`, 157 declarando 169. Paginar por offset não alcança os que faltam.

Se o cliente devolve um array, quem chama não tem como perceber. Uma auditoria em cima de uma base pela metade acusa de "não cadastrado" gente que está cadastrada.

**Como esta biblioteca trata:** nenhuma listagem devolve array. Todas devolvem `{ itens, total, completa, faltando }` — o formato torna impossível confundir parte com todo.

```js
const r = await advbox.clientes();
// { itens: [...377], total: 447, completa: false, faltando: 70 }
```

Ou, quando você prefere quebrar a não seguir com dado incompleto:

```js
const advbox = new AdvboxClient({ estrito: true });
await advbox.clientes();   // lança RESPOSTA_TRUNCADA
```

### 2. Caminho inexistente responde `200`, não `404`

`/lawsuits/{id}/movements` parece certo e não existe. O caminho real é **`/movements/{lawsuitId}`**. O mesmo vale para o histórico: é `/history/{lawsuitId}`, não `/lawsuits/{id}/history`.

**Como esta biblioteca trata:** o caminho nunca vem de fora. Não existe um método `get(path)` genérico — só métodos nomeados, com o caminho conferido. Você não consegue montar o caminho errado.

> **Regra que vale para qualquer API assim:** uma resposta `200` com coleção vazia é ambígua. Pode ser ausência de dado ou pergunta errada. Não conclua "não tem" sem antes conferir o caminho na fonte primária.

### 3. `?origin=TRIBUNAL` não filtra por origem

Um andamento escrito pelo *seu próprio sistema* volta tanto em `origin=TRIBUNAL` quanto em `origin=MANUAL`. O filtro simplesmente não separa.

O que separa é o campo **`header`**: a sigla do tribunal (`"TJRJ"`) quando veio do Judiciário, `null` quando é registro interno.

Isso não é detalhe técnico. Confiar nesse filtro significa avisar o cliente que "saiu novidade no processo" quando o que saiu foi um boleto que o próprio sistema emitiu.

```js
const { origemDoAndamento, apenasDoTribunal } = require('advbox-client');

origemDoAndamento({ header: 'TJRJ' });   // 'tribunal'
origemDoAndamento({ header: null });     // 'interno'
origemDoAndamento({ description: '…' }); // 'desconhecido'  ← não assume nada
```

### 4. A chamada barata é justamente a que perde o campo que decide

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

### 5. Tarefa concluída desaparece da lista de tarefas

`created_*` e `completed_*` são janelas **mutuamente exclusivas**. Uma tarefa concluída *sai* da lista de criadas e passa a existir só na de concluídas.

Lendo apenas uma, metade do histórico some sem aviso — e o que some é exatamente o trabalho que foi terminado, que costuma ser o que você queria contar.

**Como esta biblioteca trata:** `tarefas()` consulta as duas e devolve junto, com a origem marcada em cada item.

```js
const r = await advbox.tarefas({ de: '2026-01-01', ate: '2026-12-31' });
r.itens[0]._lista_origem;   // 'criadas' | 'concluidas'
```

As chamadas individuais continuam disponíveis, para quando o buraco é consciente:

```js
await advbox.tarefasCriadas({ de, ate });
await advbox.tarefasConcluidas({ de, ate });
```

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

**O token nunca aparece em mensagem de erro.** Há teste travando isso.

---

## API

| Método | Endpoint | Devolve |
|---|---|---|
| `settings()` | `GET /settings` | objeto |
| `clientes({ limit })` | `GET /customers` | listagem |
| `clientePorCpf(cpf)` | `GET /customers?identification=` | objeto ou `null` |
| `aniversariantes()` | `GET /customers/birthdays` | listagem |
| `processos({ limit })` | `GET /lawsuits` | listagem |
| `processo(id)` | `GET /lawsuits/{id}` | objeto |
| `andamentos(lawsuitId)` | `GET /movements/{id}` | listagem |
| `ultimosAndamentos()` | `GET /last_movements` | listagem |
| `historico(lawsuitId)` | `GET /history/{id}` | listagem |
| `tarefas({ de, ate })` | `GET /posts` ×2 | listagem |
| `tarefasCriadas({ de, ate })` | `GET /posts` | listagem |
| `tarefasConcluidas({ de, ate })` | `GET /posts` | listagem |

*Listagem* é sempre `{ itens, total, completa, faltando }`.

**Funções puras** (sem rede, testáveis isoladas): `origemDoAndamento`, `apenasDoTribunal`, `origemEhDecidivel`, `rastreabilidade`, `resolverId`, `resolverItem`, `nomesDisponiveis`, `normalizar`.

---

## Testes

```bash
npm test
```

28 testes, sem rede e sem segredo — o `fetch` é injetado. As armadilhas são testadas com os números reais que as revelaram (377 de 447, 157 de 169).

---

## Escopo

Só leitura, por enquanto. A API tem rotas de escrita (`POST /customers`, `POST /lawsuits`, `POST /posts`, `POST /movements`), mas escrever no sistema de um escritório é decisão, não conveniência — e a API **não tem DELETE nem PUT de tarefa**, então o que entra errado fica. Prefiro publicar a parte que não pode causar dano.

Não é um projeto oficial nem tem qualquer relação com o ADVBOX. Foi escrito a partir de comportamento observado contra a API real, e o comportamento pode mudar sem aviso — os números citados foram medidos entre junho e agosto de 2026.

## Licença

MIT © Pedro Miguel dos Santos Silva
