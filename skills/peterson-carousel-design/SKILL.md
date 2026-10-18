---
name: peterson-carousel-design
description: Proponha quatro conceitos visuais, gere ou edite elementos com fundo transparente após escolha e renderize carrosséis aprovados de @petersonbenhame com composição panorâmica e continuidade visual.
---

# Design panorâmico do carrossel

Transforme um JSON de conteúdo aprovado em um carrossel editorial contínuo. Leia `../../shared/brand.json`, `../../shared/themes.json`, `../../shared/carousel.schema.json` e `../../shared/references/content-contract.md` antes de trabalhar.

## Harness local obrigatório

Use `../../scripts/harness-local.cmd bridge <request.json>` como entrada não interativa para memória e runtime. O JSON privado deve conter somente `command`, `dataDir` absoluto e `input`; execute `doctor` antes de consultar ou alterar estado. Não forneça `packageRoot`, `terminal`, `ask`, streams, flags de aprovação ou receipts. Quando `nextAction` exigir aprovação ou quality review, pare e entregue o pedido ao usuário por `../../scripts/harness-local.cmd cli <comando> --data-dir <diretório> --request <json-privado>` em um terminal TTY real; depois retome pelo bridge. Nunca serialize uma resposta humana nem simule TTY. Se a memória ainda não estiver inicializada, pare e solicite a inicialização explícita. Mantenha entradas e lâminas pessoais apenas no diretório privado da execução.

## Entrada

Exija o JSON aprovado e preserve integralmente texto, CTA e fontes. Se o texto ainda não foi aprovado, encaminhe para `peterson-carousel-copy`. Fotos de Peterson só podem ser usadas quando ele as fornecer ou aprovar para esta execução.

## Primeiro ponto de aprovação: conceito

Apresente quatro conceitos visuais semanticamente diferentes. Considere nesta ordem:

1. objeto ou metáfora ligada ao assunto;
2. foto de Peterson quando reforçar autoridade ou história pessoal;
3. personagem gerado por IA quando sustentar a narrativa;
4. diagrama, interface ou trecho de código quando comunicar melhor.

Para cada conceito, informe o elemento, a relação com a mensagem, os índices das lâminas conectadas e o comportamento de continuidade visual nas bordas. Explique como a posição alternará entre esquerda e direita. Pergunte se Peterson tem uma quinta ideia melhor.

Encerre exatamente com:

`AGUARDAR ESCOLHA DO CONCEITO`

## Segundo ponto de aprovação: imagem

Após a escolha, gere ou edite somente os elementos do conceito selecionado. Use a ferramenta de geração de imagens para objetos, personagens, ilustrações ou recortes fotográficos. Solicite fundo transparente e preserve um recorte limpo. Diagramas, interfaces e código devem ser construídos deterministicamente quando precisão for mais importante que geração visual.

Mostre o resultado. Verifique que o arquivo tem canal alfa e pixels realmente transparentes. Se houver falha, corrija apenas o ativo afetado.

Encerre exatamente com:

`AGUARDAR APROVAÇÃO DA IMAGEM`

## Composição e renderização

Somente após a aprovação da imagem:

1. Escolha `tech-executive` para programação e arquitetura, `builder-editorial` para startups, empreendedorismo e histórias pessoais, ou `future-human` para IA e conteúdos explicitamente provocativos.
2. Monte uma faixa panorâmica de `1080 × quantidade de lâminas` por `1350` pixels.
3. Mantenha Anton nos títulos, Manrope no conteúdo, JetBrains Mono no código, margens seguras, numeração e rodapé `@petersonbenhame`.
4. Alterne o espaço visual entre esquerda e direita. Faça elementos cruzarem somente as bordas declaradas no plano de continuidade.
5. Salve o ativo aprovado sob a pasta de entrada e registre-o pelo harness com `input.save`; registre a composição com `plan.save`.
6. Solicite a prévia com `preview` pelo bridge e valide o `manifestId` retornado com `validate`.
7. Quando o runtime solicitar quality review ou aprovação, faça o handoff ao comando indicado usando o modo `cli` em TTY real; retome pelo bridge e confirme o novo estado com `run.runtime`.
8. Execute `render.final` somente quando os gates de prévia estiverem satisfeitos. Valide e revise o manifest final pelo harness antes de `package`.
9. Inspecione a prévia panorâmica e uma amostra que inclua capa, uma transição contínua, uma lâmina densa e CTA. Aceite como entrega apenas o pacote e os caminhos retornados pelo comando `package`.

Não execute `../../scripts/validate-carousel.mjs`, `../../scripts/render-carousel.mjs` ou `../../scripts/package-carousel.mjs` diretamente para produzir entregáveis: esses caminhos legados ficam fora dos gates, da memória e das aprovações do harness.

Antes de concluir, confirme que cada PNG mede exatamente 1080 × 1350, a sequência não tem lacunas, nenhum texto foi cortado e as bordas declaradas mantêm continuidade visual. Em falhas localizadas, repare e renderize apenas o ativo ou a composição afetada. Não altere silenciosamente o conteúdo aprovado.
