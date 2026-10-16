# Fixtures sintéticas de logotipos — T09

Os testes geram PNGs em memória com sharp 0.34.5 e pequenos chunks PNG com CRC32 e zlib nativos. Nenhum logo real, fonte, fotografia ou asset de usuário está incluído.

Casos: RGBA/RGB/paleta, opacidade parcial e total, alpha zero, RGBA 16-bit com alpha 1/65535, dimensões de fronteira 4096/4097, limite exato 10 MiB, JPEG/SVG disfarçados, truncamento/CRC/compressão corrompidos, chunks APNG e metadados válidos/inválidos. Metadados comprimidos têm orçamento agregado de expansão de 10 MiB. O PNG válido com metadados de sharp exercita ICC/EXIF reais.

Os fixtures SQLite são bancos reais em diretórios temporários com espaço/acentos. Toda conexão é fechada antes de remover a árvore (inclusive em Windows). Arquivos originais e gerenciados são comparados byte a byte; nenhuma recompressão faz parte do produto.

Executar: `node --test tests/integration/logo-import.test.mjs`.
