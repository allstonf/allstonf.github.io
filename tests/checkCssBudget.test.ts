// tests/checkCssBudget.test.ts - unit tests for the CSS budget gate.
// Mirrors tests/checkJsBudget.test.ts in shape: every exported
// function is exercised on hand-built input, and the whole report is
// computed once against the REAL dist/ build so the gate is proven
// against actual output rather than only against fixtures.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertNotSilentZero,
  computeCssBudgetReport,
  extractClassAndIdSelectors,
  extractImportSpecifiers,
  extractInlineStyles,
  extractReferencedTokens,
  extractStylesheetRefs,
  SilentZeroBudgetError,
} from '../scripts/check-css-budget.mjs'

describe('extractStylesheetRefs', () => {
  it('finds a plain stylesheet link', () => {
    expect(extractStylesheetRefs('<link rel="stylesheet" href="/a.css">')).toEqual(['/a.css'])
  })

  it('finds a link whose rel carries extra tokens', () => {
    expect(extractStylesheetRefs('<link rel="preload stylesheet" href="/b.css">')).toEqual(['/b.css'])
  })

  it('ignores a non-stylesheet link', () => {
    expect(extractStylesheetRefs('<link rel="icon" href="/f.ico">')).toEqual([])
  })

  it('deduplicates a reference that appears twice', () => {
    const html = '<link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="/a.css">'
    expect(extractStylesheetRefs(html)).toEqual(['/a.css'])
  })
})

describe('extractInlineStyles', () => {
  it('returns each style body in document order', () => {
    expect(extractInlineStyles('<style>a{}</style><style>b{}</style>')).toEqual(['a{}', 'b{}'])
  })

  it('does not deduplicate identical bodies - both still download', () => {
    expect(extractInlineStyles('<style>a{}</style><style>a{}</style>')).toEqual(['a{}', 'a{}'])
  })

  it('returns an empty array when there is no inline style', () => {
    expect(extractInlineStyles('<p>hi</p>')).toEqual([])
  })
})

describe('extractImportSpecifiers', () => {
  it('finds a quoted @import', () => {
    expect(extractImportSpecifiers('@import "./base.css";')).toEqual(['./base.css'])
  })

  it('finds an @import url() form', () => {
    expect(extractImportSpecifiers('@import url("/tokens.css");')).toEqual(['/tokens.css'])
  })

  it('ignores a url() that is not an @import - a background image is not a stylesheet', () => {
    expect(extractImportSpecifiers('.a{background:url("/x.png")}')).toEqual([])
  })
})

describe('extractClassAndIdSelectors', () => {
  it('finds class and id selectors', () => {
    expect(extractClassAndIdSelectors('.card{}#main{}')).toEqual(expect.arrayContaining(['.card', '#main']))
  })

  it('descends into a media query', () => {
    expect(extractClassAndIdSelectors('@media (max-width:600px){.mob{}}')).toContain('.mob')
  })

  it('strips a pseudo-class so .btn:hover reports as .btn', () => {
    const found = extractClassAndIdSelectors('.btn:hover{}')
    expect(found).toContain('.btn')
    expect(found).not.toContain('.btn:hover')
  })

  it('ignores element, universal and :root selectors', () => {
    const found = extractClassAndIdSelectors('body{}*{}:root{}h1{}')
    expect(found).toEqual([])
  })

  it('ignores an @keyframes percentage step, which is not a selector', () => {
    expect(extractClassAndIdSelectors('@keyframes spin{0%{}100%{}}')).toEqual([])
  })

  it('does not read a hex colour in a declaration body as an id selector', () => {
    // The false positive that forces prelude-only parsing: a naive
    // regex over the whole stylesheet reports "#fff" as an id.
    expect(extractClassAndIdSelectors('.a{color:#fff;background:#000}')).toEqual(['.a'])
  })

  it('does not read a "#" inside an attribute selector as an id selector', () => {
    expect(extractClassAndIdSelectors('[data-anchor="#top"]{}')).toEqual([])
  })
})

describe('extractReferencedTokens', () => {
  it('finds a class used in markup', () => {
    expect(extractReferencedTokens('<div class="card wide">')).toContain('card')
  })

  it('finds a class that only exists as a JS string literal', () => {
    // The false-positive this whole function exists to prevent: a
    // class added at runtime by navMenu.ts or viewToggle.ts appears
    // in NO markup, and a naive checker would call its CSS dead.
    expect(extractReferencedTokens("el.classList.add('is-open')")).toContain('is-open')
  })
})

describe('assertNotSilentZero', () => {
  it('throws when the page links a stylesheet but nothing was measured', () => {
    expect(() => assertNotSilentZero(true, 0)).toThrow(SilentZeroBudgetError)
  })

  it('does not throw when bytes were measured', () => {
    expect(() => assertNotSilentZero(true, 1)).not.toThrow()
  })

  it('does not throw when there is genuinely no stylesheet link', () => {
    expect(() => assertNotSilentZero(false, 0)).not.toThrow()
  })
})

describe('computeCssBudgetReport on a synthetic dist', () => {
  it('counts a reachable stylesheet, follows its @import, and reports an orphan', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cssbudget-'))
    try {
      mkdirSync(join(dir, '_astro'))
      writeFileSync(join(dir, 'index.html'), '<link rel="stylesheet" href="/_astro/main.css"><div class="used"></div>')
      writeFileSync(join(dir, '_astro/main.css'), '@import "./base.css";.used{color:red}')
      writeFileSync(join(dir, '_astro/base.css'), '.dead{color:blue}')
      writeFileSync(join(dir, '_astro/orphan.css'), '.nobody{color:green}')

      const report = computeCssBudgetReport({ distDir: dir, budgetBytes: 1024 * 1024 })

      expect(report.reachableFiles.map((f) => f.file).sort()).toEqual(['_astro/base.css', '_astro/main.css'])
      expect(report.unreachableFiles.map((f) => f.file)).toEqual(['_astro/orphan.css'])
      expect(report.unreferencedSelectors).toContain('.dead')
      expect(report.unreferencedSelectors).not.toContain('.used')
      expect(report.passed).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails when the budget is exceeded', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cssbudget-'))
    try {
      writeFileSync(join(dir, 'index.html'), '<link rel="stylesheet" href="/big.css">')
      writeFileSync(join(dir, 'big.css'), '.a{color:red}'.repeat(500))
      const report = computeCssBudgetReport({ distDir: dir, budgetBytes: 10 })
      expect(report.passed).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('counts an inline <style> block against the budget', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cssbudget-'))
    try {
      writeFileSync(join(dir, 'index.html'), '<style>.a{color:red}</style>')
      const report = computeCssBudgetReport({ distDir: dir, budgetBytes: 1024 * 1024 })
      expect(report.inlineStyleBytes).toBeGreaterThan(0)
      expect(report.budgetedBytes).toBe(report.reachableBytes + report.inlineStyleBytes)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('computeCssBudgetReport against the REAL build', () => {
  it('measures actual dist/ output and stays inside the budget', () => {
    const report = computeCssBudgetReport({ distDir: 'dist' })
    expect(report.budgetedBytes).toBeGreaterThan(0)
    expect(report.passed).toBe(true)
  })

  it('reachable and unreachable sets never overlap', () => {
    const report = computeCssBudgetReport({ distDir: 'dist' })
    const reachable = new Set(report.reachableFiles.map((f) => f.file))
    for (const entry of report.unreachableFiles) {
      expect(reachable.has(entry.file)).toBe(false)
    }
  })
})
