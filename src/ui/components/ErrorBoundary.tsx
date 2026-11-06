import { Component, type ErrorInfo, type ReactNode } from 'react'

/** Dernier filet : jamais d'écran blanc. Les données ne sont pas touchées, recharger suffit. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  override render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="fatal" role="alert">
        <p className="empty__title">Un petit souci d’affichage</p>
        <p className="empty__text">Ta liste n’a rien à craindre : elle est bien enregistrée sur ce téléphone.</p>
        <button type="button" className="button button--primary" onClick={() => location.reload()}>Recharger</button>
      </div>
    )
  }
}
