---
id: systematic-debugging
name: Systematic Debugging
description: Root cause investigation before fixes — reproduce, trace, hypothesize, test
trigger: bug,fix,error,broken,fail,debug,crash,wrong
category: execution
agents: [vibe]
---

When something breaks, DO NOT guess at fixes. Follow this:

1. REPRODUCE: Run the failing command. Read the FULL error.
2. INVESTIGATE: Read the code. Check recent changes. Trace the data flow.
3. HYPOTHESIZE: Form ONE hypothesis about the root cause.
4. TEST: Make the minimal change to test your hypothesis.
5. VERIFY: Run again. Fixed? If not, new hypothesis.
6. After 3 failed fixes, question your assumptions about the architecture.

IRON LAW: No fixes without root cause investigation first.
