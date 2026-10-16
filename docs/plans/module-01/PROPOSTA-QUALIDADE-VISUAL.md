# Proposta de adendo — Qualidade visual de produção

> Cópia pública sanitizada: registros privados de conversa e execução foram omitidos. Estados e resultados técnicos abaixo descrevem a etapa original, não uma certificação da versão atual.

**Status: PROPOSTA AGUARDANDO APROVAÇÃO.**  
**Data:** 16/10/2026. **Base inspecionada:** `8c2c2c6`, T00–T13.  
**Escopo:** requisitos e aceite propostos; nenhuma implementação, alteração de contrato vigente ou liberação de tarefas.

## 1. Resultado pretendido

Estabelecer um padrão reutilizável de criação, revisão e bloqueio de entrega para cada marca. O compromisso verificável é entregar somente composições que cumpram critérios técnicos, tenham revisão editorial registrada e respeitem a direção visual aprovada. Não é uma garantia automática de gosto universal.

A motivação é o pedido de 16/10: “não quero que alguém que vá usar meu harness passe por isso, quero que sempre seja profissional”. O primeiro ensaio passou nas verificações estruturais, mas o usuário rejeitou sua qualidade visual. Corrigir apenas a curva sobre o texto da lâmina 2 não resolve essa rejeição.

## 2. O que existe e o que falta

- A especificação v0.3, seção 15, já exige inspeção de logo, proporção, assinatura e sobreposição. T19 e T33 já preveem revisão visual; a skill de design exige examinar panorama, capa, transição, lâmina densa e CTA. **Não faltava toda e qualquer previsão de QA visual.**
- O validador atual verifica o contrato de entrada. O template possui encaixe tipográfico por largura, tamanho mínimo e quantidade de linhas; isso não verifica todas as colisões entre blocos, decoração, rodapé e assets. O renderer aplica uma composição predominantemente fixa, com assets de continuidade sobrepostos ao conjunto.
- T21 prevê integridade dos resultados. Dimensões, hashes, transparência, recortes idênticos e regressão pixel a pixel comprovam propriedades técnicas; uma composição ruim pode passar em todos. Preservar o legado em T18 também não o torna uma referência estética aprovada.
- Falta transformar revisão visual e adequação editorial em condições obrigatórias de liberação, com evidência vinculada ao render, além de homologar layouts para diferentes conteúdos e densidades.

As três referências enviadas em `deliverables/first-visual-trial/user-feedback/` foram examinadas. Elas mostram soluções editoriais distintas, incluindo uma composição bastante simples. Servem para discutir hierarquia, ritmo, espaços e acabamento; não impõem a mesma paleta, fonte, fotografia ou quantidade de elementos a todos, nem autorizam copiar seus assets.

## 3. Padrão de criação por marca e por execução

1. **Confirmar a direção.** Usar identidade, público, objetivo e preferências confirmadas da marca, mais o pedido desta execução. Na ausência de direção suficiente, apresentar opções qualificadas e obter a escolha. Referências de um cliente não viram padrão de fábrica para outro.
2. **Escolher uma composição qualificada para o conteúdo.** Cada versão de template/layout deve declarar papéis atendidos, fontes e recursos, áreas seguras, escala tipográfica, espaçamentos, limites de linhas/densidade, regras de imagem/diagrama e cenários em que não serve. Limites numéricos precisam estar definidos e testados antes da qualificação; “adaptável” sem limites não basta.
3. **Adaptar o layout antes de comprimir o texto.** Medir os blocos reais; selecionar uma variante homologada, redistribuir espaços e ajustar o encaixe dentro de seus limites. Não reduzir indefinidamente a fonte, ocultar conteúdo ou aceitar overflow. Se nenhuma variante comportar a copy, pedir autorização para a alteração textual ou redistribuição entre lâminas; preservar a versão aprovada até lá.
4. **Revisar e aprovar uma amostra composta antes do lote.** Mostrar capa e uma interna representativa usando copy, fontes e ativos reais. Incluir também a maior densidade ou uma transição problemática quando não estiver coberta por essas duas. Aprovação de um diagrama isolado não aprova seu encaixe. A prévia precisa passar pela revisão interna antes de ser apresentada como proposta de direção.
5. **Gerar o conjunto e revisar todos os slides.** Após a aprovação específica da amostra, produzir o lote, verificar tecnicamente e inspecionar cada lâmina e o panorama. Mudança material de identidade, layout ou recursos exige nova amostra; correção pontual dentro da direção aprovada exige nova revisão do trecho e das dependências afetadas.
6. **Liberar somente o conjunto aprovado nos dois controles.** A aprovação da amostra não dispensa a inspeção final. Uma prévia reprovada pode ser apresentada para decisão, claramente identificada; não é entrega final nem produção concluída.

O gate da amostra é um requisito novo proposto. Seu encaixe nas aprovações, etapas e invalidações da v0.3 exige desenho e aprovação próprios; este documento não acrescenta estados, campos, comandos ou migrações.

### Identidade e fontes

O legado usa Anton/Manrope/JetBrains Mono. Há contexto histórico de preferências tipográficas diferentes, que não foi reconciliado com a configuração desta execução. Isso pede confirmação explícita da identidade aplicável, não substituição silenciosa nem bloqueio presumido por um registro histórico. A proposta não altera fontes, factory defaults ou o escopo atual de fontes personalizadas. Preferências de uma marca permanecem isoladas, versionadas e confirmadas conforme a v0.3.

## 4. Dois controles de qualidade complementares

### Controle objetivo

Todos os itens aplicáveis devem passar. A evidência identifica slide, elemento, limite esperado, valor observado e arquivo renderizado.

| Requisito | Evidência verificável para aprovação |
| --- | --- |
| Integridade e fidelidade | Contagem, ordem, dimensões, decodificação, hashes e correspondência com copy/assets aprovados. Reutilizar os checks previstos em T20/T21. |
| Geometria | Blocos e glifos dentro das áreas permitidas; nenhuma colisão indevida com texto, rodapé, marca ou decoração. Sobreposições intencionais só entre elementos e regiões declarados, preservando informação e leitura. |
| Tipografia e densidade | Fontes efetivas conferidas; tamanhos, entrelinhas, linhas e espaçamentos dentro dos intervalos do layout qualificado. Testes no limite e logo além dele demonstram aprovação e bloqueio. |
| Contraste e recursos | Pares de cores e recursos aprovados para a superfície; texto sobre imagem precisa de tratamento e revisão do fundo efetivo. A ficha do layout fixa os limites mensuráveis adotados, sem inferir contraste adequado apenas pelo nome do tema. |
| Marca e imagens | Proporção, proteção e tamanho mínimo respeitados; ausência de corte indevido, distorção, perda de definição ou recurso ausente. Reaproveitar os requisitos de T19. |
| Continuidade | Emendas correspondem ao plano; cada slide preserva sua mensagem quando visto sozinho. Nenhuma palavra, dado ou parte essencial do diagrama depende de um recorte invisível. |

Esses checks precisam de implementação e qualificação; não estão sendo declarados existentes. Valores geométricos ou métricas aproximadas insuficientes para julgar o raster devem encaminhar a revisão visual, nunca produzir um passe por ausência de detecção.

### Revisão editorial do render

Um revisor com acesso aos pixels examina o conjunto em tamanho integral e em uma prévia equivalente à leitura móvel, com largura registrada. Para cada item, registra **atendido**, **reprovado** ou **não verificado**, com slides e observações. Não usar média de notas para esconder um defeito bloqueante.

- **Hierarquia:** a mensagem principal e a sequência de leitura são identificáveis; títulos, corpo e chamadas não competem pelo mesmo destaque.
- **Composição:** alinhamentos, margens e espaços seguem uma intenção consistente; não há blocos espremidos, vazios acidentais ou quebras que prejudiquem a leitura.
- **Ritmo:** capa, desenvolvimento e CTA cumprem papéis distintos; as variações acompanham o conteúdo, sem repetir mecanicamente um arranjo inadequado nem variar por enfeite.
- **Semântica visual:** imagens e diagramas ajudam a entender a mensagem. Diagramas têm relações, direção, rótulos e escalas legíveis; ícones e traços têm tratamento consistente, sem aparência de rascunho involuntário.
- **Acabamento e identidade:** recortes, bordas, cores, tipografia e assinatura são coerentes com a direção aprovada; elementos decorativos não atrapalham a informação.

Simplicidade é permitida. Não há quota de fotografias, ilustrações ou decoração. Uma composição tipográfica ou um diagrama simples pode ser aprovado quando satisfaz esses critérios.

## 5. Bloqueio, revisão e correção

- **Bloqueiam a entrega:** falha objetiva; reprovação em qualquer item editorial; mudança não aprovada da copy/identidade/assets; revisão ausente ou sem acesso aos pixels; parecer referente a outra versão. Avisos sem impacto podem permanecer somente quando explicitamente justificados pelo revisor.
- **Responsabilidade:** registrar quem revisou, método, resolução de leitura, versão do critério e hashes das imagens. Avaliação automatizada pode auxiliar; não substitui a aprovação humana da amostra no modo guiado. O produto precisa declarar quais recursos de revisão realmente estão disponíveis. Sem revisão visual disponível, manter a pendência e pedir revisão humana, sem afirmar qualidade garantida.
- **Correção limitada:** propor até duas rodadas automáticas de ajustes de composição dentro da direção e dos limites autorizados. Cada rodada registra defeito, mudança e nova evidência. Persistindo o problema, parar para decisão. Não repetir indefinidamente nem modificar texto para obter aprovação aparente.
- **Fallback:** usar outra variante qualificada somente se compatível com marca/conteúdo e com a aprovação aplicável. Se mudar a direção, apresentar nova amostra. Sem alternativa adequada, informar o bloqueio e oferecer revisão do conteúdo ou trabalho de design específico; não retornar silenciosamente ao legado como resultado aprovado.
- **Validade:** qualquer mudança que afete pixels invalida o parecer visual correspondente; mudança de versão da rubrica exige declarar a cobertura do parecer anterior. Copy e assets seguem suas invalidações já previstas. Uma falha isolada no pacote permite reutilizar evidências íntegras, conforme o plano existente.

## 6. Demo e produto são trabalhos separados

**Ensaio atual:** manter o primeiro resultado como evidência rejeitada; propor uma nova capa e uma interna à luz do feedback; preservar a copy aprovada; submeter mudanças de conceito/assets/fontes quando necessárias. Esse ajuste depende de autorização e não qualifica o produto para qualquer marca.

**Produto:** incorporar o gate no aceite e no fluxo real após aprovação deste adendo e revisão do plano. Reutilizar snapshots, fingerprints, aprovações, isolamento e checks já previstos. Um checklist externo ou uma demonstração bonita, isoladamente, não comprova que o harness impede uma entrega reprovada.

| Trabalho previsto | Impacto proposto, sem iniciar a tarefa |
| --- | --- |
| T18 | Manter regressão de compatibilidade do legado e separar fixtures de qualificação editorial. Mudança estética não pode passar despercebida como atualização da baseline. |
| T19 | Ampliar a inspeção já prevista para conflitos de marca com a composição real; manter geometria, proporção e recursos existentes. |
| T20 | Identificar prévia e render final, recursos efetivos e evidências por tentativa; planejar onde a amostra será produzida sem contornar aprovações. |
| T21 | Reutilizar integridade pós-render e acrescentar os controles objetivos aprovados; exigir o parecer editorial válido antes da liberação, sem confundir validação com consentimento. |
| T30 | Testar reprovação, parecer ausente/obsoleto, revisão indisponível, recursos faltantes, limites de correção e tentativas de liberar pelo caminho CLI/plugin. |
| T33 | Demonstrar no Windows duas identidades distintas, conteúdo denso, amostra rejeitada/corrigida e entrega bloqueada quando reprovada; incluir inspeção de todas as saídas. |
| Módulo seguinte | Homologar catálogo e variantes de layout por papel/densidade, incluindo diagramas. Consumir a mesma memória de marca e snapshots. O catálogo continua fora do Módulo 01 até aprovação de mudança explícita de escopo. |

As dependências do gate sobre aprovações, snapshot, transições, empacotamento e aceite final também precisam ser reconciliadas no replanejamento. Não basta alterar T21 enquanto outra rota continua liberando o pacote. Nenhuma dessas mudanças está autorizada por este documento.

## 7. Critério de conclusão do padrão

O padrão estará comprovado quando uma matriz de homologação demonstrar:

1. Duas marcas distintas, sem vazamento de preferências, com direção e amostras próprias aprovadas.
2. Capa, interna, CTA, texto no limite, conteúdo excedente, diagrama e continuidade revisados; cada variante oferecida possui ficha de limites e exemplos aprovados.
3. Casos negativos reproduzíveis: colisão, baixa legibilidade, layout sem qualificação, parecer ausente/obsoleto e revisão indisponível impedem a entrega final, inclusive pela retomada e por ambos os canais.
4. Correção e nova inspeção liberam somente a versão correspondente; nenhuma alteração silenciosa de copy; fallback e limite de tentativas demonstrados.
5. Evidências técnicas e editoriais acessíveis para cada conjunto liberado, com limitações declaradas. Uma peça apenas estruturalmente válida continua sem selo de qualidade visual.

**Próxima decisão:** aprovar ou revisar esta proposta. Só depois preparar a revisão da especificação/plano e submeter as tarefas afetadas. T14–T34 e o catálogo não foram iniciados; código, configurações, contratos vigentes e fontes não foram modificados.

### Base consultada

- [Especificação v0.3](baseline-reference/ESPECIFICACAO-v0.3.md), seções 3, 5–8, 12 e 15–16.
- [Plano do Módulo 01](PLANO.md), T18–T21, T30, T33 e limites do catálogo.
- `skills/peterson-carousel-design/SKILL.md`, `shared/templates/panorama.svg.js`, `scripts/render-carousel.mjs`, `scripts/validate-carousel.mjs`, `src/domain/stage-graph.mjs`.
