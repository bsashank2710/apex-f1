import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, Spacing, FontSize, Radius } from '../constants/theme';

interface Props {
  children: React.ReactNode;
  /** Custom fallback — if omitted the default error card is shown */
  fallback?: React.ReactNode;
  /** Label shown on the retry button */
  label?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  reset = () => this.setState({ hasError: false, error: undefined });

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    return (
      <View style={styles.container}>
        <Text style={styles.icon}>⚠️</Text>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.message} numberOfLines={4}>
          {this.state.error?.message ?? 'An unexpected error occurred'}
        </Text>
        <TouchableOpacity style={styles.button} onPress={this.reset}>
          <Text style={styles.buttonText}>{this.props.label ?? 'RETRY'}</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

/**
 * Convenience wrapper — wraps children in an ErrorBoundary with the standard
 * full-screen error card.
 */
export function WithErrorBoundary({
  children,
  label,
}: {
  children: React.ReactNode;
  label?: string;
}) {
  return <ErrorBoundary label={label}>{children}</ErrorBoundary>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
    padding: Spacing.xl,
  },
  icon: { fontSize: 48, marginBottom: Spacing.md },
  title: {
    color: Colors.text,
    fontSize: FontSize.lg,
    fontWeight: '700',
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  message: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: Spacing.lg,
  },
  button: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xl,
  },
  buttonText: {
    color: Colors.text,
    fontWeight: '700',
    letterSpacing: 1,
    fontSize: FontSize.sm,
  },
});
