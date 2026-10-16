# Peterson Carousel Harness

Cópia sanitizada do código do módulo 01, exportada do snapshot `8419011d4f0a6bdb8320d1618bc3c8bda1c314f1`. O histórico privado de trabalho, registros de conversa e artefatos pessoais não integram este repositório. Código de produto, testes, manifests, recursos e fontes incluídos foram preservados sem alteração de comportamento.

## Escopo e estado

O projeto reúne CLI, persistência de marcas e execuções, validação de recursos, composição de carrosséis e contratos de qualidade. Os documentos de planejamento também contêm requisitos futuros; sua presença não significa que todas as etapas estejam implementadas ou homologadas. Esta exportação corresponde ao snapshot acima e não incorpora trabalho posterior de T16/T17.

## Documentação

- [CLI e empacotamento interno](docs/cli.md)
- [Especificação do módulo 01](docs/plans/module-01/baseline-reference/ESPECIFICACAO-v0.3.md)
- [Adendo de qualidade](docs/plans/module-01/ESPECIFICACAO-ADENDO-QUALIDADE-v0.4.md)
- [Plano de implementação](docs/plans/module-01/PLANO.md)
- [Plano de qualidade](docs/plans/module-01/PLANO-REVISAO-QUALIDADE.md)
- [Contratos de qualidade](docs/architecture/quality-contract.md)
- [Recursos tipográficos e condições de uso](docs/architecture/quality-font-gate.md)
- [Matriz de runtime](docs/architecture/runtime-matrix.md)

## Verificação local

O runtime declarado em package.json é Node 24.21.0. Com as dependências já instaladas em um ambiente autorizado, `npm test` executa os testes. A qualificação nativa Windows é separada, pelo comando `npm run test:qualification`. Instalação e homologação de produto não são demonstradas apenas pela publicação deste código.

## Atribuição e distribuição

Consulte [ATTRIBUTION.md](ATTRIBUTION.md). O responsável declarou autoria e autorizou esta publicação; isso não representa verificação independente de licença upstream. Nenhuma licença nova de projeto é concedida. O pacote npm continua privado, com staging UNLICENSED. Os avisos OFL das três fontes permanecem em assets/fonts/; as regras existentes que excluem fontes de npm e backup continuam válidas.
