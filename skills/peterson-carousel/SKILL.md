---
name: peterson-carousel
description: Coordene o teste parcial local de um carrossel para @petersonbenhame, do tema até a submissão de Layout, parando quando Produção for atribuída; não renderiza preview/final nem cria pacote.
---

# Peterson Carousel

Coordene o trecho liberado sem fazer Peterson chamar cada etapa manualmente. Preserve tudo que já tiver sido aprovado e não repita uma etapa já aprovada.

## Harness local obrigatório

Use `../../scripts/harness-local.cmd bridge <request.json>` como entrada não interativa para memória e runtime. O JSON privado deve conter somente `command`, `dataDir` absoluto e `input`; execute `doctor` antes de consultar ou alterar estado. Não forneça `packageRoot`, `terminal`, `ask`, streams, flags de aprovação ou receipts. Quando `nextAction` exigir aprovação ou quality review, pare e entregue o pedido ao usuário por `../../scripts/harness-local.cmd cli <comando> --data-dir <diretório> --request <json-privado>` em um terminal TTY real; depois retome pelo bridge. Nunca serialize uma resposta humana nem simule TTY. Se a memória ainda não estiver inicializada, pare e solicite a inicialização explícita. Mantenha entradas e lâminas pessoais apenas no diretório privado da execução.

### Ciclo editorial por assignment

Com uma execução inicializada, coordene somente os papéis liberados pelo ciclo público desta versão de teste:

1. Envie `editorial.next` com `requestId`, `brandId`, `runId` e, apenas ao iniciar ou revisar materialmente a pauta, `request`.
2. Se a resposta trouxer `assignment`, execute somente `assignment.role`, siga `assignment.skill` e use apenas `assignment.context`.
3. Envie `editorial.submit` com novo `requestId`, o mesmo escopo, `assignmentId` e `output`. Não envie `role`: o harness deriva o responsável e rejeita etapa antiga ou fora de ordem.
4. Repita `next → skill → submit` até submeter o Designer de Layout. Se `next` retornar `waiting-human-approval` ou `waiting-human-review`, use o handoff TTY acima e não produza o papel seguinte antes da decisão humana persistida.
5. Nesta release de teste parcial, quando `editorial.next` retornar uma assignment com `role: production-manager`, pare. Não execute a skill dessa assignment e não chame `editorial.submit`: Produção ainda não é aceita pelo protocolo público. Não alegue preview, QA ou package.

Reutilize um `requestId` somente para repetir exatamente a mesma chamada. Uma revisão material começa por novo `editorial.next` com o pedido revisado; não reutilize handoffs descendentes da pauta anterior.

## Roteamento

- Pedido para explorar temas ou escolher um ângulo: siga `../peterson-carousel-idea/SKILL.md` e encerre após a escolha.
- Pedido somente de roteiro, legenda ou copy: siga `../peterson-carousel-copy/SKILL.md` e pare na aprovação do texto.
- Pedido somente de identidade, conceito visual, imagem ou renderização de JSON aprovado: siga `../peterson-carousel-design/SKILL.md` a partir do estágio correspondente.
- Pedido de carrossel pronto: execute somente o fluxo parcial liberado abaixo.

Se o pedido for natural, como “crie um carrossel sobre erros de arquitetura em startups”, assuma o fluxo parcial até Layout. Pergunte apenas o que mudar materialmente o resultado.

## Estado da execução

Antes de agir, identifique o último estágio concluído:

| Estado | Próxima ação |
| --- | --- |
| Tema ausente | Solicitar o tema. |
| Ideia ainda aberta | Explorar ou definir o recorte. |
| Texto não aprovado | Produzir ou revisar a copy. |
| Texto aprovado | Propor quatro conceitos visuais. |
| Conceito aprovado | Gerar o ativo transparente escolhido. |
| Imagem aprovada | Montar, validar e renderizar. |
| PNGs validados | Criar arquivos editoriais e ZIP. |

Quando houver run do harness, use `editorial.next` como fonte de estado. Sem run, use os artefatos da conversa. Uma solicitação de ajuste invalida somente o estágio afetado e os posteriores.

## Fluxo parcial liberado em 0.1.2

1. Receba tema, briefing, transcrição ou ideia aprovada. Faça pesquisa primária quando houver fatos atuais, dados, ferramentas, comandos ou APIs.
2. Siga a skill de copy. Produza entre 12 a 16 lâminas, legenda, CTA adaptativo, hashtags, texto alternativo e referências.
3. Mostre a revisão completa e pare em `AGUARDAR APROVAÇÃO DO TEXTO`.
4. Após a aprovação, siga a skill de design e apresente quatro propostas sem gerar imagens. Pare em `AGUARDAR ESCOLHA DO CONCEITO`.
5. Gere somente o conceito selecionado com fundo transparente. Mostre o ativo e pare em `AGUARDAR APROVAÇÃO DA IMAGEM`.
6. Após a aprovação, produza e submeta somente o Layout pelo ciclo editorial público.
7. Chame `editorial.next` uma vez. Quando receber `production-manager`, pare e informe que o teste parcial terminou no limite esperado.
8. Não chame Produção, `preview`, `render.final`, `validate`, QA ou `package` nesta release. Nunca use `render-carousel.mjs`, `validate-carousel.mjs` ou `package-carousel.mjs` como atalho.

## Limites de conclusão

Nunca trate silêncio como aprovação. Nunca avance por cima de um marcador. Não afirme que a renderização terminou sem verificar arquivos, dimensões, sequência, leitura, continuidade e integridade do ZIP.

Se uma dependência, ativo, permissão ou evidência estiver ausente, informe o bloqueio e a ação necessária. Preserve o conteúdo e os ativos já aprovados. Retome no próximo estágio inacabado quando Peterson continuar a conversa.
