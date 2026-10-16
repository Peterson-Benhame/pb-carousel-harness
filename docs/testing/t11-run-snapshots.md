# T11 — Execuções e snapshots congelados

> Cópia pública sanitizada: registros privados de conversa e execução foram omitidos. Estados e resultados técnicos abaixo descrevem a etapa original, não uma certificação da versão atual.

Data: 16/10/2026 UTC. Base: `c639183`, branch `feat/module-01-brand-runtime`.

## Contrato implementado

API interna `createRunService(db, options)`:

- `create({requestId, brandId, brandRevision, theme, adjustments?})`: revisão e tema explícitos, novo UUID, estado `draft`.
- `get(brandId, runId)` e `list({brandId})`: leitura persistida e isolada, disponível sem fontes ou diagnóstico de runtime.
- `derive({...createRequest, parentRunId, materialArtifactIds?})`: novo UUID, revisão explícita, origem da mesma marca; referências de material somente da execução pai.
- Ajustes editoriais limitados a público, voz e preferências. Configuração efetiva e seu hash ficam no snapshot; hash da revisão original é preservado separadamente.

O snapshot guarda configuração completa de marca, revisão explícita, valores do tema, dimensões, política fixa `guided` (copy/concept/creative-assets), fontes esperadas por ID/hash, variantes de logo por superfície/ID/hash, contrato e canonização v1, renderer `legacy-panorama@1` e hashes dos seus arquivos, pacote, Node/plataforma/arquitetura/ABI/N-API, versões de dependências/motores efetivos, fontes efetivamente observadas e bloqueios de pré-requisitos. Fontes ausentes ou divergentes continuam registradas separadamente das referências esperadas; nunca implicam render pronto.

O schema JSON descreve também os objetos aninhados. O construtor recebe registros internos resolvidos, não um snapshot arbitrário fornecido pelo chamador. IDs/hash são referências; nenhum binário de fonte, caminho da máquina, raiz autorizada ou identidade de cache é persistido. Caminhos relativos de arquivos do renderer identificam arquivos do pacote, não o cache de instalação.

T05 fornece restrição de imutabilidade no SQLite; T06 fornece transação, manutenção e idempotência. Replay retorna o resultado original, inclusive após mudança da marca ou recursos; payload diferente conflita. O preflight de T06 precede os probes e reads; o commit revalida marca/linhagem depois das operações assíncronas. Logos gerenciados têm bytes/hash verificados pelo AssetStore. Nenhuma migração foi necessária.

Derivação não copia linhas de approvals, confirmation_requests ou artifacts. `materialReferences` apenas registra linhagem (runId, artifactId, kind, version, sha256). Isso não autoriza uso nem afirma integridade atual/reutilização de saídas: cópia/versionamento/fingerprint de material são T12. Aprovações específicas da nova execução continuam ausentes e precisam do fluxo posterior de T15.

## Evidência local

- Red inicial: 9 testes falharam por ausência de `createRunService`, com asserção explícita, antes do código de produto.
- Primeiro green: 9/9.
- Red do contrato de distribuição: 11/12; ausência dos novos arquivos no manifesto identificada. Schema e manifesto adicionados, depois 12/12.
- Final: `node --test tests/integration/run-snapshot.test.mjs`: **15/15**, zero falhas/cancelados/ignorados, **2000.932179 ms**.
- Final: `npm test`: **168/168**, zero falhas/cancelados/ignorados, **8133.450657 ms**.
- `git diff --check`: limpo.
- Revisão independente inicial: 12/12 focais e 165/165 completos; nenhuma falha de produto encontrada. Revisão final aceita com os 15 testes; coordenador reconfirmou a suíte completa 168/168.

Fixtures usam SQLite real e probes reais das dependências previamente instaladas. Node v24.19.0 / Linux x64; better-sqlite3 13.0.3 / SQLite 3.53.4; sharp 0.34.5 / libvips 8.17.3. Confirmação de marca é simulada explicitamente via adaptador de teste. PNG sintético passa pelo importador/decoder real. Fontes positivas são bytes rotulados `SYNTHETIC, NOT A FONT`, com manifesto sintético e matriz corrente explícita; não são fontes renderizáveis.

Cobertura inclui snapshot completo; reabertura em conexão e processo Node distintos; revisão antiga após atualização; override isolado; retorno desconectado do DB; trigger de imutabilidade; derivação sem consentimento; material de pai/sibling/marca estrangeira; replay/conflito; revisão/tema/campos inválidos; fontes ausentes/divergentes; gate real do manifesto padrão; manutenção/archive/schema futuro; rollback de insert; logo original preservado e tamper detectado. Nenhum teste foi ignorado conforme plataforma.

Validação complementar local com Python jsonschema 4.26.0 já instalado: `Draft202012Validator.check_schema` e validação de snapshot produzido pela API com SQLite real passaram. Seis mutações aninhadas foram rejeitadas: caminho de fonte adicionado, hash inválido, modo de aprovação alternativo, renderer ausente no runtime, revisão ausente e background ausente. Essa validação complementar não é dependência do produto ou requisito novo da suíte Windows; o teste portátil de schema verifica a declaração/completude, não executa um validador JSON Schema genérico.

## Bundle para verificação Windows

- 41 arquivos: dependências transitivas e todos os arquivos `requiredFiles` usados pelo doctor, mais o teste focal.
- SHA-256 do JSON descompactado: `b92649c2aacb68689691cf9239afce763cf13db061d84bca6741ffea8dde0093`.
- Transporte gzip/base64: 57.064 bytes; roundtrip descompactado conferido localmente. Manifesto separado contém hash de cada arquivo.
- Sem fontes, node_modules, dados de usuário, configurações pessoais ou diretórios de cache. Não altera a allowlist de release de T03; requiredFiles é somente completude diagnóstica do runtime.
- Execução Windows concluída conforme registro abaixo; os 41 hashes foram conferidos antes/depois no destino e reconferidos localmente em 16/10/2026, 15:42 UTC, sem divergências.

## Limites

Pré-requisitos não são renderização executada nem qualificação de layout/fontes. Matriz sintética não homologa Linux. Snapshot registra a identidade efetiva sem prometer reproduzir uma etapa com runtime diferente. T18/T19/T20 precisam consumir/verificar esse contexto; continuam pendentes. Nenhum recurso/font de Windows foi copiado. Sem instalação, atualização de dependência, commit, push, publicação ou T12/CLI T28.

## Resultado final Windows — 16/10/2026
