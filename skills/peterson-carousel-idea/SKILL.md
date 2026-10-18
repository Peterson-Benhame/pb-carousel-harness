---
name: peterson-carousel-idea
description: Gere ideias e faça brainstorm de carrosséis para @petersonbenhame sobre startups, empreendedorismo, IA, programação ou arquitetura de software; use quando o usuário quer escolher um tema ou ângulo, sem escrever o carrossel completo e sem renderizar imagens.
---

# Ideias para carrossel

Ajude Peterson a escolher um assunto forte antes da escrita. Esta skill não escreve o roteiro completo e não renderiza imagens.

## Harness local obrigatório

Use `../../scripts/harness-local.cmd bridge <request.json>` como entrada não interativa para memória e runtime. O JSON privado deve conter somente `command`, `dataDir` absoluto e `input`; execute `doctor` antes de consultar ou alterar estado. Não forneça `packageRoot`, `terminal`, `ask`, streams, flags de aprovação ou receipts. Quando `nextAction` exigir aprovação, pare e entregue o pedido ao usuário por `../../scripts/harness-local.cmd cli <comando> --data-dir <diretório> --request <json-privado>` em um terminal TTY real; depois retome pelo bridge. Nunca serialize uma resposta humana nem simule TTY. Preview, render, validate, review e package pertencem exclusivamente ao harness e ficam fora desta skill. Se a memória ainda não estiver inicializada, pare e solicite a inicialização explícita. Mantenha entradas e lâminas pessoais apenas no diretório privado da execução.

## Contexto obrigatório

Leia `../../shared/brand.json` e `../../shared/themes.json`. Posicione Peterson na interseção entre tecnologia, IA, arquitetura de software e criação de negócios digitais. O público principal reúne desenvolvedores, profissionais de tecnologia e empreendedores.

Quando relevância, tendência, produto, dado ou acontecimento recente fizer parte do ângulo, pesquise antes. Priorize fontes primárias e confiáveis. Diferencie explicitamente fato, inferência e opinião. Não transforme hipótese em notícia e evite promessas sensacionalistas.

## Produção

Gere de 5 a 10 ideias diferentes entre si. Dê preferência a problemas concretos, decisões difíceis, erros recorrentes, frameworks aplicáveis e experiências que Peterson realmente possa sustentar. Não invente vivências pessoais.

Para cada ideia, apresente:

- `Hook`: frase de capa curta e específica.
- `Promessa`: aprendizado ou transformação entregue.
- `Público`: leitor mais beneficiado.
- `Tema visual`: `tech-executive`, `builder-editorial` ou `future-human`.
- `Por que agora`: relevância atual; marque como fato, inferência ou opinião.
- `Fontes necessárias`: pesquisas ou provas exigidas antes da copy.
- `Lâminas sugeridas`: entre 12 e 16, proporcional à densidade.
- `CTA`: objetivo principal entre salvar, compartilhar, comentar, relatar experiência ou acessar a mentoria na bio.

Use por padrão uma voz direta, didática, prática e estratégica. Adote o modo provocativo ou história pessoal apenas quando solicitado. Termine perguntando qual ideia Peterson quer transformar em carrossel e aceite também uma ideia diferente proposta por ele.
