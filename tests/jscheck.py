"""Rough structural check for JS files: balanced brackets, strings, template literals, comments."""
import sys

def check(src):
    stack, i, n, line = [], 0, len(src), 1
    pairs = {")": "(", "]": "[", "}": "{"}
    prev_sig = ""  # last significant char, to guess regex literals
    while i < n:
        ch = src[i]
        if ch == "\n":
            line += 1
        if src.startswith("//", i):
            j = src.find("\n", i); i = n if j < 0 else j; continue
        if src.startswith("/*", i):
            j = src.find("*/", i + 2)
            if j < 0: return f"unterminated comment at line {line}"
            line += src.count("\n", i, j); i = j + 2; continue
        if ch in "'\"":
            j = i + 1
            while j < n and src[j] != ch:
                if src[j] == "\\": j += 1
                if src[j] == "\n": return f"newline in string at line {line}"
                j += 1
            i = j + 1; prev_sig = "a"; continue
        if ch == "`":
            stack.append(("`", line)); i += 1
            # scan template body
            while i < n:
                c = src[i]
                if c == "\\": i += 2; continue
                if c == "\n": line += 1
                if c == "`": stack.pop(); i += 1; break
                if src.startswith("${", i): stack.append(("${", line)); i += 2; break
                i += 1
            else:
                return f"unterminated template from line {stack[-1][1]}"
            prev_sig = "a"; continue
        if ch == "/" and prev_sig in "(,=:[!&|?{};+-*%<>~^" :
            j = i + 1; in_class = False
            while j < n and (src[j] != "/" or in_class):
                if src[j] == "\\": j += 1
                elif src[j] == "[": in_class = True
                elif src[j] == "]": in_class = False
                elif src[j] == "\n": return f"newline in regex at line {line}"
                j += 1
            i = j + 1; prev_sig = "a"; continue
        if ch in "([{":
            stack.append((ch, line))
        elif ch in ")]":
            if not stack or stack[-1][0] != pairs[ch]: return f"unexpected {ch} at line {line} (open: {stack[-1] if stack else None})"
            stack.pop()
        elif ch == "}":
            if stack and stack[-1][0] == "${":
                stack.pop(); i += 1
                # resume template body
                while i < n:
                    c = src[i]
                    if c == "\\": i += 2; continue
                    if c == "\n": line += 1
                    if c == "`": stack.pop(); i += 1; break
                    if src.startswith("${", i): stack.append(("${", line)); i += 2; break
                    i += 1
                prev_sig = "a"; continue
            if not stack or stack[-1][0] != "{": return f"unexpected }} at line {line} (open: {stack[-1] if stack else None})"
            stack.pop()
        if not ch.isspace():
            prev_sig = ch if not (ch.isalnum() or ch in "_$") else "a"
        i += 1
    return f"unclosed {stack[-1]}" if stack else "ok"

for path in sys.argv[1:]:
    print(f"{check(open(path, encoding='utf-8').read()):40} {path.split('/static/')[-1]}")
