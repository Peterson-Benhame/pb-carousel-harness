# T10 — Recursos e diagnóstico somente leitura

> Cópia pública sanitizada: registros privados de conversa e execução foram omitidos. Estados e resultados técnicos abaixo descrevem a etapa original, não uma certificação da versão atual.

Execução local: 16/10/2026. Escopo aprovado: T10, sobre HEAD `da56524`, branch `feat/module-01-brand-runtime`.

## Resultado observado

- `node --test tests/integration/doctor.test.mjs`: **25/25**, zero falhas/cancelados/ignorados, 1809.1587 ms.
- `npm test`: **153/153**, zero falhas/cancelados/ignorados, 8151.862133 ms.
- `git diff --check`: limpo.
- Runtime efetivo local: Linux x64, Node v24.19.0, npm 11.9.0; better-sqlite3 13.0.3 / SQLite 3.53.4; sharp 0.34.5 / libvips 8.17.3; fontkit 2.0.4; archiver 7.0.1. Dependências previamente instaladas, sem instalação nesta tarefa.
- Qualificação Windows desta T10 concluída: **25/25**, zero falhas, saída 0, 8160.9163 ms; detalhes e histórico de correção ao final. Não representa renderização real nem homologação integral do produto.

## API interna e limite de prontidão

`runDoctor(options)` em `src/application/doctor.mjs` retorna identidade efetiva, workspace, recursos, diagnósticos, `readiness` e `renderBlockers`. `inspectWorkspace(options)` abre SQLite readonly, verifica schema e consulta configuração. `resolveResources({fontRoot, manifest})` verifica bytes sob a raiz explicitamente autorizada. `loadResourcesManifest()` carrega o manifesto do pacote. Sem import antecipado de dependências nativas.

Opções de integração: `dataDir`/`env`/`cwd` seguem o resolvedor T04; `fontRoot` explícita prevalece sobre `workspace_settings.authorized_font_directory`; ausência das duas nunca busca fontes no repositório ou sistema. `packageRoot` identifica o pacote a inspecionar. `expectedRuntime`, quando fornecido pelo futuro adaptador, é comparado à identidade completa canonizada. `manifest` e `dependencyProbe` são fronteiras internas de injeção usadas por testes; não são flags CLI nem uma API pública autorizadora.

`readiness.query` informa abertura readonly de memória compatível. `readiness.register` exige também pacote completo e runtime compatível com a matriz registrada. Fontes ausentes não impedem cadastro/consulta no runtime compatível quando SQLite está disponível. Os serviços T08 continuam APIs internas: a recusa antes de mutações na CLI pertence à T28.

`readiness.renderPrerequisites` significa exclusivamente que os pré-requisitos diagnosticados foram satisfeitos. Não afirma que o renderer foi chamado, que o adaptador T18 existe ou que fontes/layout reais foram homologados. `renderBlockers` exclui apenas o diagnóstico independente de plugin. O plugin sem configuração produz `PLUGIN_UNCONFIGURED`; configuração fornecida produz `PLUGIN_UNVERIFIED`, nunca integração presumida. `readiness.plugin` permanece falso até integração real futura.

Nenhum comando público `peterson-carousel doctor` foi adicionado. CLI/help preservam o contrato T02. O diagnóstico é executável pela API, como exercitado pela suíte; exposição CLI pertence à T28. Este trabalho não implementa runs/snapshots T11, adaptador/render T18, handshake T29 ou homologação completa T33.

## Recursos e identidade

Manifesto `shared/resources.manifest.json` registra os três identificadores existentes e SHA-256 calculados dos arquivos originais preservados em `assets/fonts/`, sem copiar seus bytes:

| Identificador | Arquivo original | SHA-256 |
| --- | --- | --- |
| Anton | Anton-Regular.ttf | a4ba3a92350ebb031da0cb47630ac49eb265082ca1bc0450442f4a83ab947cab |
| Manrope | Manrope-VariableFont_wght.ttf | d0639be45d0af36e798172419d7bd173c4bd4f29e2b76cbb69db1d11bf8b0a40 |
| JetBrains Mono | JetBrainsMono-VariableFont_wght.ttf | 48715a42ec242c21e9f02692891e147d022299a52e48d5e413e1a942193ffeda |

Comando local de conferência: `sha256sum assets/fonts/*.ttf`. Isso comprova correspondência da baseline de bytes, não licença para redistribuição nem qualificação de parsing/layout. Nenhum binário de fonte foi adicionado ao manifesto de distribuição, copiado para workspace, anexado a bundle Windows ou empacotado nesta tarefa.

A matriz diagnóstica usa a homologação T01: Windows x64, Node v24.21.0, ABI 137, dependências diretas fixadas, SQLite 3.53.4 e libvips 8.17.3. A identidade efetiva inclui Node/plataforma/arquitetura/ABI/N-API, nome/versão do pacote, versões carregadas das dependências, motores reais SQLite/libvips, mapa completo `sharp.versions`, hashes do renderer/template/validador e hashes efetivamente encontrados das fontes. Caminhos de instalação/cache/workspace/fontes não compõem essa identidade. Comparação com identidade esperada detecta diferenças adicionais de motores/dependências.

Presença dos arquivos obrigatórios é verificada; os hashes de código registram identidade efetiva, não assinatura de segurança contra modificação maliciosa do pacote. A lista é requisito interno T10, não ampliação da allowlist de release T03/T31. O renderer legado ainda lê `shared/brand.json` e `shared/themes.json`; esses dados não foram promovidos a requisitos redistribuíveis. A adaptação para contexto explícito permanece T18.

## Evidência de testes e TDD

1. Red inicial: módulo `doctor.mjs` ainda ausente. Implementação mínima levou a 15/15.
2. Red específico de motor nativo: npm versions iguais e SQLite/libvips divergentes não bloqueavam; comparação da matriz corrigida, 22/22.
3. Revisão: ausência de SQLite eliminava a raiz do relatório. Regressão red → resolução pura independente → 23/23.
4. Revisão: plataforma incompatível anunciava cadastro pronto; manifesto não incluía executável/validador transitivo. Regressões red → prontidão corrigida e presença/hash do validador → 25/25.
5. Renomeação de prontidão para `renderPrerequisites` deixa explícito o escopo. Focal e suíte completa repetidas e aprovadas.

Cobertura: raiz ausente preservada; hashes/lista de arquivos antes/depois de diagnóstico; SQLite real readonly/configuração/schema futuro; cadastro real confirmado por interação de terminal simulada; fontes ausentes/divergentes; fonte fora do formato de referência permitida; pacote incompleto; plataforma/motores incompatíveis; identidade independente de paths; configuração persistida da raiz; dependências faltantes sem mensagens internas; importação de help/doctor sem native eager import.

Testes positivos de recursos usam **bytes sintéticos que não são fontes**, com manifesto sintético e hashes correspondentes, criados somente nas fixtures temporárias. O teste positivo de pré-requisitos também adapta explicitamente a matriz sintética ao runtime em execução; ele não qualifica Linux nem os bytes como fontes. A verificação dos hashes originais é separada e não integra a suíte Windows portátil.

Ausência de dependência é exercitada por fault injection da função de probe e por loader ESM que recusa os quatro pacotes em um processo filho real. Isso demonstra tratamento de falhas controladas; não equivale à remoção física de addons. Probes normais usam SQLite nativo real `:memory:` e sharp real com PNG sintético 1×1; fontkit/archiver têm sua interface carregada verificada. Nenhuma fonte real é aberta no teste e nenhum ZIP é gerado.

## Segurança, efeitos e pendências

- Inspeções não inicializam, migram, reparam, registram plugin, atualizam configurações ou copiam recursos. Raiz inválida/arquivo inacessível não causa busca alternativa.
- Confinamento reutiliza T04: rejeita referências inseguras e links/junctions. Persiste o limite local documentado de TOCTOU contra processos concorrentes hostis.
- Nenhum install/global/npm publish/push/commit; nenhuma alteração de dependências ou schema nesta execução.
- Gates de licença/redistribuição permanecem. Auditoria do tarball completo e instalação npm/npx continuam T31/T32.
- Revisão final independente aceita: 25/25 focais e 153/153 completos, diff limpo. Coordenador reconfirmou 153/153. Resultado Windows deve ser anexado pelo coordenador; não presumido neste relatório.

## Portabilidade de testes Windows — correção após primeira execução

O coordenador reportou em 16/10/2026 dois resultados Windows do mesmo código: 25 testes, 22 passaram, 3 falharam, zero ignorados, saída 1. No sandbox: 27128.1064 ms; repetição autorizada fora do sandbox: 5256.5081 ms. A repetição não resolveu as falhas e não foi tratada como sucesso ou contorno de restrição.

As falhas eram da fixture/test harness: cleanup de diretório registrado antes do fechamento da conexão SQLite causou EBUSY no Windows; dois processos filhos receberam caminho absoluto Windows no `--experimental-loader`, interpretado como URL de protocolo `c:` e recusado com ERR_UNSUPPORTED_ESM_URL_SCHEME. Correção somente em testes: todas as conexões das fixtures ficam registradas para fechamento antes da remoção; caminhos de loader passam por `pathToFileURL(...).href`. Nenhuma mudança de produto.

Antes/depois das primeiras execuções, os 38 hashes correspondiam ao bundle JSON `1cc3c297571eb2e7917814be94f97d862c00b2aaf6799ff1a6f270a331af5686`. A correção foi preparada como delta de um único arquivo (`tests/integration/doctor.test.mjs`), JSON SHA-256 `db136d019569dd8b6d661e3d94f466c5f9a44a9674f999eb93bae40ff4841f71`, hash do teste `1d85b8fff1c5864c9d74b638bb057f21883c0a3dd4faa0fe167a79a8551a1fc0`.

Reverificação Linux após a correção: focal **25/25**, 1688.108491 ms; suíte **153/153**, 8147.662016 ms; zero falhas/cancelados/ignorados; diff limpo. Nova execução Windows pendente neste registro.

## Resultado final Windows — 16/10/2026

Delta JSON `db136d019569dd8b6d661e3d94f466c5f9a44a9674f999eb93bae40ff4841f71` conferido no Windows; hash final do teste `1d85b8fff1c5864c9d74b638bb057f21883c0a3dd4faa0fe167a79a8551a1fc0` reconferido após execução, outros 37 arquivos inalterados. Reconferência local dos 38 hashes finais em 16/10/2026, 15:31 UTC: todos correspondem ao manifesto final.

T10 concluída no escopo aprovado. Mantêm-se a separação entre bytes sintéticos e fontes reais, pré-requisitos e render executado, API interna e CLI pública, teste isolado e integração efetiva. Nenhum produto/fonte foi alterado para corrigir a execução Windows. T11 aguarda autorização própria. Nenhum commit por este executor; eventual commit do coordenador constará do Git. Sem instalação, push ou publicação.
