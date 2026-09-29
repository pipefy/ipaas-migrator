---
name: migrador-workato-sem-dependencia
description: Reescreve steps CODE que importam pacote npm para JavaScript sem dependência (planilha xlsx vira OOXML puro). Roda no kit cliente e no migrador interno, quando o sandbox não instala npm. Use when the user invokes /migrador-workato-sem-dependencia, or says "sem dependência", "sem dependencia", "tirar npm", "ALLOW_NPM", "sandbox ST", "reescrever sem pacote".
disable-model-invocation: true
---

# Sem dependência

O motor e a skill traduzir-code declaram pacote npm no `packageJson` do step CODE (`xlsx` para planilha). Esta skill reescreve esses steps para JavaScript que só usa o que o Node já tem, e zera o `packageJson`.

Serve no migrador interno e no kit cliente. O arquivo é o `flow.json` (ou o `*.flow.json` que o cliente gerou).

Não mexe em piece, input, notes nem no encadeamento. Não chama Pipefy. Não edita `mappings/`, `kb/` nem `engine/`.

## Quando

- O teste ou o import disse que o code step não instalou o pacote (`ALLOW_NPM_PACKAGES_IN_CODE_STEP` desligada, sandbox ST).
- A verificação marcou `python pacote`.

Não rodar no transpile por padrão. Com a flag ligada, o step com `xlsx` fica.

## Workflow

```
- [ ] 1. Reescrever o que o script reconhece
- [ ] 2. Reescrever o que sobrou, com os blocos desta skill
- [ ] 3. Aplicar o patch
- [ ] 4. Conferir que não sobrou pacote
```

### 1. Template do motor

Na raiz do kit ou do helper:

```bash
npx tsx scripts/sem-dependencia.mjs \
  --flow-json <flow.json>
```

`ok: true` e `manual` vazio: acabou. Dizer `deps: nenhum pacote`.

`rewritten` lista os steps que saíram do template `import * as XLSX` (`inputs.csv` → `wd_data`). O `packageJson` desses steps fica `{}`.

### 2. O que o script não reconhece

Cada item de `manual` traz o step e os pacotes. Abrir o `sourceCode.code` e o Python/Ruby original no comentário ou no `recipe.json`.

Planilha (`xlsx`, `exceljs`, pandas `read_excel` / `to_excel`, openpyxl): copiar o bloco de [reference.md](reference.md). Uma aba, sem senha, sem gráfico, sem `.xls` antigo.

- CSV → xlsx: o gerador OOXML (zip store, `Uint8Array`).
- xlsx → CSV: o leitor com inflate no próprio step (o sandbox não tem `zlib` nem `Buffer`).

Manter os nomes de chave que o step já devolve (`excel_content`, `csv`, `wd_data`, …) e o caminho de entrada (`inputs.csv` ou `inputs.code_input.data`).

Outro pacote (lodash, moment, sdk): reescrever com o que o Node já tem, se der para fazer o mesmo. Se o original depende de algo que não cabe em Node puro, deixar o step e listar como não reescrito. Não chutar.

Não apagar o comentário com o código original.

### 3. Aplicar

```json
{
  "step_6": "export const code = async (inputs) => {\n  ...\n};"
}
```

```bash
npx tsx scripts/sem-dependencia.mjs \
  --flow-json <flow.json> \
  --patch <patch.json>
```

O script grava o `code` e põe `packageJson` em `{}`. Exit 0 = aplicado. Exit 3 = algum recusado.

| Recusa | Motivo |
| --- | --- |
| `ainda_tem_pacote` | o texto ainda importa lib que não é builtin |
| `codigo_vazio` | patch em branco |
| `sem_export_const_code` | falta `export const code =` |
| `unknown` | nome de step que não existe |

`fs` e `fetch` não são pacote npm. O sandbox sem libs também não define `Buffer`, `atob` nem `TextDecoder`, e o ST não tem `node:zlib`. Não chamar isso no step e não colocar no `packageJson`.

### 4. Conferir

Rodar o passo 1 de novo. `manual` vazio e `before` só com o que você decidiu deixar.

## Relato

Uma linha:

```
deps: step_1 reescrito (xlsx para csv, sem pacote); step_6 reescrito (csv para xlsx, sem pacote)
```

Nada a fazer: `deps: nenhum pacote`.

## Não fazer

- Tirar pacote de step que o ambiente instala, se ninguém pediu
- Trocar piece, input, notes ou `nextAction`
- Inventar campo que o step não devolvia
- Deixar `require` / `import` de `xlsx` ou `exceljs` no texto reescrito
- Imprimir senha / `sk-`
