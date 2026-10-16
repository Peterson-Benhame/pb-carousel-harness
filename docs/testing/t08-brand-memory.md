# T08 — Memória de marca e confirmação local

> Cópia pública sanitizada: registros privados de conversa e execução foram omitidos. Estados e resultados técnicos abaixo descrevem a etapa original, não uma certificação da versão atual.

Execução Linux em 16/10/2026, Node v24.19.0, better-sqlite3 13.0.3 já instalado. HEAD de origem `ba33642`, branch `feat/module-01-brand-runtime`. Dados sintéticos em diretórios temporários; todas as conexões fechadas antes do cleanup.

## Contrato implementado

- `createBrandMemory(db)` oferece `propose(action, request)`, `commit(proposal, receipt)`, `get(brandId, revision?)`, `list({brandId}?)` e `forExecution(brandId, adjustments)`.
- Ações: `brand.create`, `brand.update`, `brand.importLegacy`. O chamador reserva um UUID v4 estável antes de propor cadastro/importação e reutiliza esse `brandId` nas repetições. A API pública de CLI fica para T28.
- Cada proposta inclui ação, requestId, brandId, revisão anterior e configuração completa. `brand.update` exige CAS; não aceita patch parcial. T06 fornece transação, manutenção e replay idempotente. T05 fornece FK e imutabilidade. Nenhuma migração alterada.
- Configuração: nome, perfil, idioma, público/voz opcionais explicitamente nulos, preferências, fontes, temas, política de logo desabilitado e dimensões/regras legadas. Sem campos livres para `actor` ou `approved`.
- Revisão retorna hash canônico, data, procedência e operação/requestId originários. Confirmação persistida na mesma transação como `confirmation_requests`, com ação e fingerprint da proposta inteira; o resultado em `operations` vincula operação/requestId à revisão criada.
- `list` retorna resumos, sem misturar preferências. `get` exige brandId e filtra revisão por essa marca. Leitura nova em conexão e processo Node separados foi testada.
- Importação só copia os valores fornecidos e confirmados; não lê/regrava arquivos da instalação. Mesmo brandId e mesma configuração importada retornam a revisão original, inclusive após atualização, sem novo cadastro ou overwrite. Conteúdo divergente ou marca de outra origem conflitam. Campos ausentes de público/voz são nulos e preferências são vazias; logo permanece desabilitado e sem variantes. `profileImage` precisa ser vazio: fotografia está fora desta fatia.
- Ajustes pontuais só aceitam público/voz/preferências. Retornam `base` com identidade persistida e `config/hash` efetivos separados, além dos ajustes; não gravam revisão.

## Confirmação e limites

O adaptador de terminal exibe todos os valores e fingerprint; somente a resposta exata `CONFIRMAR` em streams TTY emite recibo opaco, guardado em WeakMap. Redirecionamento e flags de confirmação/JSON são recusados. EOF, Ctrl-C e resposta distinta cancelam. Mudar proposta, ação, marca, revisão ou requestId invalida o recibo. Após commit ele é consumido; falha transacional permite retry. Replay já persistido não exige outro consentimento.

A emissão/validação está em módulo de domínio interno e a aplicação não importa interfaces. O emissor interno é uma capacidade de adaptadores confiáveis, não endpoint público/plugin nem parâmetro JSON. Streams e `ask` injetados existem para testes internos. Isso não autentica uma pessoa contra processo hostil com acesso ao código, ao banco e às permissões do sistema operacional.

A interação humana foi simulada em testes, inclusive streams reais de readline; não houve sessão humana de confirmação nem integração pública CLI/plugin. O terminal não identifica o proprietário do computador. A associação/validação de logos permanece em T09; nesta fatia referências e enablement são recusados. As três identidades de fonte da baseline são fixas; a resolução/autorização do manifesto pertence a T10. Não houve implementação de T09, T10, T28 ou migração de schema.

## Evidências reais

1. Red inicial: `node --test tests/integration/brand-memory.test.mjs tests/unit/human-confirmation.test.mjs`, módulos ausentes, dois arquivos falharam.
2. Primeiro green: 11/11 testes.
3. Expansão: manutenção/archive/schema, falha de confirmação após INSERT de revisão e rollback integral, processo Node separado. 14/14.
4. Regressão de cancelamento readline mostrou promessa pendente em EOF/Ctrl-C. AbortController ligado a close/SIGINT corrigiu o problema. Teste final resolve ambos sem recibo.
5. Revisão corrigiu dependência aplicação→CLI e identidade enganosa de override; teste exige hashes separados. Regressão red de recibo reutilizado em segundo workspace falhou com “Missing expected exception”; consumo após commit produziu green, mantendo retry após rollback.
6. Focal final: 16/16, zero falhas/cancelados/ignorados, 307.017546 ms.
7. `npm test`: 110/110, zero falhas/cancelados/ignorados, 8061.473558 ms. `git diff --check` limpo.

Revisão independente final aceita: 16/16 focais e 110/110 completos reconfirmados, diff limpo; caminho positivo readline adicional aprovado com streams simulados. Qualificação focal Windows concluída conforme evidência abaixo. Nenhuma instalação, commit, push, publicação ou mudança global foi feita nesta tarefa.

## Qualificação Windows final

Os 16 hashes Windows coincidiram com o bundle JSON SHA-256 `1b36b384fdcfa5eae415fcbf37ab8b5264fef04ea2a370d9cd1c1df84bd201c8`. JSON e os 16 arquivos locais reconferidos em 16/10/2026, 14:53 UTC, sem divergência. Coordenador reconfirmou 110/110 locais e revisão independente aceita.

T08 concluída. A qualificação exercitou SQLite e streams simulados; não representa consentimento de pessoa real nem integração completa da CLI/plugin. As limitações de T09/T10/T28 acima continuam válidas. T09 aguarda autorização específica. Nenhum commit foi realizado por este executor; eventual commit local do coordenador constará do histórico Git.
