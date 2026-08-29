import { Component, type ErrorInfo, type ReactNode } from "react";

import { ErrorState } from "@/components/ErrorState";
import { Screen } from "@/components/Screen";
import { isDevelopment } from "@/config/env";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Top-level crash barrier. Prevents a render error anywhere in the tree from
 * showing the raw red screen to a user. Development keeps the real message
 * visible; production shows neutral copy only.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Crash reporting is not wired up yet — console only, deliberately.
    console.error("[viewrr] unhandled render error", error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <Screen>
        <ErrorState
          title="Viewrr hit a snag"
          message={
            isDevelopment
              ? error.message
              : "The app ran into an unexpected problem. Reload to carry on."
          }
          onRetry={this.reset}
          retryLabel="Reload"
        />
      </Screen>
    );
  }
}
