from datetime import datetime, timezone
from pathlib import Path
import shutil

caddyfile = Path("/docker/n8n/Caddyfile")
snippet_file = Path("/docker/sala/deploy/Caddyfile.sala")
marker = "jonjo.live {"

content = caddyfile.read_text(encoding="utf-8")
if marker in content:
    print("ROUTE_ALREADY_PRESENT")
    raise SystemExit(0)

timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
backup = caddyfile.with_name(f"Caddyfile.before-jonjo-{timestamp}")
shutil.copy2(caddyfile, backup)

snippet = snippet_file.read_text(encoding="utf-8").rstrip()
updated = content.rstrip() + "\n\n" + snippet + "\n"
caddyfile.write_text(updated, encoding="utf-8")
print(f"ROUTE_ADDED backup={backup}")
