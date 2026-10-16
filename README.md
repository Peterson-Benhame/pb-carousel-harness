# Peterson Carousel Harness

Um **harness editorial modular para produzir carrosséis com identidade de marca, decisões rastreáveis e revisão de qualidade**. O projeto organiza o trabalho entre texto, conceito visual, imagens e renderização, preservando o que foi usado e aprovado em cada etapa.

A proposta é ajudar criadores, profissionais de conteúdo e equipes que produzem para diferentes marcas a reduzir retrabalho: reutilizar a identidade correta, preservar logotipos originais, revisar uma amostra antes do lote e continuar uma produção sem depender da memória de uma conversa.

## Estado do projeto

**Em desenvolvimento.** Esta versão pública reúne a implementação até T15 e as etapas de composição e qualidade já incorporadas. T16/T17, voltadas à invalidação de etapas e ao controle de execução, estão em andamento fora deste snapshot.

Já existem serviços internos, renderizadores e testes. A experiência completa ainda não está integrada à CLI nem ao plugin. A CLI pública oferece somente ajuda e versão; `@pb/carousel-harness` é o nome definido no manifesto, **não um pacote publicado no npm**.

As cinco fichas de composição permanecem `candidate`, sem liberação estética para produção. O consentimento da amostra permanece bloqueado por padrão até a implementação da verificação confiável de revisão editorial (Q05). Passar nos testes técnicos não libera automaticamente um layout ou uma entrega.

## O fluxo que estamos construindo

1. **Texto (copy):** preparar e versionar a narrativa, os títulos e o conteúdo de cada lâmina.
2. **Conceito e assets:** definir a direção visual, escolher a composição e reunir os recursos criativos, mantendo o logotipo separado como recurso da marca.
3. **Amostra:** renderizar uma seleção representativa de lâminas e emendas para avaliar a direção antes de produzir tudo.
4. **Revisão e aprovação:** conferir qualidade objetiva e editorial; registrar o consentimento sobre a versão exata apresentada.
5. **Lote:** produzir o conjunto completo com os mesmos recursos e decisões aprovadas, seguido de nova verificação de qualidade.
6. **Entrega:** reunir os arquivos finais e seus manifestos de integridade.

Essa sequência é a **visão do fluxo completo**. Os contratos, componentes e testes já cobrem partes importantes dela, mas a integração produtiva de ponta a ponta continua pendente. As skills ajudam a preparar o material editorial, mas não comprovam um plugin integrado.

## O que já existe no núcleo

- **Memória de marca:** cadastro e revisões imutáveis, com identidade, temas e preferências confirmadas. Ajustes de um carrossel ficam separados das preferências permanentes; consultas preservam o isolamento entre marcas.
- **Logotipos PNG:** importação validada, preservação dos bytes originais e associação explícita a superfícies claras ou escuras. O núcleo não recolore, recorta ou inventa variantes.
- **Snapshots de execução:** registro congelado da marca, tema, recursos e runtime utilizados. Uma revisão posterior da marca não muda silenciosamente uma produção existente.
- **Persistência e integridade:** SQLite para metadados e estado; arquivos locais imutáveis identificados por hash. Operações transacionais e idempotentes evitam duplicar resultados quando uma solicitação é repetida.
- **Estados e concorrência:** máquina de estados, consulta de pendências e leases por execução, com tokens que impedem um executor antigo de confirmar mudanças após perder a posse.
- **Consentimento vinculado ao conteúdo:** aprovações de texto, conceito, assets e amostra referenciam os objetos e versões correspondentes. Um campo `approved: true` não substitui confirmação humana.
- **Composição e qualidade:** compositor modular, seleção real de amostra, contratos de evidência e verificações de texto, geometria, tipografia, contraste e integridade. A rubrica editorial exige avaliação humana; verificações automáticas não comprovam, sozinhas, qualidade estética.

Essas capacidades são internas. Seus limites e evidências estão nos [relatórios técnicos](docs/testing/), incluindo [aprovações](docs/testing/t15-approvals.md) e [qualificação visual](docs/testing/layout-qualification.md).

## Um núcleo, uma memória local

A arquitetura prevê **CLI, plugin e distribuição npm usando os mesmos serviços e o mesmo armazenamento local**. O plugin não terá uma memória paralela, e o histórico de conversa não será a fonte de verdade de aprovações ou arquivos.

O primeiro alvo de produto é Windows x64, com um proprietário por instalação e marcas separadas. Este módulo não oferece sincronização entre computadores, serviço em nuvem, editor gráfico ou publicação automática no Instagram.

O código está organizado em:

- [`src/domain/`](src/domain/): contratos, fingerprints, políticas e estados
- [`src/application/`](src/application/): memória, arquivos, execuções e aprovações
- [`src/infrastructure/`](src/infrastructure/): SQLite, filesystem e recursos
- [`src/render/`](src/render/) e [`src/quality/`](src/quality/): composição e verificações
- [`skills/`](skills/), [`shared/`](shared/) e [`scripts/`](scripts/): preparação editorial, schemas e ferramentas existentes

## Desenvolvimento local

Use **Node.js 24.21.0**, versão declarada em [`package.json`](package.json), e npm. As dependências incluem componentes nativos; a [matriz de runtime](docs/architecture/runtime-matrix.md) delimita o ambiente qualificado e os requisitos. Testes em Linux não equivalem à homologação do produto nesse sistema.

Para preparar uma cópia de desenvolvimento com o lockfile existente:

```sh
git clone https://github.com/Peterson-Benhame/pb-carousel-harness.git
cd pb-carousel-harness
npm ci --ignore-scripts --include=optional --no-audit --no-fund
```

Esse comando não executa scripts de instalação e pode deixar addons nativos sem preparar. Antes dos testes, provisione e verifique os addons conforme a [matriz de runtime](docs/architecture/runtime-matrix.md). A opção `--ignore-scripts`, sozinha, não entrega um ambiente pronto; não há garantia de suporte a qualquer plataforma.

Com os addons disponíveis e verificados:

```sh
npm test
```

Para conferir a interface mínima, sem criar diretórios de dados nem carregar SQLite ou o renderer:

```sh
node bin/peterson-carousel.mjs --help
node bin/peterson-carousel.mjs --version
node bin/peterson-carousel.mjs --version --json
```

A qualificação nativa Windows é separada: `npm run test:qualification`. Consulte a [documentação da CLI](docs/cli.md) para limites e empacotamento interno. Não há comandos públicos de produção, plugin integrado ou fluxo `npx` homologado.

## Documentação e atribuição

- [Especificação do módulo 01](docs/plans/module-01/baseline-reference/ESPECIFICACAO-v0.3.md) e [adendo de qualidade](docs/plans/module-01/ESPECIFICACAO-ADENDO-QUALIDADE-v0.4.md)
- [Plano de implementação](docs/plans/module-01/PLANO.md) e [contratos de qualidade](docs/architecture/quality-contract.md)
- [Recursos tipográficos e condições de uso](docs/architecture/quality-font-gate.md)

Os planos incluem requisitos futuros; não são uma lista de funcionalidades entregues.

Inspirado em [Carousel Suite](https://github.com/tenfoldmarc/carousel-suite-skill), de [@tenfoldmarc](https://github.com/tenfoldmarc). A atribuição e os limites de publicação estão em [ATTRIBUTION.md](ATTRIBUTION.md). Esta cópia pública é sanitizada e não inclui o histórico privado de trabalho nem artefatos pessoais.

**Nenhuma nova licença de projeto é concedida.** O pacote permanece `private: true`, com staging `UNLICENSED`; publicar o código no GitHub não autoriza distribuir o pacote npm ou tarball. Os avisos OFL de Anton, Manrope e JetBrains Mono permanecem em [`assets/fonts/`](assets/fonts/). No produto e na distribuição planejados, fontes são recursos externos: seus binários não integram o pacote npm, o ZIP de entrega nem o backup.
