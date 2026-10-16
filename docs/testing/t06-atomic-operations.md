# T06 — Transações, manutenção e idempotência

> Cópia pública sanitizada: registros privados de conversa e execução foram omitidos. Estados e resultados técnicos abaixo descrevem a etapa original, não uma certificação da versão atual.

## Escopo e resultado

Implementação autorizada individualmente em 16/10/2026, a partir de `2f3b4ce`, branch `feat/module-01-brand-runtime`. Somente T06; nenhum fluxo de marca, armazenamento de arquivo, aquisição de lease de produção, backup ou CLI pública foi implementado.

Arquivos novos:

- `src/domain/canonical-json.mjs`
- `src/application/operation-runner.mjs`
- `src/infrastructure/sqlite/maintenance.mjs`
- `tests/integration/operations.test.mjs`

T06 concluída: revisão independente aceita, 76/76 testes Linux e 14/14 testes Windows passaram. T07 não iniciada e depende de autorização própria.

## Contratos internos

- Canonização v1: chaves ordenadas recursivamente por ordem UTF-16, incluindo chaves numéricas; ordem dos arrays preservada; números/strings conforme codificação JSON. SHA-256 UTF-8 e versão persistida separadamente. Dados fora do domínio JSON são recusados (undefined, funções, bigint, números não finitos, ciclos, arrays esparsos, accessors e objetos com protótipos especiais). Não chama `toJSON` nem getters. Não é implementação anunciada de RFC 8785.
- `runOperation(db, request, mutate)` recebe requestId, nome da operação, brandId/runId opcionais e payload JSON. A identidade inclui comando, escopo e payload. Mesma chave e identidade retorna o resultado JSON persistido sem executar callback; divergência retorna `IDEMPOTENCY_CONFLICT`. Versão de canonização desconhecida é recusada.
- Transação `BEGIN IMMEDIATE` cobre checagem do schema, lookup da chave, bloqueio de manutenção, alterações do callback, eventos e inserção do resultado. O retorno só sai depois do commit. Falha de constraint diferida no próprio commit também reverte tudo.
- Callback interno é síncrono, curto e apenas de banco. Recebe `{db, emit}`; emite eventos com correlação requestId e escopo da solicitação. Deve devolver `{status:'committed', result:<JSON>}`. Reserva pendente, resultado inválido ou exceção abortam. Não é API para código fornecido por plugin/usuário. Callback não pode controlar transações ou realizar I/O; funções async/generator e uso em transação externa são recusados. Um callback síncrono malcomportado que agende trabalho externo não está isolado por este contrato.
- Replays de resultados já confirmados são permitidos durante manutenção: não mutam estado. Mutações novas verificam o bloqueio dentro da mesma transação.
- Manutenção usa titular, finalidade, expiração e fencing token crescente. Aquisição verifica atomicamente bloqueio vigente, lease válida e tentativas ainda `running`, mesmo se a lease venceu. Sem tentativa ativa, bloqueio expirado pode ser substituído; titular/token antigos não renovam nem liberam o novo bloqueio. Renovação e liberação também revalidam schema e posse dentro de transação.
- `SQLITE_BUSY` é convertido em `PublicError` com código `DATABASE_BUSY` e mensagem fixa, preservada pelo protocolo de erros existente. Não há retry automático de banco nem SQL/path na mensagem; próxima chamada deve reutilizar requestId.

## TDD e comandos executados

Ambiente: Linux x64, Node v24.19.0, npm 11.9.0, better-sqlite3 13.0.3 já instalado. Nenhuma instalação adicional, mudança de dependência ou schema nesta tarefa.

1. `node --test tests/integration/operations.test.mjs`: red por `ERR_MODULE_NOT_FOUND` em `canonical-json.mjs` antes da implementação.
2. Primeiro green: 12/12; timeout observado 5011.3 ms.
3. Acrescentados encerramento real do escritor antes do commit e corrida de manutenção contra mutação que registra uma lease sintética: 14/14.
4. Revisão identificou erro busy nativo que o protocolo converteria em `INTERNAL_ERROR`. Teste ajustado primeiro; `node --test --test-name-pattern='contention' tests/integration/operations.test.mjs` falhou porque o erro ainda não era `PublicError`.
5. Correção no limite compartilhado de transação. Comando focal completo final: 14/14, zero falhas/cancelados/ignorados, 7954.974148 ms; espera busy observada 5013.0 ms.
6. `npm test`: 76/76, zero falhas/cancelados/ignorados, 8047.920633 ms.
7. Revisão independente reconfirmou 76/76 e busy 5011.0 ms, aceitando a correção.
8. Coordenador reconfirmou independentemente `npm test`: 76/76, saída 0, aproximadamente 8015 ms.
9. `git diff --check`: sem problemas de whitespace.

Os testes usam SQLite real e subprocessos Node, não mocks da exclusão de escrita. Dados sintéticos em diretório temporário com espaço/acento. Teardown encerra subprocessos e fecha todas as conexões antes de remover diretório, evitando o problema EBUSY observado anteriormente em Windows.

## Evidências cobertas

- Ordenação recursiva, arrays, chaves especiais e recusa de valores não JSON.
- Estado, evento e resultado confirmados juntos; replay por outra conexão com chaves reordenadas.
- Conflito por payload, operação e escopo; versão desconhecida recusada.
- Rollback de exceção, reserva pendente, resultado inválido e constraint diferida de commit.
- Callback async, requestId ausente e transação aninhada recusados antes de efeitos.
- Manutenção exclui mutações, disputa de titulares, renovação/liberação e fencing após expiração.
- Recusa por lease válida e por tentativa não reconciliada; schema futuro rechecado.
- Dois processos escritores: callback da segunda chamada não executa; uma alteração, um evento, um resultado.
- Espera real do `busy_timeout=5000`, erro tipado e replay após conclusão do primeiro escritor.
- Bloqueio de manutenção persistido por outro processo impede mutação.
- Escritor encerrado com SIGKILL antes do commit: nenhum efeito confirmado, retry posterior funciona.
- Aquisição de manutenção espera uma mutação concorrente e observa a lease que ela confirmou, sem janela entre consulta e aquisição.

## Bundle para qualificação Windows

Bundle JSON `{files:[{path,content,sha256}]}` comprimido gzip e codificado base64; 11 arquivos, 16.976 caracteres base64. Inclui somente dependências transitivas locais dos testes e os quatro arquivos novos; não inclui node_modules, fontes, configurações de marca, artefatos de distribuição ou dados de workspace.

SHA-256 do JSON descomprimido: `4125c55896100db37da95f4170d385ae56c6ec10f6661ba97858a785e4b4b06d`.

Hashes dos arquivos T06:

- runner: `8eb2ff01ac22f8eac91c7e63dbf3e69cacbe3be6aa0220ec96190688f9704b29`
- canonical: `e0275e3ccb556104266f191c1effe663338e1935dc29137f7bd07763f01b9cdd`
- maintenance: `2765dc2a7e53f186f0be439246418aab1e5077e16e38f80d5c94d31ff28dcbd0`
- tests: `0a26080631960a25b06515e2f82c49d76bfa5676c7ca37d2400f3dea274192a8`

### Resultado Windows confirmado

- `node --test tests/integration/operations.test.mjs`: 14/14 passaram, zero falhas e zero ignorados, saída 0, 9745.0839 ms.
- Node v24.21.0, better-sqlite3 13.0.3, SQLite 3.53.4.
- Contenção real observada: 5538.6 ms, com `busy_timeout=5000` confirmado. O timeout é configuração de espera SQLite, não uma promessa de duração exata de parede.
- Os 11 hashes pós-execução coincidiram com o bundle. Conferência local de todos os 11 arquivos e do SHA-256 do JSON repetida em 16/10/2026, 14:27 UTC: todos coincidem.
- Coordenador repetiu a suíte Linux às 14:27 UTC: 76/76, saída 0.

Este resultado qualifica os cenários T06 no Windows; não demonstra ainda fluxo completo do produto, instalação npm/npx, arquivos imutáveis, leases de produção ou backup.

## Limites

SQLite não torna filesystem transacional. Não houve implementação de staging/promoção/reconciliação (T07), serviços de lease/fencing de produção (T14) ou backup (T24). Futuro trabalho sob manutenção precisa renovar a posse durante I/O e verificar o token antes de publicar; este módulo não declara um backup válido só porque adquiriu um lock. Tentativas `running` expiradas exigem reconciliação futura; não são silenciosamente presumidas concluídas.

O teste de SIGKILL cobre encerramento de processo, não falha física de disco/energia. Não se promete execução computacional exatamente uma vez. Callbacks são código interno confiável e têm acesso à conexão SQLite; isto não isola código hostil que ignora o contrato. Sem commit/push/publicação nesta execução. Gate de redistribuição permanece.
