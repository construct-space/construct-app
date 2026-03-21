---
id: plan-feature
name: Plan Feature
description: Create a detailed implementation plan for a new feature
trigger: plan|design|architect|feature plan|implementation plan
category: architecture
tools: [read_file, list_dir, glob, grep]
---

When asked to plan a feature, follow this structured approach:

1. **Understand Context**: Read the project structure and key config files to understand the codebase
2. **Identify Touch Points**: List all files and modules that will be affected
3. **Design the Solution**:
   - Data flow and state changes
   - New files/components needed
   - Modifications to existing files
   - API changes if applicable
4. **Implementation Steps**: Ordered list of concrete steps a developer should follow
5. **Testing Strategy**: What tests should be written and what to validate
6. **Risk Assessment**: What could go wrong and how to mitigate

Output the plan in a structured format with clear sections and code snippets where helpful.
