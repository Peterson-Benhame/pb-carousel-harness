# Q06 — Controles objetivos e qualificação das fichas

> Cópia pública sanitizada: registros privados de conversa e execução foram omitidos. Estados e resultados técnicos abaixo descrevem a etapa original, não uma certificação da versão atual.

Base: `9e824b5` (Q03). Data: 16/10/2026. Implementação técnica interna concluída, com revisão independente aceita e testes Linux/Windows executados; **homologação e liberação estética continuam pendentes, nenhuma ficha foi liberada para produção**. As cinco definições permanecem `candidate`, `release:null`, sem `evidenceRefs` fabricados. Revisão por IA não foi convertida em inspeção humana, consentimento, recibo ou decisão de qualificação.

## Entrega e fronteira

- `src/quality/objective-checks.mjs`: `evaluateRenderedQuality({manifest,composition,files,qualification})`, assíncrona, sem gravação ou mudança de estado.
- `src/quality/review-rubric.mjs`: `getReviewRubric(1)`, rubrica fechada, profundamente imutável, sem veredito ou identidade de revisor.
- O manifesto e a allowlist do resolvedor incluem os dois módulos reais. Seus hashes participam da identidade `editorial-composed@1`; o hash de `resources.mjs` também é atualizado no renderer legado porque aquele módulo já pertencia à identidade efetiva. O render legado não foi refatorado.
- Testes novos: `tests/visual/quality-objective.test.mjs` e `tests/visual/layout-qualification.test.mjs`. Helpers: `quality-render-fixture.mjs` e `write-quality-evidence.mjs`. O teste de doctor deixou de afirmar que Q06 ainda não existia e agora cobre arquivo/checker ausente ou divergente.
- Nenhuma dependência, instalação, cópia de fonte, nova tabela, comando público, cache, aprovação, publicação ou alteração da copy das 12 lâminas privadas.

## Extensão mínima da entrada transitória

Q03 retorna pixels, scene graph e métricas, mas não retorna as entradas editoriais/fontes originais. Para provar copy, metadados e pixels sem confiar em hashes autodeclarados, Q06 aceita o resultado Q03 acrescido de `composition.inputs`:

```js
{
  ...compositionResult,
  inputs: {
    carousel, plan, snapshot,
    fonts: [{ id, sha256, bytes }],
    assets: [{ descriptor: { brandId, runId, assetKey, artifactRef, metadata }, bytes }],
    logos: [{ id, sha256, bytes }]
  }
}
```

`qualification` é a lista dos registros candidatos efetivos. `files` é uma lista de `{id,bytes}`: exatamente os PNGs declarados pelo manifesto e o arquivo de métricas apontado por `metricsRef`. O documento de métricas tem bytes de `canonicalJson({schemaVersion:1,selection:composition.selection,slides:[{index,scene,metrics}]})`, sem BOM ou newline. O helper sintetiza somente o recorte de `RenderManifest@2` necessário ao teste; **não implementa persistência Q04, upstream approvals ou o serviço T20**.

O checker destaca dados simples e copia buffers antes do primeiro `await`. Getters, símbolos, ciclos e protótipos inesperados não executam conteúdo. Entradas malformadas, inclusive glifo/linha/logo nulos, retornam diagnóstico público sanitizado. Não há abertura de paths de usuário, URL ou campo executável.

### Vínculo real entre pixels e métricas

1. Conferir hashes da copy, plano, snapshot, marca, recursos e definições; validar novamente relações do plano com os descritores e as fichas.
2. Reexecutar `composeCarousel` sobre os mesmos bytes de fonte/assets/logo, runtime e recursos congelados, **somente nos índices e emendas da seleção explícita**.
3. Comparar seleção normalizada, cenas, métricas e PNG/RGBA recalculados. PNG branco, inclusive acompanhado de SVG branco, novos hashes e métricas antigas, falha. Hashes internamente consistentes não bastam.
4. Decodificar todos os PNGs declarados e conferir formato, dimensões, tamanho, SHA-256 do arquivo e RGBA, inventário exato e unicidade dos IDs. Conferir panorama/emendas contra as linhas RGBA dos slides originais.
5. Final exige todos os índices `1..N` e panorama. Preview pode selecionar todas as lâminas de um carrossel curto e continuar `preview`; nesse caso seu manifesto continua sem panorama, mesmo que o resultado transitório Q03 o contenha.

Sem entradas/fontes originais, os controles dependentes ficam `not-verified`. Bytes presentes mas divergentes, render impossível ou cobertura final falsa são `failed`. A recomposição verifica novamente runtime e recursos, não usa fallback. Um teste com overflow deliberado fora da seleção demonstra que a verificação não compõe o lote ocultamente.

**Custo explícito:** uma recomposição adicional da seleção. Não foi implementado cache nem novo recibo/capacidade. T20/T21 podem avaliar futuramente o reuso de evidência confiável; remover esta verificação sem prova equivalente reabre o falso passe.

## Relatório objetivo

`ObjectiveReport` contém `schemaVersion:1`, marca/run, `kind`, tentativa, `manifestRef`, `checkerRefs`, `checks` e `result`. O hash do manifesto é canônico e o checker referencia os bytes efetivos de seu módulo; suas dependências estão na identidade do renderer. O resultado é imutável e não contém `approved`.

Cada check usa `{code,target,fileHash,expected,observed,result}`. `target` é fechado em `{role,slideIndex,pair,elementId}`; os valores não aplicáveis são `null`. `expected` e `observed` são sempre strings determinísticas, incluindo serialização JSON canônica de medidas. Não aceitam relatório livre como evidência. `fileHash` identifica o PNG quando o check é local; checks globais usam `null` e estão vinculados ao manifesto.

- `copy-exact`: reconstrução integral por campo e trechos, linhas/quebras e cobertura ordenada dos glifos; assinatura e numeração. Glifo omitido/duplicado não passa porque o texto da linha continuou presente.
- `text-bounds`: tinta real de cada glifo dentro do canvas, área segura, região, caixa e agregado. Sem epsilon autorizando perda de tinta.
- `collision`: gap mínimo, interseções, ordem de pintura, overlaps explicitamente enumerados e inset da superfície. Curva sobre texto falha; um booleano `intentional` não concede exceção.
- `typography`: linhas por região e total, ocupação, avanço/caixas, tamanhos, leading, fonte/hash, peso/eixos e estilos autorizados. Recalcula medidas e não aceita somente o número agregado declarado.
- `contrast`: sRGB opaco na superfície resolvida, por estilo e sobreposição; traço informativo usa limiar próprio. Cor/alpha/fundo não resolvido é `not-verified`.
- `asset-geometry`: presença, PNG original/hash, dimensões, contain/aspecto, escala, âncoras, limites declarados de rótulos/traços, logo e proteção. O logo é remensurado com o primitivo T19.
- `continuity-independent`: dependência essencial ou imagem incompleta falha. Coordenadas corretas de continuidade de apoio não provam sentido isolado; esse aspecto fica `not-verified`.
- `file-integrity`: vínculos e verificação de bytes/recomposição/cobertura descritos acima.

Agregação: qualquer `failed` resulta em `failed`; na ausência de falhas, qualquer `not-verified` resulta em `not-verified`; somente todos os controles executados e positivos produzem `passed`. **Esse passe continua estritamente objetivo.**

### O que a automação não prova

O raster sintético contém formas, não rótulos tipográficos rastreados. Seus metadados de mínimo tipográfico/traço não comprovam pixels semânticos. Contraste informativo e tipografia interna desse raster permanecem `not-verified`; não há OCR fictício, média de cor tratada como pior contraste nem declaração automática de legibilidade. A continuidade semântica também depende de inspeção.

A rubrica `editorial-quality@1` exige os seis critérios humanos: `legibility`, `hierarchy`, `composition`, `rhythm`, `visual-semantics`, `brand-finish`. Cobertura: cada imagem integral em 1:1 e cada lâmina em 360×450; final acrescenta panorama por janelas em 1:1 e escala de 1/3, mais emendas aplicáveis. IA pode sugerir achados, mas não satisfaz `human-local-assisted@1` ou o gateway futuro Q05.

Hash canônico da rubrica retornada: `95d05020dabf7b9a189a404b9ce562893e4604b9ec9c4a84a070e1364cafc524`.

## Matriz sintética e limites reais

Duas marcas: Caderno Âmbar e Estúdio Azul. Cada uma usa claro/escuro e as cinco fichas, nas variantes representativa e no teto de linhas: **40 lâminas**, oito grupos, 40 PNGs integrais, 40 móveis, oito panoramas, oito painéis móveis e dois contatos. A matriz mantém exatamente Anton 400 e Manrope 450/580; não há Nimbus, fonte substituta ou família genérica. As duas marcas não qualificam outra identidade tipográfica.

**Natureza desta matriz:** são fixtures técnicas de hierarquia, geometria e limites, com diagramas sintéticos simples. Não reproduzem a direção visual V2 aprovada nem a qualidade premium solicitada. Não devem ser apresentadas para aceite estético como substituto dessa direção. Passes técnicos ou opinião estética sobre estas fixtures não homologam a peça do usuário.

Os testes também exercitam os papéis `context` e `summary` nas três variantes internas, ausência de fonte e recurso, logo, continuidade de apoio e seleção esparsa. Casos de continuidade usam uma definição sintética separada somente para teste; não ampliam as cinco fichas distribuídas, cujo catálogo não oferece continuidade.

| Ficha | Teto positivo título/corpo | Tamanho real no caso de limite | Primeiro excedente recusado |
| --- | --- | --- | --- |
| cover-editorial | 4 / 7 linhas | 141 / 40 px | título 5, corpo 8 |
| content-flow | 3 / 15 linhas | 72 / 37 px | título 4, corpo 16 |
| content-dense | 2 / 16+14 linhas | 72 / 38 px | título 3; coluna 17 com total 30; total 31 com colunas 16+15 |
| diagram-explainer | 3 / 4 linhas | 58 / 40 px | título 4, corpo 5 |
| cta-editorial | 3 / 8 linhas | 87 / 48 px | título 4, corpo 9 |

Valores acima usam a copy sintética exata do helper, não uma promessa de caber qualquer texto com esse número de linhas. Título `AÇÃO\nAÇÃO\nAÇÃO` no diagrama falha mesmo no mínimo 54 px devido à altura real da tinta acentuada, maior que a entrelinha nominal. O caso positivo usa `IDEIA`; os representativos conservam os acentos originais. Nenhum mínimo foi reduzido para forçar o passe.

Negativos adicionais incluem safe area excedida por 1 px, ocupação no primeiro double acima de 1, gap 23 px contra mínimo 24, tamanho 33 contra mínimo 34, título 177 contra teto 176, logo 23 contra mínimo 24, logo deformado, contraste inadequado, eixo/peso/hash divergente, asset ausente/ampliado, PNG corrompido, IDs duplicados, extra/ausência de arquivo, métricas divergentes, render branco com hashes coerentes e final incompleto.

## Reprodução e evidência local

Comando focal Q06:

```sh
node --test tests/visual/quality-objective.test.mjs tests/visual/layout-qualification.test.mjs
```

Gerar novamente somente a matriz sintética local, sem SVG/fontes/estado produtivo:

```sh
node tests/helpers/write-quality-evidence.mjs
```

Saída regenerada no freeze final, ignorada pelo Git: `output/quality-qualification/`. `index.html` organiza a inspeção, `summary.json` conserva ambiente/renderer/fontes/definições e hashes de cada PNG/RGBA e arquivo; os oito `*-objective.json` registram os controles completos. Os dois contatos são uma visão geral; reduzi-los à largura de uma janela não substitui leitura a 360 px por lâmina. Não foram adicionados à allowlist produtiva nem usados como `QualificationEvidenceRef` liberado.

Hash do `summary.json` final: `ceb46b5c5cf085dc78751be999c200b182aa24fb2b69c1a4a858468a90c99b67`. Identidade canônica do renderer: `e3d5de6300c8a8c02f289795a10eb5c78bc2fa1e0d7d9432d34578c682141abc`. A regeneração após o hardening dos nulos renovou relatórios/identidade; os 98 PNGs (slides, versões móveis, panoramas e contatos/painéis) permaneceram byte a byte idênticos à matriz anterior inspecionada.

Inspeção assistida por IA dos contatos e amostras integrais/móveis não identificou corte ou colisão evidente, mas isso não constitui revisão humana integral. Os quatro grupos representativos e os quatro grupos de limite permanecem `not-verified` por contraste/tipografia interna do diagrama. Todos os controles técnicos executados na matriz ficaram sem falhas.

## Fichas e decisão pendente

- Liberadas: **nenhuma**.
- Recusadas para oferta produtiva: **as cinco candidatas**, por falta de liberação humana e qualificação completa dos ambientes/combinações. Isso não muda o status para `rejected`; não houve decisão humana de rejeição.
- `checkerRef/rubricRef` permanecem nulos nas definições originais. Preenchê-los muda `definitionHash` e exige registro sucessor, nova evidência vinculada e processo de liberação. Publicar somente hashes de código não autorizaria reescrever a ficha examinada como `qualified`.
- `assertQualifiedLayout` continua fail-closed mesmo diante de um JSON que se autodeclare qualificado. O manifesto conserva `editorial-composed@1: candidate`.

Para a futura qualificação/liberação, preparar uma matriz que corresponda à direção visual e aos recursos efetivamente aprovados, além dos testes técnicos de limite. Submeter todos os pixels pertinentes nas duas escalas à avaliação humana dos seis critérios, com recibos e vínculos previstos no contrato. Os 40 PNGs desta tarefa são evidência técnica útil e podem ser inspecionados, mas não são um pedido de aceite estético da direção premium. Uma aprovação genérica na conversa não produz automaticamente recibo de Q05 ou evidência liberável. O limite acentuado do diagrama deve permanecer explícito; alterá-lo exige decisão e nova definição.

Revisão independente aceitou o escopo técnico: por relatório separado, suíte integral 551/551, recorte adversarial 6/6, hashes do freeze preservados, 98 PNGs idênticos e inspeção assistida da emenda sintética em 2160×1350 e 720×450. Essa revisão também manteve `candidate`/`not-verified` e não concede liberação humana.

A implementação técnica Q06 está concluída; **Q04 é a próxima tarefa autorizada e independente da homologação/liberação estética pendente**. Liberação de fichas, gates Q05/T20/T21, CLI/plugin instalado T33, publicação/distribuição e execução das 12 lâminas privadas continuam fora desta evidência.
