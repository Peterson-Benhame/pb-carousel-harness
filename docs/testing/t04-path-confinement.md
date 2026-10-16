# T04 — Confinamento de caminhos

> Cópia pública sanitizada: registros privados de conversa e execução foram omitidos. Estados e resultados técnicos abaixo descrevem a etapa original, não uma certificação da versão atual.

Data: 16/10/2026, UTC. Base: branch `feat/module-01-brand-runtime`, HEAD `401e46d`. Implementação local, sem instalação, commit, push, publicação ou integração de tarefas posteriores.

## Contrato implementado

- `resolveWorkspaceRoot({dataDir, env, cwd})`: função pura; precedência `dataDir` (`--data-dir` quando integrado) > `CAROUSEL_DATA_DIR` > `LOCALAPPDATA/PetersonCarouselHarness`. Relativos explícitos resolvidos uma vez contra `cwd`. LOCALAPPDATA deve ser absoluto e incluir o drive no Windows; raízes plenamente qualificadas não consultam o cwd, e opções explícitas rooted no Windows usam o drive do cwd; não há fallback Linux/HOME que altere silenciosamente a localização da memória. A CLI ainda não recebe a opção nesta tarefa.
- `normalizeReference`: referências internas relativas, normalizadas para `/`. Aceita separadores mistos, espaços internos e acentos; recusa componentes vazios, `.`/`..`, absolutos, drive paths, URLs, UNC, caracteres de controle e metacaracteres Windows, dispositivos reservados, ADS e aliases com ponto/espaço final. Não decodifica URLs nem faz sanitização silenciosa.
- `createIdentifier` gera UUID v4; `validateIdentifier` aceita somente essa representação canônica minúscula. `validateSlug` aceita 1–80 caracteres ASCII minúsculos/dígitos, separados por hífen simples, e rejeita dispositivos reservados. Slug validado continua sendo dado: qualquer caminho derivado deve passar pelo guard.
- `createConfinedRoot` valida a raiz absoluta sem criar diretórios. `resolve(reference)` inspeciona novamente todos os ancestrais existentes, da raiz do volume ao destino, com lstat e realpath. Arquivos intermediários, links simbólicos, junctions, especiais e divergência do caminho real são recusados. Ausência de um ancestral permite retornar um destino ainda inexistente, sem criar nada.
- `withPaths(references, access)` revalida cada caminho antes de chamar o callback de acesso ou promoção. Todos devem passar antes do callback. Erros públicos são fixos, sem eco de caminhos privados. Raiz e interface retornadas são congeladas.

## Evidências executadas

Ambiente: Linux x64, Node v24.19.0, npm 11.9.0. Não é a qualificação Windows/Node 24.21.0.

1. Red: `node --test tests/unit/paths.test.mjs` antes de criar os módulos. Falha de carregamento `ERR_MODULE_NOT_FOUND`, 1 arquivo falhou, 0 testes passaram. Não se alega que cada caso chegou a executar neste red.
2. Green inicial: mesmo comando, 8 testes passaram. Dois casos adicionais de regressão para substituição de ancestral/raiz e links internos elevaram o total a 10.
3. Revisão identificou dependência desnecessária de cwd ao selecionar raiz absoluta/default. Teste de regressão falhou antes da correção e passou depois: raiz plenamente qualificada ignora cwd UNC; LOCALAPPDATA Windows rooted sem drive é recusado. Green final: `node --test tests/unit/paths.test.mjs`, 11 passaram, 0 falharam, 0 ignorados.
4. Suíte inteira: `npm test`, 49 passaram (38 anteriores + 11 T04), 0 falharam, 0 ignorados. Descoberta recursiva `node --test` preservada.
5. `git diff --check` limpo.

Os testes criam somente sandboxes temporários sintéticos e removem-nos no teardown. Verificam ausência de criação em consultas, precedência, caminhos hostis, escapes por links, links quebrados, links internos, raiz como arquivo, troca de ancestrais após resolução e callback não executado se origem/destino falharem na revalidação.

## Qualificação Windows: concluída

Comando obrigatório: `node --test tests/windows/path-confinement.qualification.mjs`.

O arquivo importa os 11 testes comuns e acrescenta 4 testes de Windows x64 real, caminhos com espaços/acentos/separadores mistos/drive e junction trocada após resolução, antes dos callbacks de leitura/promoção, e independência da raiz padrão em relação ao drive/cwd. Resultado final confirmado: 15 passaram, 0 falharam, 0 ignorados; saída 0. Junctions dispensam o privilégio de criação de symlinks de arquivo no Windows. Execução explícita fora de Windows falha a asserção de plataforma, sem skip.

Desvio mínimo do plano aprovado: nome `path-confinement.qualification.mjs` em vez de `path-confinement.test.mjs`, seguindo a decisão de T01, para não confundir a suíte portável com homologação Windows e não mascarar a ausência de Windows com skips. Nenhuma exclusão nova nem filtro frágil foi adicionado ao `npm test`.

Bundle mínimo de evidência em JSON preparado para o coordenador; contém os 5 arquivos T04 mais `errors.mjs` existente, com SHA-256 por arquivo. Os seis hashes executados foram conferidos antes/depois no Windows e comparados aos arquivos locais após o resultado; todos coincidem. `errors.mjs` permanece idêntico à base `401e46d`.

## Limites e integração futura

- Modelo local, usuário único. Revalidação é uma defesa contra entradas e substituições detectáveis, não isolamento contra processo hostil concorrente. Existe janela TOCTOU entre chamadas ao filesystem e entre validação/callback. Nenhum lock, handle-relative API, sandbox do SO ou atomicidade de promoção é alegado. O callback deve realizar a operação imediatamente; caminhos retornados não podem ser guardados como autorização duradoura.
- Todos os links/junctions são rejeitados, mesmo internos, inclusive nos ancestrais da raiz. Isso é deliberadamente conservador; uma instalação que dependa de redirecionamento/junction na localização selecionada precisa escolher outra raiz física local. Não há suporte anunciado a Linux/macOS.
- UNC e namespaces de dispositivo são recusados lexicalmente. Detecção de drive mapeado para rede, mounts remotos, hard links ou sincronizadores externos não é feita: não usar essas localizações, pois workspace em rede/sincronização concorrente não é suportado.
- Operações futuras de leitura, staging e promoção devem usar novamente o guard. A T04 não escreve assets, promove arquivos, abre SQLite, muda renderer/empacotador nem integra comandos públicos futuros. O pacote mínimo T03 permanece inalterado; inclusão no release completo pertence à tarefa correspondente.

## Histórico de bloqueio Windows — resolvido

Revisão independente aceitou o patch após a correção de cwd, condicionada à qualificação Windows. Coordenador reexecutou npm test: 49/49, zero skips, e git diff --check limpo. O bloqueio foi posteriormente resolvido pela execução final abaixo; T05 continua sem autorização.

## Resultado final e proveniência Windows

Comando executado com o Node homologado: `node --test tests/windows/path-confinement.qualification.mjs`. Resultado final: 15/15 passaram, 0 falharam, 0 skips, exit code 0, duração reportada 288.8052 ms. Revisão independente aceita após correção de cwd; o coordenador reconfirmou separadamente a suíte Linux em 49/49 e diff limpo.

Tentativas anteriores não foram omitidas: bundle anterior teve 9/13 e o bundle final teve 11/15 dentro do sandbox de filesystem. As quatro falhas ocorreram na criação de junction, `EPERM`, syscall `symlink`, errno -4048, `node:internal/fs/promises:1707:10`, nos casos de revalidação após troca, substituição de raiz/ancestrais, links internos e troca de junction Windows. A repetição final foi autorizada fora desse sandbox, sem elevação administrativa do Windows, e passou todos os 15 testes. Nenhum teste foi ignorado e nenhum contorno foi adicionado à implementação para esconder essas falhas. Esse resultado não demonstra que a criação de junction funciona dentro do sandbox original.

O bundle final JSON tem SHA-256 `409fb78d97cf738e52f10911279e777efac4588594a572144e17e1a08c535b37`. Conferência local reproduzida lendo o JSON e calculando SHA-256 dos seis arquivos do repositório; cada valor corresponde ao manifesto e aos hashes Windows informados antes e depois da execução. Material base64 temporário usado na transferência foi removido no Windows, segundo a tarefa.

| Arquivo | SHA-256 |
|---|---|
| `src/domain/errors.mjs` | `c30d26dd0289c11a6258cc09d29861932408e796de8036592aaa7b9f4ce38642` |
| `src/domain/identifiers.mjs` | `6516810c3a984c54f38a7d3f1479d266c124aca3b6ae0653aeb3eed02bac1733` |
| `src/infrastructure/fs/workspace-paths.mjs` | `2ee32528c1956d4e74a24b1f048d5601735d45f74fa00ad657b19f0c46af4888` |
| `src/infrastructure/fs/confined-path.mjs` | `b6d7575bbba13a465a22438923f12218f49758089bea9d77d42380348cad090f` |
| `tests/unit/paths.test.mjs` | `d6f02d371aeed32a1a1b6350c150cba0a8f51350793d2c5ddda5518a3d4cde85` |
| `tests/windows/path-confinement.qualification.mjs` | `576121d566d44ef30583fb8bf2bffde9ea4c9b74f98a70023da1a73b154da505` |

T04 concluída no escopo de paths/identificadores e revisão. Esta qualificação não valida produto completo, renderer, integração dos comandos, npm/npx Windows, distribuição ou instalação; esses gates continuam nas tarefas próprias. As limitações de TOCTOU, concorrência hostil, links e armazenamento remoto descritas acima continuam aplicáveis.
