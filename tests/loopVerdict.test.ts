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
//
// A code-reviewer pass (fix round 1) caught a Critical bug that lived
// exactly at the boundary these first tests never exercised: every case
// below originally called evaluateChange({n, arm}) with no `delta` at
// all, so nothing here could have caught a caller that never proposed a
// change in the first place. `delta` is now a required third input, and
// the 'delta === 0' describe block below is the direct regression
// coverage for that gap - see tests/loopPerturbRender.test.tsx for the
// same bug reproduced at the component-rendering layer, which is where
// it actually lived (Perturb never passed delta to this function at
// all).
import { describe, it, expect } from 'vitest'
import { evaluateChange, N_THRESHOLD } from '../src/components/LoopExplainer'
import loop from '../content/loop-data.json'

// A representative nonzero delta, used by every test below that is
// specifically about the n/arm gates rather than the delta gate - it
// stands in for "some change was proposed," and its exact magnitude is
// irrelevant to those tests (evaluateChange does not gate on the SIZE
// of an attempted change, only on whether one exists and on n/arm).
const A_PROPOSED_CHANGE = 5

describe('evaluateChange - the Mode B guard rule', () => {
  it('declines the real, current state: n=7 and a single-organisation arm, citing the arm as the reason', () => {
    // Both gates fail here (n=7 is below N_THRESHOLD=8, and the arm is
    // single), so this also pins WHICH of the two reasons the function
    // surfaces when both would justify a decline - see the single-gate
    // cases below for the other reason text.
    const result = evaluateChange({
      n: loop.whyNoTuning.outcomeCount,
      arm: 'single',
      delta: A_PROPOSED_CHANGE,
    })
    expect(result.verdict).toBe('DECLINED')
    expect(result.reason).toBe(loop.whyNoTuning.reasons[0])
  })

  it('declines when n clears the threshold but the arm is still a single organisation, citing the arm', () => {
    const result = evaluateChange({ n: N_THRESHOLD, arm: 'single', delta: A_PROPOSED_CHANGE })
    expect(result.verdict).toBe('DECLINED')
    // The reason must name the gate that actually failed (the arm), not
    // a generic message - a reviewer pass flagged this as untested.
    expect(result.reason).toBe(loop.whyNoTuning.reasons[0])
  })

  it('declines when the arm is unconfounded but n has not cleared the threshold, citing n', () => {
    const result = evaluateChange({
      n: N_THRESHOLD - 1,
      arm: 'multiple',
      delta: A_PROPOSED_CHANGE,
    })
    expect(result.verdict).toBe('DECLINED')
    // Here the arm gate passes, so the reason must be about n specifically
    // - reusing the arm's reason text here would be a wrong-reason bug.
    expect(result.reason).toContain(`${N_THRESHOLD - 1}`)
    expect(result.reason).toContain(`${N_THRESHOLD}`)
  })

  it('admits a change only once n clears the threshold AND the arm is unconfounded AND a change was proposed', () => {
    const result = evaluateChange({ n: N_THRESHOLD, arm: 'multiple', delta: A_PROPOSED_CHANGE })
    expect(result.verdict).toBe('ADMITTED')
  })

  it('never admits on n alone, no matter how large n grows, while the arm stays single', () => {
    // Distinct from the n-threshold-inclusive case above: this pins that
    // raising n has NO ceiling that alone flips the verdict - the arm
    // gate is independent, not a fallback the n gate can outrun.
    const result = evaluateChange({ n: 10_000, arm: 'single', delta: A_PROPOSED_CHANGE })
    expect(result.verdict).toBe('DECLINED')
    expect(result.reason).toBe(loop.whyNoTuning.reasons[0])
  })
})

describe('evaluateChange - delta=0 is a distinct third state, never ADMITTED', () => {
  it('THE CRITICAL-BUG REPRODUCTION: n at threshold, arm unconfounded, delta=0 must NOT read ADMITTED', () => {
    // This is the exact state a visitor reaches by following the panel's
    // own instructions (raise n, un-confound the arm) without ever
    // touching the delta slider - the precise repro a code-reviewer pass
    // used to catch the Critical finding. Before the fix, this returned
    // ADMITTED because evaluateChange had no `delta` parameter at all
    // and could not have known no change was on the table.
    const result = evaluateChange({ n: N_THRESHOLD, arm: 'multiple', delta: 0 })
    expect(result.verdict).toBe('NO_CHANGE_PROPOSED')
    expect(result.verdict).not.toBe('ADMITTED')
  })

  it('delta=0 declines to nothing (a no-op is not a decline either) regardless of how badly n/arm fail', () => {
    // The opposite corner of the same bug class: a delta of 0 must not
    // be misread as a rejected change either, since nothing was proposed
    // to reject. Both gates fail hard here (n=1, arm='single'), and the
    // verdict must still be neutral, not DECLINED.
    const result = evaluateChange({ n: 1, arm: 'single', delta: 0 })
    expect(result.verdict).toBe('NO_CHANGE_PROPOSED')
    expect(result.verdict).not.toBe('DECLINED')
  })

  it('a negative delta (lowering a weight) still counts as a proposed change, not a no-op', () => {
    const result = evaluateChange({ n: N_THRESHOLD, arm: 'multiple', delta: -5 })
    expect(result.verdict).toBe('ADMITTED')
  })
})
