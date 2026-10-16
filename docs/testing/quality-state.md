# Q04 — Estado e evidências versionados

> Cópia pública sanitizada: registros privados de conversa e execução foram omitidos. Estados e resultados técnicos abaixo descrevem a etapa original, não uma certificação da versão atual.

Base de implementação: `76fb7f3` (Q06). Validação local em 16/10/2026, Linux x64, Node v24.19.0, ABI 137. Todas as ativações, restaurações, pareceres e registros de aprovação exercitados aqui pertencem a fixtures sintéticas temporárias.

## Contratos e interfaces

- `RunSnapshot` v1 conserva a serialização histórica, o renderer legado e os sete estágios. `getRunContract` recusa combinações incoerentes; `validateRunSnapshot` valida sem reparar ou substituir identidades persistidas.
- Snapshot v2 congela contrato/pipeline 2, canonical 1, política de qualidade 1, bindings/fontes, qualificações liberadas, manifesto de recursos e a allowlist exata dos 21 arquivos do renderer editorial. Não contém plano, outputs ou consentimentos futuros. Configuração/recursos locais atuais não são usados para recalcular histórico.
- `projectStages(records, {pipelineVersion})`, as transições e os fingerprints despacham explicitamente por versão. Pipeline 2 projeta onze etapas. `preview-review` e `quality-review` são revisões humanas distintas de aprovação e execução; não aceitam estado `running` nem tentativas de execução.
- `fingerprintStage(context)` v2 exige os constituintes específicos de cada etapa. Plano, seleção, qualificação, tentativa, arquivos, métricas, checker e rubrica participam onde aplicável. Conjuntos sem ordem semântica são normalizados; a versão 1 conserva o vetor de regressão congelado.
- `createRunInputs(...).save` persiste material v2 ainda incompleto sem plano. `savePlan({requestId,brandId,runId,expectedVersion,plan})` valida Q02, referências gerenciadas, snapshot, copy e qualificações antes de persistir plano e nova versão de inputs. A mutação verifica a identidade instalada contra aquela das entradas; identidade ausente/divergente bloqueia a gravação. Consultar/reproduzir o resultado já persistido não recalcula o executável.
- Plano não concede consentimento nem execução. Alterar material após plano exige o controle de invalidação futuro; não há substituição silenciosa. Ausência legítima de assets não pula conceito/amostra/revisão.
- `validateRenderManifest`, `validateQualityReview` e `verifyQualityEvidence` verificam forma, escopo, identidades, seleção, cobertura e vínculo entre documentos. Esses validadores puros nunca autenticam recibo humano: retornam `humanReceiptVerified:false` e `productionEligible:false`.
- `createRunRuntime(...).get/resume` permanece consulta. Informa `quality`, manifesto/parecer preview e final, diagnósticos e próxima ação; verifica bytes registrados, plano/inputs atuais, fingerprint de etapa e tentativa mais recente antes mesmo de existir parecer. Parecer estruturalmente íntegro continua bloqueado por `QUALITY_REVIEW_VERIFICATION_UNAVAILABLE` até Q05/T15.
- Revisão pendente usa `EDITORIAL_REVIEW_REQUIRED` / `request-quality-review`; consentimento da amostra usa `PREVIEW_APPROVAL_REQUIRED` / `request-approval`. Histórico v1 informa `quality.status = not-evaluated`; workspace ativado orienta derivação para nova política sem reescrever o run.

Mudança do executável pode afetar mais fingerprints que uma mudança isolada de dados. Q04 detecta essa divergência; a decisão de invalidação/reutilização produtiva continua nas tarefas próprias.

## Migração 002 e reversão mínima

A migração `002-quality-contract-activation.sql` cria a ativação singleton imutável com contrato 2, pipeline 2, protocolo mínimo 2 e política 1. O checksum histórico de `001-initial.sql` permanece:

`b44eaae8591b96af5ba6a0d66983c4ef885552402042c99ade5f0530b69a9181`

O leitor suporta bancos 1 e 2, sem migrar por abertura/consulta. Inicialização vazia aceita `{schemaVersion:2}` somente como escolha explícita. Banco 1 existente exige `activateQualityContract({root,backupRoot,...})`; o chamador não consegue usar inicialização para atualizá-lo. O escritor legado original, congelado em fixture a partir de `76fb7f3`, recusa `user_version=2` antes de alterar dados. O escritor novo também recusa mutação e replay v1 no workspace ativado.

A ativação interna:

1. Valida runtime, integridade/FKs e hashes de snapshots; adquire manutenção exclusiva T06, recusando execução ativa.
2. Faz backup pela API nativa SQLite, fecha seu handle e verifica histórico/metadados; copia apenas o inventário gerenciado referenciado no banco, com hashes e tamanhos. Recusa escape, symlink, aliases case-insensitive/NFC, colisão arquivo/diretório e arquivos de fonte.
3. Grava manifesto de backup e checksum; restaura em diretório novo, verifica integridade/FKs/histórico/bytes e remove apenas essa prova interna recém-criada.
4. Renova manutenção durante cópia/backup/restauração. Antes do commit revalida backup, histórico, token/fencing, expiração e ausência de execução ativa, em transação curta.
5. Confirma schema 2 apenas após a prova. Falha pré-commit preserva schema/histórico 1. Expiração/falha de limpeza após commit devolve `status:'committed'` com `maintenance.status:'cleanup-pending'` e diagnóstico; não promete rollback nem incentiva retry cego.

`restoreQualityContractBackup({backupRoot,destinationRoot})` é a reversão mínima desta ativação: exige destino novo e separado da origem/backup, verifica inventário completo e bytes, devolve schema 1 e limpa apenas o lock pertencente à origem na cópia restaurada. Não faz downgrade in-place nem implementa o restore geral de T24/T26. Cópias parciais não são aceitas como backup válido; a cópia preservada não é reescrita para a restauração.
