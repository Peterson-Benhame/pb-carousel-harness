# T13 — Estados, etapas e leitura determinística da execução

> Cópia pública sanitizada: registros privados de conversa e execução foram omitidos. Estados e resultados técnicos abaixo descrevem a etapa original, não uma certificação da versão atual.

Implementação local: 16/10/2026, 16:42–16:57 UTC. Fechamento documental após resultado Windows: 17:02 UTC. Base: `e3cd737`, branch `feat/module-01-brand-runtime`.

## Implementação

Criados:

- `src/domain/run-state-machine.mjs`
- `src/domain/stage-graph.mjs`
- `src/application/run-runtime.mjs`
- `tests/unit/run-state-machine.test.mjs`
- `tests/integration/run-runtime.test.mjs`
- Este relatório

Alterados:

- `src/application/run-inputs.mjs`: usa a transição pura `inputs-updated` para decidir draft/ready. Os guards conservadores de edição, o CAS e o protocolo transacional T12 permanecem intactos.
- `shared/resources.manifest.json`: inclui os três novos módulos na verificação diagnóstica. A allowlist mínima de distribuição não mudou.

Não houve migração nem alteração do checksum de `001-initial.sql`, dependências, CLI, configurações pessoais, renderer ou políticas de aprovação.

## Máquina de execução

A tabela imutável reproduz os oito estados e todas as arestas da seção 8.2 da especificação v0.3. Os testes percorrem os 64 pares de origem/destino, incluindo todas as arestas proibidas.

- Rejeição humana modelada: `waiting-approval` → `blocked`.
- Aprovação modelada: `waiting-approval` → `ready`.
- Alteração de entrada completa/incompleta pode manter draft/ready ou devolver ready/waiting-approval para draft.
- A correção de blocked e a reconciliação de interrupted têm eventos distintos.
- Completed/cancelled não admitem evento algum. Repetir cancelamento ou conclusão não reabre estado terminal.
- Salvar um conjunto de entradas pode preservar draft ou ready sem representar uma transição de estado.
- Nomes de eventos precisam ser strings. Arrays, objetos coercíveis, flags extras e valores não booleanos são recusados.

As funções puras descrevem transições. Elas não verificam identidade humana, não confirmam consentimento, não gravam banco e não executam etapas. O runtime não expõe essas funções como comandos mutáveis.

## Etapas e tentativas

A sequência permanece: inputs → copy-approval → concept-approval → assets-approval → render → validate → package.

Cada etapa declara sua dependência imediata e papel (entrada, aprovação ou execução). A projeção de registros ausentes produz pending em memória, sem backfill no banco. A primeira etapa diferente de succeeded determina a pendência. Nomes desconhecidos, duplicatas, estados e fingerprints inválidos são recusados no domínio e diagnosticados conservadoramente na leitura persistida.

A máquina pura diferencia:

- Inputs: verificação pode concluir; remoção de material obrigatório volta a pending.
- Aprovação: pending → waiting-approval; decisão → succeeded/failed.
- Ausência explícita: somente assets-approval aceita `assets-not-applicable`; conceito e copy continuam obrigatórios.
- Execução: pending → running → succeeded/failed. Interrupção deixa a etapa pending e a tentativa possui seu resultado interrupted separado.
- Invalidação/reset são apenas semântica de domínio nesta tarefa; nenhum serviço de invalidação ou retry executável foi criado.

Os testes percorrem os 36 pares de estado para cada uma das sete etapas (252 combinações), além dos eventos semânticos.

Tentativas usam running, succeeded, failed, interrupted e cancelled, como no schema T05. Apenas running pode terminar; todos os quatro estados finais são terminais. Os 25 pares de estados são exercitados. Identificador, ordem, executor, fencing token, horários, erro e referência de resultado são consultados sem criar ou retomar tentativas.

## Runtime consultivo

`createRunRuntime({root, db})` retorna somente `get({brandId, runId})` e `resume({brandId, runId})`. Ambos são a mesma consulta; não aceitam target status, ator, aprovação, evento, callback de execução ou requestId de mutação.

A resposta contém:

- Estado e versão persistidos, indicador terminal e etapa atual projetada
- As sete etapas e histórico de tentativas
- Pendência e próxima ação
- Diagnósticos de inconsistência ou verificação indisponível
- Referências dos resultados atuais cujos bytes foram verificados

`nextAction.available` distingue ações já suportadas de dependências futuras. Exemplos:

| Condição | Próxima ação | Disponível |
| --- | --- | --- |
| Draft editável com entrada incompleta | edit-inputs | Sim, pelo serviço T12 existente |
| Primeira aprovação pendente | request-approval | Não; T15 |
| Etapa de execução pendente | resume-stage | Não; T14/T15 e implementação correspondente |
| Blocked | correct-run | Não; T16 |
| Interrupted | reconcile-run | Não; T14/T23 |
| Running consistente | inspect-attempt | Sim, somente leitura |
| Registros inconsistentes | inspect-run | Sim, somente leitura |
| Completed | inspect-results | Sim, somente leitura |
| Cancelled com marca ativa | derive-run | Sim, pelo serviço T11 existente |

Consultar ready não o converte em waiting-approval. Consultar completed não incrementa versão, cria operação/evento/tentativa, gera arquivo ou regenera material. Cancelled permanece terminal. Nenhum resultado de uma execução antiga é convertido em autorização para uma nova.

### Integridade e limites de confiança

- A leitura usa escopo composto marca/execução, verifica schema e hash do snapshot e resolve manifesto/bytes via T12.
- Inputs completos precisam corresponder à etapa inputs e ao fingerprint persistido. Missing/tamper produz diagnóstico, sem alteração automática do estado.
- Etapas fora de ordem, current_step incompatível, ausência de tentativa ativa em running, lease/executor incompatíveis e horários finais incoerentes são diagnosticados.
- Uma etapa de execução succeeded precisa da última tentativa succeeded com referência de saída. Tentativa posterior failed impede apresentar a saída histórica anterior como resultado atual.
- Completed precisa de cadeia de etapas satisfeita e resultado do tipo package ligado à tentativa da própria etapa package. Um artefato chamado package produzido por outra etapa não satisfaz essa condição.
- Arquivos de resultado são conferidos por tamanho/hash. `integrity: verified-bytes` não afirma ZIP válido, layout aprovado, render executado nesta tarefa ou resultado semanticamente homologado. `RESULT_VERIFICATION_UNAVAILABLE` mantém esse limite explícito.
- Sucesso de uma etapa humana não é consentimento. A ausência de registros correspondentes é inconsistente; mesmo registros existentes recebem `APPROVAL_VERIFICATION_UNAVAILABLE` até T15. A ausência explícita de assets no manifesto permite reconhecer sua etapa registrada sem fabricar aprovação de assets e sem pular copy/conceito.
- Os avisos de verificação ainda indisponível são distintos de corrupção/inconsistência. Um histórico estruturalmente íntegro aguardando validate/package continua com ação de execução indisponível, sem ser rotulado como corrompido por faltar T21/T22.
- A captura de banco antes/depois das leituras de arquivos detecta alterações concorrentes observáveis e lança `RUN_VERSION_CONFLICT`. Isso não substitui leases/fencing, verificação atômica de arquivos nem reconciliação T14/T23.
- A leitura nunca corrige um estado terminal nem transforma evidência incompleta em sucesso presumido. O campo status continua identificado como persistido; diagnósticos explicam suas limitações.

## Evidência red → green

Testes foram escritos e executados antes das respectivas implementações/correções:

1. Máquina inicial ausente: 22/22 falharam por exports ausentes; após implementação, 22/22 passaram, 130.481337 ms.
2. Runtime/manifesto ausentes: 15/15 falharam, 1192.200332 ms. Primeiro ciclo: 14/15. A expectativa do teste foi corrigida para a ação consultiva inspect-run disponível quando avançar está bloqueado, sem afrouxar a proibição de executar.
3. Máquina das etapas: 22/30 passaram, oito falhas esperadas por API ausente. Após implementação: 45/45 focais passaram, 2455.111449 ms.
4. Regressão de package associado à etapa errada: 18/19 passaram. Acrescentadas regressões de ausência de assets e nomes de evento coercíveis: 48/51 passaram, três falhas. Após correções: 51/51, 3474.61798 ms.
5. Regressão do aviso de verificação de resultados ainda não implementada: 0/1 antes da correção; focal posterior 51/51, 3689.079852 ms.
6. Fronteiras finais de histórico: 20/23 integrações passaram, três falhas reproduziram classificação indevida dos avisos futuros e succeeded sem saída. Após correção: 54/54 focais passaram, 3239.356698 ms.

As rodadas intermediárias permaneceram com suas falhas explícitas; não foram apresentadas como resultado final.

## Verificação final local

Ambiente: Linux x64, Node v24.19.0, better-sqlite3 13.0.3 / SQLite 3.53.4 previamente existentes. Sem instalação ou atualização. A matriz sintética usada pelas fixtures permite exercitar o código no ambiente local; não homologa esse ambiente como runtime de produção.

| Comando | Resultado real |
| --- | --- |
| `node --test --test-reporter=tap tests/unit/run-state-machine.test.mjs tests/integration/run-runtime.test.mjs` | 54 passaram: 31 unitários + 23 integração; zero falhas/cancelados/ignorados; saída 0; 3239.356698 ms |
| `node --test --test-reporter=tap` | 256 passaram; zero falhas/cancelados/ignorados; saída 0; 9033.504275 ms |
| `git diff --check` | Sem erros |

A suíte completa inclui os testes preexistentes de distribuição mínima, que internamente exercitam npm pack/dry-run no sandbox de testes. Não houve comando npm direto, instalação, publish ou mudança de dependências nesta tarefa.

Integração usa SQLite e filesystem reais. Interações humanas da preparação da marca, histórico de aprovações e resultados de etapas futuras são fixtures sintéticas explícitas; não representam consentimento nem execução real do renderer. O subprocesso usa URLs `file:` e abre o banco em leitura. Todas as conexões do fixture são fechadas antes do cleanup, inclusive para portabilidade Windows.

### Identidades finais do código/testes

| Arquivo | SHA-256 |
| --- | --- |
| src/application/run-runtime.mjs | 059ad59719006b001152566c28d04ecf91487c4ceb33f008d6a7489157ed28d4 |
| tests/integration/run-runtime.test.mjs | 85f6ef6d037da323362afc1e190d7e3a7b7afa61c1d4305c7da1a90114aaf740 |
| src/domain/run-state-machine.mjs | fa4a247ecdd3ec59a83fade618ed355baa8de2bd0ec2afa019ba92f30a4c0cb9 |
| src/domain/stage-graph.mjs | 2b496379e1a97f778a9ecd9de5ce931c11a45b12fb0bda760fb59453046a309e |
| tests/unit/run-state-machine.test.mjs | b62b2b5246becae647dd15181d552212fd88aca5b08b1a7eda7787ac3e26206b |
| src/application/run-inputs.mjs | c155857e5c37c44e6dd7ddfe3fbbe857ef379d403663d0bb7f0ba3ad172d7c3d |
| shared/resources.manifest.json | d2ab009785ec3b864d5fa46aa6c0ce1567bb7ad2b1568f03ba0f6ecaa8c1fb5e |

## Windows, revisão e fronteiras restantes

- A primeira rodada teve 17 falhas de integração com `EPERM` ao criar hard links no diretório temporário virtualizado.
- A repetição da mesma suíte, autorizada fora da virtualização, passou integralmente sem alterar código ou testes.
- Os 47 hashes finais foram conferidos e permaneceram intactos. O coordenador reconferiu os 47 arquivos locais às 17:00 UTC, sem divergências.
- Transporte: bundle-base de 47 arquivos, seguido de delta de dois arquivos (`src/application/run-runtime.mjs` e `tests/integration/run-runtime.test.mjs`). SHA-256 do JSON da base: `8600cf9bc0b88e2815b9e478b71f8d68be31c67ad495d4ace3e9856dca8627d6`. SHA-256 do JSON do delta final: `6855d2562cd644efef3f8a70b14d2a48228cbd21391251d37340f0eb4ec45270`.
- Os dois hashes finais do delta são os registrados na tabela acima. Nenhuma fonte ou dependência foi redistribuída no transporte de teste.

T14 (leases/fencing), T15 (gateway/registro de aprovação), T16 (invalidação persistida), T17 (controles), T18–T23 (adaptação, execução, validação, pacote e reconciliação) continuam fora de escopo. Não há CLI/plugin operacional, geração real, retry, consentimento livre ou confirmação de pacote por callback. Sem commit, push, publicação, instalação ou redistribuição. Este trabalho não comprova AC07/AC08/AC09/AC20 integralmente nem conclusão do módulo.

Próximo gate: aprovação da proposta de sequência para produzir e avaliar o primeiro carrossel visual, conforme solicitado pelo usuário. Isso não autoriza implementação adicional nem inicia automaticamente T14; T14 continua não iniciada.
