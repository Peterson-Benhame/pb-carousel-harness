# T07 — Armazenamento imutável de arquivos

> Cópia pública sanitizada: registros privados de conversa e execução foram omitidos. Estados e resultados técnicos abaixo descrevem a etapa original, não uma certificação da versão atual.

## Escopo e execução

Autorização individual em 16/10/2026, 14:29 UTC, a partir de HEAD `a746247`, branch `feat/module-01-brand-runtime`. Implementação limitada a T07: armazenamento de bytes, hash, publicação exclusiva e referência SQLite. Sem T08/T09, migração/schema, instalação, dependência nova, commit, push ou publicação.

Red observado: `node --test tests/integration/asset-store.test.mjs` falhou por `ERR_MODULE_NOT_FOUND` antes da implementação. Primeiro green 10/10, ampliado para 18/18 cenários reais. Execução focal final Linux x64, Node v24.19.0, better-sqlite3 13.0.3: 18 passaram, zero falhas/cancelados/ignorados, 629.064499 ms. Suíte completa anterior (16 testes T07): 92/92, 8055.349837 ms. Reexecução final da suíte e revisão independente serão registradas abaixo. Qualificação Windows final concluída e conferida pelo coordenador, conforme registro abaixo.

## Contrato interno

`createAssetStore({root,db})` retorna `importFile` e `resolve`. Importação recebe requestId, brandId, sourcePath, SHA-256 esperado, kind, width, height, originalName. O chamador informa identidade de conteúdo e descritor já validado; verificar formato PNG/dimensões é T09. Os testes usam bytes e descritores sintéticos, sem alegar validação de imagem.

- O caminho de origem é transporte efêmero, excluído do payload canônico e dos metadados. O nome original é somente componente validado, nunca usado para definir destino. O SQLite persiste nome e tamanho, além de hash/referência relativa/descritor.
- Preflight usa o runner T06: replay confirmado antes de abrir origem; conflito de payload/escopo recusado; manutenção/schema/marca verificados antes de staging.
- Cada tentativa usa arquivo exclusivo `staging/<UUID>/original.bin`; cópia em chunks, tratamento de short writes, sync e fechamento de ambos os handles antes do hash SHA-256 dos bytes armazenados.
- Promoção por hard link exclusivo para `blobs/<brandId>/<sha256>/<UUID>.bin`, seguida de unlink do staging. Nunca rename com substituição nem fallback de cópia parcial. Destino é novo, por importação; deduplicação física não é prometida. Staging e blobs precisam estar no mesmo volume com suporte a hard links.
- Hash verificado antes e depois da promoção. Referência e resultado idempotente entram juntos na transação curta T06. Trabalho de arquivos fica fora da transação SQLite. Concorrente vencedor pode deixar saída completa sem referência no perdedor, nunca duplicar resultado confirmado.
- `resolve(brandId,id)` verifica existência, hash e tamanho a cada uso/replay. Retorna caminho operacional apenas em memória, sem salvar origem. Marca distinta não encontra o asset.
- Retry somente para EBUSY/EAGAIN/EINTR/ETXTBSY, até duas repetições com 500/1500 ms. Escrita/fechamento reiniciam com staging novo; promoção/unlink têm tentativas locais. Hash, conteúdo, configuração, erro SQLite e commit ficam fora desse retry. Espera injetável testada sem atrasos artificiais; testes não alegam medição de 500/1500 ms reais.
- Hooks são pontos internos de injeção de falha. Hook de commit é síncrono, dentro da transação, não uma API pública.

## Evidências incluídas nos 18 testes

1. Preservação binária após remover origem, replay íntegro, isolamento por marca, metadados sem origem, conflito de payload, tamper e ausência explícitos.
2–6. Falhas em escrita, fechamento, hash, promoção e commit: nenhum asset/resultado confirmado; chamada explícita posterior funciona.
7–9. Retry transitório limitado, hash com código EBUSY sem retry, hash divergente/descritor inválido/traversal sem retry.
10. Manutenção adquirida durante trabalho de arquivo barra commit.
11. Cópia real de 256 KiB interrompida após primeiro chunk deixa arquivo genuinamente parcial somente em staging.
12. FK deferred inválida falha no COMMIT SQLite real; rollback da referência e resultado, arquivo órfão completo preservado.
13. Duas chamadas concorrentes idênticas retornam mesmo resultado com uma referência/operação.
14. Promoção contra destino existente recebe EEXIST e preserva ambos os bytes.
15. Promoção transitória sucede na terceira tentativa; EPERM não é repetido.
16. Processo real parado após promoção e INSERT é encerrado; SQLite recupera sem referência/resultado, importação posterior sucede.
17. Alteração entre hash de staging e promoção é recusada antes do commit.
18. Marca desconhecida/manutenção ativa não criam staging.

Fixtures fecham SQLite antes de apagar diretório. Processo filho é encerrado/aguardado antes das verificações e cleanup normal.

## Limites deliberados

Arquivos parciais ficam isolados em staging; arquivos promovidos sem commit ficam sem referência e nunca são retornados por consulta. Não há limpeza/reconciliação automática T23, reutilização de órfão, deduplicação nem manifesto de etapa. O alvo é crash do processo, sem promessa de recuperação de falha física/energia. Mesma limitação TOCTOU de T04: guard revalida cada acesso gerenciado, mas não constitui sandbox contra processo hostil concorrente; arquivo externo pode mudar entre verificação e uso. O hash esperado impede confirmação de conteúdo diferente observado durante importação. Hard links e encerramento abrupto foram qualificados no ambiente Windows descrito abaixo; não se promete suporte a volumes sem hard links. Não qualifica PNG, renderer, marca/revisão, backup nem distribuição npm/npx.

## Validação final local

- Suíte completa final: 94/94, zero falhas/cancelados/ignorados, 8137.519638 ms. Coordenador reconfirmou independentemente 94/94. Revisão independente aceita com 18/18 testes focais. `git diff --check` limpo.
- Bundle Windows: 15 arquivos fonte/teste/dependências, SHA-256 do JSON `b68e648511e2291a2a39310b30c6bacbbf5c30c17cd02b64cd6bab1ab9016802`. Qualificação Windows concluída conforme resultado abaixo.

## Qualificação Windows final — 16/10/2026
