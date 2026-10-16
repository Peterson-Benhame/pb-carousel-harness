# Especificação 01 — Adendo de qualidade visual v0.4

> Cópia pública sanitizada: registros privados de conversa e execução foram omitidos. Estados e resultados técnicos abaixo descrevem a etapa original, não uma certificação da versão atual.

**Data:** 16/10/2026, UTC. **Base técnica:** `8c2c2c6`, T00–T13.

**Estado:** direção visual V2 e proposta de qualidade aprovadas conceitualmente; este detalhamento normativo e o [plano revisado](PLANO-REVISAO-QUALIDADE.md) estão submetidos à revisão antes de implementar. “Deve” descreve requisito de produto futuro, não capacidade existente nem autorização de execução.

## 1. Aprovação, precedência e histórico

A direção visual V2 e a proposta de qualidade foram aprovadas conceitualmente. O registro privado dessa decisão não integra esta cópia.

Essa decisão aprova a direção e os requisitos conceituais. Não aprova automaticamente novos contratos técnicos, licenças de fontes, o lote ainda inexistente de 12 lâminas, integração Windows/plugin, instalação, publicação ou implementação. A próxima decisão é revisar o plano; cada tarefa continua exigindo autorização própria, salvo lote de IDs explicitamente autorizado.

Este adendo é incremental à [especificação v0.3](baseline-reference/ESPECIFICACAO-v0.3.md). A especificação v0.3 está incluída nesta cópia com metadados privados removidos. Após aprovação deste detalhamento, as disposições abaixo prevalecem somente nos pontos identificados; os demais requisitos continuam válidos.

### Changelog em relação à v0.3

| Seções da v0.3 | Mudança proposta |
| --- | --- |
| 3, 4 e 12 | Acrescentar composição mínima qualificada e controle de qualidade ao Módulo 01, preservando o adaptador legado. Catálogo amplo continua futuro. |
| 5 e 6 | Separar tokens de marca, plano de composição e recursos; versionar snapshot e política, sem reescrever execuções antigas. |
| 7 e 8 | Acrescentar amostra renderizada, revisão prévia e aprovação humana específica antes do lote; revisão editorial final distinta de consentimento. |
| 6, 8, 9 e 10 | Vincular evidências, invalidações e reutilização aos bytes, versões e fingerprints corretos. |
| 11 e 12 | Aplicar o mesmo gate no serviço, CLI, plugin, retomada e empacotamento. |
| 15 | Manter AC01–AC32 e acrescentar AC33–AC40; AC17 continua regressão técnica, sem virar selo estético. |

T00–T13 permanecem concluídas em seus escopos históricos. Extensões dos contratos já implementados requerem novas regressões; não invalidam os commits nem transformam testes antigos em evidência dos novos requisitos.

## 2. Resultado e limite do compromisso

O harness deve impedir a entrega de uma composição que falhe nos controles técnicos ou tenha revisão editorial ausente, reprovada, não verificada ou obsoleta. Deve adaptar-se à identidade confirmada da marca, dentro dos recursos e layouts efetivamente homologados. Não deve prometer adequação a qualquer conteúdo, gosto ou marca sem limites conhecidos.

Uma peça simples pode ser profissional. Não existe quota de fotografias, ilustrações, efeitos ou decoração. Hierarquia, legibilidade, composição, ritmo, semântica e acabamento são critérios; complexidade visual não é um critério de sucesso.

### Escopo mínimo proposto para o Módulo 01

- Um compositor interno `editorial-composed@1`, com fichas limitadas para capa, conteúdo, explicação em diagrama e CTA; variantes somente quando necessárias para conteúdo/densidade e superfícies clara/escura homologadas.
- Dados de composição declarativos, medidos com as fontes reais; glifos, blocos, assets, áreas reservadas e sobreposições intencionais rastreáveis. Nada de scripts de template fornecidos pelo usuário.
- Texto por trechos e destaque tipográfico sem mudar o texto canônico; diagramas fornecidos como assets autorizados e âncoras declaradas. O produto não gera automaticamente um catálogo de diagramas semânticos.
- Duas marcas de teste distintas, com dados/fontes/temas autorizados, demonstrando isolamento e aplicação real dos mesmos componentes. Isso prova o escopo testado, não universalidade estética.
- Bloqueio explícito quando conteúdo ou identidade não cabe nas fichas disponíveis; pedir mudança autorizada de conteúdo ou trabalho de design específico.

O catálogo extenso, seleção inteligente irrestrita de layouts, editor visual, suporte geral a fontes arbitrárias e novos agentes de design continuam em módulo futuro. O conjunto mínimo acima é uma ampliação explícita do escopo anterior, sujeita à revisão do plano, e não será escondido dentro de T18.

## 3. Marca, composição e fontes

### 3.1 Separação de responsabilidades

1. `BrandRevision` conserva identidade e preferências confirmadas: paleta, superfícies permitidas, famílias/recursos aprovados, assinatura e regras de marca.
2. `LayoutQualification` identifica layout/versão, hash da ficha, papéis e condições suportados, limites mensuráveis, fixtures e revisão editorial da qualificação.
3. `CompositionPlan` é um artefato versionado da execução: referencia copy e assets por hash, atribui um layout qualificado a cada lâmina, declara trechos tipográficos, superfícies, áreas e âncoras. Seus trechos devem reconstituir cada campo textual sem alterar palavras, acentos, pontuação ou ordem.
4. O renderer consome snapshot, plano e recursos resolvidos; não lê preferências globais de Peterson quando recebe contexto explícito.

Seleção de layout, aplicação de identidade e preparação editorial não autorizam persistir uma nova preferência de marca. Overrides continuam restritos à execução. A memória permanente mantém a confirmação da v0.3.

### 3.2 Ficha e limites

Cada ficha deve fixar, antes de ser qualificada: dimensões; caixas de conteúdo e proteção; tamanhos mínimo/máximo; entrelinha; linhas/densidade máximas por bloco; margens; espaçamento; regras de continuidade; escala mínima dos diagramas; contraste mínimo adotado por par/superfície; modo de sobreposição intencional; fontes e recursos necessários.

Não existem valores novos homologados neste adendo. Q01/Q02 devem propor os valores exatos a partir das medidas reais, e testar o limite e o primeiro caso além dele. A caixa segura e os contrastes medidos da V2 são evidência daquela amostra, não padrões globais automaticamente aprovados. O slot de logo legado conserva os valores da v0.3; o compositor novo precisa homologar sua própria convivência com conteúdo e assinatura, sem afrouxar proteção/proporção/tamanho mínimo aprovados.

O compositor deve tentar a variante qualificada compatível antes de reduzir texto. Não pode diminuir fonte abaixo da ficha, omitir conteúdo ou resumir a copy para fazer o teste passar. Se os limites não comportarem o material, deve bloquear e solicitar a decisão pertinente.

### 3.3 V2 e recursos tipográficos

A direção V2 usa o tema builder-editorial e Anton/Manrope com acento Nimbus Roman Italic. Sua aprovação é específica desta execução, não um novo default de todas as marcas. O protótipo tem coordenadas próprias para duas lâminas e não será copiado como mecanismo genérico.

Nimbus Roman Italic existe no ambiente cloud do protótipo; disponibilidade Windows e condições de uso/empacotamento ainda precisam ser verificadas. O relato local de AGPL-3 com exceção de fonte não constitui liberação jurídica de redistribuição. Q01 deve identificar origem, versão, hash, licença/exceção e recursos já disponíveis no ambiente alvo, sem baixar, instalar, copiar ou redistribuir fontes.

O contrato atual contém três identificadores fixos. Acrescentar um recurso de acento exigirá mudança explícita/versionada no manifesto, validação de marca, snapshot e resolvedor. O Módulo 01 não passa a aceitar qualquer fonte/path arbitrário. Sem um recurso autorizado correspondente, bloquear a reprodução fiel; apresentar alternativa para aprovação, sem fallback silencioso. Fontes continuam fora do `.tgz`, do ZIP de entrega e dos backups.

## 4. Fluxo proposto: amostra antes do lote

O contrato novo mantém os estados globais da v0.3 e adota um grafo versionado com **11 etapas**, de tipos explícitos. Tipos não podem ser inferidos pela posição no array.

| Ordem | Etapa | Tipo e condição de conclusão |
| --- | --- | --- |
| 1–4 | `inputs`, `copy-approval`, `concept-approval`, `assets-approval` | Contratos existentes, acrescidos da integridade do plano de composição aplicável. |
| 5 | `preview-render` | Execução: render real da seleção, com manifesto, métricas e arquivos íntegros. |
| 6 | `preview-review` | Revisão: controles objetivos e revisão editorial da amostra completos e aprovados. |
| 7 | `preview-approval` | Consentimento: decisão humana vinculada à amostra revisada, ao plano e à seleção exatos. |
| 8 | `render` | Execução: lote completo autorizado, usando a mesma implementação de composição e os mesmos recursos da amostra. |
| 9 | `validate` | Execução: integridade e todos os controles objetivos do lote aprovados. |
| 10 | `quality-review` | Revisão: todas as lâminas e panorama avaliados editorialmente, com parecer válido. |
| 11 | `package` | Execução: gates revalidados e ZIP íntegro confirmado sob lease/fencing válidos. |

`preview-render` exige inputs, copy, conceito, assets e plano correspondentes aprovados/aptos; **não exige a aprovação da amostra que ainda será produzida**. `render` exige também `preview-review` e `preview-approval` válidos. A aprovação do conceito, o aceite de uma imagem isolada ou uma bandeira `approved: true` não substitui nenhum desses controles.

A amostra contém capa e uma interna representativa, mais a maior densidade ou transição problemática quando não estiver coberta. O plano registra a seleção, seus motivos e a cobertura de riscos. Trocar a seleção invalida o parecer e a aprovação da amostra. Não escolher somente as duas lâminas mais fáceis; emendas arriscadas precisam de lâminas adjacentes ou recorte real da região.

O caminho parcial deve renderizar as lâminas selecionadas com a geometria e as dependências de continuidade da composição completa. Não deve gerar o lote inteiro escondido antes da aprovação, nem usar um gerador de mockups diferente. Se o renderer não permitir esse isolamento com fidelidade, a implementação da amostra fica bloqueada até resolver a dependência.

Uma amostra reprovada pode ser mostrada como diagnóstico para decisão; não é “amostra revisada/aprovada” nem entrega. Uma amostra aprovada permite o lote correspondente, mas não dispensa a inspeção final.

### Estado e próxima ação

- Espera de decisão humana usa `waiting-approval`, com motivo tipado distinguindo revisão editorial de consentimento de amostra. O próximo passo informa exatamente o objeto e a ação requerida.
- Revisão indisponível, evidência incompleta ou defeito bloqueante usa `blocked`; falta de decisão humana disponível não é falha do renderer.
- Uma etapa de revisão não mantém lease de render enquanto espera a pessoa. O registro da decisão verifica novamente versão/hash, ausência de tentativa conflitante e autoridade aplicável em transação curta.
- Os eventos de revisão são distintos dos de aprovação de produção. Revisão `succeeded` não fabrica consentimento; aprovação não fabrica um parecer técnico/editorial.
- `completed` exige package íntegro e todos os gates da política congelada. Não significa apenas que PNGs existem.

## 5. Dois controles, evidência verificável

### 5.1 Controle objetivo

Reaproveitar integridade do contrato/render e acrescentar: correspondência integral da copy; geometria de glifos/blocos; colisões com conteúdo, marca, rodapé e decoração; limites de linhas/tamanho/espaço; fonte efetivamente usada; contraste nas superfícies adotadas; proporção/definição/proteção de assets; continuidade sem dependência de texto ou informação essencial invisível no recorte.

Cada resultado identifica lâmina, elemento/região, limite, valor observado, versão do checker e hash do arquivo. Uma caixa aproximada insuficiente ou uma verificação não disponível resulta em `not-verified` e bloqueia a liberação; não produz passe por ausência de detecção. Sobreposição intencional precisa estar declarada entre elementos/regiões específicos e não pode esconder informação.

### 5.2 Revisão editorial

Revisar em resolução integral e em largura de leitura móvel registrada (360 px para a matriz inicial proposta). Avaliar separadamente hierarquia, composição, ritmo, semântica visual e acabamento/identidade. Cada item recebe `met`, `failed` ou `not-verified`, com cobertura de slides/regiões e observações. Não usar média para compensar falha bloqueante.

A revisão final abrange todas as lâminas, o panorama e as emendas aplicáveis. Ela confirma adequação editorial do resultado, não constitui um novo consentimento para mudar texto, marca ou assets. A aprovação humana obrigatória da amostra continua separada; este adendo não cria uma aprovação adicional de gosto pelo usuário para cada lâmina final.

### 5.3 Quem revisa e como registrar

O mínimo implementável no Módulo 01 é revisão humana local assistida pelo harness: a interface apresenta os arquivos exatos e a rubrica; a pessoa inspeciona os pixels e confirma os itens. Um modelo pode preparar achados, mas não declarar livremente que uma pessoa revisou ou que uma capacidade visual existia. A capacidade de avaliação automatizada futura só poderá liberar um parecer após integração própria, evidência de acesso aos pixels e qualificação explícita; não é dependência nem promessa deste módulo.

Um `QualityReview` imutável deve conter: `schemaVersion`, `kind` (`preview` ou `final`), `brandId`, `runId`, `renderAttemptId`, fingerprint do objeto, hash do manifesto e dos arquivos inspecionados, hash do plano e da qualificação, versão/hash da rubrica e checkers, método, identidade/tipo do revisor, horário, resolução integral e largura móvel, cobertura de lâminas/emendas, resultados por critério e achados. O vínculo com a confirmação local não pode vir de um `actor=user` fornecido pelo modelo.

Um relatório JSON importado é material para conferência, não prova suficiente de revisão nem consentimento. O serviço valida estrutura, proveniência, cobertura e hashes; o gateway humano previsto em T15/Q05, estendendo o componente de confirmação de marca da T08, coleta a confirmação para a versão exibida. Se os arquivos mudarem entre exibição e decisão, a confirmação é recusada como obsoleta. Essa atestação local não é prova contra uma pessoa ou processo hostil com acesso irrestrito ao sistema; o limite já declarado na v0.3 permanece.

## 6. Identidade, versões, invalidação e retomada

### 6.1 Contrato novo, histórico preservado

Propor `RunSnapshot.schemaVersion=2`, `contractVersion=2`, `pipelineVersion=2` e `qualityPolicyVersion=1`; canonização existente não precisa mudar se suas regras permanecerem iguais. O snapshot congela política de amostra/revisão, identidades das qualificações permitidas, renderer/recursos, rubrica e sua versão. O plano de composição é uma entrada versionada, não uma mutação do snapshot.

O fingerprint novo deve abranger entradas relevantes, snapshot, executável, recursos reais, layout/ficha, plano, seleção da amostra e manifestos/evidências anteriores pertinentes. Manifestos de render distinguem `preview`/`final`, tentativa, seleção, versões e hashes; um não pode ser usado como o outro. Qualificação ou rubrica não pode ser resolvida por “latest”.

Execuções v1 permanecem consultáveis com seu grafo e status históricos, explicitando `quality: not-evaluated` para o novo padrão. Não serão reescritas, promovidas a qualidade aprovada nem preenchidas com etapas `succeeded` por migração. Para uma nova produção com selo v0.4, derivar uma execução v2 e obter as confirmações aplicáveis; a derivação continua sem herdar aprovações automaticamente. Uma retomada v1 sob o novo fluxo de produção deve informar derivação necessária, não oferecer uma rota de entrega sem o novo gate.

Os tipos livres já existentes em `artifacts`, `steps` e `confirmation_requests` podem comportar os novos registros. Q01 deve confirmar se uma migração SQL é realmente necessária; não criar migração vazia nem editar `001-initial.sql` e seu checksum histórico. Se surgir mudança estrutural, usar nova migração explícita, backup e manutenção exclusiva antes de ativar o contrato.

### 6.2 Matriz mínima de invalidação

| Mudança/falha | Preservar | Invalidar ou bloquear |
| --- | --- | --- |
| Copy | Histórico imutável | Aprovação da copy e toda dependência posterior, inclusive plano/seleção/revisões. |
| Conceito | Copy idêntica aprovada | Conceito, assets dependentes, plano, amostra e lote. |
| Asset criativo | Copy/conceito idênticos | Aprovação de assets, composição afetada, amostra e lote. |
| Plano/layout/superfície/destaque | Copy, quando realmente idêntica | Pareceres do render afetado; mudança material exige nova amostra e aprovação. |
| Marca, fonte, renderer ou ficha congelada | Run anterior intacta | Exigir derivação compatível; nunca regravar snapshot. |
| Pixels da amostra ou seleção | Copy/conceito/assets idênticos | Revisão e aprovação da amostra; render e sucessores dependentes. |
| Pixels do lote | Aprovação de direção apenas se plano/recursos/seleção permanecem idênticos | `validate`, revisão final e package. Não reutilizar parecer de bytes anteriores. |
| Rubrica/política | Evidência histórica | Parecer atual sem cobertura explícita não é aceito; versão congelada muda por derivação. |
| Falha isolada do ZIP | Render, validate e revisão final, se íntegros e vigentes | Somente package; revalidar gates/arquivos antes de reutilizar. |

Correção pontual que não mude direção exige novo render/revisão das dependências afetadas; nesta entrega a unidade de tentativa permanece o conjunto da etapa, sem retomada parcial por lâmina. Mudança material não pode ser autodeclarada “pontual” para escapar da amostra. Q01 deve fixar a classificação conservadora e suas fixtures; na dúvida, exigir nova amostra.

### 6.3 Tentativas e correções

No máximo duas rodadas automáticas de correção de composição após o primeiro resultado, quando houver correção implementada e autorizada dentro da ficha/direção. Não implica construir um agente autônomo de design. Registrar defeito, ajuste, número da rodada e nova evidência. Persistindo falha ou faltando alternativa qualificada, parar para decisão. Mudança de copy ou identidade nunca é correção automática.

Esse limite é separado do retry transitório de arquivos existente (duas repetições, 500/1500 ms). Erro de consentimento, recurso, hash ou configuração não deve ser repetido automaticamente. Retomar/reabrir não zera o contador de correção do mesmo episódio; troca material aprovada cria nova identidade de objeto, sem apagar o histórico.

## 7. Gate comum e impossibilidade de atalho acidental

O serviço de aplicação deve verificar a cadeia no início do lote, na validação, antes de empacotar e ao confirmar `completed`, sob o protocolo de lease/fencing e arquivos existente. CLI e plugin expõem a mesma próxima ação; não podem aceitar flags de bypass, `approved:true`, relatório livre ou comando legado como entrega autorizada.

A verificação é específica da fase, sem circularidade: `preview-render` exige apenas os gates anteriores à amostra; `render` acrescenta revisão/aprovação da amostra; `validate` exige o lote vigente e seus gates anteriores, mas não um parecer final ainda inexistente; `quality-review` exige validate aprovado; `package` e `completed` exigem também o parecer final vigente. O serviço não exige a conclusão de uma etapa para permitir que ela produza sua própria evidência.

O renderer/empacotador legado pode continuar acessível para regressão e ensaio isolado. Arquivos produzidos diretamente por esses scripts não criam registros de sucesso no harness, não ganham selo do fluxo novo e não podem ser importados como produção concluída sem a cadeia exigida. Não se promete impedir que alguém execute ferramentas externas com acesso total ao computador.

O handshake da integração deve recusar clientes que não entendam o contrato/grafo novo; Q01 fixa a versão de protocolo e a mensagem de incompatibilidade, sem downgrade automático. Consultas continuam sem mutação; prontidão técnica, permissão de execução, revisão pendente e entrega verificada são informações distintas.

O ZIP público mantém a lista da v0.3: slides, panorama, legenda e referências. Evidências técnicas/editoriais ficam preservadas no workspace, consultáveis ao proprietário e vinculadas à entrega por manifesto. Não acrescentar relatórios privados, fontes ou dados de marca ao ZIP por conveniência. Backup/restore inclui evidências referenciadas e mantém hashes/identidades; fontes seguem excluídas.

## 8. Critérios adicionais de aceitação

| ID | Aceite verificável |
| --- | --- |
| AC33 | Duas marcas usam o compositor qualificado com identidade própria, sem vazamento; papéis, variantes e limites oferecidos possuem fichas e exemplos reais revisados. |
| AC34 | Amostra real cobre capa/interna e risco de densidade/emenda; lote não inicia sem sua revisão e aprovação humana exatas. |
| AC35 | Controles objetivos detectam corte, colisão, overflow, fonte incorreta e limites; caso não verificável bloqueia em vez de passar. |
| AC36 | Revisão editorial inspeciona todos os renders nas duas escalas; ausência, falha, cobertura incompleta ou parecer stale bloqueiam package/completed. |
| AC37 | Alterações de plano, pixels, recursos ou critérios invalidam somente o que pode ser reutilizado com segurança; falha de ZIP preserva evidência vigente. |
| AC38 | Correções respeitam até duas rodadas, não mudam copy/identidade e não reiniciam o limite por resume; nenhum fallback silencioso. |
| AC39 | CLI, plugin, retomada e chamadas diretas aos serviços aplicam o mesmo gate; entrada legada/booleanos não fabricam revisão nem consentimento. |
| AC40 | Histórico v1 continua legível e distinguido de qualificação v2; snapshot imutável, backup/restore e compatibilidade preservam evidências sem aprovações fabricadas. |

A matriz de homologação mínima inclui capa, interna, CTA, diagrama, continuidade, conteúdo no limite e excedente, duas marcas, rejeição/correção de amostra e defeitos de legibilidade. A demonstração Windows e a integração real do hospedeiro permanecem obrigatórias em T33. Uma demo cloud ou teste de adaptador não substitui essa prova.

## 9. Ensaio V2 e produto

Amostra aprovada: capa SHA-256 `2727dbdbe57244afbce8567ae1c463af7518808a21204e868d14c725bfc93a72`; interna/lâmina 8 `01d404fe2ce77b686b306517a242babb52642834e3bf9adb34709dbff8b547a5`. Proveniência: `deliverables/first-visual-trial/editorial-redesign-v2/`, fora do repositório, com README, conceito e `fontes/validation.json`. As imagens foram inspecionadas nesta revisão documental; não foram regeneradas.

A evidência existente cobre duas lâminas cloud, fidelidade textual, 31 blocos na caixa segura e inspeção integral/a 360 px. Não comprova 12 lâminas, continuidade, Windows, outras marcas ou plugin. O texto/legenda/CTA das 12 lâminas continuam aprovados e preservados; ajustes visuais não autorizam edição textual.

O plano oferece um caminho curto separado para concluir esse ensaio em ambiente autorizado, com revisão de todas as lâminas, enquanto o núcleo vem depois. Ainda exige autorização para executar e não altera defaults, scripts do produto ou resultados históricos. A v1 rejeitada permanece como evidência do problema; V03 continua aberta até concluir e apresentar a nova composição.

**Próxima decisão:** revisar este contrato incremental e o plano; a primeira tarefa sugerida é Q01, documental e de inspeção, sem implementar, instalar ou renderizar.
