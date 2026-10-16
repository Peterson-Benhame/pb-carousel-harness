# T12 — Entradas e artefatos versionados

> Cópia pública sanitizada: registros privados de conversa e execução foram omitidos. Estados e resultados técnicos abaixo descrevem a etapa original, não uma certificação da versão atual.

Data: 16/10/2026, UTC. Base: `07f8839`, branch `feat/module-01-brand-runtime`.

Estado deste relatório: T12 concluída no escopo aprovado. Revisão independente aceita; 34/34 focais e 202/202 completos no Linux; 34/34 no Windows. A conclusão desta tarefa não constitui aceite do módulo completo. T13 aguarda autorização própria.

## Escopo implementado

- API interna `createRunInputs({root, db})`, com `save`, `get`, `list` e `resolveArtifact`.
- Conjuntos de material imutáveis e consultáveis por versão, isolados por `brandId` e `runId`.
- Cópias originais de `carousel.json`, documento de conceito UTF-8 e assets expressamente fornecidos. Caminhos do JSON nunca são usados para descobrir ou abrir origens externas.
- Manifesto `inputs` imutável com referências a cada artefato, hashes, identidade executável, fingerprints, completude e motivos de pendência. A maior versão confirmada é o conjunto vigente; a consulta com versão explícita retorna o registro histórico correspondente.
- Validação estrutural existente via `validateCarousel(carousel, {themes: [snapshot.theme.id]})`. Importar o validador não lê mais configuração pessoal. Chamadores legados sem contexto mantêm o lookup de `shared/themes.json`, agora preguiçoso.
- Fingerprints canônicos para inputs, copy, conceito, assets e render. A função genérica aceita validate/package quando o futuro chamador fornecer entradas reais; nenhum resultado futuro é inventado.
- T07 reaproveitada: fonte explícita ou bytes de manifesto → staging exclusivo → fechamento → hash → promoção exclusiva → verificação → transação T06. A extensão `stageBytes` compartilha o mesmo escritor e protocolo com `stageFile`.

Foram criados `src/application/run-inputs.mjs`, `src/domain/artifact-fingerprints.mjs`, `tests/integration/run-inputs.test.mjs` e este relatório. Foram alterados `scripts/validate-carousel.mjs`, `src/infrastructure/fs/atomic-files.mjs` e `shared/resources.manifest.json`. Nenhuma migração, dependência, allowlist de release ou arquivo pessoal foi alterado.

## Contrato interno

`save` recebe `requestId`, `brandId`, `runId`, `expectedVersion` da execução, descritores opcionais `carousel` e `concept`, e a lista opcional `assets`.

- Descritor documental: `{sourcePath, sha256}`. Asset: `{id, sourcePath, sha256}`.
- Cada save representa um conjunto completo, não um patch. Componente omitido fica ausente na nova versão. Omissão de assets equivale a lista vazia. `null`, booleanos e outros descritores malformados são rejeitados.
- O hash fornecido é identidade de conteúdo; é conferido nos bytes efetivamente copiados. O `sourcePath` serve somente ao transporte e não integra identidade idempotente, metadados persistidos ou resultado.
- Replay do mesmo pedido resolve e verifica os artefatos confirmados sem reabrir a origem. Mudança na identidade do pedido produz `IDEMPOTENCY_CONFLICT`.
- JSON sintaticamente inválido é recusado. JSON legível, mas estruturalmente incompleto, pode ser preservado como draft com `CAROUSEL_INVALID`; nunca conclui inputs.
- Carrossel ausente, conceito ausente/em branco ou asset referenciado sem descritor explícito mantém draft. Conceito não é inferido a partir do carrossel.
- Assets fornecidos que não constam de um carrossel fornecido são recusados. Sem carrossel, material parcial pode ser guardado para preparação posterior.
- Slug inseguro, caminhos relativos inseguros/reservados/ADS, IDs duplicados e aliases de path por caixa são recusados antes da publicação.
- Conjunto completo e estruturalmente válido torna somente a etapa `inputs` succeeded, com execução ready. Parciais deixam inputs pending e execução draft. `creativeAssets: not-applicable` registra ausência explícita de assets em carrossel válido; não aprova nem conclui etapas humanas.
- `approved: true` no contrato legado permanece dado estrutural: não cria `Approval`, solicitação de aprovação de produção nem consentimento.
- Versão da execução é comparada antes do trabalho e dentro da transação final. Dois writers não sobrepõem a edição um do outro.
- Até T13/T16 existirem, somente draft/ready sem lease, tentativa running, aprovações ou resultados posteriores são editáveis. Estados terminais, interrupted e estados que exigem reconciliação são recusados. Isso evita implementar antecipadamente a máquina de estados ou invalidação seletiva.
- `get` e `list` verificam manifesto e todos os artefatos referenciados. `resolveArtifact` também exige os três IDs de escopo e verifica tamanho/hash antes de fornecer o caminho interno.

## Fingerprints

Todos contêm versão do contrato de fingerprint, versão canônica, etapa, marca, execução, hash do snapshot e identidade executável. A identidade executável registra pacote/versão, Node efetivo e hashes dos arquivos de código/contratos declarados no manifesto; não usa caminho de cache como identidade.

- Copy: conteúdo editorial, incluindo textos de slides, legenda, CTA, fontes, hashtags e alt text; ordem dos arrays preservada.
- Conceito: copy, hash do documento de conceito e composição visual do carrossel, incluindo tema, continuidade e visualSlot por slide.
- Assets: conceito/copy e conjunto de IDs/hashes criativos. Trocar somente bytes do asset preserva fingerprints de copy e conceito.
- Inputs/render: carrossel completo canônico, conceito e IDs/hashes dos assets.

Mudar copy afeta toda a cadeia acima. Mudar conceito/composição visual preserva copy. Reordenar chaves ou mudar espaçamento de JSON preserva fingerprints sem substituir os bytes originais de cada versão. Fingerprints identificam objetos; não autorizam reutilização, renderização ou consentimento por conta própria.

## Evidência red → green

1. Testes escritos antes dos módulos: `node --test tests/integration/run-inputs.test.mjs` deu 27 testes / 0 passaram / 27 falharam. Falhas esperadas: serviço/fingerprints/manifesto T12 ausentes e leitura pessoal antecipada do validador.
2. Primeiro green: 27/27 passaram, 4115.519424 ms.
3. Regressões adicionais reproduziram fingerprint de composição visual incompleto e descritor falso tratado como omissão: 30/32 passaram, 2 falharam, 5215.544498 ms. Correções produziram 32/32, 4916.598180 ms.
4. Regressão de `assets: null` reproduziu ausência de rejeição: teste focal 0/1. Validação de presença/tipo corrigida; execução seguinte 34/34, 5243.193593 ms.
5. A revisão preventiva também motivou cobertura de guards posteriores, conexões separadas e execução com globals negados. Não houve mudança na lógica de consentimento nem criação de T13/T15/T16.

## Verificação final local efetiva

Ambiente: Linux x64, Node v24.19.0, npm 11.9.0, better-sqlite3 13.0.3 e SQLite 3.53.4 previamente disponíveis. Nenhuma instalação ou atualização executada.

| Comando | Resultado observado |
| --- | --- |
| `node --test tests/integration/run-inputs.test.mjs` | 34 passaram; zero falhas/cancelados/ignorados; saída 0; 5399.007718 ms |
| `node --test tests/integration/run-inputs.test.mjs tests/integration/asset-store.test.mjs` | 52 passaram; zero falhas/cancelados/ignorados; saída 0; 5162.560070 ms. Executado antes do último reforço de rejeição de null e do marcador de kill; a suíte completa abaixo inclui ambos. |
| `npm test` | 202 passaram; zero falhas/cancelados/ignorados; saída 0; 8432.088731 ms |
| `git diff --check` | Sem erros |

npm emitiu aviso ambiental de configuração `http-proxy` e aviso de versão mais nova disponível. Nenhuma atualização foi feita. A suíte completa incluiu a regressão T07 e o empacotamento/auditoria mínimo T03; a allowlist de distribuição continua inalterada.

Cenários executados, com SQLite e filesystem reais:

- Originais preservados por bytes após remoção da origem, replay íntegro sem origem, manifesto e arquivo adulterados/removidos.
- Versões históricas, conjuntos parciais, ausência de conceito, ausência de assets declarados, JSON incompleto, alteração de copy, isolamento entre marcas/runs e referências cruzadas recusadas.
- Falhas injetadas em escrita, fechamento, hash, promoção e commit. Nenhuma referência/operação/etapa publicada no caso de falha; nova tentativa explícita funciona.
- Erro de FK deferred no commit: rollback de todo o conjunto, da versão, da etapa e da operação.
- Duas conexões SQLite com requisições iguais: um conjunto confirmado. Requisições divergentes: um resultado e um conflito CAS.
- Manutenção adquirida durante promoção impede commit. Estados terminais, lease, tentativa ativa e aprovação/resultado posterior impedem edição.
- Subprocesso encerrado dentro do commit, depois de marcador síncrono e promoção real: nenhum estado confirmado, arquivos completos órfãos isolados; retry explícito funciona.
- Reabertura em processo novo sem origens. Save em processo novo com leitura de globals pessoais bloqueada. Lookup legado verificado com temas sintéticos, sem transportar a configuração pessoal.
- Fingerprints seletivos, canônicos, vinculados à etapa, marca/run, snapshot e executável. JSON com outra serialização conserva identidade sem apagar versões de bytes.

As fixtures usam dados sintéticos e fecham todas as conexões SQLite antes do cleanup. Imports de subprocessos são URLs file construídas de `import.meta.url`, sem paths Windows interpolados como specifiers ESM.

## Revisão e qualificação Windows final

Resultados confirmados pelo coordenador em 16/10/2026:

Não foi necessário mudar produto ou testes para a repetição Windows. O transporte não incluiu fontes ou globals pessoais. Esta evidência qualifica somente os cenários T12 executados; não comprova renderer/layout, CLI/plugin ou instalação npm/npx do produto completo.

## Limites e próximo gate

- T12 concluída; T13 aguarda autorização específica. Nenhuma tarefa posterior foi iniciada.
- A API ainda é interna: CLI/plugin, aprovação humana de produção, invalidação seletiva, retomada e renderização pertencem às tarefas posteriores. Os guards conservadores desta tarefa deverão ser integrados à máquina de estados e às regras de invalidação nas tarefas previstas.
- A validação de inputs é estrutural. Bytes criativos são copiados e identificados; não há validação visual, decodificação de imagem, inspeção de transparência ou render/layout nesta tarefa. As fixtures de asset binário testam armazenamento, não homologam imagem. Fontes não são copiadas.
- Não há coletor de órfãos ou reconciliação de crash nesta tarefa. Falhas mantêm staging/arquivos sem referência isolados; não entram na entrega por presunção.
- O confinamento mantém o modelo local T04/T07; não é proteção contra um processo hostil com acesso irrestrito ao mesmo workspace.
- Snapshot e arquivo executável são identidades verificáveis, não promessa de equivalência de renderização em outro ambiente.
