---
name: go-testing
description: "Handles all Golang testing tasks including running tests, writing new tests, and fixing test failures. Uses standard Go testing practices with mandatory testify library (github.com/stretchr/testify) for enhanced assertions using require for critical checks and assert for non-critical ones."
---

# Go Testing Skill

Provides guidance and automation for Golang testing tasks.

## Testing Philosophy

- Use `require` (from github.com/stretchr/testify/require) for assertions that should stop test execution on failure
- Use `assert` (from github.com/stretchr/testify/assert) for non-critical assertions where test should continue
- Choose internal vs external package testing based on what needs to be tested
- Test internal functions by placing test files in the same package (no `_test` suffix)
- Avoid creating externally facing functions solely for testing purposes
- Use table-driven tests for repetitive cases
- Test behavior, not implementation details
- Separate IO from business logic for easier testing
- Check errors explicitly in tests

## Special Rules

- Avoid to run tests for all packages(`go test ./...`) if not necessary, use `go test ./<package>` is preferred
- Always consider concurrency when writing tests if some components are likely to be concurrent
- Always check race conditions for concurrent code(with `-race` flag)
- For related edge case testing, group cases in a single test function using a table-driven approach and iterate with `t.Run` to keep code concise and avoid multiple near-duplicate test functions.

## Test File Organization Standards

- Unit tests for each Go file must be placed in the corresponding `<file>_test.go`
- Benchmark tests must be placed in `<file>_bench_test.go`
- Only non-unit tests (such as integration tests, scenario tests) should be placed in the main module's test files

## When to Use This Skill

- Running unit tests with `go test`
- Writing new test files and test cases
- Debugging and fixing failing tests
- Implementing test fixtures and mocks
- Improving test coverage
