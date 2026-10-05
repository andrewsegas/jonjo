from datetime import datetime, timezone
from pathlib import Path
import shutil

# Remove o bloco antigo de rota /sala que a versão pzaas.online inseriu dentro
# do bloco de site do n8n. Faz backup antes de qualquer alteração.

caddyfile = Path("/docker/n8n/Caddyfile")
marker = "# Sala de voz."

content = caddyfile.read_text(encoding="utf-8")
if marker not in content:
    print("OLD_ROUTE_NOT_PRESENT")
    raise SystemExit(0)

lines = content.splitlines()
start = next(i for i, line in enumerate(lines) if marker in line)

# Localiza o bloco handle_path /sala/* e sua chave de fechamento.
handle_index = next(
    i for i in range(start, len(lines)) if "handle_path /sala/*" in lines[i]
)
end = next(
    i for i in range(handle_index, len(lines)) if lines[i].strip() == "}"
)

# Absorve uma linha em branco imediatamente antes e depois, para não deixar
# espaçamento duplo no arquivo.
begin = start
if begin > 0 and lines[begin - 1].strip() == "":
    begin -= 1
finish = end
if finish + 1 < len(lines) and lines[finish + 1].strip() == "":
    finish += 1

timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
backup = caddyfile.with_name(f"Caddyfile.before-remove-sala-{timestamp}")
shutil.copy2(caddyfile, backup)

updated = "\n".join(lines[:begin] + lines[finish + 1:])
if not updated.endswith("\n"):
    updated += "\n"
caddyfile.write_text(updated, encoding="utf-8")
print(f"OLD_ROUTE_REMOVED backup={backup}")
