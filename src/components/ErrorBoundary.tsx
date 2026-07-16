import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  name: string
  children: ReactNode
}

interface State {
  error: string
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: '' }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`[Nebula] ${this.props.name} crashed`, error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <section className="m-2 rounded-[18px] border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-100">
          <div className="font-semibold">{this.props.name} crashed</div>
          <p className="mt-2 text-xs text-red-100/80">{this.state.error}</p>
          <button
            className="mt-3 rounded-full border border-red-200/20 px-3 py-1 text-xs text-red-50 hover:bg-red-200/10"
            onClick={() => this.setState({ error: '' })}
          >
            Retry panel
          </button>
        </section>
      )
    }

    return this.props.children
  }
}