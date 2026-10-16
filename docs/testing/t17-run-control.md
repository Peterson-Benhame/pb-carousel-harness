# T17 — Interromper e cancelar uma execução

> Relatório técnico sanitizado. Os resultados de execução foram registrados na origem validada; a exportação pública verifica os mesmos bytes de código e testes, sem repetir aqui as suítes completas.

Implementação do controle interno de execução. Os testes usam dados sintéticos em diretórios temporários, sem workspace real, render de produto, CLI pública ou instalação.

**Estado: T17 concluída no escopo técnico**, com revisão independente, integração T16 validada no Linux e qualificação Windows. T16 também está concluída; Q05 segue em implementação e não integra esta versão.

## API interna

`createRunControl({db, clock, signalAttempt})` retorna `interrupt({requestId, brandId, runId})` e `cancel({requestId, brandId, runId})`.

- `interrupt` exige run `running` com uma tentativa ativa coerente com etapa/titular/token. Revoga lease e incrementa fencing, encerra a tentativa em `interrupted`, devolve a etapa para `pending` e deixa o run `interrupted`.
- `cancel` encerra qualquer run não terminal suportado em `cancelled`. Uma tentativa ativa termina em `cancelled`. Lease reservado antes do registro da tentativa também é revogado. Runs já cancelados exigem derivação; runs concluídos não são alterados.
- Pedidos humanos ainda `pending` tornam-se `cancelled`. Etapas em espera tornam-se `invalidated`. Nenhuma rejeição de aprovação, parecer negativo ou saída é inventada. Aprovações, pedidos já resolvidos e artefatos históricos são preservados.
- O mesmo `requestId` com o mesmo escopo/operação lê o resultado já confirmado, sem sinalizar novamente, repetir eventos ou revogar eventual sucessor. Outro comando ou escopo com esse ID conflita.

A transação T06 reúne revogação T14, tentativa, etapa, pedido humano, run, evento e resultado idempotente. O guard final confere o estado após inserir a operação e reverte todo o controle se um trigger o alterar. Manutenção exclui novas mutações, mas permite replay histórico.

## Sinalização e publicação tardia

`signalAttempt` é dependência interna confiável, não um campo da solicitação. Recebe objeto congelado com `brandId`, `runId`, `attemptId`, `owner`, `fencingToken` original da tentativa e `reason`. Um adaptador deve resolver exclusivamente essa identidade completa; não deve resolver um PID ou o titular atual apenas pelo nome, pois podem pertencer a uma tentativa sucessora.

O callback é invocado somente após commit, de forma cooperativa e sem aguardar seu término. Falha, ausência ou demora do callback não reverte um cancelamento confirmado nem faz o retorno alegar entrega de sinal ou morte do processo. Rejeições de promises são consumidas. A proteção efetiva permanece na conferência do lease/token feita por `commitRunLease`, e no abort do heartbeat T14 quando perceber a revogação.

Testes IPC usam um processo real que mantém a identidade antiga, recebe e deliberadamente ignora o sinal. Nas quatro combinações interrupt/cancel × preview-render/render, sua publicação posterior é rejeitada com `RUN_LEASE_LOST`, sem artefato, evento ou operação extra. Outro processo também reproduz o resultado idempotente.

## Reconciliação e limites

Interromper não reconcilia arquivos, reaproveita parcial nem concede nova autorização. `resume` continua uma consulta. A reconciliação produtiva de bytes/resultado pertence a T23; só depois dessa verificação um serviço confiável pode usar a transição `reconciled`. O teste mínimo de sucessor usa reconciliação sintética explicitamente identificada.

T17 não acrescenta schema SQL, estado global, endpoint público, comando CLI, bypass de aprovação ou interpretação de `actor=user`. Os tipos e operações internas existentes comportam o controle. O novo módulo entra na allowlist diagnóstica de recursos. O esquema de operações públicas continua condicionado ao futuro fluxo público autorizado.

## Evidências executadas antes da integração T16

- Red inicial: 13 testes falharam pela ausência da API; green: 13/13.
- Hardening: reprodução red de incremento além do inteiro seguro; guard tipado e relógio fora da faixa de data verificados, green: 22/22.
- Allowlist: teste de presença falhou antes da mudança; manifesto e allowlist atualizados juntos. Uma execução intermediária iniciou entre essas duas alterações e falhou com `PACKAGE_INCOMPLETE`; não é considerada validação final.
- Focal inicial T17/T14/T15/T06: 103/103, sem falhas/skips, 14,505 s.
- Revisão detectou hashes de `resources.mjs` ainda antigos nos dois renderers e dependências transitivas ausentes. Testes novos reproduziram ambas as falhas antes da correção; manifesto/allowlist incluem controle, lease e clock, e todos os hashes declarados foram recalculados. Os dois renderers permanecem com seus status anteriores.
- Primeira full anterior a essa correção: 783 testes, 672 passaram e 111 falharam pelo `RUNTIME_MISMATCH` de recursos, 23,377 s; não foi uma validação bem-sucedida.
- Focal T17 ampliada após correção: 30/30, sem falhas/skips, 5,141 s. Inclui remoção e adulteração de dependências, projeção real dos controles, bloqueio de edição antes de reconciliação e derivação v2 legítima sem herdar consentimento.
- Segunda full local com hashes corrigidos: 773 resultados, 772 passaram e o processo `tests/visual/composed-carousel.test.mjs` encerrou após dois casos com mensagem genérica `test failed`; causa não exposta pelo reporter. Duração 179,391 s. Não foi apresentada como sucesso.
- Full independente do revisor sobre o mesmo produto: 790/790, zero falhas/skips, 177,916 s. Revisão do núcleo aceita antes da integração T16, com os dois achados de recursos fechados.
- Após essa full, apenas cleanup de testes IPC foi ajustado: filhos fecham antes do DB e da remoção do diretório. Focal local 30/30, 2,987 s.
- Focal independente após cleanup: 30/30, zero falhas/skips, 3,483 s.
- Full local final, `npm test -- --test-concurrency=2`: 790/790, zero falhas/skips, 140,015 s, saída 0. Mesma suíte, com limite de processos de arquivos para a reexecução.
- Integração T16 no Linux: focal combinado **121/121**, focal independente **150/150** e full serial combinada **817/817**; detalhes abaixo. Windows confirmado na seção final.

Comandos:

```sh
node --test tests/integration/run-control.test.mjs tests/integration/leases.test.mjs tests/integration/leases-race.test.mjs tests/integration/approvals.test.mjs tests/integration/operations.test.mjs
npm test
npm test -- --test-concurrency=2
git diff --check
```

Qualificação Windows concluída conforme registro final abaixo. Não inferir homologação visual ou de distribuição a partir dos testes de controle.

## Integração T16 validada no Linux e no Windows

A integração T16/T17 preserva os contratos de invalidação e controle de execução; a validação registrada abaixo cobre o conjunto integrado.

- Conflito em `shared/resources.manifest.json` resolvido pela união de `requiredFiles` e recálculo de todos os hashes dos dois renderers. A allowlist de `resources.mjs` contém invalidação, controle, lease e clock. Os 13 hashes legacy e 21 composed conferem com os bytes; composed continua `candidate`.
- Novo teste passa pela interrupção real, reconciliação sintética explícita, edição de conceito e novo plano. Preserva a aprovação da copy, exige nova aprovação do conceito, mantém histórico da tentativa interrompida e recusa publicação com o lease antigo.
- `reconcile-run` deixa de listar T14 concluída e mantém somente T23 como dependência. Teste novo falhou primeiro com a projeção antiga; a expectativa histórica em `run-runtime.test.mjs` também foi atualizada após falhar pelo delta pretendido.
- Focal combinado T17/T16/T15/runtime: **121/121**, zero falhas/skips, **47417,782592 ms**.
- Focal independente integrado, incluindo T14: **150/150**, zero falhas/skips, **30,295 s**; nenhum novo achado de integração. A full independente iniciada em paralelo foi interrompida por coordenação (saída 130), sem ser contada como passe.
- Full combinada final: `npm test -- --test-concurrency=1`, **817/817**, zero falhas/skips, saída **0**, **259362,655876 ms** (259,363 s).
- Sete hashes do delta de produto/testes versus T16 reconferidos após a full e intactos. Nenhuma alteração de código/teste posterior ao freeze Windows.
- Windows final registrado: **121/121**, zero falhas/skips, **302,69 s**, saída **0**. Primeira rodada no Temp virtualizado: **36 passaram e 85 falharam** por `EPERM` de links. O mesmo comando fora da virtualização passou sem alterações de código/testes.
- **122/122 hashes T17** e **119/119 hashes da origem T16** conferidos e preservados.
- **T16 e T17 concluídas nos respectivos escopos técnicos. Q05 está em implementação e não integra esta versão.** O fechamento não implementa reconciliação produtiva T23, nem libera T20, qualifica os layouts candidatos ou publica o produto.


Comando final portável, idêntico no recorte Linux e Windows:

```sh
node --test --test-concurrency=1 tests/integration/run-control.test.mjs tests/integration/invalidation.test.mjs tests/integration/approvals.test.mjs tests/integration/run-runtime.test.mjs
```
