# Q01 — Gate de fontes e reprodução da direção V2

> Cópia pública sanitizada: registros privados de conversa e execução foram omitidos. Estados e resultados técnicos abaixo descrevem a etapa original, não uma certificação da versão atual.

**Data da inspeção:** 16/10/2026, UTC. **Base:** `8c2c2c65e7c9db96519434d294564cb972f02dd8`.

## 1. Conclusão para decisão

- **Verificado no cloud:** arquivos, metadados, hashes e avisos locais de Anton, Manrope, JetBrains Mono e Nimbus Roman Italic. Os três primeiros correspondem ao manifesto v1; Anton, Manrope e Nimbus correspondem aos hashes registrados no protótipo V2.
- **Verificado no Windows por relatório da inspeção delegada:** os três hashes baseline correspondem aos do cloud. **Nimbus ausente nos locais inspecionados**, conforme o relatório privado de inspeção, não incluído nesta cópia; não se afirma ausência em todo o computador.
- **Ausente no produto atual:** identidade, papel `accent` e resolução de Nimbus no manifesto/validador de marca v1. Existência no sistema não cria suporte no harness.
- **Não verificado:** redistribuição do binário Nimbus, de subsets ou de curvas SVG como recurso reutilizável; qualificação visual do produto com o acento; cadeia original de aquisição dos arquivos locais; arquivos/licenças exatos das referências históricas Okrite/Danish nesta execução.
- **Caminho mínimo fiel ao V2 privado:** usar, em tarefa separadamente autorizada, os arquivos já existentes no cloud, com os hashes abaixo, para compor imagens raster e manter os intermediários no workspace privado. Não depende de instalar Nimbus no Windows. A dúvida sobre distribuição de curvas SVG não demonstra proibição de gerar raster privado.
- **Reprodução fiel no Windows bloqueada hoje:** falta um arquivo Nimbus correspondente entre os recursos inspecionados. Resolver por decisão do usuário: disponibilizar uma cópia obtida de fonte oficial sob condições verificadas, em ação separadamente autorizada; ou aprovar outra fonte já existente e licenciada, seguida de nova amostra/qualificação. Não há compra obrigatória inferida nem substituição silenciosa.

A aprovação visual V2 não é aceite de licença, autorização de instalação, transferência ou distribuição. A revisão abaixo registra evidências e uma política conservadora de engenharia; não é parecer jurídico nem garantia de direitos sobre qualquer modalidade de publicação.

## 2. Identidades locais verificadas

Os caminhos desta seção são **evidência da inspeção**, não defaults de produto nem valores permitidos no snapshot. Os três arquivos baseline estão em `assets/fonts/`, relativos ao repositório cloud. O acento está em `/usr/share/fonts/opentype/urw-base35/NimbusRoman-Italic.otf`.

| ID de recurso | Arquivo | Metadados extraídos dos bytes locais | Papel |
| --- | --- | --- | --- |
| `Anton` — preservar ID v1 | `Anton-Regular.ttf`, 170.812 bytes | família Anton; Regular; PostScript `Anton-Regular`; versão `2.116; ttfautohint (v1.8.3)`; peso 400; sem eixos variáveis | `title` |
| `Manrope` — preservar ID v1 | `Manrope-VariableFont_wght.ttf`, 165.420 bytes | família tipográfica Manrope; família legada Manrope ExtraLight; PostScript `Manrope-ExtraLight`; versão 4.504; eixo `wght` mínimo 200, default 200, máximo 800 | `body` |
| `JetBrains Mono` — preservar ID v1 | `JetBrainsMono-VariableFont_wght.ttf`, 187.208 bytes | família JetBrains Mono; Regular; PostScript `JetBrainsMono-Regular`; versão 2.211; eixo `wght` mínimo 100, default 400, máximo 800 | `mono` |
| `nimbus-roman-italic@1` — ID proposto, não implementado | `NimbusRoman-Italic.otf`, 105.684 bytes | família Nimbus Roman; Italic real; PostScript `NimbusRoman-Italic`; versão 1.00; identificador `URW:NimbusRoman-Italic:2016`; peso 400; sem eixos; ângulo CFF −15,5° | `accent`, apenas na marca/plano que o autorizar |

**SHA-256 dos binários:**

| Recurso | SHA-256 |
| --- | --- |
| Anton | `a4ba3a92350ebb031da0cb47630ac49eb265082ca1bc0450442f4a83ab947cab` |
| Manrope | `d0639be45d0af36e798172419d7bd173c4bd4f29e2b76cbb69db1d11bf8b0a40` |
| JetBrains Mono | `48715a42ec242c21e9f02692891e147d022299a52e48d5e413e1a942193ffeda` |
| Nimbus Roman Italic | `b7c424e6cb79baddfcdcd9a9d87f9fc4fdd06f0e5160066e2b2e47bcd647c7b9` |

**Evidência de licença local:**

| Recurso | Arquivo e identificação | SHA-256 do texto local |
| --- | --- | --- |
| Anton | `assets/fonts/Anton-OFL.txt`; OFL 1.1; copyright 2020 The Anton Project Authors; origem declarada googlefonts/AntonFont | `9267baca92b7a7ce9db6dd9e6cc32c9fe3ddf1ac96e421d5f87c5746b9089d6a` |
| Manrope | `assets/fonts/Manrope-OFL.txt`; OFL 1.1; copyright 2018 The Manrope Project Authors; origem declarada sharanda/manrope | `f612090fb72b6dca3e807e66fa0d2b5def163cef86f1a3209b5c897cba5ee4b7` |
| JetBrains Mono | `assets/fonts/JetBrainsMono-OFL.txt`; OFL 1.1; copyright 2020 The JetBrains Mono Project Authors; origem declarada JetBrains/JetBrainsMono | `b2fe5e8987594e9ffd1d2ca52a2f5d73eb8335243893c5d6254b5ad69269591d` |
| Nimbus | `/usr/share/doc/fonts-urw-base35/copyright`; seção `Files: *`; AGPL-3 com exceção de fonte; copyright URW Software 2015 e URW++ 2013–2014; origem declarada ArtifexSoftware/urw-base35-fonts | `1315a62758a603a3e6e87a79b8389563789c59c1740b9db8bc2b20e2e2145458` |

Os nomes e textos de licença embutidos nos três TTF também indicam OFL 1.1. Manrope contém copyright 2019 nos metadados, enquanto seu aviso avulso registra 2018; manter ambos, sem editar avisos nem presumir que a diferença invalide a licença. Não foi comparado o binário local com um download atual do upstream. Links `main`/`master` consultados são fontes primárias móveis, não prova de igualdade byte a byte com este inventário.

Nimbus contém copyright URW++ 2014 e versão interna 1.00. `dpkg-query -S` não localizou um pacote dono do arquivo e `dpkg-query -W fonts-urw-base35` não encontrou cadastro de pacote. Portanto **arquivo e aviso existem**, mas versão do pacote e método/data de instalação permanecem **não verificados**. Não trocar a versão interna por uma versão inferida de distribuição Linux.

`OS/2.fsType` é 0 nos três TTF e 4 em Nimbus. A [especificação OpenType da Microsoft](https://learn.microsoft.com/en-us/typography/opentype/spec/os2#fstype) define esses bits para embedding; eles não substituem a leitura da licença nem autorizam, por si, instalação ou redistribuição. O valor 4 corresponde a preview/print embedding, não a uma licença geral para todos os formatos.

## 3. Licença, uso e formato de saída

Fontes primárias consultadas em 16/10/2026:

1. [Anton, OFL no Google Fonts](https://github.com/google/fonts/blob/main/ofl/anton/OFL.txt).
2. [Manrope, OFL no Google Fonts](https://github.com/google/fonts/blob/main/ofl/manrope/OFL.txt). O cabeçalho atual aponta googlefonts/manrope; o aviso local mais antigo aponta sharanda/manrope. Ambos identificam OFL 1.1; não afirmar igualdade de arquivos.
3. [JetBrains Mono, OFL do autor](https://github.com/JetBrains/JetBrainsMono/blob/master/OFL.txt).
4. [SIL, uso de fontes OFL](https://openfontlicense.org/how-to-use-ofl-fonts/) e [FAQ oficial, §§1.1–1.15 e 2.6](https://openfontlicense.org/ofl-faq/).
5. [Artifex, licença específica urw-base35](https://github.com/ArtifexSoftware/urw-base35-fonts/blob/master/LICENSE) e [AGPL v3 que a acompanha, especialmente §2](https://github.com/ArtifexSoftware/urw-base35-fonts/blob/master/COPYING).

### Baseline OFL: Anton, Manrope e JetBrains Mono

A orientação oficial SIL distingue a criação de peças gráficas da entrega da própria fonte. Uso em imagens e desenho com contornos é permitido, sem transformar a peça em software OFL ou exigir crédito na arte. Distribuir o arquivo de fonte exige conservar avisos e licença; modificações, incluindo determinados subsets/webfonts, exigem análise das condições e de nomes reservados. Embedding de documento tem tratamento próprio. Ver [orientação de uso](https://openfontlicense.org/how-to-use-ofl-fonts/) e [FAQ](https://openfontlicense.org/ofl-faq/).

Isso não altera a política deste projeto: mesmo fontes OFL ficam externas ao pacote, ZIP e backup. O inventário não é autorização operacional para copiá-las ou distribuí-las.

### Nimbus: separar a licença da exceção documental

O [LICENSE específico da Artifex](https://github.com/ArtifexSoftware/urw-base35-fonts/blob/master/LICENSE) e o aviso local identificam AGPL v3 com exceção que menciona **“in a Postscript or PDF file”**. Ela permite incorporar programas de fonte nesses documentos sem impor as condições da fonte ao documento. Esse texto não nomeia SVG, WOFF, atlas de glifos ou pacote npm; não generalizar a exceção.

A [AGPL, §2](https://github.com/ArtifexSoftware/urw-base35-fonts/blob/master/COPYING) distingue execução e obra de saída: a saída só é abrangida quando seu conteúdo constitui obra coberta; também trata uso sem entrega a terceiros. Assim, o simples fato de a fonte ser AGPL não demonstra que todo PNG produzido seja AGPL, ilícito ou impedido. A política proposta preserva o uso privado da cópia existente e reserva a revisão das modalidades de distribuição. Não se conclui aqui que ler uma fonte externa obrigue automaticamente relicenciar o harness.

| Operação | Decisão prática desta Q01 |
| --- | --- |
| Ler a cópia já existente para medir/renderizar em ensaio privado autorizado | Caminho mínimo proposto. Usar os hashes verificados e não transferir a fonte. Q01 não executa o ensaio. |
| Gerar PNG/panorama raster para revisão privada | Não há bloqueio de disponibilidade no cloud. Não confundir raster com entrega do binário. Publicação posterior exige autorização e revisão do formato/escopo aplicável. |
| Manter SVGs com curvas como intermediários privados | Não são arquivos de fonte instaláveis; mantê-los privados. Não lhes atribuir automaticamente a exceção PDF/PS. |
| Entregar/publicar SVGs em curvas, atlas, subsets ou contornos reutilizáveis | **Não verificado para Nimbus nesta revisão.** Avaliar o conteúdo efetivo e condições aplicáveis antes de distribuir; ausência de `.otf` não encerra a análise. |
| Embutir Nimbus em PDF/PostScript | A exceção específica existe, mas esse formato não integra o caminho aprovado do ZIP e não foi executado. Não transformá-la em aprovação de qualquer embedding. |
| Copiar/instalar/distribuir TTF/OTF/WOFF ou fonte em pacote/backup | Fora desta autorização. No produto proposto, os binários e subsets ficam externos. Qualquer mudança dessa política exige decisão própria e revisão dos termos. |

O desconhecimento sobre SVG distribuível não é uma constatação de infração dos SVGs privados existentes. A expressão “licença verificada” significa texto e origem declarada identificados; não é liberação irrestrita de todos os usos.

## 5. Gate proposto para contratos v2

Aplicar por recurso realmente exigido pelo renderer/plano/ficha. O legado mantém suas três identidades e hashes. O composto declara seu subconjunto explicitamente; usar acento não torna Nimbus default de todas as marcas. A ausência de um recurso opcional não usado não bloqueia os demais layouts.

### Identidade e evidências

- Identidade: `id` fechado, `file` apenas basename, `sha256`, `familyName`, `postScriptName`, `fontVersion`, `style`, `weight` e definição dos eixos variáveis. Instâncias usadas registram valores exatos de eixo, sem síntese de itálico/negrito implícita.
- Papéis permitidos: `title|body|mono|accent`. O acento candidato é `nimbus-roman-italic@1`; não alterar os IDs históricos `Anton`, `Manrope` e `JetBrains Mono`.
- Proveniência/licença: URLs oficiais, data da consulta, identificação do texto aplicável, hash do aviso local e limites da revisão. Preservar divergências factuais de metadados. Separar evidência da licença de autorização do usuário para a operação concreta.
- Disponibilidade por ambiente: `verified|absent|not-verified`, com data, alcance da busca e evidência. Hash divergente tem diagnóstico de incompatibilidade, não é `verified`. Sem leitura suficiente, usar `not-verified`, não inventar `absent`.
- Snapshot e manifests preservam identidades/hash; nenhuma fonte binária ou caminho absoluto. Resolução de caminho existe somente no ambiente, sob raiz externa autorizada, confinamento e allowlist. Não aceitar um caminho de fonte arbitrário vindo da marca ou do plano.

### Ordem de decisão

1. Identificar os recursos exigidos pela marca/plano e conferir a autorização para esse uso. Uma imagem aprovada não satisfaz autorização de instalar/distribuir recursos.
2. Resolver somente arquivos já autorizados no ambiente; verificar SHA-256 e identidade real antes de medir/renderizar. Falha, inacessibilidade ou diferença interrompem a operação dependente com diagnóstico específico.
3. Conferir evidência de licença para a modalidade pedida. Uso local, entrega raster, publicação de SVG e distribuição de fonte são modalidades diferentes; um único `approved: true` não deve reuni-las.
4. Conferir que a ficha qualificada cobre aqueles bytes, papel e instâncias. Mudança de fonte/peso/itálico é material, exige nova derivação/evidência e nova amostra quando aplicável. Nunca reutilizar aprovação visual de bytes diferentes por semelhança nominal.
5. Antes de publicar/distribuir, revisar novamente o conteúdo real da saída e os termos aplicáveis. Fontes e subsets não entram em npm/`.tgz`, ZIP de entrega nem backup; restaurar evidências não restaura fonte ausente nem fabrica autorização.

Os nomes e tipos finais de erros/objetos ficam no [contrato de qualidade](quality-contract.md), evitando um segundo vocabulário normativo aqui. O alinhamento acordado é `RESOURCE_MISSING` para ausente/não configurado; `RUNTIME_MISMATCH` para hash/identidade/fonte efetiva divergente; `FONT_LICENSE_UNVERIFIED` para modalidade de uso não verificada; `FONT_USE_UNAUTHORIZED` para uso dependente de decisão ainda não autorizada. Os dois primeiros já existem no resolvedor v1, mas não implementam sozinhos a revisão de licença/autorização v2. Nenhum desses campos novos foi adicionado ao código nesta Q01.

## 6. Caminhos liberáveis e bloqueios reais

**Ensaio privado V03.a/V03.b:** há recursos cloud suficientes para reproduzir a direção tipográfica exata. Falta autorização dessa tarefa e execução/revisão das 12 lâminas; não falta uma instalação cloud de Nimbus. Proposta mínima: ler os arquivos existentes, registrar hashes, gerar somente os artefatos autorizados e manter vetores/intermediários privados. A produção do conjunto não passa a qualificar Windows, plugin ou produto.

**Produto composto:** Q02 precisa da decisão sobre o recurso de acento e seu caminho externo autorizado; Q03/Q06 ainda precisam testar e qualificar composição real com os mesmos bytes. No Windows, a reprodução Nimbus depende de resolver a ausência delimitada. Fonte já existente alternativa só entra após inspeção de licença/identidade, decisão visual explícita e nova amostra; não oferecer Times New Roman, outro Nimbus ou “serif” como equivalência automática.

**Distribuição:** além deste gate, `ATTRIBUTION.md` mantém uma restrição independente sobre reutilização/distribuição da adaptação upstream. Uma licença OFL ou uma imagem raster não remove esse gate nem concede autorização para publicar o pacote. A autorização de Q01 cobre inspeção e este documento, não aquisição, instalação, aceite de termos ou distribuição.
