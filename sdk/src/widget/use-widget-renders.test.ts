import { expect, test, vi } from "vitest"
import { useWidgetRenders } from "./use-widget-renders.ts"

vi.mock("react", () => ({
  useCallback: (callback: unknown) => callback,
  useEffect: () => {},
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, vi.fn()],
}))

test("native handles dispose with their original receiver and release the render", () => {
  const container = { remove: vi.fn() }
  vi.stubGlobal("document", { createElement: () => container })
  const handle = {
    subscription: { unsubscribe: vi.fn() },
    update: () => {},
    dispose() {
      this.subscription.unsubscribe()
    },
  }
  const release = vi.fn()
  try {
    const { renderWidget } = useWidgetRenders(
      { card: { description: "Card", render: () => handle } },
      { append: vi.fn() } as unknown as HTMLElement,
      undefined,
    )
    const mounted = renderWidget({
      widget: "card",
      props: {},
      toolCallId: "call",
      release,
      context: {
        input: {},
        status: "complete",
        signal: new AbortController().signal,
        invocationId: "call",
        callTool: vi.fn(),
      },
    })
    if (typeof mounted === "function") mounted()
    else mounted.dispose()
    expect(handle.subscription.unsubscribe).toHaveBeenCalledOnce()
    expect(container.remove).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
  } finally {
    vi.unstubAllGlobals()
  }
})
