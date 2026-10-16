# Q01 — Contratos de qualidade, versão proposta 1

> Cópia pública sanitizada: registros privados de conversa e execução foram omitidos. Estados e resultados técnicos abaixo descrevem a etapa original, não uma certificação da versão atual.

Data: 16/10/2026. Base inspecionada: `8c2c2c65e7c9db96519434d294564cb972f02dd8` (T00–T13).

Referências normativas: [adendo v0.4](../plans/module-01/ESPECIFICACAO-ADENDO-QUALIDADE-v0.4.md), [plano revisado](../plans/module-01/PLANO-REVISAO-QUALIDADE.md), [gate de fontes](quality-font-gate.md) e [baseline v0.3](../plans/module-01/baseline-reference/ESPECIFICACAO-v0.3.md). Os documentos técnicos de referência estão incluídos nesta cópia com metadados privados removidos. Este arquivo fecha propostas técnicas e explicita decisões ainda dependentes de G1.

## 1. O que existe e o que muda

| Área inspecionada | Contrato efetivo na base | Proposta, sem implementação em Q01 |
| --- | --- | --- |
| `brand-schema.mjs` / `resources.mjs` | Três IDs fixos, manifesto 1, somente `legacy-panorama@1` | Leitura v1 preservada; configuração tipográfica v2 limitada, manifesto 2 com renderers nomeados |
| `run-snapshot.mjs` / schema | Snapshot 1, contrato 1, canonização 1 | Snapshot 2, contrato 2, pipeline 2, política de qualidade 1 |
| `artifact-fingerprints.mjs` | Fingerprint 1; snapshot/executável entram em todas as etapas | Fingerprint 2; entradas de composição/qualidade explícitas, algoritmo v1 preservado |
| `stage-graph.mjs` | Sete etapas; tipo derivado da posição | Onze descritores explícitos; novo tipo `review` |
| `run-inputs.mjs` | Inputs imutáveis; `ready` estrutural; edição restrita | Plano como entrada versionada; edição posterior somente pelo controle de invalidação |
| `run-runtime.mjs` | Consulta; `resume` é alias de consulta; execução ainda indisponível | Projeção v1/v2 e diagnóstico de qualidade; execução futura continua serviço separado |
| Confirmação T08 | Capacidade em `WeakMap`, TTY, proposta exata | Mesmo limite local, com apresentação de pixels e recibos distintos para revisão/consentimento |
| `protocol.mjs` / CLI | Protocolo 1, CLI pública só ajuda/versão | Protocolo 2/handshake antes de integração mutável; comandos públicos em T28 |
| SQLite 001 | Tipos textuais livres, estados globais/etapas compatíveis | Sem novas tabelas de qualidade; migração 002 de ativação impede escritor antigo |

O campo legado `carousel.assets[].approved=true` continua um requisito estrutural do conteúdo v1. Não é evidência de consentimento e nunca satisfaz `assets-approval`, `preview-approval` ou revisão. Não se remove esse campo histórico nesta tarefa.

## 2. Convenções pequenas e fechadas

- Objetos aceitam somente as chaves declaradas; JSON simples, sem função, getter, template, HTML, SVG executável, expressão, URI de fonte ou caminho de origem. Não há `extra`, `options` irrestrito nem fragmento de código no plano.
- `Id`: UUID v4 minúsculo conforme `validateIdentifier`; IDs de recursos/layouts são enumerações versionadas do pacote, não UUIDs. `Hash`: 64 caracteres hexadecimais minúsculos, SHA-256. `Version`: inteiro positivo. `Time`: UTC ISO-8601. Números são finitos; índices de lâmina começam em 1.
- `ArtifactRef = {id, kind, version, sha256}`. Resolver sempre no par `brandId/runId` da chamada, verificando linha, bytes, tamanho e confinamento. Um ID não transmite autorização. Referência de outra marca/run é erro, mesmo com bytes iguais.
- `ResourceRef = {id, version, sha256}` para dados do pacote. `QualificationRef = {id,version,sha256,definitionHash}` também é recurso do pacote, não ArtifactRef de outro run; seu `id` é uma identidade fechada de ficha no catálogo. `QualificationEvidenceRef = {id,version,sha256,kind}` usa `kind:qualification-fixture|qualification-metrics|qualification-review`, resolve somente no manifesto de recursos do pacote e contém material sintético sanitizado, sem marca/run privado. Essas referências têm resolvedores distintos do ArtifactRef. `ImplementationRef = {id, files}` conserva o mapa de caminhos relativos do pacote para SHA-256. `files` deve coincidir exatamente com a allowlist declarada, sem chave extra.
- Hash de registro é externo ao próprio registro: bytes UTF-8 de `canonicalJson(record, 1)`, sem BOM/newline adicional. Não inserir o hash integral dentro do objeto que ele identifica. Hash de PNG/ZIP é dos bytes, não do nome ou do JSON.
- Não há resolução por `latest` durante uma tentativa. Versões ficam nos refs e no snapshot; versão textual sem hash não basta. Coleções semanticamente ordenadas preservam a ordem; coleções tratadas como conjuntos são ordenadas antes da canonização.
- A validade estrutural de um objeto é separada de sua elegibilidade produtiva. `validateCompositionPlan` não aprova marca, copy, ficha nem produção.

### Armazenamento e paths

Planos e evidências são artefatos gerenciados. Mantém-se a convenção T12 `runs/{brandId}/{runId}/{allocationId}/{artifactId}.bin`; para resultados de uma tentativa, o segmento `allocationId` será o `renderAttemptId` gerado pelo serviço. O tipo e nome de apresentação ficam nos metadados. Não converter IDs de recurso com `@`, slugs ou texto do usuário em caminho livre.

Os registros de contrato levam refs, não paths. `relative_path` existe somente na tabela de artefatos, sob a raiz do workspace; resolve novamente a cada leitura/promoção com `createConfinedRoot`. Recusar caminho absoluto, `..`, UNC, junction/symlink, aliases Windows e colisão case-insensitive. O destino de staging é exclusivo, promoção não sobrescreve tentativa anterior, e a conferência dos bytes ocorre antes do commit. Uma troca concorrente é bloqueio, nunca autorização por cache de path.

Fontes são resolvidas somente na raiz externa explicitamente autorizada, para leitura e por arquivo/hash permitido. Não entram nos artefatos, snapshots, ZIPs ou backups como bytes. Paths absolutos dessa raiz ficam na configuração local existente, não em relatórios compartilháveis.

## 3. `CompositionPlan@1`

Campos obrigatórios: `schemaVersion:1`, `id`, `brandId`, `runId`, `version`, `snapshotHash`, `carouselRef`, `copyFingerprint`, `conceptRef`, `assets`, `rendererId`, `slides`, `continuities`, `riskInventory`, `previewSelection`, `change`.

- `assets`: refs dos assets criativos usados, cada um acrescido de `assetKey` da entrada canônica; nunca logo ou fonte. Sem assets, lista vazia. `rendererId` é `editorial-composed@1` neste contrato.
- `slides`: uma entrada por lâmina, na ordem canônica, com `{slideIndex, contentRole, layoutId, qualificationRef, surface, blocks, assets, overlaps, decorationChoices}`. `contentRole` conserva `cover|context|content|summary|cta`; `diagram` é papel de layout e não um novo papel de copy. Capa única no índice 1 e CTA no último índice são as condições da família inicial; outro arranjo fica fora desta qualificação.
- `qualificationRef = {id, version, sha256, definitionHash}` aponta registro liberado e permitido pelo snapshot. `surface` é `light|dark`; os tokens resolvem pelo binding de superfície autorizado do tema (§8), não por inversão automática nem hex arbitrário no plano.
- `blocks`: `{id, regionId, source, spans, alignment}`. `id` é único na lâmina; `regionId` vem da ficha; `alignment` é um dos alinhamentos nela permitidos. O plano não transporta `x/y`, CSS ou tamanho livre; a ficha e as opções enumeradas de composição resolvem a geometria.
- `source = {field, start, end}`: `field` é `eyebrow|title|body|code|number`, offsets UTF-16 em intervalo `[start,end)` do campo da própria lâmina. `number` numérico usa exatamente `canonicalJson(number,1)` (incluindo a conversão JSON de −0 para 0 e a notação exponencial quando emitida por JSON); demais campos são strings exatas. Não dividir par substituto nem cluster de grafemas. Quebra visual de linha é metadata de composição, não caractere acrescentado à copy.
- `spans = [{start,end,styleId}]`: intervalos relativos a `source`, ordenados, contíguos, cobrindo-o exatamente; `styleId` pertence à ficha e resolve fonte/peso/cor autorizados. Trechos não repetem uma cópia editável do texto. Somando os blocos em ordem de leitura, cada campo visual deve ser reconstruído integralmente, sem normalizar espaços, acentos, pontuação, caixa ou ordem. Campos `imageAlt`, legenda, CTA geral, hashtags e referências preservam seu papel e bytes editoriais; não são inventados como texto adicional na lâmina.
- A assinatura vem de `snapshot.brand.config.profile`; numeração é metadado técnico. São elementos reservados do renderer, não texto arbitrário acrescentado por `blocks`. `profile` vazio não gera assinatura substituta.
- `assets` por lâmina: `{assetKey,regionId,fit:'contain',anchorIds}`. Âncoras são IDs/posições normalizadas declaradas na ficha e no metadado validado do asset, sem código; PNG de diagrama não autoriza gerar outro diagrama ou modificar suas palavras. Aspecto preservado, sem crop semântico.
- `decorationChoices = [{elementId,optionId}]` seleciona somente opções não semânticas enumeradas na ficha; lista vazia é válida. Não transporta coordenadas.
- `overlaps = [{backElementId,frontElementId,purpose}]`, com `purpose:'highlight-background'|'decorative-underlay'`. Só esses pares podem se intersectar. Não permite ocultar glifos, logo ou informação essencial; não há bypass booleano `intentional:true` para qualquer interseção.
- `continuities = [{from,to,assetKey,anchorPairId,semanticRole}]`, com `to=from+1`, `semanticRole:'decorative'|'supporting'`. Informações essenciais devem estar completas em cada lâmina isolada; dependência essencial da emenda é inválida. Cada referência corresponde à continuidade canônica autorizada.
- `change = {kind,previousPlanRef,correctionEpisodeRef}`: `kind:'initial'|'material'|'bounded-correction'`; refs nulos só quando não aplicáveis. Classificação é recomputada pelo serviço (§11), nunca aceita por declaração do cliente.

`validateCompositionPlan({plan,carousel,assets,qualifications}) -> NormalizedCompositionPlan` é pura, preserva conteúdo e congela a saída normalizada. Relacionamento com snapshot, recursos presentes, liberação da ficha e consentimentos é verificado pelo serviço/gate. Não existe comando de “aprovar plano” genérico: o conceito confirma a direção; a amostra confirma o resultado e o plano exatos.

## 4. `LayoutQualification@1` e fichas candidatas

Campos: `schemaVersion:1`, `id`, `version`, `status`, `definition`, `definitionHash`, `evidenceRefs`, `release`.

- `status:'candidate'|'qualified'|'rejected'`; `definitionHash=canonicalHash(definition)`. Uma mudança de definição exige nova versão. Um registro já salvo é imutável; a liberação é outro registro/versão, sem alterar a definição examinada.
- `definition = {layoutId,rendererId,roles,dimensions,surfaces,regions,styles,limits,continuity,decorationOptions,fontBindings,checkerRef,rubricRef}`. Cada coleção é fechada pelos campos abaixo; `regions` contém `{id,x,y,width,height,kind,readingOrder}`, `styles` contém `{id,fontRole,sizeMin,sizeMax,lineHeight,weight,colorToken,alignment}`. `kind:'text'|'asset'|'brand'|'decoration'`; `colorToken` vem do tema. Limites são valores concretos, não “adequado”/“auto”.
- `decorationOptions = [{id,elementId,anchorId,offsetX,offsetY,visible}]` enumera posições/visibilidade de decoração não semântica já qualificadas; offsets são fixos na ficha, nunca fornecidos pelo cliente. Lista vazia significa que nenhuma correção automática de decoração está disponível. Selecionar opção não enumerada ou mover geometria da ficha exige nova definição/qualificação.
- `fontBindings` lista combinações exatas de papéis/recursos, estilos, pesos/eixos e hashes; nenhuma combinação omitida é suportada. `surfaces` declara somente as testadas. Apoio a duas marcas não autoriza outra família tipográfica sem qualificação.
- `id` desta ficha é identidade de recurso do catálogo, não UUID de artefato de run. `evidenceRefs` é lista de `QualificationEvidenceRef` e identifica fixtures sintéticas, métricas, relatórios e inspeção, com ambiente e hashes; nunca conteúdo privado do ensaio V2. Qualificação é produzida antes dos runs produtivos e suas evidências ficam na allowlist de recursos do pacote; não são resolvidas no brandId/runId da produção. `release` é `null` para candidata; para qualificada/rejeitada contém `{decisionId,decidedAt,reviewEvidenceRef,qualifiedEnvironments}` emitidos pelo processo de qualificação, não por input de produção.
- `qualifiedEnvironments` contém `{platform,arch,node,abi,napi,dependenciesHash,rendererHash,fontBindingsHash}` para cada ambiente efetivamente coberto; não usar um rótulo genérico “Windows” como equivalência. `qualified` exige positivos de todos os limites/superfícies/fontes oferecidos, negativos de primeiro valor excedido e inspeção visual de duas marcas. Qualificação local de compositor não significa CLI/plugin instalado homologado em T33.

**Sem ciclo de qualificação:** os testes internos Q03/Q06 renderizam a `definitionHash` candidata. Evidências apontam essa definição e a identidade do renderer, não o hash futuro da ficha liberada. A ficha liberada referencia essas evidências; planos produtivos apontam a ficha liberada. O harness interno de qualificação não é opção pública `allowUnqualified`, flag do CLI ou entrada do plugin.

### 4.1 Geometria comum proposta

Valores em pixels do canvas 1080 × 1350. São limites candidatos para testar, não homologação nem declaração de acessibilidade universal.

| Item | Proposta numérica |
| --- | --- |
| Área segura de tinta textual | `x≥60, y≥60, right≤1020, bottom≤1310`; qualquer excedente é falha |
| Grade principal | x=72, largura=936; fim do conteúdo principal y=1194 |
| Cabeçalho | y=64, altura=96; eyebrow em x=72, largura máxima=648 |
| Logo habilitado | Caixa x=756/y=64/w=240/h=80; proteção interna 12; altura visível ≥24; aspecto preservado |
| Rodapé/assinatura | x=72/y=1242/w=936/h=60; assinatura ≥24, no máximo 1 linha; sem truncamento |
| Entre blocos independentes | Distância de suas caixas de tinta ≥24; texto/borda da própria superfície ≥12 |
| Corpo principal | Fonte ≥34; entrelinha nominal ≥1,25 × tamanho; sem compressão horizontal/vertical |
| Eyebrow/metadado | Fonte ≥30; 1 linha no cabeçalho; assinatura/numeração podem usar 24 |
| Tinta/caixas | Zero glifos cortados; zero colisões não declaradas; métricas reais de glifos, não contagem de caracteres |
| Contraste interno da política | ≥4,5:1 para todo texto; ≥3:1 para traços informativos/diagramas; transparência calculada na superfície final |
| Diagrama raster | Sem ampliação acima de 1 pixel de saída por pixel de origem; texto semântico ≥34 na saída; traços informativos ≥3 na saída |

A caixa de logo conserva os mínimos da baseline. Logo desabilitado não cria placeholder, assinatura fictícia ou autorização de ocupar área conflitante com o cabeçalho. Nos layouts iniciais a área principal não depende desse espaço extra; a ausência não obriga a reservar um slot visual vazio.

O ratio de contraste é uma política interna inicial: `((LmaisClara+0,05)/(LmaisEscura+0,05))`, luminância relativa sRGB linearizada, usando a cor resultante de cada composição sobre a superfície. Imagem/fundo com contraste não verificável bloqueia; média de uma região não prova o pior par. O corte passa apenas quando todos os glifos ficam dentro das caixas, sem epsilon que tolere perda de tinta; arredondamento geométrico e antialiasing são explicitados nos checkers.

### 4.2 Cinco variantes mínimas propostas

Retângulos na forma `(x,y,w,h)`. Limite de linhas, tamanho e caixa são simultâneos: um tamanho máximo não garante que o número máximo de linhas caiba. O medidor deve escolher somente opções autorizadas que atendam a todos. Nenhum teto de caracteres substitui a medida com fonte real.

| Layout | Papéis de copy | Caixas principais | Tipografia/limites |
| --- | --- | --- | --- |
| `cover-editorial@1` | cover | Título (72,192,936,600); corpo (72,840,936,354) | Título 72–176, entrelinha 1,06, ≤4 linhas; corpo 34–44, entrelinha 1,25, ≤7 linhas |
| `content-flow@1` | context/content/summary | Título (72,192,936,240); corpo (72,480,936,714) | Título 54–112, entrelinha 1,10, ≤3 linhas; corpo 34–44, entrelinha 1,28, ≤15 linhas |
| `content-dense@1` | context/content/summary | Título (72,192,936,168); colunas (72,408,444,786) e (564,408,444,786) | Título 54–72, entrelinha 1,10, ≤2 linhas; corpo 34–38, entrelinha 1,28, ≤16 linhas/coluna e ≤30 no total; leitura integral esquerda→direita |
| `diagram-explainer@1` | context/content/summary | Título (72,192,936,192); asset (72,432,936,504); corpo (72,984,936,210) | Título 54–88, entrelinha 1,10, ≤3 linhas; corpo 34–40, entrelinha 1,25, ≤4 linhas; asset visível ≥720×360, sem deformar |
| `cta-editorial@1` | cta | Título (72,240,936,288); corpo/ação (72,576,936,528) | Título 64–112, entrelinha 1,10, ≤3 linhas; corpo 36–48, entrelinha 1,25, ≤8 linhas; ação usa trecho já existente, não texto gerado |

Regras de fechamento:

1. No máximo 2 colunas, 1 asset semântico principal por lâmina e 2 pares de sobreposição decorativa por lâmina na família inicial. Outros arranjos exigem nova ficha, não campos opcionais livres.
2. `content-flow` tenta `content-dense` somente se ambos estiverem qualificados para aquela identidade. Troca de variante depois da amostra é material. Corpo não cabe em nenhuma: `COMPOSITION_LIMIT_EXCEEDED`; não resumir, ocultar, cortar, retirar acentos nem reduzir abaixo do mínimo.
3. Ocupação por bloco: soma das alturas de linha com espaços interlinhas / altura da caixa ≤1; largura de avanço e tinta de cada linha ≤ largura disponível. Densidade da lâmina é o máximo dessas razões e da razão linhas/limite, em `[0,1]`. Palavra inquebrável além da largura falha; sem hifenização ou escala tipográfica inventada.
4. Destaque de título pode usar `accent` nos intervalos declarados, com os mesmos limites de tinta/caixa. Sem acento autorizado, só ficha explicitamente qualificada sem ele; nunca substituir Nimbus por família aproximada.
5. Superfícies light/dark são combinações a qualificar, não dez aprovações automáticas. Cor de destaque com contraste insuficiente exige token/combinação de tema já autorizada ou decisão sobre marca, sem troca silenciosa.
6. Diagramas existentes com rótulos raster pequenos, dimensão/aspecto incompatível ou metadata insuficiente não recebem passe por terem sido aprovados como conceito. Precisam cumprir medida e revisão de pixels; arte nova depende de autorização própria.
7. As cinco fichas iniciais oferecem regiões para `eyebrow`, `title` e `body`. `code` não vazio ou `number` presente/não vazio (inclusive número 0) retorna `COMPOSITION_FIELD_UNSUPPORTED`; não é omitido nem convertido em corpo automaticamente. `code`/`number` continuam tipos reconhecidos pelo contrato de trechos para uma futura ficha explícita, sem alegar suporte visual atual. `code:""` e `number:""` não acrescentam texto visível. Esta restrição é própria do compositor candidato; não altera a leitura/render legado.

**Origem e limite da proposta:** o relatório V2 existente mede canvas 1080×1350, caixa segura `[60,60,1020,1310]`, corpo 34/42/43, nota 32 e contraste 15,44/5,08. A leitura de `generate-prototype.mjs` mostra títulos até 172 e tratamentos tipográficos distintos. Isso informa a faixa candidata; as caixas, espaçamentos e demais limites acima são proposta nova. A V2 não testou logo, cinco variantes, densidade máxima, 12 lâminas, duas marcas ou Windows. As coordenadas particulares da demo não são um template universal, e o ensaio não é evidência de liberação dessas fichas.

## 5. Seleção de amostra, sem render oculto

`previewSelection = {policyId:'representative-risk@1',slideIndices,reasons,riskInventoryHash,seamPairs}`. `slideIndices` é ordenado, sem repetição e contém somente índices existentes. `reasons = [{slideIndex,codes}]`, com códigos fechados `cover|representative|densest|seam-risk|diagram-risk`; `seamPairs` contém pares adjacentes incluídos, sem imagens fictícias de “emenda”.

O preflight mede texto/caixas/recursos do plano inteiro, mas não rasteriza, compõe SVGs finais nem grava imagens das lâminas fora da seleção. Pode calcular metadados de continuidade necessários à seleção; isso não é autorização de render do lote.

Algoritmo proposto, determinístico:

1. Incluir a capa (índice 1).
2. Nas internas, agrupar por `layoutId + surface + fontBindingsHash + presença de asset semântico`; escolher o grupo mais frequente, desempate lexicográfico nessa chave. Escolher a lâmina mais próxima da densidade mediana do grupo; empate pelo menor índice. Ausência de interna representativa é `PREVIEW_SELECTION_UNSUPPORTED` para esta família.
3. Incluir a interna de maior densidade medida, se ainda não coberta; empate pelo menor índice. Densidade igual a 1 é válida só se todos os limites passarem. Medida desconhecida não vira zero: bloqueia até completar preflight.
4. Havendo diagrama, incluir o de maior risco medido, por menor tamanho efetivo de rótulo, menor traço informativo e maior ocupação, nessa ordem; empate pelo índice. Metadado insuficiente exige inspeção/qualificação do asset, não escolha automática da imagem mais fácil.
5. Havendo continuidade, incluir os dois lados da emenda de maior risco: primeiro assets de apoio semântico, depois menor distância entre elemento de continuidade e tinta textual, depois menor par de índices. Qualquer emenda com distância <48 px de texto/marca, nova sobreposição declarada ou suporte semântico atravessando o corte é risco adicional e também entra. Dependência essencial entre recortes é inválida, mesmo selecionada.
6. A seleção é a união desses itens. Proposta de limite inicial: até 6 lâminas. Se cobrir os riscos exigir mais, bloquear com a cobertura faltante; não omitir riscos para caber. Ampliar a política é decisão explícita/derivação, sem aprovação de lote implícita.

`riskInventory = {slides,seams}` é um campo obrigatório do plano, sem ref de volta ao plano. `slides` contém `{slideIndex,density,fontBindingsHash,layoutId,surface,minDiagramLabelSize,minInformativeStroke}`; as duas medidas de diagrama são nulas somente quando não há asset semântico. `seams` contém `{from,to,semanticRole,minTextDistance,hasDeclaredOverlap,hasSemanticCrossing}`. Medidas são números finitos não negativos; booleanos são calculados pelo preflight, não dispensam checks. `riskInventoryHash=canonicalHash(riskInventory)`; seleção e inventário são persistidos juntos no plano, sem resolver arquivo externo. Uma pessoa pode pedir seleção mais ampla dentro do limite, mas não remover a cobertura mínima. Sua alteração muda `planHash` e `selectionHash` e invalida revisão/consentimento da amostra.

`composeCarousel({carousel,snapshot,plan,resources,selection})` recebe a mesma seleção explícita na amostra e a lista completa no lote; conserva índices e geometria mundial `x=(index−1)×1080`. Só rasteriza as lâminas selecionadas e pares de emenda derivados desses mesmos pixels. Qualquer dependência que exija rasterizar uma lâmina não selecionada produz bloqueio até mudar o compositor ou a seleção visível.

Prova futura Q03/T20: spies de composição/rasterização por índice, zero saída para índices não selecionados, e igualdade de pixels entre amostra e recortes correspondentes do lote no mesmo ambiente/identidade. Selecionar PNGs depois de renderizar tudo não passa esse teste.

## 6. `RenderManifest@2`

Campos: `schemaVersion:2`, `id`, `brandId`, `runId`, `version`, `kind`, `renderAttemptId`, `stageFingerprint`, `snapshotHash`, `inputsRef`, `planRef`, `selection`, `selectionHash`, `renderer`, `runtimeHash`, `resourceManifestHash`, `qualifications`, `fonts`, `upstream`, `files`, `metricsRef`, `createdAt`.

- `kind:'preview'|'final'`; `renderAttemptId` pertence respectivamente à etapa `preview-render|render`, em execução sob token atual. Final inclui todos os índices, amostra somente os selecionados. Mesmo conteúdo não torna manifestações intercambiáveis.
- `selection = {slideIndices,seamPairs,policyId}`; final usa `policyId:'all-slides@1'`, todos os pares aplicáveis e inclui o hash da seleção aprovada em `upstream`. A referência à seleção da amostra não é apagada ao renderizar o lote.
- `qualifications` contém os refs efetivos, sem `latest`; `fonts` contém IDs/hashes e bindings efetivamente resolvidos, que devem coincidir com os esperados do snapshot/ficha.
- `upstream` na amostra contém `{copyApprovalId,conceptApprovalId,assetsEvidenceRef}`; no final acrescenta `{previewManifestRef,previewReviewRef,previewApprovalId,approvedSelectionHash}`. IDs são conferidos no banco, decisão, escopo e fingerprint; não são uma assinatura livre fornecida pelo cliente.
- `files = [{artifactRef,role,slideIndex,pair,mediaType,width,height,size,rgbaSha256}]`. `role:'slide'|'panorama'|'seam'`; `slideIndex` somente para slide, `pair` somente para seam, ambos nulos nos demais. PNG exige `mediaType:'image/png'`, dimensões reais, bytes e hash dos pixels RGBA decodificados. Slides: 1080×1350; panorama final: `1080×N` por 1350; emenda: junção dos dois recortes adjacentes, 2160×1350. Amostra não tem panorama completo.
- `metricsRef` identifica métricas imutáveis de glifos, linhas, caixas, fontes, assets e interseções da seleção. Métricas sem pixels correspondentes não são revisão.
- O manifesto não lista a si próprio, parecer futuro, consentimento futuro, ZIP futuro nem arquivo externo. Relatório objetivo é posterior e referencia o manifesto. Identidade de tentativa, métricas e PNGs é verificada antes do registro `succeeded`.
- No final, o serviço compara cada slide já aprovado na amostra: bytes PNG/SHA-256 e pixels RGBA devem coincidir com a amostra para o mesmo índice. Mesmo ambiente, codificador e recursos são congelados, portanto diferença de metadata/encoding também exige diagnóstico, sem reutilizar consentimento por suposição. As emendas usam a mesma junção 2160×1350 e também devem coincidir. Falha retorna `QUALITY_EVIDENCE_STALE` antes de validate/package, ainda que o teste de igualdade do compositor tenha passado em outro run.

`CompositionResult` transitório contém os índices solicitados, scene graph/SVG interno, métricas e recursos efetivos. SVG interno não integra o ZIP público nem é automaticamente autorizado para publicação; ver gate de fontes. O serviço, e não o compositor, cria IDs, grava arquivos, adquire leases, verifica hashes e persiste sucesso.

## 7. `QualityReview@1`, evidência e confirmação local

Campos: `schemaVersion:1`, `id`, `brandId`, `runId`, `version`, `kind`, `renderAttemptId`, `objectFingerprint`, `reviewProposalHash`, `manifestRef`, `manifestHash`, `planHash`, `selectionHash`, `qualificationRefs`, `objectiveReportRef`, `rubricRef`, `checkerRefs`, `method`, `reviewer`, `confirmationRequestId`, `reviewedAt`, `coverage`, `criteria`, `findings`, `verdict`.

- `kind:'preview'|'final'`; `method:'human-local-assisted@1'` é o único método liberável no Módulo 01. Proposta de modelo pode gerar achados auxiliares, não `QualityReview` aceito ou identidade humana.
- `reviewer = {kind:'human-local',gateway:'local-terminal',sessionId,receiptId}` é preenchido pelo adaptador confiável; sessão/recibo são IDs técnicos, não nome/email do usuário ou `actor` recebido em JSON. Não se alega autenticação forte da pessoa do sistema operacional.
- `objectFingerprint = canonicalHash({contractVersion:2,brandId,runId,kind,renderAttemptId,manifestRef,planHash,selectionHash,qualificationRefs,objectiveReportRef,rubricRef,checkerRefs})`. `manifestHash` deve ser igual a `manifestRef.sha256`; redundância divergente é erro. Ref contém hash; sem autorreferência ao parecer/recibo que ainda será criado.
- `coverage = {files,slides,seams,panorama,fullResolution,mobileWidth}`. `files` lista exatamente `{artifactId,sha256,rgbaSha256,viewedFull,viewedMobile}` de cada imagem requerida. `fullResolution:true` exige inspeção a 1:1 com pan quando necessário; `mobileWidth:360` exige cada lâmina a 360×450. Esses fatos são atestados no gateway, não aceitos como prova de um JSON importado.
- Na amostra, cobertura inclui todos os slides e emendas selecionados, `panorama:null`. No final, todos os slides, panorama completo e cada emenda aplicável. O panorama é inspecionado a 1:1 por janelas e em escala de 1/3 (360 px por lâmina), além da visão geral; encolher o panorama inteiro a 360 px não satisfaz legibilidade móvel.
- `criteria = [{criterionId,target,result,observation}]`, `result:'met'|'failed'|'not-verified'`; `target` identifica slide, emenda ou panorama e uma região/elemento quando aplicável. Critério sem cobertura obrigatória é `not-verified`.
- `findings = [{id,criterionId,target,severity,description}]`, `severity:'blocking'|'advisory'`. Corte, texto ilegível, colisão, conteúdo omitido e identidade errada são sempre blocking; a pessoa não pode recategorizá-los só para passar.
- `reviewProposalHash=canonicalHash({objectFingerprint,confirmationRequestId,coverage,criteria,findings})` identifica exatamente as respostas e o conjunto de pixels que a pessoa confirma. É calculado depois de preencher o checklist, antes de emitir o recibo; não inclui IDs/horários gerados após a decisão nem hash do próprio QualityReview.
- `verdict:'passed'|'failed'|'not-verified'` é derivado pelo serviço: passed só com objetivo passed, todos os critérios obrigatórios met, cobertura completa e recibo válido; failed se há falha; not-verified se falta qualquer prova. Não há média ou nota que compense critério falho.

### Objetivo e rubrica mínima

`ObjectiveReport` é artefato separado com `schemaVersion:1`, escopo/tentativa, `manifestRef`, `checkerRefs`, `checks` e resultado agregado. Cada check: `{code,target,fileHash,expected,observed,result}`, com `result:'passed'|'failed'|'not-verified'`. Campos `expected/observed` têm tipo definido pelo checker, não objetos livres. Checkers iniciais: `copy-exact`, `text-bounds`, `collision`, `typography`, `contrast`, `asset-geometry`, `continuity-independent`, `file-integrity`.

Rubrica `editorial-quality@1`, congelada por versão/hash:

| Critério obrigatório | Inspeção humana exigida |
| --- | --- |
| `legibility` | Todas as palavras e rótulos legíveis integralmente e a 360 px; acentos, símbolos, contraste e densidade |
| `hierarchy` | Ordem de leitura e destaque principal inequívocos, sem competir com o logo/rodapé |
| `composition` | Equilíbrio, alinhamento, respiro, elementos intencionais e ausência de colisão visual |
| `rhythm` | Relação das lâminas, variação coerente e continuidade sem sacrificar leitura isolada |
| `visual-semantics` | Diagrama/âncoras explicam o trecho correto; sem sugerir relação ou prova inexistente |
| `brand-finish` | Tema, fonte, assinatura/logo e acabamento correspondem à revisão de marca, sem identidade alheia |

Na amostra, `rhythm` cobre a relação das lâminas e emendas efetivamente selecionadas; não alega revisão das internas ausentes. No final, aplica-se a todo o conjunto/panorama. Geometria aprovada não prova legibilidade/editorial. Check indisponível, bbox aproximada sem cobertura de glifos, incapacidade de mostrar pixels ou falta de revisor bloqueiam, com o código apropriado.

### Operações propostas e limite de autoridade

- `requestQualityReview({brandId,runId,kind,manifestId,requestId})`: verifica gate/bytes e cria pedido idempotente; retorna refs dos arquivos exatos, rubrica e próxima ação. Na amostra, o serviço `preview-review` produz/verifica primeiro o relatório objetivo sobre o manifesto, fora da transação, antes de abrir o pedido humano. Não exige review prévio nem inventa uma décima segunda etapa. Não concede aprovação.
- `getQualityReview({brandId,runId,reviewId})`: consulta e revalida integridade/vigência, sem mutar.
- Adaptador humano interno apresenta arquivos, hashes, escalas e checklist; captura resultados e confirmação explícita, mostra o resumo final das respostas e emite capacidade não serializável ligada a `reviewProposalHash` e ao pedido/objeto exibidos. O serviço recebe essa capacidade por chamada interna, nunca `actor`, `reviewedBy`, `approved`, `receiptId` livre ou uma operação pública de grant.
- Em transação curta, revalida versão do run, ausência de tentativa conflitante, pedidos, bytes/identidades verificados e capacidade para o `reviewProposalHash` recalculado. Alterar coverage/criteria/findings depois da confirmação invalida a capacidade. Persiste parecer imutável, resolve `confirmation_requests` e atualiza etapa/evento atomicamente; consome capacidade só após commit. Mudança entre apresentação/confirmação: stale, sem commit parcial.
- A leitura dos pixels ocorre fora da transação e sem lease de render. Atestação diz o que foi exibido e confirmado, não prova contra processo/pessoa hostil com acesso irrestrito aos módulos/banco/arquivos. CLI não interativa e plugin não podem emitir capacidade local.
- Consentimento `preview-approval` é outro pedido/recibo/registro em `approvals`; aponta amostra revisada, plano, seleção e review exatos. Aprovar amostra não produz review; preencher review não autoriza lote.

## 8. `RunSnapshot@2` e identidade de recursos

Preservar os campos de v1, acrescentando `pipelineVersion:2`, `qualityPolicyVersion:1`, `qualityPolicy`, `qualifications`, `fontBindings` e `resourceManifestRef`; mudar `schemaVersion:2`, `contractVersion:2`, mantendo `canonicalVersion:1`.

- `approvalPolicy = {mode:'guided',required:['copy','concept','creative-assets','preview']}`. Creative-assets pode ter evidência tipada `not-applicable`; conceito, amostra e reviews nunca herdam esse estado.
- `qualityPolicy = {id:'quality-policy@1',sha256,samplePolicyRef,rubricRef,checkerRefs,mobileWidth:360,maxCorrectionRounds:2,maxPreviewSlides:6}`. `sha256` identifica o recurso de política separado, não o snapshot que o referencia.
- `qualifications`: allowlist dos registros liberados com hash da definição; sem candidatos. Snapshot novo não pode ser criado para produção antes de existir ao menos uma combinação completa necessária liberada. Ambiente/recurso ausente pode permitir draft bloqueado, mas nunca liberar render.
- `renderer` e `runtime.renderer` devem coincidir com o compositor efetivamente escolhido; novo render produtivo usa `editorial-composed@1`, histórico/regressão conserva `legacy-panorama@1`. Hash de arquivos identifica módulos reais de composição, medição, geometria e checks, não apenas rótulo.
- `fontBindings = [{role,fontId,sha256,style,weight,axes}]`, role `title|body|mono|accent`; IDs baseline preservados, acento candidato `nimbus-roman-italic@1`. `axes` é mapa fechado pelos eixos do recurso, valores dentro da faixa autorizada. Nimbus requer italic real; não simular oblíquo. Fonte/configuração/liberação seguem [quality-font-gate.md](quality-font-gate.md).
- `fonts` mantém ID/hash esperados; recursos efetivos são comparados antes de cada render e no manifesto. A associação de acento é explícita na revisão da marca, opcional e sem default pessoal. V1 continua com três fontes, sem preencher acento fictício. O gate de disponibilidade verifica o subconjunto efetivamente exigido pelo plano/fichas; um recurso opcional não usado não bloqueia outro layout.
- `resourceManifestRef` aponta manifesto de recursos 2. Ele lista separadamente os dois renderers, arquivos obrigatórios, fichas, política, rubric/checkers e recursos de fonte autorizados. Mudar arquivo/módulo/checker sem nova identidade é mismatch/incomplete.
- `brand.config` v1 não é regravada. Configuração v2 acrescenta `configVersion:2`, `fonts.accent` opcional com o ID fechado permitido e `themes[themeId].surfaceBindings` opcional; o restante mantém validação estrita. Ausência de `configVersion` identifica a forma histórica v1, somente no leitor compatível. Q02 versiona a validação sem tornar qualquer ID/path de fonte válido. Mudança persistente de marca ainda requer confirmação própria.
- `surfaceBindings` é mapa fechado com chaves `light` e/ou `dark`; cada valor é `{background,text,muted,accent,secondaryAccent?}` cujos valores são nomes de tokens existentes no mesmo tema (`background|text|muted|accent|secondaryAccent`). Token ausente é erro. Assim cada superfície resolve um conjunto exato de cores já confirmadas, com o mapeamento também confirmado/versionado; usar `text` como fundo escuro requer esse binding explícito. `styles.colorToken` seleciona o papel do binding da superfície atual, nunca uma cor global de outra superfície. A variante de logo usa a mesma chave.
- Tema histórico sem `surfaceBindings` oferece só suas cores originais, sem permutar: a superfície primária é classificada `light` quando a luminância relativa sRGB de background ≥0,5 e `dark` abaixo disso. Essa classificação técnica só seleciona a chave/variante de logo; não muda cor nem prova contraste. A outra superfície é indisponível. Alternância claro/escuro no composto exige bindings autorizados e qualificação de ambas; não nasce da aprovação genérica de uma paleta.

Snapshot não contém plano, seleção escolhida, manifesto de render, review ou consentimento futuro. Todos são artefatos descendentes. `materialReferences` de derivação continua apenas material explicitamente selecionado da origem; nunca inclui aprovação herdada como autorização.

## 9. Pipeline 2, tipos, estados e gate central

Tipos são constantes explícitas. Dependência imediata abaixo é transitiva; os vínculos por hash continuam obrigatórios.

| Etapa | Tipo | Depende de | Evidência de sucesso |
| --- | --- | --- | --- |
| inputs | input | — | Inputs+plano estruturalmente íntegros |
| copy-approval | approval | inputs | Consentimento da copy exata |
| concept-approval | approval | copy-approval | Conceito/direção vinculados à copy |
| assets-approval | approval | concept-approval | Consentimento de assets ou no-assets tipado |
| preview-render | execution | assets-approval | Manifesto preview e seleção íntegros |
| preview-review | review | preview-render | Objetivo preview passed + review preview passed |
| preview-approval | approval | preview-review | Consentimento humano da amostra/plano/seleção/review |
| render | execution | preview-approval | Manifesto final e lote íntegros |
| validate | execution | render | ObjectiveReport final passed |
| quality-review | review | validate | QualityReview final passed e cobertura integral |
| package | execution | quality-review | ZIP allowlisted, íntegro e cadeia revalidada |

Estados globais preservados: `draft|ready|running|waiting-approval|blocked|interrupted|completed|cancelled`. Estados de etapa preservados: `pending|waiting-approval|running|succeeded|failed|invalidated`. `review` não usa `running` para espera humana nem cria `step_attempts` de render; seu pedido fica `waiting-approval`. Eventos novos: `review-required` (`pending→waiting-approval`), `review-passed` (`waiting-approval→succeeded`), `review-failed` (`waiting-approval→failed`) e `review-unavailable` (etapa permanece pending/waiting; run blocked). `invalidate/reset` seguem o modelo existente. Parecer negativo registrado é failed; cancelamento de pedido não inventa parecer negativo.

No run, `review-required` leva ready/running a waiting-approval depois de encerrar/liberar a tentativa; `review-passed` retorna ready; `review-failed` leva blocked. Bloqueio por indisponibilidade em waiting-approval requer transição explícita `block` para blocked, acrescida em Q04. Não mandar evento de approval para fingir review. Espera de consentimento usa os eventos de approval existentes. Uma revisão com bytes stale é invalidada e pede a ação correta.

`ready` significa inputs utilizáveis/etapa anterior encerrada, não autorização genérica. Projeção inclui `quality:{policyVersion,status,preview,final}`, com status `not-evaluated|pending|blocked|passed`, mais `pending:{stage,code,objectId}` e `nextAction:{type,available,requires,objectId}`. V1 usa `not-evaluated`; v2 passed só após cadeia final verificada. `waiting-approval` distingue `EDITORIAL_REVIEW_REQUIRED` de `PREVIEW_APPROVAL_REQUIRED`.

### `assertProductionGate`

Assinatura proposta: `assertProductionGate({run,phase,kind,artifacts,approvals,reviews})`. `phase` é `preview|render|validate|review|package|complete`; `kind` só é requerido em review (`preview|final`). Retorna refs/fingerprints verificados ou erro tipado; não muda estado, cria parecer nem concede autorização.

| Chamada | Antecedentes exigidos, além de escopo/versões/arquivos/recursos |
| --- | --- |
| preview | Inputs/plano/fichas aptos, copy/conceito/assets válidos; nenhum review/consentimento da própria amostra |
| review + preview | Manifesto preview vigente e resultado objetivo da seleção; não exige o review que será produzido |
| render | Todos os anteriores + preview-review passed + preview-approval exata |
| validate | Lote atual íntegro e autorização de render; não exige validate nem review final ainda inexistentes |
| review + final | Lote + ObjectiveReport final passed; não exige parecer final prévio |
| package | Lote/validate/review final vigentes, amostra/consentimentos e política preservados |
| complete | Tudo de package + ZIP real verificado, tentativa atual e commit sob fencing válido |

O serviço aplica gate no começo de cada fase e novamente antes do commit mutável pertinente. Package verifica antes de abrir o ZIP e antes do commit/completed. Leases/fencing protegem execução/gravação, não servem como consentimento. Recuperação revalida antes de reutilizar; CLI, plugin e chamadas diretas de serviço não têm caminhos alternativos para marcar sucesso.

O ZIP público permanece slides, panorama, legenda e referências. Package/evidência interna vincula cada membro aos bytes, mas não acrescenta relatório privado, plano, dados de marca, fontes, SVGs de origem ou código ao ZIP. Falha de ZIP não descarta evidência válida anterior. Script legado direto pode gerar arquivos de ensaio/regressão; não grava sucesso v2 nem importa uma entrega como completed sem a cadeia.

## 10. Fingerprints e ausência de circularidade

`fingerprintVersion:2` usa `canonicalVersion:1`, escopo `{brandId,runId}`, etapa, snapshotHash e identidade do executável. Conservar a função v1 byte a byte para consultar o histórico. A consulta v1 usa a identidade executável e entradas persistidas na versão histórica; não chama `executable()` de T12 para substituir hashes por módulos/manifesto atuais, não recanoniza sob outra versão e não regrava fingerprint. Alteração do executável pode invalidar mais que uma alteração de dados porque sua identidade é parte do contexto; não prometer preservação de aprovações com runtime diferente.

| Identidade | Componentes específicos além do contexto comum |
| --- | --- |
| Copy | Projeção editorial já usada em v1, integral e ordenada |
| Conceito | Fingerprint copy, hash conceito, visualSlots/continuidade canônicos |
| Assets | Fingerprint conceito + conjunto ordenado assetKey/hash |
| Inputs | Carousel/conceito/assets + planRef; aptidão estrutural não concede autorização |
| Preview-render | Assets fingerprint + planHash + qualificationRefs + seleção/riskInventory + bindings/fontes/renderer |
| Preview-review | Manifesto preview, tentativa, pixels/métricas + ObjectiveReport + rubric/checkers |
| Preview-approval | Preview-review ref/hash + manifesto + planHash + seleção + snapshot |
| Render | Plano/recursos idênticos + preview-approval verificada + seleção completa |
| Validate | Manifesto final/tentativa + arquivos/métricas + checkers/qualificação |
| Quality-review | Manifesto final + ObjectiveReport final + rubric/checkers + cobertura requerida |
| Package | Manifesto final + validate + quality-review + textos da entrega + política/allowlist |

O fingerprint de início de uma etapa não inclui sua própria saída futura. Resultado contém o fingerprint de entrada; a etapa seguinte referencia a saída. Exemplo de encadeamento, sem hashes fictícios:

`Snapshot S → plano P → preview M → objetivo O → review R → consentimento A → final F → validate V → review Q → package Z`.

S não referencia P; P referencia S/fichas; M referencia P e arquivos já produzidos, nunca R/A; O referencia M; R referencia M/O e o pedido cuja identidade foi calculada antes de R; A referencia R/M/P; F referencia A e seu próprio conjunto de arquivos; V referencia F; Q referencia F/V; Z referencia Q/F. As qualificações vêm da cadeia independente `definição candidata → fixtures → evidências → ficha liberada` (§4), não de S. Assim não é necessário hash fixpoint, aprovação de uma amostra inexistente ou permissão circular para gerar evidência.

## 11. Invalidação seletiva e duas rodadas

Reuso exige bytes, escopo, versões, classificação e fingerprints conferidos. Não apagar histórico; marcar dependências inválidas no estado atual e criar artefatos imutáveis sucessores. Mesmo quando uma lâmina mudou, a unidade de tentativa continua a etapa inteira (amostra selecionada ou lote completo); não há resume produtivo por lâmina neste módulo.

| Alteração | Preservação possível, se igual e verificada | Invalidar/exigir |
| --- | --- | --- |
| Copy, inclusive espaços/pontuação/ordem | Somente histórico anterior | Copy-approval e tudo posterior; plano/seleção reconstruídos |
| Conceito | Copy-approval | Conceito, assets dependentes, amostra, lote e sucessores |
| Asset criativo | Copy/conceito | Assets-approval, plano afetado e etapas posteriores |
| Plano material: layout, superfície, fonte/peso, destaque, ordem de leitura, posição/escala semântica, âncoras ou continuidade | Copy/conceito/assets se efetivamente idênticos | Nova amostra, revisão/consentimento, lote e sucessores |
| Seleção ou pixels de amostra | Copy/conceito/assets | Preview-review/approval e lote/sucessores; novo preview-render se bytes/seleção mudaram |
| Pixels do lote com plano/recursos iguais | Consentimento de direção exato | Validate, review final, package; amostra deve continuar pixel-equivalente nos índices selecionados |
| Rubrica/checker/política/ficha/fonte/renderer/marca congelados | Run anterior íntegro | Derivação v2 e novos gates; não editar snapshot |
| Falha isolada de ZIP | Render, validate, review final íntegros | Só package; revalidar tudo antes de usar |
| Parecer/arquivo adulterado ou outra tentativa | Nada dependente desse objeto | Bloquear; não reaproveitar hash/nome plausível |

**Correção limitada não material:** exclusivamente ajuste de decoração não semântica, sem trocar plano semântico, fonte/tamanho/peso, superfície, layout, asset, texto ou seleção. Pode escolher outra opção de visibilidade/âncora já enumerada e qualificada em `definition.decorationOptions`, removendo decoração ou deslocando-a até 12 px em cada eixo em relação à opção anterior, mantendo seu mesmo domínio seguro e distância ≥24 px da tinta/branding. Mudança acima disso, qualquer ambiguidade ou elemento semântico é material. A lista é fechada; “parece pequeno” não classifica. O registro `adjustments` descreve a troca de `optionId` e seu delta verificado, não concede coordenadas novas. Se a ficha/plano não oferece opção correspondente, a correção não está disponível e pede decisão; não se altera `definitionHash` para contornar essa regra.

Como o plano exato mudou, até uma correção limitada precisa gerar novo preview/render e revisão das dependências, e atualizar o consentimento da amostra para o novo plano quando aplicável. Isso não zera a rodada. Preservar consentimento sem nova amostra só é admissível quando plano/recursos/seleção e pixels amostrados continuam exatamente iguais, como na repetição de um lote interrompido. Não criar uma classe de mudança silenciosa entre imagem aprovada e entregue.

`quality-correction-episode` é artefato interno imutável/versionado com `{id,episodeId,brandId,runId,version,seedPlanRef,scopeFingerprint,rounds,reservation,closedReason}`; `episodeId` é estável, `id` identifica cada versão de artefato. Cada round fechado contém `{number,defectRefs,previousPlanRef,newPlanRef,adjustments,attemptIds}`. `number` somente 1 ou 2 após o resultado inicial (round 0). Ajustes são enumeração `remove-decoration|move-decoration-anchor`, com deslocamentos numéricos limitados.

Persistência em duas fases, sem ciclo: primeiro salvar uma versão de episódio com `reservation:{number,previousPlanRef,defectRefs,adjustments}` e somente rounds anteriores; o novo plano referencia esse artefato de reserva já existente em `change.correctionEpisodeRef`. Depois, salvar versão posterior do episódio com `newPlanRef`, round fechado e `reservation:null`. Não atualizar o plano para apontar o episódio posterior nem regravar registros. Serviço reserva a rodada em transação antes do novo ajuste; reserva já consome uma das duas rodadas. Crash/resume/rejeição não a devolve nem reseta; reconciliação pode concluir a mesma reserva/ajuste sem nova rodada. Repetir a mesma execução/round sem ajuste novo não é terceira correção.

A terceira mudança automática retorna `QUALITY_CORRECTION_LIMIT`; resultado continua bloqueado e pede decisão. Mudança material explicitamente aprovada pode abrir outro episódio com nova identidade e vínculo ao anterior, sem apagar rodadas. Não se interpreta “corrigir” como autorização para reescrever copy ou identidade. Os retries transitórios de arquivo continuam separados (duas repetições, 500/1500 ms); erros de autorização, recurso, config ou hash não recebem retry automático.

## 12. SQLite: tipos suficientes; ativação incompatível exige migração 002

A inspeção de `001-initial.sql` confirma:

- `artifacts.kind`, `steps.step_key`, `confirmation_requests.kind`, `approvals.kind` e `run_events.event_type` são TEXT sem enum restritiva. Todos os novos registros cabem neles; `metadata_json/evidence_json` admitem os dados versionados.
- Estados existentes comportam revisão como espera/sucesso/falha e os estados globais mantidos; não acrescentar valor SQL `reviewing`.
- Snapshots, artefatos e revisões já têm triggers de imutabilidade; FKs por marca/run permitem isolamento. Evidência de review pode ser artefato e pedido confirmado, sem poluir `approvals` de consentimento.
- O aplicativo antigo valida somente `PRAGMA user_version=1` e T12 não despacha explicitamente `snapshot.schemaVersion`. Deixar banco em 1 após criar runs v2 permitiria um escritor antigo interpretar estado novo inadequadamente. Handshake sozinho não protege chamadas diretas do binário antigo.

**Decisão proposta:** nova migração real `002-quality-contract-activation.sql`, em Q04, adiciona somente `workspace_contract_activation` (singleton, `contract_version=2`, `pipeline_version=2`, `minimum_protocol_version=2`, `quality_policy_version=1`, `activated_at`). Registra a própria versão/checksum e eleva `user_version` para 2, sem reescrever uma linha histórica de run/snapshot/approval. A tabela tem uma única linha imutável de ativação; mudança futura requer nova migração. Sua função é compatibilidade operacional, não armazenar o produto de novo em um segundo banco.

Preservar `001-initial.sql` e seu SHA-256 `b44eaae8591b96af5ba6a0d66983c4ef885552402042c99ade5f0530b69a9181`. Nada de migração vazia, editar CHECK antigo ou preencher etapas fictícias. Binário antigo recusa workspace ativado com `SCHEMA_TOO_NEW`, inclusive consultas; o binário novo lê histórico v1 sem mutá-lo. O novo leitor suporta bancos 1/2 em leitura; operações mutáveis de produção v2 exigem ativação 2 explícita. Instalar ou consultar não ativa.

### Ativação sem ciclo com T24/T26

Q04 deve definir/testar o migrador mínimo de ativação usando a coordenação de manutenção T06 existente. Não depende do backup geral T24, que vem depois na cadeia; não executa migração real por Q01 ou por mera aprovação de G1.

Para um workspace existente, a operação explícita de ativação futura deve:

1. Exigir runtime compatível e schema 1 íntegro/checksum correto. Adquirir manutenção exclusiva T06 (`purpose:'quality-contract-activation'`), sem leases/tentativas ativas, com renovação e token conferido até o commit.
2. Fazer backup SQLite consistente pela API nativa em destino novo, mais manifesto de versão/checksum/hash. Verificar a cópia fechada com integridade/FKs. Os artefatos originais são imutáveis e não serão tocados pela migração; para reversão externa independente, conservar também cópia verificada dos arquivos referenciados, sem fontes. Não anunciar rollback completo com só o banco se os arquivos não estiverem preservados.
3. Se a cópia/restauração mínima ou exclusão de mutações não puder ser provada, abortar antes de ativar. Não copiar banco aberto via filesystem presumindo consistência nem ignorar lock expirado.
4. Em transação curta, revalidar posse/token/versão/ausência de tentativa e aplicar 002, metadados e `user_version=2` atomicamente; conferir esquema e hashes de snapshots depois. Renovar/liberar manutenção com o leitor versionado, para que a própria mudança de schema não invalide o release do lock.
5. Se falhar antes do commit, rollback transacional. Depois do commit, recuperação usa a cópia fechada preservada em workspace novo, sob procedimento explícito de restore; jamais downgrade in-place ou editar user_version manualmente. O destino original é preservado para diagnóstico.

Workspace vazio pode inicializar com 001+002 como criação explícita, sem backup de dados inexistentes. Q04 testa migração/rejeição de escritor antigo em dados sintéticos. Ativação em workspace real continua bloqueada até o procedimento mínimo de backup/manutenção/reversão ter evidência e autorização própria. T24/T26 continuam responsáveis pelo backup/restore geral; não se declara sua conclusão por implementar essa salvaguarda pontual.

### Tipos persistidos propostos

`composition-plan`; `layout-qualification` (cópia de evidência/definição permitida, sem fontes); `render-manifest:preview|final`; `render-slide:preview:{index}|final:{index}`; `render-panorama:final`; `render-seam:{kind}:{from}-{to}`; `composition-metrics:{kind}`; `objective-report:{kind}`; `quality-review:{kind}`; `quality-correction-episode`; `package` e seu manifesto interno. Índices são validados, não fragmentos arbitrários de kind/path. Versionamento é por kind dentro de marca/run, como a UNIQUE existente.

Pedidos de confirmação usam `review-preview|review-final` para atestação e `copy|concept|creative-assets|preview` para consentimento. Apenas os últimos produzem linha de `approvals`; parecer vem do artefato, pedido confirmado e recibo validado. `run_events` registra IDs técnicos/códigos saneados, sem colar conteúdo privado. `operations` mantém requestId/payloadHash/replay para impedir duplicação após resposta perdida.

## 13. Compatibilidade v1/v2 e protocolo 2

| Caso | Comportamento exigido |
| --- | --- |
| Consulta de run v1 pelo novo aplicativo | Grafo de 7 etapas e hashes v1, status histórico intacto; `quality.status:'not-evaluated'` |
| Run v1 completed | Consulta/exportação já existente pode verificar seus bytes; nunca recebe selo novo; não regenerar nem adicionar aprovação |
| Resume produtivo de v1 | `RUN_DERIVATION_REQUIRED`; material selecionado pode originar v2, sem herdar consentimentos |
| Snapshot v2 com pipeline/contrato incoerentes | `RUN_CONTRACT_UNSUPPORTED`; não tentar interpretação parcial |
| Banco 1 sem ativação | Consulta compatível sem mutação; produção v2 pede `WORKSPACE_ACTIVATION_REQUIRED` |
| Binário antigo no banco 2 | Recusa antecipada `SCHEMA_TOO_NEW`; usar novo aplicativo para consulta histórica |
| Restore v1/v2 | Preservar IDs/hashes/decisões existentes, verificar recursos; fonte ausente bloqueia render, não apaga história |
| Mesmo package v2 completed | Revalidar cadeia e bytes, retornar resultado; não iniciar render para “atualizar” uma entrega concluída |

Handshake proposto para T28/T29: operação somente leitura `handshake`, envelope `{protocolVersion:2,ok,data,error,nextAction}`. `data` inclui `package:{name,version}`, `protocolVersion:2`, `supportedSnapshotVersions:[1,2]`, `supportedPipelineVersions:[1,2]`, `productionContractVersion:2`, `qualityPolicyVersions:[1]`, `schemaReadVersions:[1,2]`, `schemaWriteVersion:2`, `capabilities:['quality-review-request','quality-review-query','human-preview-consent']` somente quando implementadas.

O cliente/plugin informa `protocolVersion:2` em cada invocação mutável automatizada e verifica os campos/capacidades antes de chamar. Cliente com protocolo/grafo antigo ou campo desconhecido obrigatório recebe `PROTOCOL_INCOMPATIBLE`, exit 2, mensagem fixa “Cliente incompatível com o contrato de qualidade 2. Atualize a integração; nenhum comando de produção foi executado.” Não há downgrade, fallback a script legado nem flag de compatibilidade que permita produzir. `--help/--version/handshake` não mutam workspace. A CLI humana local usa o mesmo serviço/gate e seu próprio adaptador de confirmação.

## 14. Erros e próximos passos

Preservar erros existentes (`INVALID_ARGUMENT`, `RUN_VERSION_CONFLICT`, `ARTIFACT_HASH_MISMATCH`, `SNAPSHOT_HASH_MISMATCH`, `RESOURCE_MISSING`, `RUNTIME_MISMATCH`, `PACKAGE_INCOMPLETE`, `PATH_NOT_CONFINED`, `WORKSPACE_MAINTENANCE`, erros de lease/fencing). Não converter causa bloqueante em warning. Mensagens públicas são fixas/saneadas; detalhes privados ficam em evidência local autorizada.

| Código novo proposto | Significado e ação |
| --- | --- |
| `COMPOSITION_INVALID` | Plano não reconstitui copy/refs/ordem; corrigir entrada explicitamente |
| `COMPOSITION_FIELD_UNSUPPORTED` | Campo visual code/number não coberto pelas fichas iniciais; escolher ficha futura qualificada ou decisão explícita de conteúdo |
| `COMPOSITION_LIMIT_EXCEEDED` | Material não cabe na ficha; escolher variante qualificada ou pedir decisão sobre conteúdo/design |
| `LAYOUT_NOT_QUALIFIED` | Ficha candidata/ausente/ambiente não liberado; concluir qualificação |
| `PREVIEW_SELECTION_UNSUPPORTED` | Cobertura mínima impossível ou acima de 6; decidir novo escopo, sem omitir risco |
| `PREVIEW_REQUIRED` | Amostra inexistente/inválida; gerar somente amostra autorizável |
| `PREVIEW_APPROVAL_REQUIRED` | Review válido, consentimento ausente; confirmação humana local da amostra exata |
| `EDITORIAL_REVIEW_REQUIRED` | Review ainda não feito; apresentar pixels e rubrica localmente |
| `QUALITY_REVIEW_UNAVAILABLE` | Capacidade/revisor/pixels indisponíveis; resolver recurso, sem passe automático |
| `QUALITY_EVIDENCE_INCOMPLETE` | Cobertura/check ausente ou not-verified; completar evidência |
| `QUALITY_EVIDENCE_STALE` | Bytes/versões/escopo/tentativa divergem; invalidar dependências e revisar objeto atual |
| `QUALITY_CHECK_FAILED` | Controle objetivo falhou; corrigir dentro do escopo ou pedir decisão |
| `QUALITY_REVIEW_FAILED` | Critério editorial blocking; corrigir com nova evidência |
| `QUALITY_CORRECTION_LIMIT` | Duas rodadas consumidas; aguardar decisão humana |
| `FONT_LICENSE_UNVERIFIED` | Escopo necessário de uso não verificado; consultar gate de fontes |
| `FONT_USE_UNAUTHORIZED` | Uso dependente de decisão/autorização faltante; não instalar/substituir por conta |
| `RUN_CONTRACT_UNSUPPORTED` | Versão/combinação de contratos sem leitor válido; atualizar integração |
| `RUN_DERIVATION_REQUIRED` | Produção v1 não pode continuar sob política nova; derivar v2 |
| `WORKSPACE_ACTIVATION_REQUIRED` | Banco ainda 1; ativação explícita segura antes de produção v2 |
| `PROTOCOL_INCOMPATIBLE` | Cliente não compreende contrato 2; atualizar cliente |

Estrutura inválida/versão de protocolo: exit 2. Bloqueio de domínio: exit 1. Consulta correta de run bloqueado: exit 0 e `ok:true`, com pendência explícita. `nextAction` do envelope pode preservar mensagem legível; `data.nextAction` usa o objeto tipado descrito no read model. Nenhum erro acima aceita `--force`/`--yes` como resolução.

## 15. Decisões G1, tarefas e evidência de Q01

### Decision log

| ID | Proposta/decisão de projeto | Justificativa e pendência |
| --- | --- | --- |
| D01 | Contrato/snapshot/pipeline 2, canonização 1 | Isola histórico e grafo; G1 aprova nomes/versões antes de Q02/Q04 |
| D02 | Cinco layouts candidatos, limites §§4–5 | Cobre papéis mínimos e denso sem catálogo aberto; G1 aceita limites para testar, Q03/Q06 qualificam de fato |
| D03 | Preview até 6, seleção determinística por risco | Evita amostra só fácil e render oculto; acima do limite pede decisão |
| D04 | Review humano local assistido, consentimento separado | Reutiliza fronteira T08 sem fabricar ator; nenhuma dependência de modelo vision em produção |
| D05 | Referências unidirecionais, ficha candidata só em teste | Remove ciclos qualificação/amostra/consentimento |
| D06 | Acento `nimbus-roman-italic@1` opcional, sem fallback | Uso/disponibilidade e formatos são decisões separadas no gate de fontes; não autoriza instalação |
| D07 | Tipos SQL atuais bastam, mas migração 002 de ativação é necessária | Impede escritor antigo pelo user_version; acrescenta metadado real, não refaz 001 |
| D08 | Salvaguarda pontual de migração em Q04 usa T06 | Evita ciclo com backup geral T24; ativação real somente depois de cópia/reversão testadas e autorizadas |
| D09 | Correção automática estrita, até 2 rounds persistentes | Sem mudança de copy/marca; alteração de plano exige nova evidência/consentimento aplicável |
| D10 | Protocolo 2 obrigatório para produção | Uma barreira comum no serviço/CLI/plugin/resume/package; histórico continua consultável pelo leitor novo |

### Decisões solicitadas antes de Q02

1. Aceitar os contratos, cinco fichas candidatas, limites numéricos e seleção de amostra (incluindo limite de 6), como alvo de teste, sem chamar fichas de qualificadas.
2. Escolher o caminho de fontes descrito em `quality-font-gate.md`: recurso exato autorizado no ambiente alvo ou alternativa explicitamente aprovada e requalificada. A ausência de Nimbus nos locais Windows inspecionados não autoriza download/instalação e não invalida por si só os PNGs cloud existentes.
3. Aceitar migração 002 e a salvaguarda pontual de ativação como ajuste detalhado de Q04, mantendo T24/T26 gerais em aberto. A aprovação da proposta não autoriza executar a migração num workspace real.
4. Autorizar Q02 isoladamente, se desejado; Q01 não libera o restante. Q02 pode implementar validação estrutural, ID/binding opcional externo e diagnósticos de recurso ausente/não autorizado, mantendo Nimbus bloqueada no ambiente sem recurso. Isso não depende de instalar a fonte nem permite qualificar/reproduzir a V2 sem o gate resolvido; Q03/Q06 e uso produtivo continuam dependentes dos recursos exatos autorizados. Aceitar a modelagem opcional do acento não é autorizar seu uso/instalação.

### Rastreabilidade mínima

| Aceite | Onde o contrato fecha o requisito | Implementação/prova futura |
| --- | --- | --- |
| AC33 | §§3–4,8 | Q02/Q03/Q06/T33: cinco variantes, duas marcas, limites e ambientes reais |
| AC34 | §§5–6,9–10 | Q04/Q05/T15/T20/T21: seleção real, sem lote oculto, review e consentimento |
| AC35 | §§4,7,14 | Q02/Q03/Q06/T21: negativos de corte/colisão/contraste/fonte/overflow e not-verified |
| AC36 | §§7,9 | Q05/Q06/T21/T22/T30/T33: cobertura integral, duas escalas, bloqueios stale/falta/falha |
| AC37 | §§10–11 | Q04/Q05/T16/T23: matriz seletiva, bytes/tentativa, falha isolada de ZIP |
| AC38 | §§4,11 | Q02/Q05/Q06/T16/T23/T30: round 3 bloqueado, copy preservada, resume sem reset |
| AC39 | §§7,9,12–14 | Q05/T22/T28/T29/T30: ator/booleano/import direto/cliente antigo não concedem produção |
| AC40 | §§8,12–13 | Q04/T23–T26/T32/T34: histórico v1 imutável, ativação segura, restore sem selo inventado |
