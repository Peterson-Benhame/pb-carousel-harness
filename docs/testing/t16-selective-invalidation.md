# T16 — Invalidação seletiva

> Relatório técnico sanitizado. Os resultados de execução foram registrados na origem validada; a exportação pública verifica os mesmos bytes de código e testes, sem repetir aqui as suítes completas.

Implementação de invalidação seletiva após T15. Os testes usam dados sintéticos e workspaces temporários; nenhuma memória real foi alterada.

**Estado: T16 concluída no escopo técnico**, com suíte completa, revisão independente e qualificação Windows.

## Contrato implementado

- Política pura `invalidationPlan`: copy invalida todos os consentimentos/sucessores; conceito preserva copy; assets preservam copy/conceito. Plano e seleção exigem outra amostra. Pareceres, pixels finais e falha isolada de package têm os sufixos correspondentes à matriz. Rubrica, checker, política, ficha, fonte, renderer e marca congelados exigem derivação.
- `save` e `savePlan` calculam o escopo afetado a partir das entradas verificadas. Não aceitam categoria arbitrária de invalidação. O novo plano material referencia exatamente o plano anterior; não reescrevem a copy.
- Refs com bytes/metadata idênticos são reutilizadas. Conjunto de assets é comparado por identidade, independentemente da ordem recebida. Material totalmente idêntico é no-op verificado: conserva plano, estado, versões, decisões e saídas; apenas registra a identidade idempotente da solicitação.
- Toda origem é conferida mesmo no no-op. Os predecessores e episódios são verificados novamente depois de staging. CAS, captura do estado persistido e guarda final cobrem concorrência e alterações durante inserção do resultado da operação.
- Edição aceita draft/ready/waiting-approval/blocked sem lease, tentativa ou etapa running. Um lease expirado ainda exige reconciliação; completed/cancelled/interrupted continuam não editáveis.
- Etapas afetadas ficam invalidated; pedidos pendentes ficam cancelled. Artefatos, decisões, tentativas e requests já decididos permanecem no histórico. Um novo pedido T15 pode partir da etapa invalidated, conservando a fronteira de confirmação humana.
- Metadata de asset substituída exige consentimento para as refs atuais: uma decisão antiga com o mesmo hash de bytes não é selecionada como consentimento da nova ref. A comparação aceita a ordem histórica do conjunto sem alterar o recibo anterior.
- `get/resume` continuam consultas. Entradas incompletas podem conservar consentimentos editoriais sem anunciar produção disponível. Resultados dependentes de entradas/adulteração ficam ocultos; amostras e pareceres de etapas invalidadas não são apresentados como objetos atuais. Falha de package conserva render, validação e evidências anteriores íntegras, sem fabricar retry ou liberação.

## Limite Q05

`correctionEpisodes` lê e verifica artefatos imutáveis de episódio, escopo, refs e progressão das versões. Uma reserva consome rodada; nenhuma leitura, save ou resume devolve a rodada. Duas rodadas consumidas permanecem esgotadas, inclusive em novo processo. Histórico que esquece reserva, altera rounds anteriores ou declara terceira rodada é bloqueado.

T16 não emite nem reserva ajustes automáticos e não confirma pareceres. `bounded-correction` é recusado com `QUALITY_CORRECTION_UNAVAILABLE`; episódio já esgotado retorna `QUALITY_CORRECTION_LIMIT`. A reserva/emissão em duas fases, classificação autorizada do ajuste e liberação de produção pertencem a Q05. Nova declaração do cliente não reinicia episódio.

## Evidência de desenvolvimento

- RED inicial: 10 testes, 1 passou e 9 falharam, por módulo ausente/bloqueios anteriores a T16.
- A revisão acrescentou regressões para identidade de asset com mesmos bytes, conjunto reordenado, adulteração de plano durante no-op e resultados v1 com entrada adulterada. O último caso teve RED específico seguido de green.
- Integrações usam consentimentos reais do gateway de teste T15 nos contratos v1/v2. Fixtures de render/parecer importadas são explicitamente sintéticas: não equivalem a parecer humano, qualificação ou produção liberada.
- A primeira completa concorrente não foi aprovada: 766 testes passaram e o processo de `tests/visual/layout-qualification.test.mjs` terminou com `test failed` após quatro casos. Sem causa conclusiva no log; repetição serial completa exigida.
- Full serial final: **786/786**, zero falhas/skips, saída **0**, **248825,706823 ms** (248,826 s).
- Revisão independente aceita, com **8 regressões independentes**, sem achados bloqueadores restantes.
- Windows final registrado em 16/10/2026: **140/140**, **218,58 s**, saída **0**. Primeira rodada encontrou `EPERM` de hard links no sandbox; o mesmo comando fora da virtualização passou com produto/testes intactos.
- **119/119 hashes T16** e **117/117 hashes da origem T15** conferidos e preservados. Nenhuma instalação, alteração de dependências ou mudança de produto para a repetição Windows.

Comando focal portável:

```text
node --test tests/integration/invalidation.test.mjs tests/integration/run-inputs.test.mjs tests/integration/run-runtime.test.mjs tests/integration/approvals.test.mjs tests/integration/quality-state-evidence.test.mjs
```

Comando completo serial: `npm test -- --test-concurrency=1`. Não há skips autorizados como substituto de cobertura.

## Fora do escopo

Sem execução render/preview, revisão ou gate produtivo Q05, interrupção/cancelamento T17, reconciliação T23, CLI pública nova, migração real, instalação, publicação ou distribuição. O manifesto diagnóstico inclui o módulo novo e os hashes do resolvedor foram atualizados nos dois renderers; isso não qualifica layouts nem libera distribuição.
