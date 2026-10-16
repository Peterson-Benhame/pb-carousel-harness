# CLI mínima (T03)

Este pacote interno implementa somente ajuda e versão. Não renderiza, inicializa,
instala plugin, migra memória nem importa marca. Comandos futuros são recusados.

    node bin/peterson-carousel.mjs --help
    node bin/peterson-carousel.mjs --version
    node bin/peterson-carousel.mjs --version --json

Aliases: `-h` e `-v`. Sem argumentos: ajuda. `--json` produz um único envelope
`protocolVersion`, `ok`, `data`, `error`, `nextAction`. Sucesso: código 0;
erro de uso: 2; erro interno: 1. Ajuda/versão não criam diretórios nem carregam
SQLite, sharp, fontes ou configuração legada. Runtime declarado: Node 24.21.0.
A validação Windows completa de instalação/npm/npx pertence à T32.

## Preparação local, sem distribuição

Na raiz do repositório autorizado:

    node scripts/build-release.mjs
    npm pack ./.release/package --dry-run --json --ignore-scripts --offline --cache .release/npm-cache
    npm pack ./.release/package --json --ignore-scripts --offline --cache .release/npm-cache --pack-destination .release
    node scripts/audit-tarball.mjs .release/pb-carousel-harness-0.1.0.tgz

O build recria apenas `.release/package/`. Use sempre esse staging; a raiz contém
documentação de projeto e recursos legados e não é o artefato npm. O staging
usa lista exata de arquivos, sem cópia recursiva, dependências ou scripts npm.
O manifesto original e seu lockfile preservam as dependências do renderer legado.
Os padrões neutros contêm somente idioma/dimensões técnicos e mapa de temas vazio;
nenhuma marca, perfil, logo, fonte ou preferência pessoal é aplicada automaticamente.

O audit lê os membros e bytes do `.tgz` real, verifica checksum TAR, nomes únicos,
lista exata, arquivos regulares, manifesto privado sem scripts/dependências e
padrões neutros. Rejeita links e extensões PAX/GNU: não é leitor TAR genérico.
Emite membros e SHA-256; o relatório não comprova revisão semântica de todo código,
licenciamento, renderer, instalação ou homologação Windows.

## Gate obrigatório

O manifesto fonte permanece `private: true`; o staging npm conserva `private: true` e `license: UNLICENSED`. Consulte [ATTRIBUTION.md](../ATTRIBUTION.md) para a atribuição e a declaração do responsável que autorizou a publicação desta cópia sanitizada do código. Essa declaração não é verificação independente de autorização upstream.

A autorização desta cópia no GitHub não concede licença nova, não libera publicação em registry nem distribuição do tarball, de dados privados ou de recursos excluídos do staging. O tarball continua interno; não há hooks de instalação ou registro automático.
