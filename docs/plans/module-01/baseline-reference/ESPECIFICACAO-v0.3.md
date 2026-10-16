# Peterson Carousel Harness
## Especificação 01 — Memória de Marca e Estado de Execução

**Versão:** 0.3 — escopo npm @pb e desenvolvimento pelo Dot, para aprovação

**Data:** 15/10/2026

**Responsável pelo produto:** Peterson Benhame

**Executor de desenvolvimento escolhido pelo usuário:** Dot. O envio dos arquivos e o início do trabalho serão feitos pelo usuário; esta revisão não aciona o Dot.

**Estado:** arquitetura da primeira entrega documentada; implementação não iniciada; nenhum pacote publicado.

**Alteração desta revisão:** substituição do escopo npm por `@pb` e registro do Dot como executor do desenvolvimento incremental. A distribuição npm e o plugin continuam utilizando o mesmo núcleo e armazenamento. As revisões 0.1 e 0.2 ficam preservadas nos arquivos anteriores.

A aprovação anterior autorizou detalhar este módulo. Este documento precisa ser revisado antes de elaborar seu plano de implementação. A descrição de uma capacidade aqui é um requisito, não a afirmação de que ela já existe.

## 1. Objetivo e resultado observável

Construir a primeira fatia utilizável do harness: cadastrar uma marca, preservar seu logotipo original, aplicar a identidade ao renderizador existente e retomar uma produção a partir de dados persistidos.

**Cenário principal:** Peterson cadastra a marca e um logotipo, inicia um carrossel, aprova o material e fecha o processo. Em uma nova sessão, consulta a execução pelo identificador e continua na etapa pendente. Não precisa reenviar o logotipo nem reapresentar decisões já registradas.

A memória pertence ao aplicativo local. O histórico da conversa ajuda a interpretar pedidos, mas não é a fonte de verdade sobre arquivos, versões, aprovações ou conclusão de etapas.

**Decisões de escopo desta proposta:** execução local no Windows, um proprietário por instalação, suporte a marcas identificadas separadamente, armazenamento SQLite e arquivos locais, reutilização do motor Node.js e distribuição por pacote npm com CLI, além do plugin. Não haverá servidor público, conta de aplicativo em nuvem ou cobrança por usuário nesta entrega. Uma eventual conta para publicar ou baixar um pacote privado é infraestrutura de distribuição, não uma conta do harness.

## 2. Base existente: evidências verificadas

A inspeção foi feita no arquivo fornecido `peterson-carousel-suite-windows-v2.zip`, sem instalar dependências nem executar o produto.

| Evidência no pacote | Consequência para esta entrega |
| --- | --- |
| `package.json`, linhas 2–13: projeto privado, versão `0.1.0`, módulos ES e dependências `archiver`, `fontkit` e `sharp`. | Preservar a stack existente; acrescentar persistência atrás de um adaptador. |
| `shared/brand.json`, linhas 1–14: perfil global, idioma, três fontes, dimensões e `profileImage` vazio. | Importar esses valores como configuração inicial, sem inventar logotipo ou fotografia. |
| `skills/peterson-carousel/SKILL.md`, linhas 19–43: estado identificado pela conversa e três pontos de aprovação. | Introduzir um registro persistente e manter as aprovações no modo guiado inicial. |
| `scripts/render-carousel.mjs`, linhas 81–100: o renderizador lê a marca global internamente. | Acrescentar entrada explícita para a marca congelada da execução, preservando a chamada legada. |
| `shared/templates/panorama.svg.js`, linhas 145–157: assinatura textual no rodapé. | Manter a assinatura e acrescentar um espaço próprio para o logotipo. |
| `shared/carousel.schema.json`, linhas 135–147: assets exigem `transparent: true` e `approved: true`. | Tratar o logotipo como recurso da marca, separado dos assets criativos legados. |
| `scripts/render-carousel.mjs`, linhas 102–118, e `scripts/package-carousel.mjs`, linhas 80–110: criação e remoção de diretórios de saída. | Executar cada tentativa em um diretório exclusivo, sem sobrescrever entregas anteriores. |
| O ZIP contém 41 entradas, mas nenhuma pasta `tests/` nem histórico `.git/`. | Recuperar ou reconstruir a base de testes; não assumir acesso aos 37 testes mencionados no histórico. |

O diretório `assets/profile/` contém apenas `.gitkeep`. As imagens de referência enviadas não são o logotipo de Peterson.

**Identificação da base:** SHA-256 do ZIP: `8e17e3eb1c0ddf39f64770358bda35e93189ae70cb907320e0ebc0df2135a93f`.

A verificação de integridade do ZIP não apontou entradas corrompidas. Isso não comprova instalação, renderização ou funcionamento no Windows. Esses comportamentos fazem parte da validação futura.

## 3. O que entra e o que fica para depois

### Incluído

Cadastro e consulta de marcas; revisões imutáveis de suas configurações; importação de logotipos; preferências explicitamente confirmadas; arquivos identificados por hash; registro de entradas e aprovações; execução por etapas; recuperação após interrupção; integração com o renderizador e o empacotador existentes; backup e restauração locais; CLI instalável via npm e utilizável via npx; empacotamento `.tgz`; testes de aceitação do produto e da distribuição.

A primeira produção completa partirá de um `carousel.json` compatível com o contrato atual e de assets fornecidos. As skills existentes continuarão preparando o material. Este módulo guarda e controla esse trabalho; não implementa novos agentes editoriais.

### Fora desta entrega

Catálogo visual de templates; editor gráfico; criação de imagens por API; fontes personalizadas; importação de logotipo SVG; renderização de foto de assinatura; análise de livros; memória semântica e embeddings; inferência automática de preferências; calendário editorial; publicação no Instagram; métricas; autorização automática de conteúdo; retomada parcial por lâmina; suporte multiusuário ou sincronização entre computadores; SDK público para importação por outros aplicativos; homologação em macOS/Linux; publicação em registry sem autorização específica.

O modelo de dados deixa pontos de extensão para essas capacidades, mas não cria módulos vazios para elas. As fontes atuais permanecem como padrão. O perfil legado continua usando 1080 × 1350 px e normalmente 12–16 lâminas, com a exceção explícita já prevista no contrato.

## 4. Limites dos módulos e fonte de verdade

| Módulo | Responsabilidade | Dependências permitidas |
| --- | --- | --- |
| `BrandMemory` | Marca, revisões, regras e preferências confirmadas. | Repositório de marca e serviço de arquivos. |
| `AssetStore` | Importar, preservar, localizar e verificar arquivos. | Sistema de arquivos e metadados persistidos. |
| `RunRuntime` | Etapas, tentativas, aprovações, retomada e cancelamento. | Repositórios, relógio e adaptadores de execução. |
| `LegacyRenderAdapter` | Converter o contexto persistido em entradas do motor existente. | Renderizador, validador, empacotador e arquivos autorizados. |
| `LocalInterface` | CLI distribuída via npm e adaptador do plugin; expor operações locais e receber confirmações. | Mesmos serviços de aplicação; nenhuma interface acessa tabelas diretamente. |

O SQLite é a fonte de verdade dos metadados e do estado atual. Os arquivos preservados são a fonte de verdade dos bytes. JSONs de consulta e relatórios serão exportações, não bancos paralelos. O histórico de eventos será uma trilha de diagnóstico; reconstruir o sistema por event sourcing não faz parte do módulo.

A opção por SQLite segue o uso documentado para armazenamento local de aplicações. Não será utilizado como arquivo de banco compartilhado entre computadores. [S1]

A primeira interface executável será uma CLI local com respostas JSON e saída legível. As skills poderão usá-la quando o ambiente hospedeiro disponibilizar execução local. A integração efetiva com o ambiente de Peterson terá teste próprio: não será presumida a partir de um manifesto de plugin.

## 5. Memória de marca

### 5.1 Cadastro e revisão

Uma `Brand` possui identificador estável, nome, estado `active` ou `archived` e a revisão corrente. Cada `BrandRevision` contém uma configuração completa e imutável.

| Grupo | Dados desta versão |
| --- | --- |
| Identificação | Nome de exibição, assinatura/perfil e idioma. |
| Editorial | Público descrito pelo usuário, modo de voz padrão e preferências confirmadas. |
| Visual | Fontes aprovadas no manifesto de recursos, temas autorizados e variantes do logotipo. |
| Logotipo | Uso habilitado ou desabilitado; associação de variante a fundo claro ou escuro; proteção e tamanho mínimo. |
| Procedência | Data, operação que criou a revisão e origem `user-confirmed` ou `legacy-import`. |

Alterar um campo persistente cria a próxima revisão. Uma edição com número de revisão desatualizado retorna conflito, sem sobrescrever alterações concorrentes.

A importação legada, quando solicitada e confirmada pelo usuário, copia os valores existentes da marca e dos temas. Não habilita logotipo nem inventa dados ausentes. Repetir a importação não cria outra marca nem substitui preferências posteriores.

### 5.2 Preferência permanente versus ajuste pontual

“Deixe este carrossel mais direto” altera somente a execução. “Use esse tom nos próximos carrosséis” apresenta uma atualização de marca para confirmação.

Somente preferências confirmadas entram na memória permanente desta versão. As observações do modelo permanecem sugestões, sem efeito persistente automático.

Para escolhas permitidas, a precedência será: instrução explícita da execução, preferência confirmada e padrão do aplicativo. Restrições de integridade, arquivo e aprovação não podem ser removidas por uma preferência textual.

Cada consulta de memória retorna a marca solicitada. Não haverá busca global que misture preferências ou arquivos de marcas diferentes. A mudança da marca padrão só afeta novas execuções.

### 5.3 Logotipo original

A versão inicial aceita PNG estático, inclusive com transparência. O limite proposto é 10 MiB por arquivo e 4096 px por dimensão. Arquivos inválidos, animados, totalmente transparentes ou de formato diferente são rejeitados com mensagem específica.

O importador copia os bytes originais para o armazenamento gerenciado e registra hash SHA-256, formato verificado, tamanho e dimensões. O nome original é metadado; não define o caminho interno.

O original não é recortado, recolorido, redesenhado nem enviado a geração de imagens. Redimensionamento proporcional ocorre somente na composição da peça. Não se exige transparência para cadastrar um logotipo: a compatibilidade com o fundo precisa ser autorizada.

O usuário associa o arquivo às superfícies permitidas: clara, escura ou ambas. O tema escolhido determina a variante; ausência de variante compatível bloqueia a renderização quando o uso do logotipo está habilitado. O harness não cria automaticamente uma versão branca ou preta.

Usar a mesma variante em novas peças é autorizado pelo cadastro confirmado. Não exige uma nova aprovação visual do logotipo em cada carrossel. Habilitar seu uso sem cadastrar arquivo compatível é uma configuração inválida.

### 5.4 Espaço de marca no template legado

A proposta reserva no topo direito de cada lâmina a caixa `x=756, y=64, width=240, height=80`, com proteção interna de 12 px. O encaixe será proporcional, sem corte, e a altura visível resultante deverá ser de pelo menos 24 px.

O espaço será aplicado somente quando o logotipo estiver habilitado. Elementos de conteúdo e de continuidade não poderão invadir essa área. Um arquivo excessivamente horizontal ou um conflito geométrico retorna erro de layout; não provoca deformação nem redução silenciosa abaixo do mínimo.

O rodapé textual atual será mantido. A posição e os limites acima são decisões desta proposta, ainda sujeitos à revisão de Peterson e aos testes visuais do plano.

## 6. Memória da execução e snapshots

Uma `CarouselRun` identifica uma produção. Ela guarda a marca, o estado, a etapa atual e os artefatos associados.

Na criação, o runtime captura um `RunSnapshot` imutável com a revisão da marca, valores do tema escolhido, dimensões, política de aprovação, identificadores e hashes dos arquivos de marca, versão do contrato e identificação do renderizador. Para a integração inicial, o template receberá o identificador interno proposto `legacy-panorama@1`.

As fontes são registradas por identificador e hash, sem copiar seus arquivos para entregas ou backups. O aplicativo precisa possuir os arquivos autorizados correspondentes no ambiente de restauração.

**Exemplo:** um carrossel criado com a revisão 2 continuará usando essa revisão mesmo que a marca passe para a revisão 3. Aplicar a nova identidade a esse trabalho exige criar uma execução derivada, ligada à original por `parentRunId`.

Uma execução derivada reaproveita material, mas não herda automaticamente autorizações da execução de origem. No modo guiado inicial, as aprovações precisam ser confirmadas para a nova execução.

Os conteúdos e resultados também são imutáveis por versão. O registro atual da execução aponta para os artefatos vigentes; versões anteriores continuam identificáveis. Uma mudança do texto não modifica o arquivo que fundamentou uma aprovação anterior.

O fingerprint de cada etapa considera suas entradas, snapshot e versão do executável. Reutilização só é permitida quando o fingerprint coincide e os arquivos de saída continuam íntegros. JSONs usados em fingerprints terão serialização canônica definida por versão do contrato: ordenação recursiva das chaves e preservação da ordem dos arrays.

## 7. Aprovações: dados vinculados, não flags livres

O modo inicial será `guided`, preservando as aprovações de texto, conceito e assets criativos. A autonomia operacional aprovada como direção do produto será implementada em módulo posterior.

Uma `Approval` identifica execução, tipo, fingerprint do objeto aprovado, decisão, data e evidência da interação do usuário. Uma aprovação de texto não autoriza outro texto; uma aprovação de conceito não autoriza uma imagem que ainda não existia.

O runtime não considera `approved: true` no JSON legado como prova de consentimento. Esse campo permanece apenas por compatibilidade estrutural. O adaptador exige o registro persistente correspondente antes de avançar.

Na primeira interface, uma confirmação humana será coletada em interação local explícita. O aplicativo gera o registro; o modelo não recebe uma operação que permita declarar livremente `actor=user` ou fabricar consentimento. A futura integração conversacional precisará de um canal equivalente de confirmação, e não apenas aceitar um booleano produzido pela IA.

Esse controle separa decisões do usuário e saídas do modelo dentro da aplicação. Não pretende impedir adulteração por um processo com acesso irrestrito ao mesmo banco e às mesmas permissões do sistema operacional.

Aprovações anteriores que estejam apenas em conversas podem ser trazidas como evidências para conferência. A migração exige confirmação; não converte automaticamente relatos em autorização.

Quando não existem assets criativos, a etapa correspondente é concluída com motivo explícito `not-applicable`. Isso não pula a aprovação do conceito. O logotipo aprovado na marca não integra essa lista de assets criativos.

## 8. Etapas e transições de estado

### 8.1 Sequência inicial

| Etapa | Entrada | Condição de conclusão |
| --- | --- | --- |
| `inputs` | JSON do carrossel, conceito documentado e arquivos referenciados. | Entrada copiada, identificada e validada estruturalmente. |
| `copy-approval` | Conteúdo textual versionado. | Aprovação humana vinculada ao fingerprint da copy. |
| `concept-approval` | Conceito visual versionado e copy aprovada. | Aprovação humana do conceito. |
| `assets-approval` | Assets criativos e seus hashes. | Aprovação vinculada aos assets, ou ausência registrada. |
| `render` | Snapshot, carrossel e arquivos autorizados. | Resultados escritos em diretório exclusivo e manifesto de hashes persistido. |
| `validate` | Manifesto de renderização e arquivos. | Verificações objetivas aprovadas. |
| `package` | Saídas validadas e material editorial. | ZIP e manifesto final verificados e registrados. |

As skills podem continuar preparando copy e conceito antes de completar a entrada. A execução permanece `draft` até reunir o material necessário para `inputs`. Dados parciais podem ser guardados como artefatos, mas não contam como etapas concluídas.

### 8.2 Estado da execução

| Estado | Significado e transições permitidas |
| --- | --- |
| `draft` | Entrada incompleta. Pode ir para `ready` ou `cancelled`. |
| `ready` | Há material apto a ser processado. Pode ir para `running`, `waiting-approval`, `blocked` ou `cancelled`; uma edição que remova entrada obrigatória leva a `draft`. |
| `running` | Uma tentativa possui a execução. Vai para `ready`, `waiting-approval`, `blocked`, `interrupted`, `completed` ou `cancelled`. |
| `waiting-approval` | Falta decisão humana específica. A aprovação leva a `ready`; rejeição leva a `blocked`; cancelamento leva a `cancelled`. Uma nova versão de entrada leva a `ready` ou `draft`, conforme sua completude. |
| `blocked` | Entrada, permissão ou validação impede avanço. Após correção verificada, volta a `ready` ou `draft`. Pode ser cancelada. |
| `interrupted` | A tentativa perdeu seu executor antes de confirmação final. A reconciliação leva a `ready`, `blocked` ou `cancelled`. |
| `completed` | Pacote final verificado. Estado terminal; ajustes geram execução derivada. |
| `cancelled` | Interrupção solicitada e registrada. Estado terminal; continuação exige execução derivada. |

As etapas registram `pending`, `waiting-approval`, `running`, `succeeded`, `failed` ou `invalidated`. Uma tentativa tem seu próprio identificador, horários, erros e referências de saída.

Consultar uma execução concluída apenas retorna seus resultados. Solicitar retomada não inicia uma nova geração.

### 8.3 Alterações e invalidação

Nesta primeira entrega, a unidade de processamento será a etapa do carrossel inteiro, não cada lâmina.

Alteração de copy invalida suas aprovações e todas as etapas posteriores. Mudança do conceito preserva a copy aprovada e invalida conceito, assets e saídas. Troca de asset preserva copy e conceito, mas exige nova aprovação dos assets e nova renderização. Falha restrita ao empacotamento permite reutilizar renderização e validação íntegras.

Modificar entradas enquanto uma tentativa está ativa é rejeitado. Primeiro é necessário cancelar a tentativa ou aguardar sua liberação. Uma revisão não apaga os resultados anteriores nem os apresenta como saídas válidas da versão nova.

## 9. Persistência e modelo de dados

### 9.1 Estrutura local

```text
%LOCALAPPDATA%\PetersonCarouselHarness\
├── harness.sqlite
├── blobs\<brand-id>\<sha256>\original.png
├── runs\<run-id>\artifacts\<artifact-id>\
├── runs\<run-id>\attempts\<attempt-id>\
├── runs\<run-id>\delivery\<artifact-id>\
├── staging\<operation-id>\
└── backups\<backup-id>\
```

O diretório fica fora da instalação do plugin, de `node_modules`, do prefixo global npm e do cache npx. Instalar, atualizar ou desinstalar o software não remove essa memória. A resolução da raiz segue a precedência: opção explícita `--data-dir`, variável `CAROUSEL_DATA_DIR` e, por último, a raiz padrão acima. Caminhos relativos explicitamente fornecidos são resolvidos uma vez contra o diretório da chamada e normalizados; a raiz padrão nunca depende desse diretório. CLI e plugin compartilham o resolvedor, dentro do mesmo usuário do sistema operacional. Compartilhamentos de rede e sincronização concorrente de um banco aberto não serão suportados nesta versão. [S1]

As referências persistidas serão relativas à raiz. O caminho de origem de um upload não será necessário para reutilizar seus bytes. A importação de conteúdo só lê um caminho externo explicitamente indicado pelo usuário e copia seu conteúdo para a área gerenciada. Fontes são a exceção de recursos de software: sua raiz local é autorizada explicitamente, acessada apenas para leitura e validada por manifesto/hash, sem cópia para o workspace ou a distribuição. Em uma restauração, esse vínculo local deve ser reconfigurado antes de renderizar.

### 9.2 Entidades persistidas

| Entidade | Dados principais e restrições |
| --- | --- |
| `brands` | ID, estado e revisão corrente. |
| `brand_revisions` | Marca, número da revisão, configuração, hash e procedência; par marca/revisão único. |
| `assets` | Marca, ID, hash, caminho relativo, tipo, dimensões e metadados; arquivo imutável. |
| `runs` | Marca, snapshot imutável, status, etapa, versão de concorrência, titular/expiração da lease, fencing token e eventual execução de origem. |
| `artifacts` | Execução, tipo, versão, hash e caminho; inclui texto, conceito, entrada e manifestos. |
| `steps` | Execução, chave de etapa, fingerprint vigente e estado. |
| `step_attempts` | Etapa, número de tentativa, executor, fencing token, horários e resultados. |
| `approvals` | Objeto/fingerprint, tipo, decisão e evidência de confirmação. |
| `run_events` | Transições e diagnósticos com IDs de correlação; não contém cópias completas dos materiais. |
| `operations` | Chave de idempotência, hash da solicitação e resultado confirmado. |
| `schema_migrations` | Versões aplicadas ao banco e checksums das migrações. |
| `workspace_settings` | Configuração local de recursos aprovados, diretório de fontes autorizado e revisão; não altera a identidade congelada das execuções. |

Todos os vínculos de execução e arquivos respeitam `brandId`. A leitura nunca resolve um asset de outra marca apenas porque recebeu um ID válido.

A configuração proposta do banco usa `journal_mode=DELETE`, `synchronous=FULL`, `busy_timeout=5000` e chaves estrangeiras habilitadas e verificadas por conexão. A documentação do SQLite exige atenção explícita à ativação das chaves estrangeiras; não dependeremos de um padrão implícito. [S2]

O adaptador SQLite deve ser testado com o runtime Node.js homologado no Windows. A biblioteca concreta e suas versões serão selecionadas no plano de implementação, sem alterar os contratos de domínio deste documento. O requisito antigo de Node.js 18+ não será automaticamente herdado sem nova verificação de compatibilidade.

## 10. Retomada, concorrência e consistência

### 10.1 Aquisição de uma execução

Antes de executar uma etapa, o runtime obtém uma lease persistida por execução. A proposta usa expiração em 60 segundos e renovação a cada 10 segundos. Cada aquisição recebe um fencing token crescente; apenas o titular vigente pode confirmar resultados.

Uma segunda chamada recebe `RUN_BUSY` enquanto existe lease válida. Após expiração, outro executor pode reconciliar a execução, mas o executor antigo não recupera o direito de publicar saídas mesmo que volte a responder.

Atualizações de estado, eventos e referências confirmadas usam transações curtas. O SQLite admite somente um escritor simultâneo; renderização e operações demoradas ficam fora da transação. [S3]

### 10.2 Gravação de artefatos

O protocolo da aplicação será: escrever em staging exclusivo, fechar o arquivo, verificar bytes e hash, promover para um caminho final novo e então confirmar as referências no banco junto com a transição de estado.

As transações do SQLite protegem as alterações do banco. Não tratamos a escrita de arquivos externos como parte da mesma transação atômica. [S4]

Se houver interrupção antes do commit, poderá sobrar um arquivo sem referência, mas não uma etapa concluída por presunção. A reconciliação verifica o manifesto e o fingerprint; reutiliza somente resultados completos e íntegros. Arquivos parciais permanecem isolados e não entram na entrega.

Ao reabrir uma execução, o runtime verifica a existência e o hash de todos os resultados que pretende reutilizar. Arquivo ausente ou divergente gera bloqueio ou invalidação da etapa afetada, com diagnóstico explícito.

### 10.3 Idempotência e tentativas

Operações mutáveis recebem `requestId`. Repetir a mesma solicitação retorna o resultado anterior; usar a chave com outro conteúdo retorna `IDEMPOTENCY_CONFLICT`. O resultado da operação e sua mudança de estado são confirmados na mesma transação. A garantia depende da igualdade do payload, não apenas do nome do comando.

Uma retomada consulta primeiro estado, fingerprints, manifestos e arquivos. Não executa cegamente a última ação. A execução pode repetir trabalho computacional após uma interrupção, mas não publica duas saídas finais para a mesma tentativa confirmada.

Uma falha transitória de arquivo poderá receber até duas novas tentativas locais, com espera de 500 ms e 1500 ms. Erros de conteúdo, consentimento, hash ou configuração não serão repetidos automaticamente. Banco ocupado retorna erro após o timeout; a chamada seguinte usa a mesma chave de idempotência.

O alvo de recuperação é encerramento inesperado do processo. Não se promete ausência de perda diante de falha física de disco ou energia. Mesmo nessa situação, a aplicação não deverá afirmar sucesso sem verificar os dados disponíveis.

Chamadas cobradas a provedores externos não estão nesta entrega. Uma garantia de exatamente uma cobrança não pode ser inferida desse protocolo local.

## 11. Operações públicas propostas

Os nomes abaixo descrevem contratos de aplicação, não comandos já disponíveis.

| Operação | Resultado esperado |
| --- | --- |
| `brand.create / brand.get / brand.list` | Cadastrar e consultar marcas sem dependência da conversa. |
| `brand.update` | Criar revisão, com verificação da revisão anterior e confirmação persistente. |
| `brand.importLogo` | Importar o original, validar e retornar o identificador do asset. |
| `brand.archive` | Impedir novas execuções sem quebrar as existentes. |
| `brand.purge` | Remover marca e histórico após confirmação destrutiva específica. |
| `run.create / run.get / run.list` | Criar uma produção ou consultar estado e pendências. |
| `run.attach` | Acrescentar nova versão de entrada e aplicar invalidação. |
| `approval.request` | Exibir o objeto e criar uma solicitação de confirmação humana. |
| `run.resume / run.cancel` | Retomar a etapa autorizada ou cancelar com controle de lease. |
| `run.derive` | Criar nova execução a partir de material existente, inclusive para trocar a revisão da marca. |
| `workspace.init / workspace.inspect / workspace.migrate` | Inicializar explicitamente, diagnosticar sem mutação e migrar com backup e manutenção exclusiva. |
| `workspace.backup / workspace.restore` | Preservar ou restaurar o conjunto coerente de dados. |

A interface de modelo pode solicitar aprovação, mas não produzir uma confirmação humana arbitrária. A resposta das operações inclui IDs, estado, próxima ação autorizada e eventuais bloqueios. Resultados não expõem segredos nem conteúdos de outras marcas.

Erros tipados mínimos: `BRAND_NOT_FOUND`, `REVISION_CONFLICT`, `ASSET_INVALID`, `ASSET_HASH_MISMATCH`, `LOGO_VARIANT_MISSING`, `LOGO_LAYOUT_CONFLICT`, `APPROVAL_REQUIRED`, `APPROVAL_STALE`, `RUN_BUSY`, `INPUT_INCOMPLETE`, `DATABASE_BUSY`, `IDEMPOTENCY_CONFLICT`, `RUNTIME_MISMATCH`, `RESOURCE_MISSING`, `SCHEMA_MISMATCH`, `PROTOCOL_MISMATCH`, `WORKSPACE_NOT_INITIALIZED` e `UNSUPPORTED_PLATFORM`.

## 12. Integração incremental com a suíte

`shared/brand.json` e `shared/themes.json` da instalação legada continuam como fontes de importação confirmada. Não serão regravados a cada produção. O novo pacote npm conterá apenas padrões técnicos neutros; perfil pessoal, logotipo e preferências de Peterson não serão incluídos como dados de fábrica. As fontes aprovadas serão resolvidas por manifesto e configuração local; não serão redistribuídos binários de fontes nos novos artefatos desta entrega.

`renderCarousel` receberá contexto de marca e tema opcional. Na chamada legada sem contexto, preservará o comportamento anterior. Na chamada via harness, o adaptador fornecerá exclusivamente o snapshot da execução.

O renderizador receberá o logotipo separadamente dos assets criativos. O template acrescentará o slot de marca. Quando o logotipo estiver desabilitado, a integração deve preservar o resultado legado no ambiente fixado para regressão.

`validate-carousel.mjs` continuará validando o contrato atual. Antes dele, o runtime verifica marca, permissões e aprovações; depois da renderização, verifica os arquivos. O fato de um JSON satisfazer o validador legado não comprova que a produção foi autorizada.

O empacotador será chamado em diretório exclusivo da tentativa. Somente saídas verificadas serão promovidas a entrega. O pacote público inclui slides, panorama, legenda e referências; não inclui banco, histórico interno, logotipo original isolado, configurações privadas nem arquivos de fontes.

As quatro skills serão adaptadas para consultar e atualizar o runtime nas fronteiras das etapas. Não terão permissão para editar diretamente o banco ou modificar o snapshot. O núcleo funcionará pela CLI mesmo antes da integração com o hospedeiro conversacional.

### 12.1 Distribuição npm: um produto, duas interfaces

**Nome de pacote solicitado pelo usuário:** `@pb/carousel-harness`. **Executável proposto, mantido:** `peterson-carousel`. A disponibilidade do nome e a permissão de publicação no escopo `@pb` ainda não foram verificadas; isso será uma condição de liberação, não uma suposição da implementação.

A substituição solicitada altera somente o escopo npm. O nome do produto, os nomes das skills, o comando CLI e o diretório de dados permanecem como definidos nesta especificação. Uma impossibilidade de publicar em `@pb` deve ser informada ao usuário; não autoriza escolher outro escopo silenciosamente.

A primeira versão terá um único pacote instalável contendo CLI, núcleo modular, adaptadores, migrações, contratos e recursos técnicos autorizados. Não haverá pacotes independentes de memória, renderização e templates nesta fase. A fronteira entre módulos é de código e contrato, não de serviços ou releases separados.

O plugin permanecerá uma interface conversacional que utiliza esse mesmo núcleo por meio da CLI. O adaptador aponta para a instalação e versão configuradas, verifica o protocolo e usa os mesmos IDs e a mesma raiz de dados. Não escolhe arbitrariamente o primeiro comando encontrado no PATH nem busca `latest` a cada etapa. Quando o hospedeiro não permite chamar o runtime local, essa integração é reportada como indisponível; instalar a CLI não registra automaticamente um plugin em outro aplicativo.

Para chamadas automatizadas, o adaptador usará o Node autorizado e o caminho absoluto do entrypoint, passando argumentos separados. O runtime não invocará um `npm.cmd` para cada operação. O caminho interativo continuará disponível pelo executável npm. O campo `bin` do manifesto fornece esse comando, incluindo o wrapper de execução em Windows. [S6]

### 12.2 Instalação e superfície de comandos

O pacote exporá `bin` com um entrypoint Node.js e manterá módulos ES. Os exemplos abaixo representam o uso projetado **depois da implementação e de uma publicação autorizada**. Não são comandos disponíveis nesta revisão. Em produção e nos testes de retomada, a versão deverá ser explicitamente fixada; omiti-la aqui simplifica a apresentação.

```sh
npm install -g @pb/carousel-harness
peterson-carousel init
peterson-carousel doctor
```

Execução sem instalação global prévia:

```sh
npx --package @pb/carousel-harness peterson-carousel doctor
```

O npm suporta execução via `npm exec`/`npx`, utilizando pacote local ou cache conforme a resolução. Isso não equivale a executar sem baixar dependências e não transforma o cache em armazenamento de marca. [S7]

| Comando proposto | Contrato desta entrega |
| --- | --- |
| `peterson-carousel --help` / `--version` | Informar uso e versão, sem criar workspace. |
| `peterson-carousel init` | Criar o workspace explicitamente, apresentar cadastro ou importação legada e permitir configurar o diretório local das fontes aprovadas. Repetição não apaga dados. |
| `peterson-carousel doctor` | Diagnosticar versão, plataforma, adaptador SQLite, renderer, recursos tipográficos e raiz resolvida. Não repara, migra ou modifica configurações. |
| `peterson-carousel brand ...` | Expor os contratos `brand.*` da seção 11. |
| `peterson-carousel run ...` | Expor os contratos `run.*` da seção 11. |
| `peterson-carousel approval request ...` | Solicitar a confirmação da seção 7; não fornecer um atalho de aprovação irrestrita. |
| `peterson-carousel workspace ...` | Backup, restauração e migração explícita sob o bloqueio de manutenção. |

A CLI oferecerá `--json`: envelope versionado com `protocolVersion`, `ok`, `data`, `error` e `nextAction`; erros incluem `code` e mensagem saneada. Nessa modalidade, stdout contém apenas o resultado JSON e stderr recebe diagnósticos. Sucesso retorna código de saída 0; erro de uso, bloqueio ou falha retorna código não zero. Um comando de consulta pode retornar sucesso ao informar corretamente uma execução bloqueada.

Chamadas não interativas a operações mutáveis exigem `--request-id` e nunca confirmam aprovações por input redirecionado, `--yes` ou flags equivalentes. A CLI interativa pode gerar o `requestId`, informando-o no recibo. A autenticação do usuário continua sujeita ao limite local explicitado na seção 7; detectar TTY não é uma fronteira contra processos hostis. Comandos que precisem de interação retornam `APPROVAL_REQUIRED` em modo não interativo.

### 12.3 Artefato instalável e controle do conteúdo

O processo de release produzirá um `.tgz` por `npm pack`, com relatório de conteúdo e checksum. Antes de instalar, o processo inspecionará `npm pack --dry-run --json` e depois o conteúdo real do tarball. O npm permite empacotar um diretório local e instalar tarballs sem antes publicá-los num registry. [S8][S9]

A lista de inclusão será explícita pelo campo `files`: entrypoint, código executável, schemas, migrações, template legado, padrões neutros, manifesto de recursos e documentação de uso. As regras próprias do npm também serão consideradas na inspeção do resultado, sem confiar só no `.gitignore`. [S6]

Ficam proibidos no artefato: banco, logs, backups, carrosséis privados, originais de logotipos, fotografias do usuário, referências visuais enviadas, `.env`, credenciais, cache e binários de fontes. Os três identificadores tipográficos aprovados são mantidos; `init` registra sua localização local e `doctor` verifica presença e hashes. Sem os recursos necessários, cadastro e consulta funcionam, mas renderização retorna `RESOURCE_MISSING`. A preservação visual continua sendo testada com recursos disponíveis no ambiente homologado, sem embalá-los no `.tgz`.

O `.tgz` do harness não inclui uma cópia de `node_modules` produzida em outro sistema operacional. Dependências de execução serão declaradas e resolvidas pela instalação. O consumidor não precisará do repositório, do diretório original de desenvolvimento nem de dependências de desenvolvimento para usar a CLI.

Por se tratar de uma aplicação CLI, o release incluirá `npm-shrinkwrap.json` para fixar a árvore de dependências publicável. O `package-lock.json` do desenvolvimento, por si só, não é uma trava distribuída aos consumidores do pacote. Essa é uma finalidade documentada do shrinkwrap. Isso não elimina diferenças de plataforma ou recursos nativos. [S10]

O pacote do harness não terá hooks de instalação que criem marca, migrem memória, instalem o plugin, solicitem segredos ou executem o pipeline. Os scripts de dependências serão auditados e validados com a política da versão npm homologada; não haverá alteração automática de configurações globais para liberá-los.

### 12.4 Compatibilidade e diagnósticos

Windows continua como alvo de aceitação inicial. A distribuição npm não constitui prova de suporte a macOS ou Linux. A matriz Node/npm/plataforma será registrada no plano e no manifesto do release, e o entrypoint recusará combinações não suportadas antes de uma operação mutável. A escolha do adaptador SQLite mantém o critério da seção 9.2.

O teste será feito com o tarball efetivamente gerado, em ambiente limpo, incluindo instalação global e execução via npx. O carregamento do `sharp` e do adaptador SQLite será verificado no ambiente alvo, sem pressupor que o funcionamento em Linux assegura funcionamento em Windows. A documentação do sharp descreve instalação e binários dependentes de plataforma. [S11]

A instalação via npm pode funcionar enquanto recursos locais ainda faltam. `doctor` precisa distinguir `RESOURCE_MISSING`, runtime incompatível, pacote incompleto, workspace ainda não inicializado e integração do plugin ausente. Nenhum desses diagnósticos autoriza substituir fontes silenciosamente, pedir alteração geral da política de segurança do Windows ou dizer que um render foi concluído.

### 12.5 Atualização e compartilhamento de memória

CLI global, npx e plugin utilizarão o mesmo resolvedor de dados da seção 9.1. Trocar de diretório de trabalho ou limpar o cache npx não cria uma marca nova. Usar outra conta do sistema operacional ou definir outra raiz seleciona outro workspace; não haverá sincronização implícita.

A coordenação entre os canais usa leases e fencing tokens da seção 10. Uma execução ocupada pelo plugin não será simultaneamente retomada pela CLI. A compatibilidade do protocolo e do schema é verificada antes da operação; runtime diferente pode consultar memória compatível, mas não refaz etapas de renderização de um snapshot incompatível.

Atualizar o pacote é distinto de atualizar o workspace. O software novo solicita migração quando necessária; `workspace migrate` usa manutenção exclusiva e backup. Desinstalar remove somente a distribuição. A eliminação de memória continua exigindo as operações destrutivas específicas da aplicação. Não será oferecido downgrade destrutivo automático para tentar compatibilizar uma versão antiga.

### 12.6 Privacidade e autorização de publicação

Solicitar uma versão npm não é autorizar que o código privado seja tornado público. O primeiro artefato testável será o `.tgz` local. O projeto permanece protegido de publicação enquanto não houver decisão explícita sobre registry, visibilidade, nome, versão e licença do código. Esse gate é de release; não impede implementar e testar a CLI.

O `private: true` encontrado no projeto impede `npm publish`; não configura um pacote privado hospedado. Para uma publicação autorizada, o manifesto de distribuição precisará retirar essa trava e configurar a visibilidade de destino. Pacotes privados no registry npm exigem escopo e conta/plano compatível; não se presume que Peterson já tenha esse acesso. [S6][S12]

A publicação não fará upload do workspace local, independentemente de a distribuição do código ser pública ou privada. Nenhuma conta será criada, nenhum plano será contratado e nenhum pacote será publicado como parte da revisão desta especificação.

## 13. Segurança e gestão dos dados

Arquivos importados são dados. Texto de uma imagem ou de um documento não autoriza comandos, alteração de marca ou aprovação. Não serão aceitos scripts como templates nesta entrega.

Caminhos internos usam IDs gerados e resolução confinada à raiz autorizada. Segmentos de travessia, caminhos absolutos em referências internas, esquemas de URL e escapes por symlink/junction são rejeitados. Os testes precisam cobrir caminhos com espaços e acentos no Windows.

Não há armazenamento de senhas, tokens ou chaves de API neste módulo. Logs operacionais registram IDs, estados, hashes e erros saneados, não o conteúdo completo das conversas. Os dados permanecem locais por padrão, mas esta versão não acrescenta criptografia própria em repouso.

Arquivar uma marca não apaga memória. A operação de exclusão definitiva apresenta a marca e as execuções afetadas e exige confirmação distinta. Não opera com execução ativa. Remove primeiro as referências em transação e depois os arquivos exclusivos da marca, com limpeza retomável em caso de interrupção. O registro residual da limpeza contém apenas IDs técnicos e estado, sem perfil ou conteúdo.

Backups anteriores podem conservar dados excluídos e não serão apagados silenciosamente. A interface deve explicar essa diferença antes da confirmação.

## 14. Backup, restauração e atualização

Um backup exige uma janela de manutenção sem tentativas ativas. Todas as operações mutáveis respeitam o mesmo bloqueio de manutenção. O backup bloqueia novas mutações durante a captura, gera uma cópia consistente do banco e copia os arquivos referenciados para um conjunto com manifesto e hashes.

A documentação oferece API de backup do SQLite para obter uma cópia consistente do banco. Isso não inclui automaticamente os arquivos externos, que precisam fazer parte do protocolo da aplicação. [S5]

A restauração ocorre em diretório novo. Verifica versão, banco, manifesto, hashes e caminhos antes de permitir o uso. Não substitui o workspace ativo durante uma produção.

Fontes do aplicativo não entram no backup. A restauração valida a disponibilidade e os hashes dos recursos de renderização requeridos. Um ambiente diferente pode preservar e consultar a memória, mas terá a retomada de renderização bloqueada por `RUNTIME_MISMATCH` até fornecer o runtime compatível ou criar uma execução derivada.

Antes de migração estrutural do banco haverá backup. A aplicação verifica a versão e recusa gravação em schema mais novo que o suportado. Reinstalar o plugin, atualizar/desinstalar a CLI global ou trocar o cache npx não deve remover o diretório persistente. A instalação do pacote não migra o banco; a migração é uma operação explícita de workspace, precedida de backup. Uma versão antiga recusa acesso a um schema mais novo, inclusive para leitura, sem tentar downgrade. O snapshot registra a versão do pacote e a identificação efetiva do motor e de suas dependências; não usa a localização no cache como identidade do runtime.

## 15. Critérios de aceitação

Estes cenários serão transformados em testes e demonstrações no plano de implementação. Ainda não foram executados para um módulo que não existe.

| ID | Situação | Ação | Resultado exigido |
| --- | --- | --- | --- |
| AC01 | Marca cadastrada e processo fechado. | Abrir nova sessão e consultar o ID. | Mesma configuração e mesma revisão disponíveis. |
| AC02 | Logotipo importado; arquivo original fora do workspace removido. | Renderizar uma nova peça. | O arquivo gerenciado continua disponível e seu hash não muda. |
| AC03 | Logotipo habilitado sem variante adequada ao tema. | Solicitar renderização. | Bloqueio específico, sem recolorir ou inventar uma variante. |
| AC04 | Duas marcas com preferências e logos diferentes. | Consultar e produzir para cada marca. | Nenhuma mistura de dados ou arquivos. |
| AC05 | Ajuste solicitado apenas para um carrossel. | Aplicar o ajuste e iniciar outro. | A marca e seus padrões permanecem inalterados. |
| AC06 | Execução criada com revisão 1; marca atualizada para revisão 2. | Retomar a execução antiga. | Usa a revisão 1; nova execução usa a revisão escolhida explicitamente. |
| AC07 | Texto, conceito e assets aprovados e registrados. | Fechar o processo e retomar. | Não exige repetir as mesmas aprovações; avança para a etapa pendente. |
| AC08 | JSON contém `approved: true`, mas não há consentimento persistido. | Tentar avançar. | `APPROVAL_REQUIRED`; nenhuma renderização autorizada por essa flag. |
| AC09 | Texto aprovado recebe uma nova versão. | Salvar e tentar retomar. | Aprovação anterior não vale para o texto novo; etapas posteriores ficam inválidas. |
| AC10 | Renderização válida; empacotamento falha. | Retomar após corrigir o bloqueio. | Reutiliza a renderização íntegra e refaz apenas o empacotamento. |
| AC11 | Encerramento durante escrita de saída, antes do commit. | Reabrir e reconciliar. | Parcial não é anunciado como pronto; tentativa recuperada ou refeita com segurança. |
| AC12 | Arquivo de uma etapa concluída foi removido ou alterado. | Retomar execução. | Verificação de hash bloqueia a reutilização e identifica a etapa afetada. |
| AC13 | Duas chamadas simultâneas para a mesma execução. | Tentar adquirir a etapa. | Só uma lease vigente; executor antigo não consegue confirmar após perder o token. |
| AC14 | Mesmo `requestId` recebido duas vezes. | Executar a solicitação repetida. | Mesmo resultado; payload diferente com a chave repetida gera conflito. |
| AC15 | Logotipo muito horizontal ou asset invadindo sua área. | Compor a peça. | Erro explícito de layout, sem deformação, corte ou redução silenciosa. |
| AC16 | Arquivo não PNG ou caminho que escapa da área autorizada. | Importar ou resolver a referência. | Rejeição antes de uso; nenhum acesso externo não autorizado. |
| AC17 | JSON legado válido com logotipo desabilitado. | Renderizar pelo caminho antigo e pelo adaptador, no mesmo ambiente. | Regressão visual/pixel conforme fixture homologado, sem alteração de conteúdo. |
| AC18 | Backup com logotipo, marca e execução pendente. | Restaurar em outra pasta local com runtime compatível. | IDs, revisões, aprovações e retomada preservados, sem depender de caminhos antigos. |
| AC19 | Dependência ou fonte de renderização não coincide com o snapshot. | Retomar renderização. | `RUNTIME_MISMATCH`, sem afirmar reprodutibilidade inexistente. |
| AC20 | Produção concluída. | Inspecionar a entrega e solicitar retomada novamente. | ZIP íntegro, slides 1080 × 1350, sem arquivos privados/fontes; nenhuma nova geração. |
| AC21 | Marca arquivada ou excluída com confirmação. | Consultar a política de uso e os arquivos. | Arquivo preservado no primeiro caso; exclusão efetiva e retomável no segundo, com aviso sobre backups. |
| AC22 | Instalação em Windows com caminho contendo espaços e acentos. | Executar fluxo local completo, fechar e retomar. | Marca e execução persistem; resultado registrado em evidência de teste no Windows. |
| AC23 | Tarball de release gerado, sem workspace de desenvolvimento disponível. | Instalar pelo npm em Windows limpo e executar ajuda, diagnóstico e o fluxo principal com recursos configurados. | Entry point e dependências completos; uso independente da pasta de origem. |
| AC24 | Marca e execução criadas pela CLI global. | Consultar e retomar via npx e via adaptador do plugin com mesma raiz e versões compatíveis. | Mesmos IDs, revisões e aprovações, sem banco paralelo. O adaptador pode ser testado isoladamente; integração real terá evidência própria. |
| AC25 | Memória existente e pacote/cache de execução removido. | Desinstalar/reinstalar a distribuição e executar de outro diretório. | Dados e hashes preservados; nenhuma dependência da localização do pacote ou cache. |
| AC26 | Manifesto e tarball de distribuição disponíveis. | Inspecionar todos os membros, inclusive exemplos e recursos. | Ausência de arquivos privados, credenciais e binários de fontes; presença de código, contratos, migrações e documentação necessários. |
| AC27 | Instalação do pacote com memória anterior. | Instalar ou atualizar, sem chamar init/migrate. | Nenhuma criação de marca, migração, exclusão de dados ou registro automático de plugin. |
| AC28 | Duas versões do pacote e um workspace migrado. | Tentar acessar com a versão antiga ou renderizar com fingerprint incompatível. | Schema mais novo recusado sem gravação/leitura indevida; render incompatível bloqueado; sem downgrade automático. |
| AC29 | Chamada automatizada com --json e uma pendência de consentimento. | Solicitar aprovação sem interação e tentar confirmar por flag/input redirecionado. | JSON válido, diagnóstico separado e APPROVAL_REQUIRED, sem fabricar consentimento. |
| AC30 | Dependência nativa ou fonte obrigatória ausente. | Executar doctor e solicitar renderização. | Diagnóstico preciso, sem substituição silenciosa de fonte nem falso sucesso; consultas de memória seguem disponíveis quando seus requisitos estão satisfeitos. |
| AC31 | Dois canais tentam retomar a mesma execução. | Executar simultaneamente plugin e CLI apontando para a mesma raiz. | Uma lease vigente e um resultado confirmado; invariantes de concorrência independentes da interface. |
| AC32 | Usuário pediu distribuição npm, mas não autorizou publicação. | Preparar e testar o release local. | Tarball e relatório disponíveis sem npm publish, alteração de visibilidade, compra de plano ou exposição do workspace. |

A verificação visual avaliará posição do logotipo, proporção, legibilidade da assinatura e ausência de sobreposição. Testes de geometria e hash não substituem essa inspeção.

## 16. Critério de conclusão e sequência posterior

Esta entrega estará concluída quando houver implementação dos contratos, migrações, testes de aceitação, regressão do fluxo legado, tarball instalável testado por npm/npx, preservação de memória entre canais e demonstração no Windows. Publicação em registry exige liberação específica e não será anunciada apenas porque o tarball foi gerado. A ausência da suíte de testes no ZIP é uma condição de trabalho a resolver, não uma aprovação presumida da base.

A demonstração principal precisa mostrar a cadeia completa: cadastrar marca e logotipo; preparar uma execução; registrar aprovações; encerrar; reabrir; retomar; entregar os arquivos; atualizar a marca; comprovar que a execução anterior preservou seu snapshot.

O plano incluirá primeiro o entrypoint e o empacotamento mínimo da CLI, depois sua integração com memória/execução e, por fim, os testes do artefato de release. Isso entrega npm desde a fundação sem duplicar o núcleo ou converter esta etapa em um catálogo de templates.

O catálogo de templates será o módulo seguinte. Ele deverá consumir `BrandRevision`, `RunSnapshot` e referências de assets, sem criar um segundo armazenamento de identidade.

**Próximo marco após a aprovação deste documento:** plano de implementação desta especificação, dividido em tarefas verificáveis, a ser executado pelo Dot. A escolha do executor já foi informada pelo usuário; ela não substitui a aprovação da revisão 0.3 nem a revisão e aprovação do plano antes de código de produto ou instalação de dependências.

### 16.1 Handoff para desenvolvimento pelo Dot

O usuário fornecerá ao Dot esta revisão e a base existente `peterson-carousel-suite-windows-v2.zip`, ou um repositório correspondente identificado explicitamente. O Dot não deve presumir acesso às conversas anteriores, à memória deste chat ou aos arquivos de outro ambiente. Se a base estiver ausente, deve solicitar o arquivo, não reconstruir o produto a partir deste resumo. Não precisa receber logotipo pessoal nem dados reais para iniciar o planejamento.

**Primeira interação:** ler a especificação, inspecionar a base sem alterá-la, comparar as evidências da seção 2 e apresentar divergências, lacunas e a compreensão do escopo. Confirmar com o usuário a aprovação desta revisão antes de escrever o plano. A inspeção inicial não inclui instalar dependências, modificar código, executar scripts do pacote ou publicar qualquer artefato.

**Planejamento:** após a aprovação da especificação, produzir um plano com tarefas pequenas, dependências, arquivos a criar ou modificar, testes e vínculo aos critérios AC01–AC32. Validar as escolhas de runtime e bibliotecas antes de fixá-las. Cada tarefa deve ter resultado demonstrável. Apresentar o plano para aprovação; não aproveitar a autorização de planejamento para iniciar a implementação.

**Implementação:** após a aprovação do plano, trabalhar sobre a base existente, uma tarefa por vez. Preservar alterações prévias do usuário e usar uma branch de trabalho quando houver repositório. Para mudanças de comportamento, escrever testes antes da implementação e executar as verificações pertinentes. Ao concluir uma tarefa, registrar arquivos alterados, comandos realmente executados, resultados, limitações e próxima tarefa; aguardar a liberação para avançar, salvo autorização explícita de um lote. Não iniciar catálogo de templates, ingestão de livros ou outros módulos fora da seção 3.

**Continuidade do desenvolvimento:** manter um registro versionado de progresso junto ao plano, contendo tarefa atual, tarefas concluídas com evidências, bloqueios e próximo passo. Esse registro serve ao desenvolvimento pelo Dot; não substitui o SQLite nem o estado de execução do produto. Uma sessão nova deve conferir o estado dos arquivos antes de confiar no resumo anterior.

**Validação e entrega:** distinguir testes executados de cenários apenas previstos. Não declarar funcionamento no Windows, instalação npm, integração com o plugin ou publicação sem a evidência correspondente. Usar dados sintéticos nos testes e respeitar as exclusões do artefato da seção 12.3. Nenhuma publicação, criação de conta, contratação, mudança de visibilidade ou envio de dados privados está autorizada por este handoff.

## 17. Referências e natureza das decisões

As tabelas de requisitos, limites numéricos e contratos são propostas de projeto para revisão. As observações sobre o estado atual vêm da inspeção do ZIP identificado na seção 2. Não há resultados de desempenho ou testes do módulo novo apresentados como fatos.

As fontes públicas abaixo foram consultadas em 15/10/2026 e fundamentam apenas os comportamentos técnicos indicados no texto:

- **[S1] SQLite — Appropriate Uses For SQLite.** Armazenamento local e limitações de acesso compartilhado em rede. `https://www.sqlite.org/whentouse.html`
- **[S2] SQLite — Foreign Key Support.** Ativação e verificação de chaves estrangeiras por conexão. `https://www.sqlite.org/foreignkeys.html`
- **[S3] SQLite — Transaction.** Transações, concorrência de escrita e tratamento de banco ocupado. `https://www.sqlite.org/lang_transaction.html`
- **[S4] SQLite — Atomic Commit In SQLite.** Escopo da atomicidade das transações do banco. `https://www.sqlite.org/atomiccommit.html`
- **[S5] SQLite — Backup API.** Cópia consistente do banco; protocolo de arquivos externos definido pela aplicação. `https://www.sqlite.org/backup.html`

- **[S6] npm — package.json.** Campos bin/files, private e publishConfig. `https://docs.npmjs.com/cli/v11/configuring-npm/package-json/`
- **[S7] npm — npm exec.** Execução por pacote e cache; comportamento de npx. `https://docs.npmjs.com/cli/v11/commands/npm-exec/`
- **[S8] npm — npm pack.** Tarball e inspeção dry-run/JSON. `https://docs.npmjs.com/cli/v11/commands/npm-pack/`
- **[S9] npm — npm install.** Instalação global e por arquivo tarball. `https://docs.npmjs.com/cli/v11/commands/npm-install/`
- **[S10] npm — npm-shrinkwrap.json.** Trava distribuível de dependências, particularmente para aplicações CLI. `https://docs.npmjs.com/cli/v11/configuring-npm/npm-shrinkwrap-json/`
- **[S11] sharp — Installation.** Requisitos e particularidades de binários por plataforma. `https://sharp.pixelplumbing.com/install/`
- **[S12] npm — Creating and publishing private packages.** Escopo, acesso e condições para hospedagem privada. `https://docs.npmjs.com/creating-and-publishing-private-packages/`
