// tests/loopVerdict.test.ts - the guard rule LoopExplainer.tsx's Mode B
// exposes interactively: a visitor tries to move a rubric weight, and
// the component evaluates the same two-gate rule the real rubric log
// has never satisfied (see content/loop-data.json's whyNoTuning).
//
// Both gates must clear for a change to be admitted: the observed
// outcome count must clear a threshold, AND the favourable arm must be
// more than one organisation wearing two names. Either gate failing on
// its own is enough to decline - this is what makes the rule
// satisfiable rather than a blanket refusal, and testable rather than
// a component-only claim.
import { describe, it, expect } from 'vitest'
import { evaluateChange, N_THRESHOLD } from '../src/components/LoopExplainer'
import loop from '../content/loop-data.json'

describe('evaluateChange - the Mode B guard rule', () => {
  it('declines the real, current state: n=7 and a single-organisation arm, citing the arm as the reason', () => {
    // Both gates fail here (n=7 is below N_THRESHOLD=8, and the arm is
    // single), so this also pins WHICH of the two reasons the function
    // surfaces when both would justify a decline - see the single-gate
    // cases below for the other reason text.
    const result = evaluateChange({ n: loop.whyNoTuning.outcomeCount, arm: 'single' })
    expect(result.verdict).toBe('DECLINED')
    expect(result.reason).toBe(loop.whyNoTuning.reasons[0])
  })

  it('declines when n clears the threshold but the arm is still a single organisation, citing the arm', () => {
    const result = evaluateChange({ n: N_THRESHOLD, arm: 'single' })
    expect(result.verdict).toBe('DECLINED')
    // The reason must name the gate that actually failed (the arm), not
    // a generic message - a reviewer pass flagged this as untested.
    expect(result.reason).toBe(loop.whyNoTuning.reasons[0])
  })

  it('declines when the arm is unconfounded but n has not cleared the threshold, citing n', () => {
    const result = evaluateChange({ n: N_THRESHOLD - 1, arm: 'multiple' })
    expect(result.verdict).toBe('DECLINED')
    // Here the arm gate passes, so the reason must be about n specifically
    // - reusing the arm's reason text here would be a wrong-reason bug.
    expect(result.reason).toContain(`${N_THRESHOLD - 1}`)
    expect(result.reason).toContain(`${N_THRESHOLD}`)
  })

  it('admits a change only once n clears the threshold AND the arm is unconfounded', () => {
    const result = evaluateChange({ n: N_THRESHOLD, arm: 'multiple' })
    expect(result.verdict).toBe('ADMITTED')
  })

  it('never admits on n alone, no matter how large n grows, while the arm stays single', () => {
    // Distinct from the n-threshold-inclusive case above: this pins that
    // raising n has NO ceiling that alone flips the verdict - the arm
    // gate is independent, not a fallback the n gate can outrun.
    const result = evaluateChange({ n: 10_000, arm: 'single' })
    expect(result.verdict).toBe('DECLINED')
    expect(result.reason).toBe(loop.whyNoTuning.reasons[0])
  })
})
