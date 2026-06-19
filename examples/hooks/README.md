# Smart MCP Hook Examples

These example hook scripts demonstrate how to use the `smart_hook` tool
to automate workflows. Each script can be registered as a `bash`-type hook
that runs before or after specific tool calls.

## Usage

Register a hook with `smart_hook`:

```
smart_hook({
  command: "add",
  event: "postTool",        // run AFTER the matched tool
  match: { tool: "smart_fast_apply" },
  action: {
    type: "bash",
    command: "bash examples/hooks/pre-format.sh {file}"
  },
  description: "Auto-format edited files with Prettier"
})
```

Template variables available in bash hooks:
- `{file}`  — the `file` argument passed to the matched tool
- `{files}` — the `files` array argument (space-separated)
- `{tool}`  — the matched tool name
