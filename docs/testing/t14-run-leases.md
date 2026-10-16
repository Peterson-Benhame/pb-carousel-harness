# T14 — Leases por execução e fencing tokens

> Cópia pública sanitizada: registros privados de conversa e execução foram omitidos. Estados e resultados técnicos abaixo descrevem a etapa original, não uma certificação da versão atual.

Base: `3807171` (Q04). Implementação e validação Linux em 16/10/2026, Linux x64, Node v24.19.0, ABI 137. Testes usam bancos e arquivos sintéticos em diretórios temporários isolados. Nenhum workspace real foi alterado.

**Estado:** T14 concluída no escopo técnico, com revisão independente aceita, 723/723 testes completos no Linux e 43/43 focais no Windows. T15 é a próxima tarefa já autorizada.

## Escopo e interfaces internas

- `acquireRunLease(db, {brandId, runId, owner, stage}, {clock})` adquire posse exclusiva por execução em uma transação `IMMEDIATE`. TTL fixo de **60.000 ms**. Nova aquisição, inclusive pelo mesmo titular após expiração, recebe fencing token maior. Etapas `preview-render` e `render` disputam o mesmo lease do run.
- `renewRunLease` renova somente posse ainda válida; preserva titular e token. `releaseRunLease` limpa a posse válida. Uma identidade antiga não pode renovar ou liberar a de seu sucessor.
- `revokeRunLease` incrementa o token e limpa a posse, inclusive quando a identidade correspondente já expirou. `revokeRunLeaseInTransaction` fornece a mesma revogação dentro de uma transação do serviço chamador, para que futuras mudanças de run/tentativa sejam atômicas. Nenhuma dessas funções implementa o fluxo público de interrupção ou cancelamento de T17.
- `assertRunLeaseOwned` exige transação ativa e verifica escopo, titular, token, expiração persistida, contrato e manutenção. O campo `expiresAt` apresentado pelo chamador não substitui o valor do banco.
- `commitRunLease(db, lease, request, mutate, {clock})` usa a operação idempotente T06. O callback é interno, síncrono, curto e restrito ao banco; recebe `{db, emit}` e retorna `{status:'committed', result}`. Escopo da operação e do lease deve coincidir.
- `startRunLeaseHeartbeat` solicita renovação a cada **10.000 ms**. Seu `AbortSignal` informa a perda de posse; `stop()` encerra o timer. O timer não mantém o processo vivo e uma execução pausada não recupera um lease já vencido apenas porque o heartbeat voltou a rodar.
- `systemClock`, `clockTime` e `clockDeadline` oferecem relógio de época e agendamento injetáveis. Datas inválidas, overflow de prazo e esgotamento do contador de fencing falham sem conceder posse.

Essas funções são coordenação interna, sem nova operação CLI/plugin. Adquirir lease não cria tentativa, não muda o estágio, não concede aprovação e não libera render. Os serviços das tarefas posteriores continuam responsáveis por estabelecer seus próprios pré-requisitos, consentimentos e gate produtivo.

## Fronteira atômica de publicação

A aquisição do lease e a exclusão de manutenção usam a mesma transação de escrita, sem intervalo entre consultar a manutenção e adquirir a posse. A manutenção T06 também confere leases e tentativas ativas sob sua própria transação.

O commit protegido:

1. Verifica a posse dentro da transação T06, antes do callback.
2. Executa apenas a mutação curta do banco e prepara o resultado JSON idempotente.
3. Insere o resultado da operação e materializa a representação de retorno.
4. Executa o novo hook interno síncrono `beforeCommit`: confere novamente titular, token, expiração e manutenção, então limpa o lease na mesma transação.

Expiração ou revogação detectada nessa fronteira reverte estado, artefatos registrados, eventos e resultado idempotente. A liberação também reverte se qualquer parte do commit falhar. O hook foi colocado depois da persistência do resultado para evitar uma validação antecipada que deixasse de cobrir esse trabalho.

O replay exato de uma operação já confirmada lê o resultado histórico sem executar callback, guard ou nova publicação. Não libera, renova ou altera o lease de um sucessor e pode ser consultado durante manutenção. Uma nova operação sempre precisa de posse vigente; payload divergente mantém `IDEMPOTENCY_CONFLICT`.

Arquivos, composição, render, verificação de bytes e outros trabalhos demorados devem estar preparados fora da transação. O teste executa escrita de arquivo fora dela e uma escrita concorrente por outra conexão antes da publicação. O fencing protege o commit no banco; não torna SQLite e filesystem uma transação única.

Revisões `preview-review` e `quality-review`, aprovações e inputs não adquirem lease. O teste de passagem para revisão confirma que `waiting-approval` e a remoção da posse são publicados juntos. Isso permite esperar pela pessoa sem conservar lease de render.

## Evidência red → green

- Testes determinísticos começaram com falha explícita pela ausência da coordenação T14; a implementação posterior os tornou verdes.
- Os seis cenários multiprocesso também foram executados em red antes da API estar disponível.
- Uma regressão específica instalou um trigger SQLite temporário que avança apenas o relógio injetado após inserir `operations`. O guard antecipado deixou a operação confirmar e o teste falhou por ausência da exceção esperada. O hook final corrigiu o caso e o teste passou, com rollback integral.
- A revogação componível foi exercitada primeiro com a API ausente. Os testes posteriores confirmaram que revogação e mudança de estado confirmam ou revertem juntas.

Cobertura inclui:

- TTL exato, renovação, liberação, token crescente e takeover pelo mesmo titular.
- Expiração e revogação durante preview e render; executor antigo impedido de confirmar.
- Titular/token/escopo incorretos, `expiresAt` forjado, contrato incompatível e schema novo demais.
- Rejeição de callbacks assíncronos, resultados pendentes, thenables e transações aninhadas.
- Rollback se a posse for perdida dentro do callback ou durante a persistência do resultado.
- Exclusão real entre processos nas duas ordens: lease antes da manutenção e manutenção antes do lease.
- Disputa simultânea com barreira IPC: exatamente um titular ganha a posse do run.
- Processo antigo já armado para confirmar, retardado até expiração, takeover ou revogação; nenhum artefato, evento, resultado ou versão residual, seguido de retry válido pelo sucessor.
- Heartbeat de 10 segundos, parada explícita, abort por perda e impossibilidade de ressuscitar um lease vencido.

## Limites preservados

- Nenhuma instalação, migração de workspace real, publicação ou alteração de dependências, manifesto de recursos ou configuração do pacote nesta tarefa.
- T15, T20 e o fluxo de controle T17 não foram implementados. Não há novo caminho público para marcar execução como bem-sucedida, fabricar aprovação ou contornar o gate de qualidade.
- Recuperação de tentativas interrompidas/abandonadas permanece nas tarefas próprias; possuir um lease novo não reconcilia automaticamente a tentativa antiga.
- Callbacks e acesso direto aos módulos/banco são fronteiras internas confiáveis, não uma defesa contra um processo hostil com acesso irrestrito ao mesmo computador.
- Relógio é de época e compartilhado pelos processos da máquina. Heartbeat e sinal de abort são cooperativos; a segurança de publicação depende da conferência persistida, não da morte imediata do executor.
- Os cinco layouts permanecem `candidate`, sem homologação estética ou liberação produtiva. Validação técnica de concorrência não qualifica o visual.
