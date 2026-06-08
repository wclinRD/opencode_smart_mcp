---
name: swift-lsp
description: Swift language server (sourcekit-lsp) — code intelligence, diagnostics, and refactoring support. Use when working with Swift code, fixing type errors, or analyzing Swift projects.
compatibility: opencode
metadata:
  lsp-server: sourcekit-lsp
  language: Swift
---

# Swift LSP Support

Language server for Swift using `sourcekit-lsp` (bundled with Xcode).

## Location

```bash
# Bundled with Xcode
/usr/bin/sourcekit-lsp

# Verify
sourcekit-lsp --version
```

## CLI Usage

```bash
# Start LSP server in stdio mode (for editor integration)
sourcekit-lsp --stdio
```

## Swift Type Checking

Use the Swift compiler directly for type checking:

```bash
# Check a single file
swift typecheck main.swift

# Build project (includes type checking)
swift build

# Strict checking with warnings as errors
swift build -Xswiftc -suppress-warnings
```

## Package.swift Configuration

```swift
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MyProject",
    platforms: [.macOS(.v14)],
    dependencies: [],
    targets: [
        .executableTarget(
            name: "MyProject",
            swiftSettings: [
                .enableExperimentalFeature("StrictConcurrency"),
                .unsafeFlags(["-Xfrontend", "-warn-long-function-bodies=100"])
            ]
        )
    ]
)
```

## Capabilities

- Code completion
- Go to definition / find references
- Diagnostics and error checking
- Code refactoring (rename, local refactor)
- Hover documentation
- Document symbols
- Workspace symbols

## Integration Tips

- sourcekit-lsp requires an Xcode installation (not just Command Line Tools)
- For non-Xcode projects, ensure `Package.swift` is properly configured
- Swift compiler (`swift typecheck`, `swift build`) handles actual type checking
- Use `swift format` for code formatting
