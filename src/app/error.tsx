'use client';

import { useEffect } from 'react';

/** Route-segment error boundary: catches render errors below the root layout. */
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Server errors are already logged with the same digest via instrumentation.onRequestError.
    console.error(error); // eslint-disable-line no-console
  }, [error]);

  return (
    <main role="alert">
      <h1>Something went wrong</h1>
      <p>
        An unexpected error occurred. If it persists, contact support
        {error.digest ? ` with reference ${error.digest}` : ''}.
      </p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
