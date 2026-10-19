# CLI e ponte local

> **Limite da release de teste 0.1.3:** use o ciclo editorial somente até submeter Layout. Quando o próximo `editorial.next` retornar `role: production-manager`, pare sem executar a skill e sem chamar `editorial.submit`. Os comandos de Produção, preview, QA e package abaixo existem no núcleo histórico, mas não fazem parte do roteiro autorizado desta release.

Runs históricas com contrato v1 não recebem uma assignment de Layout até uma derivação explícita para o contrato atual. `RUN_DERIVATION_REQUIRED` é o bloqueio esperado: preserve a run e seus artefatos, não injete `qualifications` manualmente e não desative gates.

O CLI e o plugin usam o mesmo dispatcher, banco SQLite e runtime do pacote. Selecione a raiz explicitamente com `--data-dir`; não misture raízes entre comandos de uma mesma execução.

```powershell
peterson-carousel doctor --data-dir C:\dados\PetersonCarouselHarness --json
peterson-carousel init --data-dir C:\dados\PetersonCarouselHarness --json
peterson-carousel brand.get --data-dir C:\dados\PetersonCarouselHarness --request brand.json --json
```

Requisições de operação são objetos JSON lidos por `--request <arquivo.json>`. Os comandos disponíveis são:

- `doctor`, `init`
- `brand.apply`, `brand.get`, `brand.list`
- `run.create`, `run.get`, `run.list`, `run.runtime`
- `input.save`, `plan.save`
- `approval.request`, `approval.get`, `approval.decide`, `approval.verify`
- `preview`, `render.final`, `validate`, `review.apply`, `package`

`brand.apply`, `approval.decide` e `review.apply` exigem o terminal local e usam os gateways de confirmação existentes. Não use `--json` nesses atos humanos; flags de aprovação, actor ou receipts serializados não são aceitos.

## Ponte do plugin

```js
import { executePluginCommand } from '@pb/carousel-harness/plugin';

const result = await executePluginCommand({
  command: 'doctor',
  dataDir: 'C:\\dados\\PetersonCarouselHarness',
  packageRoot: 'C:\\caminho\\absoluto\\do\\carousel-harness',
});
```

`packageRoot` é obrigatório e absoluto na ponte. CLI e plugin devem receber o mesmo `dataDir`. A ponte não cria memória, runtime, aprovação ou qualificação paralelos: ela delega aos serviços do harness.

O renderer `editorial-composed@1` permanece `candidate`; os registros de layout permanecem com `release: null`. Nenhum comando libera template, qualificação ou produção sem as evidências e confirmações já exigidas pelos gates.
