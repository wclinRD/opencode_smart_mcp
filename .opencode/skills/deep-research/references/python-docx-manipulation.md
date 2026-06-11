# Python python-docx Manipulation Patterns

When Phase 6 of the `deep-science-writer` skill requires generating or editing `.docx` files, use these proven patterns to avoid XML corruption or missing dependencies.

## Dependencies
Check pre-installed versions at startup. Do NOT install packages dynamically.
```python
import importlib.metadata

required = {
    "python-docx": "1.1.2",
    "PyMuPDF": "1.24.0",
    "requests": "2.32.0",
}

for pkg, ver in required.items():
    try:
        installed = importlib.metadata.version(pkg)
        if installed != ver:
            print(f"[WARN] {pkg}=={installed} installed, {pkg}=={ver} recommended")
    except importlib.metadata.PackageNotFoundError:
        print(f"[ERROR] {pkg} is not installed. Run: pip install {pkg}=={ver}")
        raise
```

## Safely Deleting a Section
To replace hallucinated content or rewrite a specific section, you cannot just clear the text (which leaves empty paragraph blocks). You must remove the XML element:
```python
doc = docx.Document(path)
start_idx = -1

# 1. Find the target section
for i, p in enumerate(doc.paragraphs):
    if "Target Heading Text" in p.text:
        start_idx = i
        break

# 2. Collect elements first, then remove (safe pattern)
#    Never remove elements while iterating over the same list in-place.
if start_idx != -1:
    to_remove = [p._element for p in doc.paragraphs[start_idx:]]
    parent = to_remove[0].getparent()
    for elem in to_remove:
        parent.remove(elem)

# 3. Append new content
doc.add_heading('New Verified Section', level=2)
doc.add_paragraph('New content...')
```

## User Preferences
- Always save final outputs to the user's preferred directory (e.g., `D:\` drive on Windows) unless instructed otherwise.