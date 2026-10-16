# Fixture sintética do legado (T18)

- Cinco lâminas, papéis cover/context/content/summary/cta, código e acentos, 1080 × 1350; panorama 5400 × 1350.
- Marca `@marca_sintetica`, tema escuro sintético, logo desligado. Texto e conceito não contêm conteúdo de produção e não representam aprovação estética.
- `before-context/*.txt` preserva exatamente renderer, template e validator anteriores à T18, extraídos antes de editar produto (base `3314e11`). Os SHA-256 são fixados pelo teste.
- `baseline-capture.json` registra a execução pré-alteração em Linux, runtime/dependências/fontes e SHA-256 dos pixels RGBA decodificados. Não compara cabeçalhos PNG, bytes comprimidos ou ZIP.
- O teste reexecuta o algoritmo arquivado e o código atual no mesmo processo/runtime com os mesmos bytes de fonte. O helper só ajusta resolução de imports e a raiz explícita de fontes numa instalação sintética temporária; a lógica de render não é alterada. Assim Windows produz sua própria comparação local, sem presumir igualdade entre plataformas.
- Nenhuma fonte/binário está neste fixture. O teste lê a raiz já existente `assets/fonts`, ou a raiz autorizada explicitamente por `CAROUSEL_TEST_FONT_ROOT` (por exemplo, o cache existente do plugin Windows). Não busca no sistema, instala, baixa, transporta ou distribui fontes.
- O sandbox explícito não contém `shared/brand.json`, `shared/themes.json` nem `assets/fonts`. Renderizar nele prova que a adaptação não depende dos globals pessoais.

Comando: `node --test tests/regression/legacy-context.test.mjs`. Ausência/hash divergente de fonte é falha, nunca skip ou substituição.
