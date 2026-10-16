# T15 — Aprovações vinculadas aos objetos corretos

> Cópia pública sanitizada: registros privados de conversa e execução foram omitidos. Estados e resultados técnicos abaixo descrevem a etapa original, não uma certificação da versão atual.

Data: 16/10/2026, UTC. Base: `339f29b` (T14). Validação local em Linux x64, Node v24.19.0, ABI 137, com dependências já disponíveis. Todos os bancos e arquivos de teste são sintéticos e temporários.

**Estado:** T15 concluída no escopo técnico, com revisão independente aceita, **760/760** testes completos no Linux e **69/69** focais no Linux e no Windows. T16 é a próxima tarefa já autorizada. Nenhum commit foi feito pelo implementador. Esta tarefa fecha a fronteira de consentimento; não representa o fluxo completo de produção, e preview permanece bloqueado por padrão até Q05.

Referências: [T15 no plano original](../plans/module-01/PLANO.md), [delta de qualidade para T15](../plans/module-01/PLANO-REVISAO-QUALIDADE.md) e [contrato de qualidade](../architecture/quality-contract.md), especialmente §§7, 9–10 e 12.

## Escopo e interfaces internas

`createApprovals({root, db})` oferece:

- `request({requestId, brandId, runId, kind})`: verifica material e antecedentes, registra pedido idempotente e devolve a proposta exata. Não concede consentimento.
- `get({brandId, runId, confirmationRequestId})`: consulta o pedido e seu objeto atual ou a decisão persistida, com verificações de vínculo/proveniência.
- `decide({requestId, proposal, decision}, receipt)`: recebe uma capacidade local opaca por chamada interna, nunca um campo JSON de autorização. Confirma ou rejeita somente a proposta mostrada.
- `verify({brandId, runId, kind})`: verifica consentimento persistido e bytes atuais, sem emitir recibo, alterar estado ou iniciar execução.

Tipos de consentimento e etapas correspondentes:

| Tipo | Etapa | Objeto específico |
| --- | --- | --- |
| `copy` | `copy-approval` | Projeção editorial completa, ordenada e exata |
| `concept` | `concept-approval` | Fingerprint de copy, texto integral do conceito e escolhas visuais canônicas |
| `creative-assets` | `assets-approval` | Fingerprint de conceito e referências/hashes dos assets criativos |
| `preview` | `preview-approval` | Manifesto, plano, seleção, arquivos e referência do parecer da amostra |

Cada proposta inclui versão de schema, marca/run, tipo, ID do pedido, versão do run, fingerprint, referência do artefato e objeto apresentado. Não aceita `actor`, `approved`, `reviewedBy` nem evidência de conversa como substitutos de confirmação local. O `approved: true` histórico do JSON de assets permanece apenas requisito estrutural.

A ausência explícita de assets criativos resulta em `not-applicable` somente depois de copy e conceito válidos. Nesse caso, o serviço conclui exclusivamente `assets-approval`, registra evento/resultado idempotente e não inventa aprovação humana. Um logo no armazenamento da marca não entra no conjunto criativo. Conceito e preview continuam obrigatórios.

## Gateway humano e persistência

`confirmApprovalProposal` estende o adaptador humano existente, preservando a confirmação de marca T08. O adaptador de consentimento:

1. Exige streams TTY e recusa flags de automatização/JSON.
2. Captura uma cópia canônica da proposta antes de exibi-la.
3. Mostra o objeto completo e o fingerprint.
4. Emite recibo específico de consentimento somente com `CONFIRMAR` ou `REJEITAR` exatos. Outras respostas, EOF e Ctrl-C não emitem recibo.

O recibo é um objeto opaco associado a evidência em `WeakMap`. Seu vínculo cobre proposta completa e decisão. Serializar o objeto, mudar o objeto/tipo/escopo/decisão ou reutilizar recibo de marca não produz consentimento válido.

A evidência persistida conserva ID do recibo, canal local, hash da proposta/decisão, horário, proposta exata e requestId da operação. A verificação cruza essa evidência com `confirmation_requests`, `approvals`, etapa e resultado/payload hash de `operations`. Um booleano persistido ou uma linha sintética isolada não satisfaz essa cadeia.

Recibos são consumidos somente após o commit. Rollback por manutenção ou conflito preserva a capacidade para retry autorizado. Replay exato de uma decisão confirmada não precisa do recibo já consumido, mas revalida resultado persistido, vínculo e bytes atuais; não cria outra aprovação. Essa continuidade foi exercitada em processo Node separado.

## Fronteira transacional e espera

A leitura e conferência de arquivos ficam fora da transação SQLite. O serviço resolve referências no par `brandId/runId`, verifica hash/tamanho e reconstrói fingerprints a partir dos inputs gerenciados. Antes da escrita, compara novamente a captura dos registros dentro da transação `IMMEDIATE` de T06.

A decisão publica conjuntamente:

- Aprovação ou rejeição e sua evidência
- Resolução do pedido de confirmação
- Estado/fingerprint da etapa
- Estado, versão e próxima etapa do run
- Evento técnico e resultado idempotente

O guard final, depois da inserção de `operations`, recusa alterações intermediárias e reverte todas essas escritas. Testes incluem alteração injetada dentro da fronteira e trigger SQLite temporário que modifica a etapa após a inserção do resultado.

Pedido expirado, fingerprint/bytes divergentes, run terminal, marca arquivada, lease presente ou tentativa ativa bloqueiam uma nova decisão. Manutenção exclui mutações pelo coordenador T06. Solicitar/esperar consentimento não adquire lease, não cria tentativa e permite aquisição de manutenção quando não há outra execução ativa.

A atomicidade cobre o banco e seus vínculos. Não torna SQLite e filesystem uma transação única, nem elimina a limitação local de concorrência hostil de paths/arquivos já documentada em T04/T07.

## Preview e dependência explícita de Q05

O caminho de preview verifica:

- Existência de manifesto de amostra vigente
- Escopo, snapshot, inputs, plano, fingerprint e tentativa atual concluída
- Referências e bytes dos arquivos/métricas/evidência de assets
- IDs dos consentimentos anteriores de copy/conceito
- Parecer e relatório objetivo, cobertura, política/checkers e vínculo à etapa de revisão
- Fingerprint específico de consentimento de preview, distinto do pedido de revisão

Amostra ausente produz `PREVIEW_REQUIRED`. Parecer ausente produz `EDITORIAL_REVIEW_REQUIRED`. Evidência divergente, incompleta ou falha continua bloqueante.

**A verificação confiável do recibo editorial ainda pertence a Q05.** Sem esse serviço, o comportamento normal é falhar com `QUALITY_REVIEW_VERIFICATION_UNAVAILABLE`. Não foi criado serviço que emita `QualityReview`, ateste inspeção de pixels ou conceda liberação produtiva.

Há um ponto de composição interno `verifyReviewReceipt`, síncrono e restrito à construção do serviço, para a futura dependência confiável Q05. Não é argumento de pedido, endpoint, flag pública nem campo `verified: true`. Nos testes, uma implementação explícita representa esse antecedente e permite provar o vínculo do consentimento posterior. A fixture usa registros, observações e bytes sintéticos; não demonstra revisão humana, imagens produtivas, qualificação de layout ou execução real do compositor. O adaptador de apresentação/atestação de pixels e o gate produtivo completo permanecem em Q05 e tarefas posteriores.

## Integração com a consulta

O read model consulta a política T15 para reconhecer proveniência persistida válida. Registros históricos/importados que não passam pela verificação continuam diagnosticados; a consulta não os transforma em consentimento.

Pedidos suportados de copy/conceito/assets podem ser indicados como disponíveis quando os antecedentes são válidos. Um predecessor com evidência adulterada mantém diagnóstico e aponta inspeção do run, evitando anunciar uma ação executável que o serviço recusará. Preview continua explicitamente dependente de Q05. Nenhuma disponibilidade nova autoriza render, retomada ou conclusão.

## Evidência red → green e revisão

- Red inicial: **16 testes** falharam especificamente pela ausência de `createApprovals`; implementação mínima produziu green.
- Cinco cenários adicionais de preview foram introduzidos em red e passaram após a validação da cadeia e do vínculo separado de consentimento.
- Negativos adicionais reproduziram decisão persistida adulterada retornando erro inadequado, pedido expirado aceito e falta de reconhecimento de consentimento válido na consulta. As correções passaram nas regressões focais.
- Revisão independente encontrou uma ação de próximo consentimento anunciada como disponível quando o predecessor não tinha proveniência verificável. O caso foi reproduzido em red e corrigido para `inspect-run`.
- Uma regressão específica mostrou replay retornando resultado sem conferir bytes alterados desde o commit. O replay passou a revalidar os bytes e a falhar nesse caso.
- A fixture de asset semântico recebeu seleção de preview derivada novamente depois de alterar seus riscos; a correção é exclusivamente da fixture.
- O subprocesso verifica consentimento e repete a decisão com `receipt: null`, mantendo o mesmo resultado e uma única linha de aprovação.
- Revisão independente aceita, **sem achados bloqueadores abertos**. Além da suíte, o revisor exerceu `readline` com CONFIRMAR/REJEITAR/EOF/Ctrl-C e replay em novo processo.

## Resultados do freeze

| Verificação | Resultado |
| --- | --- |
| Focal Linux: approvals + confirmação humana + read model | **69/69**, zero falhas/skips |
| Full final do implementador, `npm test` | **760/760**, **99,919 s**, zero falhas/skips, saída 0 |
| Focal independente sobre o freeze | **69/69**, zero falhas/skips |
| Full independente sobre o freeze | **760/760**, **90,20 s**, zero falhas/skips |
| `git diff --check` | Limpo |
| Hashes dos arquivos de produto/testes | Reconfirmados pelo revisor |
| Windows final | **69/69**, **111,37 s**, saída 0; hashes **117/117 T15** e **113/113 T14** íntegros |

### Comandos executados

Focal final, idêntico ao executado no Windows:

```sh
node --test tests/integration/approvals.test.mjs tests/unit/human-confirmation.test.mjs tests/integration/run-runtime.test.mjs
```

Suíte completa:

```sh
npm test
```

Regressões isoladas executadas durante implementação/revisão:

```sh
node --test --test-name-pattern='predecessor provenance' tests/integration/approvals.test.mjs
node --test --test-name-pattern='exact decision replay' tests/integration/approvals.test.mjs
node --test --test-name-pattern='verifies and replays' tests/integration/approvals.test.mjs
git diff --check
```

### Resultado Windows final — 16/10/2026

A consolidação após o resultado Windows altera somente este relatório e o progresso do módulo. T15 está concluída em seu escopo; T16 é a próxima tarefa autorizada. O bloqueio de preview até a verificação confiável Q05 continua vigente.

## Arquivos do freeze

Novos:

1. `src/application/approvals.mjs`
2. `src/domain/approval-policy.mjs`
3. `tests/integration/approvals.test.mjs`

Alterados:

4. `src/interfaces/cli/human-confirmation.mjs`
5. `src/application/run-runtime.mjs`
6. `src/infrastructure/resources.mjs`
7. `shared/resources.manifest.json`
8. `tests/integration/run-runtime.test.mjs`
9. `tests/integration/quality-state-evidence.test.mjs`

O manifesto diagnóstico e sua allowlist incorporam os dois módulos novos; os hashes do módulo de recursos foram atualizados nas identidades correspondentes. Isso não modifica a allowlist pública de distribuição nem libera o pacote para instalação.

## Limites preservados

- Sem serviço QualityReview/production gate Q05, invalidação seletiva T16 ou execução T20.
- Sem nova operação pública CLI/plugin de grant, confirmação por conversa ou migração automática de consentimentos.
- Sem ativação de workspace real, instalação, atualização de dependências, publicação ou alteração de arquivos pessoais.
- Sem qualificação estética: layouts candidatos e demais gates de qualidade mantêm seu estado anterior.
- Streams, respostas e dependências confiáveis injetadas são instrumentos internos de teste. As confirmações da suíte não são consentimentos de pessoa real.
- A fronteira de capacidades locais segue T08. Não é autenticação do proprietário do computador nem proteção contra processo hostil com acesso irrestrito aos módulos/banco/arquivos.
- Aprovar um objeto não aprova outro, não transforma review em consentimento e não conclui o fluxo produtivo.
