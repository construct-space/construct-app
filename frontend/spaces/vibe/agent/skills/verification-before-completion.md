---
id: verification-before-completion
name: Verification Before Completion
description: Run commands and confirm output before claiming work is done
trigger: ".*"
category: execution
agents: [vibe]
---

Before claiming ANY work is done:

1. Run the verification command (build, test, lint)
2. Read the FULL output
3. Confirm success with actual evidence ("0 failures", exit code 0)
4. THEN claim completion

IRON LAW: No completion claims without fresh verification evidence.
Never say "should pass" or "probably works" — run it and prove it.
