import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
    children?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
        errorInfo: null
    };

    public static getDerivedStateFromError(error: Error): State {
        // Update state so the next render will show the fallback UI.
        return { hasError: true, error, errorInfo: null };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("Uncaught error:", error, errorInfo);
        this.setState({ errorInfo });
    }

    public render() {
        if (this.state.hasError) {
            // A deploy replaces the old hashed chunk files; a tab left open
            // across that deploy can crash trying to fetch a page it hasn't
            // visited yet, since the old filename is now gone. That's not a
            // real bug to dump a stack trace over — just prompt a reload.
            const message = this.state.error?.message || '';
            const isStaleChunk = /dynamically imported module|module script failed|Failed to fetch dynamically imported module/i.test(message);
            if (isStaleChunk) {
                return (
                    <div style={{
                        minHeight: 'var(--vh-full)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '14px',
                        fontFamily: 'system-ui, sans-serif',
                        background: '#F6F8FB',
                        color: '#111827',
                        textAlign: 'center',
                        padding: '24px'
                    }}>
                        <p style={{ fontSize: '17px', fontWeight: 700, margin: 0 }}>A new version is available.</p>
                        <p style={{ fontSize: '13px', color: '#6B7280', margin: 0, maxWidth: '360px' }}>
                            This page was loaded before the latest update. Reload to get it.
                        </p>
                        <button
                            onClick={() => window.location.reload()}
                            style={{
                                marginTop: '6px',
                                padding: '9px 20px',
                                backgroundColor: '#3B82F6',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontWeight: 600,
                                fontSize: '14px'
                            }}
                        >
                            Reload
                        </button>
                    </div>
                );
            }
            return (
                <div style={{
                    padding: '40px',
                    backgroundColor: '#1F2937',
                    color: '#EF4444',
                    minHeight: 'var(--vh-full)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'system-ui, sans-serif'
                }}>
                    <div style={{
                        maxWidth: '800px',
                        width: '100%',
                        backgroundColor: '#111827',
                        padding: '24px',
                        borderRadius: '8px',
                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.5)'
                    }}>
                        <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '16px' }}>Something went wrong</h1>
                        <p style={{ color: '#9CA3AF', marginBottom: '8px' }}>The application encountered an error and crashed.</p>
                        <div style={{
                            marginTop: '20px',
                            padding: '16px',
                            backgroundColor: 'rgba(239, 68, 68, 0.1)',
                            borderRadius: '4px',
                            overflowX: 'auto'
                        }}>
                            <p style={{ fontWeight: 'bold', marginBottom: '8px' }}>{this.state.error && this.state.error.toString()}</p>
                            {this.state.errorInfo && (
                                <pre style={{ fontSize: '12px', color: '#F87171' }}>
                                    {this.state.errorInfo.componentStack}
                                </pre>
                            )}
                        </div>
                        <button
                            onClick={() => window.location.reload()}
                            style={{
                                marginTop: '24px',
                                padding: '8px 16px',
                                backgroundColor: '#3B82F6',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontWeight: 500
                            }}
                        >
                            Reload Page
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
