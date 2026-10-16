# T19 — Slot de logo protegido no legado

> Cópia pública sanitizada: registros privados de conversa e execução foram omitidos. Estados e resultados técnicos abaixo descrevem a etapa original, não uma certificação da versão atual.

## Escopo e resultado

Base `cbf437d` (T18), trabalho local autorizado no lote T14–T19. O template legado passa a renderizar o PNG autorizado dentro da caixa x756/y64/w240/h80, com proteção interna 12 px, encaixe proporcional do canvas original inteiro e altura visível mínima 24 px. O rodapé textual permanece. Sem logo, não há placeholder, área reservada ou alteração dos pixels da regressão T18.

- `prepareLogoLayout({logo, theme, logos})` recebe recursos em memória `{id, sha256, bytes}`; seleciona a variante confirmada e copia o PNG antes de qualquer await. Reutiliza a validação estática real T09, confere hash e incorpora os bytes originais em data URI. Não recorta, recolore, deforma, reencoda nem substitui o original.
- `resolveLegacyRenderContext({snapshot, fontRoot, logoData})` amplia T18 para logo habilitado. Vincula a seleção aos IDs/superfícies/hashes congelados e copia os bytes antes de resolver runtime/fontes. Configuração sem variante, variante incompatível, recurso ausente, PNG inválido ou hash divergente bloqueiam sem fallback.
- O tema legado usa a classificação já definida em Q01: luminância relativa sRGB de background ≥0,5 seleciona `light`; abaixo disso, `dark`. Não inverte cores nem concede autorização a outra superfície.
- O template aceita somente o objeto de layout validado em memória. Usa limites reais dos glifos com as mesmas transformações quantizadas do SVG e caixas integrais dos assets de continuidade para recusar interseções com o slot. Encostar na borda é permitido; invadir qualquer parte da proteção retorna `LOGO_LAYOUT_CONFLICT` antes de criar a saída.
- Com logo ativo, o círculo decorativo à direita passa de cy300 a cy354 (r210), tangenciando a borda inferior y144 do slot. O círculo à esquerda permanece em cy300. Esse ajuste específico não cria um mecanismo geral de correção/composição; logo off conserva ambos os desenhos originais.
- O manifesto v2 identifica os 13 arquivos locais transitivos efetivos. O formato histórico v1 continua legível; sua identidade não é fingida como atual. O compositor novo permanece candidato/incompleto.

## Visibilidade técnica e limites

O encaixe é calculado com as dimensões integrais do PNG: área útil 216×56. Transparência externa não é cortada para aumentar a marca. A caixa de tinta visível é medida após composição do original sobre a superfície plana escolhida, em sRGB 8-bit, e projetada proporcionalmente. O critério técnico de presença é diferença não nula em algum canal RGB em relação ao fundo, sem limiar novo de opacidade, contraste ou gosto. A altura projetada deve ser ≥24.

Há ainda uma rasterização de prova do próprio PNG original, na escala/posição finais, sobre a mesma superfície. Sua tinta resultante também precisa ter altura ≥24. Isso bloqueia alpha 16-bit que desaparece na saída 8-bit, cor idêntica ao fundo e pontos separados que somem na redução. T09 permanece inalterada: um alpha 16-bit não zero pode ser um PNG válido para cadastro e ainda ser tecnicamente invisível neste layout.

Esses controles não qualificam contraste, legibilidade semântica da marca, densidade de tinta, proporção de componentes internos ou adequação estética. Uma diferença de um nível de canal é presença técnica, não um selo de boa leitura. Colisão usa caixas conservadoras de tinta/asset; não permite sobreposição intencional. Q03/Q06 e os gates produtivos continuam fora desta entrega.

## Arquivos

Novos: `src/adapters/legacy/logo-layout.mjs`, `tests/helpers/logo-slot-fixture.mjs`, `tests/unit/logo-layout.test.mjs`, `tests/visual/logo-slot.test.mjs` e este relatório.

Alterados: template, renderer e contexto legado; manifesto/allowlist de recursos; helper de sandbox e regressão T18. A regressão histórica que recusava qualquer logo habilitado foi desmembrada: v2/renderer incompatíveis seguem `RUN_CONTRACT_UNSUPPORTED`; habilitar sem variante continua inválido com `INVALID_ARGUMENT`. Os novos testes exercitam habilitação legítima e as recusas por IDs/hash/recursos.

## TDD e execução Linux

Ambiente: Node v24.19.0, Linux x64; dependências já instaladas, sharp 0.34.5/libvips 8.17.3. Fontes reais existentes Anton, Manrope e JetBrains Mono, verificadas pelo resolvedor T10. Nenhum download, instalação ou alteração de dependências.

- RED inicial válido: os 16 testes novos falharam por adaptador ausente/recusa histórica de logo/identidade ainda ausente. GREEN inicial: 16/16; suíte 406/406.
- RED adicional: deslocamento indevido do círculo esquerdo; corrigido para mover apenas o círculo direito.
- RED adicional após revisão: `null` nas referências congeladas e configuração de logo ausente geravam `TypeError`; agora produzem erros de domínio limitados. Regressões incluídas.
- Focal T19 final: `node --test tests/unit/logo-layout.test.mjs tests/visual/logo-slot.test.mjs` → **23/23**, zero falhas/skips, 3969.616341 ms.
- Focal ampliado: `node --test tests/unit/logo-layout.test.mjs tests/visual/logo-slot.test.mjs tests/regression/legacy-context.test.mjs tests/integration/doctor.test.mjs tests/integration/run-snapshot.test.mjs` → **93/93**, zero falhas/skips, 5697.244024 ms.
- Suíte completa: `npm test` → **413/413**, zero falhas/skips, 11237.391673 ms. O aviso de atualização do npm foi apenas informativo; nenhuma instalação foi executada.
- `git diff --check` → limpo.

Cobertura inclui o limite exato de altura24 e primeiro caso abaixo, padding transparente, PNG excessivamente horizontal, claro/escuro, documento denso, assinatura, todos os campos textuais, identidade/bytes originais, logo off, corrupção/formato, alpha16 invisível, perda na redução, PNG ausente/ambíguo, layout/data URI forjado, refs malformadas, cópias antes de awaits, conteúdo por glifos reais, continuidade conflitante e continuidade válida com original intacto. O teste de glifos adversariais muda métricas somente numa cópia em memória da fonte na API interna do template; não escreve, distribui ou autoriza aquela fonte no contexto.

## Inspeção visual real

Inspecionados dois panoramas sintéticos (5 lâminas cada, 5400×1350), todas as lâminas a 360×450 e a lâmina densa com código de ambas as marcas em 1080×1350. Logos sintéticos em ambas as superfícies, título/corpo/código/acentos/rodapé preservados, sem invasão visível do slot. Asset laranja sintético atravessa a emenda 4→5 fora da área de marca; seus bytes originais continuam íntegros. Não foi usado logo real de Peterson.

PNG original de teste, SHA-256:

- Claro: `6cf978c7b4ec6b990782384f963b6428281f3731516a9e845b4a907c8e809efa`
- Escuro: `ea7e93f2dd0795f9f07e05c532a645c64a71bfb591b9a1dd6b87f7b8196920cd`
- Asset criativo original antes/depois: `16e0c46d3f46d61ffafe26d76d7f996e98cd2cde623882a5104171ea41fdf6d9`

Geometria da tinta em ambas as variantes: x797,6/y87,2/w156,8/h33,6; caixa raster final x797/y87/w158/h34. Todo o canvas PNG permanece dentro da área útil.

SHA-256 dos pixels RGBA decodificados da amostra local:

- Panorama claro: `3294abcbab81bab1cd07d512ceff09fa511539d6f5163bd622e1b18894184412`
- Panorama escuro: `a977839d44fa64610d9fc1bc9c82c36d15d0ba33d7fcb43f4e713743ab22f874`
- Densa clara: `e4886fa4ce46c09950ca63952eb77371135419c4775c9fe264db025625fd2480`
- Densa escura: `6ef9c590a8cb97eb2c6d0d112da22b10c974db6eb6b8a01cd099b7600a23f062`

Evidência temporária mantida fora do pacote; nenhum binário/fonte acrescentado à distribuição. A regressão T18 compara algoritmo arquivado e atual no mesmo runtime/fontes, com pixels logo off idênticos; não presume igualdade de pixels entre sistemas operacionais.

## Revisão, Windows e pendências

Revisão independente final aprovada em 16/10/2026, 20:28 UTC, sobre os mesmos hashes congelados. Comando ampliado acrescido de `tests/integration/logo-import.test.mjs`: **111/111**, zero falhas/skips, 8669.169222 ms; suíte completa independente: **413/413**, zero falhas/skips, 10026.620726 ms. `git diff --check` limpo. O revisor reinspecionou as dez lâminas a 360 px e as duas densas a 1080 px; confirmou rodapés on/off pixel-idênticos em 10/10. Também conferiu refs adversariais recusadas, 13 imports locais cobertos pelo manifesto, leitura do manifesto v1 original e detecção de logo-layout adulterado/ausente/escape por symlink. O caso de referência null encontrado foi corrigido com red→green. Nenhuma alteração de produto/teste após o freeze.

### Qualificação Windows final — 16/10/2026

Nenhum commit por este executor, push, publicação, migração, integração produtiva T20, compositor Q03, qualidade Q06 ou uso de Nimbus. Este é um primitivo interno de render; não é autorização para executar/retomar produção nem homologação estética do produto.
