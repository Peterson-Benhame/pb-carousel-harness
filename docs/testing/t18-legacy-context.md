# T18 — Contexto explícito no renderer legado

> Cópia pública sanitizada: registros privados de conversa e execução foram omitidos. Estados e resultados técnicos abaixo descrevem a etapa original, não uma certificação da versão atual.

## Escopo e comportamento

Base local: `3314e11` (Q02). Adaptação interna do legado, sem compositor Q03, logo T19, migração Q04, comando produtivo ou mudança de dependências.

- `resolveLegacyRenderContext({snapshot, fontRoot})` aceita snapshot v1 coerente de `legacy-panorama@1`, com logo desligado. Copia/congela marca e tema, confere hashes congelados e identidade efetiva do runtime, resolve fontes pelo resolvedor T10 e verifica novamente confinamento/bytes no consumo.
- `renderCarousel({... ,context})` usa somente marca/tema/fontData explícitos. Contexto inválido não cai no caminho legado. Bytes são copiados e verificados antes de qualquer await, evitando mutação durante leitura de assets.
- Sem `context`, API e CLI conservam o caminho original. Template e validator de produto não foram alterados. Assets mantêm validação e confinamento lexical/realpath.
- Manifesto v1 continua legível com o trio histórico. A identidade atual v2 conserva o ID legado e inclui adaptador/dependências locais transitivas; hashes antigos não são fingidos como atuais. O compositor novo continua candidato/incompleto.
- O contexto é um primitivo interno em memória, sem consentimento ou selo de prontidão. Não autoriza produzir/retomar runs históricos; integração/gates permanecem em T20/Q04.

## Evidência pré-alteração

Antes de modificar produto, fontes reais Anton/Manrope/JetBrains Mono e algoritmo original foram executados sobre fixture sintética. Cinco slides 1080 × 1350, panorama 5400 × 1350, logo off. Originais e hashes estão em `tests/fixtures/legacy/before-context`; evidência de runtime/fontes/pixels em `baseline-capture.json`.

A regressão reexecuta baseline e atual no mesmo runtime e compara SHA-256 de pixels RGBA decodificados, além de nomes/dimensões e preservação integral dos dados/textos representados. Não usa metadados PNG/ZIP e não transporta fontes. Uma segunda marca/tema claro é testada em instalação sem globals pessoais/fontes empacotadas.

## TDD e verificações

- RED inicial: `node --test tests/regression/legacy-context.test.mjs` → 13 testes, 2 passes históricos, 11 falhas por contexto/identidade ausentes, zero skips.
- RED adicional: teste de mutação dos bytes após iniciar render → `Invalid title font data`, reproduzindo a janela assíncrona; corrigido consumindo cópia privada dos bytes verificados.
- A integração inicial revelou duas assertivas Q02 que exigiam identidade v1/v2 idêntica. Foram ajustadas para preservar o trio histórico e verificar a ampliação transitiva real, sem remover a cobertura do candidato incompleto.

- GREEN Linux: `node --test tests/regression/legacy-context.test.mjs tests/integration/doctor.test.mjs tests/integration/run-snapshot.test.mjs` → 69/69, zero falhas/skips.
- Suíte completa Linux: `npm test` → 389/389, zero falhas/skips (8,38 s). O aviso informativo do npm sobre versão nova não foi seguido; nenhuma instalação.
- `git diff --check` → limpo.
- Inspeção visual local: dez lâminas (dois temas) a 360 px e lâmina de conteúdo/código escura em 1080 × 1350. Assinaturas distintas, acentos, código e composição visíveis; nenhum desvio de compatibilidade identificado. Evidência temporária local fora do pacote; não concede homologação estética.
- Revisão independente local: focal 69/69 e suíte 389/389, zero falhas/skips. Conferidos os 12 imports locais recursivos contra o manifesto, leitura do manifesto v1 original de `07f8839`, detecção de adapter adulterado/ausente, rejeição de getter sem executar, render em CWD com espaços/acentos e reprodução assíncrona corrigida. Nenhum bloqueio adicional.
- Coordenador reconfirmou a suíte completa Linux: **389/389**, **11574.418905 ms**, sem alterações de produto/testes após o congelamento.

## Windows e conclusão

## Limites

Baseline é prova de compatibilidade técnica, não aprovação estética. A comparação não presume pixels iguais entre plataformas; cada ambiente compara baseline e adaptação com seu próprio runtime. Nimbus continua não utilizada/bloqueada; fontes não foram baixadas, instaladas ou incluídas em artefato. Nenhum publish, push, migração ou alteração de dependência.
