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
            return (
                <div style={{
                    padding: '40px',
                    backgroundColor: '#1F2937',
                    color: '#EF4444',
                    minHeight: '100vh',
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
