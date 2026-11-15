from pathlib import Path

path = Path(__file__).with_name("premium_security_system.py")
source = path.read_text(encoding="utf-8")
anchor = "from pathlib import Path\n"
if "from typing import Optional\n" not in source and "Optional[" in source:
    source = source.replace(anchor, anchor + "from typing import Optional\n", 1)
    path.write_text(source, encoding="utf-8")
