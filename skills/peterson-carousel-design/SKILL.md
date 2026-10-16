---
name: peterson-carousel-design
description: Proponha quatro conceitos visuais, gere ou edite elementos com fundo transparente após escolha e renderize carrosséis aprovados de @petersonbenhame com composição panorâmica e continuidade visual.
---

# Design panorâmico do carrossel

Transforme um JSON de conteúdo aprovado em um carrossel editorial contínuo. Leia `../../shared/brand.json`, `../../shared/themes.json`, `../../shared/carousel.schema.json` e `../../shared/references/content-contract.md` antes de trabalhar.

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
5. Salve o ativo aprovado sob a pasta de entrada e registre seu caminho relativo no JSON.
6. Execute `node ../../scripts/validate-carousel.mjs <carousel.json>` e renderize com `../../scripts/render-carousel.mjs` conforme a interface do script.
7. Inspecione a prévia panorâmica e uma amostra que inclua capa, uma transição contínua, uma lâmina densa e CTA.

Antes de concluir, confirme que cada PNG mede exatamente 1080 × 1350, a sequência não tem lacunas, nenhum texto foi cortado e as bordas declaradas mantêm continuidade visual. Em falhas localizadas, repare e renderize apenas o ativo ou a composição afetada. Não altere silenciosamente o conteúdo aprovado.
