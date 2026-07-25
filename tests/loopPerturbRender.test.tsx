// @vitest-environment jsdom
//
// tests/loopPerturbRender.test.tsx - a component-level regression test
// for the Critical bug a code-reviewer pass caught in fix round 1: Mode
// B's verdict panel could read "CHANGE ADMITTED" while the delta slider
// still read "0 pts", because Perturb's useMemo computed the verdict
// from [n, arm] only and never passed `delta` to evaluateChange() at
// all. tests/loopVerdict.test.ts covers the guard function itself as a
// pure unit, but a pure-function test on evaluateChange() cannot catch
// a WIRING bug - the bug was that the component never called the
// function with the right arguments in the first place. Only mounting
// the real component and driving it the way a visitor would catches
// that class of bug, so this file renders <Perturb /> for real (via
// react-dom/client + jsdom) and drives it through actual DOM events, in
// the exact order the coordinator's repro used: raise n, un-confound
// the arm, and NEVER touch the delta slider.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { N_THRESHOLD, Perturb } from '../src/components/LoopExplainer'

// Tells React this file is a supported test environment for act() - without
// it, act() still runs but logs a spurious warning on every call ("The
// current testing environment is not configured to support act(...)"),
// which is noise unrelated to what this file is regression-testing.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * Sets a controlled <input type="range"> value the way a real user
 * interaction does: through the native value setter (not the
 * React-shadowed instance property), then dispatches the 'input' event
 * React's onChange listens for on range inputs. Assigning `el.value`
 * directly does not notify React's synthetic event system, so onChange
 * would never fire and the component's state would silently not
 * update. This is the same technique used to drive the live cmux
 * browser verification for this component earlier in this task.
 */
function setRangeValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )!.set!
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('Perturb (Mode B) - the rendered verdict must match what was actually proposed', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  function mount() {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root!.render(<Perturb />)
    })
    return container
  }

  afterEach(() => {
    if (root) {
      act(() => root!.unmount())
    }
    container?.remove()
    container = null
    root = null
  })

  it('THE CRITICAL-BUG REPRODUCTION: raising n and un-confounding the arm, without ever touching delta, must not render ADMITTED', () => {
    const el = mount()

    // Drive the controls in the exact order the coordinator's repro
    // used - this order matters: the earlier hand-verification pass
    // missed the bug entirely because it happened to set delta to a
    // nonzero value BEFORE raising n, which hid the missing gate.
    const nSlider = el.querySelector('input[type="range"][min="1"][max="15"]') as HTMLInputElement
    act(() => setRangeValue(nSlider, String(N_THRESHOLD)))

    const multipleArmRadio = el.querySelector('input[value="multiple"]') as HTMLInputElement
    act(() => multipleArmRadio.click())

    // The delta slider is never touched - confirm it is still at its
    // default of 0 before checking the verdict text, so a future change
    // to the default wouldn't silently invalidate this reproduction.
    const deltaSlider = el.querySelector('input[type="range"][min="-20"][max="20"]') as HTMLInputElement
    expect(deltaSlider.value).toBe('0')

    expect(el.textContent).not.toContain('ADMITTED')
    expect(el.textContent).toContain('NO CHANGE PROPOSED')
  })

  it('renders ADMITTED once a nonzero change is actually proposed on top of both gates clearing', () => {
    const el = mount()

    const nSlider = el.querySelector('input[type="range"][min="1"][max="15"]') as HTMLInputElement
    act(() => setRangeValue(nSlider, String(N_THRESHOLD)))

    const multipleArmRadio = el.querySelector('input[value="multiple"]') as HTMLInputElement
    act(() => multipleArmRadio.click())

    const deltaSlider = el.querySelector('input[type="range"][min="-20"][max="20"]') as HTMLInputElement
    act(() => setRangeValue(deltaSlider, '5'))

    expect(el.textContent).toContain('CHANGE ADMITTED')
  })

  it('renders DECLINED, not ADMITTED, when a change is proposed but the arm is still single', () => {
    const el = mount()

    const nSlider = el.querySelector('input[type="range"][min="1"][max="15"]') as HTMLInputElement
    act(() => setRangeValue(nSlider, String(N_THRESHOLD)))

    const deltaSlider = el.querySelector('input[type="range"][min="-20"][max="20"]') as HTMLInputElement
    act(() => setRangeValue(deltaSlider, '5'))
    // Arm left at its default ('single') - never touched.

    expect(el.textContent).toContain('CHANGE DECLINED')
    expect(el.textContent).not.toContain('ADMITTED')
  })
})
