# Q03 — Composição editorial transitória

> Cópia pública sanitizada: registros privados de conversa e execução foram omitidos. Estados e resultados técnicos abaixo descrevem a etapa original, não uma certificação da versão atual.

Base: `68174ff` (Q02/T18/T19). Implementação interna de composição, sem persistência, aprovação, instalação ou execução das 12 lâminas privadas do usuário. Todas as cinco fichas do catálogo continuam `candidate`, com `release:null`.

## Interface e limite

`composeCarousel({carousel,snapshot,plan,resources,selection})` devolve somente memória: slides selecionados com PNG, SVG privado, scene graph, métricas, hashes PNG/RGBA; emendas derivadas dos mesmos PNGs; panorama apenas quando todos os índices foram pedidos. `selection` aceita `'all'`, lista ordenada explícita ou `{slideIndices,seamPairs}`. Lista ausente, vazia, duplicada ou inválida não vira lote.

Recursos internos: `fonts:[{id,sha256,bytes}]`, `qualifications:[record]`, `assets:[{descriptor:{brandId,runId,assetKey,artifactRef,metadata},bytes}]`, `logos:[{id,sha256,bytes}]`. Dados/bytes são copiados sincronamente antes do primeiro await. Getters, símbolos, ciclos, protótipos exóticos e formas inválidas são recusados com diagnóstico de domínio.

O helper de testes constrói explicitamente o recorte contratual v2 consumido pelo compositor. Não usa o builder v1 nem implementa o snapshot persistente Q04. As fichas candidatas só são exercitadas nesse harness interno; não há flag pública `allowUnqualified`, comando CLI, registro `qualified` fabricado ou resultado com selo/consentimento. T20/Q05 ainda deverão autorizar execução produtiva.

`resolveRenderContext` despacha pela identidade explícita. O caminho histórico e o comportamento sem contexto do script legado são preservados. `resolveComposedRenderResources` lê fontes pela raiz autorizada, sem busca de sistema/fallback. O manifesto identifica somente os módulos reais Q03 e dependências transitivas utilizadas. Não anuncia checkers Q06 ainda inexistentes.

## Composição e medidas

- Geometria vem de cada ficha; o plano referencia regiões/estilos/âncoras, sem coordenadas livres. Nenhuma coordenada do protótipo pessoal foi transplantada como regra universal.
- Fontkit mede os bytes exatos: Anton400 e Manrope450/580, eixos reais e SHA-256. SVG usa contornos dos glifos, sem texto dependente de fontes de sistema. Hash, estilo, peso/eixos e glifo ausente bloqueiam, sem síntese/fallback.
- Tamanho é o maior inteiro autorizado que atende largura, tinta, altura, linhas e ocupação simultaneamente. Leading real pode aumentar acima do nominal quando acentos/descendentes precisam de espaço; a altura efetiva entra integralmente na ocupação. Nunca há compressão ou redução abaixo do mínimo.
- Cada linha/fragmento/glifo conserva offsets UTF-16, texto, estilo, fonte/hash, avanço, baseline e caixa. Espaços, CRLF, linhas vazias, pontuação e diacríticos permanecem exatos. Quebras visuais não acrescentam copy. Shaping não rastreável, RTL ou glifo inexistente bloqueiam explicitamente; não há normalização de Unicode para esconder ausência.
- Caixas agregadas usam a próxima extensão representável quando necessário, conservando os extremos de tinta. Não há epsilon permitindo perda de glifos nem arredondamento do contorno SVG para caber.
- Limites de linhas totais/colunas, gaps, área segura, colisões, superfície confirmada e contraste textual são controles locais. Destaque declarado mantém inset mínimo e contraste na superfície final; overlap não autoriza esconder texto. Isso não substitui os checkers/rubrica Q06.
- PNG semântico é verificado por hash/dimensão/formato e colocado inteiro em contain, sem crop nem ampliação. Metadados de rótulos/traços são pré-requisitos, não prova independente de inspeção semântica do asset.
- Continuidade deriva pontos das âncoras reais nos dois lados, em coordenadas mundiais `x=(índice−1)×1080`, sem compor o vizinho. Conectores de apoio são recortados por canvas e pela borda externa do asset; só o traço é recortado, nunca a imagem. Informação semântica permanece completa em cada lâmina. Emendas não são autorizadas por simples justaposição.
- Logo reutiliza a validação T19, referência congelada e PNG original. O primitivo recebe limites de ficha opcionais mais estritos, refaz contain/prova de pixels, e mantém defaults históricos12/24 idênticos. Assinatura vem exclusivamente do perfil; vazio não inventa assinatura. Numeração usa os índices originais.
