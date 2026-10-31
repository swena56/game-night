"""Forgiving text comparison for typed answers (shared by the party word games)."""
import re


def norm(text):
    """Lowercase letters and digits only, without a leading article."""
    t = re.sub(r"[^a-z0-9 ]", "", str(text).lower().replace("-", " ")).strip()
    t = re.sub(r"^(an?|the|some|his|her|their) ", "", t)
    return re.sub(r"\s+", "", t)


def same(a, b):
    """Equal after norm(), allowing a plural and (for 5+ letters) one typo."""
    a, b = norm(a), norm(b)
    if not a or not b:
        return False
    if a == b or a.rstrip("s") == b.rstrip("s") or a.removesuffix("es") == b.removesuffix("es"):
        return True
    if len(b) < 5 or abs(len(a) - len(b)) > 1:
        return False
    i = j = edits = 0
    while i < len(a) and j < len(b):
        if a[i] == b[j]:
            i += 1; j += 1
            continue
        edits += 1
        if edits > 1:
            return False
        if len(a) > len(b):
            i += 1
        elif len(b) > len(a):
            j += 1
        else:
            i += 1; j += 1
    return edits + (len(a) - i) + (len(b) - j) <= 1


def words(text):
    """The normalised words of a phrase, singular-ish, for 'does this mention X' checks."""
    return [w.rstrip("s") for w in re.findall(r"[a-z0-9]+", str(text).lower()) if len(w) > 1]
