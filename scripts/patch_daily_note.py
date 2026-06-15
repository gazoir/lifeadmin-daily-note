from pathlib import Path
import re

path = Path(r"C:\Users\User\Projects\lifeadmin-daily-note\templates\TEM_Daily Note.md")
content = path.read_text(encoding="utf-8")
pattern = re.compile(
    r"```dataviewjs\nconst p = dv\.current\(\);.*?// ℹ️ℹ️ℹ️ℹ️ℹ️ℹ️ℹ️ℹ️ℹ️ END HABIT TRACKER\s*```",
    re.DOTALL,
)
replacement = """<% tp.file.include("[[Templates/Formatting/TEM_Dashboard_Bake_Weather]]") %>

<% tp.file.include("[[Templates/Formatting/TEM_Dashboard_Bake_Hevy]]") %>

<% tp.file.include("[[Templates/Formatting/TEM_Dashboard_Bake_Weight]]") %>

<% tp.file.include("[[Templates/Formatting/TEM_Dashboard_Bake_Habits]]") %>

<% tp.file.include("[[Templates/Formatting/TEM_Dashboard_Handlers]]") %>"""
new_content, count = pattern.subn(replacement, content, count=1)
if count != 1:
    raise SystemExit(f"replace failed count={count}")
new_content = re.sub(
    r'\n<%\*\n// WEATHER UPDATER TEST\nawait tp\.file\.include\("\[\[Templates/Formatting/TEM_Weather\.md\]\]"\) %>\s*$',
    "",
    new_content,
)
path.write_text(new_content, encoding="utf-8")
print(f"patched: {len(content)} -> {len(new_content)} chars")
