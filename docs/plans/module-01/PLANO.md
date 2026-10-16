# Peterson Carousel Harness — Plano de implementação do Módulo 01

**Documento:** plano 1.0, para aprovação.  
**Referência:** Especificação 01, revisão 0.3, Memória de Marca e Estado de Execução.  
**Produto:** `@pb/carousel-harness`; executável `peterson-carousel`.  
**Data:** 15/10/2026, UTC−03; 16/10/2026, UTC.  
**Executor escolhido:** Dot.  
**Estado:** especificação aprovada; plano pendente de aprovação; implementação não iniciada.

## 1. Decisão pedida e autorização

Este documento descreve o trabalho futuro. Aprovar o plano não significa executar todas as tarefas em sequência. A aprovação do plano autoriza iniciar T00. A execução será de **uma tarefa por vez**, parando ao final para apresentar evidências e aguardar autorização da próxima, salvo autorização explícita de um lote identificado.

A revisão 0.3 foi confirmada pelo usuário com “exato”, após a pergunta explícita de aprovação da especificação e de autorização para elaborar o plano. Esta autorização cobre o planejamento. Não cobre instalação, implementação, publicação ou envio ao repositório remoto.

A única alteração feita nesta etapa é a criação deste plano e do registro de progresso, fora da base de produto. Nenhum teste de produto, instalação ou demonstração Windows é apresentado como realizado.

## 2. Base, divergências e limites

Base inspecionada: `peterson-carousel-suite-windows-v2.zip`, SHA-256 `8e17e3eb1c0ddf39f64770358bda35e93189ae70cb907320e0ebc0df2135a93f`. Diretório de referência: `carousel-inspection/extracted/peterson-carousel-suite`.

Confirmado por inspeção, sem executar o produto:

- Projeto ESM, privado, versão 0.1.0; renderer, validador e empacotador Node existentes.
- Lockfile registra `sharp` 0.34.5, `fontkit` 2.0.4 e `archiver` 7.0.1. Esta é a baseline inicial, não uma recomendação de atualização automática.
- Existem quatro skills, manifesto de plugin, configuração global de marca/temas e fontes locais. Não existe suíte `tests/` nem histórico Git no ZIP. Os supostos 37 testes anteriores não estão disponíveis.
- O template já recebe `brand`, `theme` e `fontData`. A alteração necessária começa no renderer, que resolve marca e fontes internamente; não será criada uma segunda API equivalente no template.
- `assets/profile/` não contém logo. Referências visuais não serão tratadas como logo.
- O instalador externo ao diretório da suíte executa instalação e registro do plugin. Não será utilizado como hook npm nem reaproveitado automaticamente.
- `ATTRIBUTION.md` restringe redistribuição da adaptação sem permissão. O gate abrange **qualquer distribuição**, inclusive tarball entregue a terceiros, plugin, commit/push público e registry, não só `npm publish`. Um repositório remoto público vazio não autoriza subir a base.

### Ajustes de entendimento incorporados

1. `run.interrupt` interrompe uma tentativa e preserva a possibilidade de continuar a execução. `run.cancel` continua terminal.
2. A comparação legado/adaptador usa os mesmos recursos configurados, arquivos de fontes, hashes e ambiente. Não se promete equivalência entre dois conjuntos de fontes diferentes.
3. Confinamento de caminhos inclui o `slug` e os caminhos derivados por renderer e empacotador.
4. O pacote não registra plugin nem inicializa/migra workspace na instalação.
5. O registro de progresso do desenvolvimento é separado do SQLite do produto.

Ficam fora: módulos seguintes, catálogo de templates, editor, fontes personalizadas, SVG, foto de assinatura, APIs de imagens, ingestão de livros, publicação social, multiusuário, nuvem e SDK público. A entrega usa carrossel e assets fornecidos e o contrato editorial atual.

## 3. Arquitetura e decisões a validar

### 3.1 Um núcleo, dois canais

Um único pacote ESM contém CLI, serviços de aplicação, repositórios, migrações e adaptadores. A CLI e o plugin chamam as mesmas operações. O plugin usa Node autorizado e caminho absoluto/versionado do entrypoint, com argumentos separados; não escolhe arbitrariamente o primeiro binário do PATH nem executa `latest` ou `npm.cmd` por operação.

Fronteiras propostas:

- `src/domain/`: contratos, hashes canônicos, estados, invalidação e erros.
- `src/application/`: BrandMemory, AssetStore, RunRuntime, aprovações e workspace.
- `src/infrastructure/`: SQLite, arquivos, relógio, recursos locais e diagnóstico.
- `src/adapters/legacy/`: integração do renderer, validador e empacotador.
- `src/interfaces/cli/` e `src/interfaces/plugin/`: adaptação dos mesmos serviços; sem SQL nas interfaces.

Não se cria event sourcing. O banco guarda estado/metadados; os arquivos preservam bytes; eventos são diagnóstico. Exports JSON não constituem bancos paralelos.

### 3.2 Matriz candidata, ainda não homologada

| Componente | Candidato | Decisão/gate |
|---|---|---|
| Sistema | Windows, x64 inicialmente | Alvo de aceite obrigatório; ARM64 só anunciado se validado separadamente |
| Node.js | 24.21.0 LTS | Fixar somente após T01; registrar versão exata no release |
| npm | 11.19.0, associado ao Node candidato | Validar empacotamento, instalação, política de scripts e npx em T01/T32 |
| SQLite | better-sqlite3 13.0.3, atrás de adaptador | Manifesto exige Node >=22 e prevê plataformas Windows; instalação real e backup precisam de teste |
| Render | sharp 0.34.5, fontkit 2.0.4 | Preservar baseline; nenhum upgrade incidental |
| ZIP | archiver 7.0.1 | Preservar baseline |
| Testes | `node:test` e `node:assert/strict` | Evitar framework adicional; processos filhos para concorrência e interrupção |

Motivo do adaptador explícito: transações e backup documentados, isolamento de dependência e diagnóstico de carregamento. A documentação de `node:sqlite` da linha consultada ainda sinaliza estabilidade de release candidate; não será adotado sem reabrir a decisão. A escolha não autoriza usar configuração WAL do exemplo da biblioteca: manter `journal_mode=DELETE`, `synchronous=FULL`, `busy_timeout=5000`, `foreign_keys=ON`, verificados por conexão.

Fontes da pesquisa técnica, a reconferir na tarefa de homologação:

- [Node 24.21.0](https://nodejs.org/en/blog/release/v24.21.0)
- [npm incorporado ao Node candidato](https://raw.githubusercontent.com/nodejs/node/v24.21.0/deps/npm/package.json)
- [Manifesto better-sqlite3 13.0.3](https://raw.githubusercontent.com/WiseLibs/better-sqlite3/v13.0.3/package.json)
- [API de transação e backup do adaptador](https://raw.githubusercontent.com/WiseLibs/better-sqlite3/v13.0.3/docs/api.md)
- [Instalação e dependências de plataforma do sharp](https://sharp.pixelplumbing.com/install/)
- [SQLite: chaves estrangeiras](https://www.sqlite.org/foreignkeys.html), [transações](https://www.sqlite.org/lang_transaction.html) e [backup](https://www.sqlite.org/backup.html)
- [npm package.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/), [pack](https://docs.npmjs.com/cli/v11/commands/npm-pack/) e [shrinkwrap](https://docs.npmjs.com/cli/v11/configuring-npm/npm-shrinkwrap-json/)

Se o candidato falhar no Windows, registrar evidência e apresentar substituto antes de congelar versões. Não ampliar suporte de plataforma nem trocar bibliotecas silenciosamente. Testes internos portáveis não homologam o produto em Linux/macOS.

### 3.3 Contratos críticos

- Identificadores gerados definem diretórios internos. `slug` é validado como dado e jamais determina um caminho sem confinamento. Importações externas só leem origens explicitamente fornecidas; fontes usam raiz autorizada somente para leitura.
- Raiz: `--data-dir` > `CAROUSEL_DATA_DIR` > `%LOCALAPPDATA%\PetersonCarouselHarness`. Relativos explícitos são resolvidos uma vez contra o diretório da chamada; referências persistidas são relativas. Sem UNC/compartilhamento de rede como workspace suportado.
- `--help`, `--version`, `doctor` e consultas não criam diretórios, banco nem migrações. Dependências nativas são carregadas sob demanda; ausência de SQLite/sharp vira diagnóstico, não crash precoce.
- Toda mutação recebe `requestId`; hash canônico do payload e resultado são associados à mudança na mesma transação. Mesma chave e payload: mesmo resultado. Payload divergente: `IDEMPOTENCY_CONFLICT`.
- Aprovação permanente de marca e consentimento de produção exigem interação humana local explícita. Não há operação pública para declarar `actor=user`, nem confirmação por `--yes`, JSON ou stdin redirecionado. A TTY não é apresentada como proteção contra processos hostis com acesso irrestrito ao computador.
- Snapshot congela marca, tema, dimensões, política, assets/hashes, contrato, pacote, motor/dependências, template `legacy-panorama@1` e manifesto das fontes. Caminho do cache não é identidade de runtime.
- Lease por execução: 60 s, renovação 10 s, fencing token crescente. Aquisição de lease e de manutenção se excluem por verificações dentro de transações; não há janela entre consultar e adquirir. Publicação exige titular/token ainda válidos.
- Arquivos: staging exclusivo → fechamento → verificação/hash → promoção para destino novo → commit de referências/estado. Nunca se presume transação atômica envolvendo SQLite e filesystem.
- `run.interrupt` registra pedido, revoga token/lease, sinaliza a tentativa e mantém a execução `interrupted`; reconciliação leva a `ready`/`blocked` antes de edição. `run.cancel` revoga trabalho ativo e termina em `cancelled`. Um executor atrasado não publica após qualquer revogação.
- Backup, migração e purge respeitam manutenção exclusiva. Consultas compatíveis não executam reparos. Schema novo demais é recusado também para leitura; nenhuma tentativa de downgrade.

## 4. Disciplina de execução e evidência

Todos os caminhos de tarefas abaixo são relativos à raiz da suíte, exceto os documentos de planejamento. São **arquivos propostos**, não implementados. Na T00, confirmar que não colidem com alterações do usuário.

Para cada tarefa que muda comportamento:

1. Escrever o teste específico e registrar sua falha esperada.
2. Implementar o mínimo e executar novamente.
3. Executar os testes afetados e verificar o diff; não alterar escopo incidentalmente.
4. Atualizar `docs/plans/module-01/PROGRESSO.md`: arquivos, comandos efetivos, resultados, evidências e limitações.
5. Informar a próxima tarefa e parar para aprovação. Se autorizada uma sequência, respeitar exatamente seus IDs e parar no fim dela.

Os comandos descritos são futuros. Não há resultados presumidos. Testes usam dados sintéticos, diretórios temporários isolados e fontes locais autorizadas, sem embutir binários no release. Nenhum teste pode tocar memória real do usuário. Scripts destrutivos exigem marcador de sandbox e falham fora dele.

Ao retomar em nova sessão: ler plano/progresso, conferir branch/diff, artefatos e últimos resultados; não confiar só no resumo. Usar branch local quando houver Git; não inicializar vínculo remoto ou fazer push automaticamente.

## 5. Tarefas verificáveis

### T00 — Registrar baseline e controle do trabalho

**Depende de:** aprovação do plano, que libera o início de T00.

**Arquivos:** criar `docs/plans/module-01/PLANO.md`, `PROGRESSO.md`, `BASELINE.md`; registrar hashes sem copiar dados privados para documentação distribuída. Criar branch local `feat/module-01-brand-runtime` se houver repositório apropriado; preservar alterações existentes. Se não houver Git, inicializar apenas um repositório local de trabalho nesta tarefa, preservando a cópia de inspeção; nenhum push está autorizado.

**Verificações futuras:** `git status --short`, `git diff --stat`, hash SHA-256 do ZIP, inventário de arquivos, leitura de `ATTRIBUTION.md`, package/lock e scripts. Não instalar nem renderizar nesta tarefa.

**Concluída quando:** baseline reproduzível, divergências anotadas, gate de redistribuição registrado, nenhuma suposição sobre testes ausentes. **Cobertura:** fundamento de AC17, AC26, AC32.

### T01 — Homologar os candidatos de runtime

**Depende de:** T00 e acesso autorizado a Windows de teste.

**Arquivos:** criar `docs/architecture/runtime-matrix.md`, `tests/qualification/native-runtime.test.mjs`; preparar candidatos em sandbox separado, não migrar projeto/workspace real. Registrar configuração, versões, arquitetura e política de scripts npm.

**Testes/comandos futuros:** `node --version`, `npm --version`; instalar versões candidatas em sandbox; `node --test tests/qualification/native-runtime.test.mjs`. Exercitar import ESM, abertura SQLite, pragmas, transação, backup consistente e carga/render mínimo de sharp; registrar dependências nativas e ausência de compilação inesperada.

**Concluída quando:** matriz exata tem evidência Windows. Falha ou indisponibilidade bloqueia o congelamento técnico; apresentar alternativa para aprovação. **Cobertura:** AC22, AC23, AC30.

### T02 — Criar entrypoint e protocolo da CLI

**Depende de:** T01.

**Arquivos:** criar `bin/peterson-carousel.mjs`, `src/interfaces/cli/main.mjs`, `parse-args.mjs`, `output.mjs`, `src/domain/errors.mjs`, `protocol.mjs`, `tests/unit/cli-foundation.test.mjs`; modificar `package.json` com nome/bin/engines e descoberta recursiva de testes (`test: node --test`), mantendo `private: true`. O glob legado tests/*.test.mjs não cobre as novas subpastas; verificar que a suíte completa realmente descobre todos os testes.

**Testes/comandos futuros:** `node --test tests/unit/cli-foundation.test.mjs`; `node bin/peterson-carousel.mjs --help`; `node bin/peterson-carousel.mjs --version`. Testar envelope `protocolVersion/ok/data/error/nextAction`, stdout exclusivamente JSON, stderr separado, exit codes, argumento inválido e ausência de mutação. Sem import nativo antecipado.

**Concluída quando:** comando executável tem contrato versionado; ajuda funciona sem SQLite/sharp instalados. **Cobertura:** AC23, AC29, AC30.

### T03 — Preparar empacotamento mínimo seguro

**Depende de:** T02.

**Arquivos:** criar `scripts/build-release.mjs`, `scripts/audit-tarball.mjs`, `shared/defaults/brand.json`, `shared/defaults/themes.json`, `docs/cli.md`, `tests/distribution/minimal-package.test.mjs`; modificar `package.json`, `.gitignore`. Staging de release: `.release/package/`, sem dados reais.

**Testes/comandos futuros:** `node --test tests/distribution/minimal-package.test.mjs`; `node scripts/build-release.mjs`; `npm pack ./.release/package --dry-run --json`; gerar `.tgz` interno e auditar seus membros. `files` explícito, sem fontes, dados de marca, fotos, node_modules ou hook de instalação. A construção copia apenas lista autorizada; configurações pessoais legadas permanecem na origem.

**Concluída quando:** pacote mínimo executa help/version independentemente da origem e mantém trava de publicação. Tarball interno não é distribuído enquanto licenciamento estiver pendente. **Cobertura:** AC23, AC26, AC27, AC32.

### T04 — Confinar raízes, referências e slug

**Depende de:** T02.

**Arquivos:** criar `src/infrastructure/fs/workspace-paths.mjs`, `confined-path.mjs`, `src/domain/identifiers.mjs`, `tests/unit/paths.test.mjs`, `tests/windows/path-confinement.test.mjs`.

**Testes/comandos futuros:** `node --test tests/unit/paths.test.mjs`; no Windows, `node --test tests/windows/path-confinement.test.mjs`. Cobrir precedência da raiz, caminhos com espaços/acentos, separadores mistos, `..`, absolutos, URLs, UNC, junction/symlink, nomes reservados/ADS e `slug` malicioso. Revalidar ancestrais reais antes de acesso/promoção; limitar a garantia ao modelo local, sem alegar isolamento de processo hostil.

**Concluída quando:** entradas não escapam das raízes permitidas; consultas não criam paths. **Cobertura:** AC16, AC22, AC25.

### T05 — Criar schema e adaptador SQLite

**Depende de:** T01, T04.

**Arquivos:** criar `src/infrastructure/sqlite/database.mjs`, `migrations.mjs`, `migrations/001-initial.sql`, `src/infrastructure/sqlite/repositories.mjs`, `tests/integration/sqlite-schema.test.mjs`.

**Testes/comandos futuros:** `node --test tests/integration/sqlite-schema.test.mjs`. Criar as 12 entidades da seção 9.2; constraints de marca/revisão, vínculos brandId, versões e FK; incluir tabela técnica de coordenação de manutenção, pedidos de confirmação e limpeza retomável. Verificar pragmas por conexão e checksums de migração. Abrir consultas read-only; schema futuro impede leitura e escrita antes de consultas de domínio.

**Concluída quando:** workspace sintético inicializa explicitamente, constraints impedem referências cruzadas e ausência/versão errada têm erros tipados. **Cobertura:** AC01, AC04, AC28, AC30.

### T06 — Garantir transações, manutenção e idempotência

**Depende de:** T05.

**Arquivos:** criar `src/application/operation-runner.mjs`, `src/infrastructure/sqlite/maintenance.mjs`, `src/domain/canonical-json.mjs`, `tests/integration/operations.test.mjs`.

**Testes/comandos futuros:** `node --test tests/integration/operations.test.mjs`. Ordenação recursiva de chaves, arrays preservados, versão de canonização; commit de resultado/estado/eventos na mesma transação; replay e conflito; dois escritores; timeout de 5000 ms; lock de manutenção versus mutações. Reserva de arquivos pendente não é resultado confirmado.

**Concluída quando:** repetir solicitação não duplica efeitos, payload distinto conflita e falha antes de commit não retorna sucesso. **Cobertura:** AC14, AC18, AC28.

### T07 — Implementar armazenamento imutável de arquivos

**Depende de:** T04, T06.

**Arquivos:** criar `src/application/asset-store.mjs`, `src/infrastructure/fs/atomic-files.mjs`, `hash-file.mjs`, `tests/integration/asset-store.test.mjs`.

**Testes/comandos futuros:** `node --test tests/integration/asset-store.test.mjs`. Injetar falhas em escrita, fechamento, hash, promoção e commit; preservar original por bytes; metadados sem path de origem operacional; arquivo órfão isolado; retry só transitório, no máximo duas repetições, 500/1500 ms; hash/configuração/conteúdo não recebem retry automático.

**Concluída quando:** referência só aponta saída completa, e remoção da origem não afeta bytes gerenciados. **Cobertura:** AC02, AC11, AC12, AC16.

### T08 — Cadastrar marcas e revisões confirmadas

**Depende de:** T06, T07.

**Arquivos:** criar `src/application/brand-memory.mjs`, `src/interfaces/cli/human-confirmation.mjs`, `src/domain/brand-schema.mjs`, `tests/integration/brand-memory.test.mjs`, `tests/unit/human-confirmation.test.mjs`.

**Testes/comandos futuros:** `node --test tests/integration/brand-memory.test.mjs tests/unit/human-confirmation.test.mjs`. Create/get/list/update, revisão completa imutável, compare-and-swap, filtro brandId, origem `user-confirmed`/`legacy-import`; importação legada confirmada e idempotente, sem logo inventado nem overwrite posterior. Ajustes pontuais não criam revisão. Testar confirmação humana local, cancelamento e rejeição de flags/stdin automatizado.

**Concluída quando:** nova sessão recupera revisões e atualização concorrente conflita; persistência de preferências depende de confirmação específica. **Cobertura:** AC01, AC04, AC05, AC29.

### T09 — Importar e associar logos PNG

**Depende de:** T07, T08.

**Arquivos:** criar `src/application/logo-import.mjs`, `src/domain/logo-policy.mjs`, `tests/integration/logo-import.test.mjs`, `tests/fixtures/logos/README.md`; fixtures sintéticas geradas em teste.

**Testes/comandos futuros:** `node --test tests/integration/logo-import.test.mjs`. PNG real estático, máximo 10 MiB/4096 px por dimensão, rejeição de APNG, formato falso, corrupção e alpha totalmente invisível. Preservar bytes/hash, sem recorte/recolorização. Associação clara/escura/ambas confirmada; logo opaco permitido somente conforme superfície autorizada; habilitar sem variante inválido.

**Concluída quando:** cadastro devolve asset da própria marca e configuração utilizável sem reaprovar logo em cada peça. **Cobertura:** AC02, AC03, AC04, AC16.

### T10 — Resolver recursos e diagnóstico sem mutação

**Depende de:** T05, T08, T09.

**Arquivos:** criar `shared/resources.manifest.json`, `src/infrastructure/resources.mjs`, `src/application/workspace-inspect.mjs`, `src/application/doctor.mjs`, `tests/integration/doctor.test.mjs`.

**Testes/comandos futuros:** `node --test tests/integration/doctor.test.mjs`. Registrar três identificadores tipográficos existentes e hashes aprovados, raiz de fontes autorizada/read-only, identidade efetiva do runtime; testar dependência ausente, fonte ausente/divergente, pacote incompleto, plataforma incompatível, workspace inexistente e plugin não configurado.

**Concluída quando:** cadastro/consulta funcionam sem fontes quando SQLite está disponível, render bloqueia precisamente, help/doctor não quebram por import antecipado, nenhum recurso é substituído silenciosamente. **Cobertura:** AC19, AC23, AC26, AC30.

### T11 — Criar execuções e snapshots congelados

**Depende de:** T08, T09, T10.

**Arquivos:** criar `src/application/run-service.mjs`, `src/domain/run-snapshot.mjs`, `shared/run-snapshot.schema.json`, `tests/integration/run-snapshot.test.mjs`.

**Testes/comandos futuros:** `node --test tests/integration/run-snapshot.test.mjs`. Create/get/list/derive; snapshot completo conforme seção 3.3; revisão explícita; alteração da marca não muda execução anterior; `parentRunId` na derivada; reaproveitamento de material sem herdar consentimento; estado inicial draft; isolamento entre marcas.

**Concluída quando:** execução é reaberta com identidade original, derivada tem novo ID/aprovações pendentes, fontes são referências e hashes, não cópias. **Cobertura:** AC04, AC05, AC06, AC19.

### T12 — Versionar entradas e artefatos

**Depende de:** T07, T11.

**Arquivos:** criar `src/application/run-inputs.mjs`, `src/domain/artifact-fingerprints.mjs`, `tests/integration/run-inputs.test.mjs`.

**Testes/comandos futuros:** `node --test tests/integration/run-inputs.test.mjs`. Copiar carousel.json, conceito e assets explicitamente indicados; chamar validação estrutural existente via fronteira controlada; conservar versões; parciais continuam draft; ausência de conceito não é inferida como pronto; `approved:true` não produz consentimento. Fingerprints têm entradas/snapshot/executável e escopo por etapa.

**Concluída quando:** inputs só conclui com material completo e íntegro, versões antigas continuam consultáveis e não se misturam entre marcas. **Cobertura:** AC05, AC08, AC09, AC12, AC16.

### T13 — Modelar estados e etapas

**Depende de:** T11, T12.

**Arquivos:** criar `src/domain/run-state-machine.mjs`, `stage-graph.mjs`, `src/application/run-runtime.mjs`, `tests/unit/run-state-machine.test.mjs`.

**Testes/comandos futuros:** `node --test tests/unit/run-state-machine.test.mjs`. Exercitar tabela de estados da especificação, todas as transições permitidas/proibidas, sete etapas e estados das tentativas. Rejeição humana leva a blocked; completed/cancelled são terminais; editar entrada obrigatória pode voltar a draft.

**Concluída quando:** estado, pendência e próxima ação autorizada são determinísticos; repetir resume de completed só consulta. **Cobertura:** AC07, AC08, AC09, AC20.

### T14 — Coordenar leases e fencing tokens

**Depende de:** T06, T13.

**Arquivos:** criar `src/application/run-lease.mjs`, `src/infrastructure/clock.mjs`, `tests/integration/leases.test.mjs`, `tests/helpers/lease-worker.mjs`.

**Testes/comandos futuros:** `node --test tests/integration/leases.test.mjs`. Relógio injetável e processos reais; TTL 60 s/heartbeat 10 s; disputa simultânea; executor antigo após expiração; commit compara token/titular/lease; aquisição de manutenção e lease verificadas atomicamente; trabalho pesado fora da transação.

**Concluída quando:** só um executor pode confirmar e manutenção não começa entre checagem e aquisição de uma etapa. **Cobertura:** AC13, AC31 e consistência de AC18/AC28.

### T15 — Vincular aprovações aos objetos corretos

**Depende de:** T08, T12, T13, T14.

**Arquivos:** criar `src/application/approvals.mjs`, `src/domain/approval-policy.mjs`, `tests/integration/approvals.test.mjs`.

**Testes/comandos futuros:** `node --test tests/integration/approvals.test.mjs`. Solicitar/mostrar objeto, fingerprint, decisão, data e evidência; confirmação local pelo gateway humano, conferindo fingerprint novamente na transação; teste de mudança entre exibição e confirmação. Texto/conceito/assets separados; logo não conta como asset criativo; ausência de assets dá `not-applicable` sem pular conceito; migração de evidência da conversa exige nova confirmação.

**Concluída quando:** consentimento não é forjável pela API de modelo e persiste entre processos; objeto alterado gera `APPROVAL_STALE`/`APPROVAL_REQUIRED`. **Cobertura:** AC07, AC08, AC09, AC29.

### T16 — Aplicar invalidação seletiva

**Depende de:** T12, T14, T15.

**Arquivos:** criar `src/domain/invalidation.mjs`, `tests/integration/invalidation.test.mjs`; modificar `src/application/run-inputs.mjs`, `run-runtime.mjs`.

**Testes/comandos futuros:** `node --test tests/integration/invalidation.test.mjs`. Copy invalida copy e tudo depois; conceito preserva copy; asset preserva copy/conceito; falha de package preserva render/validate íntegros; nenhuma edição durante tentativa ativa; revisão mantém histórico sem anunciar saída antiga como atual.

**Concluída quando:** só etapas afetadas são refeitas e a cadeia de autorização sempre corresponde aos objetos vigentes. **Cobertura:** AC09, AC10, AC12.

### T17 — Separar interrupção de cancelamento terminal

**Depende de:** T14, T16.

**Arquivos:** criar `src/application/run-control.mjs`, `tests/integration/run-control.test.mjs`; modificar runtime e esquema de operações públicas.

**Testes/comandos futuros:** `node --test tests/integration/run-control.test.mjs`. `run.interrupt` revoga fencing token e lease, registra tentativa interrompida, sinaliza processo e deixa run interrupted para reconciliação; impedir commit atrasado mesmo se processo não morrer imediatamente. `run.cancel` termina em cancelled; continuar exige derive; repetir pedido com requestId é seguro.

**Concluída quando:** interromper permite retomar/editar após reconciliação, cancelar não reabre run terminal, parcial nunca vira entrega. **Cobertura:** AC11, AC13, AC20, AC31.

### T18 — Injetar contexto e fontes no renderer legado

**Depende de:** T10, T11; preservar baseline antes da alteração.

**Arquivos:** modificar `scripts/render-carousel.mjs`; criar `src/adapters/legacy/render-context.mjs`, `tests/regression/legacy-context.test.mjs`, `tests/fixtures/legacy/carousel.json`, `tests/fixtures/legacy/concept.md`, `tests/fixtures/legacy/README.md`.

**Testes/comandos futuros:** primeiro capturar fixture sintética homologável do legado; `node --test tests/regression/legacy-context.test.mjs`. Renderer passa a aceitar contexto opcional, mantém chamada legada sem contexto; usa resolvedor explícito de fontes no harness. Template já aceita brand/theme/fontData e será reutilizado. Comparar pixels decodificados e conteúdo, com os mesmos arquivos de recursos/hashes no mesmo runtime; não comparar metadados voláteis PNG/ZIP.

**Concluída quando:** logo desabilitado preserva baseline visual, globals pessoais não vazam para snapshot e fontes hardcoded não dominam contexto explícito. **Cobertura:** AC17, AC19, AC30.

### T19 — Adicionar slot de logo protegido

**Depende de:** T09, T18.

**Arquivos:** modificar `shared/templates/panorama.svg.js`; criar `src/adapters/legacy/logo-layout.mjs`, `tests/unit/logo-layout.test.mjs`, `tests/visual/logo-slot.test.mjs`.

**Testes/comandos futuros:** `node --test tests/unit/logo-layout.test.mjs tests/visual/logo-slot.test.mjs`. Caixa x756/y64/w240/h80, proteção interna 12 px, altura visível mínima 24 px; encaixe proporcional; temas claros/escuros; logo horizontal demais; interseção com conteúdo e continuidade; off não reserva área; assinatura textual preservada. Testes geométricos e inspeção visual documentada.

**Concluída quando:** variante incompatível bloqueia, layout não corta/deforma/recolore e ausência de conflito é confirmada visualmente. **Cobertura:** AC03, AC15, AC17.

### T20 — Executar render em tentativa isolada

**Depende de:** T14, T15, T16, T18, T19.

**Arquivos:** criar `src/adapters/legacy/render-adapter.mjs`, `src/application/stages/render-stage.mjs`, `tests/integration/render-stage.test.mjs`.

**Testes/comandos futuros:** `node --test tests/integration/render-stage.test.mjs`. Verificar autorizações, recursos, snapshot, paths/slug e compatibilidade antes do render; diretório exclusivo por attempt; manifesto de hashes; commit sob token; original do logo não copiado para entrega; tentativa repetida não sobrescreve anterior.

**Concluída quando:** render só usa snapshot e arquivos autorizados, e apenas saída íntegra da tentativa vigente é confirmada. **Cobertura:** AC02, AC03, AC08, AC11, AC13, AC19.

### T21 — Validar resultados renderizados

**Depende de:** T20.

**Arquivos:** criar `src/application/stages/validate-stage.mjs`, `src/adapters/legacy/validate-adapter.mjs`, `tests/integration/validate-stage.test.mjs`; ajustar `scripts/validate-carousel.mjs` apenas se exigido pela integração e coberto por regressão.

**Testes/comandos futuros:** `node --test tests/integration/validate-stage.test.mjs`. Contrato legado permanece; verificações pós-render de existência, contagem, dimensões 1080×1350, hashes, panorama, saídas esperadas e ausência de links externos. Não converter validade estrutural em consentimento.

**Concluída quando:** arquivo faltante/corrompido ou saída inesperada bloqueia validate com etapa identificada. **Cobertura:** AC12, AC17, AC20.

### T22 — Empacotar entrega sem dados privados

**Depende de:** T21.

**Arquivos:** criar `src/application/stages/package-stage.mjs`, `src/adapters/legacy/package-adapter.mjs`, `tests/integration/package-stage.test.mjs`; modificar `scripts/package-carousel.mjs` para destino explícito/confinado quando necessário.

**Testes/comandos futuros:** `node --test tests/integration/package-stage.test.mjs`. ZIP isolado inclui somente slides, panorama, legenda e referências; reabrir e conferir membros/hashes/CRC antes do commit; não incluir banco, eventos, config, logo original isolado, fontes ou staging. Slug adversarial não altera destino. Falha de ZIP não altera render/validate bem-sucedidos.

**Concluída quando:** entrega final tem manifesto verificado e completed só ocorre após confirmação válida. **Cobertura:** AC10, AC16, AC20, AC26.

### T23 — Retomar e reconciliar tentativas interrompidas

**Depende de:** T17, T20, T21, T22.

**Arquivos:** criar `src/application/reconcile-run.mjs`, `tests/integration/resume.test.mjs`, `tests/helpers/crash-worker.mjs`; integrar `run-runtime.mjs`.

**Testes/comandos futuros:** `node --test tests/integration/resume.test.mjs`. Encerrar processo nos pontos staging/escrita/promoção/antes e depois do commit; verificar manifests, fingerprint e hashes antes de reutilizar; órfãos não são sucesso; refazer só etapa necessária; package isolado reaproveita render/validate; completed retorna resultado sem novas tentativas.

**Concluída quando:** nova sessão continua da pendência correta, sem reaprovar objetos idênticos, duplicar entrega ou reutilizar bytes alterados. **Cobertura:** AC07, AC10, AC11, AC12, AC13, AC20.

### T24 — Capturar backup consistente

**Depende de:** T07, T14, T23.

**Arquivos:** criar `src/application/workspace-backup.mjs`, `src/domain/backup-manifest.mjs`, `tests/integration/backup.test.mjs`.

**Testes/comandos futuros:** `node --test tests/integration/backup.test.mjs`. Adquirir manutenção sem tentativa ativa, bloquear novas mutações/leases, usar API SQLite consistente e copiar todos os bytes referenciados; manifesto versionado com hashes; excluir fontes e dados não referenciados; falha libera manutenção/reconcilia sua posse sem publicar backup parcial.

**Concluída quando:** conjunto completo e verificável representa banco e arquivos da mesma janela, com concorrência testada. **Cobertura:** AC18, AC19, AC26.

### T25 — Restaurar em workspace novo

**Depende de:** T24.

**Arquivos:** criar `src/application/workspace-restore.mjs`, `tests/integration/restore.test.mjs`.

**Testes/comandos futuros:** `node --test tests/integration/restore.test.mjs`. Validar paths/membros antes de extrair, versão/schema, integridade SQLite/FK e hashes; rejeitar zip slip/junction, arquivo faltante e manifesto adulterado. Restaurar em diretório novo, preservar IDs/revisões/aprovações, reconfigurar fontes locais; runtime incompatível permite consulta compatível, bloqueia render; não substituir workspace ativo.

**Concluída quando:** restauração independente dos caminhos antigos retoma com runtime compatível e explicita bloqueio nos demais casos. **Cobertura:** AC16, AC18, AC19, AC28.

### T26 — Migrar explicitamente e bloquear downgrade

**Depende de:** T05, T24, T25.

**Arquivos:** criar `src/application/workspace-migrate.mjs`, `tests/integration/migrations.test.mjs`, `tests/fixtures/schema/README.md`; modificar runner de migrações.

**Testes/comandos futuros:** `node --test tests/integration/migrations.test.mjs`. Fixture de schema anterior, backup obrigatório, manutenção exclusiva, checksums, falha/rollback e reabertura; schema mais novo recusado por versão antiga inclusive leitura. Instalar pacote não chama migrate/init. Não inventar migrações de funcionalidades futuras só para preencher scaffold.

**Concluída quando:** upgrade controlado tem evidência recuperável e versão antiga nunca tenta downgrade destrutivo. **Cobertura:** AC18, AC25, AC27, AC28.

### T27 — Arquivar e excluir marca com segurança

**Depende de:** T08, T14, T24.

**Arquivos:** criar `src/application/brand-lifecycle.mjs`, `src/application/cleanup-jobs.mjs`, `tests/integration/brand-lifecycle.test.mjs`.

**Testes/comandos futuros:** `node --test tests/integration/brand-lifecycle.test.mjs`. Archive impede novas runs sem apagar existentes; purge mostra marca/runs afetadas, aviso sobre backups e confirmação destrutiva distinta. Recusar atividade concorrente; transação remove referências, limpeza posterior remove só arquivos exclusivos; interromper/recomeçar limpeza; resíduo apenas IDs técnicos/status, sem perfil/conteúdo.

**Concluída quando:** arquivamento preserva memória, purge é explícito e retomável, outras marcas e backups não são apagados. **Cobertura:** AC04, AC21, AC29.

### T28 — Expor o fluxo completo na CLI

**Depende de:** T02 e T08–T27.

**Arquivos:** criar `src/interfaces/cli/commands/brand.mjs`, `run.mjs`, `approval.mjs`, `workspace.mjs`, `doctor.mjs`, `src/application/create-services.mjs`, `tests/cli/public-commands.test.mjs`; atualizar `docs/cli.md`.

**Testes/comandos futuros:** `node --test tests/cli/public-commands.test.mjs`. Expor todas as operações da seção 11 e `run interrupt`; init é explícito/idempotente e não inventa cadastro. Mutações automatizadas exigem requestId; consultas read-only; confirmação local usa gateway, não campos livres. Testar --json, erros mínimos completos, nextAction, protocolo, stdout/stderr e fontes/dependências ausentes.

**Concluída quando:** usuário consegue realizar a cadeia pelo executável, com mensagens legíveis/JSON equivalentes e sem SQL nas interfaces. **Cobertura:** AC01, AC07, AC08, AC14, AC22, AC29, AC30.

### T29 — Integrar plugin e quatro skills

**Depende de:** T28.

**Arquivos:** criar `src/interfaces/plugin/cli-client.mjs`, `shared/plugin-runtime.schema.json`, `tests/integration/plugin-adapter.test.mjs`, `docs/plugin-integration.md`; modificar `.codex-plugin/plugin.json` e as quatro skills: `skills/peterson-carousel/SKILL.md`, `skills/peterson-carousel-copy/SKILL.md`, `skills/peterson-carousel-design/SKILL.md`, `skills/peterson-carousel-idea/SKILL.md`.

**Testes/comandos futuros:** `node --test tests/integration/plugin-adapter.test.mjs`. Configuração explícita de Node/entrypoint/versão/raiz, handshake de protocolo, argumentos separados com espaços/acentos, mesma memória; processo plugin versus CLI disputa lease. Skills consultam IDs, anexação e pendências; não editam SQLite, snapshot ou consentimento. Hospedeiro sem execução local retorna integração indisponível.

**Concluída quando:** adaptador isolado passa, alterações de skills mantêm preparo editorial e delegam controle persistente ao núcleo. Integração real ainda requer T33; nenhum registro automático de plugin. **Cobertura:** AC24, AC27, AC29, AC31.

### T30 — Exercitar falhas e segurança transversal

**Depende de:** T23, T25, T26, T27, T29.

**Arquivos:** criar `tests/acceptance/module-01.test.mjs`, `tests/integration/fault-matrix.test.mjs`, `tests/helpers/fault-points.mjs`, `docs/testing/fault-matrix.md`.

**Testes/comandos futuros:** `node --test tests/acceptance/module-01.test.mjs tests/integration/fault-matrix.test.mjs`; depois suíte completa `npm test` conforme scripts definidos. Encerrar processos reais, clocks injetados, contenção real SQLite e tentativas CLI/plugin. Cobrir logs saneados sem conversas completas, leitura cruzada, todos os checkpoints de arquivos, races de manutenção, consentimento stale e token revogado. Fault hooks são injeções de teste, não comando público para burlar controles.

**Concluída quando:** cenários determinísticos falham sem a proteção e passam com ela; limitações físicas de disco/energia documentadas, sem prometer exatamente-uma execução computacional. **Cobertura:** AC04, AC08–AC14, AC16, AC18, AC21, AC28, AC29, AC31.

### T31 — Auditar o tarball completo

**Depende de:** T03, T28, T29, T30.

**Arquivos:** modificar `scripts/build-release.mjs`, `scripts/audit-tarball.mjs`, `package.json`; gerar `npm-shrinkwrap.json`; criar `release-manifest.json`, `tests/distribution/release-package.test.mjs`, `docs/testing/release-report.md`.

**Testes/comandos futuros:** `npm shrinkwrap`; `node scripts/build-release.mjs`; `npm pack ./.release/package --dry-run --json`; `npm pack ./.release/package --json`; `node scripts/audit-tarball.mjs <tgz>`; `node --test tests/distribution/release-package.test.mjs`. Capturar nome/checksum retornados, sem presumir path. Auditar lista real, arquivos ocultos, exemplos, docs, dependências/scripts e ausência de qualquer fonte/privado. Manifesto identifica motor/dependências/recursos, matriz e protocolo.

**Concluída quando:** tarball interno contém tudo para executar e nada proibido; `private:true` permanece. Não distribuir enquanto ATTRIBUTION/licença não estiverem liberados; relatório deve explicitar essa condição. **Cobertura:** AC23, AC26, AC27, AC32.

### T32 — Testar npm e npx em Windows limpo

**Depende de:** T31 e Windows limpo autorizado; para transferência a outro destinatário/serviço, liberação de redistribuição prévia.

**Arquivos:** criar `tests/windows/npm-install.ps1`, `tests/windows/memory-survival.ps1`, `docs/testing/windows-distribution.md`.

**Testes/comandos futuros, em sandbox:** `npm install -g <caminho-absoluto-do-tgz> --prefix <prefixo-isolado>`; chamar o `.cmd` instalado pelo caminho completo; `npx --yes --package <caminho-absoluto-do-tgz> peterson-carousel --version`; repetir doctor/consultas com mesma raiz; `npm uninstall -g @pb/carousel-harness --prefix <prefixo-isolado>`; remover somente cache npx dedicado e reinstalar. `--yes` aqui é do npx para aquisição do pacote, nunca consentimento do harness.

Testar fora do repositório e sem dependências de desenvolvimento; recursos configurados explicitamente; caminhos com espaços/acentos; comparar memória/hashes antes/depois. Instalação não inicializa, migra ou registra plugin. Testar versão anterior contra schema posterior e dependência/fonte ausente.

**Concluída quando:** instalação e uso global/npx são demonstrados pelo tarball real, memória sobrevive a uninstall/cache/CWD e scripts nativos respeitam política homologada. **Cobertura:** AC22–AC30.

### T33 — Demonstrar produção e integração no Windows

**Depende de:** T32, T29 e hospedeiro de plugin acessível/autorizado.

**Arquivos:** criar `docs/testing/windows-demo.md`, `docs/testing/visual-review.md`; evidências sintéticas em diretório de testes não incluído no release.

**Verificações futuras:** usar CLI instalada para cadastrar duas marcas/logo, preparar inputs e aprovar copy/conceito/assets por interação humana; encerrar processo, reabrir, retomar e entregar ZIP; atualizar marca, comprovar snapshot anterior e derivação sem aprovação herdada. Mostrar falha de package, recuperação, backup/restore, colisão CLI/plugin e completed sem nova geração. Inspecionar visualmente proporção/logo/rodapé/overlays; registrar comandos, versões, hashes e resultados reais.

**Concluída quando:** cadeia principal e integração efetiva têm evidência Windows. Se hospedeiro não executar runtime, registrar bloqueio e não anunciar plugin integrado; se houver só adaptador isolado, declarar exatamente isso. **Cobertura:** AC01–AC07, AC10, AC15, AC17–AC24, AC31.

### T34 — Consolidar aceite e entrega autorizada

**Depende de:** T30–T33 e resolução explícita do gate jurídico/distribuição para compartilhar o pacote.

**Arquivos:** criar `docs/release/module-01-acceptance.md`, `docs/release/distribution-gates.md`; finalizar README/documentação do pacote e `docs/plans/module-01/PROGRESSO.md`.

**Verificações futuras:** executar suíte final e auditoria do mesmo tarball identificado por checksum; preencher matriz AC com evidências/limitações; conferir ausência de publicação/push externo; revisar autorização/licença antes de qualquer envio. Nenhuma execução de `npm publish`, mudança de private/visibilidade, criação de conta/plano ou push remoto faz parte da tarefa.

**Concluída quando:** implementação, documentação, testes, preservação de memória, artefato instalado e demonstração Windows estão comprovados; diferenças entre teste isolado e integração real estão claras. Se distribuição estiver bloqueada, entregar apenas o relatório autorizado e declarar produto tecnicamente validado mas distribuição pendente, sem marcar entrega integral como concluída. **Cobertura:** todos os AC, especialmente AC26/AC32.

## 6. Matriz de rastreabilidade AC01–AC32

| AC | Tarefas responsáveis | Evidência mínima de aceite |
|---|---|---|
| AC01 | T05, T08, T28, T33 | Novo processo lê mesma marca/revisão |
| AC02 | T07, T09, T20, T33 | Origem removida, logo gerenciado renderiza com hash original |
| AC03 | T09, T19, T20 | Tema sem variante produz LOGO_VARIANT_MISSING |
| AC04 | T05, T08, T11, T27, T30 | Duas marcas isoladas, inclusive IDs cruzados e purge |
| AC05 | T08, T11, T12 | Override de run não altera marca/nova execução |
| AC06 | T11, T33 | Revisão antiga congelada; nova/derivada explícita |
| AC07 | T13, T15, T23, T28, T33 | Aprovações idênticas preservadas entre processos |
| AC08 | T12, T13, T15, T20, T30 | approved:true nunca basta; render não inicia |
| AC09 | T12, T15, T16, T30 | Copy nova invalida aprovação e etapas dependentes |
| AC10 | T16, T22, T23, T33 | Só package repete, com contadores e hashes de render/validate |
| AC11 | T07, T17, T20, T23, T30 | Kill antes do commit não publica parcial |
| AC12 | T07, T12, T16, T21, T23 | Remoção/tamper identificado antes de reuse |
| AC13 | T14, T17, T20, T23, T30 | Processo atrasado não confirma token vencido/revogado |
| AC14 | T06, T28, T30 | Replay idêntico; conflito para payload distinto |
| AC15 | T19, T33 | Geometria e inspeção visual, logo horizontal/overlap rejeitados |
| AC16 | T04, T07, T09, T12, T22, T25, T30 | PNG inválido, slug/path/junction/ZIP maliciosos recusados |
| AC17 | T18, T19, T21, T33 | Pixels/conteúdo legado equivalentes com recursos idênticos |
| AC18 | T24, T25, T26, T30, T33 | Backup/restore retoma IDs/consentimentos em raiz nova |
| AC19 | T10, T11, T18, T20, T25, T33 | Runtime/font mismatch bloqueia render, sem promessa falsa |
| AC20 | T13, T17, T21, T22, T23, T33 | ZIP verificado, dimensões e completed sem regeneração |
| AC21 | T27, T30 | Archive preserva; purge confirmado, retomável, aviso backups |
| AC22 | T01, T04, T28, T32, T33 | Relatório de execução real em Windows/espaços/acentos |
| AC23 | T01–T03, T10, T31, T32 | Tarball em Windows limpo, global e npx sem origem |
| AC24 | T29, T32, T33 | Mesma raiz/IDs nos três canais, com nível de integração declarado |
| AC25 | T04, T26, T32 | Uninstall/cache/CWD não apagam memória |
| AC26 | T03, T10, T22, T24, T31, T34 | Lista real do ZIP/tgz e exclusões verificadas |
| AC27 | T03, T26, T29, T31, T32 | Instalação não inicializa/migra/registra plugin |
| AC28 | T05, T26, T30, T32 | Schema futuro recusado inclusive leitura, sem downgrade |
| AC29 | T02, T08, T15, T27–T30 | JSON válido, diagnóstico separado, automatização não confirma |
| AC30 | T01, T02, T10, T18, T28, T32 | Ausências diagnosticadas; consulta possível quando suficiente |
| AC31 | T14, T17, T29, T30, T33 | Corrida CLI/plugin gera uma única confirmação válida |
| AC32 | T00, T03, T31, T34 | Artefato local/relatório; nenhum publish/push/exposição sem autorização |

Cobertura adicional das clarificações: T17 testa interrupt versus cancel; T18 exige recursos idênticos; T04/T22 testam slug; T00/T03/T31/T34 guardam redistribuição; T03/T29/T32 impedem hook de registro automático.

## 7. Critério de conclusão e bloqueios legítimos

O Módulo 01 termina quando todos os AC têm evidência, o fluxo legado mantém a baseline aprovada, a CLI funciona a partir do tarball em Windows limpo e o usuário consegue fechar/reabrir/retomar com identidade e consentimentos persistidos. Gerar um tarball não prova instalação; testar adaptador não prova integração no hospedeiro; testes Linux não provam Windows; spec/plano não provam implementação.

Bloqueios que devem ser relatados, sem contornar:

- Sem Windows disponível: não congelar qualificação nem anunciar aceite de instalação/render.
- Sem fontes autorizadas correspondentes: não redistribuir nem substituir; testes visuais/render ficam pendentes.
- Sem capacidade local no hospedeiro: CLI pode avançar, integração real do plugin permanece pendente.
- Sem liberação da adaptação upstream: manter artefatos restritos ao trabalho local autorizado, não enviar código/tarball/plugin a terceiros ou repositório público.
- Sem direito ao escopo `@pb`: não trocar nome nem contratar plano; isso bloqueia futura publicação, não o nome e teste local do pacote.

Publicação futura exigiria autorização própria de registry, visibilidade, nome, versão e licença, além de liberação upstream; não está incluída aqui. Nenhuma tarefa implementa módulos posteriores.

**Próximo passo:** revisar/aprovar este plano. A aprovação libera T00; depois de sua conclusão e apresentação das evidências, aguardar a liberação da tarefa seguinte, salvo lote explicitamente autorizado.
