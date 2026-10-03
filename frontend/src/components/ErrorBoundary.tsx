/**
 * Catches render errors so one broken component cannot blank the whole app.
 *
 * Previously any thrown error took the entire page down with a white screen — survivable while
 * everything was synchronous and local, not once responses come off the network.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Btn, Ms } from './ui';

interface Props {
  children: ReactNode;
  /** Shown instead of the default panel. */
  fallback?: (reset: () => void, error: Error) => ReactNode;
  /** Label used in the logged message, to identify which boundary tripped. */
  label?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // TODO(obs): forward to real error reporting once there is somewhere to send it.
    console.error(`[${this.props.label ?? 'app'}] render error`, error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.reset, error);

    return (
      <div role="alert" style={{ padding: 24, display: 'flex', justifyContent: 'center' }}>
        <div className="card col" style={{ maxWidth: 460, padding: 28, gap: 12, alignItems: 'flex-start' }}>
          <Ms n="error_outline" size={28} className="muted" />
          <div className="subhead">This part of the app stopped working</div>
          <div className="body-sm">
            Something broke while rendering. Reloading usually clears it; if it keeps happening the details are in the
            browser console.
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Btn variant="primary" icon="refresh" onClick={this.reset}>
              Try again
            </Btn>
            <Btn variant="text" onClick={() => window.location.reload()}>
              Reload the page
            </Btn>
          </div>
        </div>
      </div>
    );
  }
}
