from pathlib import Path
import sys
try:
    from pypdf import PdfReader
except Exception:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'pypdf'])
    from pypdf import PdfReader
p = Path('DevSprint 2026 Problem Statement.pdf')
if not p.exists():
    print('MISSING')
    sys.exit(2)
reader = PdfReader(str(p))
text = []
for i, page in enumerate(reader.pages, start=1):
    t = page.extract_text() or ''
    text.append(f"--- PAGE {i} ---\n" + t)
out = Path('problem_statement.txt')
out.write_text('\n\n'.join(text), encoding='utf-8')
print('OK')
