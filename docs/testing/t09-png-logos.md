# T09 — Importação e associação de logos PNG

> Cópia pública sanitizada: registros privados de conversa e execução foram omitidos. Estados e resultados técnicos abaixo descrevem a etapa original, não uma certificação da versão atual.

## Escopo e contrato

Autorizada individualmente em 16/10/2026, 14:55 UTC, a partir de `4bdd85b`, branch `feat/module-01-brand-runtime`. Implementa apenas T09; nenhuma alteração no renderer, recursos T10, CLI/plugin ou schema SQLite.

`createLogoImport({root, db})` expõe:

- `importFile({requestId, brandId, sourcePath})`: lê arquivo regular com limite, verifica PNG e decodifica; usa T07 para persistir bytes originais, SHA-256, tamanho, dimensões, tipo verificado `logo/png-static-v1` e nome original. A importação exige origem disponível, inclusive para calcular a identidade de uma repetição; não promete reimportação sem origem.
- `proposeAssociation({requestId, brandId, expectedRevision, assetId, surfaces, enabled})`: aceita `surfaces: ['light']`, `['dark']` ou ambas. As superfícies selecionadas substituem as autorizações anteriores desse arquivo; uma variante diferente na outra superfície permanece intacta. Valida todos os PNGs resultantes e devolve proposta de revisão T08.
- `commit(proposal, receipt)`: revalida os arquivos gerenciados antes de confirmar a revisão pela confirmação humana exata T08. Booleanos/JSON não são recibos. Concorrência usa CAS e replay de T08.
- `resolve(brandId, surface)`: retorna `null` se desabilitado, asset verificado/decodificado se autorizado, ou `LOGO_VARIANT_MISSING` se a superfície não tem variante. Reabertura/novas utilizações usam bytes gerenciados sem origem e sem nova aprovação visual por peça.

PNG opaco é permitido somente nas superfícies confirmadas. Não há geração, recorte, recolorização, conversão, recompressão ou ajuste geométrico. Configuração habilitada sem variante é inválida.

Novas associações via BrandMemory exigem capacidade interna efêmera vinculada ao banco e à proposta exata, emitida somente após validação de todos os PNGs. BrandMemory também verifica pertencimento/tipo/dimensões do registro. Referências já confirmadas na mesma superfície podem atravessar atualizações editoriais e sessões. A capacidade e o recibo são fronteiras internas, não autenticação contra código arbitrário que possa importar módulos ou editar o banco.

## Validação e limites

- Assinatura, framing, CRC de cada chunk, letras literais do tipo/reserved bit, cabeçalho único, IDAT contíguo e IEND final, sem bytes anexados.
- Recusa acTL/fcTL/fdAT, mesmo que o decoder nativo ignorasse APNG.
- Até 10 MiB por arquivo e 4096 px por dimensão; leitura limitada e limite de pixels antes do decode.
- Checks estruturais de metadados PNG conhecidos e expansão zlib limitada a 10 MiB agregados. Esta defesa pode recusar um PNG cujo arquivo tenha menos de 10 MiB mas cujos metadados comprimidos excedam o orçamento expandido.
- sharp real com `failOn: 'warning'`, metadata e stats fazem decode completo. Stats preservam alpha 16-bit: alpha 1 é visível; alpha totalmente zero é recusado. Metadados não são tratados como instruções.
- Reutilização revalida SHA-256 e PNG; tamper, arquivo ausente, marca cruzada e descritor genérico falso são recusados.
- T07 continua responsável por confinamento/promoção/hash. A proteção local contra links não é um sandbox contra troca hostil concorrente de caminhos; nenhum claim adicional é feito aqui.

## Evidências executadas

Linux x64, Node v24.19.0, npm 11.9.0, better-sqlite3 13.0.3, sharp 0.34.5/libvips 8.17.3 já existentes. Nenhuma instalação ou mudança de dependências.

- Red inicial: módulo logo-import ausente.
- Primeiro green: 11 novos cenários e 11 regressões BrandMemory, 22/22.
- Red adicional: alpha 16-bit baixo era truncado no raw 8-bit; corrigido com stats nativos.
- Revisão independente encontrou high-bit/reserved-bit de chunk e metadados malformados ignorados por sharp. Regressões red observadas e corrigidas antes da execução final.
- Red adicional: restringir de ambas superfícies para clara preservava associação escura; corrigido removendo autorizações anteriores desse mesmo asset.
- Focal final e suíte completa são registrados abaixo após execução. Testes incluem SQLite real, decode real, reopen, bytes/hash, confirmação, isolamento e limites; confirmação humana é simulada, não uma sessão efetiva com usuário.

## Pendências e não alegações

Revisão independente aceita e qualificação Windows confirmada pelo coordenador, conforme registro final abaixo. A qualificação focal não homologa o produto completo. T19 layout, T20 render, integração CLI/plugin, recursos/fontes e release/distribuição não foram iniciados. Sem commit, push ou publicação por este executor.

### Resultado local final do executor

- `node --test tests/integration/logo-import.test.mjs`: 18/18, zero falhas/cancelados/ignorados, 2328.395493 ms.
- `npm test`: 128/128, zero falhas/cancelados/ignorados, 8247.955532 ms.
- `git diff --check`: limpo.
- Revisão independente aceita no estado imediatamente anterior (127/127 completos e 28/28 T08+T09). A diferença final é um teste adicional de IDAT com CRC correto e compressão inválida; nenhum código de produto mudou após a revisão.
- A pendência Windows foi resolvida conforme registro final abaixo.

### Qualificação Windows final — 16/10/2026
