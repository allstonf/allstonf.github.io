// vitest.config.ts - test discovery boundaries.
//
// Excludes .worktrees/ because a git worktree created under the repo root
// contains a full copy of tests/, and vitest's default discovery walks
// into it. Running the suite from the main checkout with one worktree
// live reported 36 files / 324 tests instead of 18 / 162 - green, and
// exactly double.
//
// A doubled count that still PASSES is worse than a failure: it reads as
// a win, and "tests: 324" would go into a commit message or a brief as
// evidence of work that does not exist. This repo has already shipped
// one fabricated figure (a 6.4:1 contrast ratio) and spent an overnight
// loop making contrast a derived property so it could not happen again;
// this is the same defect class arriving through the test runner.
//
// NOTE: specifying `exclude` REPLACES vitest's default list rather than
// extending it, so node_modules and dist must be named explicitly here
// or they come back into discovery.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/.worktrees/**'],
  },
})
