# T01 — homologação do runtime nativo (Windows)

Data da execução: 2026-10-16. Escopo: qualificação isolada com dados sintéticos. O workspace original estava vazio; não havia `AGENTS.md` nele nem nos diretórios pais verificados. Nenhum código legado foi copiado e o repositório remoto não foi alterado.

## Matriz observada

| Item | Candidato / baseline | Resultado neste computador |
| --- | --- | --- |
| Windows | x64 | `Microsoft Windows NT 10.0.26200.0`, sistema e processo x64; PowerShell 7.6.5 |
| Node instalado previamente | — | v24.14.0, preservado em `C:\Program Files\nodejs\node.exe` |
| npm instalado previamente | — | 11.5.1, preservado |
| Node portátil oficial | 24.21.0 LTS | **Aprovado**: v24.21.0, `win32/x64`, ABI `137`, N-API `10` |
| npm embutido no Node portátil | 11.19.0 | **Aprovado**: 11.19.0 |
| better-sqlite3 | 13.0.3 | **Aprovado**: prebuild `prebuilds/win32-x64.node` carregado; SQLite 3.53.4 |
| sharp | 0.34.5 | **Aprovado**: `@img/sharp-win32-x64/lib/sharp-win32-x64.node` e DLLs libvips carregados; libvips 8.17.3 |
| fontkit | 2.0.4 | Import ESM aprovado com exports nomeados (`import * as fontkit`); `openSync` disponível. Sem validação de uma fonte real. |
| archiver | 7.0.1 | Import ESM aprovado; fábrica disponível. Sem geração de arquivo ZIP nesta T01. |

O ZIP `node-v24.21.0-win-x64.zip` veio de `https://nodejs.org/dist/v24.21.0/` e coincidiu com o `SHASUMS256.txt` oficial: SHA256 `158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541`. Foi extraído apenas em `vendor/`, sem instalador global nem mudança permanente de `PATH`.

## Verificações executadas

`tests/qualification/native-runtime.test.mjs` é executado como módulo ESM com o `node.exe` portátil. Resultado final: **2 testes passaram, 0 falharam**.

| Área | Evidência do teste |
| --- | --- |
| SQLite nativo | Criação de banco em arquivo e tabelas relacionadas com o addon Windows x64. |
| Pragmas por conexão | `journal_mode=DELETE`, `synchronous=FULL` (`2`), `busy_timeout=5000`, `foreign_keys=ON` (`1`) definidos e lidos na conexão inicial, na reabertura do banco e na abertura do backup. |
| Transações | Inserção com commit persiste; erro intencional provoca rollback sem persistir a linha. Chave estrangeira inválida falha na conexão inicial e nas conexões reabertas. |
| Backup | `db.backup()` cria banco íntegro; linha inserida depois do backup aparece apenas no banco primário. Ambos reabrem e respondem `PRAGMA integrity_check = ok`. |
| PNG | `sharp` codifica pixels RGBA sintéticos 2×2; assinatura PNG, formato, dimensões, canais e bytes decodificados conferem. |

O primeiro teste revelou que `fontkit@2.0.4` não fornece export `default` em ESM; a qualificação usa os exports nomeados. Uma asserção inicial sobre `metadata.pages` também foi removida porque esse campo é indefinido para este PNG simples. Após essas correções no teste, a execução passou.

## Comandos e política npm

Os comandos abaixo registram as operações materiais realmente realizadas no PowerShell, a partir de `t01-native-runtime/` (com `$runtime` apontando para `vendor\node-v24.21.0-win-x64`). Também foram executadas consultas de ambiente e de configuração, `npm ls --depth=0` e inspeções de arquivos nativos.

```powershell
node --version
npm --version
npm config get ignore-scripts
npm config get omit
npm config get optional
npm config get offline
npm config get audit
npm config get fund

Invoke-WebRequest -Uri 'https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip' -OutFile 'vendor/node-v24.21.0-win-x64.zip'
Invoke-WebRequest -Uri 'https://nodejs.org/dist/v24.21.0/SHASUMS256.txt' -OutFile 'vendor/SHASUMS256.txt'
Get-FileHash 'vendor/node-v24.21.0-win-x64.zip' -Algorithm SHA256
Expand-Archive -LiteralPath 'vendor/node-v24.21.0-win-x64.zip' -DestinationPath 'vendor'
& 'vendor/node-v24.21.0-win-x64/node.exe' --version
& 'vendor/node-v24.21.0-win-x64/node.exe' 'vendor/node-v24.21.0-win-x64/node_modules/npm/bin/npm-cli.js' --version

$env:npm_config_userconfig = Join-Path (Get-Location) 'vendor/empty-user-config'
$env:npm_config_globalconfig = Join-Path (Get-Location) 'vendor/empty-global-config'
$env:npm_config_cache = Join-Path (Get-Location) '.npm-cache'
$env:npm_config_registry = 'https://registry.npmjs.org/'
& 'vendor/node-v24.21.0-win-x64/node.exe' 'vendor/node-v24.21.0-win-x64/node_modules/npm/bin/npm-cli.js' install --ignore-scripts --include=optional --no-audit --no-fund --save-exact
& 'vendor/node-v24.21.0-win-x64/node.exe' 'vendor/node-v24.21.0-win-x64/node_modules/npm/bin/npm-cli.js' ls --depth=0
& 'vendor/node-v24.21.0-win-x64/node.exe' --test tests/qualification/native-runtime.test.mjs
```

A primeira tentativa de `Invoke-WebRequest` no shell restrito falhou por resolução de nome; a repetição com permissão de rede concluiu e o hash foi conferido antes da extração. O comando de instalação baixou 105 pacotes em 17 segundos e avisou sobre `glob@10.5.0` depreciado como dependência transitiva. Não foi feita atualização silenciosa. `package-lock.json` é lockfile v3, inclui 130 entradas de pacote (incluindo variantes opcionais de plataforma) e fixa os quatro pacotes diretos nas versões da matriz.

Configurações consultadas: `ignore-scripts=false`, `omit` vazio, `optional=null`, `offline=false`, `audit=true`, `fund=true`. A instalação sobrescreveu apenas para este comando: `--ignore-scripts`, `--include=optional`, `--no-audit`, `--no-fund`, `--save-exact`. Foram apontados arquivos de configuração de usuário/global inexistentes dentro de `vendor/` para não ler `.npmrc` pessoal; o cache também ficou local. Nenhum script de instalação foi executado. Ambos os addons nativos estavam presentes como binários pré-compilados para Windows x64 e carregaram com sucesso; **não houve necessidade de compilador** nesta execução. A política de scripts pode ser reavaliada se outra plataforma ou versão exigir build nativo.

## Limite da conclusão

Esta T01 homologa as versões listadas e os comportamentos SQLite/PNG acima neste computador Windows x64. Não valida o renderer completo, o produto, fluxos `npm`/`npx` do projeto nem plugin; eles ainda não foram implementados. Não cobre fontes pessoais, layout de carrossel, ZIP final, outros sistemas operacionais ou distribuição do código legado.

## Fontes de referência

- [Node 24.21.0 LTS](https://nodejs.org/en/blog/release/v24.21.0)
- [npm embutido no Node 24.21.0](https://raw.githubusercontent.com/nodejs/node/v24.21.0/deps/npm/package.json)
- [better-sqlite3 13.0.3: manifesto](https://raw.githubusercontent.com/WiseLibs/better-sqlite3/v13.0.3/package.json) e [API de backup](https://raw.githubusercontent.com/WiseLibs/better-sqlite3/v13.0.3/docs/api.md)
- [sharp: instalação e prebuilds Windows x64](https://sharp.pixelplumbing.com/install/)

## Nota de categorização na T02

O arquivo recebido e executado nesta T01 chamava-se `tests/qualification/native-runtime.test.mjs`. Na T02, foi renomeado, sem alteração de bytes, para `tests/qualification/native-runtime.qualification.mjs`. Para repetir a qualificação no sandbox Windows com suas dependências instaladas, usar `node --test tests/qualification/native-runtime.qualification.mjs` (ou `npm run test:qualification` no manifesto de produto atualizado). Os comandos acima permanecem como registro histórico da execução original.

`npm test` executa recursivamente os testes portáveis de produto; a qualificação nativa continua uma verificação separada e obrigatória no ambiente da matriz. O nome diferente impede que descoberta automática tente carregar addons ausentes em outros ambientes. Não houve troca por teste ignorado nem relaxamento das asserções Windows x64/Node v24.21.0.
