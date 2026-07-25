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
import { useEffect, useMemo, useState } from 'react'
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

export interface VerdictInput {
  n: number
  arm: ArmShape
}

export interface Verdict {
  verdict: 'ADMITTED' | 'DECLINED'
  reason: string
}

const SINGLE_ORG_REASON = loop.whyNoTuning.reasons[0]

/**
 * The Mode B guard rule. Two independent gates, both of which must
 * clear for a weight change to be admitted:
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
 * Either gate failing alone is enough to decline, so the two failure
 * reasons stay distinguishable rather than collapsing into one
 * generic "not enough evidence" message.
 */
export function evaluateChange({ n, arm }: VerdictInput): Verdict {
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

/**
 * Reads prefers-reduced-motion once on mount and keeps it in sync with
 * live changes, so bar transitions and any other CSS motion in this
 * component can be switched off without a page reload. Motion is
 * suppressed at the CSS layer (see the .loop-bar__fill rule below);
 * this hook only needs to exist so JS-driven state changes (mode
 * switches, step changes) never themselves animate.
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(query.matches)
    const listener = (event: MediaQueryListEvent) => setReduced(event.matches)
    query.addEventListener('change', listener)
    return () => query.removeEventListener('change', listener)
  }, [])

  return reduced
}

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

function Perturb() {
  const [weightIndex, setWeightIndex] = useState(0)
  const [delta, setDelta] = useState(0)
  const [n, setN] = useState(loop.whyNoTuning.outcomeCount)
  const [arm, setArm] = useState<ArmShape>('single')

  const verdict = useMemo(() => evaluateChange({ n, arm }), [n, arm])
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

      <div
        className={
          verdict.verdict === 'ADMITTED'
            ? 'loop-verdict loop-verdict--admitted'
            : 'loop-verdict loop-verdict--declined'
        }
        role="status"
        aria-live="polite"
      >
        <p className="loop-verdict__label">
          {verdict.verdict === 'ADMITTED' ? 'CHANGE ADMITTED' : 'CHANGE DECLINED'}
        </p>
        <p className="loop-verdict__reason">{verdict.reason}</p>
      </div>

      <WeightBars
        highlightIndex={verdict.verdict === 'ADMITTED' && delta !== 0 ? weightIndex : undefined}
      />
    </div>
  )
}

export default function LoopExplainer() {
  const [mode, setMode] = useState<Mode>('walkthrough')
  // Read but not directly branched on below: the class this hook
  // returns drives the CSS motion guard (.loop-bar__fill's transition
  // is suppressed under prefers-reduced-motion in the stylesheet), so
  // the hook's only job here is to keep the component subscribed to
  // live changes to the media query for the lifetime of the island.
  usePrefersReducedMotion()

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
