"""Build an offline reviewer artifact from the exact prototype source. No network."""
from pathlib import Path
import base64
import hashlib
import re
import sys
ROOT = Path(__file__).resolve().parents[1]
def build(target: Path) -> None:
    html = (ROOT / 'prototype/index.html').read_text()
    css = (ROOT / 'prototype/style.css').read_text()
    model = (ROOT / 'prototype/model.mjs').read_text().replace('export ', '')
    app = (ROOT / 'prototype/app.mjs').read_text()
    app = re.sub(r'^import .*?;\n', '', app, count=1)
    js = '(function(){\n' + model + '\n' + app + '\n})();'
    token = base64.b64encode(hashlib.sha256(js.encode()).digest()).decode()
    html = html.replace("script-src 'self'", f"script-src 'sha256-{token}'")
    html = html.replace("style-src 'self'", "style-src 'unsafe-inline'")
    html = html.replace('<link rel="stylesheet" href="./style.css">', '<style>' + css + '</style>')
    html = html.replace('<script type="module" src="./app.mjs"></script>', '<script>' + js + '</script>')
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(html)
    print(target, hashlib.sha256(target.read_bytes()).hexdigest())
if __name__ == '__main__':
    build(Path(sys.argv[1]) if len(sys.argv)>1 else ROOT / 'FORM_FIRST_SESSION.html')
