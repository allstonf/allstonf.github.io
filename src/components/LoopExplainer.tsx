// src/components/LoopExplainer.tsx - the one React island on this
// site, and the reason @astrojs/react was registered in Task 1.
//
// The static case for this component is already made in index.astro:
// nine logged rubric changes, and not one of them ever mutated a
// component weight. That fact is true and rare, but reading it in
// prose only asks a visitor to take it on faith. This component lets
// them test it instead.
//
// Two modes:
//
//   Mode A (Walkthrough) is the record played back - the six weights
//   rendered as bars that visibly do not move while the change-kind
//   badge cycles through all nine logged changes. The point made
//   visual rather than just stated.
//
//   Mode B ("Try to move a weight") is the differentiator. A visitor
//   gets a weight slider, a control for how many observed outcomes
//   exist (n), and a toggle for whether the favourable arm is one
//   organisation or several. Every attempted change is run through
//   evaluateChange() below - the same two-gate rule the real rubric
//   log has never cleared. Declining on the real numbers only proves
//   the rule is cautious; showing that raising n AND un-confounding
//   the arm actually admits a change is what proves it is a real,
//   satisfiable rule rather than a rule that always says no. That is
//   the Ciechanowski test: a visitor can try to break the discipline,
//   fail, and see exactly what would have made it succeed.
//
// evaluateChange() and N_THRESHOLD are exported as named exports
// specifically so tests/loopVerdict.test.ts can exercise the guard
// rule directly, without rendering React or touching a DOM.
import { useMemo, useState } from 'react'
import loop from '../../content/loop-data.json'

/**
 * n=8 is one more than the real, current outcome count (7, read from
 * loop-data.json's whyNoTuning.outcomeCount) - so the real state
 * declines on this gate today, and a visitor has to deliberately raise
 * n past it to see what "enough evidence" would look like. Exported so
 * the test suite pins the exact boundary rather than a magic number.
 */
export const N_THRESHOLD = 8

export type ArmShape = 'single' | 'multiple'

export type VerdictKind = 'ADMITTED' | 'DECLINED' | 'NO_CHANGE_PROPOSED'

export interface VerdictInput {
  n: number
  arm: ArmShape
  /**
   * The attempted change, in points, to the selected weight. Required
   * (not optional) on purpose: a code-reviewer pass caught that this
   * field did not exist at all in an earlier version of this function,
   * so the caller (Perturb, below) evaluated n and arm without ever
   * telling the guard rule whether a change had actually been proposed
   * - which meant the verdict could read ADMITTED while the weight
   * slider still sat at 0 pts. Making delta a required argument means a
   * caller cannot repeat that mistake by omission.
   */
  delta: number
}

export interface Verdict {
  verdict: VerdictKind
  reason: string
}

/** Display text for each verdict kind - the single source Perturb reads
 * from, so the rendered label can never drift from the computed verdict
 * kind (the earlier bug was exactly this kind of drift, just one layer
 * up: the STATE was wrong, not the label mapping - but keeping the
 * mapping itself as data rather than an inline ternary chain is what
 * makes it testable as a unit on its own). */
export const VERDICT_LABELS: Record<VerdictKind, string> = {
  ADMITTED: 'CHANGE ADMITTED',
  DECLINED: 'CHANGE DECLINED',
  NO_CHANGE_PROPOSED: 'NO CHANGE PROPOSED',
}

const SINGLE_ORG_REASON = loop.whyNoTuning.reasons[0]

// loop.whyNoTuning.reasons has three entries. Only reasons[0] (the
// single-organisation confound) is reachable through Mode B's controls,
// via the arm toggle - reasons[1] ("confounded by application channel")
// and reasons[2] ("channel data was never recorded") describe historical
// context that the static record above renders in full, but neither has
// an interactive control here, so evaluateChange() can never surface
// them. They are not dead code; they are read-only history.
const NO_CHANGE_REASON =
  'No change has been proposed yet. Move the weight slider above to attempt one - the guard rule only has something to evaluate once a change is actually on the table.'

/**
 * The Mode B guard rule. A change is only evaluated at all once one has
 * actually been proposed (delta !== 0); a delta of 0 is a distinct third
 * state, NO_CHANGE_PROPOSED, checked before either gate below. Treating
 * "nothing proposed" as an implicit pass-through into the two-gate logic
 * is exactly the bug a code-reviewer pass caught: with delta ignored,
 * n=8 and arm='multiple' alone read as ADMITTED even though no change
 * was on the table - a verdict announcing a change was admitted when
 * zero change was attempted, which is self-contradictory in precisely
 * the dimension this component exists to demonstrate. Declining a
 * no-op would be equally wrong in the other direction (it would read as
 * the rule refusing something nobody asked for), so this is a genuine
 * third outcome, not a fold-in to ADMITTED or DECLINED.
 *
 * Once a change is proposed, two independent gates, both of which must
 * clear for it to be admitted:
 *
 *   1. n (observed outcomes) must reach N_THRESHOLD. Below it, there
 *      is not enough evidence for a change to move the weight one way
 *      rather than the other - the same "capture before tuning" rule
 *      loop-data.json's whyNoTuning.rule states.
 *   2. The favourable arm must be more than one organisation. A
 *      single organisation "wearing the costume of two" is one data
 *      point, not a contrast group - the exact confound
 *      loop-data.json's whyNoTuning.reasons[0] describes.
 *
 * Either gate failing alone is enough to decline. When BOTH gates fail,
 * the arm reason is surfaced (checked first, deliberately) rather than
 * a compound message - a visitor raising n while the arm is still
 * single sees the same arm-confound reason regardless of n, since the
 * arm gate is what is actually blocking them at that point; the n gate
 * only becomes the visible blocker once the arm gate has already
 * cleared. This priority is a readability choice (one reason at a time
 * beats a run-on sentence citing both), not a claim that n is being
 * ignored - the n-only decline case immediately below still cites n
 * specifically.
 */
export function evaluateChange({ n, arm, delta }: VerdictInput): Verdict {
  if (delta === 0) {
    return { verdict: 'NO_CHANGE_PROPOSED', reason: NO_CHANGE_REASON }
  }

  const nClears = n >= N_THRESHOLD
  const armClears = arm === 'multiple'

  if (nClears && armClears) {
    return {
      verdict: 'ADMITTED',
      reason: `n has reached ${n} observed outcomes and the favourable arm now spans more than one organisation - both gates clear.`,
    }
  }

  if (!armClears) {
    return { verdict: 'DECLINED', reason: SINGLE_ORG_REASON }
  }

  return {
    verdict: 'DECLINED',
    reason: `Only ${n} observed outcomes exist; the rule requires at least ${N_THRESHOLD} before a weight can move.`,
  }
}

type Mode = 'walkthrough' | 'perturb'

function WeightBars({ highlightIndex }: { highlightIndex?: number }) {
  const maxWeight = Math.max(...loop.weights.map((w) => w.weight))

  return (
    <ul className="loop-bars" aria-label="Rubric component weights">
      {loop.weights.map((w, index) => (
        <li
          key={w.component}
          className={index === highlightIndex ? 'loop-bar loop-bar--highlight' : 'loop-bar'}
        >
          <span className="loop-bar__label">{w.component}</span>
          <span className="loop-bar__track">
            <span
              className="loop-bar__fill"
              style={{ width: `${(w.weight / maxWeight) * 100}%` }}
            />
          </span>
          <span className="loop-bar__value">{w.weight}%</span>
        </li>
      ))}
    </ul>
  )
}

function Walkthrough() {
  const [step, setStep] = useState(0)
  const total = loop.changes.length
  const current = loop.changes[step]

  const goPrev = () => setStep((s) => Math.max(0, s - 1))
  const goNext = () => setStep((s) => Math.min(total - 1, s + 1))

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      goPrev()
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      goNext()
    }
  }

  return (
    <div className="loop-mode-panel" onKeyDown={onKeyDown}>
      <p className="loop-mode-panel__intro">
        Step through all nine logged changes. Watch the bars - they never move.
      </p>
      <div className="loop-walkthrough">
        <WeightBars />
        <div className="loop-walkthrough__change">
          <p className="loop-step-indicator">
            change {step + 1} of {total}
          </p>
          <span className="loop-kind-badge">{current.kind}</span>
          <p className="loop-walkthrough__summary">{current.summary}</p>
          <div className="loop-walkthrough__nav">
            <button type="button" onClick={goPrev} disabled={step === 0}>
              prev
            </button>
            <button type="button" onClick={goNext} disabled={step === total - 1}>
              next
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Exported (not just default-exported via LoopExplainer below) so
// tests/loopPerturbRender.test.tsx can mount this component directly
// and drive its actual DOM controls - a pure-function test on
// evaluateChange() alone cannot catch a bug in how THIS component wires
// its own state into that function, which is exactly where the
// Critical bug in fix round 1 lived (delta was never passed at all).
export function Perturb() {
  const [weightIndex, setWeightIndex] = useState(0)
  const [delta, setDelta] = useState(0)
  const [n, setN] = useState(loop.whyNoTuning.outcomeCount)
  const [arm, setArm] = useState<ArmShape>('single')

  // delta is now part of the dependency array AND part of the call
  // itself - both were missing before the fix. evaluateChange requiring
  // `delta` as a non-optional field (see its definition above) means a
  // future edit that drops it from this call is a type error, not a
  // silent runtime bug.
  const verdict = useMemo(() => evaluateChange({ n, arm, delta }), [n, arm, delta])
  const targetComponent = loop.weights[weightIndex].component

  return (
    <div className="loop-mode-panel">
      <p className="loop-mode-panel__intro">
        Try to move a weight. Every attempt runs the same guard rule the real log has
        never cleared - raise n far enough and un-confound the arm to see it actually
        admit a change. Nothing here rewrites the real history above; it is a
        simulation of the rule, not a mutation of the log.
      </p>

      <div className="loop-perturb-controls">
        <label className="loop-control">
          <span>component to perturb</span>
          <select
            value={weightIndex}
            onChange={(event) => setWeightIndex(Number(event.target.value))}
          >
            {loop.weights.map((w, index) => (
              <option key={w.component} value={index}>
                {w.component}
              </option>
            ))}
          </select>
        </label>

        <label className="loop-control">
          <span>
            attempted change to {targetComponent}: {delta > 0 ? '+' : ''}
            {delta} pts
          </span>
          <input
            type="range"
            min={-20}
            max={20}
            step={1}
            value={delta}
            onChange={(event) => setDelta(Number(event.target.value))}
          />
        </label>

        <label className="loop-control">
          <span>observed outcomes (n): {n}</span>
          <input
            type="range"
            min={1}
            max={15}
            step={1}
            value={n}
            onChange={(event) => setN(Number(event.target.value))}
          />
        </label>

        <fieldset className="loop-control loop-control--fieldset">
          <legend>favourable arm</legend>
          <label>
            <input
              type="radio"
              name="arm"
              value="single"
              checked={arm === 'single'}
              onChange={() => setArm('single')}
            />
            one organisation (the real state)
          </label>
          <label>
            <input
              type="radio"
              name="arm"
              value="multiple"
              checked={arm === 'multiple'}
              onChange={() => setArm('multiple')}
            />
            more than one organisation
          </label>
        </fieldset>
      </div>

      {/*
        Three distinct visual states, mirroring the three VerdictKind
        values - not two. Folding NO_CHANGE_PROPOSED into either the
        admitted or declined styling would misrepresent it the same way
        the Critical bug misrepresented it as data: this box must never
        wear "admitted" styling (amber, the single accent reserved for
        a real cleared-both-gates outcome) when nothing was proposed.
      */}
      <div
        className={
          verdict.verdict === 'ADMITTED'
            ? 'loop-verdict loop-verdict--admitted'
            : verdict.verdict === 'DECLINED'
              ? 'loop-verdict loop-verdict--declined'
              : 'loop-verdict loop-verdict--neutral'
        }
        role="status"
        aria-live="polite"
      >
        <p className="loop-verdict__label">{VERDICT_LABELS[verdict.verdict]}</p>
        <p className="loop-verdict__reason">{verdict.reason}</p>
      </div>

      {/*
        evaluateChange() guarantees ADMITTED is only ever returned when
        delta !== 0 (see its delta===0 short-circuit above), so
        verdict.verdict === 'ADMITTED' alone is sufficient here - no
        second "&& delta !== 0" check duplicating that invariant in the
        UI layer, which is exactly the kind of two-places-agree-by-
        coincidence setup that let the original bug hide.
      */}
      <WeightBars highlightIndex={verdict.verdict === 'ADMITTED' ? weightIndex : undefined} />
    </div>
  )
}

export default function LoopExplainer() {
  const [mode, setMode] = useState<Mode>('walkthrough')
  // Motion is suppressed entirely at the CSS layer: the
  // `@media (prefers-reduced-motion: reduce)` rule on .loop-bar__fill
  // (src/styles/tokens.css) removes the width transition, so a bar
  // change is instant rather than animated. No JS-side motion guard is
  // needed here - see that rule's own comment for why it is
  // implemented alongside the animation rather than retrofitted.

  return (
    <div className="loop-explainer">
      {/*
        A plain toggle-button group (role="group" + aria-pressed), not
        role="tablist"/"tab" - the full ARIA tabs pattern also expects
        aria-controls linking each tab to its panel, a roving tabindex,
        and arrow-key tab-switching, none of which this needs. A group
        of pressed/unpressed buttons is a fully-implemented pattern at
        this scope, where a half-implemented tablist would announce
        keyboard semantics to screen-reader users that are not there.
      */}
      <div className="loop-mode-tabs" role="group" aria-label="Loop explainer mode">
        <button
          type="button"
          aria-pressed={mode === 'walkthrough'}
          className={mode === 'walkthrough' ? 'loop-mode-tab loop-mode-tab--active' : 'loop-mode-tab'}
          onClick={() => setMode('walkthrough')}
        >
          walkthrough
        </button>
        <button
          type="button"
          aria-pressed={mode === 'perturb'}
          className={mode === 'perturb' ? 'loop-mode-tab loop-mode-tab--active' : 'loop-mode-tab'}
          onClick={() => setMode('perturb')}
        >
          try to move a weight
        </button>
      </div>

      {mode === 'walkthrough' ? <Walkthrough /> : <Perturb />}
    </div>
  )
}
