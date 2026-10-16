# T03 — Empacotamento mínimo seguro

> Cópia pública sanitizada: registros privados de conversa e execução foram omitidos. Estados e resultados técnicos abaixo descrevem a etapa original, não uma certificação da versão atual.

## Implementação

- Builder: lista exata de dez arquivos copiados mais manifesto gerado, staging
  `.release/package/`, limpeza de resíduos, rejeição de symlinks em caminhos
  de origem/staging, entrypoint executável. Somente Node builtins.
- Auditor: lê gzip/TAR real. Confere checksum, limites, terminação, padding vazio,
  lista exata, duplicatas, tipo regular, manifesto privado sem scripts/dependências,
  padrões neutros e aviso de restrição. Emite membros e SHA-256; não extrai arquivos.
- Defaults: somente idioma/dimensões técnicos; temas vazios. Sem perfil, fontes,
  marca, fotos, logo ou preferências pessoais.
- Manifesto do staging CLI-only, privado e UNLICENSED, sem dependências nativas.
  Manifesto raiz mantém dependências legadas e ganha `files`, `build:release` e
  `audit:tarball`. Lockfile, fontes, configuração e scripts legados intactos.
- Staging/tarball/cache ignorados pelo Git. A raiz não é artefato distribuível:
  o npm pode incluir automaticamente seu README legado apesar de `files`.

## TDD e comandos efetivamente executados

1. `node --test tests/distribution/minimal-package.test.mjs`: red observado,
   3 testes falharam pela ausência do builder (MODULE_NOT_FOUND nas asserções
   de sucesso); depois da implementação, 3 passaram.
2. Adicionados testes de symlinks/corrupção/padding: 4 passaram e 1 falhou,
   pois padding não-zero ainda era aceito. Corrigido; mesmo comando: 5 passaram,
   0 falharam, 0 ignorados.
3. `npm test`: 38 passaram, 0 falharam, 0 ignorados. Repetido após fortalecer
   isolamento: toda a origem temporária é removida antes de ajuda/versão sobre
   bytes extraídos do tarball auditado. Coordenador confirmou independentemente
   38/38 e `git diff --check` limpo.
4. Revisão identificou risco Windows na chamada direta `spawnSync(npm.cmd)`.
   Teste alterado para localizar npm-cli.js e invocar `process.execPath` com
   argumentos separados, sem shell. `node --test tests/distribution/minimal-package.test.mjs`
   e `npm test` repetidos: 5/5 e 38/38. Windows não foi executado nesta tarefa.
5. `node scripts/build-release.mjs`: saída 0.
6. Primeiro pack manual sem cache explícito falhou: ENOENT ao criar
   `/home/agent/.npm`. Não produziu tarball válido; auditor subsequente também
   acusou ENOENT. Repetido com cache local, sem instalar/atualizar npm.
7. Comandos finais, todos com saída 0:

       npm pack ./.release/package --dry-run --json --ignore-scripts --offline --cache .release/npm-cache
       npm pack ./.release/package --json --ignore-scripts --offline --cache .release/npm-cache --pack-destination .release
       node scripts/audit-tarball.mjs .release/pb-carousel-harness-0.1.0.tgz
       git diff --check
       git diff --exit-code HEAD -- package-lock.json shared/brand.json shared/themes.json assets scripts/render-carousel.mjs scripts/validate-carousel.mjs scripts/package-carousel.mjs
       git check-ignore .release/package/package.json .release/pb-carousel-harness-0.1.0.tgz

Avisos npm: configuração de ambiente `http-proxy` desconhecida e nova versão
disponível. Nenhuma atualização foi realizada.

## Artefato interno efetivo

Relatórios não versionados: `.release/dry-run.json`, `.release/pack.json`,
`.release/audit.json`. Tarball exclusivamente interno, não anexado/distribuído.
SHA-256: `60be77eb92ba426a4be57b138682c7541ac3871b487e05edb473b5abcf86b6c3`.

Onze membros sob `package/`:

- `ATTRIBUTION.md`
- `bin/peterson-carousel.mjs`
- `docs/cli.md`
- `package.json`
- `shared/defaults/brand.json`
- `shared/defaults/themes.json`
- `src/domain/errors.mjs`
- `src/domain/protocol.mjs`
- `src/interfaces/cli/main.mjs`
- `src/interfaces/cli/output.mjs`
- `src/interfaces/cli/parse-args.mjs`

Cobertura: staging exato/limpeza, legado preservado, manifesto sem hooks/dependências,
npm dry-run/pack reais, membros reais auditados, CLI isolada; rejeição de arquivos
privados/fontes/node_modules, caminhos inesperados, links, duplicatas, membro
obrigatório ausente, manifesto publicável/postinstall/dependências/default pessoal,
symlinks, checksum corrompido, truncamento e padding não-zero.

## Limites

Não homologa Windows/Node 24.21.0/npm 11.19.0. Sem instalação global, npx, renderer,
SQLite, plugin ou mutação de memória. T01 não reexecutada. Auditor é um leitor
estrito de ustar regular; rejeita PAX/GNU e não substitui revisão semântica do código
ou licenciamento. A verificação de symlinks protege esta operação de staging local,
sem prometer isolamento contra processo hostil concorrente nem implementar T04.

T03 concluída: revisão independente aceita após correção do launcher npm.
Coordenador reconfirmou 38/38 testes e diff limpo após a correção.
Commit local registrado no histórico Git; sem push, publicação ou entrega de tarball. Distribuição bloqueada por
ATTRIBUTION.md. T04 não iniciada e exige autorização própria.
