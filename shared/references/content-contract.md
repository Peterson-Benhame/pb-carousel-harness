# Contrato de conteúdo do carrossel

`carousel.schema.json` é a definição estrutural do payload trocado entre as
skills de copy e design, o renderizador e o empacotamento. Antes de renderizar,
use `validateCarousel(carousel)`; ele aplica toda a estrutura do schema e os
invariantes semânticos obrigatórios do validador, devolvendo uma lista ordenada
de erros, ou uma lista vazia para um payload válido.

## Campos de nível superior

| Campo | Tipo e valores | Regra |
| --- | --- | --- |
| `slug` | string não vazia | Identificador de diretório e arquivo. |
| `theme` | `tech-executive`, `builder-editorial`, `future-human` | Deve ser um ID de `shared/themes.json`. |
| `voiceMode` | `default`, `provocative`, `personal-story` | `provocative` e `personal-story` só entram quando solicitados. |
| `objective` | `save`, `share`, `comment`, `story-share`, `conversion` | Define o CTA principal. |
| `slides` | array de lâminas | Tem de ter 12 a 16 itens, salvo exceção aprovada. |
| `caption` | string não vazia | Legenda final para publicação. |
| `cta` | string não vazia | Um único CTA principal, coerente com `objective`. |
| `hashtags` | array não vazio de strings | Hashtags específicas e moderadas. |
| `altText` | string não vazia | Descrição acessível do carrossel. |
| `sources` | array não vazio de fontes | Cada fonte possui `title` e `url`. |
| `continuity` | array de vínculos | Cada vínculo usa `from`, `to` e `assetId`. Os índices e o ativo devem existir. |
| `assets` | array de ativos | Cada ativo possui `id`, `path`, `transparent` e `approved`. |

`theme` usa exclusivamente os IDs aprovados em `themes.json`. As dimensões de
renderização continuam sendo a fonte de verdade em `brand.json`: 1080 × 1350
px por lâmina.

## Lâminas

Cada item de `slides` exige `index` (inteiro positivo e único), `role`,
`eyebrow`, `title`, `body` e `visualSlot`.

- `role`: `cover`, `context`, `content`, `summary` ou `cta`.
- `visualSlot`: `left`, `right`, `center` ou `none`.
- `code`, `number` e `imageAlt` são opcionais.

O schema exige estruturalmente ao menos uma lâmina `cover` e uma `cta` com
`contains`. A unicidade de `index` é um invariante semântico obrigatório do
validador: JSON Schema padrão não expressa de forma útil a unicidade de uma
propriedade dentro de itens de objeto. Os consumidores devem executar
`validateCarousel` mesmo quando já tiverem aplicado o schema.

## Ativos e continuidade

Todo ativo usado em `continuity` deve ter um `id` no payload, um caminho
relativo normalizado e interno em `path`, `transparent: true` e `approved:
true`. `path` não pode ter raiz, barra invertida, segmento `.` ou `..`, barra
duplicada, NUL ou esquema URL; o consumidor também deve resolvê-lo e confirmar
que permanece abaixo do diretório de ativos. A aprovação se refere ao elemento
visual transparente já apresentado ao usuário. Cada vínculo de continuidade
declara os índices de lâmina que o ativo conecta em `from` e `to`; não pode
apontar para lâminas ou ativos inexistentes.

## Exceção de quantidade

Uma quantidade fora de 12–16 só é válida depois de aprovação explícita do
usuário. Registre essa decisão no próprio payload com:

```json
{
  "slideCountException": true,
  "slideCountExceptionReason": "O usuário aprovou a versão concisa para este tema."
}
```

Os dois campos são obrigatórios para a exceção; sem eles o validador retorna
`slides must contain between 12 and 16 items`. A exceção não dispensa cover,
CTA, textos de entrega, referências ou aprovação dos ativos.

## Exemplo completo

O fixture canônico está em
`tests/fixtures/valid-carousel.json`. Ele usa o tema A (`tech-executive`), 12
slides, CTA para salvar, uma fonte e o ativo transparente aprovado `bridge`
conectando as lâminas 1 e 2.
