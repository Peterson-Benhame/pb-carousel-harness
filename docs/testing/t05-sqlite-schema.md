# T05 — Schema e adaptador SQLite

> Cópia pública sanitizada: registros privados de conversa e execução foram omitidos. Estados e resultados técnicos abaixo descrevem a etapa original, não uma certificação da versão atual.

Execução em 16/10/2026. Escopo autorizado: T05; sem implementação de T06 ou posteriores, sem commit, push ou publicação.

## Evidência observada

- Ambiente local: Linux x64, Node v24.19.0, npm 11.9.0. Estes testes não homologam Windows nem ampliam a matriz de T01.
- Red: `node --test tests/integration/sqlite-schema.test.mjs` falhou com `ERR_MODULE_NOT_FOUND` para `database.mjs`, antes de sua implementação.
- Green: o mesmo comando passou inicialmente 7/7; após ampliação da cobertura, 13/13 testes passaram, sem mocks ou skips, usando better-sqlite3 e arquivos SQLite reais em diretórios sintéticos temporários.
- `npm test`: 62 testes passaram, 0 falharam, 0 ignorados. Inclui 49 testes anteriores e 13 de T05.
- Teste em subprocesso Node novo confirmou a leitura da mesma revisão persistida, via conexão somente leitura.
- Windows Node 24.21.0/better-sqlite3 13.0.3: primeiro bundle 3/11 passaram e versão com recuperação de init 5/13 passaram; 8 falhas em ambos eram EBUSY no teardown da fixture, que removia arquivos antes de fechar conexões. Corrigido somente o teste: um hook de cleanup ordenado fecha todas as conexões e depois remove o sandbox. Linux reconfirmou 13/13; repetição Windows do bundle corrigido aprovada: 13/13, saída 0, 1064.9995 ms, sem EBUSY. Nenhum teste foi ignorado ou relaxado.

## Instalação local necessária

Comando efetivamente executado na raiz do projeto:

```sh
npm install --save-exact --ignore-scripts --include=optional --no-audit --no-fund --registry=https://registry.npmjs.org/ --cache=/tmp/t05-npm-cache --userconfig=/tmp/t05-empty-user-config --globalconfig=/tmp/t05-empty-global-config better-sqlite3@13.0.3
```

Foram instalados 108 pacotes locais. Nenhum script de instalação nem compilador foi executado; o addon pré-compilado carregou. Manifesto e lock ganharam better-sqlite3 13.0.3 e o lock ganhou node-addon-api 8.9.2. A comparação de todas as versões anteriormente presentes no lock confirmou zero alterações. Nenhuma instalação global, atualização incidental ou leitura de configuração pessoal npm foi necessária. Avisos observados: engine local 24.19.0 difere de 24.21.0 homologado; configuração de ambiente http-proxy; glob 10.5.0 legado depreciado; sugestão de nova versão npm não executada.

## Contrato implementado

- `initializeWorkspace(root)` é explícito e não cria marca, revisão, recurso ou consentimento. Banco existente é apenas validado/aberto; nunca migrado automaticamente. Criação de schema e registro de checksum ocorrem na mesma transação imediata.
- `openWorkspace(root)` usa modo somente leitura por padrão e `fileMustExist`. Falta de workspace produz `WORKSPACE_NOT_INITIALIZED` sem criar diretórios/arquivos. Escrita interna exige `{ readonly: false }` explícito.
- Driver nativo é importado apenas quando a abertura é necessária. Falha de import/carregamento nativo é `SQLITE_UNAVAILABLE`. Erros públicos não incluem caminho privado ou mensagem nativa.
- Guard de T04 revalida a raiz, ancestrais e caminho do banco antes do acesso. Mantém o limite conhecido contra troca hostil concorrente de arquivos.
- Cada conexão valida `journal_mode=DELETE`, define/verifica `synchronous=FULL`, `busy_timeout=5000` e `foreign_keys=ON`. Uma consulta não converte um banco WAL para DELETE: configuração incompatível é recusada.
- `user_version` é consultado antes de tabelas de domínio; versão futura bloqueia leitura, escrita e init. Versão anterior requer migração explícita. Histórico de migração deve corresponder à versão/nome/checksum SHA-256 do SQL distribuído. Repositórios verificam novamente o schema antes de consultar domínio.
- Conexão SQLite retornada é infraestrutura interna, não API de serviço/autorização. SQL e métodos mutáveis não foram expostos pela CLI/plugin.
- 12 entidades da especificação e 3 tabelas técnicas: coordenação de manutenção singleton; solicitações de confirmação; limpeza retomável com apenas IDs técnicos, tipo de recurso e estado, sobrevivendo à remoção dos IDs de domínio.
- Tabelas STRICT, versões positivas, fencing não negativo, lease com titular/expiração pareados, unicidade de revisão/artefato/etapa/tentativa. FKs compostas vinculam marca, execução e filhos, impedindo associação entre marcas ou entre execuções distintas. Revisões, metadados de assets/artefatos e identidade/snapshot da execução rejeitam UPDATE.
- Repositórios de leitura recebem marca explicitamente para resolver revisões/assets/runs/artefatos; IDs válidos de outra marca retornam null. A configuração JSON não é interpretada como relacionamento FK; validação semântica do conteúdo pertence às tarefas de domínio posteriores.

## Cobertura e limites

Testes verificam presença das 15 tabelas, integridade SQLite e FK, init idempotente, ausência de cadastro inventado, pragmas em três conexões, escrita recusada no modo read-only, versões/revisões, snapshots imutáveis, cruzamento de marca/run nas entidades relacionadas, consulta com escopo de marca, singleton/configuração técnica, limpeza residual e persistência entre processos. Schema futuro é recusado sem alteração dos bytes do banco; checksum divergente e schema antigo são erros tipados.

Não implementa operações de transação/idempotência, exclusão mútua de manutenção, lease/fencing operacional, confirmação humana, purge, execução/retomada, backup ou upgrade. As tabelas suportam essas tarefas futuras, mas não as validam. Não há proteção contra SQL arbitrário de processos com acesso direto ao banco; o adaptador interno não substitui os serviços. Caminhos persistidos e configuração de domínio ainda dependem da validação dos futuros serviços antes de gravar; a presença de JSON não prova validade semântica.

Falha capturada na inicialização fecha o banco e remove somente o arquivo criado exclusivamente pela chamada, conferindo identidade dev/ino/birthtime antes da exclusão. Regressão de revisão: teste red 12/13 por arquivo vazio remanescente; após correção, 13/13. Outro teste garante que banco vazio preexistente é preservado. Encerramento abrupto do processo antes da transação ainda pode deixar arquivo vazio; consultas não o reparam implicitamente. Recuperação e migração de workspace existente não são declaradas nesta T05. Confinamento não é sandbox contra processos hostis. Revisão independente aprovou o código após a correção de init e reconfirmou 13/13 testes. Também verificou manualmente rollback após falha na execução do SQL: schema vazio, user_version 0 e retry bem-sucedido. Qualificação Windows T05 aprovada; testes de distribuição completa continuam gates separados. A allowlist do pacote mínimo T03 não é ampliada nesta tarefa; empacotamento final é T31.

## Qualificação final Windows

Esta evidência valida schema/adaptador e seus testes sintéticos no runtime Windows. Não constitui aceite dos serviços, renderer, CLI de domínio ou distribuição completa.
