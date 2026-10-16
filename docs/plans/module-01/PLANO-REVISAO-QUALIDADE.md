# Módulo 01 — Plano de implementação, revisão de qualidade 1.1

> **Para execução por agentes:** usar desenvolvimento por tarefas com revisão independente ou execução incremental equivalente. Os passos abaixo usam checkboxes; nenhum checkbox está concluído por existir neste documento.

**Objetivo:** integrar composição qualificada, amostra aprovada e revisão final ao fluxo real, impedindo entrega sem evidência vigente.

**Arquitetura:** preservar o núcleo único CLI/plugin e o adaptador legado; acrescentar um compositor limitado e dados de qualidade versionados. O serviço controla consentimento, hashes, tentativas e liberação; relatórios e imagens não constituem um segundo banco de estado.

**Stack:** ESM, Node/SQLite/sharp/fontkit/archiver já homologados; `node:test`. Nenhum upgrade incidental, nova dependência ou serviço externo previsto.

**Especificação:** [adendo v0.4](ESPECIFICACAO-ADENDO-QUALIDADE-v0.4.md), incremental à [v0.3](baseline-reference/ESPECIFICACAO-v0.3.md).

**Estado:** plano proposto, aguardando revisão/autorização. Aprovação conceitual de 16/10 às 19:01:36 UTC registrada no adendo. **Próxima tarefa sugerida: Q01, somente contrato/documentação e inspeção de leitura.** T14, T18 e todas as Q continuam não iniciadas.

## 1. Como ler e autorizar

O [PLANO.md](PLANO.md), versão 1.0, permanece preservado. T00–T13 continuam concluídas em seus escopos. T14–T34 mantêm IDs, entregáveis básicos e requisitos; a seção 5 abaixo altera apenas suas dependências e cobertura necessárias. As seis novas tarefas Q01–Q06 são os incrementos de qualidade, não uma renumeração do plano.

Aprovar a direção ou este documento não inicia a sequência inteira. Solicitar autorização específica de Q01; ao concluir, apresentar evidência e parar. Demais tarefas exigem autorização própria ou lote de IDs explicitamente identificado. Commit, instalação, transferência, publicação e distribuição continuam sob os limites existentes; um passo técnico não concede autorização adicional para eles.

## 2. Restrições globais

- Copy, legenda e CTA das 12 lâminas aprovadas permanecem intactos; nova composição não autoriza reescrever texto.
- Marca não é layout: nenhum tema, nome, assinatura, texto, cor ou caminho pessoal de Peterson entra como default técnico.
- Módulo 01 oferece somente a composição mínima delimitada no adendo; catálogo amplo e fontes arbitrárias continuam fora.
- Amostra usa o renderer real em seleção parcial; gerar o panorama inteiro e escolher dois PNGs depois não satisfaz o gate.
- Revisão objetiva, parecer editorial e consentimento humano são objetos distintos; nenhum `approved:true` os substitui.
- `ready` indica prontidão estrutural; não equivale à permissão de render ou entrega. Só package íntegro com cadeia válida pode levar a novo `completed`.
- Snapshot histórico é imutável; consulta não migra, escreve ou inventa evidência. Derivação v2 não herda aprovação automaticamente.
- Fontes continuam fora do pacote, ZIP e backup. Nimbus é recurso pendente de verificação, sem download/instalação/redistribuição presumidos.
- Preservar regressão do caminho legado com recursos idênticos; essa baseline não é referência estética aprovada.
- TDD para cada mudança de comportamento: teste red específico → implementação mínima → green focal → regressões afetadas → revisão. Usar dados sintéticos/temporários; nunca memória real do usuário.
- Cada tarefa termina com relatório de arquivos, comandos realmente executados, resultados e limites. Commit somente se coberto pela autorização recebida. Não contar tarefas futuras como executadas.

### Foco de revisão

1. Conteúdo denso ou palavra muito longa: bloqueio claro, sem corte, fonte abaixo do limite ou resumo automático (Q02/Q03/Q06).
2. Marca sem variante/fonte compatível: bloqueio local, sem fallback de Peterson ou substituição tipográfica (Q02/T19/T20).
3. Copy sem assets criativos: `not-applicable` não pula conceito, amostra ou parecer final (Q04/T15/Q05/T20).
4. Mudança entre exibição e confirmação, ou relatório de outra tentativa/marca: recusa stale/cross-run (Q05/T15/T16/T22).
5. Processo interrompido, ZIP falha, cliente antigo ou plugin tenta script direto: sem novo sucesso indevido e sem perder evidência válida (T23/T28–T30).

## 3. Ordem proposta e pontos de decisão

1. **Q01:** fechar o contrato detalhado, limites da primeira homologação e gate das fontes, sem produto/render.
2. **Opção curta, separada:** V03.a e V03.b para completar o carrossel V2 de 12 lâminas como ensaio privado. Exige autorização específica e não conclui nenhuma T/Q de produto.
3. **Composição:** Q02 → T18 → T19 → Q03 → Q06. Obtém compositor testado e controles objetivos, ainda sem cadeia de produção liberada.
4. **Persistência e autorização:** Q04 → T14 → T15 → T16 → T17 → Q05. Q04 depende de Q02; pode ser priorizada antes da conclusão do bloco de composição, mas o modo normal continua uma tarefa por vez.
5. **Integração do fluxo:** T20 → T21 → T22 → T23. T20 só começa depois de ambos os blocos 3/4.
6. **Operação/distribuição:** T24 → T25 → T26 → T27 → T28 → T29 → T30 → T31 → T32 → T33 → T34, respeitando dependências originais e os acréscimos deste plano.

**Gates:** G0 revisão deste plano e autorização de Q01; G1 contrato/fichas propostas e caminho de fontes aceitos antes de implementar Q02; G2 compositor e verificações qualificados antes de usar a amostra de produção; G3 cadeia persistente testada antes de apresentar CLI/plugin como integrados; G4 Windows e matriz completa antes do aceite; G5 licenças/autorização antes de qualquer distribuição.

### Efeito sobre a estimativa

O plano deixa de ser apenas persistência/adaptação do legado: acrescenta seis tarefas Q, uma composição mínima, quatro etapas no grafo e regressões em contratos concluídos. Isso aumenta o trabalho de implementação e principalmente a matriz de revisão visual/Windows. T14–T34 continuam em aberto; não há prazo novo confiável antes de Q01 confirmar o escopo de layouts/fontes e Q03 revelar o custo da composição real. O ensaio de 12 lâminas pode ser entregue antes dessa integração, mas não reduz a homologação obrigatória nem prova produto pronto.

## 4. Novas tarefas pequenas

Os caminhos indicados são exatos e propostos, relativos ao repositório. Q01 pode ajustar nomes de novos arquivos antes da implementação, registrando a decisão; arquivos já existentes devem ser preservados e estendidos com regressão. Não criar scaffolds sem comportamento.

### Q01 — Fechar contrato e recursos

**Depende de:** revisão do plano e autorização específica. **Natureza:** inspeção e documentação, sem código, teste de produto, instalação, render ou commit.

**Arquivos:** criar `docs/architecture/quality-contract.md`, `docs/architecture/quality-font-gate.md`; atualizar este plano/adendo apenas se a decisão exigir. Ler snapshot/schema, fingerprints, stage graph, runtime, recursos, fontes e relatórios V2 existentes.

**Interfaces/saída:** contrato aprovado de `CompositionPlan@1`, `LayoutQualification@1`, `RenderManifest@2`, `QualityReview@1`, `RunSnapshot@2`/pipeline 2; versão de handshake e matriz de invalidação. Definir operações de revisão sem API para fabricar ator humano. A inspeção não torna esses contratos disponíveis.

- [ ] Mapear os campos existentes e fechar tipos, nomes, erros e estratégia v1/v2. Confirmar 11 etapas com tipos explícitos; não depender de posição no array.
- [ ] Definir a seleção de amostra e classificação conservadora de mudança material; fixar as variantes mínimas de capa/conteúdo/diagrama/CTA e a proposta numérica de suas fichas, sem homologá-las por texto.
- [ ] Identificar fonte de acento, arquivos/hash/licença/exceção e disponibilidade já existente por ambiente. Consultar fonte primária quando necessário; registrar “verificado”, “ausente” ou “não verificado”, sem concluir direito de redistribuição por inferência.
- [ ] Decidir se usar os tipos livres nas tabelas existentes basta. Se exigir SQL novo, especificar migração nova com backup/manutenção; nunca editar a migração inicial. Fixar a compatibilidade antes de ativar os novos contratos.
- [ ] Conferir que cada requisito AC33–AC40 aponta para tarefa/teste abaixo; apresentar decisões e bloqueios para aprovação antes de Q02.

**Verificação futura:** leitura/diff/hash documental; comandos somente de inspeção como `git status --short`, `git diff --check` e `sha256sum`. **Aceite:** contratos sem circularidade, limites claros e nenhuma licença/font disponível presumida. Q01 pode concluir a decisão e registrar recurso bloqueado; Q02 não pode implementar a reprodução V2 dependente desse recurso sem resolução aprovada.

### Q02 — Definir composição qualificada

**Depende de:** Q01/G1. **Amplia:** T10, sem reabrir seu resultado histórico.

**Criar:** `src/domain/composition-plan.mjs`, `src/domain/layout-qualification.mjs`, `shared/composition-plan.schema.json`, `shared/layout-qualification.schema.json`, `shared/layouts/editorial-composed-v1.json`, `tests/unit/composition-plan.test.mjs`, `tests/unit/layout-qualification.test.mjs`, `tests/fixtures/quality/README.md`.

**Modificar:** `src/domain/brand-schema.mjs`, `src/infrastructure/resources.mjs`, `shared/resources.manifest.json`, `tests/integration/doctor.test.mjs`. Versionar o manifesto para identificar separadamente `legacy-panorama@1` e `editorial-composed@1`, seus módulos/layouts/checkers e hashes; preservar leitura dos recursos v1. A extensão tipográfica é limitada à opção aprovada, sem carregamento arbitrário de fontes.

**Interfaces:** `validateCompositionPlan({plan, carousel, assets, qualifications}) -> NormalizedCompositionPlan`; `validateLayoutQualification(record) -> LayoutQualification`; dados normalizados imutáveis, sem caminhos externos nem código executável. Essas funções validam a estrutura; a elegibilidade produtiva exige qualificação liberada no gate comum. Qualificação tem estado não liberado até evidência Q03/Q06 e revisão; criar ficha não equivale a qualificá-la. O harness de testes de qualificação pode compor uma ficha candidata para avaliá-la; essa permissão é interna ao teste, não flag de bypass da produção.

- [ ] Escrever testes que rejeitem trecho alterado/reordenado, referência cruzada, layout desconhecido e oferta produtiva de ficha não qualificada, campo extra executável, fonte não autorizada e limites indefinidos. Testar conteúdo no limite, além dele, palavras longas e ausência de assets; módulo/layout/checker alterado ou ausente deve produzir mismatch/incomplete, sem congelar identidade legada para o compositor novo.
- [ ] Rodar `node --test tests/unit/composition-plan.test.mjs tests/unit/layout-qualification.test.mjs` e registrar red.
- [ ] Implementar validação pura, reconstrução do texto por trechos, relações entre blocos/áreas/qualificação e resolvedor limitado de recursos. Campos/textos particulares da V2 ficam nos dados do ensaio, fora dos defaults.
- [ ] Executar green focal, regressões de marca/doctor e `npm test`; inspecionar diff e produzir relatório.

**Aceite:** plano válido identifica todos os blocos sem alterar a copy; ficha incompleta não é oferecida como qualificada; ausência de fonte tem diagnóstico próprio. **Cobertura:** AC33, AC35, AC38, AC19.

### Q03 — Implementar composição real

**Depende de:** Q02, T18, T19. **Não substitui:** regressão de compatibilidade da T18.

**Criar:** `src/render/composed-carousel.mjs`, `src/render/text-layout.mjs`, `src/render/composition-geometry.mjs`, `tests/visual/composed-carousel.test.mjs`, `tests/visual/preview-subset.test.mjs`, `docs/testing/quality-compositor.md`.

**Modificar:** `src/adapters/legacy/render-context.mjs` (introduzido em T18) para despacho explícito por renderer, e `shared/resources.manifest.json` para incluir os arquivos reais do compositor; evitar mudar o caminho sem contexto do legado. Q04 congela essa identidade efetiva, não `legacy-panorama@1` por default.

**Interfaces:** `composeCarousel({carousel, snapshot, plan, resources, selection}) -> CompositionResult`, com SVGs/scene graph/medidas e índices originais; `selection` é lista explícita ou conjunto completo. A mesma função compõe amostra e lote. O serviço T20 controla gravação, leases e autorização; o compositor não muda estado persistente.

- [ ] Criar testes red para capa, interna, CTA e diagrama, duas identidades, texto denso, acentos, fonte efetiva, logo/rodapé e leitura isolada; verificar que a seleção não compõe/rasteriza lâminas não pedidas.
- [ ] Rodar `node --test tests/visual/composed-carousel.test.mjs tests/visual/preview-subset.test.mjs` com fontes autorizadas e registrar red real; falta de recurso é bloqueio, nunca skip contado como qualificação.
- [ ] Implementar composição declarativa, medição com fonte real, trechos, superfícies, espaços e âncoras. Seleção preserva índice/contexto da emenda e usa a mesma geometria do lote; não transplantar coordenadas fixas da demo como regra universal.
- [ ] Rodar green e regressões T18/T19. Inspecionar pixels em tamanho integral e a 360 px; registrar hashes, recursos, defeitos e limites. Não liberar ficha enquanto os controles Q06/revisão não estiverem completos.

**Aceite:** amostra selecionada coincide com os recortes do lote correspondente em ambiente idêntico; ausência de render oculto do lote demonstrada por spy/contagem de rasterizações; nenhuma regressão legada incidental. **Cobertura:** AC33–AC35, AC17, AC19.

### Q04 — Versionar estado e evidências

**Depende de:** Q01, Q02. **Amplia:** contratos T11–T13 já concluídos.

**Modificar:** `src/domain/run-snapshot.mjs`, `artifact-fingerprints.mjs`, `stage-graph.mjs`, `run-state-machine.mjs`, `src/application/run-service.mjs`, `run-inputs.mjs`, `run-runtime.mjs`, `shared/run-snapshot.schema.json`, `tests/integration/run-snapshot.test.mjs`, `run-inputs.test.mjs`, `run-runtime.test.mjs`, `tests/unit/run-state-machine.test.mjs`.

**Criar:** `src/domain/quality-evidence.mjs`, `shared/quality-review.schema.json`, `tests/unit/quality-evidence.test.mjs`, `tests/fixtures/quality/legacy-run-v1.json`; nova migração somente se Q01 demonstrar necessidade estrutural.

**Interfaces:** `projectStages(records, {pipelineVersion})`; `fingerprintStage(context)`/`buildInputFingerprints(context)` aceitam contrato explícito, preservando a computação v1 na consulta histórica; `validateQualityReview(record) -> QualityReview`. Snapshot v2 e manifestações `preview`/`final` têm identidades distintas. Read model informa `quality` e `nextAction` sem mutar nem inferir aprovação.

- [ ] Escrever testes red para 11 etapas/tipos, replay histórico de 7 etapas, todos os estados/eventos de revisão e nenhuma aprovação criada por projeção. Testar `ready` sem permissão de render e completed histórico sem selo novo.
- [ ] Testar fingerprint contra mudanças de plano, seleção, qualificação, rubric/checker, arquivo e tentativa; mesmo relatório íntegro sobre outro render deve falhar. Documentar que mudança do executável pode invalidar mais etapas que uma mudança apenas de dados.
- [ ] Implementar contratos versionados, projeções v1/v2 e metadados de artefatos; preservar snapshots/hashes antigos. Derivação v2 exige novos consentimentos; retomada produtiva v1 orienta derivação.
- [ ] Rodar `node --test tests/unit/quality-evidence.test.mjs tests/unit/run-state-machine.test.mjs tests/integration/run-snapshot.test.mjs tests/integration/run-inputs.test.mjs tests/integration/run-runtime.test.mjs`, `npm test` e qualificação Windows afetada. Não registrar sucesso de checks não executados.

**Aceite:** histórico permanece legível; nova política não é forjada por migração ou leitura; graph/fingerprint/schema/read model concordam. **Cobertura:** AC34, AC36, AC37, AC40, AC07–AC09/AC20.

### Q05 — Controlar parecer e liberação

**Depende de:** Q04, T14–T17 revisadas. T20 ainda não inicia por esta tarefa.

**Criar:** `src/domain/quality-policy.mjs`, `src/application/quality-review.mjs`, `src/application/production-gate.mjs`, `tests/integration/quality-review.test.mjs`, `tests/integration/production-gate.test.mjs`.

**Modificar:** `src/interfaces/cli/human-confirmation.mjs`, `src/application/approvals.mjs` (T15), `src/domain/invalidation.mjs` (T16), testes afetados de confirmação/aprovação/invalidação.

**Interfaces:** `requestQualityReview({brandId,runId,kind,manifestId,requestId})`; `getQualityReview({brandId,runId,reviewId})`; confirmação somente pelo gateway humano, sem operação pública `approve(actor=user)`. `assertProductionGate({run,phase,artifacts,approvals,reviews})` para `preview`, `render`, `validate`, `review`, `package` e `complete`; cada fase exige somente seus antecedentes conforme seção 7 do adendo. Retorna evidências verificadas ou erro tipado, nunca altera por si só o estado final.

- [ ] Escrever red para relatório ausente, incompleto, sem cobertura/pixels atestados, falho, stale, hash divergente, outra marca/tentativa e JSON que tenta simular humano. Ficha candidata usada internamente na qualificação jamais pode chegar à produção. Reportar recurso de revisão indisponível sem produzir passe.
- [ ] Testar corrida entre exibição/confirmar, rejeição humana, repetição idempotente e não retenção de lease durante espera. Testar no-assets, correção até duas rodadas e terceira bloqueada, inclusive após resume.
- [ ] Implementar armazenamento imutável de parecer, validação da evidência, vínculo de confirmação e gate comum. Separar resultado editorial de consentimento `preview-approval`; até aqui artefatos de teste não provam o renderer integrado.
- [ ] Rodar `node --test tests/integration/quality-review.test.mjs tests/integration/production-gate.test.mjs tests/integration/approvals.test.mjs tests/integration/invalidation.test.mjs`, regressões de confirmação e `npm test`; revisar diff.

**Aceite:** serviço rejeita atalho por flags/relatório livre e não mistura revisão com consentimento; toda decisão aponta bytes/versões atuais. **Cobertura:** AC34, AC36–AC40, AC08/AC09/AC14/AC29.

### Q06 — Medir e qualificar layouts

**Depende de:** Q02, Q03. Pode preceder Q04/Q05 conforme a ordem proposta.

**Criar:** `src/quality/objective-checks.mjs`, `src/quality/review-rubric.mjs`, `tests/visual/quality-objective.test.mjs`, `tests/visual/layout-qualification.test.mjs`, `docs/testing/layout-qualification.md`.

**Modificar:** fichas de `shared/layouts/` para vincular limites/evidências efetivamente aprovados e `shared/resources.manifest.json` para registrar módulos/checkers efetivos; recursos de qualificação distribuídos não incluem conteúdo privado nem fontes.

**Interfaces:** `evaluateRenderedQuality({manifest, composition, files, qualification}) -> ObjectiveReport`; `getReviewRubric(version) -> ReviewRubric`. Controle retorna achados por elemento/lâmina com esperado/observado e `passed|failed|not-verified`; não concede consentimento.

- [ ] Criar red para colisão da curva com texto semelhante ao defeito v1, corte, overflow, contraste inválido, logo deformado/pequeno, fonte divergente, asset ausente e continuidade que esconde informação. Testar valor-limite e primeiro valor fora de cada ficha.
- [ ] Rodar `node --test tests/visual/quality-objective.test.mjs tests/visual/layout-qualification.test.mjs`; registrar red e controles que exigem inspeção humana em vez de fingir detecção automática.
- [ ] Implementar checks sobre métricas/glifos e raster quando aplicável, rubrica versionada e casos não verificáveis; completar matriz real de papéis/densidades/duas marcas com render e inspeção humana nas duas escalas.
- [ ] Executar green, regressões visuais pertinentes, `npm test` e qualificação Windows definida; anexar hashes/limites/pareceres ao relatório. Qualificar apenas fichas com todos os requisitos atendidos; listar explicitamente as recusadas.

**Aceite:** fixtures negativas falham e as suportadas têm evidência técnica/editorial; sem oferta de layout não qualificado. A homologação local não substitui T33 no produto instalado. **Cobertura:** AC33, AC35, AC36, AC38.

## 5. Alterações nas tarefas T14–T34

Cada linha complementa a tarefa de mesmo ID no plano 1.0. Caminhos de testes já propostos ali continuam válidos; os abaixo são acréscimos explícitos. Não duplicar a implementação em uma tarefa Q e depois em uma T.

| Tarefa | Delta, dependências e evidência adicional |
| --- | --- |
| T14 | Depende também de Q04. Lease/fencing cobre `preview-render` e `render`; revisão humana não retém lease. `tests/integration/leases.test.mjs`: revogação/expiração durante preview e exclusão de manutenção. |
| T15 | Depende de Q04. Acrescentar `preview-approval`, consentimento sobre plano/manifesto/seleção, e pedidos de revisão distintos. `approvals.test.mjs`: sample ainda inexistente, mudança entre exibir/confirmar, no-assets e aprovação da conversa requerendo confirmação local. Não transformar a aprovação V2 desta conversa em registro automaticamente. |
| T16 | Depende de Q04/T15. Estender invalidação a plano/amostra/parecer/rubrica. `invalidation.test.mjs`: cada linha da matriz do adendo, falha de package preservando evidências, alteração material exigindo amostra e sem reset de contador por resume. |
| T17 | Abranger tentativas de amostra/lote; interromper encerra tentativa e permite reconciliação, cancelar continua terminal. `run-control.test.mjs` inclui confirmação atrasada e revisão pendente. |
| T18 | Continua adaptação do legado, antes de Q03. Comparar pixels com fontes/recursos idênticos e preservar `legacy-panorama@1`; não substituir baseline histórica pela V2. `legacy-context.test.mjs` mantém seu objetivo técnico. |
| T19 | Preservar slot legado e ampliar testes de convivência com áreas de composição em Q03; PNG/tema/logo incompatíveis bloqueiam. `logo-layout.test.mjs` e `logo-slot.test.mjs`: conteúdo denso, claro/escuro, assinatura e geometria declarada. |
| T20 | Depende de Q03–Q06, T14–T19. Criar também `src/application/stages/preview-render-stage.mjs` e `tests/integration/preview-render-stage.test.mjs`; render-adapter compartilha compositor. Testar amostra real sem lote oculto, seleção/riscos, manifests separados, amostra executável antes de sua aprovação e lote bloqueado até ela; recursos exatos, token e diretório isolado em ambos. |
| T21 | Depende de T20/Q05/Q06. Criar `src/application/stages/preview-review-stage.mjs`, `quality-review-stage.mjs`, `tests/integration/quality-stages.test.mjs`. Preview-review combina controles objetivos/parecer antes da aprovação; validate permanece objetivo; quality-review exige revisão final de todas as lâminas/panorama. Nenhuma etapa avança por booleano ou revisão indisponível. |
| T22 | Depende de T21/Q05. `package-stage.test.mjs`: gate antes de abrir ZIP e antes do commit; parecer/bytes/seleção stale, tentativa errada e troca concorrente bloqueiam. O script legado não registra completed; ZIP mantém allowlist sem fontes/relatório privado. |
| T23 | Depende de T20–T22. `resume.test.mjs`: crash no preview/revisão/package, evidência órfã, rechecagem de cada hash, amostra rejeitada e contador de correção persistente. Completed histórico é consultado com limite; completed v2 só é revalidado, nunca regenerado. |
| T24–T26 | Backup/restore preserva planos, qualificações referenciadas, pareceres e confirmações com hashes; fontes permanecem externas. Testar v1/v2 e critérios ausentes/incompatíveis; não forjar qualidade no restore. Migração nova somente se necessária, com backup/manutenção e checksum antigo intacto. |
| T27 | Purge/arquivo abrange evidências e vínculos novos sem remover dados de outra marca; não deixam atalhos ou arquivos pessoais em diagnósticos. |
| T28 | CLI expõe pedido/consulta de revisão e aprovação da amostra, com próximo passo exato; confirmação humana só via gateway. `public-commands.test.mjs`: não interativo não confirma, cliente/protocolo incompatível bloqueia, ready ≠ autorizado. Atualizar `docs/cli.md` com comandos realmente implementados. |
| T29 | Plugin usa mesma CLI versionada e mostra amostra/pendências. Skills não chamam scripts legados para contornar bloqueios. `plugin-adapter.test.mjs`: versão antiga, revisão indisponível, arquivo stale e fallback direto negados. Integração real continua pendente até T33. |
| T30 | Acrescentar a `module-01.test.mjs`, `fault-matrix.test.mjs` e `fault-matrix.md` todos os negativos AC33–AC40, chamadas diretas de serviço e ambos os canais. `approved:true`, relatório livre, copy mudada, falta de revisão, raça e terceiro retry devem falhar. Rodar suíte inteira sem skips apresentados como sucesso. |
| T31 | Auditar inclusão exata de contratos/layouts/checkers e versões de qualidade no release-manifest. Recursos privados V2, relatórios da marca e todas as fontes ficam fora. `release-package.test.mjs` testa pacote funcional com recursos autorizados externos, gate comum e ausência de scripts de bypass no fluxo público. Gate ATTRIBUTION continua. |
| T32 | Mesmo tarball auditado no Windows limpo, global/npx, handshake e recursos completos/ausentes. Instalação não qualifica layout nem migra workspace silenciosamente. Regressões v1/v2, recursos/fontes e persistência após uninstall/cache. |
| T33 | Duas marcas, capa/interna/CTA/diagrama/continuidade, denso e excedente; amostra rejeitada/corrigida; revisão ausente/stale/falha bloqueia ZIP. Revisar todos os pixels nas duas escalas. Demonstrar CLI instalada e plugin real com mesmos IDs/raiz, hashes e critérios; sem hospedeiro, relatar integração bloqueada. |
| T34 | Consolidar AC01–AC40, mesmo tarball/checksum, evidências exatas e limitações. AC17 prova legado compatível; AC33–AC40 provam novo padrão. Se faltarem revisão/Windows/licença, não marcar entrega integral; distribuição só quando autorizada. |

## 6. Caminho curto para as 12 lâminas V2

**Proposta separada, ainda não autorizada:** executar depois de Q01 e antes da integração do núcleo, se o usuário quiser priorizar a peça. Não é obrigatório esperar T34 para terminar um ensaio; também não se deve chamar o ensaio de produto integrado.

### V03.a — Completar a composição do ensaio

**Depende de:** autorização explícita para recompor as 12 lâminas no ambiente escolhido e gate de uso das fontes resolvido. A direção V2 e a copy já estão aprovadas; qualquer alternativa tipográfica/material precisa ser apresentada antes.

**Arquivos:** somente `deliverables/first-visual-trial/editorial-redesign-v3/` em diretório novo, fora do produto. Preservar V1/V2; manifesto com entrada, recursos, render e hashes. Não editar templates, defaults ou skills do harness.

- [ ] Mapear as 12 lâminas ao texto aprovado e selecionar o caso mais denso e uma emenda real; preparar essas amostras adicionais quando as duas V2 não cobrirem o risco.
- [ ] Compor e revisar as amostras adicionais; submeter mudança material à aprovação, preservando a capa/interna V2 como referência da direção aceita.
- [ ] Gerar o lote somente após os gates aplicáveis; verificar todo o texto, dimensões, fontes, pixels e continuidade. Sem compactar conteúdo por conta própria.

**Aceite:** 12 imagens e panorama com evidência integral, ainda identificados como ensaio separado; não cria estado do runtime, não conclui T18/T20/T33 e não alega Windows quando produzido no cloud.

### V03.b — Revisar e apresentar o ensaio

**Depende de:** V03.a. Inspecionar cada lâmina/panorama em resolução integral e a 360 px; registrar defeitos e correções limitadas a até duas rodadas. Persistindo problema, pedir decisão. Apresentar o conjunto revisado com limites e, somente no escopo autorizado, preparar o ZIP sem fontes/código. Atualizar V03 com os resultados reais, sem declarar a qualidade do produto homologada.

## 7. Rastreabilidade e encerramento deste planejamento

| AC novo | Donos principais | Prova de conclusão |
| --- | --- | --- |
| AC33 | Q02/Q03/Q06, T33 | Fichas e matriz de duas marcas revisadas no ambiente alvo. |
| AC34 | Q04/Q05, T15/T20/T21 | Seleção real, revisão e consentimento; lote prematuro bloqueado. |
| AC35 | Q02/Q03/Q06, T21 | Limites positivos/negativos e ausência de falso passe em não verificado. |
| AC36 | Q05/Q06, T21/T22/T30/T33 | Todos os pixels/cobertura; falta/stale/falha bloqueiam. |
| AC37 | Q04/Q05, T16/T23 | Matriz de invalidação e reuso seguro por hash. |
| AC38 | Q02/Q05/Q06, T16/T23/T30 | Terceira correção bloqueada; copy intacta e sem fallback. |
| AC39 | Q05, T22/T28/T29/T30 | Mesma barreira no serviço, CLI, plugin e retomada. |
| AC40 | Q04, T23–T26/T32/T34 | Histórico legível e backup/restore sem selo/consentimento inventados. |

**Autorrevisão do plano:** requisitos do adendo mapeados; dependências sem ciclo (Q05 não implementa render; T20 consome o gate); contratos históricos tratados em Q04; checks novos agrupados em Q06/T21; validação de produto e demo separadas. Valores finais das fichas e recurso de acento são decisões de Q01/G1, não defaults inventados. Evidências de implementação ainda inexistentes não foram contadas como aceite.

**Decisão solicitada:** o contrato e essa ordem capturam o objetivo? Se sim, autorizar Q01 isoladamente. A opção V03.a/V03.b pode ser decidida depois do diagnóstico de recursos, sem liberar o restante da implementação.
