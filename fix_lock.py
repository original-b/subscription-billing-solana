import re

with open("Cargo.lock", "r") as f:
    content = f.read()

content = re.sub(r'version = 4', 'version = 3', content)

with open("Cargo.lock", "w") as f:
    f.write(content)
