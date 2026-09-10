"""The six-digit code out of one .eml on stdin.

Both encodings and both wordings, because this instance sends two kinds of
mail and they do not agree with each other:

- a **sign-in** mail says *"Or sign in by hand with this code: 005722"*
- an **agent** mail says *"Your code is 427903"*

and the live server writes **base64** bodies while a local dev mailbox writes
**quoted-printable**. Every combination has cost somebody a round of
head-scratching; `get-token.sh` is the only thing that should be calling this.

Kept as a string throughout. A code may begin with a zero — `005722` is a real
one from this instance — and `int()` eats it, which produces a five-digit code
that is refused with no explanation of why.
"""

import base64
import quopri
import re
import sys

raw = sys.stdin.buffer.read()
texts = [raw.decode("utf-8", "replace")]

# Every decoding is tried rather than the header being read: a multipart mail
# may use a different transfer encoding per part, and the cost of trying is
# nothing.
try:
    texts.append(quopri.decodestring(raw).decode("utf-8", "replace"))
except Exception:
    pass
for blob in re.findall(rb"[A-Za-z0-9+/=\n]{60,}", raw):
    try:
        texts.append(base64.b64decode(blob.replace(b"\n", b"")).decode("utf-8", "replace"))
    except Exception:
        pass

for text in texts:
    # Any six-digit run in a decoded body is the code. Nothing else in either
    # mail is six digits — the sign-in link's token is alphanumeric, and the
    # timestamp is punctuated — so this needs no phrase to match, which is what
    # keeps it working when somebody rewords the mail.
    found = re.search(r"\b(\d{6})\b", text)
    if found:
        print(found.group(1))
        raise SystemExit(0)

print("no six-digit code in that mail", file=sys.stderr)
raise SystemExit(1)
